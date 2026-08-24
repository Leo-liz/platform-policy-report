import crypto from "node:crypto";
import { database } from "../lib/db.js";

const userId = String(process.env.DINGTALK_TEST_USER_ID || "").trim();
if (!userId) throw new Error("DINGTALK_TEST_USER_ID is not configured");

const displayName = String(process.env.DINGTALK_TEST_DISPLAY_NAME || "测试收件人").trim().slice(0, 120);
const stableId = `test-${crypto.createHash("sha256").update(userId).digest("hex").slice(0, 24)}`;
const sql = database();

const rows = await sql`
  INSERT INTO notification_recipients (id, display_name, dingtalk_user_id, source, enabled)
  VALUES (${stableId}, ${displayName}, ${userId}, 'manual', true)
  ON CONFLICT (dingtalk_user_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    enabled = true,
    updated_at = now()
  RETURNING id
`;

await sql`
  INSERT INTO notification_audit_logs (actor, action, target_type, target_id, detail_json)
  VALUES ('setup', 'seed_test_recipient', 'recipient', ${rows[0].id}, ${JSON.stringify({ enabled: true })}::jsonb)
`;

process.stdout.write(JSON.stringify({ ok: true, recipient_seeded: true }));
