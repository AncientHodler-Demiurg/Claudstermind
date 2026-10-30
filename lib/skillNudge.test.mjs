// Tests for lib/skillNudge.mjs — Ch.2.2b/2.2c, the clustering/draft-injection orchestration that
// sits above lib/skillStore.mjs's storage primitives.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDb, getSkill, listSkillVersions } from "./skillStore.mjs";
import { nudgeSkill, nudgeAgent } from "./skillNudge.mjs";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skillnudge-"));
}

const PROV = { conversationId: "c1", turnKind: "prompt", turnNumber: 1, at: 1700000000000 };

// ---------------------------------------------------------------------------
// nudgeSkill — Ch.2.2b
// ---------------------------------------------------------------------------

test("nudgeSkill: a cluster below threshold produces no proposal", async () => {
  const base = tmp();
  const db = openDb(base);
  const r = await nudgeSkill(db, { clusterKey: "ck1", skillId: "s1", content: "draft v1", ...PROV });
  assert.equal(r.action, "below-threshold");
  assert.equal(r.count, 1);
  assert.equal(r.result, null);
  assert.equal(getSkill(db, "s1"), null, "nothing proposed yet");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("nudgeSkill: crossing the threshold produces exactly one proposal", async () => {
  const base = tmp();
  const db = openDb(base);
  await nudgeSkill(db, { clusterKey: "ck1", skillId: "s1", content: "draft v1", ...PROV }); // below threshold
  const r2 = await nudgeSkill(db, { clusterKey: "ck1", skillId: "s1", content: "draft v2", ...PROV }); // crosses (count=2)
  assert.equal(r2.action, "proposed");
  assert.equal(r2.count, 2);
  const skill = getSkill(db, "s1");
  assert.ok(skill);
  assert.equal(skill.status, "pending");
  assert.equal(skill.content, "draft v2");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("nudgeSkill: a second observation of an already-proposed cluster amends, not double-proposes", async () => {
  const base = tmp();
  const db = openDb(base);
  await nudgeSkill(db, { clusterKey: "ck1", skillId: "s1", content: "v1", ...PROV });
  await nudgeSkill(db, { clusterKey: "ck1", skillId: "s1", content: "v2", ...PROV }); // proposes
  const r3 = await nudgeSkill(db, { clusterKey: "ck1", skillId: "s1", content: "v3", ...PROV }); // must amend
  assert.equal(r3.action, "amended");
  const skill = getSkill(db, "s1");
  assert.equal(skill.content, "v3");
  assert.equal(skill.currentVersion, 2);
  assert.equal(listSkillVersions(db, "s1").length, 2, "never a second skills row — same skillId, one more version");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("nudgeSkill: never proposes the same skillId twice even across many below-and-above calls", async () => {
  const base = tmp();
  const db = openDb(base);
  for (let i = 0; i < 5; i++) {
    await nudgeSkill(db, { clusterKey: "ck1", skillId: "s1", content: `v${i}`, ...PROV });
  }
  const proposedActions = [];
  const base2 = tmp();
  const db2 = openDb(base2);
  for (let i = 0; i < 5; i++) {
    const r = await nudgeSkill(db2, { clusterKey: "ck1", skillId: "s1", content: `v${i}`, ...PROV });
    proposedActions.push(r.action);
  }
  assert.equal(proposedActions.filter((a) => a === "proposed").length, 1, "exactly one propose across the whole run");
  db.close();
  db2.close();
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(base2, { recursive: true, force: true });
});

test("nudgeSkill: the draft callback is called only when actually proposing or amending, never below threshold", async () => {
  const base = tmp();
  const db = openDb(base);
  const calls = [];
  const draft = async (ctx) => { calls.push(ctx.action); return `drafted for ${ctx.action}`; };

  await nudgeSkill(db, { clusterKey: "ck1", skillId: "s1", ...PROV }, draft); // below threshold, no content given
  assert.deepEqual(calls, [], "draft must not be called below threshold");

  await nudgeSkill(db, { clusterKey: "ck1", skillId: "s1", ...PROV }, draft); // crosses threshold
  assert.deepEqual(calls, ["propose"]);

  await nudgeSkill(db, { clusterKey: "ck1", skillId: "s1", ...PROV }, draft); // already proposed -> amend
  assert.deepEqual(calls, ["propose", "amend"]);

  const skill = getSkill(db, "s1");
  assert.equal(skill.content, "drafted for amend");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("nudgeSkill: explicit opts.content is used verbatim and the draft callback is never invoked", async () => {
  const base = tmp();
  const db = openDb(base);
  let called = false;
  const draft = async () => { called = true; return "should never be used"; };
  await nudgeSkill(db, { clusterKey: "ck1", skillId: "s1", content: "v1", ...PROV }, draft);
  await nudgeSkill(db, { clusterKey: "ck1", skillId: "s1", content: "v2", ...PROV }, draft);
  assert.equal(called, false);
  assert.equal(getSkill(db, "s1").content, "v2");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("nudgeSkill: a draft that rejects or returns nothing degrades to 'no-content', never throws", async () => {
  const base = tmp();
  const db = openDb(base);
  await nudgeSkill(db, { clusterKey: "ck1", skillId: "s1", ...PROV }); // below threshold, count=1
  const rejecting = await nudgeSkill(db, { clusterKey: "ck1", skillId: "s1", ...PROV }, async () => { throw new Error("subagent died"); });
  assert.equal(rejecting.action, "no-content");
  assert.equal(getSkill(db, "s1"), null);

  const emptyDraft = await nudgeSkill(db, { clusterKey: "ck1", skillId: "s1", ...PROV }, async () => "   ");
  assert.equal(emptyDraft.action, "no-content");

  const noDraftAtAll = await nudgeSkill(db, { clusterKey: "ck1", skillId: "s1", ...PROV });
  assert.equal(noDraftAtAll.action, "no-content");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("nudgeSkill: counts observations independently per clusterKey", async () => {
  const base = tmp();
  const db = openDb(base);
  await nudgeSkill(db, { clusterKey: "ck1", skillId: "s1", content: "v1", ...PROV });
  const other = await nudgeSkill(db, { clusterKey: "ck2", skillId: "s2", content: "v1", ...PROV });
  assert.equal(other.action, "below-threshold");
  assert.equal(other.count, 1, "a different clusterKey starts its own count, unaffected by ck1");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("nudgeSkill: invalid input (missing db/clusterKey/skillId) returns 'invalid' and records nothing", async () => {
  const base = tmp();
  const db = openDb(base);
  assert.equal((await nudgeSkill(null, { clusterKey: "ck1", skillId: "s1", ...PROV })).action, "invalid");
  assert.equal((await nudgeSkill(db, { skillId: "s1", ...PROV })).action, "invalid");
  assert.equal((await nudgeSkill(db, { clusterKey: "ck1", ...PROV })).action, "invalid");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// nudgeAgent — Ch.2.2c
// ---------------------------------------------------------------------------

test("nudgeAgent: below AGENT_INSTINCT_MIN_COUNT produces no proposal even at high confidence", async () => {
  const base = tmp();
  const db = openDb(base);
  await nudgeAgent(db, { clusterKey: "ck1", agentId: "a1", confidence: 0.9, content: "v1", ...PROV });
  const r2 = await nudgeAgent(db, { clusterKey: "ck1", agentId: "a1", confidence: 0.9, content: "v1", ...PROV });
  assert.equal(r2.action, "below-threshold");
  assert.equal(r2.count, 2);
  assert.equal(getSkill(db, "a1"), null);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("nudgeAgent: at count but below average confidence still produces no proposal", async () => {
  const base = tmp();
  const db = openDb(base);
  await nudgeAgent(db, { clusterKey: "ck1", agentId: "a1", confidence: 0.9, content: "v1", ...PROV });
  await nudgeAgent(db, { clusterKey: "ck1", agentId: "a1", confidence: 0.9, content: "v1", ...PROV });
  const r3 = await nudgeAgent(db, { clusterKey: "ck1", agentId: "a1", confidence: 0.2, content: "v1", ...PROV }); // count=3, avg=0.667
  assert.equal(r3.action, "below-threshold");
  assert.ok(r3.avgConfidence < 0.75);
  assert.equal(getSkill(db, "a1"), null);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("nudgeAgent: crossing BOTH count and avg-confidence thresholds proposes exactly once, as kind 'agent'", async () => {
  const base = tmp();
  const db = openDb(base);
  await nudgeAgent(db, { clusterKey: "ck1", agentId: "a1", confidence: 0.8, content: "v1", ...PROV });
  await nudgeAgent(db, { clusterKey: "ck1", agentId: "a1", confidence: 0.8, content: "v1", ...PROV });
  const r3 = await nudgeAgent(db, { clusterKey: "ck1", agentId: "a1", confidence: 0.8, content: "v1", ...PROV });
  assert.equal(r3.action, "proposed");
  assert.equal(r3.count, 3);
  assert.ok(Math.abs(r3.avgConfidence - 0.8) < 1e-9);
  const agent = getSkill(db, "a1");
  assert.ok(agent);
  assert.equal(agent.kind, "agent");

  const r4 = await nudgeAgent(db, { clusterKey: "ck1", agentId: "a1", confidence: 0.8, content: "v2", ...PROV });
  assert.equal(r4.action, "amended", "never proposes the same agentId twice");
  assert.equal(getSkill(db, "a1").content, "v2");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("nudgeAgent: the draft callback fires only on propose/amend, carrying count and avgConfidence", async () => {
  const base = tmp();
  const db = openDb(base);
  const calls = [];
  const draft = async (ctx) => { calls.push({ action: ctx.action, count: ctx.count, avg: ctx.avgConfidence }); return "drafted"; };
  await nudgeAgent(db, { clusterKey: "ck1", agentId: "a1", confidence: 0.9, ...PROV }, draft);
  await nudgeAgent(db, { clusterKey: "ck1", agentId: "a1", confidence: 0.9, ...PROV }, draft);
  assert.deepEqual(calls, [], "not yet at count 3");
  await nudgeAgent(db, { clusterKey: "ck1", agentId: "a1", confidence: 0.9, ...PROV }, draft);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "propose");
  assert.equal(calls[0].count, 3);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("nudgeAgent: invalid confidence is rejected by the store and surfaces as 'invalid'", async () => {
  const base = tmp();
  const db = openDb(base);
  const r = await nudgeAgent(db, { clusterKey: "ck1", agentId: "a1", confidence: 5, content: "v1", ...PROV });
  assert.equal(r.action, "invalid");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});
