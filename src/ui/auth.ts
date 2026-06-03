import crypto from "node:crypto";

const COOKIE_NAME = "dashboard_session";
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

export function dashboardPassword(): string | undefined {
  const value = process.env.DASHBOARD_PASSWORD?.trim();
  return value || undefined;
}

export function isDashboardAuthEnabled(): boolean {
  return Boolean(dashboardPassword());
}

function authSecret(): string {
  return (
    process.env.DASHBOARD_AUTH_SECRET?.trim() ||
    dashboardPassword() ||
    "dashboard-dev-secret-change-me"
  );
}

export function getSessionCookieName(): string {
  return COOKIE_NAME;
}

export function createSessionToken(): string {
  const exp = Date.now() + SESSION_MAX_AGE_SEC * 1000;
  const payload = Buffer.from(JSON.stringify({ exp }), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", authSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", authSecret()).update(payload).digest("base64url");
  try {
    if (sig.length !== expected.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    return typeof data.exp === "number" && Date.now() < data.exp;
  } catch {
    return false;
  }
}

export function verifyPassword(candidate: string): boolean {
  const expected = dashboardPassword();
  if (!expected) return false;
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function sessionCookieHeader(token: string, secure: boolean): string {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SEC}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader(secure: boolean): string {
  const parts = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    out[key] = decodeURIComponent(value);
  }
  return out;
}

function basicAuthPassword(req: { headers: { authorization?: string } }): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    return colon >= 0 ? decoded.slice(colon + 1) : decoded;
  } catch {
    return null;
  }
}

export function isAuthenticated(req: {
  headers: { cookie?: string; authorization?: string };
}): boolean {
  if (!isDashboardAuthEnabled()) return true;
  const basicPassword = basicAuthPassword(req);
  if (basicPassword !== null && verifyPassword(basicPassword)) return true;
  const cookies = parseCookies(req.headers.cookie);
  return verifySessionToken(cookies[COOKIE_NAME]);
}

/** Paths reachable without a session when auth is enabled. */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/login.html" ||
    pathname === "/styles.css" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/session" ||
    pathname === "/api/health"
  );
}
