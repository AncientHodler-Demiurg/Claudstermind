// node --test lib/mirror.integration.test.mjs
//
// The mirror against a REAL dev server that behaves like Vite: root-absolute asset
// paths, a root-absolute fetch, a gzipped response, a redirect, a form POST. These are
// precisely the cases `<base href>` alone cannot fix, so this file is the regression
// guard for the routing rework.
//
// The host server below reproduces the dashboard's route ORDER — own routes first, then
// the explicit /mirror/<port>/ prefix, then the provenance fallback, then static. Order
// is the design here, so it has to be part of the test.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { gzipSync } from "node:zlib";
import {
  parseMirrorPath, mirrorFromReferer, mirrorFromCookie, forwardRequestHeaders, buildMirrorResponse, MIRROR_COOKIE,
} from "./mirror.mjs";

const PAGE = `<!doctype html><html><head><title>App</title>
<link rel="stylesheet" href="/assets/app.css"><script type="module" src="/assets/app.js"></script>
</head><body><form method="POST" action="/submit"><button>go</button></form></body></html>`;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0xfe, 0xff, 0x00]);

/** A stand-in for a Vite/Next dev server. */
function startDevServer() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(PAGE);
    }
    if (req.url === "/assets/app.js") {
      // Gzipped, to prove the proxy doesn't hand the browser a stale content-encoding.
      const body = gzipSync(Buffer.from('import "./nested.js"; export const x = 1;'));
      res.writeHead(200, { "content-type": "text/javascript", "content-encoding": "gzip", "content-length": String(body.length) });
      return res.end(body);
    }
    if (req.url === "/assets/app.css") {
      res.writeHead(200, { "content-type": "text/css" });
      return res.end('@import "/assets/theme.css"; body{color:red}');
    }
    if (req.url === "/assets/theme.css") {
      res.writeHead(200, { "content-type": "text/css" });
      return res.end("body{background:blue}");
    }
    if (req.url === "/logo.png") {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(PNG);
    }
    if (req.url === "/api/data") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ from: "dev-server" }));
    }
    if (req.url === "/old") {
      res.writeHead(302, { location: "/new" });
      return res.end();
    }
    if (req.method === "POST" && req.url === "/submit") {
      const c = [];
      req.on("data", (d) => c.push(d));
      return req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ got: Buffer.concat(c).toString() }));
      });
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("dev 404");
  });
  return { srv, seen };
}

/** A stand-in for the dashboard: its own routes, then the mirror, then static. */
function startHost(devPort) {
  const proxy = async (req, res, port, target) => {
    const body = ["GET", "HEAD"].includes(req.method)
      ? undefined
      : await new Promise((done) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => done(Buffer.concat(c))); });
    const r = await fetch(`http://127.0.0.1:${port}${target}`, {
      method: req.method, headers: forwardRequestHeaders(req.headers), body, redirect: "manual",
    });
    const out = buildMirrorResponse(
      { status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) },
      port,
    );
    res.writeHead(out.status, out.headers);
    res.end(out.body);
  };

  // The route ORDER is the design; see lib/mirror.mjs.
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const path = url.pathname;
    const opts = { allowedPorts: [devPort] };

    // 1. The explicit mirror prefix.
    const hit = parseMirrorPath(path);
    if (hit) return proxy(req, res, hit.port, hit.sub + (url.search || ""));
    // 2. Provably made BY a mirrored page — beats our own routes.
    const fromPage = mirrorFromReferer(req.headers, opts);
    if (fromPage) return proxy(req, res, fromPage, path + (url.search || ""));
    // 3. Our own API.
    if (path === "/api/version") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ version: "test", from: "dashboard" }));
    }
    // 4. Our own static files — BEFORE the cookie, so a stale one can't shadow them.
    if (path === "/app.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      return res.end("// the dashboard's own app.js");
    }
    // 5. Only now the sticky cookie, for paths we have nothing for.
    const sticky = mirrorFromCookie(req.headers, opts);
    if (sticky) return proxy(req, res, sticky, path + (url.search || ""));
    // 6. 404.
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("dashboard 404");
  });
  return srv;
}

async function listen(srv) {
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return srv.address().port;
}

/** GET with arbitrary headers — including ones the Fetch spec forbids a script from setting. */
function rawGet(port, path, headers) {
  return new Promise((done, fail) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => done({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", fail);
    req.end();
  });
}

test("mirror proxies a real dev server end to end", async (t) => {
  const { srv: dev, seen } = startDevServer();
  const devPort = await listen(dev);
  const host = startHost(devPort);
  const hostPort = await listen(host);
  const base = `http://127.0.0.1:${hostPort}`;
  const pageUrl = `${base}/mirror/${devPort}/`;
  t.after(async () => { await new Promise((r) => dev.close(r)); await new Promise((r) => host.close(r)); });

  await t.test("the page loads and gets a <base> for relative URLs", async () => {
    const r = await fetch(pageUrl);
    const html = await r.text();
    assert.equal(r.status, 200);
    assert.match(html, new RegExp(`<base href="/mirror/${devPort}/">`));
    assert.equal(r.headers.get("set-cookie"), `${MIRROR_COOKIE}=${devPort}; Path=/; SameSite=Lax`);
  });

  await t.test("a ROOT-ABSOLUTE asset resolves via Referer — the bug this rework fixes", async () => {
    // The browser asks the DASHBOARD for /assets/app.js because the path is absolute.
    // Before the rework this 404'd (or hit a dashboard route); now provenance routes it.
    const r = await fetch(`${base}/assets/app.js`, { headers: { referer: pageUrl } });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /export const x = 1/);
    // The body was decompressed by fetch, so the encoding header must NOT be passed on.
    assert.equal(r.headers.get("content-encoding"), null);
    assert.equal(r.headers.get("content-type"), "text/javascript");
  });

  await t.test("a nested resource resolves via the sticky cookie, where Referer can't help", async () => {
    // @import inside app.css: the Referer is the stylesheet, not the mirrored page.
    const r = await fetch(`${base}/assets/theme.css`, {
      headers: { referer: `${base}/assets/app.css`, cookie: `${MIRROR_COOKIE}=${devPort}` },
    });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "body{background:blue}");
  });

  await t.test("a root-absolute fetch() from the mirrored app reaches the dev server", async () => {
    const r = await fetch(`${base}/api/data`, { headers: { referer: pageUrl } });
    assert.deepEqual(await r.json(), { from: "dev-server" });
  });

  await t.test("a mirrored page's own /api/version reaches the mirrored server, not ours", async () => {
    // Provenance beats path: this request was demonstrably made BY the mirrored page.
    const r = await fetch(`${base}/api/version`, { headers: { referer: pageUrl } });
    assert.equal(r.status, 404);
    assert.equal(await r.text(), "dev 404", "the mirrored site owns its own URL space");
  });

  await t.test("the dashboard's own /api/version is untouched", async () => {
    const r = await fetch(`${base}/api/version`, { headers: { referer: `${base}/` } });
    assert.deepEqual(await r.json(), { version: "test", from: "dashboard" });
  });

  await t.test("a stale mirror cookie must NOT shadow the dashboard's own assets", async () => {
    // Regression, found by loading the real page: with the cookie checked too early, this
    // returned the MIRRORED site's app.js with a 200 — silently breaking the dashboard for
    // the rest of the session.
    const r = await fetch(`${base}/app.js`, {
      headers: { referer: `${base}/`, cookie: `${MIRROR_COOKIE}=${devPort}` },
    });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "// the dashboard's own app.js");
  });

  await t.test("form POSTs work, body and all", async () => {
    const r = await fetch(`${base}/submit`, {
      method: "POST", headers: { referer: pageUrl, "content-type": "text/plain" }, body: "hello=world",
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { got: "hello=world" });
  });

  await t.test("redirects stay inside the mirror", async () => {
    const r = await fetch(`${base}/mirror/${devPort}/old`, { redirect: "manual" });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), `/mirror/${devPort}/new`);
  });

  await t.test("binary assets survive byte-for-byte", async () => {
    const r = await fetch(`${base}/logo.png`, { headers: { referer: pageUrl } });
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
  });

  await t.test("REGRESSION: a navigation to an unknown path, with mirror evidence present, now reaches the mirror instead of always 404ing on the dashboard", async () => {
    // This used to assert the OPPOSITE — navigations were entirely excluded from mirror
    // routing, which meant clicking any in-app link in a mirrored SPA (a root-absolute
    // navigation the framework's router made, with no idea it's mirrored) always 404'd on the
    // dashboard instead of reaching the app ("clicking the codex button throws a not found",
    // confirmed in production). The cookie is only ever consulted after every real dashboard
    // route AND static file has already refused the path (see startHost's route order above),
    // so this can only ever claim what would otherwise be a bare 404 anyway.
    // Raw http.request, not fetch: `sec-fetch-mode` is a forbidden header name, and undici
    // rewrites it to "cors" — only a real browser (or this) can send "navigate".
    const r = await rawGet(hostPort, "/nope", {
      cookie: `${MIRROR_COOKIE}=${devPort}`, "sec-fetch-mode": "navigate",
    });
    assert.equal(r.status, 404);
    assert.equal(r.body, "dev 404", "reaches the mirrored dev server's own 404, not the dashboard's");
  });

  await t.test("a genuinely mistyped dashboard URL — no mirror cookie, no mirror referer — still 404s on the dashboard", async () => {
    const r = await rawGet(hostPort, "/nope", { "sec-fetch-mode": "navigate" });
    assert.equal(r.status, 404);
    assert.equal(r.body, "dashboard 404");
  });

  await t.test("the dashboard's session cookie is never forwarded to the dev server", async () => {
    seen.length = 0;
    await fetch(`${base}/api/data`, { headers: { referer: pageUrl, cookie: "cm_session=TOPSECRET" } });
    const got = seen.find((s) => s.url === "/api/data");
    assert.ok(got, "the dev server saw the request");
    assert.equal(got.headers.cookie, undefined, "session cookie must not leak into a mirrored site");
  });
});
