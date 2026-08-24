import { database } from "../lib/db.js";
import { bodyObject, json } from "../lib/http.js";
import { requireServiceToken } from "../lib/security.js";

export const LOCAL_ADMIN_ROLE = "platform_policy_local_admin_v2";

export function validateRolePassword(value) {
  const password = String(value || "");
  if (!/^[A-Za-z0-9_-]{48,128}$/.test(password)) {
    throw new Error("local admin database password does not meet the restricted format");
  }
  return password;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function grantStatements(databaseName, password) {
  const databaseIdentifier = quoteIdentifier(databaseName);
  const safePassword = validateRolePassword(password);
  return [
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${LOCAL_ADMIN_ROLE}') THEN CREATE ROLE ${LOCAL_ADMIN_ROLE} WITH LOGIN PASSWORD '${safePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; END IF; END $$`,
    `GRANT CONNECT ON DATABASE ${databaseIdentifier} TO ${LOCAL_ADMIN_ROLE}`,
    `GRANT USAGE ON SCHEMA public TO ${LOCAL_ADMIN_ROLE}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE notification_recipients, notification_rules, notification_login_attempts, notification_audit_logs TO ${LOCAL_ADMIN_ROLE}`,
    `GRANT SELECT ON TABLE notification_dispatches, notification_delivery_items TO ${LOCAL_ADMIN_ROLE}`,
    `GRANT USAGE, SELECT ON SEQUENCE notification_audit_logs_id_seq TO ${LOCAL_ADMIN_ROLE}`,
  ];
}

export function connectionMetadata(databaseUrl) {
  const url = new URL(databaseUrl);
  if (!url.hostname || !url.pathname.slice(1)) throw new Error("DATABASE_URL is incomplete");
  return {
    protocol: "postgresql",
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.slice(1)),
    username: LOCAL_ADMIN_ROLE,
    sslmode: url.searchParams.get("sslmode") || "require",
  };
}

export default async function handler(req, res) {
  let stage = "request_validation";
  try {
    if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });
    requireServiceToken(req);
    const body = await bodyObject(req);
    const password = validateRolePassword(body.password);
    stage = "database_connect";
    const sql = database();
    const current = await sql`SELECT current_database() AS name`;
    const databaseName = String(current[0]?.name || "");
    if (!databaseName) throw new Error("current database name is unavailable");
    const statements = grantStatements(databaseName, password);
    for (let index = 0; index < statements.length; index += 1) {
      stage = `grant_${index + 1}`;
      await sql.query(statements[index]);
    }
    return json(res, 200, { ok: true, connection: connectionMetadata(process.env.DATABASE_URL) });
  } catch (error) {
    return json(res, Number(error?.statusCode || 400), {
      error: "bootstrap_failed",
      stage,
      database_code: String(error?.code || "unknown").slice(0, 40),
    });
  }
}
