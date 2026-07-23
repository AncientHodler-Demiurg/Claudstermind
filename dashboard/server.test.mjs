// node --test dashboard/server.test.mjs
//
// CONFIRMED-HIGH (vision-input review): every POST route in this file read its body via an
// uncapped `let body = ""; for await (const c of req) body += c;` loop before JSON.parse — no
// size cap anywhere, exploitable by an authenticated `ancient` on the local dashboard the same
// way it was on the relay. `readBody` is the fix; it is exercised directly here (not through the
// route layer) because dashboard/server.mjs — unlike relay/server.mjs's `createRelay(opts)` — has
// no test-friendly factory: importing it always constructs a real WorkspaceManager/aggregator
// wired to this machine's actual paths, and its POST routes write to REAL disk locations
// (package.json, .secrets, .claude, backup config, …) with no way to redirect them for a test.
// Driving `readBody` directly with a synthetic request-like async iterable gets the same
// incremental-cap coverage without any of that risk.
import test from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { readBody, PayloadTooLargeError, bridgeEnabled, runSelfRestart, startSelfRestart, subscribeRestartLog, LOCAL_ONLY, bootLocalSubsystems, randomScratchPort, PORT } from "./server.mjs";
import { createBridge } from "../agent/agent.mjs";
import { FRAME } from "../lib/protocol.mjs";

const DEVICE = "device-secret-at-least-32-chars-long!!";

/** A stub relay: a real `ws` server standing in for the live relay, so createBridge(...) — and
 *  the `restart:` entry wired into its call site in dashboard/server.mjs — run against a real
 *  WebSocket connection (mirrors agent/agent.test.mjs's own stubRelay helper). */
function stubRelay() {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const port = wss.address().port;
      resolve({ wss, url: `ws://127.0.0.1:${port}/agent` });
    });
  });
}

/** A minimal stand-in for `req` as `readBody` actually consumes it: an async-iterable of Buffer
 *  chunks. Real `http.IncomingMessage` chunks are Buffers, so this mirrors that shape exactly. */
function fakeReq(chunks) {
  return { async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; } };
}

test("a body whose accumulated length crosses the cap DURING iteration is rejected before JSON.parse runs", async () => {
  // Three 3MB chunks (9MB total) cross the 8MB default cap on the THIRD chunk — nothing here
  // ever claims a Content-Length up front, so this proves the check runs incrementally as bytes
  // arrive, not from a pre-read header.
  const chunk = Buffer.alloc(3 * 1024 * 1024, "{"); // deliberately not valid JSON — proves it's
  // never handed to JSON.parse; a parse of `{{{...` would throw a SyntaxError, not our error.
  await assert.rejects(
    () => readBody(fakeReq([chunk, chunk, chunk])),
    PayloadTooLargeError,
  );
});

test("a body under the cap is read in full and parsed normally — the cap does not affect a normal request", async () => {
  const payload = JSON.stringify({ text: "hello", sessionKey: "s1", image: { mediaType: "image/png", base64Data: "abc" } });
  const chunks = [Buffer.from(payload.slice(0, 10)), Buffer.from(payload.slice(10))]; // arrives in pieces, like a real socket
  const parsed = await readBody(fakeReq(chunks));
  assert.deepEqual(parsed, JSON.parse(payload));
});

test("an empty body parses to {} — unchanged from before the cap existed", async () => {
  const parsed = await readBody(fakeReq([]));
  assert.deepEqual(parsed, {});
});

test("a custom maxBytes is honored (not hardcoded to the default)", async () => {
  const small = Buffer.alloc(200, "a");
  await assert.rejects(() => readBody(fakeReq([small]), 100), PayloadTooLargeError);
  const ok = await readBody(fakeReq([Buffer.from("{}")]), 100);
  assert.deepEqual(ok, {});
});

// ---- self-restart safety (dashboard-self-restart-safety, task 2.1) ----
//
// Same testability constraint as readBody above: this file has no test-friendly factory, so
// the CM_PREFLIGHT decision and the restart route's core logic are exported directly (like
// readBody/PayloadTooLargeError) rather than driven through the real HTTP handler.

test("bridgeEnabled is false under CM_PREFLIGHT=1 — a pre-flight candidate must never open a real tunnel to the live relay (it would contend with/could disrupt the actual live connection)", () => {
  const prev = process.env.CM_PREFLIGHT;
  process.env.CM_PREFLIGHT = "1";
  try {
    assert.equal(bridgeEnabled(), false);
  } finally {
    if (prev === undefined) delete process.env.CM_PREFLIGHT; else process.env.CM_PREFLIGHT = prev;
  }
});

test("bridgeEnabled is true in ordinary local-mode boot (no CM_PREFLIGHT set) — the real tunnel still opens on a normal launch", () => {
  const prev = process.env.CM_PREFLIGHT;
  delete process.env.CM_PREFLIGHT;
  try {
    assert.equal(bridgeEnabled(), true);
  } finally {
    if (prev !== undefined) process.env.CM_PREFLIGHT = prev;
  }
});

test("runSelfRestart refuses to touch the real process when the pre-flight reports ok:false — zero spawn calls for the restart command", async () => {
  let spawnCalls = 0;
  const result = await runSelfRestart({
    repoRoot: "/fake/repo",
    scratchPort: 34567,
    runPreflightFn: async () => ({ ok: false, reason: "timeout" }),
    spawnFn: () => { spawnCalls++; return { unref() {} }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "timeout");
  assert.equal(spawnCalls, 0);
});

test("runSelfRestart reports the crashed reason + detail verbatim when the pre-flight candidate crashes, without spawning the restart command", async () => {
  let spawnCalls = 0;
  const result = await runSelfRestart({
    repoRoot: "/fake/repo",
    scratchPort: 34569,
    runPreflightFn: async () => ({ ok: false, reason: "crashed", detail: { code: 1, signal: null } }),
    spawnFn: () => { spawnCalls++; return { unref() {} }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "crashed");
  assert.deepEqual(result.detail, { code: 1, signal: null });
  assert.equal(spawnCalls, 0);
});

test("runSelfRestart triggers the real restart command only after the pre-flight reports ok:true", async () => {
  let spawned = null;
  const result = await runSelfRestart({
    repoRoot: "/fake/repo",
    scratchPort: 34568,
    runPreflightFn: async () => ({ ok: true }),
    spawnFn: (cmd, args, opts) => { spawned = { cmd, args, opts }; return { unref() {} }; },
  });
  assert.equal(result.ok, true);
  assert.ok(spawned, "spawnFn should have been called");
  assert.equal(spawned.cmd, "systemctl");
  assert.deepEqual(spawned.args, ["restart", "claudstermind"]);
});

test("the restart route is gated exactly like the existing deploy route — both are local-only mutations (same sameOrigin + LOCAL_ONLY + canExecute gate)", () => {
  assert.equal(LOCAL_ONLY.has("/api/dashboard/restart"), true);
  assert.equal(LOCAL_ONLY.has("/api/deploy"), true);
});

// ---- task 2.3: the createBridge(...) `restart:` entry itself, proven against a REAL bridge ----
//
// Task 2.2 proved agent/agent.mjs's `frame.kind === "restart"` branch against an INJECTED mock
// standing in for `opts.restart` — that only proves the relay/agent plumbing, not that
// dashboard/server.mjs's actual createBridge(...) call site wires anything real to it. These
// tests build the `restart:` value the exact same way the production call site does — reusing
// the REAL exported startSelfRestart/subscribeRestartLog, so a WS_IN "restart" frame really
// drives the real RESTART state object — with fakes injected only at runSelfRestart's own
// pre-existing seam (runPreflightFn/spawnFn) so no real candidate process is spawned and no real
// `systemctl` call is made.

test("a real WS_IN 'restart' frame, delivered to a bridge wired the same way dashboard/server.mjs's createBridge(...) call site wires it, actually runs the real startSelfRestart/RESTART pipeline end to end (pre-flight ok:true path)", async (t) => {
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

  let spawnCalls = 0;
  // Same object shape as dashboard/server.mjs's own createBridge(...) `restart:` entry — start()
  // calls the REAL startSelfRestart, subscribe is the REAL subscribeRestartLog. The only thing
  // swapped is runSelfRestart's own pre-existing runPreflightFn/spawnFn injection seam (task 2.1),
  // so this never spawns a real sandboxed candidate or calls real systemctl.
  const restart = {
    start: () => startSelfRestart({ runPreflightFn: async () => ({ ok: true }), spawnFn: () => { spawnCalls++; return { unref() {} }; } }),
    subscribe: subscribeRestartLog,
  };

  const bridge = createBridge({ url, deviceSecret: DEVICE, allowInsecure: true, snapshotIntervalMs: 60_000, restart, buildSnapshot: async () => ({}), log: () => {} }).start();
  t.after(() => { bridge.stop(); wss.close(); });
  await new Promise((r) => setTimeout(r, 150));

  sockRef.send(JSON.stringify({ t: FRAME.WS_IN, kind: "restart", sessionKey: null, data: {} }));
  await new Promise((r) => setTimeout(r, 200));

  assert.ok(wsOutFrames.some((f) => f.kind === "restart-log"), "the REAL RESTART pipeline's pre-flight log lines must stream back up the tunnel");
  const done = wsOutFrames.filter((f) => f.kind === "restart-done");
  assert.equal(done.length, 1, "exactly one terminal restart-done frame");
  assert.equal(done[0].data.ok, true, "a healthy pre-flight must report ok:true through the real wiring");
  assert.equal(spawnCalls, 1, "the real restart command must actually be triggered once pre-flight reports ok:true");
});

test("a real WS_IN 'restart' frame, delivered through the same real wiring, reports the pre-flight refusal reason end to end and never triggers the restart command (pre-flight ok:false path)", async (t) => {
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

  let spawnCalls = 0;
  const restart = {
    start: () => startSelfRestart({ runPreflightFn: async () => ({ ok: false, reason: "timeout" }), spawnFn: () => { spawnCalls++; return { unref() {} }; } }),
    subscribe: subscribeRestartLog,
  };

  const bridge = createBridge({ url, deviceSecret: DEVICE, allowInsecure: true, snapshotIntervalMs: 60_000, restart, buildSnapshot: async () => ({}), log: () => {} }).start();
  t.after(() => { bridge.stop(); wss.close(); });
  await new Promise((r) => setTimeout(r, 150));

  sockRef.send(JSON.stringify({ t: FRAME.WS_IN, kind: "restart", sessionKey: null, data: {} }));
  await new Promise((r) => setTimeout(r, 200));

  const done = wsOutFrames.filter((f) => f.kind === "restart-done");
  assert.equal(done.length, 1, "exactly one terminal restart-done frame");
  assert.equal(done[0].data.ok, false, "a pre-flight refusal must report ok:false through the real wiring, never silently ok:true");
  assert.equal(spawnCalls, 0, "the real restart command must never be triggered when pre-flight refuses");
});

// ---- review finding C: CM_PREFLIGHT must sandbox the LocalHost aggregator + backup scheduler,
// not just the bridge connection ----
//
// Before this fix, AGG.ensure() and the backup-scheduler timers lived in the entrypoint's boot
// block ungated by CM_PREFLIGHT — a pre-flight candidate could spawn a REAL aggregator child (if
// one wasn't already running) then kill it a few seconds later via its own shutdown(), a side
// effect on shared infrastructure from what's supposed to be a pure, isolated health check.
// bootLocalSubsystems() is the extracted, injectable form of that boot-time logic so this is
// provable directly (spy/count calls) rather than by "no visible symptom".

test("bootLocalSubsystems calls neither agg.ensure() nor the backup-scheduler timers under CM_PREFLIGHT=1 — a pre-flight candidate must touch nothing shared", () => {
  const prev = process.env.CM_PREFLIGHT;
  process.env.CM_PREFLIGHT = "1";
  try {
    let ensureCalls = 0, setTimeoutCalls = 0, setIntervalCalls = 0;
    const fakeAgg = { ensure: () => { ensureCalls++; return Promise.resolve({ present: false }); } };
    bootLocalSubsystems({
      agg: fakeAgg,
      setTimeoutFn: () => { setTimeoutCalls++; },
      setIntervalFn: () => { setIntervalCalls++; },
      startBridge: () => {},
      log: () => {},
    });
    assert.equal(ensureCalls, 0, "agg.ensure() must never be called for a CM_PREFLIGHT candidate");
    assert.equal(setTimeoutCalls, 0, "the backup-scheduler's first-fire setTimeout must never be registered for a CM_PREFLIGHT candidate");
    assert.equal(setIntervalCalls, 0, "the backup-scheduler's recurring setInterval must never be registered for a CM_PREFLIGHT candidate");
  } finally {
    if (prev === undefined) delete process.env.CM_PREFLIGHT; else process.env.CM_PREFLIGHT = prev;
  }
});

test("bootLocalSubsystems calls both agg.ensure() and the backup-scheduler timers in ordinary local-mode boot (no CM_PREFLIGHT set) — the fix must not silently disable them for a normal launch", () => {
  const prev = process.env.CM_PREFLIGHT;
  delete process.env.CM_PREFLIGHT;
  try {
    let ensureCalls = 0, setTimeoutCalls = 0, setIntervalCalls = 0;
    const fakeAgg = { ensure: () => { ensureCalls++; return Promise.resolve({ present: false }); } };
    bootLocalSubsystems({
      agg: fakeAgg,
      setTimeoutFn: () => { setTimeoutCalls++; },
      setIntervalFn: () => { setIntervalCalls++; },
      startBridge: () => {},   // stubbed so this never opens a real bridge connection in a test
      log: () => {},
    });
    assert.equal(ensureCalls, 1, "agg.ensure() must still be called on a normal (non-preflight) local boot");
    assert.equal(setTimeoutCalls, 1, "the backup-scheduler's first-fire setTimeout must still be registered on a normal local boot");
    assert.equal(setIntervalCalls, 1, "the backup-scheduler's recurring setInterval must still be registered on a normal local boot");
  } finally {
    if (prev !== undefined) process.env.CM_PREFLIGHT = prev;
  }
});

// ---- review finding D: the scratch port must never collide with the real dashboard's own port ----
//
// randomScratchPort's 20000-39999 draw had no check against the resolved real PORT — a collision
// would make server.listen() throw EADDRINUSE (uncaught, no error handler), OR — worse — make the
// candidate's poll loop hit the ALREADY-HEALTHY REAL process on that port and report a false
// ok:true that proves nothing about the candidate. randomFn is injectable so the re-roll can be
// proven against a FORCED collision, not just trusted to avoid one by luck.

test("randomScratchPort re-rolls until it differs from the excluded (real) port, proven against a forced collision on the first three draws", () => {
  // 0.25 -> 20000 + floor(0.25*20000) = 25000 (the forced collision, repeated 3 times);
  // 0.5  -> 20000 + floor(0.5 *20000) = 30000 (the first non-colliding draw).
  const sequence = [0.25, 0.25, 0.25, 0.5];
  let calls = 0;
  const randomFn = () => sequence[Math.min(calls++, sequence.length - 1)];
  const port = randomScratchPort(25000, randomFn);
  assert.equal(port, 30000);
  assert.equal(calls, 4, "must have re-rolled through every forced-colliding draw before accepting the first non-colliding one");
});

test("randomScratchPort never returns the excluded port across many real-random draws", () => {
  for (let i = 0; i < 2000; i++) {
    assert.notEqual(randomScratchPort(PORT), PORT);
  }
});

test("runSelfRestart's default scratch port (no override supplied) is never the resolved real dashboard PORT", async () => {
  let capturedScratchPort = null;
  await runSelfRestart({
    repoRoot: "/fake/repo",
    preflightStepsFn: (opts) => { capturedScratchPort = opts.scratchPort; return { spawn: { cmd: "node", args: [], cwd: "/", env: {} }, poll: { url: "http://x", intervalMs: 1, timeoutMs: 1 } }; },
    runPreflightFn: async () => ({ ok: true }),
    spawnFn: () => ({ unref() {} }),
  });
  assert.ok(Number.isInteger(capturedScratchPort), "preflightStepsFn should have received a numeric scratchPort");
  assert.notEqual(capturedScratchPort, PORT, "the candidate's own scratch port must never equal the resolved real dashboard PORT");
});
