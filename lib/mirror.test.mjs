// node --test lib/mirror.test.mjs — URL routing and header hygiene for the mirror proxy.
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMirrorPath, mirrorPortFromReferer, mirrorPortFromCookie,
  forwardRequestHeaders, forwardResponseHeaders, rewriteLocation, injectBase,
  buildMirrorResponse, mirrorFromReferer, mirrorFromCookie, MIRROR_COOKIE,
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

test("injectBase puts a <base> in, without fighting a page that has one", () => {
  assert.match(injectBase("<html><head><title>x</title></head></html>", 3002), /<head><base href="\/mirror\/3002\/">/);
  assert.equal(injectBase(`<html><head><base href="/x/"></head></html>`, 3002).match(/<base/g).length, 1);
  assert.match(injectBase("<html><body>hi</body></html>", 3002), /<html><base href/);   // headless document
  assert.match(injectBase("plain", 3002), /^<base href="\/mirror\/3002\/">plain$/);
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
