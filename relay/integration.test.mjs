// node --test relay/integration.test.mjs
//
// The end-to-end proof: a REAL relay + a REAL bridge on one machine, exercising the
// whole reverse tunnel. Ancient sessions and the device secret are forged locally
// (no hub, no deploy) — everything up to the live deployment is verified here.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRelay } from "./server.mjs";
import { createBridge } from "../agent/agent.mjs";
import { signSession, SESSION_COOKIE } from "../dashboard/auth/session.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const ORCH = resolve(__dir, "..", "orchestrator");
const DEVICE = "device-secret-at-least-32-chars-long!!";
const OIDC = {
  issuer: "https://hub.test", clientId: "c", clientSecret: "s",
  redirectUri: "https://brain.test/auth/callback",
  sessionSecret: "test-session-secret-at-least-32-chars!!", scope: "openid",
};

function tempWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "e2e-root-"));
  const dataDir = join(root, "data"); mkdirSync(dataDir);
  const brainDir = join(root, "brain"); mkdirSync(brainDir);
  const secretsDir = join(root, ".secrets"); mkdirSync(secretsDir);
  const repo = join(root, "repo"); mkdirSync(repo);
  const g = (...a) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  g("init", "-q"); g("symbolic-ref", "HEAD", "refs/heads/main");
  g("config", "user.email", "t@t.t"); g("config", "user.name", "t"); g("config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "a.txt"), "1"); g("add", "."); g("commit", "-qm", "init");
  writeFileSync(join(dataDir, "map.json"), JSON.stringify({ repos: [{ name: "repo", localPath: "repo" }] }));
  return { root, dataDir, brainDir, secretsDir, repo, g };
}

const waitFor = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
};

test("full tunnel: not-connected → connected → ancient executes → modern refused", async () => {
  const ws = tempWorkspace();
  const relay = createRelay({ oidc: OIDC, deviceSecret: DEVICE });
  await new Promise((r) => relay.server.listen(0, "127.0.0.1", r));
  const port = relay.server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const ancient = `${SESSION_COOKIE}=${await signSession({ sub: "a", roles: ["ancient"], name: "Anc" }, OIDC.sessionSecret)}`;
  const modern = `${SESSION_COOKIE}=${await signSession({ sub: "m", roles: ["modern"], name: "Mod" }, OIDC.sessionSecret)}`;

  // 1. Before the bridge connects: not connected, and a mutation is refused with 503.
  let me = await (await fetch(`${base}/api/me`, { headers: { cookie: ancient } })).json();
  assert.equal(me.localConnected, false);
  assert.equal(me.canExecute, true);
  const early = await fetch(`${base}/api/git/commit`, { method: "POST", headers: { cookie: ancient, "content-type": "application/json" }, body: JSON.stringify({ localPath: "repo", message: "x" }) });
  assert.equal(early.status, 503, "a mutation while disconnected must be 503");

  // 2. Connect the bridge against the temp workspace.
  const bridge = createBridge({
    url: `ws://127.0.0.1:${port}/agent`, deviceSecret: DEVICE, allowInsecure: true,
    snapshotIntervalMs: 500,
    paths: { root: ws.root, dataDir: ws.dataDir, brainDir: ws.brainDir, secretsDir: ws.secretsDir, orchDir: ORCH },
    log: () => {},
  }).start();

  const connected = await waitFor(async () => (await (await fetch(`${base}/api/me`, { headers: { cookie: ancient } })).json()).localConnected);
  assert.equal(connected, true, "the relay should report the bridge connected");

  // 3. A read view is served from the pushed snapshot.
  const gotGit = await waitFor(async () => {
    const g = await (await fetch(`${base}/api/git`, { headers: { cookie: ancient } })).json();
    return Array.isArray(g.repos) && g.repos.length >= 1;
  });
  assert.equal(gotGit, true, "the snapshot's git view should reach the browser");

  // The receiving-end indicator: /api/me exposes how fresh the last snapshot is.
  const meConn = await (await fetch(`${base}/api/me`, { headers: { cookie: ancient } })).json();
  assert.equal(typeof meConn.snapshotAgeMs, "number", "connected → snapshotAgeMs should be a number for the 'updated Xs ago' indicator");
  assert.ok(meConn.snapshotAgeMs >= 0);

  // 4. An ancient command is relayed down and EXECUTED on the local repo.
  writeFileSync(join(ws.repo, "b.txt"), "new work");
  const res = await (await fetch(`${base}/api/git/commit`, { method: "POST", headers: { cookie: ancient, "content-type": "application/json" }, body: JSON.stringify({ localPath: "repo", message: "relayed commit" }) })).json();
  assert.equal(res.ok, true, `commit should succeed: ${JSON.stringify(res)}`);
  const log = spawnSync("git", ["-C", ws.repo, "log", "--oneline"], { encoding: "utf8" }).stdout;
  assert.match(log, /relayed commit/, "the commit must actually land in the local repo");

  // 5. A modern session is refused (403) on the same mutation.
  const mod = await fetch(`${base}/api/git/commit`, { method: "POST", headers: { cookie: modern, "content-type": "application/json" }, body: JSON.stringify({ localPath: "repo", message: "nope" }) });
  assert.equal(mod.status, 403, "a modern viewer must be refused");
  const modMe = await (await fetch(`${base}/api/me`, { headers: { cookie: modern } })).json();
  assert.equal(modMe.canExecute, false);
  assert.equal(modMe.canRead, true, "modern still reads");

  bridge.stop();
  await new Promise((r) => relay.server.close(r));
  rmSync(ws.root, { recursive: true, force: true });
});

// Reads an SSE response until `predicate(parsedLine, allLinesSoFar)` is true (or the timeout
// elapses). The restart stream (like /api/deploy/stream) forwards bare log-line strings as
// `data: <JSON-string>`, not nested objects — mirrors workspace.integration.test.mjs's
// readSseUntil, adapted for that flatter shape.
async function readSseLines(resp, predicate, ms = 3000) {
  const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = ""; const lines = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const { value, done } = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ value: undefined, done: false }), 200))]);
    if (done) break;
    if (value) {
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data:"));
        if (line) {
          try { const s = JSON.parse(line.slice(5).trim()); lines.push(s); if (predicate(s, lines)) { reader.cancel().catch(() => {}); return lines; } }
          catch {}
        }
      }
    }
  }
  reader.cancel().catch(() => {}); return lines;
}

test("restart trigger crosses the tunnel exactly like deploy: gated ancient-only + connection-required, forwards a WS_IN kind:restart frame that reaches the bridge's injected pipeline, and streams its log back over SSE", async (t) => {
  const relay = createRelay({ oidc: OIDC, deviceSecret: DEVICE });
  await new Promise((r) => relay.server.listen(0, "127.0.0.1", r));
  // Registered up-front (not at the end) so a failing assertion mid-test still tears the
  // server/bridge down instead of hanging the run on a dangling socket/listener.
  t.after(async () => { try { bridgeRef?.stop(); } catch {} await new Promise((r) => relay.server.close(r)); });
  const port = relay.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  let bridgeRef = null;

  const ancient = `${SESSION_COOKIE}=${await signSession({ sub: "a", roles: ["ancient"], name: "Anc" }, OIDC.sessionSecret)}`;
  const modern = `${SESSION_COOKIE}=${await signSession({ sub: "m", roles: ["modern"], name: "Mod" }, OIDC.sessionSecret)}`;

  // 1. Before the bridge connects: refused with 503, same as /api/deploy would be.
  const early = await fetch(`${base}/api/dashboard/restart`, { method: "POST", headers: { cookie: ancient } });
  assert.equal(early.status, 503, "a restart trigger while disconnected must be 503, same as deploy's");

  // 2. Connect the bridge with an injected restart pipeline standing in for
  // dashboard/server.mjs's runSelfRestart (see design's Wave 2 note — dashboard/server.mjs's own
  // createBridge() call site still needs to wire `restart: {...}` the same way it wires
  // `deploy: {...}` today; out of THIS task's file scope, so this test injects the pipeline
  // directly, exactly the way agent/agent.test.mjs's deploy-equivalent tests already do).
  let restartStartCalls = 0;
  const restartSubs = new Set();
  const restart = {
    start: () => {
      restartStartCalls++;
      queueMicrotask(() => {
        for (const w of restartSubs) w("▶ self-restart pre-flight: booting a sandboxed candidate…");
        for (const w of restartSubs) w("__DONE_OK__");
      });
      return { ok: true, started: true };
    },
    subscribe: (fn) => { restartSubs.add(fn); return () => restartSubs.delete(fn); },
  };
  bridgeRef = createBridge({
    url: `ws://127.0.0.1:${port}/agent`, deviceSecret: DEVICE, allowInsecure: true,
    snapshotIntervalMs: 500, restart, log: () => {},
  }).start();
  const connected = await waitFor(async () => (await (await fetch(`${base}/api/me`, { headers: { cookie: ancient } })).json()).localConnected);
  assert.equal(connected, true, "the relay should report the bridge connected");

  // 3. A modern (read-only) session is refused, gated identically to /api/deploy.
  const mod = await fetch(`${base}/api/dashboard/restart`, { method: "POST", headers: { cookie: modern } });
  assert.equal(mod.status, 403, "a modern session must be refused the restart trigger, same as deploy's");
  assert.equal(restartStartCalls, 0, "a refused (modern) request must never reach the restart pipeline");

  // 4. An ancient session opens the SSE stream, then triggers — the pipeline's own log lines
  // (not just a generic ack) must stream back to this exact browser. The stream's fetch()
  // promise resolves once its first byte is written (mirrors /api/deploy/stream's own no-initial-
  // write shape exactly), so it's kicked off WITHOUT awaiting before the trigger fires — the
  // same non-blocking order a real EventSource opened before a button click would use.
  const streamP = fetch(`${base}/api/dashboard/restart/stream`, { headers: { cookie: ancient } });
  await new Promise((r) => setTimeout(r, 100));

  const trig = await fetch(`${base}/api/dashboard/restart`, { method: "POST", headers: { cookie: ancient } });
  const body = await trig.json();
  assert.equal(trig.status, 200);
  assert.equal(body.ok, true, `the ancient trigger should succeed: ${JSON.stringify(body)}`);
  assert.equal(restartStartCalls, 1, "the relay-forwarded trigger must reach the SAME injected restart pipeline a local trigger would use — not a stub or no-op");

  const stream = await streamP;
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type") || "", /event-stream/);
  const lines = await readSseLines(stream, (line) => line === "__DONE_OK__");
  assert.ok(lines.includes("▶ self-restart pre-flight: booting a sandboxed candidate…"), `the pipeline's own pre-flight log lines must reach the browser over SSE: ${JSON.stringify(lines)}`);
  assert.ok(lines.includes("__DONE_OK__"), "the terminal sentinel must reach the browser");
});

test("restart trigger: the pre-flight-before-restart guarantee holds through the relay-forwarded path — a pre-flight refusal streams back as a failure, never silently reported as success", async (t) => {
  const relay = createRelay({ oidc: OIDC, deviceSecret: DEVICE });
  await new Promise((r) => relay.server.listen(0, "127.0.0.1", r));
  let bridgeRef = null;
  t.after(async () => { try { bridgeRef?.stop(); } catch {} await new Promise((r) => relay.server.close(r)); });
  const port = relay.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const ancient = `${SESSION_COOKIE}=${await signSession({ sub: "a", roles: ["ancient"], name: "Anc" }, OIDC.sessionSecret)}`;

  const restartSubs = new Set();
  const restart = {
    // Mirrors runSelfRestart's real ok:false branch (e.g. the sandboxed candidate never answered
    // healthy) — the live process is left untouched, and that refusal must cross the tunnel.
    start: () => {
      queueMicrotask(() => {
        for (const w of restartSubs) w("✗ pre-flight failed (timeout) — the live process is untouched.");
        for (const w of restartSubs) w("__DONE_FAIL__");
      });
      return { ok: true, started: true };
    },
    subscribe: (fn) => { restartSubs.add(fn); return () => restartSubs.delete(fn); },
  };
  bridgeRef = createBridge({
    url: `ws://127.0.0.1:${port}/agent`, deviceSecret: DEVICE, allowInsecure: true,
    snapshotIntervalMs: 500, restart, log: () => {},
  }).start();
  await waitFor(async () => (await (await fetch(`${base}/api/me`, { headers: { cookie: ancient } })).json()).localConnected);

  // Kicked off without awaiting before the trigger fires — see the sibling test above for why.
  const streamP = fetch(`${base}/api/dashboard/restart/stream`, { headers: { cookie: ancient } });
  await new Promise((r) => setTimeout(r, 100));
  await fetch(`${base}/api/dashboard/restart`, { method: "POST", headers: { cookie: ancient } });

  const stream = await streamP;
  const lines = await readSseLines(stream, (line) => line === "__DONE_FAIL__" || line === "__DONE_OK__");
  assert.ok(lines.includes("__DONE_FAIL__"), `a pre-flight refusal must reach the browser as __DONE_FAIL__: ${JSON.stringify(lines)}`);
  assert.ok(!lines.includes("__DONE_OK__"), "a refused pre-flight must never ALSO report success");
});
