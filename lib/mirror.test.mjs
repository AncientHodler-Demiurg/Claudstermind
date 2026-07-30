// node --test lib/mirror.test.mjs — URL routing and header hygiene for the mirror proxy.
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMirrorPath, mirrorPortFromReferer, mirrorPortFromCookie,
  forwardRequestHeaders, forwardResponseHeaders, rewriteLocation, injectBase, mirrorRuntimeScript,
  buildMirrorResponse, mirrorFromReferer, mirrorFromCookie, MIRROR_COOKIE,
  stripNamedCookies, forwardUpgradeHeaders, buildUpgradeRequest, websocketAccept,
  mirrorForwardedHeaders,
} from "./mirror.mjs";

test("parseMirrorPath splits the port from the rest of the path", () => {
  assert.deepEqual(parseMirrorPath("/mirror/3002/"), { port: 3002, sub: "/" });
  assert.deepEqual(parseMirrorPath("/mirror/3002"), { port: 3002, sub: "/" });
  assert.deepEqual(parseMirrorPath("/mirror/3002/assets/app.js"), { port: 3002, sub: "/assets/app.js" });
  assert.equal(parseMirrorPath("/mirror/"), null);
  assert.equal(parseMirrorPath("/mirror/abc/"), null);
  assert.equal(parseMirrorPath("/api/version"), null);
});

test("mirrorPortFromReferer reads the port off a mirrored page's URL", () => {
  assert.equal(mirrorPortFromReferer("http://localhost:3001/mirror/3002/"), 3002);
  assert.equal(mirrorPortFromReferer("https://brain.example.eu/mirror/4001/some/page"), 4001);
  assert.equal(mirrorPortFromReferer("http://localhost:3001/"), null);       // the dashboard itself
  assert.equal(mirrorPortFromReferer("http://localhost:3001/mirrored/3002/"), null);
  assert.equal(mirrorPortFromReferer(""), null);
  assert.equal(mirrorPortFromReferer(undefined), null);
  assert.equal(mirrorPortFromReferer("not a url"), null);
});

test("mirrorPortFromCookie picks its own cookie out of the jar", () => {
  assert.equal(mirrorPortFromCookie(`${MIRROR_COOKIE}=3002`), 3002);
  assert.equal(mirrorPortFromCookie(`cm_session=abc; ${MIRROR_COOKIE}=4001; other=1`), 4001);
  assert.equal(mirrorPortFromCookie("cm_session=abc"), null);
  assert.equal(mirrorPortFromCookie(`${MIRROR_COOKIE}=nope`), null);
  assert.equal(mirrorPortFromCookie(""), null);
});

test("request headers: hop-by-hop dropped, and the dashboard's credentials never leak out", () => {
  const out = forwardRequestHeaders({
    host: "localhost:3001", connection: "keep-alive", "content-length": "12",
    cookie: "cm_session=SECRET", authorization: "Bearer SECRET",
    accept: "text/html", "user-agent": "test", "x-custom": "keep",
  });
  assert.deepEqual(out, { accept: "text/html", "user-agent": "test", "x-custom": "keep" });
  assert.ok(!("cookie" in out), "the dashboard session must not reach a mirrored dev server");
  assert.ok(!("authorization" in out));
});

test("response headers: the decoded body must not keep its old content-encoding/length", () => {
  // fetch() decompresses; forwarding `content-encoding: gzip` makes the browser try to
  // gunzip plain bytes — the classic silent-corruption bug in a naive proxy.
  const out = forwardResponseHeaders({
    "content-type": "text/html", "content-encoding": "gzip", "content-length": "999",
    "set-cookie": "sid=1", "x-frame-options": "DENY", "content-security-policy": "default-src 'none'",
    etag: 'W/"abc"',
  });
  assert.deepEqual(out, { "content-type": "text/html", etag: 'W/"abc"' });
});

test("rewriteLocation keeps redirects inside the mirror", () => {
  assert.equal(rewriteLocation("/login", 3002), "/mirror/3002/login");
  assert.equal(rewriteLocation("/a?b=1", 3002), "/mirror/3002/a?b=1");
  // Absolute back at the same dev server → re-rooted.
  assert.equal(rewriteLocation("http://localhost:3002/dash", 3002), "/mirror/3002/dash");
  // Somewhere else entirely → untouched.
  assert.equal(rewriteLocation("https://github.com/login", 3002), "https://github.com/login");
  // Relative → <base> already covers it.
  assert.equal(rewriteLocation("next", 3002), "next");
  assert.equal(rewriteLocation(undefined, 3002), undefined);
});

test("injectBase puts a <base> in, without fighting a page that has one — and always adds the runtime script too", () => {
  assert.match(injectBase("<html><head><title>x</title></head></html>", 3002), /<head><base href="\/mirror\/3002\/"><script>/);
  const withOwnBase = injectBase(`<html><head><base href="/x/"></head></html>`, 3002);
  assert.equal(withOwnBase.match(/<base/g).length, 1, "doesn't fight a page that sets its own <base>");
  assert.match(withOwnBase, /<script>/, "the runtime patch still goes in even when <base> is skipped");
  assert.match(injectBase("<html><body>hi</body></html>", 3002), /<html><base href/);   // headless document
  const bare = injectBase("plain", 3002);
  assert.match(bare, /^<base href="\/mirror\/3002\/"><script>/);
  assert.ok(bare.endsWith("plain"), "the original content survives, appended after the injected tags");
});

test("mirrorRuntimeScript rewrites root-absolute fetch()/XHR calls to the mirror prefix, leaving everything else alone", () => {
  const script = mirrorRuntimeScript(3002);
  assert.match(script, /^<script>/);
  assert.match(script, /<\/script>$/);
  const body = script.slice("<script>".length, -"</script>".length);

  // Run the actual injected code against a fake window, exactly as a real browser would.
  const calls = { fetch: [], xhr: [] };
  const win = {
    fetch: (input, init) => { calls.fetch.push({ input, init }); return Promise.resolve("ok"); },
    XMLHttpRequest: function XMLHttpRequest() {},
  };
  win.XMLHttpRequest.prototype.open = function (method, url) { calls.xhr.push({ method, url }); };
  new Function("window", body)(win);

  win.fetch("/api/me", { cache: "no-store" });
  assert.equal(calls.fetch[0].input, "/mirror/3002/api/me", "a root-absolute fetch is rewritten under the mirror prefix");

  win.fetch("/mirror/3002/already-prefixed");
  assert.equal(calls.fetch[1].input, "/mirror/3002/already-prefixed", "an already-prefixed URL is left alone, not double-prefixed");

  win.fetch("relative/path");
  assert.equal(calls.fetch[2].input, "relative/path", "a relative URL (no leading slash) is untouched — <base> already resolves it");

  win.fetch({ notAUrl: true });
  assert.deepEqual(calls.fetch[3].input, { notAUrl: true }, "a non-string, non-Request input passes through unchanged rather than throwing");

  const xhr = new win.XMLHttpRequest();
  xhr.open("GET", "/api/data");
  assert.equal(calls.xhr[0].url, "/mirror/3002/api/data", "XMLHttpRequest.open is patched the same way as fetch");
});

test("mirrorRuntimeScript rewrites a same-origin WebSocket URL under the mirror prefix — the HMR-gates-hydration fix", () => {
  // Confirmed by direct reproduction against a real Next.js dev server: some framework client
  // runtimes hold hydration open on the dev-mode HMR WebSocket actually connecting, so a
  // same-origin `new WebSocket("ws://<host>/_next/webpack-hmr")` call — the mirrored page
  // believing it's talking to itself — has to be rewritten the same way fetch/XHR are, or real
  // functionality (not just live-reload) can silently never finish initializing.
  const script = mirrorRuntimeScript(3002);
  const body = script.slice("<script>".length, -"</script>".length);
  const wsCalls = [];
  function FakeWS(url, protocols) { wsCalls.push({ url, protocols }); }
  FakeWS.CONNECTING = 0; FakeWS.OPEN = 1; FakeWS.CLOSING = 2; FakeWS.CLOSED = 3;
  const win = {
    location: { href: "http://localhost:3001/mirror/3002/", host: "localhost:3001" },
    WebSocket: FakeWS,
  };
  new Function("window", "location", "URL", body)(win, win.location, URL);

  new win.WebSocket("ws://localhost:3001/_next/webpack-hmr?id=abc");
  assert.equal(wsCalls[0].url, "ws://localhost:3001/mirror/3002/_next/webpack-hmr?id=abc",
    "a same-origin websocket URL is rewritten under the mirror prefix, query string intact");

  new win.WebSocket("ws://localhost:3001/mirror/3002/already-prefixed");
  assert.equal(wsCalls[1].url, "ws://localhost:3001/mirror/3002/already-prefixed",
    "an already-prefixed URL is left alone, not double-prefixed");

  new win.WebSocket("wss://some-other-host.example.com/socket");
  assert.equal(wsCalls[2].url, "wss://some-other-host.example.com/socket",
    "a websocket to a DIFFERENT host (not talking to us) is left completely alone");

  new win.WebSocket("ws://localhost:3001/hmr", "graphql-ws");
  assert.equal(wsCalls[3].url, "ws://localhost:3001/mirror/3002/hmr");
  assert.equal(wsCalls[3].protocols, "graphql-ws", "the protocols argument still reaches the real constructor");

  assert.equal(win.WebSocket.OPEN, 1, "static constants (OPEN/CLOSED/…) survive onto the patched constructor");
});

test("buildMirrorResponse rewrites html, re-roots the redirect, and sets the sticky cookie", () => {
  const r = buildMirrorResponse({
    status: 302,
    headers: { "content-type": "text/html; charset=utf-8", location: "/login", "content-encoding": "br" },
    body: Buffer.from("<html><head></head></html>"),
  }, 3002);
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, "/mirror/3002/login");
  assert.ok(!("content-encoding" in r.headers));
  assert.equal(r.headers["set-cookie"], `${MIRROR_COOKIE}=3002; Path=/; SameSite=Lax`);
  assert.match(r.body.toString(), /<base href="\/mirror\/3002\/">/);
});

test("buildMirrorResponse leaves non-html bodies byte-identical", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
  const r = buildMirrorResponse({ status: 200, headers: { "content-type": "image/png" }, body: png }, 3002);
  assert.deepEqual(r.body, png, "binary must not be round-tripped through a string");
});

test("mirrorFromReferer claims requests a mirrored page demonstrably made", () => {
  // /assets/app.js requested by a mirrored page — the case that was broken.
  assert.equal(mirrorFromReferer({ referer: "http://localhost:3001/mirror/3002/" }), 3002);
  // Two mirrors open at once: each request goes to the page that made it.
  assert.equal(mirrorFromReferer({ referer: "http://localhost:3001/mirror/4001/", cookie: `${MIRROR_COOKIE}=3002` }), 4001);
  // The dashboard's own requests are never claimed.
  assert.equal(mirrorFromReferer({ referer: "http://localhost:3001/" }), null);
  assert.equal(mirrorFromReferer({ cookie: `${MIRROR_COOKIE}=3002` }), null, "the cookie is not this function's business");
  assert.equal(mirrorFromReferer({}), null);
});

test("mirrorFromCookie covers the nested case Referer cannot reach", () => {
  // A stylesheet's @import: the Referer is the stylesheet, not the mirrored page.
  assert.equal(mirrorFromCookie({ referer: "http://localhost:3001/assets/app.css", cookie: `${MIRROR_COOKIE}=3002` }), 3002);
  assert.equal(mirrorFromCookie({}), null);
});

test("the cookie is a WEAKER signal than the Referer, and must be consulted later", () => {
  // Regression, found by loading the real page: after viewing a mirror once, the sticky
  // cookie rides along on every dashboard request too. If it were consulted before the
  // dashboard's own static files, /app.js would be answered with the MIRRORED site's
  // app.js — a silent 200 serving the wrong bytes, breaking the dashboard entirely.
  const dashboardRequest = { referer: "http://localhost:3001/", cookie: `${MIRROR_COOKIE}=3002` };
  assert.equal(mirrorFromReferer(dashboardRequest), null, "referer proves this came from the dashboard");
  assert.equal(mirrorFromCookie(dashboardRequest), 3002, "the cookie alone cannot tell — so it must be checked last");
});

test("REGRESSION: mirrorFromReferer now fires on navigations too — clicking a link inside a mirrored SPA must reach it, not 404 on the dashboard", () => {
  // Reproduces the exact production bug: a framework router (Next.js's <Link>, or a plain
  // <a href="/codex">) inside a mirrored app navigates using a root-absolute path — a real
  // navigation (sec-fetch-mode: navigate), because the app has no idea it's mirrored. The OLD
  // exclusion sent this straight to the dashboard's own routes, 404ing on every single in-app
  // navigation ("clicking the codex button throws a not found").
  assert.equal(mirrorFromReferer({ referer: "http://localhost:3001/mirror/3002/", "sec-fetch-mode": "navigate" }), 3002);
});

test("mirrorFromCookie also fires on navigations now — the second-hop case, where the framework's router already rewrote the address bar once so THIS request's own Referer no longer looks like a mirror path", () => {
  assert.equal(mirrorFromCookie({ cookie: `${MIRROR_COOKIE}=3002`, "sec-fetch-mode": "navigate" }), 3002);
});

test("a navigation with NEITHER a mirror-shaped Referer NOR the cookie set still resolves to null — an actually-mistyped dashboard URL is unaffected", () => {
  assert.equal(mirrorFromReferer({ referer: "http://localhost:3001/", "sec-fetch-mode": "navigate" }), null);
  assert.equal(mirrorFromCookie({ "sec-fetch-mode": "navigate" }), null);
});

test("both signals refuse ports the registry doesn't list", () => {
  const allowed = [3002, 4001];
  assert.equal(mirrorFromReferer({ referer: "http://localhost:3001/mirror/3002/" }, { allowedPorts: allowed }), 3002);
  assert.equal(mirrorFromReferer({ referer: "http://localhost:3001/mirror/9999/" }, { allowedPorts: allowed }), null);
  // A stale cookie must not turn the dashboard into a proxy for any local port.
  assert.equal(mirrorFromCookie({ cookie: `${MIRROR_COOKIE}=22` }, { allowedPorts: allowed }), null);
});

test("stripNamedCookies removes only the named cookie(s), keeping everything else in the jar intact", () => {
  assert.equal(
    stripNamedCookies(`cm_admin_session=SECRET; ${MIRROR_COOKIE}=3002; other=1`, ["cm_admin_session"]),
    `${MIRROR_COOKIE}=3002; other=1`,
  );
  // Matching is by name, not by substring — a cookie name merely containing the dropped name
  // must survive.
  assert.equal(stripNamedCookies("cm_admin_session_extra=x", ["cm_admin_session"]), "cm_admin_session_extra=x");
  // Dropping the ONLY cookie present collapses to undefined (an empty header is not a header).
  assert.equal(stripNamedCookies("cm_admin_session=SECRET", ["cm_admin_session"]), undefined);
  // No names to drop, or no header at all: passed through unchanged.
  assert.equal(stripNamedCookies("a=1; b=2", []), "a=1; b=2");
  assert.equal(stripNamedCookies(undefined, ["x"]), undefined);
  // Multiple names, case-insensitive.
  assert.equal(
    stripNamedCookies("CM_Admin_Session=x; keep=1; cm_admin_login=y", ["cm_admin_session", "cm_admin_login"]),
    "keep=1",
  );
});

test("forwardUpgradeHeaders keeps connection/upgrade/sec-websocket-* (a regular forward correctly drops these), and filters cookies by name instead of dropping the whole header", () => {
  // REGRESSION: confirmed by direct reproduction against a real Next.js dev server that its HMR
  // upgrade handshake silently never finishes hydration-unblocking handoff when the cookie
  // header is dropped wholesale (the way forwardRequestHeaders correctly does for a regular
  // request) — even though the raw socket handshake itself (101) succeeds either way. Forwarding
  // the cookie jar (minus the dashboard's own named session cookie) fixed it.
  const out = forwardUpgradeHeaders({
    host: "localhost:3001", connection: "Upgrade", upgrade: "websocket",
    "sec-websocket-key": "abc==", "sec-websocket-version": "13",
    cookie: `cm_admin_session=SECRET; ${MIRROR_COOKIE}=3002`, authorization: "Bearer SECRET",
    "user-agent": "test",
  }, { dropCookieNames: ["cm_admin_session"] });
  assert.equal(out.connection, "Upgrade", "the handshake headers must survive, unlike a regular forward");
  assert.equal(out.upgrade, "websocket");
  assert.equal(out["sec-websocket-key"], "abc==");
  assert.equal(out["sec-websocket-version"], "13");
  assert.equal(out.cookie, `${MIRROR_COOKIE}=3002`, "the session cookie is filtered out by name; the rest of the jar rides along");
  assert.ok(!("host" in out), "host is still rewritten by buildUpgradeRequest, not carried through as-is");
  assert.ok(!("authorization" in out), "the dashboard's bearer credential still never reaches a site being merely displayed");
  assert.equal(out["user-agent"], "test");
});

test("forwardUpgradeHeaders forwards the cookie header as-is when no names are given to drop", () => {
  const out = forwardUpgradeHeaders({ cookie: `${MIRROR_COOKIE}=3002` });
  assert.equal(out.cookie, `${MIRROR_COOKIE}=3002`);
});

test("buildUpgradeRequest writes a well-formed HTTP/1.1 upgrade request, host rewritten, cookie filtered", () => {
  const text = buildUpgradeRequest({
    method: "GET", path: "/_next/webpack-hmr?id=abc",
    headers: { host: "localhost:3001", cookie: `cm_admin_session=SECRET; ${MIRROR_COOKIE}=3002`, connection: "Upgrade", upgrade: "websocket" },
    host: "127.0.0.1", port: 3005, dropCookieNames: ["cm_admin_session"],
  });
  assert.match(text, /^GET \/_next\/webpack-hmr\?id=abc HTTP\/1\.1\r\n/);
  assert.match(text, /host: 127\.0\.0\.1:3005/i);
  assert.match(text, new RegExp(`cookie: ${MIRROR_COOKIE}=3002`));
  assert.ok(!text.includes("SECRET"), "the dashboard's own session cookie must never reach the mirrored dev server");
  assert.match(text, /connection: Upgrade/i);
  assert.ok(text.endsWith("\r\n\r\n"), "the request text ends with the blank line terminating the headers");
});

test("websocketAccept computes the standard RFC 6455 handshake value", () => {
  // The exact example from RFC 6455 §1.3 — a fixed, known-correct input/output pair.
  assert.equal(websocketAccept("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  // Deterministic: the same key always produces the same accept value.
  assert.equal(websocketAccept("abc=="), websocketAccept("abc=="));
  assert.notEqual(websocketAccept("abc=="), websocketAccept("xyz=="));
});

test("mirrorForwardedHeaders gives a mirrored app the ACTUAL browser-facing origin + its own mount prefix", () => {
  // REGRESSION: confirmed in production — Mnemosyne's own login route derives its OAuth
  // redirect_uri from the request (specifically so it's portable), but without these headers
  // it saw ONLY this proxy's own loopback address, built a redirect_uri missing the mirror's
  // prefix, and the identity provider correctly refused it as unregistered for that client —
  // "Login with AncientHub" landed on the hub's own {"error":"invalid_request"}.
  assert.deepEqual(
    mirrorForwardedHeaders({ host: "127.0.0.1:3001" }, 3005),
    { "x-forwarded-host": "127.0.0.1:3001", "x-forwarded-proto": "http", "x-forwarded-prefix": "/mirror/3005" },
  );
  // Behind the live relay, nginx has ALREADY set x-forwarded-host/proto to the real public
  // address — that must win over the relay's own (internal) Host header.
  assert.deepEqual(
    mirrorForwardedHeaders({ host: "127.0.0.1:8080", "x-forwarded-host": "brain.ancientholdings.eu", "x-forwarded-proto": "https" }, 3005),
    { "x-forwarded-host": "brain.ancientholdings.eu", "x-forwarded-proto": "https", "x-forwarded-prefix": "/mirror/3005" },
  );
  // No host at all (shouldn't happen for a real request, but must not throw) — empty host,
  // http default, prefix still correct.
  assert.deepEqual(
    mirrorForwardedHeaders({}, 3005),
    { "x-forwarded-host": "", "x-forwarded-proto": "http", "x-forwarded-prefix": "/mirror/3005" },
  );
});
