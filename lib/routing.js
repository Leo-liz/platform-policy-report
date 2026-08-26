import crypto from "node:crypto";
import { RULE_WILDCARD, storedRuleScope } from "./rule-scopes.js";

export const NOTIFIABLE_STATUSES = new Set([
  "actionable_today",
  "actionable_late_discovery",
  "changed_date_unresolved",
]);

export function ruleMatches(event, rule) {
  const platforms = storedRuleScope(rule, "platform_codes", "platform_code");
  const primaryTags = storedRuleScope(rule, "primary_tag_codes", "primary_tag_code");
  return (
    (platforms.includes(RULE_WILDCARD) || platforms.includes(event.platform_code)) &&
    (primaryTags.includes(RULE_WILDCARD) || primaryTags.includes(event.primary_tag_code))
  );
}

export function routeEvents(events, rules) {
  const routed = new Map();
  for (const rule of rules) {
    if (!rule.enabled || !rule.recipient_enabled) continue;
    for (const event of events) {
      if (!ruleMatches(event, rule)) continue;
      const recipientId = rule.recipient_id;
      if (!routed.has(recipientId)) {
        routed.set(recipientId, {
          recipient_id: recipientId,
          display_name: rule.display_name,
          dingtalk_user_id: rule.dingtalk_user_id,
          events: new Map(),
        });
      }
      const key = `${event.event_id}:${event.content_hash}`;
      routed.get(recipientId).events.set(key, event);
    }
  }
  return [...routed.values()]
    .map((item) => ({ ...item, events: [...item.events.values()] }))
    .filter((item) => item.events.length > 0);
}

export function buildPublicReportSnapshot(payload, routedRecipients, deliveryRows, now = new Date()) {
  const deliveryByKey = new Map();
  for (const row of deliveryRows || []) {
    const key = `${row.recipient_id || ""}:${row.event_id || ""}:${row.content_hash || ""}`;
    deliveryByKey.set(key, row);
  }
  const events = (payload.events || []).map((event) => {
    const owners = [];
    for (const recipient of routedRecipients || []) {
      const matches = (recipient.events || []).some(
        (candidate) =>
          candidate.event_id === event.event_id && candidate.content_hash === event.content_hash,
      );
      if (!matches) continue;
      const delivery = deliveryByKey.get(
        `${recipient.recipient_id}:${event.event_id}:${event.content_hash}`,
      );
      const status = String(delivery?.status || "deferred");
      owners.push({
        display_name: String(recipient.display_name || "").trim(),
        notification_status: ["delivered", "accepted", "pending", "failed"].includes(status)
          ? status
          : "deferred",
        notified_at:
          status === "delivered"
            ? String(delivery?.delivered_at || delivery?.updated_at || "")
            : "",
      });
    }
    owners.sort((left, right) => left.display_name.localeCompare(right.display_name, "zh-CN"));
    return {
      event_id: event.event_id,
      content_hash: event.content_hash,
      owners,
    };
  });
  return {
    schema_version: 1,
    run_id: payload.run_id,
    report_date: payload.report_date,
    generated_at: now.toISOString(),
    source: "verified_dingtalk_dispatch_snapshot",
    events,
  };
}

export function validateDispatchPayload(payload, catalog) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("payload must be an object");
  if (!/^\d{8}-\d{6}$/.test(String(payload.run_id || ""))) throw new Error("run_id is invalid");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.report_date || ""))) throw new Error("report_date is invalid");
  if (!/^https:\/\//.test(String(payload.report_url || ""))) throw new Error("report_url must use https");
  if (String(payload.taxonomy_version || "") !== String(catalog.taxonomy_version || "")) {
    throw new Error("taxonomy_version does not match the deployed catalog");
  }
  const platformCodes = new Set(catalog.platforms.map((item) => item.code));
  const primaryTagCodes = new Set(catalog.primary_tags.map((item) => item.code));
  const ai = payload.ai || {};
  if (!String(ai.provider || "").startsWith("codex_builtin") || ai.model !== "current_codex_thread") {
    throw new Error("dispatch requires trusted Codex AI metadata");
  }
  if (Number(ai.summary_schema_version || 0) < 11 || ai.evidence_validated !== true) {
    throw new Error("dispatch requires schema 11 and evidence validation");
  }
  if (!Array.isArray(payload.events)) throw new Error("events must be an array");
  const seen = new Set();
  const events = payload.events.map((raw) => {
    const event = {
      event_id: String(raw.event_id || "").trim(),
      content_hash: String(raw.content_hash || "").trim(),
      platform_code: String(raw.platform_code || "").trim(),
      platform_label: String(raw.platform_label || "").trim(),
      primary_tag_code: String(raw.primary_tag_code || "").trim(),
      primary_tag_label: String(raw.primary_tag_label || "").trim(),
      status: String(raw.status || "").trim(),
      ai_summary_zh: String(raw.ai_summary_zh || "").trim(),
      recommended_action: String(raw.recommended_action || "").trim(),
      official_date: String(raw.official_date || "").trim(),
      change_url: String(raw.change_url || "").trim(),
    };
    if (!event.event_id || !/^[0-9a-f]{64}$/i.test(event.content_hash)) throw new Error("event identity is incomplete");
    if (!platformCodes.has(event.platform_code)) throw new Error(`unknown platform: ${event.platform_code}`);
    if (!primaryTagCodes.has(event.primary_tag_code)) throw new Error(`unknown primary tag: ${event.primary_tag_code}`);
    if (!NOTIFIABLE_STATUSES.has(event.status)) throw new Error(`event status is not notifiable: ${event.status}`);
    if (!event.ai_summary_zh || event.ai_summary_zh.includes("AI 未配置")) throw new Error("trusted Chinese AI summary is required");
    if (!event.recommended_action || !/^https:\/\//.test(event.change_url)) throw new Error("action and official change link are required");
    const key = `${event.event_id}:${event.content_hash}`;
    if (seen.has(key)) throw new Error(`duplicate event: ${event.event_id}`);
    seen.add(key);
    return event;
  });
  return { ...payload, events };
}

export function buildMarkdownNotification(recipient, payload, maxChars = 12000) {
  const sorted = [...recipient.events].sort((a, b) =>
    `${a.platform_label}:${a.primary_tag_label}:${a.event_id}`.localeCompare(
      `${b.platform_label}:${b.primary_tag_label}:${b.event_id}`,
      "zh-CN",
    ),
  );
  const header = `### 平台政策变更日报（${payload.report_date}）\n\n共命中 ${sorted.length} 条需要处理的变更。`;
  const blocks = sorted.map(
    (event, index) =>
      `\n\n**${index + 1}. ${event.platform_label}｜${event.primary_tag_label}**\n\n` +
      `${event.ai_summary_zh}\n\n建议：${event.recommended_action}\n\n[查看变更](${event.change_url})`,
  );
  const footer = `\n\n[查看完整日报](${payload.report_url})`;
  let text = header + blocks.join("") + footer;
  if (text.length > maxChars) {
    const counts = new Map();
    for (const event of sorted) counts.set(event.platform_label, (counts.get(event.platform_label) || 0) + 1);
    const summary = [...counts].map(([label, count]) => `${label} ${count} 条`).join("、");
    const compact = sorted.slice(0, 8).map(
      (event, index) => `\n\n${index + 1}. **${event.platform_label}｜${event.primary_tag_label}**：${event.ai_summary_zh.slice(0, 180)}`,
    );
    text = `${header}\n\n平台统计：${summary}${compact.join("")}\n\n内容较多，完整变更与建议请查看日报：${payload.report_url}`;
  }
  return { title: `平台政策变更日报 ${payload.report_date}`, text };
}

export function buildTestMarkdownNotification(recipient, payload) {
  const message = buildMarkdownNotification(recipient, payload);
  return {
    title: "平台政策通知测试",
    text: message.text.replace(
      /^### 平台政策变更日报/u,
      "### 【测试】平台政策聚合工作通知",
    ),
  };
}

export function payloadHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
