import test from "node:test";
import assert from "node:assert/strict";
import { reduceBackground, shapeBackground, k, pruneFinished, RETAIN_DONE_MS } from "./backgroundTasks.mjs";

test("sequence background→taskStarted→taskDone: running→done + token sum", () => {
  let s = { tasks: {} };
  // authoritative live set
  s = reduceBackground(s, { kind: "background", tasks: [{ id: "a", taskType: "review", description: "audit lib" }] });
  assert.equal(s.tasks.a.status, "running");
  assert.equal(s.tasks.a.description, "audit lib");

  // taskStarted enriches, carries startedAt from a timestamp field
  s = reduceBackground(s, { kind: "taskStarted", id: "a", taskType: "review", workflowName: "wf1", description: "", startedAt: 1000 });
  assert.equal(s.tasks.a.status, "running");
  assert.equal(s.tasks.a.startedAt, 1000);
  assert.equal(s.tasks.a.workflowName, "wf1");
  // description not dropped by the empty-string later event
  assert.equal(s.tasks.a.description, "audit lib");

  // taskDone settles it + carries tokens
  s = reduceBackground(s, { kind: "taskDone", id: "a", status: "completed", summary: "ok", tokens: 128000 });
  assert.equal(s.tasks.a.status, "done");
  assert.equal(s.tasks.a.tokens, 128000);

  const shaped = shapeBackground(s, 5000);
  assert.equal(shaped.count, 1);
  assert.equal(shaped.done, 1);
  assert.equal(shaped.running, 0);
  assert.equal(shaped.totalTokens, 128000);
});

test("taskDone with an error status maps to 'error'", () => {
  let s = reduceBackground({ tasks: {} }, { kind: "taskStarted", id: "x", taskType: "build", startedAt: 1 });
  s = reduceBackground(s, { kind: "taskDone", id: "x", status: "failed" });
  assert.equal(s.tasks.x.status, "error");
  assert.equal(shapeBackground(s, 2).done, 1);
});

test("unknown id on taskDone creates a minimal entry", () => {
  const s = reduceBackground({ tasks: {} }, { kind: "taskDone", id: "ghost", status: "completed", tokens: 500 });
  assert.equal(s.tasks.ghost.status, "done");
  assert.equal(s.tasks.ghost.tokens, 500);
});

test("background REPLACE drops a vanished task", () => {
  let s = reduceBackground({ tasks: {} }, {
    kind: "background",
    tasks: [{ id: "a", taskType: "t", description: "A" }, { id: "b", taskType: "t", description: "B" }],
  });
  assert.equal(shapeBackground(s, 0).count, 2);
  // authoritative set no longer contains "a"
  s = reduceBackground(s, { kind: "background", tasks: [{ id: "b", taskType: "t", description: "B" }] });
  assert.equal(s.tasks.a.status, "removed");
  const shaped = shapeBackground(s, 0);
  assert.equal(shaped.count, 1);
  assert.deepEqual(shaped.agents.map((x) => x.id), ["b"]);
});

test("shapeBackground computes count/running/elapsed/totalTokens + running-first sort", () => {
  let s = { tasks: {} };
  s = reduceBackground(s, { kind: "taskStarted", id: "old", subagentType: "Explore", startedAt: 100 });
  s = reduceBackground(s, { kind: "taskStarted", id: "new", subagentType: "Plan", startedAt: 300 });
  s = reduceBackground(s, { kind: "taskStarted", id: "fin", taskType: "review", startedAt: 200 });
  s = reduceBackground(s, { kind: "taskDone", id: "fin", status: "completed", tokens: 2000 });

  const shaped = shapeBackground(s, 1000);
  assert.equal(shaped.count, 3);
  assert.equal(shaped.running, 2);
  assert.equal(shaped.done, 1);
  assert.equal(shaped.totalTokens, 2000);
  // running first (by startedAt), settled last
  assert.deepEqual(shaped.agents.map((a) => a.id), ["old", "new", "fin"]);
  // labels: subagentType preferred, else taskType, else "agent"
  assert.equal(shaped.agents[0].label, "Explore");
  assert.equal(shaped.agents[2].label, "review");
  // elapsed = now - startedAt
  assert.equal(shaped.agents[0].elapsedMs, 900);
});

test("elapsedMs is NULL (not 0) without startedAt or now — 0 is never meaningfully true", () => {
  // A truly 0 ms-old agent is unobservable, so 0 could only ever mean "unknown" — and rendering it
  // as an elapsed time produced a fake "0s" that never ticked. null says unknown out loud.
  const s = reduceBackground({ tasks: {} }, { kind: "background", tasks: [{ id: "a", taskType: "t" }] });
  assert.equal(shapeBackground(s, 5000).agents[0].elapsedMs, null); // no startedAt
  assert.equal(shapeBackground(s, 5000).agents[0].startedAt, null);
  const s2 = reduceBackground({ tasks: {} }, { kind: "taskStarted", id: "a", startedAt: 100 });
  assert.equal(shapeBackground(s2, 0).agents[0].elapsedMs, null); // no now
  assert.equal(shapeBackground(s2, 0).agents[0].startedAt, 100, "startedAt survives even with no `now`");
});

test("startedAt rides on every panel row, so a reconnecting client can tick a REAL clock", () => {
  // CONTRACT §2a: elapsedMs is a snapshot taken at emit time. Without the absolute instant behind it a
  // client that reloads has to restart a browser-local timer — the exact reset `turnStartedAt` exists
  // to avoid (CONTRACT §6). With startedAt it recomputes against its own clock instead.
  let s = reduceBackground({ tasks: {} }, { kind: "taskStarted", id: "a", subagentType: "Explore", startedAt: 1000 });
  s = reduceBackground(s, { kind: "taskStarted", id: "b", taskType: "agent", startedAt: 2000 });
  s = reduceBackground(s, { kind: "taskDone", id: "b", status: "completed" });
  const panel = shapeBackground(s, 3000);
  assert.deepEqual(panel.agents.map((a) => a.startedAt), [1000, 2000]);
  // elapsedMs is LIVE time only: the running agent has it, the settled one does not — its clock stopped.
  assert.deepEqual(panel.agents.map((a) => a.elapsedMs), [2000, null]);
  // a settled agent keeps its start time too — "ran for N" is still renderable, from durationMs
  assert.equal(panel.agents[1].status, "done");
  assert.equal(panel.agents[1].startedAt, 2000);
  // This taskDone carried no timestamp, so the duration is genuinely UNKNOWN — and stays null rather
  // than being invented from the reducer's own wall clock.
  assert.equal(panel.agents[1].durationMs, null, "no finish time reported means unknown, not a guess");
});

test("malformed events don't throw and leave state unchanged", () => {
  const s0 = { tasks: { a: { id: "a", status: "running", tokens: 0 } } };
  assert.equal(reduceBackground(s0, null), s0);
  assert.equal(reduceBackground(s0, 42), s0);
  assert.equal(reduceBackground(s0, "nope"), s0);
  assert.doesNotThrow(() => reduceBackground(s0, { kind: "background", tasks: [null, { }, 7] }));
  assert.doesNotThrow(() => reduceBackground(undefined, { kind: "taskStarted" }));
  assert.doesNotThrow(() => reduceBackground(s0, { kind: "unknown" }));
});

test("empty / null-safe state → zeroed shape", () => {
  const z = { count: 0, running: 0, done: 0, agents: [], totalTokens: 0 };
  assert.deepEqual(shapeBackground({ tasks: {} }, 1000), z);
  assert.deepEqual(shapeBackground(null, 1000), z);
  assert.deepEqual(shapeBackground(undefined, undefined), z);
});

test("k() compact token formatter", () => {
  assert.equal(k(128000), "128k");
  assert.equal(k(1200000), "1.2M");
  assert.equal(k(1200), "1.2k");
  assert.equal(k(500), "500");
  assert.equal(k("nope"), "0");
});

// ---------------------------------------------------------------------------------------------
// A finished task's clock must STOP. `elapsedMs` was `now - startedAt` whatever the status, so a
// four-second task read "9h 17m" nine hours later — a number that answers a question nobody asked.
// ---------------------------------------------------------------------------------------------

test("a finished task reports how long it TOOK, not how long ago it began", () => {
  const t0 = 1_000_000;
  let st = reduceBackground(undefined, { kind: "taskStarted", id: "a", description: "x", startedAt: t0 });
  st = reduceBackground(st, { kind: "taskDone", id: "a", status: "done", finishedAt: t0 + 4000 });
  const now = t0 + 9 * 3600 * 1000;                 // nine hours later
  const row = shapeBackground(st, now).agents.find((a) => a.id === "a");
  assert.equal(row.status, "done");
  assert.equal(row.elapsedMs, null, "a stopped clock must not keep ticking");
  assert.equal(row.durationMs, 4000, "it took four seconds and always will have");
  assert.equal(row.finishedAgoMs, now - (t0 + 4000), "…and ended a separately-known time ago");
  assert.equal(row.finishedAt, t0 + 4000);
});

test("a RUNNING task still reports live elapsed time", () => {
  const t0 = 500_000;
  const st = reduceBackground(undefined, { kind: "taskStarted", id: "b", description: "y", startedAt: t0 });
  const row = shapeBackground(st, t0 + 12_000).agents.find((a) => a.id === "b");
  assert.equal(row.status, "running");
  assert.equal(row.elapsedMs, 12_000);
  assert.equal(row.durationMs, null, "it has not taken a final amount of time yet");
});

test("an unknown start time yields null, never zero", () => {
  // 'started 0ms ago' and 'we do not know when it started' must not look identical.
  let st = reduceBackground(undefined, { kind: "taskStarted", id: "c", description: "z" });
  st = reduceBackground(st, { kind: "taskDone", id: "c", status: "error", finishedAt: 9 });
  const row = shapeBackground(st, 100).agents.find((a) => a.id === "c");
  assert.equal(row.durationMs, null, "no start time means the duration is unknown, not zero");
  assert.equal(row.finishedAgoMs, 91, "…but we do know when it ended");
});

// ---------------------------------------------------------------------------------------------
// RETENTION. Without it the panel becomes a session-long changelog — 26 rows, 23 of them successes
// from nine hours ago, burying the 3 that failed.
// ---------------------------------------------------------------------------------------------

function withTask(id, status, finishedAt, startedAt = 1000) {
  let s = reduceBackground(undefined, { kind: "taskStarted", id, description: id, startedAt });
  if (status) s = reduceBackground(s, { kind: "taskDone", id, status, finishedAt });
  return s;
}

test("a completed agent ages out; a RUNNING one never does", () => {
  const t = 1_000_000;
  let s = withTask("done1", "done", t);
  s.tasks.live1 = { id: "live1", status: "running", startedAt: t };
  const after = pruneFinished(s, t + RETAIN_DONE_MS + 1);
  assert.ok(!after.tasks.done1, "a success must not linger — nobody reads a nine-hour-old success");
  assert.ok(after.tasks.live1, "live work is the whole point of the panel and is never dropped");
});

test("a completed agent is kept BRIEFLY, so you can see what just happened", () => {
  const t = 1_000_000;
  const after = pruneFinished(withTask("d", "done", t), t + 1000);
  assert.ok(after.tasks.d, "still visible a second later");
});

test("an ERROR is never auto-dropped — only dismissal removes it", () => {
  // A failure that disappears on a timer is a failure you will never know about.
  const t = 1_000_000;
  const long = pruneFinished(withTask("e", "error", t), t + 24 * 3600 * 1000);
  assert.ok(long.tasks.e, "an error must survive any amount of time");
  const dismissed = pruneFinished(withTask("e", "error", t), t + 1000, { dismissed: ["e"] });
  assert.ok(!dismissed.tasks.e, "…and leave only when someone actually acknowledged it");
});

test("an agent whose end time we never learned is kept, not dropped on a guess", () => {
  let s = reduceBackground(undefined, { kind: "taskStarted", id: "u", description: "u", startedAt: 1 });
  s = reduceBackground(s, { kind: "taskDone", id: "u", status: "done" });   // no finishedAt reported
  const after = pruneFinished(s, 9e12);
  assert.ok(after.tasks.u, "unknown age must not be treated as old — that would drop rows arbitrarily");
});

test("pruning is pure and survives rubbish input", () => {
  const before = withTask("x", "done", 5);
  const copy = JSON.parse(JSON.stringify(before));
  pruneFinished(before, 1e9);
  assert.deepEqual(before, copy, "the input state must not be mutated");
  for (const bad of [null, undefined, {}, { tasks: null }]) {
    assert.ok(pruneFinished(bad, 1).tasks !== undefined);
  }
});
