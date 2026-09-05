// node --test lib/reverseTunnel.test.mjs
// End-to-end: a target server (stands in for dmp-main) + a public server with attachReverseTunnel (dmp-remote)
// + a bridge (AncientIntel) dialing out — proving a request through the public server is relayed to the target
// and streamed back, with no bridge → graceful fallback, and a wrong secret → rejected.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { attachReverseTunnel, startReverseTunnelBridge } from "./reverseTunnel.mjs";

const SECRET = "test-secret-at-least-16-chars-long";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listen = (srv) => new Promise((res) => srv.listen(0, "127.0.0.1", () => res(srv.address().port)));
const waitFor = async (fn, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(30); } return false; };

let target, pub, tunnel, bridge, targetPort, pubPort;

before(async () => {
  // target = dmp-main: echoes method + path + body, sets a marker header
  target = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      res.writeHead(200, { "content-type": "text/plain", "x-target": "hit" });
      res.end("M=" + req.method + " P=" + req.url + " B=" + body);
    });
  });
  targetPort = await listen(target);
  // pub = dmp-remote: relay through the tunnel; fall back to 503 when no bridge
  pub = http.createServer(async (req, res) => {
    if (await tunnel.forward(req, res)) return;
    res.writeHead(503, { "content-type": "text/plain" }); res.end("fallback");
  });
  tunnel = attachReverseTunnel(pub, { path: "/dmp-agent", secret: SECRET });
  pubPort = await listen(pub);
});

after(async () => {
  try { bridge && bridge.stop(); } catch {}
  await new Promise((r) => pub.close(r));
  await new Promise((r) => target.close(r));
});

test("no bridge connected → forward() returns false → caller falls back (503)", async () => {
  assert.equal(tunnel.isBridgeConnected(), false);
  const r = await fetch(`http://127.0.0.1:${pubPort}/anything`);
  assert.equal(r.status, 503);
  assert.equal(await r.text(), "fallback");
});

test("wrong secret is rejected — the bridge never connects", async () => {
  const bad = startReverseTunnelBridge({ url: `ws://127.0.0.1:${pubPort}/dmp-agent`, secret: "wrong-secret-also-16chars", targetOrigin: `http://127.0.0.1:${targetPort}` });
  const connected = await waitFor(() => tunnel.isBridgeConnected(), 800);
  bad.stop();
  assert.equal(connected, false, "a bridge with the wrong secret must NOT be accepted");
});

test("correct bridge connects; a GET is relayed to the target and streamed back", async () => {
  bridge = startReverseTunnelBridge({ url: `ws://127.0.0.1:${pubPort}/dmp-agent`, secret: SECRET, targetOrigin: `http://127.0.0.1:${targetPort}` });
  assert.ok(await waitFor(() => tunnel.isBridgeConnected(), 3000), "bridge should connect");
  const r = await fetch(`http://127.0.0.1:${pubPort}/coverage?x=1`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-target"), "hit", "target's response headers pass through");
  assert.equal(await r.text(), "M=GET P=/coverage?x=1 B=");
});

test("a POST request body round-trips through the tunnel to the target", async () => {
  const r = await fetch(`http://127.0.0.1:${pubPort}/save`, { method: "POST", body: "hello-body" });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "M=POST P=/save B=hello-body");
});

test("after the bridge stops, forward() falls back again", async () => {
  bridge.stop(); bridge = null;
  assert.ok(await waitFor(() => !tunnel.isBridgeConnected(), 2000), "bridge should drop");
  const r = await fetch(`http://127.0.0.1:${pubPort}/x`);
  assert.equal(r.status, 503);
  assert.equal(await r.text(), "fallback");
});
