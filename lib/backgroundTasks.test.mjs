import test from "node:test";
import assert from "node:assert/strict";
import { reduceBackground, shapeBackground, k } from "./backgroundTasks.mjs";

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

test("elapsedMs is 0 without startedAt or now", () => {
  const s = reduceBackground({ tasks: {} }, { kind: "background", tasks: [{ id: "a", taskType: "t" }] });
  assert.equal(shapeBackground(s, 5000).agents[0].elapsedMs, 0); // no startedAt
  const s2 = reduceBackground({ tasks: {} }, { kind: "taskStarted", id: "a", startedAt: 100 });
  assert.equal(shapeBackground(s2, 0).agents[0].elapsedMs, 0); // no now
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
