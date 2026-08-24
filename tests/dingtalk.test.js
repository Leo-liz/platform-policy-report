import test from "node:test";
import assert from "node:assert/strict";
import { pollWorkNotification, searchDirectory, sendAndPoll } from "../lib/dingtalk.js";

process.env.DINGTALK_APP_KEY = "test-app-key";
process.env.DINGTALK_APP_SECRET = "test-app-secret";
process.env.DINGTALK_AGENT_ID = "1001";

function jsonResponse(value, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Forbidden",
    json: async () => value,
  };
}

test("directory search walks authorized departments and filters employees by name", async () => {
  const previous = process.env.DINGTALK_DIRECTORY_DEPARTMENT_IDS;
  process.env.DINGTALK_DIRECTORY_DEPARTMENT_IDS = "20";
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return jsonResponse({ accessToken: "token" });
    if (calls.length === 2) return jsonResponse({ errcode: 0, result: { dept_id_list: [21] } });
    if (calls.length === 3) return jsonResponse({ errcode: 0, result: { list: [{ userid: "u-1", name: "测试人员" }], has_more: false } });
    if (calls.length === 4) return jsonResponse({ errcode: 0, result: { dept_id_list: [] } });
    return jsonResponse({ errcode: 0, result: { list: [{ userid: "u-2", name: "无关人员" }], has_more: false } });
  };
  try {
    const people = await searchDirectory("测试", fetcher);
    assert.deepEqual(people, [{ display_name: "测试人员", dingtalk_user_id: "u-1", source: "directory" }]);
    assert.match(calls[1].url, /\/topapi\/v2\/department\/listsubid/);
    assert.deepEqual(JSON.parse(calls[1].options.body), { dept_id: "20" });
    assert.match(calls[2].url, /\/topapi\/user\/listsimple/);
  } finally {
    if (previous === undefined) delete process.env.DINGTALK_DIRECTORY_DEPARTMENT_IDS;
    else process.env.DINGTALK_DIRECTORY_DEPARTMENT_IDS = previous;
  }
});

test("directory search reports authorization-scope failures without pretending there are no matches", async () => {
  const previous = process.env.DINGTALK_DIRECTORY_DEPARTMENT_IDS;
  process.env.DINGTALK_DIRECTORY_DEPARTMENT_IDS = "1";
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) return jsonResponse({ accessToken: "token" });
    return jsonResponse({ errcode: 50004, errmsg: "department outside authorization scope" });
  };
  try {
    await assert.rejects(
      () => searchDirectory("测试", fetcher),
      (error) => error.failureType === "directory_scope_unavailable" && error.statusCode === 503,
    );
    assert.equal(calls.length, 2);
  } finally {
    if (previous === undefined) delete process.env.DINGTALK_DIRECTORY_DEPARTMENT_IDS;
    else process.env.DINGTALK_DIRECTORY_DEPARTMENT_IDS = previous;
  }
});

test("polling an existing task verifies delivery without sending a second notification", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) return jsonResponse({ accessToken: "token" });
    return jsonResponse({ errcode: 0, send_result: { success_user_id_list: ["u-1"] } });
  };
  const delivery = await pollWorkNotification("123", "u-1", fetcher, async () => {});
  assert.equal(delivery.status, "delivered");
  assert.equal(delivery.task_id, "123");
  assert.equal(calls.filter((url) => url.includes("asyncsend_v2")).length, 0);
  assert.equal(calls.filter((url) => url.includes("getsendresult")).length, 1);
});

test("send and poll distinguishes API acceptance from verified delivery", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (calls.length === 1 || calls.length === 3) return jsonResponse({ accessToken: "token" });
    if (calls.length === 2) return jsonResponse({ errcode: 0, task_id: 456 });
    return jsonResponse({ errcode: 0, send_result: { success_user_id_list: ["u-1"] } });
  };
  const delivery = await sendAndPoll(
    "u-1",
    { title: "测试", text: "测试内容" },
    fetcher,
    async () => {},
  );
  assert.equal(delivery.status, "delivered");
  assert.equal(delivery.task_id, "456");
  assert.equal(calls.filter((url) => url.includes("asyncsend_v2")).length, 1);
  assert.equal(calls.filter((url) => url.includes("getsendresult")).length, 1);
});
