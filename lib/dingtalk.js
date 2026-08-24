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

function directoryUnavailable(cause) {
  const error = new Error("通讯录读取范围未覆盖已配置部门，请在钉钉应用中扩大通讯录可见范围，或手工填写 userId");
  error.failureType = "directory_scope_unavailable";
  error.statusCode = 503;
  error.cause = cause;
  return error;
}

async function legacyCall(path, token, body, fetcher) {
  const response = await fetcher(
    `https://oapi.dingtalk.com${path}?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return decode(response);
}

export async function searchDirectory(query, fetcher = fetch) {
  const keyword = String(query || "").trim().toLocaleLowerCase("zh-CN");
  if (keyword.length < 1) return [];
  const token = await accessToken(fetcher);
  const found = new Map();

  const departments = String(process.env.DINGTALK_DIRECTORY_DEPARTMENT_IDS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (!departments.length) throw directoryUnavailable(new Error("DINGTALK_DIRECTORY_DEPARTMENT_IDS is not configured"));

  // The server-side directory APIs only return departments inside the app's
  // configured visibility scope. Walk from explicitly authorized department
  // roots, then filter names locally. A 50004 response is surfaced instead of
  // silently pretending that no employee matched.
  const queue = [...departments];
  const visited = new Set();
  try {
    while (queue.length && visited.size < 200) {
      const departmentId = queue.shift();
      if (!departmentId || visited.has(departmentId)) continue;
      visited.add(departmentId);

      const childData = await legacyCall("/topapi/v2/department/listsubid", token, { dept_id: departmentId }, fetcher);
      const children = Array.isArray(childData.result?.dept_id_list) ? childData.result.dept_id_list : [];
      for (const child of children) {
        const id = String(child || "").trim();
        if (id && !visited.has(id)) queue.push(id);
      }

      let cursor = 0;
      for (let page = 0; page < 20; page += 1) {
        const data = await legacyCall(
          "/topapi/user/listsimple",
          token,
          { dept_id: departmentId, cursor, size: 100 },
          fetcher,
        );
        const list = Array.isArray(data.result?.list) ? data.result.list : [];
        for (const user of list) {
          const name = String(user.name || "").trim();
          const userId = String(user.userid || user.userId || "").trim();
          if (name && userId && name.toLocaleLowerCase("zh-CN").includes(keyword)) {
            found.set(userId, { display_name: name, dingtalk_user_id: userId, source: "directory" });
          }
        }
        if (!data.result?.has_more) break;
        cursor = Number(data.result?.next_cursor);
        if (!Number.isFinite(cursor)) break;
      }
    }
  } catch (error) {
    throw directoryUnavailable(error);
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

function userIdList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (Array.isArray(value?.string)) return value.string.map(String);
  return [];
}

export async function pollWorkNotification(
  taskId,
  userId,
  fetcher = fetch,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  if (!taskId) return { status: "accepted", task_id: "", poll: null };
  let poll = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await wait(800 * (attempt + 1));
    try {
      poll = await queryWorkNotification(taskId, fetcher);
      const result = poll.send_result || poll.sendResult || poll;
      const failed = [
        ...userIdList(result.failed_user_id_list || result.failedUserIdList),
        ...userIdList(result.invalid_user_id_list || result.invalidUserIdList),
        ...userIdList(result.forbidden_user_id_list || result.forbiddenUserIdList),
        ...(Array.isArray(result.forbidden_list || result.forbiddenList)
          ? (result.forbidden_list || result.forbiddenList).map((item) => String(item?.userid || item?.userId || ""))
          : []),
      ];
      if (failed.includes(String(userId))) {
        return { status: "failed", task_id: String(taskId), poll, failure_type: "recipient_rejected" };
      }
      // DingTalk's send-result API proves delivery through the read and unread
      // recipient lists. API acceptance alone is not treated as delivery.
      const delivered = [
        ...userIdList(result.read_user_id_list || result.readUserIdList),
        ...userIdList(result.unread_user_id_list || result.unreadUserIdList),
      ];
      if (delivered.includes(String(userId))) {
        return { status: "delivered", task_id: String(taskId), poll };
      }
    } catch (error) {
      poll = { error: String(error?.message || error) };
    }
  }
  return { status: "accepted", task_id: String(taskId), poll };
}

export async function sendAndPoll(userId, message, fetcher = fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  const accepted = await sendWorkNotification(userId, message, fetcher);
  if (!accepted.task_id) return { status: "accepted", ...accepted, poll: null };
  const delivery = await pollWorkNotification(accepted.task_id, userId, fetcher, wait);
  return { ...accepted, ...delivery };
}
