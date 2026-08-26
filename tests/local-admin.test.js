import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("local admin launcher is loopback-only and reads the private local environment", async () => {
  const script = await readFile(new URL("../scripts/start-local-admin.ps1", import.meta.url), "utf8");
  assert.match(script, /local-admin-server\.mjs/);
  assert.match(script, /\.env\.admin\.local/);
  assert.doesNotMatch(script, /env run/);
  assert.doesNotMatch(script, /env pull/);
  assert.doesNotMatch(script, /0\.0\.0\.0/);
  assert.doesNotMatch(script, /DINGTALK_APP_SECRET\s*=/);
});

test("local admin can run hidden at login and verifies readiness before returning", async () => {
  const start = await readFile(new URL("../scripts/start-local-admin.ps1", import.meta.url), "utf8");
  const install = await readFile(new URL("../scripts/install-local-admin-autostart.ps1", import.meta.url), "utf8");
  assert.match(start, /\[switch\]\$Background/);
  assert.match(start, /Test-LocalAdminReady/);
  assert.match(start, /-WindowStyle Hidden/);
  assert.match(start, /serverScript/);
  assert.match(install, /GetFolderPath\("Startup"\)/);
  assert.match(install, /CreateShortcut/);
  assert.match(install, /Start-Process -FilePath explorer\.exe/);
  assert.match(install, /start-local-admin\.ps1/);
  assert.match(install, /-WindowStyle Hidden/);
  assert.match(install, /WindowStyle = 7/);
  assert.match(install, /127\.0\.0\.1/);
  assert.doesNotMatch(install, /ADMIN_PASSWORD|DATABASE_URL|DINGTALK_APP_SECRET/);
});

test("local session cookies work on loopback HTTP without weakening cloud cookies", async () => {
  const previous = process.env.LOCAL_ADMIN_MODE;
  const { sessionCookie } = await import("../lib/security.js");
  process.env.LOCAL_ADMIN_MODE = "true";
  assert.doesNotMatch(sessionCookie("local"), /; Secure/);
  process.env.LOCAL_ADMIN_MODE = "false";
  assert.match(sessionCookie("cloud"), /; Secure/);
  if (previous === undefined) delete process.env.LOCAL_ADMIN_MODE;
  else process.env.LOCAL_ADMIN_MODE = previous;
});

test("local admin server exposes only the admin API and binds loopback", async () => {
  const server = await readFile(new URL("../scripts/local-admin-server.mjs", import.meta.url), "utf8");
  assert.match(server, /server\.listen\(port, "127\.0\.0\.1"/);
  assert.match(server, /url\.pathname === "\/api\/admin"/);
  assert.match(server, /SELECT 1 AS ok/);
  assert.doesNotMatch(server, /api\/dispatch/);
  assert.doesNotMatch(server, /0\.0\.0\.0/);
  assert.doesNotMatch(server, /migrate\.mjs/);
});

test("local admin environment file remains excluded from Git", async () => {
  const ignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(ignore, /^\.env\.\*$/m);
  assert.match(ignore, /^!\.env\.example$/m);
});

test("password reset uses a secure prompt and never accepts a command-line password", async () => {
  const script = await readFile(new URL("../scripts/reset-local-admin-password.ps1", import.meta.url), "utf8");
  assert.match(script, /Read-Host .* -AsSecureString/);
  assert.match(script, /LOCAL_ADMIN_NEW_PASSWORD/);
  assert.match(script, /ZeroFreeBSTR/);
  assert.doesNotMatch(script, /param\([^)]*Password/si);
});
