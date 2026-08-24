import test from "node:test";
import assert from "node:assert/strict";
import { testSubscriptionIdentity, wildcardRuleId } from "../lib/setup.js";

test("test subscription identity is deterministic and does not expose the userId in database ids", () => {
  const first = testSubscriptionIdentity("private-user-id", "测试负责人");
  const second = testSubscriptionIdentity("private-user-id", "测试负责人");
  assert.deepEqual(first, second);
  assert.equal(first.displayName, "测试负责人");
  assert.equal(first.recipientId.includes("private-user-id"), false);
  assert.equal(wildcardRuleId(first.recipientId).includes("private-user-id"), false);
});

test("test subscription identity rejects an empty recipient", () => {
  assert.throws(() => testSubscriptionIdentity(""), /DINGTALK_TEST_USER_ID/);
});
