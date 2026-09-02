import crypto from "node:crypto";
import { loadCatalog } from "../lib/catalog.js";
import { database } from "../lib/db.js";
import { pollWorkNotification, sendAndPoll } from "../lib/dingtalk.js";
import { bodyObject, json } from "../lib/http.js";
import {
  buildMarkdownNotification,
  buildPublicReportSnapshot,
  payloadHash,
  routeEvents,
  validateDispatchPayload,
} from "../lib/routing.js";
import { requireServiceToken } from "../lib/security.js";

function sanitizedFailure(error) {
  const type = String(error?.failureType || error?.name || "notification_error").slice(0, 80);
  const message = String(error?.message || "notification failed")
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/(appsecret|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 500);
  return { type, message };
}

function eventKey(event) {
  return `${String(event?.event_id || "")}:${String(event?.content_hash || "")}`;
}

function parsedEventJson(value) {
  const event = typeof value === "string" ? JSON.parse(value) : value;
  if (!event || typeof event !== "object" || Array.isArray(event) || !event.event_id || !event.content_hash) {
    throw new Error("deferred notification event is invalid");
  }
  return event;
}

export function missingEventsForDeferredQueue(events, deliveredRows) {
  const delivered = new Set((deliveredRows || []).map(eventKey));
  return (events || []).filter((event) => !delivered.has(eventKey(event)));
}

export function mergeDeferredRecipients(routedRecipients, dueRows) {
  const recipients = new Map();
  for (const recipient of routedRecipients || []) {
    recipients.set(recipient.recipient_id, {
      ...recipient,
      events: new Map((recipient.events || []).map((event) => [eventKey(event), event])),
      deferred_items: [...(recipient.deferred_items || [])],
    });
  }
  for (const row of dueRows || []) {
    const event = parsedEventJson(row.event_json);
    if (!recipients.has(row.recipient_id)) {
      recipients.set(row.recipient_id, {
        recipient_id: row.recipient_id,
        display_name: row.display_name,
        dingtalk_user_id: row.dingtalk_user_id,
        events: new Map(),
        deferred_items: [],
      });
    }
    const recipient = recipients.get(row.recipient_id);
    recipient.events.set(eventKey(event), event);
    recipient.deferred_items.push({
      source_report_date: String(row.source_report_date || ""),
      event_id: event.event_id,
      content_hash: event.content_hash,
    });
  }
  return [...recipients.values()]
    .map((recipient) => ({ ...recipient, events: [...recipient.events.values()] }))
    .filter((recipient) => recipient.events.length > 0);
}

export function buildDeferredDeliveryUpdates(recipient, status, notifiedAt) {
  if (status !== "delivered") return [];
  return (recipient.deferred_items || []).map((item) => ({
    report_date: item.source_report_date,
    event_id: item.event_id,
    content_hash: item.content_hash,
    display_name: String(recipient.display_name || "").trim(),
    notification_status: "delivered",
    notified_at: notifiedAt,
  }));
}

async function queueMissingRevisionEvents(sql, payload, recipient, dispatchId) {
  const deliveredRows = await sql`
    SELECT event_id, content_hash
    FROM notification_delivery_items
    WHERE dispatch_id = ${dispatchId}
  `;
  const missing = missingEventsForDeferredQueue(recipient.events, deliveredRows);
  let queued = 0;
  for (const event of missing) {
    const inserted = await sql`
      INSERT INTO notification_deferred_items
        (recipient_id, event_id, content_hash, source_report_date, available_report_date, event_json)
      VALUES
        (${recipient.recipient_id}, ${event.event_id}, ${event.content_hash}, ${payload.report_date},
         ${payload.report_date}::date + INTERVAL '1 day', ${JSON.stringify(event)}::jsonb)
      ON CONFLICT (recipient_id, event_id, content_hash) DO NOTHING
      RETURNING event_id
    `;
    queued += inserted.length;
  }
  return queued;
}

async function markDeferredDelivered(sql, recipient, dispatchId) {
  for (const item of recipient.deferred_items || []) {
    await sql`
      UPDATE notification_deferred_items
      SET delivered_dispatch_id = ${dispatchId}, updated_at = now()
      WHERE recipient_id = ${recipient.recipient_id}
        AND event_id = ${item.event_id}
        AND content_hash = ${item.content_hash}
        AND delivered_dispatch_id IS NULL
    `;
  }
}

async function insertDispatch(sql, payload, recipient) {
  const id = crypto.randomUUID();
  const hash = payloadHash({
    run_id: payload.run_id,
    report_date: payload.report_date,
    recipient_id: recipient.recipient_id,
    events: recipient.events.map((event) => [event.event_id, event.content_hash]),
  });
  const inserted = await sql`
    INSERT INTO notification_dispatches
      (id, report_date, recipient_id, run_id, payload_hash, status)
    VALUES
      (${id}, ${payload.report_date}, ${recipient.recipient_id}, ${payload.run_id}, ${hash}, 'pending')
    ON CONFLICT (report_date, recipient_id) DO NOTHING
    RETURNING id
  `;
  if (!inserted.length) {
    const existing = await sql`
      SELECT id, status, task_id, run_id, updated_at
      FROM notification_dispatches
      WHERE report_date = ${payload.report_date} AND recipient_id = ${recipient.recipient_id}
    `;
    const prior = existing[0] || null;
    if (prior?.status === "failed") {
      await sql`
        UPDATE notification_dispatches
        SET run_id = ${payload.run_id}, payload_hash = ${hash}, status = 'pending',
            task_id = NULL, failure_type = NULL, failure_message = NULL,
            response_json = NULL, updated_at = now()
        WHERE id = ${prior.id} AND status = 'failed'
      `;
      await sql`DELETE FROM notification_delivery_items WHERE dispatch_id = ${prior.id}`;
      for (const event of recipient.events) {
        await sql`
          INSERT INTO notification_delivery_items (dispatch_id, event_id, content_hash)
          VALUES (${prior.id}, ${event.event_id}, ${event.content_hash})
          ON CONFLICT DO NOTHING
        `;
      }
      return { claimed: true, id: prior.id, retry: true };
    }
    return { claimed: false, existing: prior };
  }
  for (const event of recipient.events) {
    await sql`
      INSERT INTO notification_delivery_items (dispatch_id, event_id, content_hash)
      VALUES (${id}, ${event.event_id}, ${event.content_hash})
      ON CONFLICT DO NOTHING
    `;
  }
  return { claimed: true, id };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });
  try {
    requireServiceToken(req);
    const catalog = loadCatalog();
    const payload = validateDispatchPayload(await bodyObject(req), catalog);
    if (process.env.DINGTALK_PRODUCTION_SEND_ENABLED !== "true") {
      return json(res, 409, { error: "production_send_disabled", accepted: false });
    }
    const sql = database();
    const rows = await sql`
      SELECT
        rule.recipient_id,
        rule.platform_code,
        rule.primary_tag_code,
        rule.platform_codes,
        rule.primary_tag_codes,
        rule.enabled,
        recipient.display_name,
        recipient.dingtalk_user_id,
        recipient.enabled AS recipient_enabled
      FROM notification_rules AS rule
      JOIN notification_recipients AS recipient ON recipient.id = rule.recipient_id
      WHERE rule.enabled = true AND recipient.enabled = true
    `;
    const currentlyRouted = routeEvents(payload.events, rows);
    const dueRows = await sql`
      SELECT deferred.recipient_id,
             deferred.source_report_date::text AS source_report_date,
             deferred.event_json,
             recipient.display_name,
             recipient.dingtalk_user_id
      FROM notification_deferred_items AS deferred
      JOIN notification_recipients AS recipient ON recipient.id = deferred.recipient_id
      WHERE deferred.delivered_dispatch_id IS NULL
        AND deferred.available_report_date <= ${payload.report_date}
        AND recipient.enabled = true
      ORDER BY deferred.created_at, deferred.event_id
    `;
    const routed = mergeDeferredRecipients(currentlyRouted, dueRows);
    const results = [];
    const deferredDeliveryUpdates = [];
    for (const recipient of routed) {
      const claim = await insertDispatch(sql, payload, recipient);
      if (!claim.claimed) {
        const existing = claim.existing || {};
        if (existing.status === "delivered") {
          const deferredEventCount = await queueMissingRevisionEvents(sql, payload, recipient, existing.id);
          results.push({
            recipient_id: recipient.recipient_id,
            status: "already_dispatched",
            task_id: existing.task_id || "",
            deferred_event_count: deferredEventCount,
          });
          continue;
        }
        if (["accepted", "pending"].includes(existing.status) && existing.task_id) {
          const delivery = await pollWorkNotification(existing.task_id, recipient.dingtalk_user_id);
          await sql`
            UPDATE notification_dispatches
            SET status = ${delivery.status}, failure_type = ${delivery.failure_type || null},
                response_json = ${JSON.stringify(delivery.poll || {})}::jsonb, updated_at = now()
            WHERE id = ${existing.id}
          `;
          if (delivery.status === "delivered") {
            const notifiedAt = new Date().toISOString();
            await markDeferredDelivered(sql, recipient, existing.id);
            deferredDeliveryUpdates.push(...buildDeferredDeliveryUpdates(recipient, delivery.status, notifiedAt));
            await queueMissingRevisionEvents(sql, payload, recipient, existing.id);
          }
          results.push({
            recipient_id: recipient.recipient_id,
            status: delivery.status,
            task_id: existing.task_id,
            event_count: recipient.events.length,
          });
          continue;
        }
        results.push({
          recipient_id: recipient.recipient_id,
          status: existing.status || "pending",
          task_id: existing.task_id || "",
          event_count: recipient.events.length,
        });
        continue;
      }
      try {
        const message = buildMarkdownNotification(recipient, payload);
        const delivery = await sendAndPoll(recipient.dingtalk_user_id, message);
        const status = delivery.status === "failed" ? "failed" : delivery.status;
        const failureType = delivery.failure_type || null;
        await sql`
          UPDATE notification_dispatches
          SET status = ${status}, task_id = ${delivery.task_id || null}, failure_type = ${failureType},
              response_json = ${JSON.stringify(delivery.poll || delivery.response || {})}::jsonb, updated_at = now()
          WHERE id = ${claim.id}
        `;
        if (status === "delivered") {
          const notifiedAt = new Date().toISOString();
          await markDeferredDelivered(sql, recipient, claim.id);
          deferredDeliveryUpdates.push(...buildDeferredDeliveryUpdates(recipient, status, notifiedAt));
        }
        results.push({ recipient_id: recipient.recipient_id, status, task_id: delivery.task_id || "", event_count: recipient.events.length });
      } catch (error) {
        const failure = sanitizedFailure(error);
        await sql`
          UPDATE notification_dispatches
          SET status = 'failed', failure_type = ${failure.type}, failure_message = ${failure.message}, updated_at = now()
          WHERE id = ${claim.id}
        `;
        results.push({ recipient_id: recipient.recipient_id, status: "failed", failure_type: failure.type });
      }
    }
    const deliveryRows = await sql`
      SELECT d.recipient_id, d.status, d.updated_at,
             i.event_id, i.content_hash
      FROM notification_dispatches AS d
      JOIN notification_delivery_items AS i ON i.dispatch_id = d.id
      WHERE d.report_date = ${payload.report_date}
    `;
    const publicSnapshot = buildPublicReportSnapshot(payload, routed, deliveryRows);
    return json(res, 200, {
      accepted: true,
      run_id: payload.run_id,
      report_date: payload.report_date,
      matched_recipients: routed.length,
      results,
      public_snapshot: publicSnapshot,
      deferred_delivery_updates: deferredDeliveryUpdates,
    });
  } catch (error) {
    const failure = sanitizedFailure(error);
    return json(res, Number(error?.statusCode || 400), { error: failure.type, message: failure.message });
  }
}
