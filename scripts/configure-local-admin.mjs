import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { hashPassword, verifyPassword } from "../lib/security.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privateEnvPath = path.join(root, ".env.admin.local");

export function parsePrivateEnv(source) {
  const values = new Map();
  for (const rawLine of String(source || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    values.set(line.slice(0, index).trim(), line.slice(index + 1));
  }
  return values;
}

export function serializePrivateEnv(values) {
  return [...values.entries()].map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
}

export function buildDedicatedDatabaseUrl(connection, password) {
  if (connection?.username !== "platform_policy_local_admin_v2") throw new Error("unexpected local database role");
  if (!connection.host || !connection.database) throw new Error("connection metadata is incomplete");
  const url = new URL("postgresql://localhost");
  url.username = connection.username;
  url.password = password;
  url.hostname = connection.host;
  url.port = String(connection.port || 5432);
  url.pathname = `/${connection.database}`;
  url.searchParams.set("sslmode", connection.sslmode || "require");
  return url.toString();
}

async function loadPrivateEnv() {
  return parsePrivateEnv(existsSync(privateEnvPath) ? await readFile(privateEnvPath, "utf8") : "");
}

async function savePrivateEnv(values) {
  await writeFile(privateEnvPath, serializePrivateEnv(values), { encoding: "utf8", mode: 0o600 });
}

async function prepare() {
  const values = await loadPrivateEnv();
  if (!values.get("ADMIN_PASSWORD") || !values.get("ADMIN_SESSION_SECRET")) {
    throw new Error(".env.admin.local must already contain ADMIN_PASSWORD and ADMIN_SESSION_SECRET");
  }
  if (!values.get("LOCAL_ADMIN_DB_PASSWORD")) {
    values.set("LOCAL_ADMIN_DB_PASSWORD", crypto.randomBytes(48).toString("base64url"));
  }
  values.set("ADMIN_PASSWORD_HASH", hashPassword(values.get("ADMIN_PASSWORD")));
  values.set("PUBLIC_REPORT_URL", "https://leo-liz.github.io/platform-policy-report/reports/latest.html");
  values.set("LOCAL_ADMIN_MODE", "true");
  await savePrivateEnv(values);
  process.stdout.write("local private configuration prepared\n");
}

async function applyConnection(connectionPath) {
  const values = await loadPrivateEnv();
  const password = values.get("LOCAL_ADMIN_DB_PASSWORD");
  if (!password) throw new Error("run prepare before applying connection metadata");
  const connection = JSON.parse(await readFile(path.resolve(connectionPath), "utf8"));
  values.set("DATABASE_URL", buildDedicatedDatabaseUrl(connection, password));
  await savePrivateEnv(values);
  process.stdout.write("least-privilege database connection saved locally\n");
}

async function finalize() {
  const values = await loadPrivateEnv();
  if (!String(values.get("DATABASE_URL") || "").includes("platform_policy_local_admin_v2")) {
    throw new Error("dedicated local database connection is not configured");
  }
  for (const key of ["ADMIN_PASSWORD", "LOCAL_ADMIN_DB_PASSWORD", "NOTIFICATION_DISPATCH_TOKEN"]) values.delete(key);
  await savePrivateEnv(values);
  process.stdout.write("temporary local plaintext values removed\n");
}

async function resetPasswordFromEnvironment() {
  const password = String(process.env.LOCAL_ADMIN_NEW_PASSWORD || "");
  if (password.length < 12 || password.length > 256) throw new Error("administrator password must contain 12 to 256 characters");
  const values = await loadPrivateEnv();
  const passwordHash = hashPassword(password);
  if (!verifyPassword(password, passwordHash)) throw new Error("administrator password hash verification failed");
  values.set("ADMIN_PASSWORD_HASH", passwordHash);
  values.delete("ADMIN_PASSWORD");
  await savePrivateEnv(values);
  delete process.env.LOCAL_ADMIN_NEW_PASSWORD;
  process.stdout.write("administrator password hash updated\n");
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const [command, argument] = process.argv.slice(2);
  if (command === "prepare") await prepare();
  else if (command === "apply" && argument) await applyConnection(argument);
  else if (command === "finalize") await finalize();
  else if (command === "reset-password-env") await resetPasswordFromEnvironment();
  else throw new Error("usage: node scripts/configure-local-admin.mjs prepare|apply <connection.json>|finalize|reset-password-env");
}
