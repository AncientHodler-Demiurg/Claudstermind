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
import "./_test-no-sessiond.mjs";   // MUST be first — clears SESSIOND_SOCK before ./server.mjs loads (else a test run through the live service hangs dialing the daemon)
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { WebSocketServer } from "ws";
import { readBody, PayloadTooLargeError, bridgeEnabled, runSelfRestart, startSelfRestart, subscribeRestartLog, LOCAL_ONLY, bootLocalSubsystems, randomScratchPort, PORT, selectWorkspace } from "./server.mjs";
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

test("REGRESSION: runSelfRestart retries once on a fresh port when the pre-flight candidate crashes, and succeeds if the retry is healthy — a scratch-port collision must self-heal instead of failing the whole restart", async () => {
  // Confirmed in production: the candidate's own server.listen() had no error handler (fixed
  // separately), so a scratch-port collision crashed it, reported as reason:"crashed" — and
  // nothing retried, so the operator saw "pre-flight failed" and had to click Reload again by
  // hand. A collision is rare-but-real on a random draw; unlike an actual code defect (which
  // would crash again just as fast on the retry), it's fixed by simply trying a different port.
  const seenPorts = [];
  let preflightCalls = 0;
  const result = await runSelfRestart({
    repoRoot: "/fake/repo",
    scratchPort: 34573,
    preflightStepsFn: (opts) => { seenPorts.push(opts.scratchPort); return { spawn: { cmd: "node", args: [], cwd: "/", env: {} }, poll: { url: "http://x", intervalMs: 1, timeoutMs: 1 } }; },
    runPreflightFn: async () => {
      preflightCalls++;
      return preflightCalls === 1 ? { ok: false, reason: "crashed", detail: { code: 1, signal: null } } : { ok: true };
    },
    randomScratchPortFn: () => 34574,
    spawnFn: () => ({ unref() {} }),
  });
  assert.equal(preflightCalls, 2, "must retry exactly once after a crash, not give up on the first try");
  assert.deepEqual(seenPorts, [34573, 34574], "the retry must use a freshly-rolled port, not the same colliding one");
  assert.equal(result.ok, true, "a crash followed by a healthy retry must succeed, not surface the first attempt's failure");
});

test("runSelfRestart does NOT retry a second time — two crashes in a row report failure rather than retrying forever", async () => {
  let preflightCalls = 0;
  const result = await runSelfRestart({
    repoRoot: "/fake/repo",
    scratchPort: 34575,
    preflightStepsFn: () => ({ spawn: { cmd: "node", args: [], cwd: "/", env: {} }, poll: { url: "http://x", intervalMs: 1, timeoutMs: 1 } }),
    runPreflightFn: async () => { preflightCalls++; return { ok: false, reason: "crashed", detail: { code: 1, signal: null } }; },
    randomScratchPortFn: () => 34576,
    spawnFn: () => ({ unref() {} }),
  });
  assert.equal(preflightCalls, 2, "exactly two attempts total — not an unbounded retry loop");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "crashed");
});

test("runSelfRestart does NOT retry a 'timeout' reason — only a 'crashed' pre-flight is retried, since a hang isn't fixed by a different port", async () => {
  let preflightCalls = 0;
  const result = await runSelfRestart({
    repoRoot: "/fake/repo",
    scratchPort: 34577,
    runPreflightFn: async () => { preflightCalls++; return { ok: false, reason: "timeout" }; },
    spawnFn: () => ({ unref() {} }),
  });
  assert.equal(preflightCalls, 1, "a timeout must not trigger the crash-only retry");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "timeout");
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
  assert.equal(spawned.cmd, "sudo");
  // Default restartDaemon:true → both units (a reload that picks up engine changes).
  assert.deepEqual(spawned.args, ["-n", "systemctl", "restart", "claudstermind-sessiond", "claudstermind"]);
});

test("runSelfRestart with restartDaemon:false restarts the WEB only — a web-only reload keeps agents alive", async () => {
  let spawned = null;
  const result = await runSelfRestart({
    repoRoot: "/fake/repo",
    scratchPort: 34569,
    restartDaemon: false,
    runPreflightFn: async () => ({ ok: true }),
    spawnFn: (cmd, args, opts) => { spawned = { cmd, args, opts }; return { unref() {} }; },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(spawned.args, ["-n", "systemctl", "restart", "claudstermind"],
    "engine code unchanged → sessiond is NOT restarted, so in-flight turns (and a pending prompt) survive");
});

// The reload dialog's "also restart the session engine" tick. git-derived detection is blind to
// node_modules/ — bumping the bundled Claude CLI changes zero TRACKED files, so daemonAffected comes
// back false and the engine would keep the old binary in memory. forceDaemon is the user's override.
test("startSelfRestart({ forceDaemon: true }) restarts the ENGINE even when git detected no tracked change", async () => {
  let spawned = null;
  const r = startSelfRestart({
    forceDaemon: true,
    // Pin git-detection to FALSE — that is the exact situation the tick exists for (a bumped CLI under
    // node_modules/, invisible to git). Without pinning, a working tree with uncommitted engine edits
    // reports daemonAffected:true on its own and this test would pass even with forceDaemon deleted.
    daemonAffectedFn: () => false,
    repoRoot: "/fake/repo",
    scratchPort: 34570,
    runPreflightFn: async () => ({ ok: true }),
    spawnFn: (cmd, args, opts) => { spawned = { cmd, args, opts }; return { unref() {} }; },
  });
  assert.equal(r.ok, true, "the pre-flight should start");
  // startSelfRestart is fire-and-forget (it returns before the async pipeline resolves) — wait for the
  // real spawn rather than asserting on a race.
  for (let i = 0; i < 100 && !spawned; i++) await new Promise((res) => setTimeout(res, 10));
  assert.ok(spawned, "spawnFn should have been called");
  assert.deepEqual(spawned.args, ["-n", "systemctl", "restart", "claudstermind-sessiond", "claudstermind"],
    "forceDaemon must add sessiond — this is the whole point of the tick (a CLI bump git cannot see)");
});

test("forceDaemon only ever ADDS the engine restart — it never suppresses an auto-detected one", async () => {
  // Guard against a regression where threading the flag accidentally turned into an override that could
  // set restartDaemon=false. Absent/false forceDaemon must leave the git-derived decision untouched.
  let spawned = null;
  const r = startSelfRestart({
    forceDaemon: false,
    daemonAffectedFn: () => true,     // git DID see an engine change
    repoRoot: "/fake/repo",
    scratchPort: 34571,
    runPreflightFn: async () => ({ ok: true }),
    spawnFn: (cmd, args, opts) => { spawned = { cmd, args, opts }; return { unref() {} }; },
  });
  assert.equal(r.ok, true);
  for (let i = 0; i < 100 && !spawned; i++) await new Promise((res) => setTimeout(res, 10));
  assert.ok(spawned, "spawnFn should have been called");
  assert.deepEqual(spawned.args, ["-n", "systemctl", "restart", "claudstermind-sessiond", "claudstermind"],
    "an unticked box must NOT cancel the auto-detected engine restart");
});

test("no tick + no git-detected engine change → web only (the untouched default path)", async () => {
  let spawned = null;
  const r = startSelfRestart({
    daemonAffectedFn: () => false,
    repoRoot: "/fake/repo",
    scratchPort: 34572,
    runPreflightFn: async () => ({ ok: true }),
    spawnFn: (cmd, args, opts) => { spawned = { cmd, args, opts }; return { unref() {} }; },
  });
  assert.equal(r.ok, true);
  for (let i = 0; i < 100 && !spawned; i++) await new Promise((res) => setTimeout(res, 10));
  assert.deepEqual(spawned.args, ["-n", "systemctl", "restart", "claudstermind"],
    "web-only reload keeps sessiond and every in-flight agent turn alive");
});

/** A minimal fake child_process.ChildProcess: real EventEmitter (so `.on("exit"/"error")` works
 *  exactly like production code expects), a fake `.stderr` stream, and `.unref()`. Lets a test
 *  simulate the restart command actually running and failing fast — the exact production
 *  scenario (`systemctl restart` without sudo: instant "Access denied", exit 1) this fix targets. */
function fakeChild() {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.unref = () => {};
  return child;
}

test("REGRESSION: runSelfRestart reports a fast restart-command failure instead of silently claiming success", async () => {
  let spawned = null;
  const child = fakeChild();
  const resultPromise = runSelfRestart({
    repoRoot: "/fake/repo",
    scratchPort: 34570,
    runPreflightFn: async () => ({ ok: true }),
    spawnFn: (cmd, args, opts) => { spawned = { cmd, args, opts }; return child; },
  });
  // Simulate the real production failure: sudo/systemctl writes to stderr and exits non-zero,
  // fast — before this fix, nothing looked at either, and "✓ triggered" was reported regardless.
  await new Promise((r) => setImmediate(r));
  child.stderr.emit("data", Buffer.from("Failed to restart claudstermind.service: Access denied"));
  child.emit("exit", 1);
  const result = await resultPromise;
  assert.equal(result.ok, false, "a fast non-zero exit must be reported as failure, not silent success");
  assert.equal(result.reason, "restart-command-failed");
  assert.match(result.detail, /Access denied/);
});

test("runSelfRestart still reports success when the restart command exits 0 quickly (e.g. --no-block)", async () => {
  const child = fakeChild();
  const resultPromise = runSelfRestart({
    repoRoot: "/fake/repo",
    scratchPort: 34571,
    runPreflightFn: async () => ({ ok: true }),
    spawnFn: () => child,
  });
  await new Promise((r) => setImmediate(r));
  child.emit("exit", 0);
  const result = await resultPromise;
  assert.equal(result.ok, true);
});

test("runSelfRestart reports success (unchanged) when the restart command never exits within the fast-fail window — the normal successful-restart case, where THIS process dies mid-command", async () => {
  const child = fakeChild();
  const result = await runSelfRestart({
    repoRoot: "/fake/repo",
    scratchPort: 34572,
    restartExitWindowMs: 20,   // real default is 3000ms; shortened here only so the test is fast
    runPreflightFn: async () => ({ ok: true }),
    spawnFn: () => child,   // never emits "exit" — exactly the real "it worked, we're about to die" case
  });
  assert.equal(result.ok, true);
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

// ---- Session engine selection (deploy-survivable agents, Wave 2 T2.2) ----
// selectWorkspace decides between the in-process WorkspaceManager (today) and a SessiondClient,
// gated behind SESSIOND_SOCK + reachability. These prove all three branches with injected seams
// (no real socket, no real WorkspaceManager) — the critical property being that a flag that's unset
// or unreachable runs the exact in-process path, so the live app never regresses.

test("selectWorkspace: SESSIOND_SOCK unset → in-process engine, client never even constructed", async () => {
  let madeClient = false;
  const inproc = { kind: "in-process" };
  const ws = await selectWorkspace({
    env: {},                                   // no SESSIOND_SOCK
    makeInProcess: () => inproc,
    makeClient: () => { madeClient = true; return {}; },
    log: {},
  });
  assert.equal(ws, inproc);
  assert.equal(madeClient, false, "the daemon client must not be constructed when the flag is unset");
});

test("selectWorkspace: SESSIOND_SOCK set + daemon reachable → the SessiondClient", async () => {
  const client = { probe: async () => true, close() { throw new Error("must not close a live client"); } };
  let madeInProcess = false;
  const logs = [];
  const ws = await selectWorkspace({
    env: { SESSIOND_SOCK: "/run/x.sock" },
    makeInProcess: () => { madeInProcess = true; return { kind: "in-process" }; },
    makeClient: () => client,
    log: { log: (m) => logs.push(m), warn: (m) => logs.push(m) },
  });
  assert.equal(ws, client, "a reachable daemon must yield the client");
  assert.equal(madeInProcess, false, "must not build the in-process engine when the daemon answers");
  assert.ok(logs.some((l) => /sessiond daemon/.test(l)), "logs that it is using the daemon");
});

test("selectWorkspace: SESSIOND_SOCK set but daemon UNREACHABLE → in-process fallback + client closed", async () => {
  let closed = false;
  const client = { probe: async () => false, close() { closed = true; } };
  const inproc = { kind: "in-process" };
  const logs = [];
  const ws = await selectWorkspace({
    env: { SESSIOND_SOCK: "/run/x.sock" },
    makeInProcess: () => inproc,
    makeClient: () => client,
    log: { log: (m) => logs.push(m), warn: (m) => logs.push(m) },
  });
  assert.equal(ws, inproc, "an unreachable daemon must fall back to the in-process engine");
  assert.equal(closed, true, "the probed-but-unreachable client must be closed, not leaked");
  assert.ok(logs.some((l) => /unreachable/.test(l)), "warns that it fell back");
});

test("selectWorkspace: AUTO-DETECT — no SESSIOND_SOCK, but a default daemon socket exists + answers → the client (shared engine)", async () => {
  const client = { probe: async () => true, close() {} };
  const seen = [];
  const ws = await selectWorkspace({
    env: {},                                                   // no explicit flag
    socketPaths: ["/run/claudstermind/sessiond.sock"],        // a known default path
    exists: (p) => { seen.push(p); return p === "/run/claudstermind/sessiond.sock"; },
    makeInProcess: () => ({ kind: "in-process" }),
    makeClient: (sock) => { client._sock = sock; return client; },
    log: {},
  });
  assert.equal(ws, client, "an auto-detected reachable daemon must be used even without SESSIOND_SOCK");
  assert.equal(client._sock, "/run/claudstermind/sessiond.sock", "the client is dialed at the detected socket");
});

test("selectWorkspace: AUTO-DETECT — no daemon socket present anywhere → in-process, client never constructed", async () => {
  let madeClient = false;
  const ws = await selectWorkspace({
    env: {},
    socketPaths: ["/run/claudstermind/sessiond.sock", "/run/claudstermind-sessiond.sock"],
    exists: () => false,                                       // no socket files → daemon isn't on this box
    makeInProcess: () => ({ kind: "in-process" }),
    makeClient: () => { madeClient = true; return {}; },
    log: {},
  });
  assert.deepEqual(ws, { kind: "in-process" });
  assert.equal(madeClient, false, "with no socket file present, the client must not be constructed");
});

test("selectWorkspace: SESSIOND_SOCK takes priority over the auto-detect candidates", async () => {
  const client = { probe: async () => true, close() {} };
  const ws = await selectWorkspace({
    env: { SESSIOND_SOCK: "/custom/sock" },
    socketPaths: ["/run/claudstermind/sessiond.sock"],
    exists: undefined,                                         // no existence gate → try in order
    makeInProcess: () => ({ kind: "in-process" }),
    makeClient: (sock) => { client._sock = sock; return client; },
    log: {},
  });
  assert.equal(client._sock, "/custom/sock", "the explicit flag is dialed first");
});

test("selectWorkspace: RETRIES a co-restarting daemon (socket appears late) instead of falling back to in-process", async () => {
  // Reload restarts BOTH units, so the web can boot while sessiond's socket is momentarily gone. The
  // one-shot probe used to lose that race and demote to in-process (the split-engine desync). Now it
  // polls: here the socket only appears on the 3rd pass, and it must attach — never in-process.
  const slept = [];
  let existsPass = 0;
  let last;
  const ws = await selectWorkspace({
    env: {},
    socketPaths: ["/run/claudstermind/sessiond.sock"],
    exists: () => (++existsPass >= 3),                // absent for the first two passes, then present
    makeInProcess: () => ({ kind: "in-process" }),
    makeClient: () => (last = { probe: async () => true, close() {} }),
    log: {},
    attempts: 5, waitMs: 10, sleep: async (ms) => { slept.push(ms); },
  });
  assert.equal(ws, last, "must attach to the daemon once its socket appears, not fall back");
  assert.deepEqual(slept, [10, 10], "slept between the two empty passes, then attached on the third");
});

test("selectWorkspace: falls back to in-process only AFTER exhausting the retry window", async () => {
  const slept = [];
  const inproc = { kind: "in-process" };
  let probes = 0;
  const ws = await selectWorkspace({
    env: {},
    socketPaths: ["/run/claudstermind/sessiond.sock"],
    exists: () => true,
    makeInProcess: () => inproc,
    makeClient: () => ({ probe: async () => { probes++; return false; }, close() {} }),
    log: {},
    attempts: 3, waitMs: 5, sleep: async (ms) => { slept.push(ms); },
  });
  assert.equal(ws, inproc);
  assert.equal(probes, 3, "probed on every one of the 3 attempts");
  assert.equal(slept.length, 2, "slept between attempts, not after the last");
});

test("selectWorkspace: a throwing client constructor still falls back to in-process (never crashes)", async () => {
  const inproc = { kind: "in-process" };
  const ws = await selectWorkspace({
    env: { SESSIOND_SOCK: "/run/x.sock" },
    makeInProcess: () => inproc,
    makeClient: () => { throw new Error("boom"); },
    log: { log() {}, warn() {} },
  });
  assert.equal(ws, inproc, "a client that throws on construction must not take down engine selection");
});
