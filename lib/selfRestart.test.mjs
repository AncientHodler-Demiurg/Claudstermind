// node --test lib/selfRestart.test.mjs — pure-data plan + injectable executor, never a real
// process/port. Mirrors lib/deploy.test.mjs's absence-of-real-I/O style used across lib/*.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { preflightSteps, runPreflight, restartCommand, killInFlightCandidate } from "./selfRestart.mjs";

// A fake child_process.spawn(): returns an EventEmitter with a spy `kill()`, and lets the test
// script an `exit` event whenever it wants (or never, for the "keeps running" cases).
function fakeChild() {
  const child = new EventEmitter();
  child.killCalls = 0;
  child.kill = () => { child.killCalls += 1; };
  return child;
}

test("preflightSteps returns pure data — no spawning, no fetching, describes the candidate + poll", () => {
  const steps = preflightSteps({ repoRoot: "/repo", scratchPort: 45123, timeoutMs: 5000 });
  assert.equal(steps.spawn.cmd, "node");
  assert.deepEqual(steps.spawn.args, ["dashboard/server.mjs"]);
  assert.equal(steps.spawn.cwd, "/repo");
  assert.equal(steps.spawn.env.CM_PREFLIGHT, "1");
  assert.equal(steps.spawn.env.PORT, "45123");
  assert.equal(steps.poll.url, "http://127.0.0.1:45123/api/version");
  assert.equal(steps.poll.timeoutMs, 5000);
  assert.equal(typeof steps.poll.intervalMs, "number");
});

test("runPreflight resolves ok:true once the candidate answers healthy, and kills it after", async () => {
  const steps = preflightSteps({ repoRoot: "/repo", scratchPort: 45123, timeoutMs: 5000 });
  const child = fakeChild();
  const spawnFn = () => child;
  let calls = 0;
  // first two polls: connection-refused (candidate still starting); third: healthy, and
  // identifies itself as the pre-flight candidate via `preflight:true` in its /api/version body
  // (review finding D — a bare 200 alone isn't proof it's OUR candidate, not some other process
  // that happened to be squatting the scratch port).
  const fetchFn = async () => {
    calls += 1;
    if (calls < 3) throw new Error("ECONNREFUSED");
    return { ok: true, json: async () => ({ preflight: true }) };
  };
  const result = await runPreflight(steps, { spawnFn, fetchFn, sleepFn: async () => {} });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 3, "should have retried through the connection-refused polls before success");
  assert.equal(child.killCalls, 1, "the candidate must be killed once healthy — never left running");
});

test("runPreflight resolves ok:false/timeout when the candidate never answers, without real wall-clock waiting", async () => {
  const steps = preflightSteps({ repoRoot: "/repo", scratchPort: 45124, timeoutMs: 1000 });
  const child = fakeChild();
  const spawnFn = () => child;
  const fetchFn = async () => { throw new Error("ECONNREFUSED"); }; // never answers
  // deterministic fake clock: advances by 400ms per call, no real setTimeout delay anywhere.
  let clock = 0;
  const now = () => clock;
  const sleepFn = async () => { clock += 400; };
  const startedAt = Date.now();
  const result = await runPreflight(steps, { spawnFn, fetchFn, now, sleepFn });
  const elapsedReal = Date.now() - startedAt;
  assert.deepEqual(result, { ok: false, reason: "timeout" });
  assert.equal(child.killCalls, 1, "the candidate must be killed on timeout too");
  assert.ok(elapsedReal < 200, `test must not burn real wall-clock time waiting out timeoutMs (took ${elapsedReal}ms)`);
});

test("runPreflight resolves ok:false/crashed with detail when the candidate exits before answering healthy", async () => {
  const steps = preflightSteps({ repoRoot: "/repo", scratchPort: 45125, timeoutMs: 5000 });
  const child = fakeChild();
  const spawnFn = () => child;
  const fetchFn = async () => { throw new Error("ECONNREFUSED"); }; // never gets a healthy answer
  // schedule the crash to fire on the very next microtask tick, before the first fetch resolves.
  queueMicrotask(() => child.emit("exit", 1, null));
  const result = await runPreflight(steps, { spawnFn, fetchFn, sleepFn: async () => {} });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "crashed");
  assert.equal(result.detail.code, 1, "detail should carry the exit code");
  assert.equal(child.killCalls, 1, "the candidate must still be killed on crash (idempotent, but asserted)");
});

test("restartCommand returns the exact sudo+systemctl invocation as data — never runs it", async () => {
  const cmd = restartCommand();
  // `sudo -n`: a bare `systemctl restart` on a system unit fails immediately for a non-root user
  // (confirmed in production — "Access denied", exit 1, silently swallowed before this fix); `-n`
  // makes that failure fast and loud instead of hanging on a password prompt that can never come.
  assert.deepEqual(cmd, { cmd: "sudo", args: ["-n", "systemctl", "restart", "claudstermind"] });
  // it must not import/touch child_process at all — confirmed structurally: calling it a second
  // time in the same tick must not have spawned/killed anything (no side effects, pure data).
  const again = restartCommand();
  assert.deepEqual(again, cmd);
});

// ---- review finding D (defense in depth): a bare 200 from /api/version isn't proof the
// responder is OUR candidate rather than some other process (e.g. the real dashboard, if the
// scratch port ever collided with it despite dashboard/server.mjs's randomScratchPort re-roll
// fix) — the candidate's own /api/version response carries `preflight:true` so runPreflight can
// tell the difference instead of blindly trusting any 200. ----

test("runPreflight does not accept a 200 response lacking the preflight:true marker as healthy — defends against a scratch-port collision with some other live process", async () => {
  const steps = preflightSteps({ repoRoot: "/repo", scratchPort: 45126, timeoutMs: 1200 });
  const child = fakeChild();
  const spawnFn = () => child;
  // Answers ok:true on EVERY poll, exactly like an already-healthy unrelated process squatting
  // the scratch port would — but its body never carries `preflight:true`.
  const fetchFn = async () => ({ ok: true, json: async () => ({ version: "9.9.9" }) });
  let clock = 0;
  const now = () => clock;
  const sleepFn = async () => { clock += 400; };
  const result = await runPreflight(steps, { spawnFn, fetchFn, now, sleepFn });
  assert.deepEqual(result, { ok: false, reason: "timeout" }, "an unidentified 200 must never be mistaken for the candidate answering healthy");
  assert.equal(child.killCalls, 1, "the candidate must still be killed on timeout, even though something else answered 200 on its port");
});

// ---- review finding E: an in-flight pre-flight candidate has no lifecycle tie to its parent ----
//
// runPreflight spawns the candidate with no `detached` option and no exit/signal handler to reap
// it if the PARENT dies before its own kill() runs. killInFlightCandidate() is the exported
// safety net dashboard/server.mjs's shutdown() calls alongside its existing AGG.stop() — proving
// it here (against a fake/injected child handle) is the unit-level half of that fix; the
// dashboard/server.mjs wiring itself is exercised only by reading the diff, per this file's own
// convention of never driving shutdown()/process.exit() from a test.

test("killInFlightCandidate force-kills the currently in-flight candidate while runPreflight is still polling — the parent's cleanup path must not have to wait for runPreflight's own timeout", async () => {
  const steps = preflightSteps({ repoRoot: "/repo", scratchPort: 45127, timeoutMs: 5000 });
  const child = fakeChild();
  const spawnFn = () => child;
  const fetchFn = async () => { throw new Error("ECONNREFUSED"); }; // never answers on its own
  let clock = 0;
  const now = () => clock;
  let polls = 0;
  const sleepFn = async () => {
    polls += 1;
    if (polls === 2) {
      // Simulate the parent process's own shutdown path firing mid-poll.
      killInFlightCandidate();
      assert.equal(child.killCalls, 1, "child.kill() must fire the moment killInFlightCandidate runs, not only once runPreflight itself times out");
    }
    clock += 400;
  };
  await runPreflight(steps, { spawnFn, fetchFn, now, sleepFn });
});

test("killInFlightCandidate is a safe no-op when no pre-flight candidate is currently in flight", () => {
  assert.doesNotThrow(() => killInFlightCandidate());
});
