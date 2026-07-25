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
import net from "node:net";
import { gzipSync } from "node:zlib";
import { WebSocketServer, WebSocket } from "ws";
import {
  parseMirrorPath, mirrorFromReferer, mirrorFromCookie, forwardRequestHeaders, buildMirrorResponse, MIRROR_COOKIE,
  buildUpgradeRequest,
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

// ---- WebSocket relay: the fix for hydration silently never completing without a working
// HMR-shaped connection (see lib/mirror.mjs's mirrorRuntimeScript comment) ----
//
// Confirmed by direct reproduction against a real Next.js dev server: some framework client
// runtimes hold Client Component hydration open on the dev-mode HMR WebSocket actually
// connecting. This mirrors dashboard/server.mjs's own `server.on("upgrade", …)` — a raw TCP
// relay, not an http.request — against a REAL `ws` echo server, proving actual bytes round-trip
// through `/mirror/<port>/…`, not just that the code compiles.
test("WebSocket upgrade relay: a real client, through /mirror/<port>/…, talks to a real ws server end to end", async (t) => {
  const echoPort = await new Promise((resolve_, reject) => {
    const wss = new WebSocketServer({ port: 0 }, () => resolve_(wss));
  }).then((wss) => {
    wss.on("connection", (sock) => {
      sock.on("message", (data) => sock.send(`echo:${data}`));
    });
    t.after(() => wss.close());
    return wss.address().port;
  });

  // The same relay dashboard/server.mjs's server.on("upgrade", …) implements, by hand — a raw
  // TCP proxy to the dev server, using buildUpgradeRequest for the handshake text.
  const host = http.createServer((req, res) => { res.writeHead(404); res.end("not a websocket"); });
  host.on("upgrade", (req, clientSocket, head) => {
    const hit = parseMirrorPath(new URL(req.url, "http://localhost").pathname);
    if (!hit) { clientSocket.destroy(); return; }
    const upstream = net.connect(hit.port, "127.0.0.1", () => {
      upstream.write(buildUpgradeRequest({
        method: req.method, path: hit.sub, headers: req.headers, host: "127.0.0.1", port: hit.port,
      }));
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.destroy());
  });
  const hostPort = await new Promise((r) => host.listen(0, "127.0.0.1", () => r(host.address().port)));
  t.after(() => host.close());

  const client = new WebSocket(`ws://127.0.0.1:${hostPort}/mirror/${echoPort}/socket`);
  t.after(() => client.close());
  await new Promise((resolve_, reject) => {
    client.on("open", () => client.send("hello"));
    client.on("message", (data) => {
      try {
        assert.equal(String(data), "echo:hello", "a message round-trips through the relay to the real dev server and back");
        resolve_();
      } catch (e) { reject(e); }
    });
    client.on("error", reject);
  });
});

test("WebSocket upgrade relay: the dashboard's own session cookie never reaches the mirrored dev server, but the rest of the cookie jar (its own sticky mirror cookie included) does", async (t) => {
  // REGRESSION: confirmed by direct reproduction against a real Next.js dev server that dropping
  // the ENTIRE cookie header on the upgrade (the way a regular HTTP forward correctly does)
  // leaves its HMR handshake completing at the raw-socket level but silently never finishing
  // whatever handoff Client Component hydration was waiting on — real app functionality left
  // permanently inert, not just live-reload lost. Forwarding the jar minus the dashboard's own
  // named session cookie fixed it; this proves BOTH halves through a real `ws` server that
  // reports back the raw cookie header it received on the upgrade request.
  let sawCookieHeader;
  const wss = new WebSocketServer({ port: 0 });
  const echoPort = await new Promise((r) => wss.on("listening", () => r(wss.address().port)));
  wss.on("connection", (sock, req) => { sawCookieHeader = req.headers.cookie; sock.send("connected"); });
  t.after(() => wss.close());

  const host = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  host.on("upgrade", (req, clientSocket, head) => {
    const hit = parseMirrorPath(new URL(req.url, "http://localhost").pathname);
    if (!hit) { clientSocket.destroy(); return; }
    const upstream = net.connect(hit.port, "127.0.0.1", () => {
      upstream.write(buildUpgradeRequest({
        method: req.method, path: hit.sub, headers: req.headers, host: "127.0.0.1", port: hit.port,
        dropCookieNames: ["cm_admin_session"],
      }));
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.destroy());
  });
  const hostPort = await new Promise((r) => host.listen(0, "127.0.0.1", () => r(host.address().port)));
  t.after(() => host.close());

  const client = new WebSocket(`ws://127.0.0.1:${hostPort}/mirror/${echoPort}/socket`, {
    headers: { cookie: `cm_admin_session=TOPSECRET; ${MIRROR_COOKIE}=${echoPort}` },
  });
  t.after(() => client.close());
  await new Promise((resolve_, reject) => {
    client.on("message", () => resolve_());
    client.on("error", reject);
  });

  assert.ok(sawCookieHeader, "the dev server saw a cookie header at all — it wasn't dropped wholesale");
  assert.ok(!sawCookieHeader.includes("TOPSECRET"), "the dashboard's own session cookie must never reach the mirrored dev server");
  assert.match(sawCookieHeader, new RegExp(`${MIRROR_COOKIE}=${echoPort}`), "the rest of the cookie jar still rides along");
});

test("WebSocket upgrade relay: an unrecognized path (not /mirror/<port>/…) gets its socket cleanly destroyed, not left hanging", async (t) => {
  const host = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  host.on("upgrade", (req, clientSocket) => {
    const hit = parseMirrorPath(new URL(req.url, "http://localhost").pathname);
    if (!hit) { clientSocket.destroy(); return; }
  });
  const hostPort = await new Promise((r) => host.listen(0, "127.0.0.1", () => r(host.address().port)));
  t.after(() => host.close());

  const client = new WebSocket(`ws://127.0.0.1:${hostPort}/not-a-mirror-path`);
  await new Promise((resolve_) => {
    client.on("error", () => resolve_());   // destroyed mid-handshake surfaces as a client error
    client.on("close", () => resolve_());
    setTimeout(resolve_, 2000);
  });
  assert.notEqual(client.readyState, WebSocket.OPEN, "the connection must never actually open for an unrecognized path");
});
