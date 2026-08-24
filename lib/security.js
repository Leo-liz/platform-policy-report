import crypto from "node:crypto";

const COOKIE_NAME = "pp_admin";
const SESSION_SECONDS = 8 * 60 * 60;

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value, secret = process.env.ADMIN_SESSION_SECRET || "") {
  if (secret.length < 32) throw new Error("ADMIN_SESSION_SECRET must contain at least 32 characters");
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, encoded = process.env.ADMIN_PASSWORD_HASH || "") {
  const [algorithm, salt, expected] = String(encoded).split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return safeEqual(actual, expected);
}

export function createSession(now = Date.now()) {
  const payload = {
    issued_at: Math.floor(now / 1000),
    expires_at: Math.floor(now / 1000) + SESSION_SECONDS,
    csrf: crypto.randomBytes(24).toString("base64url"),
  };
  const encoded = b64url(JSON.stringify(payload));
  return { token: `${encoded}.${sign(encoded)}`, payload };
}

export function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((item) => item.trim())
      .filter((item) => item.includes("="))
      .map((item) => {
        const index = item.indexOf("=");
        return [decodeURIComponent(item.slice(0, index)), decodeURIComponent(item.slice(index + 1))];
      }),
  );
}

export function readSession(req, now = Date.now()) {
  const token = parseCookies(req)[COOKIE_NAME] || "";
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature || !safeEqual(signature, sign(encoded))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (Number(payload.expires_at || 0) < Math.floor(now / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function requireAdmin(req, { csrf = false } = {}) {
  const session = readSession(req);
  if (!session) throw Object.assign(new Error("administrator authentication required"), { statusCode: 401 });
  if (csrf && !safeEqual(req.headers["x-csrf-token"] || "", session.csrf || "")) {
    throw Object.assign(new Error("CSRF validation failed"), { statusCode: 403 });
  }
  return session;
}

export function verifyOrigin(req) {
  const allowed = new Set(
    String(process.env.ADMIN_ALLOWED_ORIGIN || "")
      .split(",")
      .map((value) => value.trim().replace(/\/$/, ""))
      .filter(Boolean),
  );
  for (const name of ["VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"]) {
    const host = String(process.env[name] || "").trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
    if (host) allowed.add(`https://${host}`);
  }
  const origin = String(req.headers.origin || "").replace(/\/$/, "");
  if (!allowed.has(origin)) {
    throw Object.assign(new Error("request origin is not allowed"), { statusCode: 403 });
  }
}

export function requireServiceToken(req) {
  const expected = process.env.NOTIFICATION_DISPATCH_TOKEN || "";
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (expected.length < 24 || !safeEqual(supplied, expected)) {
    throw Object.assign(new Error("dispatch authentication failed"), { statusCode: 401 });
  }
}

export function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

