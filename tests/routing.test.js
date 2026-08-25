import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMarkdownNotification,
  buildPublicReportSnapshot,
  buildTestMarkdownNotification,
  routeEvents,
  ruleMatches,
  validateDispatchPayload,
} from "../lib/routing.js";

const catalog = {
  taxonomy_version: "v1",
  platforms: [{ code: "temu", label: "Temu" }, { code: "ozon", label: "Ozon" }, { code: "shopify", label: "Shopify" }],
  primary_tags: [{ code: "logistics_fulfillment", label: "物流/履约" }, { code: "api_technical", label: "API/技术" }],
};
const event = (platform_code, primary_tag_code, index) => ({
  event_id: `event-${index}`,
  content_hash: String(index).padStart(64, "0"),
  platform_code,
  platform_label: platform_code,
  primary_tag_code,
  primary_tag_label: primary_tag_code,
  status: "actionable_late_discovery",
  ai_summary_zh: "正文确认该接口发生变化，调用方需要调整处理逻辑。正文未写明完整截止日期，需人工确认。",
  recommended_action: "核对现有调用并安排回归测试。",
  change_url: "https://example.com/change",
});

test("wildcard and exact routing rules work", () => {
  assert.equal(ruleMatches(event("temu", "api_technical", 1), { platform_code: "temu", primary_tag_code: "*" }), true);
  assert.equal(ruleMatches(event("ozon", "api_technical", 2), { platform_code: "*", primary_tag_code: "api_technical" }), true);
  assert.equal(ruleMatches(event("ozon", "api_technical", 3), { platform_code: "temu", primary_tag_code: "api_technical" }), false);
});

test("multiple rules and platforms aggregate once per recipient", () => {
  const events = [event("temu", "api_technical", 1), event("ozon", "api_technical", 2), event("shopify", "logistics_fulfillment", 3)];
  const base = { recipient_id: "r1", display_name: "测试人", dingtalk_user_id: "u1", enabled: true, recipient_enabled: true };
  const rules = [
    { ...base, platform_code: "*", primary_tag_code: "api_technical" },
    { ...base, platform_code: "temu", primary_tag_code: "*" },
    { ...base, platform_code: "shopify", primary_tag_code: "logistics_fulfillment" },
  ];
  const routed = routeEvents(events, rules);
  assert.equal(routed.length, 1);
  assert.equal(routed[0].events.length, 3);
  const message = buildMarkdownNotification(routed[0], { report_date: "2026-08-22", report_url: "https://example.com/reports/latest" });
  assert.match(message.text, /共命中 3 条/);
});

test("test notification is unmistakably marked and still aggregated", () => {
  const events = [
    event("temu", "api_technical", 1),
    event("ozon", "api_technical", 2),
    event("shopify", "logistics_fulfillment", 3),
  ];
  const message = buildTestMarkdownNotification(
    { recipient_id: "r1", events },
    { report_date: "2026-08-24", report_url: "https://example.com/reports/latest" },
  );
  assert.equal(message.title, "平台政策通知测试");
  assert.match(message.text, /【测试】平台政策聚合工作通知/);
  assert.match(message.text, /共命中 3 条/);
});

test("dispatch validation rejects unknown tags and untrusted AI", () => {
  const base = {
    run_id: "20260822-010000",
    report_date: "2026-08-22",
    report_url: "https://example.com/reports/latest",
    taxonomy_version: "v1",
    ai: { provider: "codex_builtin_postprocess", model: "current_codex_thread", summary_schema_version: 11, evidence_validated: true },
    events: [event("temu", "api_technical", 1)],
  };
  assert.equal(validateDispatchPayload(base, catalog).events.length, 1);
  assert.throws(() => validateDispatchPayload({ ...base, events: [event("temu", "unknown", 2)] }, catalog), /unknown primary tag/);
  assert.throws(() => validateDispatchPayload({ ...base, ai: { ...base.ai, evidence_validated: false } }, catalog), /schema 11/);
});

test("public report snapshot exposes display names and exact delivery facts only", () => {
  const events = [event("temu", "api_technical", 1), event("ozon", "api_technical", 2)];
  const base = {
    recipient_id: "private-r1",
    display_name: "测试同事",
    dingtalk_user_id: "private-user-id",
    enabled: true,
    recipient_enabled: true,
  };
  const routed = routeEvents(events, [
    { ...base, platform_code: "*", primary_tag_code: "api_technical" },
  ]);
  const snapshot = buildPublicReportSnapshot(
    { run_id: "20260825-010000", report_date: "2026-08-24", events },
    routed,
    [{
      recipient_id: "private-r1",
      event_id: events[0].event_id,
      content_hash: events[0].content_hash,
      status: "delivered",
      delivered_at: "2026-08-24T17:08:09.000Z",
    }],
    new Date("2026-08-24T17:10:00.000Z"),
  );
  assert.deepEqual(snapshot.events[0].owners, [{
    display_name: "测试同事",
    notification_status: "delivered",
    notified_at: "2026-08-24T17:08:09.000Z",
  }]);
  assert.equal(snapshot.events[1].owners[0].notification_status, "deferred");
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /private-r1|private-user-id|recipient_id|dingtalk_user_id/);
});
