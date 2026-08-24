import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env.admin.local");
if (!existsSync(envPath)) throw new Error(".env.admin.local is missing");
process.loadEnvFile(envPath);

const { database } = await import("../lib/db.js");
const sql = database();
const identity = await sql`
  SELECT current_user AS role_name,
         has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_schema_objects
`;
if (identity[0]?.role_name !== "platform_policy_local_admin_v2") throw new Error("unexpected database role");
if (identity[0]?.can_create_schema_objects) throw new Error("local role can create schema objects");

const rows = await sql`
  SELECT table_name, privilege_type
  FROM information_schema.role_table_grants
  WHERE grantee = current_user AND table_schema = 'public'
  ORDER BY table_name, privilege_type
`;
const actual = new Map();
for (const row of rows) {
  if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
  actual.get(row.table_name).add(row.privilege_type);
}
const writable = new Set([
  "notification_recipients",
  "notification_rules",
  "notification_login_attempts",
  "notification_audit_logs",
]);
const readonly = new Set(["notification_dispatches", "notification_delivery_items"]);
const expectedWrite = new Set(["SELECT", "INSERT", "UPDATE", "DELETE"]);
const sameSet = (left, right) => left.size === right.size && [...left].every((item) => right.has(item));
for (const table of writable) {
  if (!sameSet(actual.get(table) || new Set(), expectedWrite)) throw new Error(`write grants mismatch for ${table}`);
}
for (const table of readonly) {
  if (!sameSet(actual.get(table) || new Set(), new Set(["SELECT"]))) throw new Error(`read-only grants mismatch for ${table}`);
}
for (const table of actual.keys()) {
  if (!writable.has(table) && !readonly.has(table)) throw new Error(`unexpected table grant: ${table}`);
}
process.stdout.write(JSON.stringify({
  ok: true,
  role: identity[0].role_name,
  writable_tables: writable.size,
  readonly_tables: readonly.size,
  can_create_schema_objects: false,
}) + "\n");
