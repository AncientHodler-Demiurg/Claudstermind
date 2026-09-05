// node --test lib/agentsPanel.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_MAX_ELAPSED_MS,
  AGENT_STALE_AFTER_MS,
  AGENT_STALE_NOTE,
  AGENT_STATES,
  agentElapsedLabel,
  agentState,
  agentsPanelSummary,
  shapeAgentsPanel,
  trackAgentActivity,
} from "./agentsPanel.mjs";
import { reduceBackground, shapeBackground } from "./backgroundTasks.mjs";

const NOW = 1_784_801_237_739;

// ---------------------------------------------------------------- shape acceptance

test("accepts the panel model produced by backgroundTasks.shapeBackground", () => {
  let s = reduceBackground({ tasks: {} }, { kind: "taskStarted", id: "a", taskType: "agent", subagentType: "Explore", description: "audit the roll path", startedAt: NOW - 91_000 });
  s = reduceBackground(s, { kind: "taskStarted", id: "b", taskType: "local_workflow", description: "phase 2", startedAt: NOW - 40_000 });
  s = reduceBackground(s, { kind: "taskDone", id: "b", status: "completed", tokens: 4200 });

  const panel = shapeBackground(s, NOW);
  const vm = shapeAgentsPanel(panel, NOW);

  assert.equal(vm.hasData, true);
  assert.equal(vm.count, 2);
  assert.equal(vm.running, 1);
  assert.equal(vm.done, 1);
  assert.equal(vm.totalTokens, 4200);
  assert.equal(vm.mismatch, false, "recomputed totals must agree with the server's own");
  assert.deepEqual(vm.agents.map((a) => a.id), ["a", "b"], "server order preserved (running first)");
  assert.equal(vm.agents[0].label, "Explore");
  // NOTE: the wire panel collapses taskType/subagentType into `label` and drops `startedAt`
  // (CONTRACT.md §2a). So the view model can only report what it was given — it must not
  // reconstruct a subagentType it cannot actually know.
  assert.equal(vm.agents[0].subagentType, null);
  assert.equal(vm.agents[0].type, null);
  assert.equal(vm.agents[1].label, "local_workflow");
  assert.equal(vm.agents[0].elapsedLabel, "1m 31s");
});

test("accepts an event ({panel}), a sessionSummary ({backgroundPanel}), and a bare array", () => {
  const panel = { count: 1, running: 1, done: 0, totalTokens: 0, agents: [{ id: "t1", label: "Explore", description: "d", elapsedMs: 1000, tokens: 0, status: "running" }] };
  assert.equal(shapeAgentsPanel({ kind: "taskStarted", id: "t1", panel }, NOW).count, 1);
  assert.equal(shapeAgentsPanel({ sessionKey: "Repo@main", backgroundPanel: panel }, NOW).count, 1);
  assert.equal(shapeAgentsPanel(panel.agents, NOW).count, 1);
});

test("falls back to the raw `background`/`tasks` array; missing status is flagged as an assumption", () => {
  const vm = shapeAgentsPanel({ sessionKey: "Repo@main", backgroundCount: 1, background: [{ id: "t1", taskType: "agent", description: "x" }], backgroundPanel: null }, NOW);
  assert.equal(vm.count, 1);
  assert.equal(vm.agents[0].state, "running");
  assert.equal(vm.agents[0].statusKnown, false, "we assumed running from the live set; say so");

  const ev = shapeAgentsPanel({ kind: "background", tasks: [{ id: "t1", taskType: "agent", description: "x" }] }, NOW);
  assert.equal(ev.count, 1);
});

test("null / undefined / a stub session's null backgroundPanel = NO DATA, not zero agents", () => {
  for (const p of [null, undefined, 42, "nope", { sessionKey: "Repo@main", backgroundPanel: null }]) {
    const vm = shapeAgentsPanel(p, NOW);
    assert.equal(vm.hasData, false, `hasData for ${JSON.stringify(p)}`);
    assert.equal(vm.count, 0);
    assert.deepEqual(vm.agents, []);
    assert.equal(vm.summary, "background agents: no data");
  }
  // vs. a real, genuinely empty fleet
  const empty = shapeAgentsPanel({ count: 0, running: 0, done: 0, totalTokens: 0, agents: [] }, NOW);
  assert.equal(empty.hasData, true);
  assert.equal(empty.summary, "no background agents");
});

// ---------------------------------------------------------------- elapsed honesty

test("no startedAt and elapsedMs 0 renders 'unknown', never a fake 0s", () => {
  // exactly the "first seen via background_tasks_changed" case: shapeBackground emits elapsedMs 0
  const s = reduceBackground({ tasks: {} }, { kind: "background", tasks: [{ id: "a", taskType: "agent", description: "d" }] });
  const panel = shapeBackground(s, NOW);
  assert.equal(panel.agents[0].elapsedMs, 0, "precondition: the server really does send 0 here");

  const vm = shapeAgentsPanel(panel, NOW);
  assert.equal(vm.agents[0].elapsedKnown, false);
  assert.equal(vm.agents[0].elapsedMs, null);
  assert.equal(vm.agents[0].elapsedLabel, "unknown");
  assert.equal(vm.agents[0].clockSkew, false);
});

test("a startedAt riding on the task is used against the client clock", () => {
  const s = reduceBackground({ tasks: {} }, { kind: "background", tasks: [{ id: "a", taskType: "agent", startedAt: NOW - 65_000 }] });
  const vm = shapeAgentsPanel(shapeBackground(s, NOW), NOW);
  assert.equal(vm.agents[0].elapsedKnown, true);
  assert.equal(vm.agents[0].elapsedLabel, "1m 05s");
});

test("clock skew: a startedAt in the future is 'unknown' + clockSkew, never negative and never clamped to 0", () => {
  const vm = shapeAgentsPanel([{ id: "a", status: "running", startedAt: NOW + 90_000 }], NOW);
  assert.equal(vm.agents[0].elapsedMs, null);
  assert.equal(vm.agents[0].elapsedKnown, false);
  assert.equal(vm.agents[0].clockSkew, true);
  assert.equal(vm.agents[0].elapsedLabel, "unknown");
});

test("absurd elapsed (bad epoch / seconds-vs-ms) is rejected as skew", () => {
  const fromStartedAt = shapeAgentsPanel([{ id: "a", status: "running", startedAt: 1 }], NOW);
  assert.equal(fromStartedAt.agents[0].clockSkew, true);
  assert.equal(fromStartedAt.agents[0].elapsedMs, null);

  const fromSnapshot = shapeAgentsPanel([{ id: "b", status: "running", elapsedMs: AGENT_MAX_ELAPSED_MS + 1 }], NOW);
  assert.equal(fromSnapshot.agents[0].clockSkew, true);

  const negativeSnapshot = shapeAgentsPanel([{ id: "c", status: "running", elapsedMs: -5 }], NOW);
  assert.equal(negativeSnapshot.agents[0].clockSkew, true);
  assert.equal(negativeSnapshot.agents[0].elapsedLabel, "unknown");
});

test("without a client clock the server's elapsedMs snapshot is used verbatim", () => {
  const vm = shapeAgentsPanel([{ id: "a", status: "running", startedAt: NOW - 1000, elapsedMs: 91_000 }], undefined);
  assert.equal(vm.agents[0].elapsedMs, 91_000);
  assert.equal(vm.agents[0].elapsedKnown, true);
});

test("agentElapsedLabel formats and refuses junk", () => {
  assert.equal(agentElapsedLabel(0), "0s");
  assert.equal(agentElapsedLabel(999), "0s");
  assert.equal(agentElapsedLabel(45_000), "45s");
  assert.equal(agentElapsedLabel(60_000), "1m 00s");
  assert.equal(agentElapsedLabel(187_000), "3m 07s");
  assert.equal(agentElapsedLabel(3_600_000), "1h 00m");
  assert.equal(agentElapsedLabel(7_500_000), "2h 05m");
  assert.equal(agentElapsedLabel(null), "unknown");
  assert.equal(agentElapsedLabel(-1), "unknown");
  assert.equal(agentElapsedLabel(NaN), "unknown");
  assert.equal(agentElapsedLabel("120000"), "unknown");
});

// ---------------------------------------------------------------- staleness heuristic

test("tracking keeps lastChangeAt across unchanged ticks and flags stale past the threshold", () => {
  const agents = [{ id: "a", label: "Explore", status: "running", startedAt: NOW - 1000, tokens: 0 }];
  let tr = trackAgentActivity(null, agents, NOW);
  assert.equal(tr.seen.a.lastChangeAt, NOW);

  // nothing about the agent changed on the next event
  tr = trackAgentActivity(tr, agents, NOW + 60_000);
  assert.equal(tr.seen.a.lastChangeAt, NOW, "lastChangeAt must NOT advance on an unchanged tick");

  const fresh = shapeAgentsPanel(agents, NOW + 60_000, { tracking: tr });
  assert.equal(fresh.agents[0].stale, false);
  assert.equal(fresh.anyStale, false);

  const late = NOW + AGENT_STALE_AFTER_MS + 1;
  const stalled = shapeAgentsPanel(agents, late, { tracking: trackAgentActivity(tr, agents, late) });
  assert.equal(stalled.agents[0].stale, true);
  assert.equal(stalled.agents[0].staleReason, "idle-since-last-change");
  assert.equal(stalled.agents[0].staleNote, AGENT_STALE_NOTE);
  assert.equal(stalled.staleCount, 1);
  assert.equal(stalled.anyStale, true);
  assert.equal(stalled.heuristic, true, "the panel must advertise that this is a guess");
  assert.equal(stalled.staleAfterMs, AGENT_STALE_AFTER_MS);
  assert.match(stalled.summary, /1 possibly stalled/);
});

test("a token or status change resets the stale clock", () => {
  const before = [{ id: "a", status: "running", startedAt: NOW, tokens: 0 }];
  let tr = trackAgentActivity(null, before, NOW);
  const later = NOW + AGENT_STALE_AFTER_MS + 1;
  const after = [{ id: "a", status: "running", startedAt: NOW, tokens: 500 }];
  tr = trackAgentActivity(tr, after, later);
  assert.equal(tr.seen.a.lastChangeAt, later);
  assert.equal(shapeAgentsPanel(after, later, { tracking: tr }).agents[0].stale, false);
});

test("an enriching description change also counts as evidence of life", () => {
  let tr = trackAgentActivity(null, [{ id: "a", status: "running", tokens: 0 }], NOW);
  tr = trackAgentActivity(tr, [{ id: "a", status: "running", tokens: 0, description: "now known" }], NOW + 10);
  assert.equal(tr.seen.a.lastChangeAt, NOW + 10);
});

test("only RUNNING agents can be stale — a finished agent is not 'stalled'", () => {
  const agents = [{ id: "a", status: "done", startedAt: NOW - AGENT_STALE_AFTER_MS * 3, tokens: 0 }];
  const tr = trackAgentActivity(null, agents, NOW - AGENT_STALE_AFTER_MS * 2);
  const vm = shapeAgentsPanel(agents, NOW, { tracking: tr });
  assert.equal(vm.agents[0].stale, false);
  assert.equal(vm.staleCount, 0);
});

test("no tracking + never reported a token: staleness falls back to lifetime, labelled differently", () => {
  const agents = [{ id: "a", status: "running", startedAt: NOW - AGENT_STALE_AFTER_MS - 1, tokens: 0 }];
  const vm = shapeAgentsPanel(agents, NOW);
  assert.equal(vm.agents[0].stale, true);
  assert.equal(vm.agents[0].staleReason, "no-activity-observed");

  // ...but with tokens reported and no tracking we know nothing about WHEN → no claim at all
  const withTokens = shapeAgentsPanel([{ id: "a", status: "running", startedAt: NOW - AGENT_STALE_AFTER_MS - 1, tokens: 900 }], NOW);
  assert.equal(withTokens.agents[0].sinceChangeMs, null);
  assert.equal(withTokens.agents[0].stale, false);
});

test("unknown elapsed cannot produce a stale claim (no evidence either way)", () => {
  const vm = shapeAgentsPanel([{ id: "a", status: "running", tokens: 0 }], NOW);
  assert.equal(vm.agents[0].elapsedKnown, false);
  assert.equal(vm.agents[0].sinceChangeMs, null);
  assert.equal(vm.agents[0].stale, false);
});

test("the stale threshold is overridable per call", () => {
  const agents = [{ id: "a", status: "running", startedAt: NOW - 2000, tokens: 0 }];
  assert.equal(shapeAgentsPanel(agents, NOW, { staleAfterMs: 1000 }).agents[0].stale, true);
  assert.equal(shapeAgentsPanel(agents, NOW, { staleAfterMs: 0 }).staleAfterMs, AGENT_STALE_AFTER_MS, "a bogus override falls back to the default");
});

test("trackAgentActivity is defensive: bad now / no agent data returns prev untouched", () => {
  const tr = trackAgentActivity(null, [{ id: "a", status: "running" }], NOW);
  assert.equal(trackAgentActivity(tr, [{ id: "a", status: "running" }], NaN), tr);
  assert.equal(trackAgentActivity(tr, null, NOW), tr, "a reconnect blip must not reset every agent's clock");
  assert.equal(trackAgentActivity(tr, { sessionKey: "x" }, NOW), tr);
  // agents that leave the live set are dropped
  const dropped = trackAgentActivity(tr, [], NOW + 1);
  assert.deepEqual(Object.keys(dropped.seen), []);
});

// ---------------------------------------------------------------- ordering / forward compat

test("ordering is the server's and does not move as tokens tick", () => {
  const t0 = [
    { id: "a", status: "running", tokens: 0, startedAt: NOW - 3000 },
    { id: "b", status: "running", tokens: 0, startedAt: NOW - 2000 },
    { id: "c", status: "done", tokens: 999_999, startedAt: NOW - 9000 },
  ];
  const t1 = [
    { id: "a", status: "running", tokens: 500_000, startedAt: NOW - 3000 },
    { id: "b", status: "running", tokens: 1, startedAt: NOW - 2000 },
    { id: "c", status: "done", tokens: 999_999, startedAt: NOW - 9000 },
  ];
  const ids = (p) => shapeAgentsPanel(p, NOW).agents.map((a) => a.id);
  assert.deepEqual(ids(t0), ["a", "b", "c"]);
  assert.deepEqual(ids(t1), ["a", "b", "c"]);
});

test("an unknown future status maps to 'unknown', is preserved verbatim, and is never called running", () => {
  const vm = shapeAgentsPanel([{ id: "a", status: "paused-for-permission", tokens: 0, startedAt: NOW - 1000 }], NOW);
  assert.equal(vm.agents[0].state, "unknown");
  assert.equal(vm.agents[0].status, "paused-for-permission");
  assert.equal(vm.agents[0].statusKnown, true);
  assert.equal(vm.running, 0);
  assert.equal(vm.unknown, 1);
  assert.equal(vm.agents[0].stale, false, "we cannot claim a status we do not understand is stalled");
  assert.match(vm.summary, /1 unknown/);
  assert.deepEqual(AGENT_STATES, ["running", "done", "error", "unknown"]);
});

test("agentState maps the vocabulary and its plausible synonyms", () => {
  assert.equal(agentState("running"), "running");
  assert.equal(agentState("done"), "done");
  assert.equal(agentState("completed"), "done");
  assert.equal(agentState("error"), "error");
  assert.equal(agentState("failed"), "error");
  assert.equal(agentState("REMOVED"), "unknown");
  assert.equal(agentState(undefined), "unknown");
  assert.equal(agentState(7), "unknown");
});

test("junk rows are skipped, missing ids are synthesized, duplicate ids do not double-count", () => {
  const vm = shapeAgentsPanel([
    null,
    "nope",
    { status: "running", tokens: 10 },
    { id: "a", status: "done", tokens: 100 },
    { id: "a", status: "done", tokens: 100 },
  ], NOW);
  assert.equal(vm.count, 2);
  assert.deepEqual(vm.agents.map((a) => a.id), ["#2", "a"]);
  assert.equal(vm.totalTokens, 110, "the duplicate id must not be counted twice");
});

test("negative / non-numeric tokens never poison the fleet total", () => {
  const vm = shapeAgentsPanel([
    { id: "a", status: "running", tokens: -5 },
    { id: "b", status: "running", tokens: "1200" },
    { id: "c", status: "running", tokens: NaN },
    { id: "d", status: "running", tokens: 10.7 },
  ], NOW);
  assert.equal(vm.totalTokens, 1210);
});

test("a server total that disagrees with the rows is surfaced, not silently trusted", () => {
  const vm = shapeAgentsPanel({ count: 9, running: 9, done: 0, totalTokens: 1, agents: [{ id: "a", status: "running", tokens: 0 }] }, NOW);
  assert.equal(vm.count, 1, "the rows are the truth for what we can render");
  assert.equal(vm.mismatch, true);
  assert.deepEqual(vm.reported, { count: 9, running: 9, done: 0, totalTokens: 1 });
});

test("row title + summary wording", () => {
  const vm = shapeAgentsPanel([
    { id: "a", label: "Explore", description: "audit the roll path", status: "running", startedAt: NOW - 1000 },
    { id: "b", taskType: "agent", status: "error", startedAt: NOW - 1000 },
  ], NOW);
  assert.equal(vm.agents[0].title, "Explore — audit the roll path");
  assert.equal(vm.agents[1].title, "agent", "no description → just the label, never a dangling dash");
  assert.equal(vm.summary, "2 agents · 1 running, 1 error");
  assert.equal(agentsPanelSummary(null), "background agents: no data");
  assert.equal(agentsPanelSummary({ hasData: true, count: 1, running: 1 }), "1 agent · 1 running");
});

test("end-to-end: a fleet that goes silent becomes visibly suspect instead of looking healthy", () => {
  // reduce a real event stream, shape it server-side, then run the client helper over the wire shape
  let s = reduceBackground({ tasks: {} }, { kind: "background", tasks: [{ id: "a", taskType: "agent", description: "long job", startedAt: NOW }] });
  let tr = trackAgentActivity(null, shapeBackground(s, NOW), NOW);

  const later = NOW + AGENT_STALE_AFTER_MS + 60_000;
  const panel = shapeBackground(s, later);          // still running, nothing new emitted
  tr = trackAgentActivity(tr, panel, later);
  const vm = shapeAgentsPanel(panel, later, { tracking: tr });

  assert.equal(vm.running, 1);
  assert.equal(vm.agents[0].stale, true);
  assert.equal(vm.agents[0].elapsedLabel, "6m 00s");
  assert.equal(vm.anyStale, true);
});
