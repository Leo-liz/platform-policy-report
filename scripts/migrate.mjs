import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { database } from "../lib/db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");
const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
const sql = database();

await sql`CREATE TABLE IF NOT EXISTS notification_schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

for (const filename of files) {
  const existing = await sql`SELECT filename FROM notification_schema_migrations WHERE filename = ${filename}`;
  if (existing.length) continue;
  const source = fs.readFileSync(path.join(migrationsDir, filename), "utf8");
  await sql.query(source);
  await sql`INSERT INTO notification_schema_migrations (filename) VALUES (${filename})`;
  console.log(`applied ${filename}`);
}
