// First-party signed cookies (HS256 over SESSION_SECRET) — unrelated to the hub's RS256.
// Ported from Pythia/apps/pythia/src/admin/session.ts.
// Two cookies, separated by a `purpose` claim so they can never be interchanged:
//   login   — transient state+nonce+codeVerifier across the /authorize round-trip
//   session — post-login sub+roles+name
import { SignJWT, jwtVerify } from "jose";

export const LOGIN_COOKIE = "cm_admin_login";
export const SESSION_COOKIE = "cm_admin_session";

const LOGIN_TTL_SECONDS = 10 * 60;        // login round-trips are short
const SESSION_TTL_SECONDS = 8 * 60 * 60;  // re-login is cheap (bounce through /authorize)

const key = (secret) => new TextEncoder().encode(secret);

async function signCookie(payload, secret, ttlSeconds) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key(secret));
}

async function verifyCookie(token, secret) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    return payload;
  } catch {
    return null; // bad signature or expired
  }
}

export function signLoginState(state, secret) {
  return signCookie({ ...state, purpose: "login" }, secret, LOGIN_TTL_SECONDS);
}
export async function readLoginState(token, secret) {
  const p = await verifyCookie(token, secret);
  return p && p.purpose === "login" ? p : null;
}
export function signSession(session, secret) {
  return signCookie({ ...session, purpose: "session" }, secret, SESSION_TTL_SECONDS);
}
export async function readSession(token, secret) {
  const p = await verifyCookie(token, secret);
  return p && p.purpose === "session" ? p : null;
}

/**
 * Parse a Cookie header into a plain object.
 *
 * The decode MUST be guarded: `decodeURIComponent("%")` throws URIError, and this
 * runs on an unauthenticated path (/auth/callback), so an unguarded throw is a
 * one-request remote kill of the server. Any cookie on the domain — not just ours —
 * can carry a stray `%`. A value we can't decode is used raw; it then fails its
 * signature check like any other garbage.
 */
export function parseCookies(header) {
  const out = {};
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const raw = part.slice(i + 1).trim();
    let value = raw;
    try { value = decodeURIComponent(raw); } catch { /* not percent-encoded — use as-is */ }
    out[part.slice(0, i).trim()] = value;
  }
  return out;
}

/** Build a Set-Cookie value. HttpOnly + Secure + SameSite=Lax per the handoff. */
export function cookie(name, value, { maxAge, path = "/", secure = true } = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, "HttpOnly", "SameSite=Lax"];
  if (secure) bits.push("Secure");
  if (maxAge !== undefined) bits.push(`Max-Age=${maxAge}`);
  return bits.join("; ");
}
export const clearCookie = (name, path = "/") => `${name}=; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=0`;
export { LOGIN_TTL_SECONDS, SESSION_TTL_SECONDS };
