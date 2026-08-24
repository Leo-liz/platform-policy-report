import crypto from "node:crypto";
import { loadCatalog } from "../lib/catalog.js";
import { database } from "../lib/db.js";
import { searchDirectory, sendAndPoll } from "../lib/dingtalk.js";
import { bodyObject, clientAddress, json } from "../lib/http.js";
import { buildTestMarkdownNotification } from "../lib/routing.js";
import {
  clearSessionCookie,
  createSession,
  fingerprint,
  requireAdmin,
  sessionCookie,
  verifyOrigin,
  verifyPassword,
} from "../lib/security.js";

function actionOf(req) {
  if (req.query?.action) return String(req.query.action);
  return new URL(req.url, "https://local.invalid").searchParams.get("action") || "session";
}

function clean(value, limit = 180) {
  return String(value || "").trim().slice(0, limit);
}

async function audit(sql, action, targetType, targetId = null, detail = {}) {
  await sql`
    INSERT INTO notification_audit_logs (actor, action, target_type, target_id, detail_json)
    VALUES ('admin', ${action}, ${targetType}, ${targetId}, ${JSON.stringify(detail)}::jsonb)
  `;
}

async function login(req, res) {
  verifyOrigin(req);
  const sql = database();
  const key = fingerprint(clientAddress(req));
  const attempts = await sql`
    SELECT failure_count, blocked_until
    FROM notification_login_attempts
    WHERE fingerprint = ${key}
  `;
  if (attempts[0]?.blocked_until && new Date(attempts[0].blocked_until).getTime() > Date.now()) {
    return json(res, 429, { error: "login_rate_limited" });
  }
  const body = await bodyObject(req);
  if (!verifyPassword(body.password)) {
    await sql`
      INSERT INTO notification_login_attempts (fingerprint, failure_count, blocked_until, updated_at)
      VALUES (${key}, 1, NULL, now())
      ON CONFLICT (fingerprint) DO UPDATE SET
        failure_count = CASE
          WHEN notification_login_attempts.window_started_at < now() - interval '15 minutes' THEN 1
          ELSE notification_login_attempts.failure_count + 1
        END,
        window_started_at = CASE
          WHEN notification_login_attempts.window_started_at < now() - interval '15 minutes' THEN now()
          ELSE notification_login_attempts.window_started_at
        END,
        blocked_until = CASE
          WHEN notification_login_attempts.failure_count + 1 >= 5 THEN now() + interval '15 minutes'
          ELSE NULL
        END,
        updated_at = now()
    `;
    return json(res, 401, { error: "invalid_credentials" });
  }
  await sql`DELETE FROM notification_login_attempts WHERE fingerprint = ${key}`;
  const session = createSession();
  await audit(sql, "login", "session");
  return json(res, 200, { authenticated: true, csrf_token: session.payload.csrf }, { "Set-Cookie": sessionCookie(session.token) });
}

async function state(sql, csrfToken) {
  const recipients = await sql`
    SELECT id, display_name, dingtalk_user_id, source, enabled, created_at, updated_at
    FROM notification_recipients ORDER BY display_name
  `;
  const rules = await sql`
    SELECT id, recipient_id, platform_code, primary_tag_code, enabled, created_at, updated_at
    FROM notification_rules ORDER BY created_at DESC
  `;
  const dispatches = await sql`
    SELECT d.id, d.report_date, d.run_id, d.status, d.task_id, d.failure_type, d.created_at,
           r.display_name, count(i.event_id)::int AS event_count
    FROM notification_dispatches d
    JOIN notification_recipients r ON r.id = d.recipient_id
    LEFT JOIN notification_delivery_items i ON i.dispatch_id = d.id
    GROUP BY d.id, r.display_name
    ORDER BY d.created_at DESC LIMIT 100
  `;
  const audits = await sql`
    SELECT id, action, target_type, target_id, detail_json, created_at
    FROM notification_audit_logs ORDER BY created_at DESC LIMIT 100
  `;
  return { authenticated: true, csrf_token: csrfToken, catalog: loadCatalog(), recipients, rules, dispatches, audits };
}

function validateRule(body, catalog) {
  const platforms = new Set(catalog.platforms.map((item) => item.code));
  const tags = new Set(catalog.primary_tags.map((item) => item.code));
  const platform = clean(body.platform_code, 80);
  const tag = clean(body.primary_tag_code, 80);
  if (platform !== "*" && !platforms.has(platform)) throw new Error("unknown platform rule");
  if (tag !== "*" && !tags.has(tag)) throw new Error("unknown primary-tag rule");
  if (!platform || !tag) throw new Error("platform and primary tag are required");
  return { platform, tag };
}

async function mutate(req, res, action, session) {
  verifyOrigin(req);
  requireAdmin(req, { csrf: true });
  const sql = database();
  const body = await bodyObject(req);
  if (action === "save_recipient") {
    const id = clean(body.id, 80) || crypto.randomUUID();
    const displayName = clean(body.display_name, 120);
    const userId = clean(body.dingtalk_user_id, 180);
    const source = body.source === "directory" ? "directory" : "manual";
    if (!displayName || !userId) throw new Error("display name and DingTalk userId are required");
    await sql`
      INSERT INTO notification_recipients (id, display_name, dingtalk_user_id, source, enabled)
      VALUES (${id}, ${displayName}, ${userId}, ${source}, ${body.enabled !== false})
      ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name,
        dingtalk_user_id = EXCLUDED.dingtalk_user_id, source = EXCLUDED.source,
        enabled = EXCLUDED.enabled, updated_at = now()
    `;
    await audit(sql, "save", "recipient", id, { source, enabled: body.enabled !== false });
  } else if (action === "save_rule") {
    const id = clean(body.id, 80) || crypto.randomUUID();
    const recipientId = clean(body.recipient_id, 80);
    const { platform, tag } = validateRule(body, loadCatalog());
    await sql`
      INSERT INTO notification_rules (id, recipient_id, platform_code, primary_tag_code, enabled)
      VALUES (${id}, ${recipientId}, ${platform}, ${tag}, ${body.enabled !== false})
      ON CONFLICT (recipient_id, platform_code, primary_tag_code) DO UPDATE SET
        enabled = EXCLUDED.enabled, updated_at = now()
    `;
    await audit(sql, "save", "rule", id, { recipient_id: recipientId, platform_code: platform, primary_tag_code: tag });
  } else if (action === "toggle_recipient") {
    const id = clean(body.id, 80);
    await sql`UPDATE notification_recipients SET enabled = ${Boolean(body.enabled)}, updated_at = now() WHERE id = ${id}`;
    await audit(sql, "toggle", "recipient", id, { enabled: Boolean(body.enabled) });
  } else if (action === "toggle_rule") {
    const id = clean(body.id, 80);
    await sql`UPDATE notification_rules SET enabled = ${Boolean(body.enabled)}, updated_at = now() WHERE id = ${id}`;
    await audit(sql, "toggle", "rule", id, { enabled: Boolean(body.enabled) });
  } else if (action === "test_notification") {
    const recipientId = clean(body.recipient_id, 80);
    const recipientRows = await sql`
      SELECT id, display_name, dingtalk_user_id FROM notification_recipients WHERE id = ${recipientId} AND enabled = true
    `;
    const recipient = recipientRows[0];
    if (!recipient) throw new Error("test recipient is not available");
    const allowedTestUser = clean(process.env.DINGTALK_TEST_USER_ID, 180);
    if (!allowedTestUser || recipient.dingtalk_user_id !== allowedTestUser) {
      throw new Error("recipient is not the designated DINGTALK_TEST_USER_ID");
    }
    const catalog = loadCatalog();
    const exampleEvents = catalog.platforms.slice(0, 3).map((platform, index) => ({
      event_id: `test-${index + 1}`,
      content_hash: "0".repeat(64),
      platform_code: platform.code,
      platform_label: platform.label,
      primary_tag_code: catalog.primary_tags[index % catalog.primary_tags.length].code,
      primary_tag_label: catalog.primary_tags[index % catalog.primary_tags.length].label,
      ai_summary_zh: `这是第 ${index + 1} 条聚合通知测试内容，仅用于验证平台、标签与收件人路由。`,
      recommended_action: "请确认收到的测试通知格式，不需要处理业务变更。",
      change_url: String(process.env.PUBLIC_REPORT_URL || "https://example.invalid/reports/latest"),
    }));
    const message = buildTestMarkdownNotification(
      { ...recipient, events: exampleEvents },
      { report_date: new Date().toISOString().slice(0, 10), report_url: String(process.env.PUBLIC_REPORT_URL || "https://example.invalid/reports/latest") },
    );
    const delivery = await sendAndPoll(recipient.dingtalk_user_id, message);
    await audit(sql, "test_notification", "recipient", recipientId, { status: delivery.status, task_id: delivery.task_id || "" });
    return json(res, 200, { ok: true, status: delivery.status, task_id: delivery.task_id || "" });
  } else {
    return json(res, 404, { error: "unknown_action" });
  }
  return json(res, 200, await state(sql, session.csrf));
}

export default async function handler(req, res) {
  const action = actionOf(req);
  try {
    if (req.method === "POST" && action === "login") return await login(req, res);
    if (req.method === "POST" && action === "logout") {
      verifyOrigin(req);
      requireAdmin(req, { csrf: true });
      return json(res, 200, { authenticated: false }, { "Set-Cookie": clearSessionCookie() });
    }
    const session = requireAdmin(req);
    if (req.method === "GET" && action === "session") return json(res, 200, await state(database(), session.csrf));
    if (req.method === "GET" && action === "directory") {
      const query = new URL(req.url, "https://local.invalid").searchParams.get("q") || "";
      return json(res, 200, { people: await searchDirectory(query) });
    }
    if (req.method === "POST") return await mutate(req, res, action, session);
    return json(res, 405, { error: "method_not_allowed" });
  } catch (error) {
    return json(res, Number(error?.statusCode || 400), {
      error: String(error?.message || "request failed").slice(0, 300),
      failure_type: String(error?.failureType || "request_failed").slice(0, 80),
    });
  }
}
