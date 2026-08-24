import crypto from "node:crypto";

export function testSubscriptionIdentity(userIdValue, displayNameValue = "测试收件人") {
  const userId = String(userIdValue || "").trim();
  if (!userId) throw new Error("DINGTALK_TEST_USER_ID is not configured");
  const displayName = String(displayNameValue || "测试收件人").trim().slice(0, 120) || "测试收件人";
  const recipientId = `test-${crypto.createHash("sha256").update(userId).digest("hex").slice(0, 24)}`;
  return { userId, displayName, recipientId };
}

export function wildcardRuleId(recipientIdValue) {
  const recipientId = String(recipientIdValue || "").trim();
  if (!recipientId) throw new Error("recipient id is required");
  return `all-${crypto.createHash("sha256").update(recipientId).digest("hex").slice(0, 24)}`;
}
