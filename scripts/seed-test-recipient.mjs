import { database } from "../lib/db.js";
import { testSubscriptionIdentity, wildcardRuleId } from "../lib/setup.js";

const { userId, displayName, recipientId: stableId } = testSubscriptionIdentity(
  process.env.DINGTALK_TEST_USER_ID,
  process.env.DINGTALK_TEST_DISPLAY_NAME,
);
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

const ruleId = wildcardRuleId(rows[0].id);
await sql`
  INSERT INTO notification_rules
    (id, recipient_id, platform_code, primary_tag_code, platform_codes, primary_tag_codes, enabled)
  VALUES (${ruleId}, ${rows[0].id}, '*', '*', '["*"]'::jsonb, '["*"]'::jsonb, true)
  ON CONFLICT (recipient_id, platform_codes, primary_tag_codes) DO UPDATE SET
    enabled = true,
    updated_at = now()
`;

await sql`
  INSERT INTO notification_audit_logs (actor, action, target_type, target_id, detail_json)
  VALUES ('setup', 'seed_test_subscription', 'recipient', ${rows[0].id}, ${JSON.stringify({ enabled: true, platform_code: "*", primary_tag_code: "*" })}::jsonb)
`;

process.stdout.write(JSON.stringify({ ok: true, recipient_seeded: true, wildcard_rule_seeded: true }));
