function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function decode(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || Number(data.errcode || 0) !== 0) {
    const code = data.code || data.errcode || response.status;
    const message = data.message || data.errmsg || response.statusText || "DingTalk request failed";
    throw Object.assign(new Error(`DingTalk ${code}: ${message}`), { failureType: `dingtalk_${code}` });
  }
  return data;
}

export async function accessToken(fetcher = fetch) {
  const response = await fetcher("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey: required("DINGTALK_APP_KEY"), appSecret: required("DINGTALK_APP_SECRET") }),
  });
  const data = await decode(response);
  if (!data.accessToken) throw new Error("DingTalk access token is missing");
  return data.accessToken;
}

export async function searchDirectory(query, fetcher = fetch) {
  const keyword = String(query || "").trim().toLocaleLowerCase("zh-CN");
  if (keyword.length < 1) return [];
  const token = await accessToken(fetcher);
  const departments = String(process.env.DINGTALK_DIRECTORY_DEPARTMENT_IDS || "1")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
  const found = new Map();
  for (const departmentId of departments) {
    let nextToken = "";
    for (let page = 0; page < 5; page += 1) {
      const url = new URL(`https://api.dingtalk.com/v1.0/contact/departments/${encodeURIComponent(departmentId)}/users`);
      url.searchParams.set("maxResults", "100");
      if (nextToken) url.searchParams.set("nextToken", nextToken);
      const response = await fetcher(url, { headers: { "x-acs-dingtalk-access-token": token } });
      const data = await decode(response);
      const list = Array.isArray(data.list) ? data.list : Array.isArray(data.result?.list) ? data.result.list : [];
      for (const user of list) {
        const name = String(user.name || user.displayName || "").trim();
        const userId = String(user.userId || user.userid || "").trim();
        if (name && userId && name.toLocaleLowerCase("zh-CN").includes(keyword)) {
          found.set(userId, { display_name: name, dingtalk_user_id: userId, source: "directory" });
        }
      }
      nextToken = String(data.nextToken || data.result?.nextToken || "");
      if (!nextToken) break;
    }
  }
  return [...found.values()].slice(0, 30);
}

export async function sendWorkNotification(userId, message, fetcher = fetch) {
  const token = await accessToken(fetcher);
  const response = await fetcher(
    `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: Number(required("DINGTALK_AGENT_ID")),
        userid_list: String(userId),
        msg: { msgtype: "markdown", markdown: { title: message.title, text: message.text } },
      }),
    },
  );
  const data = await decode(response);
  return { task_id: String(data.task_id || ""), response: data };
}

export async function queryWorkNotification(taskId, fetcher = fetch) {
  const token = await accessToken(fetcher);
  const response = await fetcher(
    `https://oapi.dingtalk.com/topapi/message/corpconversation/getsendresult?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: Number(required("DINGTALK_AGENT_ID")), task_id: Number(taskId) }),
    },
  );
  return decode(response);
}

export async function sendAndPoll(userId, message, fetcher = fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  const accepted = await sendWorkNotification(userId, message, fetcher);
  if (!accepted.task_id) return { status: "accepted", ...accepted, poll: null };
  let poll = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await wait(800 * (attempt + 1));
    try {
      poll = await queryWorkNotification(accepted.task_id, fetcher);
      const result = poll.send_result || poll.sendResult || poll;
      const failed = [
        ...(result.failed_user_id_list || result.failedUserIdList || []),
        ...(result.invalid_user_id_list || result.invalidUserIdList || []),
        ...(result.forbidden_user_id_list || result.forbiddenUserIdList || []),
      ];
      if (failed.length) return { status: "failed", ...accepted, poll, failure_type: "recipient_rejected" };
      const success = result.success_user_id_list || result.successUserIdList;
      if (Array.isArray(success) && success.includes(String(userId))) {
        return { status: "delivered", ...accepted, poll };
      }
    } catch (error) {
      poll = { error: String(error?.message || error) };
    }
  }
  return { status: "accepted", ...accepted, poll };
}
