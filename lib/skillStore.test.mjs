// Tests for lib/skillStore.mjs — Ch.2.2 skill crystallisation storage: PROPOSE-ONLY (D6), with a
// real approve/reject verb and an append-only audit ledger with rollback.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  openDb,
  proposeSkill,
  getSkill,
  listSkills,
  listSkillVersions,
  amendSkill,
  rollbackSkill,
  approveSkill,
  rejectSkill,
  SKILL_CLUSTER_THRESHOLD,
  SKILL_DECAY_WINDOW,
  SKILL_DECAY_MIN_RUNS,
  SKILL_DECAY_SUCCESS_THRESHOLD,
  computeDecayStatus,
  recordSkillRun,
  listSkillRuns,
  AGENT_INSTINCT_MIN_COUNT,
  AGENT_INSTINCT_MIN_AVG_CONFIDENCE,
  recordObservation,
  countObservations,
  listObservations,
  recordInstinct,
  instinctStats,
  listInstincts,
} from "./skillStore.mjs";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skillstore-"));
}

const PROV = { conversationId: "c1", turnKind: "prompt", turnNumber: 1, at: 1700000000000 };

test("openDb creates skills.sqlite3", () => {
  const base = tmp();
  const db = openDb(base);
  assert.ok(db);
  assert.ok(fs.existsSync(path.join(base, "skills.sqlite3")));
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("openDb(null-ish) never throws", () => {
  assert.equal(openDb(null), null);
  assert.equal(openDb(undefined), null);
});

test("openDb on a CORRUPT skills.sqlite3 returns null and PRESERVES the file — the crystallisation audit ledger has nothing to rebuild from either", () => {
  const base = tmp();
  fs.mkdirSync(base, { recursive: true });
  const dbPath = path.join(base, "skills.sqlite3");
  fs.writeFileSync(dbPath, "not a real sqlite file — imagine this were a real approved skill's history");
  assert.equal(openDb(base), null);
  assert.ok(fs.existsSync(dbPath), "the corrupt file itself must survive for manual recovery");
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// proposeSkill — the D6 gate, and PROPOSE-ONLY (never auto-adopts)
// ---------------------------------------------------------------------------

test("SKILL_CLUSTER_THRESHOLD is D6's starting number: 2", () => {
  assert.equal(SKILL_CLUSTER_THRESHOLD, 2);
});

test("a proposal below the cluster threshold is never created", () => {
  const base = tmp();
  const db = openDb(base);
  assert.equal(proposeSkill(db, { skillId: "s1", content: "do the thing", observationCount: 1, ...PROV }), null);
  assert.equal(proposeSkill(db, { skillId: "s1", content: "do the thing", observationCount: 0, ...PROV }), null);
  assert.equal(getSkill(db, "s1"), null, "no row exists — rejection means nothing was created, not a pending stub");
  assert.deepEqual(listSkills(db), []);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("a proposal AT the threshold lands in `pending`, never auto-approved", () => {
  const base = tmp();
  const db = openDb(base);
  const s = proposeSkill(db, { skillId: "s1", content: "run tests before committing", observationCount: SKILL_CLUSTER_THRESHOLD, ...PROV });
  assert.ok(s);
  assert.equal(s.status, "pending");
  assert.equal(s.currentVersion, 1);
  assert.equal(s.content, "run tests before committing");
  assert.ok(s.contentHash && s.contentHash.length === 64, "sha256 hex digest");
  assert.equal(s.decidedAt, null);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("proposeSkill rejects missing skillId/content/provenance, and a duplicate skillId", () => {
  const base = tmp();
  const db = openDb(base);
  assert.equal(proposeSkill(db, { content: "x", observationCount: 5, ...PROV }), null, "no skillId");
  assert.equal(proposeSkill(db, { skillId: "s1", observationCount: 5, ...PROV }), null, "no content");
  assert.equal(proposeSkill(db, { skillId: "s1", content: "x", observationCount: 5 }), null, "no provenance");

  const first = proposeSkill(db, { skillId: "dup", content: "first", observationCount: 5, ...PROV });
  assert.ok(first);
  const second = proposeSkill(db, { skillId: "dup", content: "second attempt", observationCount: 5, ...PROV });
  assert.equal(second, null, "an existing skillId must be amended, not re-proposed");
  assert.equal(getSkill(db, "dup").content, "first", "the original proposal is untouched by the rejected duplicate");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("listSkills filters by status and respects limit, newest first", () => {
  const base = tmp();
  const db = openDb(base);
  proposeSkill(db, { skillId: "a", content: "x", observationCount: 5, ...PROV });
  proposeSkill(db, { skillId: "b", content: "y", observationCount: 5, ...PROV });
  approveSkill(db, "a", { reason: "looks solid" });

  assert.equal(listSkills(db).length, 2);
  assert.equal(listSkills(db, { status: "pending" }).length, 1);
  assert.equal(listSkills(db, { status: "pending" })[0].skillId, "b");
  assert.equal(listSkills(db, { status: "approved" })[0].skillId, "a");
  assert.deepEqual(listSkills(db, { status: "bogus-status" }), []);
  assert.equal(listSkills(db, { limit: 1 }).length, 1);
  assert.deepEqual(listSkills(null), []);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// approve / reject — the verb ECC omitted
// ---------------------------------------------------------------------------

test("approveSkill transitions pending -> approved, stamps decidedAt + promotedAt on the current version", () => {
  const base = tmp();
  const db = openDb(base);
  proposeSkill(db, { skillId: "s1", content: "x", observationCount: 5, ...PROV });
  const approved = approveSkill(db, "s1", { reason: "matches an existing convention" });
  assert.ok(approved);
  assert.equal(approved.status, "approved");
  assert.ok(Number.isFinite(approved.decidedAt));
  assert.equal(approved.decisionReason, "matches an existing convention");

  const versions = listSkillVersions(db, "s1");
  assert.equal(versions.length, 1);
  assert.ok(Number.isFinite(versions[0].promotedAt), "the audit ledger records WHEN this version was promoted");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("rejectSkill REQUIRES a reason and transitions pending -> rejected, never promotes a version", () => {
  const base = tmp();
  const db = openDb(base);
  proposeSkill(db, { skillId: "s1", content: "x", observationCount: 5, ...PROV });

  assert.equal(rejectSkill(db, "s1", {}), null, "no reason — reject must record why");
  assert.equal(rejectSkill(db, "s1", { reason: "   " }), null, "whitespace-only reason still rejected as absent");
  assert.equal(getSkill(db, "s1").status, "pending", "a failed reject attempt must not have changed anything");

  const rejected = rejectSkill(db, "s1", { reason: "duplicates an existing skill" });
  assert.ok(rejected);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.decisionReason, "duplicates an existing skill");
  assert.equal(listSkillVersions(db, "s1")[0].promotedAt, null, "rejecting never stamps promotedAt");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("approve/reject only apply FROM pending — an already-decided skill cannot be silently re-decided", () => {
  const base = tmp();
  const db = openDb(base);
  proposeSkill(db, { skillId: "s1", content: "x", observationCount: 5, ...PROV });
  approveSkill(db, "s1", { reason: "ok" });

  assert.equal(approveSkill(db, "s1", { reason: "again" }), null, "already approved — cannot re-approve");
  assert.equal(rejectSkill(db, "s1", { reason: "changed my mind" }), null, "already approved — cannot reject after the fact");
  assert.equal(getSkill(db, "s1").decisionReason, "ok", "the original decision is untouched");

  assert.equal(approveSkill(db, "nonexistent", {}), null);
  assert.equal(rejectSkill(db, "nonexistent", { reason: "x" }), null);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// amend + rollback — the append-only ledger
// ---------------------------------------------------------------------------

test("amendSkill appends a new version, advances currentVersion, never mutates the old row", () => {
  const base = tmp();
  const db = openDb(base);
  proposeSkill(db, { skillId: "s1", content: "v1 content", observationCount: 5, ...PROV });
  const v2 = amendSkill(db, "s1", { content: "v2 content", amendmentReason: "background review tightened the wording" });
  assert.ok(v2);
  assert.equal(v2.version, 2);
  assert.equal(v2.amendmentReason, "background review tightened the wording");

  const skill = getSkill(db, "s1");
  assert.equal(skill.currentVersion, 2);
  assert.equal(skill.content, "v2 content");

  const versions = listSkillVersions(db, "s1");
  assert.equal(versions.length, 2);
  assert.equal(versions[0].version, 1);
  assert.equal(versions[0].content, "v1 content", "the old version is untouched, not overwritten");
  assert.equal(versions[1].version, 2);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("amendSkill rejects a rejected skill, a nonexistent skill, and empty content", () => {
  const base = tmp();
  const db = openDb(base);
  proposeSkill(db, { skillId: "s1", content: "v1", observationCount: 5, ...PROV });
  rejectSkill(db, "s1", { reason: "no" });

  assert.equal(amendSkill(db, "s1", { content: "v2" }), null, "a rejected skill is not amended — propose fresh instead");
  assert.equal(amendSkill(db, "nonexistent", { content: "v2" }), null);
  assert.equal(amendSkill(db, "s1", { content: "   " }), null);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("rollbackSkill restores the previous content_hash by appending a fresh version, without deleting history", () => {
  const base = tmp();
  const db = openDb(base);
  const v1 = proposeSkill(db, { skillId: "s1", content: "original wording", observationCount: 5, ...PROV });
  amendSkill(db, "s1", { content: "a worse rewrite", amendmentReason: "bad amendment" });

  const rolledBack = rollbackSkill(db, "s1", { toVersion: 1 });
  assert.ok(rolledBack);
  assert.equal(rolledBack.version, 3, "rollback APPENDS, it does not rewrite version 1 or delete version 2");
  assert.equal(rolledBack.content, "original wording");
  assert.equal(rolledBack.contentHash, v1.contentHash, "the previous content_hash is restored");
  assert.equal(rolledBack.amendmentReason, "rollback to v1");

  const skill = getSkill(db, "s1");
  assert.equal(skill.currentVersion, 3);
  assert.equal(skill.contentHash, v1.contentHash);

  const versions = listSkillVersions(db, "s1");
  assert.equal(versions.length, 3, "all three versions remain in the ledger");
  assert.equal(versions[1].version, 2);
  assert.equal(versions[1].content, "a worse rewrite", "the rolled-back-FROM version's content is untouched");
  assert.ok(Number.isFinite(versions[1].rolledBackAt), "the ledger records WHEN version 2 was rolled back");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("rollbackSkill rejects a nonexistent skill or a nonexistent target version", () => {
  const base = tmp();
  const db = openDb(base);
  proposeSkill(db, { skillId: "s1", content: "v1", observationCount: 5, ...PROV });
  assert.equal(rollbackSkill(db, "nonexistent", { toVersion: 1 }), null);
  assert.equal(rollbackSkill(db, "s1", { toVersion: 99 }), null);
  assert.equal(rollbackSkill(db, "s1", { toVersion: 0 }), null);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Ch.2.4 — decay: skill_runs as the measured signal, computeDecayStatus's threshold math,
// recordSkillRun's automatic (non-ratcheting) demotion/recovery.
// ---------------------------------------------------------------------------

test("decay constants: window 5, minimum 3 runs before judging, 50% success threshold", () => {
  assert.equal(SKILL_DECAY_WINDOW, 5);
  assert.equal(SKILL_DECAY_MIN_RUNS, 3);
  assert.equal(SKILL_DECAY_SUCCESS_THRESHOLD, 0.5);
});

test("computeDecayStatus never judges below the minimum run count, however bad they are", () => {
  const allFailures = [{ outcome: "failure" }, { outcome: "failure" }];
  const result = computeDecayStatus(allFailures);
  assert.equal(result.decayStatus, "fresh", "2 runs < SKILL_DECAY_MIN_RUNS (3) — not enough evidence to judge");
  assert.equal(result.successRate, null);
  assert.deepEqual(computeDecayStatus([]), { decayStatus: "fresh", successRate: null, window: 0, reason: null });
  assert.deepEqual(computeDecayStatus(null), { decayStatus: "fresh", successRate: null, window: 0, reason: null });
});

test("computeDecayStatus flags stale once at/above the minimum AND below the success threshold", () => {
  const twoOfFour = [{ outcome: "success" }, { outcome: "failure" }, { outcome: "failure" }, { outcome: "success" }];
  // Not enough (4 >= 3 minimum is fine, but need <50% to trigger) — 2/4 = 50%, NOT below threshold.
  assert.equal(computeDecayStatus(twoOfFour).decayStatus, "fresh", "exactly at the threshold is not BELOW it");

  const oneOfFour = [{ outcome: "success" }, { outcome: "failure" }, { outcome: "failure" }, { outcome: "failure" }];
  const stale = computeDecayStatus(oneOfFour);
  assert.equal(stale.decayStatus, "stale");
  assert.equal(stale.successRate, 0.25);
  assert.match(stale.reason, /25%/);
});

test("computeDecayStatus only considers the most recent SKILL_DECAY_WINDOW runs, oldest excess dropped", () => {
  // 5 failures then (in "newest first" order) 3 successes at the front — window is 5, so only the
  // first 5 entries count; the 3 successes should be enough to clear the threshold on their own
  // once combined with the 2 oldest-of-window failures.
  const runs = [
    { outcome: "success" }, { outcome: "success" }, { outcome: "success" }, // newest 3
    { outcome: "failure" }, { outcome: "failure" }, // still within the window of 5
    { outcome: "failure" }, { outcome: "failure" }, { outcome: "failure" }, // beyond the window — ignored
  ];
  const result = computeDecayStatus(runs);
  assert.equal(result.window, 5);
  assert.equal(result.successRate, 0.6, "3 of the considered 5, the 3 excess failures beyond the window must not count");
  assert.equal(result.decayStatus, "fresh");
});

test("recordSkillRun rejects an invalid outcome or a nonexistent skill", () => {
  const base = tmp();
  const db = openDb(base);
  proposeSkill(db, { skillId: "s1", content: "v1", observationCount: 5, ...PROV });
  assert.equal(recordSkillRun(db, "s1", { outcome: "bogus" }), null);
  assert.equal(recordSkillRun(db, "s1", {}), null, "no outcome at all");
  assert.equal(recordSkillRun(db, "nonexistent", { outcome: "success" }), null);
  assert.deepEqual(listSkillRuns(db, "s1"), []);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("recordSkillRun stores the ECC-shaped ledger row and returns the decay verdict alongside it", () => {
  const base = tmp();
  const db = openDb(base);
  proposeSkill(db, { skillId: "s1", content: "v1", observationCount: 5, ...PROV });

  const result = recordSkillRun(db, "s1", {
    outcome: "failure", failureReason: "timed out", tokensUsed: 1200, durationMs: 4500, userFeedback: "too slow",
  });
  assert.ok(result);
  assert.equal(result.run.outcome, "failure");
  assert.equal(result.run.failureReason, "timed out");
  assert.equal(result.run.tokensUsed, 1200);
  assert.equal(result.run.durationMs, 4500);
  assert.equal(result.run.userFeedback, "too slow");
  assert.ok(Number.isFinite(result.run.at));
  assert.equal(result.decay.decayStatus, "fresh", "one failure alone is under the minimum run count");

  assert.equal(listSkillRuns(db, "s1").length, 1);
  assert.equal(getSkill(db, "s1").decayStatus, "fresh");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("recordSkillRun demotes a skill to stale once the window crosses the success threshold, live in skills.decayStatus", () => {
  const base = tmp();
  const db = openDb(base);
  proposeSkill(db, { skillId: "s1", content: "v1", observationCount: 5, ...PROV });

  recordSkillRun(db, "s1", { outcome: "failure" });
  recordSkillRun(db, "s1", { outcome: "failure" });
  assert.equal(getSkill(db, "s1").decayStatus, "fresh", "still under the minimum run count");

  const third = recordSkillRun(db, "s1", { outcome: "failure" });
  assert.equal(third.decay.decayStatus, "stale", "3 failures, 0% success, minimum met");
  const skill = getSkill(db, "s1");
  assert.equal(skill.decayStatus, "stale");
  assert.ok(Number.isFinite(skill.staleAt));
  assert.match(skill.staleReason, /0%/);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("recordSkillRun RECOVERS a stale skill back to fresh once the window improves — not a one-way ratchet", () => {
  const base = tmp();
  const db = openDb(base);
  proposeSkill(db, { skillId: "s1", content: "v1", observationCount: 5, ...PROV });
  recordSkillRun(db, "s1", { outcome: "failure" });
  recordSkillRun(db, "s1", { outcome: "failure" });
  recordSkillRun(db, "s1", { outcome: "failure" });
  assert.equal(getSkill(db, "s1").decayStatus, "stale");

  recordSkillRun(db, "s1", { outcome: "success" });
  const fifth = recordSkillRun(db, "s1", { outcome: "success" });
  // Window of 5 most recent: success, success, failure, failure, failure = 2/5 = 40%, still stale.
  assert.equal(fifth.decay.decayStatus, "stale", "2/5 = 40% is still below the 50% threshold");

  const sixth = recordSkillRun(db, "s1", { outcome: "success" });
  // Window of 5 most recent now: success, success, success, failure, failure = 3/5 = 60% — recovered.
  assert.equal(sixth.decay.decayStatus, "fresh");
  const recovered = getSkill(db, "s1");
  assert.equal(recovered.decayStatus, "fresh");
  assert.equal(recovered.staleAt, null);
  assert.equal(recovered.staleReason, "");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("listSkillRuns returns newest first and respects limit", () => {
  const base = tmp();
  const db = openDb(base);
  proposeSkill(db, { skillId: "s1", content: "v1", observationCount: 5, ...PROV });
  recordSkillRun(db, "s1", { outcome: "success" });
  recordSkillRun(db, "s1", { outcome: "failure" });

  const runs = listSkillRuns(db, "s1");
  assert.equal(runs.length, 2);
  assert.equal(runs[0].outcome, "failure", "newest first");
  assert.equal(listSkillRuns(db, "s1", { limit: 1 }).length, 1);
  assert.deepEqual(listSkillRuns(db, "nonexistent"), []);
  assert.deepEqual(listSkillRuns(null, "s1"), []);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("listSkills excludes stale skills by default, reachable via includeStale", () => {
  const base = tmp();
  const db = openDb(base);
  proposeSkill(db, { skillId: "fresh-one", content: "v1", observationCount: 5, ...PROV });
  proposeSkill(db, { skillId: "stale-one", content: "v1", observationCount: 5, ...PROV });
  recordSkillRun(db, "stale-one", { outcome: "failure" });
  recordSkillRun(db, "stale-one", { outcome: "failure" });
  recordSkillRun(db, "stale-one", { outcome: "failure" });

  const visible = listSkills(db);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].skillId, "fresh-one");

  const all = listSkills(db, { includeStale: true });
  assert.equal(all.length, 2);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// kind — skill vs agent candidate (Ch.2.2c), same table
// ---------------------------------------------------------------------------

test("proposeSkill defaults kind to 'skill'; rejects an invalid kind", () => {
  const base = tmp();
  const db = openDb(base);
  const skill = proposeSkill(db, { skillId: "s1", content: "v1", observationCount: 5, ...PROV });
  assert.equal(skill.kind, "skill");
  assert.equal(proposeSkill(db, { skillId: "bad", kind: "wizard", content: "v1", observationCount: 5, ...PROV }), null);
  const agent = proposeSkill(db, { skillId: "a1", kind: "agent", content: "v1", observationCount: 5, ...PROV });
  assert.equal(agent.kind, "agent");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("listSkills filters by kind; an invalid kind returns []", () => {
  const base = tmp();
  const db = openDb(base);
  proposeSkill(db, { skillId: "s1", content: "v1", observationCount: 5, ...PROV });
  proposeSkill(db, { skillId: "a1", kind: "agent", content: "v1", observationCount: 5, ...PROV });
  assert.deepEqual(listSkills(db, { kind: "skill" }).map((s) => s.skillId), ["s1"]);
  assert.deepEqual(listSkills(db, { kind: "agent" }).map((s) => s.skillId), ["a1"]);
  assert.equal(listSkills(db).length, 2, "no kind filter sees both");
  assert.deepEqual(listSkills(db, { kind: "nope" }), []);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Ch.2.2b — skill_observations storage primitives
// ---------------------------------------------------------------------------

test("recordObservation requires clusterKey, skillId, and valid provenance; always succeeds otherwise", () => {
  const base = tmp();
  const db = openDb(base);
  assert.equal(recordObservation(db, { skillId: "s1", ...PROV }), null, "missing clusterKey");
  assert.equal(recordObservation(db, { clusterKey: "ck1", ...PROV }), null, "missing skillId");
  assert.equal(recordObservation(db, { clusterKey: "ck1", skillId: "s1" }), null, "missing provenance");
  const row = recordObservation(db, { clusterKey: "ck1", skillId: "s1", note: "n1", ...PROV });
  assert.ok(row);
  assert.equal(row.clusterKey, "ck1");
  assert.equal(row.note, "n1");
  assert.equal(recordObservation(null, { clusterKey: "ck1", skillId: "s1", ...PROV }), null);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("countObservations counts per clusterKey, never mixing clusters; 0 on bad input", () => {
  const base = tmp();
  const db = openDb(base);
  recordObservation(db, { clusterKey: "ck1", skillId: "s1", ...PROV });
  recordObservation(db, { clusterKey: "ck1", skillId: "s1", ...PROV });
  recordObservation(db, { clusterKey: "ck2", skillId: "s2", ...PROV });
  assert.equal(countObservations(db, "ck1"), 2);
  assert.equal(countObservations(db, "ck2"), 1);
  assert.equal(countObservations(db, "nonexistent"), 0);
  assert.equal(countObservations(db, null), 0);
  assert.equal(countObservations(null, "ck1"), 0);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("listObservations returns a clusterKey's rows oldest-first and respects limit", () => {
  const base = tmp();
  const db = openDb(base);
  recordObservation(db, { clusterKey: "ck1", skillId: "s1", note: "first", ...PROV });
  recordObservation(db, { clusterKey: "ck1", skillId: "s1", note: "second", ...PROV });
  const rows = listObservations(db, "ck1");
  assert.deepEqual(rows.map((r) => r.note), ["first", "second"]);
  assert.equal(listObservations(db, "ck1", { limit: 1 }).length, 1);
  assert.deepEqual(listObservations(db, "nonexistent"), []);
  assert.deepEqual(listObservations(null, "ck1"), []);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Ch.2.2c — agent_instincts storage primitives
// ---------------------------------------------------------------------------

test("recordInstinct requires clusterKey, agentId, confidence in [0,1], and valid provenance", () => {
  const base = tmp();
  const db = openDb(base);
  assert.equal(recordInstinct(db, { agentId: "a1", confidence: 0.8, ...PROV }), null, "missing clusterKey");
  assert.equal(recordInstinct(db, { clusterKey: "ck1", confidence: 0.8, ...PROV }), null, "missing agentId");
  assert.equal(recordInstinct(db, { clusterKey: "ck1", agentId: "a1", confidence: 1.5, ...PROV }), null, "confidence > 1");
  assert.equal(recordInstinct(db, { clusterKey: "ck1", agentId: "a1", confidence: -0.1, ...PROV }), null, "confidence < 0");
  assert.equal(recordInstinct(db, { clusterKey: "ck1", agentId: "a1", confidence: NaN, ...PROV }), null, "NaN confidence");
  assert.equal(recordInstinct(db, { clusterKey: "ck1", agentId: "a1", confidence: 0.8 }), null, "missing provenance");
  const row = recordInstinct(db, { clusterKey: "ck1", agentId: "a1", confidence: 0.8, ...PROV });
  assert.ok(row);
  assert.equal(row.confidence, 0.8);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("instinctStats: avgConfidence is null with zero instincts, a real average otherwise", () => {
  const base = tmp();
  const db = openDb(base);
  assert.deepEqual(instinctStats(db, "ck1"), { count: 0, avgConfidence: null });
  recordInstinct(db, { clusterKey: "ck1", agentId: "a1", confidence: 0.6, ...PROV });
  recordInstinct(db, { clusterKey: "ck1", agentId: "a1", confidence: 0.9, ...PROV });
  const stats = instinctStats(db, "ck1");
  assert.equal(stats.count, 2);
  assert.ok(Math.abs(stats.avgConfidence - 0.75) < 1e-9);
  assert.deepEqual(instinctStats(null, "ck1"), { count: 0, avgConfidence: null });
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("listInstincts returns a clusterKey's rows oldest-first and respects limit", () => {
  const base = tmp();
  const db = openDb(base);
  recordInstinct(db, { clusterKey: "ck1", agentId: "a1", confidence: 0.6, note: "first", ...PROV });
  recordInstinct(db, { clusterKey: "ck1", agentId: "a1", confidence: 0.9, note: "second", ...PROV });
  const rows = listInstincts(db, "ck1");
  assert.deepEqual(rows.map((r) => r.note), ["first", "second"]);
  assert.equal(listInstincts(db, "ck1", { limit: 1 }).length, 1);
  assert.deepEqual(listInstincts(db, "nonexistent"), []);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("AGENT_INSTINCT_MIN_COUNT and AGENT_INSTINCT_MIN_AVG_CONFIDENCE match D6's documented thresholds", () => {
  assert.equal(AGENT_INSTINCT_MIN_COUNT, 3);
  assert.equal(AGENT_INSTINCT_MIN_AVG_CONFIDENCE, 0.75);
});
