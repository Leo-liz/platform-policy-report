import test from "node:test";
import assert from "node:assert/strict";
import { parseDwsPeople, searchLocalDirectory } from "../lib/local-dws.js";

test("dws person search maps only name and userId and deduplicates recipients", () => {
  const people = parseDwsPeople({
    success: true,
    result: [
      { meta: { name: "张三", position: "开发" }, userId: "user-1", orgAuthEmail: "private@example.com" },
      { meta: { name: "张三" }, userId: "user-1" },
      { meta: { name: "无 ID" } },
    ],
  });
  assert.deepEqual(people, [{ display_name: "张三", dingtalk_user_id: "user-1", source: "directory" }]);
  assert.doesNotMatch(JSON.stringify(people), /position|email/i);
});

test("local directory search invokes the verified dws command without a shell", async () => {
  let invocation;
  const people = await searchLocalDirectory("张三", async (...args) => {
    invocation = args;
    return { stdout: JSON.stringify({ success: true, result: [{ meta: { name: "张三" }, userId: "user-1" }] }) };
  });
  assert.equal(people.length, 1);
  assert.deepEqual(invocation[1], [
    "aisearch", "person", "--keyword", "张三", "--dimension", "name", "--format", "json", "--timeout", "30",
  ]);
  assert.equal(invocation[2].windowsHide, true);
  assert.equal(invocation[2].shell, undefined);
});

test("local directory search fails closed when dws is unavailable", async () => {
  await assert.rejects(
    () => searchLocalDirectory("张三", async () => { throw new Error("offline"); }),
    /重新登录或手工填写/,
  );
});
