// Transport-level tests. The headline case is the 308: the hub's Next.js
// `trailingSlash: true` redirects POST /api/oidc/token → /api/oidc/token/, and a
// plain auto-following fetch drops the body + Authorization across that hop, so the
// token exchange fails with an opaque invalid_grant. postForm must re-issue the POST.
//   node --test dashboard/auth/routes.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";

import { postForm, guard, readSessionFromHeader } from "./routes.mjs";
import { signSession, SESSION_COOKIE, cookie } from "./session.mjs";

/** A stand-in hub: /token 308s to /token/, which echoes back what it received. */
async function startHub() {
  const seen = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    seen.push({ url: req.url, method: req.method, body, auth: req.headers.authorization });

    if (req.url === "/token") {
      res.writeHead(308, { location: "/token/" }); // exactly what trailingSlash does
      return res.end();
    }
    if (req.url === "/token/") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ body, auth: req.headers.authorization ?? null }));
    }
    res.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { base: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}

test("postForm preserves the POST body and Authorization across a 308", async () => {
  const hub = await startHub();
  try {
    const res = await postForm(
      `${hub.base}/token`,
      { "content-type": "application/x-www-form-urlencoded", authorization: "Basic c2VjcmV0" },
      "grant_type=authorization_code&code=abc&code_verifier=xyz",
    );
    assert.equal(res.status, 200);
    const echoed = await res.json();
    assert.match(echoed.body, /code_verifier=xyz/); // the body SURVIVED the redirect
    assert.equal(echoed.auth, "Basic c2VjcmV0");     // and so did the client_secret_basic auth

    // Both hops were real POSTs — the redirect was re-issued, not downgraded to GET.
    assert.deepEqual(hub.seen.map((r) => `${r.method} ${r.url}`), ["POST /token", "POST /token/"]);
  } finally { hub.close(); }
});

test("postForm keeps client_secret_basic across a CROSS-ORIGIN redirect, where auto-follow strips it", async () => {
  // The failure auto-follow really does have: fetch drops the Authorization header
  // when a redirect changes origin (e.g. the hub bouncing apex→www or http→https).
  // The token endpoint then sees an unauthenticated client and rejects the grant.
  // Manual re-issue re-sends the header at the new target.
  const a = await startHub();
  const b = await startHub();
  const bounce = createServer((req, res) => {
    res.writeHead(308, { location: `${b.base}/token/` }); // different origin
    res.end();
  });
  bounce.listen(0, "127.0.0.1");
  await once(bounce, "listening");
  const bounceUrl = `http://127.0.0.1:${bounce.address().port}/token`;

  try {
    const auto = await fetch(bounceUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic c2VjcmV0" },
      body: "grant_type=authorization_code&code=abc",
      redirect: "follow",
    });
    assert.equal((await auto.json()).auth, null); // ← auth stripped: the grant would fail

    const manual = await postForm(
      bounceUrl,
      { "content-type": "application/x-www-form-urlencoded", authorization: "Basic c2VjcmV0" },
      "grant_type=authorization_code&code=abc",
    );
    const echoed = await manual.json();
    assert.equal(echoed.auth, "Basic c2VjcmV0");    // ← survives
    assert.match(echoed.body, /code=abc/);          // ← and so does the body
  } finally { a.close(); b.close(); bounce.close(); }
});

test("postForm returns the last response when there is no redirect", async () => {
  const hub = await startHub();
  try {
    const res = await postForm(`${hub.base}/token/`, {}, "a=1");
    assert.equal(res.status, 200);
    assert.equal(hub.seen.length, 1);
  } finally { hub.close(); }
});

const CFG = {
  issuer: "https://ancientholdings.eu",
  clientId: "cm",
  clientSecret: "s",
  redirectUri: "https://d/auth/callback",
  sessionSecret: "z".repeat(40),
  scope: "openid profile email roles",
};
const reqWith = (cookieHeader) => ({ headers: cookieHeader ? { cookie: cookieHeader } : {} });

test("guard: local mode (no OIDC config) opens everything, exactly as before auth existed", async () => {
  const g = await guard(reqWith(), null);
  assert.deepEqual(
    { mode: g.mode, canRead: g.canRead, canExecute: g.canExecute, local: g.localActionsAvailable },
    { mode: "local", canRead: true, canExecute: true, local: true },
  );
});

test("guard: live + unauthenticated can neither read nor execute", async () => {
  const g = await guard(reqWith(), CFG);
  assert.equal(g.authenticated, false);
  assert.equal(g.canRead, false);
  assert.equal(g.canExecute, false);
});

test("guard: live + ancient may execute; live + modern is read-only", async () => {
  const ancient = cookie(SESSION_COOKIE, await signSession({ sub: "a", roles: ["ancient"] }, CFG.sessionSecret));
  const modern = cookie(SESSION_COOKIE, await signSession({ sub: "m", roles: ["modern"] }, CFG.sessionSecret));

  const ga = await guard(reqWith(ancient), CFG);
  assert.equal(ga.canRead, true);
  assert.equal(ga.canExecute, true);

  const gm = await guard(reqWith(modern), CFG);
  assert.equal(gm.canRead, true);
  assert.equal(gm.canExecute, false); // mutations → 403
});

test("guard: an operator/baron hub user is not an admin at all", async () => {
  const c = cookie(SESSION_COOKIE, await signSession({ sub: "o", roles: ["operator", "baron"] }, CFG.sessionSecret));
  const g = await guard(reqWith(c), CFG);
  assert.equal(g.authenticated, true);
  assert.equal(g.canRead, false);
  assert.equal(g.canExecute, false);
});

test("guard: the local-only actions are unavailable in live mode even for an ancient admin", async () => {
  const c = cookie(SESSION_COOKIE, await signSession({ sub: "a", roles: ["ancient"] }, CFG.sessionSecret));
  const g = await guard(reqWith(c), CFG);
  assert.equal(g.localActionsAvailable, false); // backup/restore/master-pollinate touch THIS machine's disk
});

test("session read is tolerant of a stale duplicate cookie shadowing the live one", async () => {
  const good = await signSession({ sub: "a", roles: ["ancient"] }, CFG.sessionSecret);
  // RFC 6265 sends the narrower-path (stale) cookie FIRST — a naive read stops there and 401s.
  const header = `${SESSION_COOKIE}=stale-garbage; ${SESSION_COOKIE}=${encodeURIComponent(good)}`;
  const { session, sawCookie } = await readSessionFromHeader(header, CFG.sessionSecret);
  assert.equal(sawCookie, true);
  assert.equal(session.sub, "a");
});

test("a forged session cookie is never admitted, even among duplicates", async () => {
  const forged = await signSession({ sub: "evil", roles: ["ancient"] }, "wrong-secret".padEnd(40, "x"));
  const header = `${SESSION_COOKIE}=${forged}; ${SESSION_COOKIE}=also-garbage`;
  const { session } = await readSessionFromHeader(header, CFG.sessionSecret);
  assert.equal(session, null);
});
