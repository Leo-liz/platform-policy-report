import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const envPath = path.join(root, ".env.admin.local");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const port = Number(process.env.LOCAL_ADMIN_PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("invalid local admin port");

process.env.ADMIN_ALLOWED_ORIGIN = `http://localhost:${port},http://127.0.0.1:${port}`;
process.env.LOCAL_ADMIN_MODE = "true";
process.env.PUBLIC_REPORT_URL ||= "https://leo-liz.github.io/platform-policy-report/reports/latest.html";
if (!String(process.env.DATABASE_URL || "").startsWith("postgres")) throw new Error("DATABASE_URL is unavailable");
if (String(process.env.ADMIN_PASSWORD_HASH || "").length < 32) throw new Error("ADMIN_PASSWORD_HASH is unavailable");
if (String(process.env.ADMIN_SESSION_SECRET || "").length < 32) throw new Error("ADMIN_SESSION_SECRET is unavailable");
await import("./migrate.mjs");
const { default: adminHandler } = await import("../api/admin.js");
const { database } = await import("../lib/db.js");
await database()`SELECT 1 AS ok`;

const adminRoot = path.join(root, "admin", "notifications");
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
]);

function secureHeaders(res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
}

async function serveAdminAsset(req, res, pathname) {
  const relative = pathname === "/admin/notifications" || pathname === "/admin/notifications/"
    ? "index.html"
    : pathname.slice("/admin/notifications/".length);
  const target = path.resolve(adminRoot, decodeURIComponent(relative));
  if (target !== adminRoot && !target.startsWith(`${adminRoot}${path.sep}`)) {
    res.statusCode = 403;
    return res.end("Forbidden");
  }
  try {
    const body = await readFile(target);
    secureHeaders(res);
    res.statusCode = 200;
    res.setHeader("Content-Type", mimeTypes.get(path.extname(target).toLowerCase()) || "application/octet-stream");
    return res.end(body);
  } catch (error) {
    res.statusCode = error?.code === "ENOENT" ? 404 : 500;
    return res.end(res.statusCode === 404 ? "Not Found" : "Internal Server Error");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  if (url.pathname === "/api/admin") return adminHandler(req, res);
  if (url.pathname.startsWith("/admin/notifications")) return serveAdminAsset(req, res, url.pathname);
  if (url.pathname === "/") {
    res.statusCode = 302;
    res.setHeader("Location", "/admin/notifications");
    return res.end();
  }
  res.statusCode = 404;
  return res.end("Not Found");
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Local admin ready: http://localhost:${port}/admin/notifications\n`);
});
