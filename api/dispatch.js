import crypto from "node:crypto";
import { loadCatalog } from "../lib/catalog.js";
import { database } from "../lib/db.js";
import { sendAndPoll } from "../lib/dingtalk.js";
import { bodyObject, json } from "../lib/http.js";
import { buildMarkdownNotification, payloadHash, routeEvents, validateDispatchPayload } from "../lib/routing.js";
import { requireServiceToken } from "../lib/security.js";

function sanitizedFailure(error) {
  const type = String(error?.failureType || error?.name || "notification_error").slice(0, 80);
  const message = String(error?.message || "notification failed")
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/(appsecret|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 500);
  return { type, message };
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
      SELECT id, status, task_id, run_id
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
        rule.enabled,
        recipient.display_name,
        recipient.dingtalk_user_id,
        recipient.enabled AS recipient_enabled
      FROM notification_rules AS rule
      JOIN notification_recipients AS recipient ON recipient.id = rule.recipient_id
      WHERE rule.enabled = true AND recipient.enabled = true
    `;
    const routed = routeEvents(payload.events, rows);
    const results = [];
    for (const recipient of routed) {
      const claim = await insertDispatch(sql, payload, recipient);
      if (!claim.claimed) {
        results.push({ recipient_id: recipient.recipient_id, status: "already_dispatched", task_id: claim.existing?.task_id || "" });
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
    return json(res, 200, {
      accepted: true,
      run_id: payload.run_id,
      report_date: payload.report_date,
      matched_recipients: routed.length,
      results,
    });
  } catch (error) {
    const failure = sanitizedFailure(error);
    return json(res, Number(error?.statusCode || 400), { error: failure.type, message: failure.message });
  }
}
