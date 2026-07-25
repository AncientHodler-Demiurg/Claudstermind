// node --test relay/mirror-ws.integration.test.mjs
//
// The remote/tunnel half of the mirror's WebSocket relay: a real browser-shaped `ws` client,
// through a real relay, over a real agent-to-relay tunnel, to a real `ws` echo server standing
// in for a mirrored dev server's own HMR socket. Root-caused a real "the mirrored site's login
// button never appears, even after updating and restarting everything" report specifically for
// this path: the local dashboard's direct mirror got its own WebSocket relay, but this file
// (the remote path a phone/browser actually uses) had no equivalent at all — see
// dashboard/server.mjs's server.on("upgrade", …) for the local half, and this file's own
// server.on("upgrade", …) for what this test proves.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { createRelay } from "./server.mjs";
import { createBridge } from "../agent/agent.mjs";
import { signSession, SESSION_COOKIE } from "../dashboard/auth/session.mjs";

const DEVICE = "device-secret-at-least-32-chars-long!!";
const OIDC = {
  issuer: "https://hub.test", clientId: "c", clientSecret: "s",
  redirectUri: "https://brain.test/auth/callback", sessionSecret: "test-session-secret-at-least-32-chars!!", scope: "openid",
};
const waitFor = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 40)); }
  return false;
};

/** A stand-in for a mirrored dev server: answers plain HTTP (so the mirror can register its
 *  port the same way a browser's first page load would) and echoes over its own WebSocket. */
function startDevServer() {
  let sawCookieHeader;
  const http_ = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/plain" }); res.end("dev server"); });
  const wss = new WebSocketServer({ server: http_, path: "/socket" });
  wss.on("connection", (sock, req) => {
    sawCookieHeader = req.headers.cookie;
    sock.on("message", (data) => sock.send(`echo:${data}`));
  });
  return { http_, wss, cookieSeen: () => sawCookieHeader };
}

async function setup(t) {
  const dev = startDevServer();
  const devPort = await new Promise((r) => dev.http_.listen(0, "127.0.0.1", () => r(dev.http_.address().port)));
  t.after(() => dev.http_.close());

  // agent/agent.mjs's handleMirrorWsOpen only opens a connection to a port `mirrorablePorts()`
  // (lib/localhost.mjs) actually lists — reading a real `LocalHost/registry.json` beside the
  // repo root in production. A scratch root with a fake registry naming this test's ephemeral
  // dev port is the equivalent stand-in, so this test exercises the REAL allowlist check
  // instead of bypassing it.
  const root = mkdtempSync(join(tmpdir(), "cm-mirror-ws-"));
  mkdirSync(join(root, "LocalHost"));
  writeFileSync(join(root, "LocalHost", "registry.json"), JSON.stringify({
    aggregator: { port: 3000 },
    projects: [{ key: "devtest", name: "devtest", port: devPort, managed: true }],
  }));

  const relay = createRelay({ oidc: OIDC, deviceSecret: DEVICE });
  await new Promise((r) => relay.server.listen(0, "127.0.0.1", r));
  const relayPort = relay.server.address().port;
  const base = `http://127.0.0.1:${relayPort}`;
  t.after(() => relay.server.close());

  const bridge = createBridge({
    url: `ws://127.0.0.1:${relayPort}/agent`, deviceSecret: DEVICE, allowInsecure: true,
    snapshotIntervalMs: 10_000, buildSnapshot: async () => ({ ok: true }), log: () => {},
    paths: { root, dataDir: root, secretsDir: root, orchDir: root },
    workspace: { send: null, handleIn() {} },
  }).start();
  t.after(() => bridge.stop());
  assert.ok(await waitFor(async () => (await (await fetch(`${base}/api/me`)).json()).localConnected), "bridge should connect");

  const ancient = `${SESSION_COOKIE}=${await signSession({ sub: "a", roles: ["ancient"], name: "A" }, OIDC.sessionSecret)}`;
  const modern = `${SESSION_COOKIE}=${await signSession({ sub: "m", roles: ["modern"], name: "M" }, OIDC.sessionSecret)}`;

  // Register the dev port with the relay's mirror allowlist the same way a real browser would —
  // by actually visiting the mirrored page first — before any WebSocket upgrade is attempted.
  const page = await fetch(`${base}/mirror/${devPort}/`, { headers: { cookie: ancient } });
  assert.equal(page.status, 200);

  return { relayPort, devPort, base, ancient, modern, dev };
}

test("mirror WebSocket relay: a real client, through the relay, over the tunnel, talks to a real dev server end to end", async (t) => {
  const { relayPort, devPort, ancient } = await setup(t);

  const client = new WebSocket(`ws://127.0.0.1:${relayPort}/mirror/${devPort}/socket`, { headers: { cookie: ancient } });
  t.after(() => client.close());
  await new Promise((resolve_, reject) => {
    client.on("open", () => client.send("hello"));
    client.on("message", (data) => {
      try {
        assert.equal(String(data), "echo:hello", "a message round-trips relay → tunnel → real dev server and back");
        resolve_();
      } catch (e) { reject(e); }
    });
    client.on("error", reject);
    setTimeout(() => reject(new Error("timed out waiting for the echo")), 5000);
  });
});

test("mirror WebSocket relay: the dashboard's own session cookie never reaches the dev server, the rest of the jar does", async (t) => {
  const { relayPort, devPort, ancient, dev } = await setup(t);

  const client = new WebSocket(`ws://127.0.0.1:${relayPort}/mirror/${devPort}/socket`, {
    headers: { cookie: `${ancient}; some_other=1` },
  });
  t.after(() => client.close());
  await new Promise((resolve_, reject) => {
    client.on("open", () => client.send("ping"));
    client.on("message", () => resolve_());
    client.on("error", reject);
    setTimeout(() => reject(new Error("timed out")), 5000);
  });

  const cookieSeen = dev.cookieSeen();
  assert.ok(cookieSeen, "the dev server saw a cookie header at all — not dropped wholesale");
  assert.ok(!cookieSeen.includes(SESSION_COOKIE), "the dashboard's own session cookie must never reach the mirrored dev server");
  assert.match(cookieSeen, /some_other=1/, "the rest of the cookie jar still rides along");
});

test("mirror WebSocket relay: a modern (read-only) session is refused, never reaching the dev server", async (t) => {
  const { relayPort, devPort, modern } = await setup(t);

  const client = new WebSocket(`ws://127.0.0.1:${relayPort}/mirror/${devPort}/socket`, { headers: { cookie: modern } });
  let opened = false;
  await new Promise((resolve_) => {
    client.on("open", () => { opened = true; resolve_(); });
    client.on("error", () => resolve_());
    client.on("close", () => resolve_());
    setTimeout(resolve_, 2000);
  });
  assert.equal(opened, false, "must not have opened for a read-only (modern) session");
  assert.notEqual(client.readyState, WebSocket.OPEN);
});

test("mirror WebSocket relay: a port the relay has never seen registered is refused", async (t) => {
  const { relayPort, ancient } = await setup(t);

  const client = new WebSocket(`ws://127.0.0.1:${relayPort}/mirror/59999/socket`, { headers: { cookie: ancient } });
  let opened = false;
  await new Promise((resolve_) => {
    client.on("open", () => { opened = true; resolve_(); });
    client.on("error", () => resolve_());
    client.on("close", () => resolve_());
    setTimeout(resolve_, 2000);
  });
  assert.equal(opened, false, "must not have opened for a port the relay hasn't learned about");
  assert.notEqual(client.readyState, WebSocket.OPEN);
});
