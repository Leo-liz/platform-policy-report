import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function dwsExecutable() {
  if (process.env.DWS_EXE) return process.env.DWS_EXE;
  const userProfile = String(process.env.USERPROFILE || "");
  const installed = userProfile ? path.join(userProfile, ".local", "bin", "dws.exe") : "";
  return installed && existsSync(installed) ? installed : "dws.exe";
}

export function parseDwsPeople(payload) {
  if (payload?.success !== true || !Array.isArray(payload.result)) return [];
  const people = new Map();
  for (const item of payload.result) {
    const displayName = String(item?.meta?.name || item?.title || "").trim().slice(0, 120);
    const userId = String(item?.userId || "").trim().slice(0, 180);
    if (!displayName || !userId || people.has(userId)) continue;
    people.set(userId, { display_name: displayName, dingtalk_user_id: userId, source: "directory" });
    if (people.size >= 20) break;
  }
  return [...people.values()];
}

export async function searchLocalDirectory(value, runner = execFileAsync) {
  const keyword = String(value || "").trim().slice(0, 80);
  if (!keyword) return [];
  try {
    const { stdout } = await runner(
      dwsExecutable(),
      ["aisearch", "person", "--keyword", keyword, "--dimension", "name", "--format", "json", "--timeout", "30"],
      { windowsHide: true, timeout: 45_000, maxBuffer: 1024 * 1024, encoding: "utf8" },
    );
    const people = parseDwsPeople(JSON.parse(stdout));
    return people.filter((person) => person.display_name.includes(keyword));
  } catch (cause) {
    const error = new Error("dws 通讯录搜索失败，请重新登录或手工填写 userId");
    error.statusCode = 503;
    error.failureType = "local_directory_unavailable";
    error.cause = cause;
    throw error;
  }
}
