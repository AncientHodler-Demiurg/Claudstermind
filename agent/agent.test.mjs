// node --test agent/agent.test.mjs — the bridge, driven against a stub relay (real ws server).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { createBridge, tunnelGateOpen } from "./agent.mjs";

// ---- tunnelGateOpen: the live-mirror gate for turn content crossing to the remote ----
test("tunnelGateOpen: non-gated kinds + keyless frames always cross", () => {
  // Workspace-wide reads (list/tree/history) and transcript replies are metadata, not turn content.
  assert.equal(tunnelGateOpen("transcript", "sess", {}), true);
  assert.equal(tunnelGateOpen("state", null, {}), true, "keyless frame passes");
  assert.equal(tunnelGateOpen("event", null, {}), true);
});

test("tunnelGateOpen: turn content for an untouched, unwatched session is withheld (privacy)", () => {
  assert.equal(tunnelGateOpen("event", "sess", { remoteTouched: false, remoteWatching: false }), false);
  assert.equal(tunnelGateOpen("state", "sess", {}), false);
  assert.equal(tunnelGateOpen("permission", "sess", {}), false);
});

test("tunnelGateOpen: crosses once the remote drove the session (remoteTouched)", () => {
  assert.equal(tunnelGateOpen("event", "sess", { remoteTouched: true, remoteWatching: false }), true);
});

test("tunnelGateOpen: crosses when a remote browser is watching — the localhost→remote live-mirror fix", () => {
  // A prompt typed on localhost (never remoteTouched) still mirrors live to a connected remote viewer.
  assert.equal(tunnelGateOpen("event", "sess", { remoteTouched: false, remoteWatching: true }), true);
  assert.equal(tunnelGateOpen("state", "sess", { remoteWatching: true }), true);
});
import { FRAME } from "../lib/protocol.mjs";
import { WorkspaceManager } from "../lib/workspace.mjs";
import { appendTurn, workspaceId } from "../lib/workspaceStore.mjs";
import { SessiondClient } from "../lib/sessiondClient.mjs";
import { createSessiond } from "../sessiond/sessiond.mjs";

const DEVICE = "device-secret-at-least-32-chars-long!!";

// A minimal mock SDK query — same shape as lib/workspace.test.mjs's, kept local since that
// helper isn't exported: streams an init + one assistant reply, no tool use, no permission.
function mockQuery() {
  return function ({ prompt, options }) {
    return (async function* () {
      const it = prompt[Symbol.asyncIterator]();
      const first = await it.next();
      yield { type: "system", subtype: "init", session_id: "sess-1", model: "m", cwd: options.cwd };
      yield { type: "assistant", message: { content: [{ type: "text", text: "reply: " + first.value.message.content }] } };
      yield { type: "result", subtype: "success", is_error: false, usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0, duration_ms: 10, result: "done" };
    })();
  };
}

// A mock SDK query that never finishes its turn (yields init + an assistant reply, then hangs
// forever) — keeps the session's status pinned at "thinking" so it is never torn down/recreated
// mid-test, which would otherwise make an identity check racy against real turn completion.
function mockQueryHangs() {
  return function ({ prompt, options }) {
    return (async function* () {
      const it = prompt[Symbol.asyncIterator]();
      const first = await it.next();
      yield { type: "system", subtype: "init", session_id: "sess-1", model: "m", cwd: options.cwd };
      yield { type: "assistant", message: { content: [{ type: "text", text: "reply: " + first.value.message.content }] } };
      await new Promise(() => {});   // never resolves — the turn stays open indefinitely
    })();
  };
}

/** A workspace fixture (tmp root + token + a "repo" folder) so a real WorkspaceManager can be
 *  injected into createBridge without touching the real workspace on disk. */
function workspaceFixture() {
  const root = mkdtempSync(join(tmpdir(), "agent-bridge-ws-"));
  const secretsDir = join(root, ".secrets"); mkdirSync(secretsDir);
  writeFileSync(join(secretsDir, "claude-oauth-token.txt"), "sk-ant-oat-TESTTOKEN\n");
  mkdirSync(join(root, "repo"));
  return { root, secretsDir };
}

function stubRelay() {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const port = wss.address().port;
      resolve({ wss, url: `ws://127.0.0.1:${port}/agent`, port });
    });
  });
}

test("bridge sends hello, then pushes a snapshot on welcome, then answers a command", async () => {
  const { wss, url } = await stubRelay();
  const frames = [];
  let sockRef = null;
  const done = {};
  const gotAll = new Promise((res) => { done.res = res; });

  wss.on("connection", (sock) => {
    sockRef = sock;
    sock.on("message", (raw) => {
      const f = JSON.parse(raw.toString());
      frames.push(f);
      if (f.t === FRAME.HELLO) {
        sock.send(JSON.stringify({ t: FRAME.WELCOME }));           // authenticate
      } else if (f.t === FRAME.SNAPSHOT) {
        sock.send(JSON.stringify({ t: FRAME.COMMAND, id: "c1", cmd: { type: "git.push", args: { localPath: "repo" } } }));
      } else if (f.t === FRAME.RESULT) {
        done.res();
      }
    });
  });

  const bridge = createBridge({
    url, deviceSecret: DEVICE, allowInsecure: true, snapshotIntervalMs: 60_000,
    buildSnapshot: async () => ({ git: { repos: [{ name: "repo" }] } }),
    executeCommand: async (type, args) => ({ ok: true, echo: type, localPath: args.localPath }),
    log: () => {},
  }).start();

  await gotAll;
  bridge.stop(); wss.close();

  const hello = frames.find((f) => f.t === FRAME.HELLO);
  assert.equal(hello.deviceSecret, DEVICE, "hello must carry the device secret");
  const snap = frames.find((f) => f.t === FRAME.SNAPSHOT);
  assert.ok(snap && snap.data.git.repos.length === 1, "a snapshot must be pushed on welcome");
  const result = frames.find((f) => f.t === FRAME.RESULT);
  assert.equal(result.id, "c1");
  assert.equal(result.result.ok, true);
  assert.equal(result.result.echo, "git.push", "the command must run through executeCommand");
});

test("bridge refuses an insecure ws:// URL without the opt-in", () => {
  assert.throws(
    () => createBridge({ url: "ws://evil.example/agent", deviceSecret: DEVICE, allowInsecure: false }),
    /insecure ws:\/\//,
  );
});

test("bridge requires a url and a sufficiently long device secret", () => {
  assert.throws(() => createBridge({ deviceSecret: DEVICE }), /RELAY_URL is required/);
  assert.throws(() => createBridge({ url: "wss://x/agent", deviceSecret: "short" }), /at least 32/);
});

test("an injected workspace is used AS-IS — the bridge makes zero new WorkspaceManager() calls", () => {
  const fx = workspaceFixture();
  const injected = new WorkspaceManager({ root: fx.root, secretsDir: fx.secretsDir, sdkQuery: mockQuery(), listRepos: () => [], send: () => {} });
  const bridge = createBridge({ url: "wss://x/agent", deviceSecret: DEVICE, workspace: injected, log: () => {} });
  // Structural identity, not just a same-shaped copy — proves the bridge never constructed a
  // second, independent manager when one was handed to it.
  assert.equal(bridge.workspace, injected, "bridge.workspace must be the exact object injected, not a new instance");
  rmSync(fx.root, { recursive: true, force: true });
});

test("with no workspace injected, the bridge still builds its own WorkspaceManager (regression guard)", () => {
  const bridge = createBridge({ url: "wss://x/agent", deviceSecret: DEVICE, log: () => {} });
  assert.ok(bridge.workspace instanceof WorkspaceManager, "the default (no-injection) path must be unchanged: a real WorkspaceManager of its own");
});

test("a prompt via the 'local' path and one via the simulated relay WS_IN path share the identical in-memory session", async (t) => {
  const fx = workspaceFixture();
  const shared = new WorkspaceManager({ root: fx.root, secretsDir: fx.secretsDir, sdkQuery: mockQueryHangs(), listRepos: () => [{ name: "repo", localPath: "repo" }], send: () => {} });
  const { wss, url } = await stubRelay();
  let sockRef = null;
  wss.on("connection", (sock) => {
    sockRef = sock;
    sock.on("message", (raw) => { const f = JSON.parse(raw.toString()); if (f.t === FRAME.HELLO) sock.send(JSON.stringify({ t: FRAME.WELCOME })); });
  });

  const bridge = createBridge({ url, deviceSecret: DEVICE, allowInsecure: true, snapshotIntervalMs: 60_000, workspace: shared, buildSnapshot: async () => ({}), log: () => {} }).start();
  // Registered up-front (not after the assertions) so a failing assertion still tears the
  // socket/timers down instead of leaving the bridge dangling and hanging the whole test run.
  t.after(() => { bridge.stop(); wss.close(); rmSync(fx.root, { recursive: true, force: true }); });
  await new Promise((r) => setTimeout(r, 150));   // let HELLO/WELCOME settle

  // "Local" path: exactly what dashboard/server.mjs does for a browser tab — call
  // WORKSPACE.handleIn(action, sessionKey, data) directly, no tunnel involved.
  shared.handleIn("prompt", "shared-key", { repo: "repo", text: "hi from local" });
  const localSession = shared.sessions.get("shared-key");
  assert.ok(localSession, "the local-path prompt must create a session under the shared instance");

  // "Relay" path: a WS_IN frame arriving down the tunnel, on the SAME sessionKey.
  sockRef.send(JSON.stringify({ t: FRAME.WS_IN, kind: "prompt", sessionKey: "shared-key", data: { repo: "repo", text: "hi from relay" } }));
  await new Promise((r) => setTimeout(r, 150));

  const afterRelaySession = shared.sessions.get("shared-key");
  assert.equal(afterRelaySession, localSession, "the relay-forwarded prompt must resolve to the SAME session object as the local one — one shared manager, not two");
});

test("an injected workspace's outbound tunnel sink is ADDED alongside its existing sinks, not a replacement — for a session with genuine remote interest", async (t) => {
  const fx = workspaceFixture();
  const localEvents = [];
  // Simulates dashboard/server.mjs's construction: WORKSPACE already has its own local-broadcast
  // sink registered (via `send` at construction) BEFORE it's ever handed to createBridge.
  const shared = new WorkspaceManager({
    root: fx.root, secretsDir: fx.secretsDir, sdkQuery: mockQuery(),
    listRepos: () => [{ name: "repo", localPath: "repo" }],
    send: (kind, sessionKey, data) => localEvents.push({ kind, sessionKey, data }),
  });
  const { wss, url } = await stubRelay();
  let sockRef = null;
  const wsOutFrames = [];
  wss.on("connection", (sock) => {
    sockRef = sock;
    sock.on("message", (raw) => {
      const f = JSON.parse(raw.toString());
      if (f.t === FRAME.HELLO) sock.send(JSON.stringify({ t: FRAME.WELCOME }));
      else if (f.t === FRAME.WS_OUT) wsOutFrames.push(f);
    });
  });

  const bridge = createBridge({ url, deviceSecret: DEVICE, allowInsecure: true, snapshotIntervalMs: 60_000, workspace: shared, buildSnapshot: async () => ({}), log: () => {} }).start();
  // Registered up-front (not after the assertions) so a failing assertion still tears the
  // socket/timers down instead of leaving the bridge dangling and hanging the whole test run.
  t.after(() => { bridge.stop(); wss.close(); rmSync(fx.root, { recursive: true, force: true }); });
  await new Promise((r) => setTimeout(r, 150));

  // The prompt arrives over a genuine inbound WS_IN frame (the relay's own path) — proof of real
  // remote interest, so per Finding 1's gate this session's events DO cross the tunnel. It must
  // STILL reach the local sink too, proving the bridge registered its sender as an ADDITIONAL sink
  // (addSink) instead of overwriting `.send` and silently dropping whichever sink was already there.
  sockRef.send(JSON.stringify({ t: FRAME.WS_IN, kind: "prompt", sessionKey: "sink-key", data: { repo: "repo", text: "hello" } }));
  await new Promise((r) => setTimeout(r, 150));

  assert.ok(localEvents.some((e) => e.kind === "event" && e.data?.kind === "assistant"), "the original (local) sink must still receive events after the bridge wires its own sink in");
  assert.ok(wsOutFrames.some((f) => f.kind === "event" && f.data?.kind === "assistant"), "the tunnel must ALSO receive the same events as an additional sink");
});

test("Finding 1 — a session prompted ONLY through the local path (never over a genuine WS_IN frame) never reaches the tunnel sink", async (t) => {
  const fx = workspaceFixture();
  const localEvents = [];
  const shared = new WorkspaceManager({
    root: fx.root, secretsDir: fx.secretsDir, sdkQuery: mockQuery(),
    listRepos: () => [{ name: "repo", localPath: "repo" }],
    send: (kind, sessionKey, data) => localEvents.push({ kind, sessionKey, data }),
  });
  const { wss, url } = await stubRelay();
  const wsOutFrames = [];
  wss.on("connection", (sock) => {
    sock.on("message", (raw) => {
      const f = JSON.parse(raw.toString());
      if (f.t === FRAME.HELLO) sock.send(JSON.stringify({ t: FRAME.WELCOME }));
      else if (f.t === FRAME.WS_OUT) wsOutFrames.push(f);
    });
  });

  const bridge = createBridge({ url, deviceSecret: DEVICE, allowInsecure: true, snapshotIntervalMs: 60_000, workspace: shared, buildSnapshot: async () => ({}), log: () => {} }).start();
  t.after(() => { bridge.stop(); wss.close(); rmSync(fx.root, { recursive: true, force: true }); });
  await new Promise((r) => setTimeout(r, 150));

  // Exactly what dashboard/server.mjs's own POST /api/workspace/prompt route does for a browser
  // tab: call handleIn directly. No WS_IN frame is ever involved — no remote party has expressed
  // interest in this sessionKey.
  shared.handleIn("prompt", "local-only-key", { repo: "repo", text: "purely local chat" });
  await new Promise((r) => setTimeout(r, 200));

  const localKinds = localEvents.filter((e) => e.sessionKey === "local-only-key" && e.kind === "event").map((e) => e.data.kind);
  assert.ok(localKinds.includes("result"), `the local sink must still see the full turn, unaffected by the gate: ${localKinds}`);
  assert.equal(wsOutFrames.filter((f) => f.sessionKey === "local-only-key").length, 0,
    "a purely local session's events must never reach the tunnel sink");
});

test("Finding 1 — a session that starts local-only and later gets a genuine remote prompt starts flowing over the tunnel from then on", async (t) => {
  const fx = workspaceFixture();
  const shared = new WorkspaceManager({
    root: fx.root, secretsDir: fx.secretsDir, sdkQuery: mockQueryHangs(),
    listRepos: () => [{ name: "repo", localPath: "repo" }], send: () => {},
  });
  const { wss, url } = await stubRelay();
  let sockRef = null;
  const wsOutFrames = [];
  wss.on("connection", (sock) => {
    sockRef = sock;
    sock.on("message", (raw) => {
      const f = JSON.parse(raw.toString());
      if (f.t === FRAME.HELLO) sock.send(JSON.stringify({ t: FRAME.WELCOME }));
      else if (f.t === FRAME.WS_OUT) wsOutFrames.push(f);
    });
  });
  const bridge = createBridge({ url, deviceSecret: DEVICE, allowInsecure: true, snapshotIntervalMs: 60_000, workspace: shared, buildSnapshot: async () => ({}), log: () => {} }).start();
  t.after(() => { bridge.stop(); wss.close(); rmSync(fx.root, { recursive: true, force: true }); });
  await new Promise((r) => setTimeout(r, 150));

  shared.handleIn("prompt", "later-remote-key", { repo: "repo", text: "starts local" });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(wsOutFrames.filter((f) => f.sessionKey === "later-remote-key").length, 0, "nothing forwarded yet — no remote interest so far");

  // A remote party now sends a genuine WS_IN prompt on the SAME sessionKey (e.g. picking up the
  // same live session from the live site) — the turn-lock will refuse it as busy (mockQueryHangs
  // never finishes), but that busy event itself must now cross the wire.
  sockRef.send(JSON.stringify({ t: FRAME.WS_IN, kind: "prompt", sessionKey: "later-remote-key", data: { repo: "repo", text: "joins remotely" } }));
  await new Promise((r) => setTimeout(r, 150));

  assert.ok(wsOutFrames.some((f) => f.sessionKey === "later-remote-key" && f.kind === "event" && f.data?.kind === "busy"),
    "once a genuine remote prompt touches this sessionKey, its events (even a busy refusal) must reach the tunnel");
});

test("a RESUMED (adopted) saved-session key opens the remote gate: its rehydrate transcript AND the resumed turn's assistant/result all reach the tunnel", async (t) => {
  // Reproduces the Pact chat "Resume" path over the tunnel. A saved session exists on disk; the
  // remote adopts its OWN id as the tab key, rehydrates via a `control sessionOpen`, then sends a
  // prompt on that same adopted key carrying `resume` (the real SDK id). Regression guard for the
  // "resumed tab streams thinking… forever, answers never render" report: the adopted key must open
  // the same gate a freshly-minted key does, so the resumed turn's live output crosses the wire.
  const fx = workspaceFixture();
  const transcriptDir = join(fx.root, ".claude", "workspace");
  const wid = workspaceId("repo", "main");
  const ADOPTED = "9b41003b-adopted-key";           // the saved session's own id = the resumed tab's key
  const REAL = "ad269259-real-sdk-id";              // the real SDK id `resume` continues
  appendTurn(transcriptDir, wid, ADOPTED, { role: "user", text: "original question", at: 1, workspaceId: wid, realSessionId: REAL });
  appendTurn(transcriptDir, wid, ADOPTED, { role: "assistant", text: "original answer", at: 2, workspaceId: wid, realSessionId: REAL });

  const shared = new WorkspaceManager({
    root: fx.root, secretsDir: fx.secretsDir, transcriptDir, sdkQuery: mockQuery(),
    listRepos: () => [{ name: "repo", localPath: "repo" }], send: () => {},
  });
  const { wss, url } = await stubRelay();
  let sockRef = null;
  const wsOutFrames = [];
  wss.on("connection", (sock) => {
    sockRef = sock;
    sock.on("message", (raw) => {
      const f = JSON.parse(raw.toString());
      if (f.t === FRAME.HELLO) sock.send(JSON.stringify({ t: FRAME.WELCOME }));
      else if (f.t === FRAME.WS_OUT) wsOutFrames.push(f);
    });
  });
  const bridge = createBridge({ url, deviceSecret: DEVICE, allowInsecure: true, snapshotIntervalMs: 60_000, workspace: shared, buildSnapshot: async () => ({}), log: () => {} }).start();
  t.after(() => { bridge.stop(); wss.close(); rmSync(fx.root, { recursive: true, force: true }); });
  await new Promise((r) => setTimeout(r, 150));

  // 1) Rehydrate the saved transcript (a workspace-read reply — never gated). Note the sessionOpen
  //    control frame carries NO sessionKey, exactly as the client sends it.
  sockRef.send(JSON.stringify({ t: FRAME.WS_IN, kind: "control", sessionKey: null, data: { action: "sessionOpen", args: { repo: "repo", worktree: "main", sessionId: ADOPTED } } }));
  await new Promise((r) => setTimeout(r, 150));
  const transcriptFrame = wsOutFrames.find((f) => f.kind === "transcript" && f.sessionKey === ADOPTED);
  assert.ok(transcriptFrame, "the rehydrate transcript must reach the tunnel keyed by the adopted session id");
  assert.equal((transcriptFrame.data.transcript || []).length, 2, "the saved 2-turn transcript must ride back for display");

  // 2) The resumed turn: a genuine WS_IN prompt on the ADOPTED key, carrying `resume`. This is the
  //    remote-interest signal — the adopted key must now open the gate exactly like any other.
  sockRef.send(JSON.stringify({ t: FRAME.WS_IN, kind: "prompt", sessionKey: ADOPTED, data: { repo: "repo", worktree: "main", text: "continue please", mode: "bypassPermissions", by: "remote-user", resume: REAL } }));
  await new Promise((r) => setTimeout(r, 250));

  const eventKinds = wsOutFrames.filter((f) => f.kind === "event" && f.sessionKey === ADOPTED).map((f) => f.data?.kind);
  assert.ok(eventKinds.includes("assistant"), `the resumed turn's assistant reply must cross the tunnel for the adopted key: ${eventKinds}`);
  assert.ok(eventKinds.includes("result"), `the resumed turn's result (which flips the tab off "thinking") must cross the tunnel: ${eventKinds}`);
});

test("a relay-forwarded 'restart' WS_IN frame runs the bridge's injected restart pipeline (mirrors 'deploy') and streams its log/done back up the tunnel", async (t) => {
  const { wss, url } = await stubRelay();
  let sockRef = null;
  const wsOutFrames = [];
  wss.on("connection", (sock) => {
    sockRef = sock;
    sock.on("message", (raw) => {
      const f = JSON.parse(raw.toString());
      if (f.t === FRAME.HELLO) sock.send(JSON.stringify({ t: FRAME.WELCOME }));
      else if (f.t === FRAME.WS_OUT) wsOutFrames.push(f);
    });
  });

  // A mock of dashboard/server.mjs's own restart pipeline shape: start() kicks the pipeline off
  // (mirrors startSelfRestart's synchronous {ok,started} return), subscribe() streams the log
  // lines it emits, terminated by the "__DONE_OK__"/"__DONE_FAIL__" sentinel — the exact same
  // contract runRemoteDeploy relies on for opts.deploy.
  let startCalls = 0;
  const restartSubs = new Set();
  const restart = {
    start: () => {
      startCalls++;
      queueMicrotask(() => {
        for (const w of restartSubs) w("▶ self-restart pre-flight: booting a sandboxed candidate…");
        for (const w of restartSubs) w("__DONE_OK__");
      });
      return { ok: true, started: true };
    },
    subscribe: (fn) => { restartSubs.add(fn); return () => restartSubs.delete(fn); },
  };

  const bridge = createBridge({ url, deviceSecret: DEVICE, allowInsecure: true, snapshotIntervalMs: 60_000, restart, buildSnapshot: async () => ({}), log: () => {} }).start();
  t.after(() => { bridge.stop(); wss.close(); });
  await new Promise((r) => setTimeout(r, 150));

  sockRef.send(JSON.stringify({ t: FRAME.WS_IN, kind: "restart", sessionKey: null, data: {} }));
  await new Promise((r) => setTimeout(r, 150));

  assert.equal(startCalls, 1, "the injected restart pipeline's start() must be invoked exactly once per relay-forwarded restart frame — proof this reaches the SAME pipeline a local trigger would use");
  assert.ok(wsOutFrames.some((f) => f.kind === "restart-log"), "the pipeline's pre-flight log lines must stream back up the tunnel");
  assert.ok(wsOutFrames.some((f) => f.kind === "restart-done" && f.data?.ok === true), "a terminal restart-done frame must report the pipeline's actual result");
});

test("a 'restart' WS_IN frame is a no-op when no restart pipeline was injected — mirrors deploy's 'opts.deploy' guard, so a stray frame never throws", async (t) => {
  const { wss, url } = await stubRelay();
  let sockRef = null;
  wss.on("connection", (sock) => {
    sockRef = sock;
    sock.on("message", (raw) => { const f = JSON.parse(raw.toString()); if (f.t === FRAME.HELLO) sock.send(JSON.stringify({ t: FRAME.WELCOME })); });
  });
  const bridge = createBridge({ url, deviceSecret: DEVICE, allowInsecure: true, snapshotIntervalMs: 60_000, buildSnapshot: async () => ({}), log: () => {} }).start();
  t.after(() => { bridge.stop(); wss.close(); });
  await new Promise((r) => setTimeout(r, 150));

  sockRef.send(JSON.stringify({ t: FRAME.WS_IN, kind: "restart", sessionKey: null, data: {} }));
  await new Promise((r) => setTimeout(r, 150));

  // Still alive and answering — a follow-up snapshot push must still work, proving the frame
  // above didn't crash the bridge's message handler.
  await bridge.pushSnapshot();
  assert.ok(true, "no throw / no crash for a restart frame with nothing injected to run it");
});

test("a pre-flight failure surfaces as restart-done:false over the relay-forwarded path too — the pre-flight-before-restart guarantee is never silently reported as success", async (t) => {
  const { wss, url } = await stubRelay();
  let sockRef = null;
  const wsOutFrames = [];
  wss.on("connection", (sock) => {
    sockRef = sock;
    sock.on("message", (raw) => {
      const f = JSON.parse(raw.toString());
      if (f.t === FRAME.HELLO) sock.send(JSON.stringify({ t: FRAME.WELCOME }));
      else if (f.t === FRAME.WS_OUT) wsOutFrames.push(f);
    });
  });

  const restartSubs = new Set();
  const restart = {
    // Mirrors runSelfRestart's real ok:false path (e.g. the sandboxed candidate never answered
    // healthy) — the live process must be left untouched, and that refusal must cross the wire.
    start: () => {
      queueMicrotask(() => {
        for (const w of restartSubs) w("✗ pre-flight failed (timeout) — the live process is untouched.");
        for (const w of restartSubs) w("__DONE_FAIL__");
      });
      return { ok: true, started: true };
    },
    subscribe: (fn) => { restartSubs.add(fn); return () => restartSubs.delete(fn); },
  };

  const bridge = createBridge({ url, deviceSecret: DEVICE, allowInsecure: true, snapshotIntervalMs: 60_000, restart, buildSnapshot: async () => ({}), log: () => {} }).start();
  t.after(() => { bridge.stop(); wss.close(); });
  await new Promise((r) => setTimeout(r, 150));

  sockRef.send(JSON.stringify({ t: FRAME.WS_IN, kind: "restart", sessionKey: null, data: {} }));
  await new Promise((r) => setTimeout(r, 150));

  const done = wsOutFrames.filter((f) => f.kind === "restart-done");
  assert.equal(done.length, 1, "exactly one terminal restart-done frame");
  assert.equal(done[0].data.ok, false, "a pre-flight refusal must report ok:false, never ok:true");
});

test("Finding 2 — bridge restart against the same shared WorkspaceManager removes the previously-registered sink instead of leaking it", async () => {
  const fx = workspaceFixture();
  const shared = new WorkspaceManager({
    root: fx.root, secretsDir: fx.secretsDir, sdkQuery: mockQuery(),
    listRepos: () => [{ name: "repo", localPath: "repo" }],
    send: () => {},   // dashboard/server.mjs's own local-broadcast sink — always present
  });
  const baseline = shared._sinks.size;   // 1: the local sink registered at construction

  const bridge1 = createBridge({ url: "wss://x/agent", deviceSecret: DEVICE, workspace: shared, log: () => {} });
  assert.equal(shared._sinks.size, baseline + 1, "createBridge must add exactly one sink to the shared manager");
  bridge1.stop();
  assert.equal(shared._sinks.size, baseline, "stop() must remove the sink it registered — no leak");

  // Simulate dashboard/server.mjs's startBridgeFromConfig(): stop, then create a fresh bridge
  // against the SAME shared instance, repeatedly (once per relay-config save / boot).
  const bridge2 = createBridge({ url: "wss://x/agent", deviceSecret: DEVICE, workspace: shared, log: () => {} });
  assert.equal(shared._sinks.size, baseline + 1, "the second bridge must add exactly one sink, not accumulate on top of a leaked first one");
  bridge2.stop();
  assert.equal(shared._sinks.size, baseline, "after the second stop(), the sink count returns to baseline again — no leak across repeated restarts");

  rmSync(fx.root, { recursive: true, force: true });
});

// ---- T5.1: relay-bridge parity against the sessiond daemon (deploy-survivable agents, Wave 5) ----
// When SESSIOND_SOCK is set, dashboard/server.mjs's WORKSPACE is a SessiondClient (not the in-process
// WorkspaceManager) and that SAME client is handed to createBridge({ workspace }) — server.mjs's
// `workspace: WORKSPACE`. This proves the REMOTE (relay-tunnel) path survives a web deploy too: a
// prompt arriving down the tunnel is driven into the always-up daemon through the client, and the
// daemon's resulting event flows back out the tunnel. End-to-end over a REAL loopback unix socket
// (real sessiond + real SessiondClient) + a real ws relay — no mocks between the bridge and the daemon.
test("T5.1 — a REMOTE prompt drives the sessiond daemon through the SessiondClient and the daemon's event flows back out the tunnel", async (t) => {
  const sockPath = join(tmpdir(), `sessiond-bridge-parity-${process.pid}-${Date.now()}.sock`);
  // A stub engine standing in for the daemon-owned WorkspaceManager: on _prompt it echoes an `event`
  // to its sinks, exactly what the real manager's send() does when it accepts a turn — that echo is
  // what the daemon fans out to subscribers.
  const sinks = new Set();
  const engine = {
    addSink(fn) { sinks.add(fn); },
    removeSink(fn) { sinks.delete(fn); },
    sessions: new Map(),
    sessionSummary: (s) => s,
    _prompt(sessionKey, data) {
      for (const fn of sinks) fn("event", sessionKey, { kind: "assistant", text: "reply: " + data.text });
    },
  };
  const daemon = createSessiond({ workspace: engine, socketPath: sockPath });
  await new Promise((res, rej) => { daemon.server.on("listening", res); daemon.server.on("error", rej); });

  // The web's REAL SessiondClient — the same class server.mjs hands to createBridge as WORKSPACE when
  // the flag is on. Its `send` sink is the tunnel-independent local broadcast (SSE in production).
  const localEvents = [];
  const client = new SessiondClient({
    socketPath: sockPath,
    send: (kind, sessionKey, data) => localEvents.push({ kind, sessionKey, data }),
    minBackoffMs: 5, maxBackoffMs: 20, requestTimeoutMs: 1000,
  });
  const up = await client.probe();
  assert.equal(up, true, "the client connects + subscribes to the live daemon");

  // A real relay + the real bridge, handed the SessiondClient as its workspace (exactly server.mjs's
  // `workspace: WORKSPACE`). The bridge subscribes via addSink and prompts via handleIn — the full
  // surface it uses — all of which the client implements over IPC.
  const { wss, url } = await stubRelay();
  let sockRef = null;
  const wsOutFrames = [];
  wss.on("connection", (sock) => {
    sockRef = sock;
    sock.on("message", (raw) => {
      const f = JSON.parse(raw.toString());
      if (f.t === FRAME.HELLO) sock.send(JSON.stringify({ t: FRAME.WELCOME }));
      else if (f.t === FRAME.WS_OUT) wsOutFrames.push(f);
    });
  });
  const bridge = createBridge({
    url, deviceSecret: DEVICE, allowInsecure: true, snapshotIntervalMs: 60_000,
    workspace: client, buildSnapshot: async () => ({}), log: () => {},
  }).start();
  t.after(() => { bridge.stop(); wss.close(); client.close(); try { daemon.server.close(); } catch {} });
  await new Promise((r) => setTimeout(r, 150));   // HELLO/WELCOME settle

  // A genuine REMOTE prompt down the tunnel (the relay's own WS_IN path — proof of remote interest,
  // so the tunnel-sink gate lets this session's events cross). The bridge forwards it through the
  // client → the daemon → the stub engine, whose echoed event fans back out to the subscribed client
  // → the bridge's tunnel sink relays it up as WS_OUT.
  sockRef.send(JSON.stringify({ t: FRAME.WS_IN, kind: "prompt", sessionKey: "repoA@main", data: { repo: "repoA", text: "hello" } }));
  await new Promise((r) => setTimeout(r, 250));

  assert.ok(
    wsOutFrames.some((f) => f.kind === "event" && f.sessionKey === "repoA@main" && f.data?.kind === "assistant"),
    "the daemon-owned engine's event flowed back out the relay tunnel — REMOTE parity holds through the SessiondClient",
  );
  assert.ok(
    localEvents.some((e) => e.kind === "event" && e.data?.kind === "assistant"),
    "the same event ALSO reached the client's own send sink (local broadcast), not only the tunnel",
  );
});
