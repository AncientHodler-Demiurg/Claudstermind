// The OIDC transport: /auth/login → hub → /auth/callback → session cookie.
// Ported from Pythia/apps/pythia/src/admin/routes.ts onto node:http.
import { getDiscovery } from "./discovery.mjs";
import { createLoginChallenge } from "./pkce.mjs";
import { verifyIdToken, hasAncientRole, hasModernRole } from "./idToken.mjs";
import {
  LOGIN_COOKIE, SESSION_COOKIE,
  signLoginState, readLoginState, signSession, readSession,
  parseCookies, cookie, clearCookie,
  LOGIN_TTL_SECONDS, SESSION_TTL_SECONDS,
} from "./session.mjs";

/**
 * POST a form, manually following same-origin redirects so the method, body, and
 * Authorization header SURVIVE. The hub runs Next.js with `trailingSlash: true`,
 * so `POST /api/oidc/token` gets a 308 to `/api/oidc/token/` — and fetch's
 * auto-follow drops the body + auth across a 307/308, which the IdP then rejects
 * as an invalid grant. Re-issuing the POST to the redirect target ourselves keeps
 * them intact. Capped at 3 hops.
 */
export async function postForm(url, headers, body, fetchImpl = fetch) {
  let target = url;
  let res;
  for (let hop = 0; hop < 3; hop++) {
    res = await fetchImpl(target, { method: "POST", headers, body, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) break;
    target = new URL(location, target).toString();
  }
  return res;
}

/** Escape anything interpolated into these pages. Today's callers all pass static
 *  strings — but the first person to surface the IdP's `error_description` here
 *  would otherwise create a reflected XSS on an auth endpoint. */
export const esc = (v) =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const html = (res, status, title, body) => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(
    `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>` +
    `<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1.5rem;color:#e8e6f0;background:#12101c}a{color:#f5c542}</style>` +
    body,
  );
};
const fail = (res, status, msg) =>
  html(res, status, "Claudstermind — login failed",
    `<h1>Login failed</h1><p>${esc(msg)}</p><p><a href="/auth/login">Try again</a></p>`);

/** Authenticated at the hub, but with no admin role. A denial — NOT a login bounce. */
export const denyPage = (res, roles) =>
  html(res, 403, "Claudstermind — access denied",
    `<h1>Access denied</h1><p>You are signed in to AncientHub, but your account has neither the <b>ancient</b> nor the <b>modern</b> role, so it cannot view this dashboard.</p>` +
    `<p style="opacity:.7">Roles on your account: ${roles.length ? esc(roles.join(", ")) : "(none)"}</p>` +
    `<p><a href="/auth/logout">Sign out</a></p>`);

/**
 * Read the session tolerant of DUPLICATE cookies of the same name — a stale
 * narrower-path cookie is sent FIRST per RFC 6265 and would otherwise shadow the
 * live one. Every candidate still has to pass the signature+exp+purpose check, so
 * scanning several is safe: a forged cookie is skipped, never admitted.
 */
export async function readSessionFromHeader(cookieHeader, secret) {
  if (!cookieHeader) return { session: null, sawCookie: false };
  let sawCookie = false;
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    sawCookie = true;
    const raw = pair.slice(eq + 1).trim();
    let value = raw;
    try { value = decodeURIComponent(raw); } catch { /* not encoded */ }
    const session = await readSession(value, secret);
    if (session) return { session, sawCookie: true };
  }
  return { session: null, sawCookie };
}

/**
 * The single authorization decision for a request. Two independent locks:
 *
 *   canExecute        — the ROLE lock. Local: open. Live: `ancient` only; `modern`
 *                       reads and gets a 403 on any mutation.
 *   localActionsOnly  — the PLACE lock. Backup, restore and master-pollinate act on
 *                       the work machine's disk, so they exist only in local mode.
 *                       The live deployment refuses them even for an ancient admin,
 *                       and the UI hides them.
 *
 * Both must pass for a local-only mutation. Neither subsumes the other.
 */
export async function guard(req, cfg) {
  if (!cfg) {
    return {
      mode: "local", authenticated: true, session: null,
      canRead: true, canExecute: true, localActionsAvailable: true,
    };
  }
  const { session } = await readSessionFromHeader(req.headers.cookie, cfg.sessionSecret);
  const roles = session?.roles ?? [];
  return {
    mode: "live",
    authenticated: Boolean(session),
    session,
    canRead: Boolean(session) && hasModernRole(roles),
    canExecute: Boolean(session) && hasAncientRole(roles),
    localActionsAvailable: false,
  };
}

/** Handle /auth/*. Returns true when the request was consumed. */
export async function handleAuthRoute(req, res, url, cfg) {
  if (!url.pathname.startsWith("/auth/")) return false;

  if (!cfg) {
    // Local mode has no login; say so rather than 404-ing confusingly.
    html(res, 200, "Claudstermind — local mode",
      "<h1>Local mode</h1><p>Auth is disabled: no OIDC environment is configured, so every feature is open. <a href=\"/\">Back to the dashboard</a>.</p>");
    return true;
  }

  if (url.pathname === "/auth/login") {
    const { discovery } = await getDiscovery(cfg.issuer);
    const challenge = createLoginChallenge();
    const loginCookie = await signLoginState(
      { state: challenge.state, nonce: challenge.nonce, codeVerifier: challenge.codeVerifier },
      cfg.sessionSecret,
    );
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: "code",
      scope: cfg.scope,
      state: challenge.state,
      nonce: challenge.nonce,
      code_challenge: challenge.codeChallenge,
      code_challenge_method: "S256",
    });
    res.writeHead(302, {
      // Scoped to the callback path: the cookie exists only for this round-trip.
      "set-cookie": cookie(LOGIN_COOKIE, loginCookie, { path: "/auth", maxAge: LOGIN_TTL_SECONDS }),
      location: `${discovery.authorization_endpoint}?${params}`,
      "cache-control": "no-store",
    });
    res.end();
    return true;
  }

  if (url.pathname === "/auth/callback") {
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const cookies = parseCookies(req.headers.cookie);
    const login = await readLoginState(cookies[LOGIN_COOKIE], cfg.sessionSecret);
    const dropLogin = clearCookie(LOGIN_COOKIE, "/auth");

    if (!code || !returnedState || !login) {
      res.setHeader("set-cookie", dropLogin);
      return fail(res, 400, "Missing or expired login request."), true;
    }
    if (returnedState !== login.state) {
      res.setHeader("set-cookie", dropLogin);
      return fail(res, 400, "State mismatch — the login did not start here."), true;
    }

    const { discovery, jwks } = await getDiscovery(cfg.issuer);

    // Confidential exchange, server-to-server. client_secret_basic; the PKCE
    // code_verifier proves this is the same agent that began the login.
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
    const tokenRes = await postForm(
      discovery.token_endpoint,
      {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${basic}`,
        accept: "application/json",
      },
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: cfg.redirectUri,
        code_verifier: login.codeVerifier,
      }).toString(),
    );

    if (!tokenRes.ok) {
      const detail = await tokenRes.text().catch(() => "");
      console.error(`auth: token exchange failed (${tokenRes.status}) ${detail.slice(0, 200)}`);
      res.setHeader("set-cookie", dropLogin);
      return fail(res, 502, tokenRes.status >= 500
        ? `The hub's token endpoint returned HTTP ${tokenRes.status} — a hub-side error.`
        : `Token exchange rejected (HTTP ${tokenRes.status}).`), true;
    }
    const tokens = await tokenRes.json().catch(() => ({}));
    if (!tokens.id_token) {
      res.setHeader("set-cookie", dropLogin);
      return fail(res, 502, "The hub returned no id_token."), true;
    }

    let identity;
    try {
      identity = await verifyIdToken(tokens.id_token, {
        jwks, issuer: cfg.issuer, clientId: cfg.clientId, expectedNonce: login.nonce,
      });
    } catch (err) {
      console.error(`auth: id_token verification failed — ${err.message}`);
      res.setHeader("set-cookie", dropLogin);
      return fail(res, 401, "Token verification failed."), true;
    }

    const session = await signSession(
      { sub: identity.sub, roles: identity.roles, name: identity.displayName },
      cfg.sessionSecret,
    );
    res.writeHead(302, {
      "set-cookie": [
        dropLogin,
        cookie(SESSION_COOKIE, session, { path: "/", maxAge: SESSION_TTL_SECONDS }),
      ],
      location: "/",
      "cache-control": "no-store",
    });
    res.end();
    return true;
  }

  if (url.pathname === "/auth/logout") {
    res.writeHead(302, { "set-cookie": clearCookie(SESSION_COOKIE, "/"), location: "/" });
    res.end();
    return true;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
  return true;
}
