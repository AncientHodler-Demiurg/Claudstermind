// node --test lib/exocortexStatus.test.mjs — the Exocortex dashboard's aggregation layer.
//
// "i need a way to visualise everything it brought to the table, the ingestion engine, the graph,
// its live knowledge base, how it evolves live... otherwise it is a feedbackless functionality of
// the system, i would have no way of knowing if it works as intended or if it works at all."
//
// Real SQLite files, written through the ACTUAL store functions (addFact/addDecision/proposeSkill/
// upsertRow) rather than hand-rolled fixtures — if the schema or a store function's behavior ever
// drifts, this suite drifts with it instead of quietly testing against a stale shape.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slugFor, workspaceId } from "./storage.mjs";
import { openDb as openKnowledgeDb, addFact, addDecision } from "./knowledgeStore.mjs";
import { openDb as openSkillDb, proposeSkill, approveSkill, rejectSkill, recordSkillRun } from "./skillStore.mjs";
import { openDb as openFtsDb, upsertRow } from "./conversationFts.mjs";
import {
  listWorkspaces, workspaceStats, aggregateByRepo, overviewTotals,
  factsForRepo, decisionsForRepo, skillsForRepo, skillRuns, searchRepo, listRepos,
} from "./exocortexStatus.mjs";

const PROV = { conversationId: "conv-1", turnKind: "response", turnNumber: 1, at: Date.now() };

function tmpTranscriptDir() { return mkdtempSync(join(tmpdir(), "exo-status-")); }
function wsDir(transcriptDir, id) { const d = join(transcriptDir, slugFor(id)); mkdirSync(d, { recursive: true }); return d; }

test("listWorkspaces: decodes every workspace dir back to its repo/worktree/slot identity; a missing transcriptDir is just empty, not a throw", () => {
  const root = tmpTranscriptDir();
  const id1 = workspaceId("AncientPantheon/claudstermind", "main");
  const id2 = workspaceId("AncientPantheon/stoachain", "feature-x");
  wsDir(root, id1); wsDir(root, id2);
  const list = listWorkspaces(root);
  assert.equal(list.length, 2);
  const repos = list.map((w) => w.repo).sort();
  assert.deepEqual(repos, ["AncientPantheon/claudstermind", "AncientPantheon/stoachain"]);
  assert.deepEqual(listWorkspaces(join(root, "nope-does-not-exist")), []);
  rmSync(root, { recursive: true, force: true });
});

test("workspaceStats: real facts/decisions/skills/FTS rows, written through the actual store functions, are all counted correctly", () => {
  const root = tmpTranscriptDir();
  const id = workspaceId("Claudstermind", "main");
  const dir = wsDir(root, id);

  const kdb = openKnowledgeDb(dir);
  addFact(kdb, { text: "Pact conventions live in ouronet/conventions/*", ...PROV });
  addFact(kdb, { text: "The engine respawns on a key switch", ...PROV });
  addDecision(kdb, { title: "Use fallback mode by default", rationale: "safer default", ...PROV });
  kdb.close();

  const sdb = openSkillDb(dir);
  const skill = proposeSkill(sdb, { skillId: "fix-key-failover", content: "when X, do Y", kind: "skill", observationCount: 2, ...PROV });
  approveSkill(sdb, skill.skillId, { reason: "looks right" });
  const agent = proposeSkill(sdb, { skillId: "codex-reviewer", content: "review Pact diffs", kind: "agent", observationCount: 3, ...PROV });
  rejectSkill(sdb, agent.skillId, { reason: "too narrow" });
  sdb.close();

  const fdb = openFtsDb(dir);
  upsertRow(fdb, { conversationId: "conv-1", segmentRef: "seg-1", workspaceId: id, kind: "response", number: 1, text: "hello world", at: Date.now() });
  upsertRow(fdb, { conversationId: "conv-1", segmentRef: "seg-1", workspaceId: id, kind: "prompt", number: 2, text: "another row", at: Date.now() });
  fdb.close();

  const stats = workspaceStats(dir);
  assert.equal(stats.facts, 2);
  assert.equal(stats.decisions, 1);
  assert.equal(stats.skillsApproved, 1);
  assert.equal(stats.agentsRejected, 1);
  assert.equal(stats.ftsRows, 2);
  assert.ok(typeof stats.lastActivityAt === "number" && stats.lastActivityAt > 0, "activity timestamp must reflect the real writes above");
  rmSync(root, { recursive: true, force: true });
});

test("workspaceStats on a workspace dir with NO stores at all degrades to all zeros, never throws", () => {
  const root = tmpTranscriptDir();
  const dir = wsDir(root, workspaceId("empty-repo", "main"));
  const stats = workspaceStats(dir);
  assert.deepEqual(stats, { facts: 0, decisions: 0, skillsPending: 0, skillsApproved: 0, skillsRejected: 0,
    agentsPending: 0, agentsApproved: 0, agentsRejected: 0, staleSkills: 0, ftsRows: 0, lastActivityAt: null });
  rmSync(root, { recursive: true, force: true });
});

test("aggregateByRepo: merges a repo's MULTIPLE worktrees/slots into ONE row, sorted most-recently-active first", () => {
  const root = tmpTranscriptDir();
  const mainId = workspaceId("Claudstermind", "main");
  const featId = workspaceId("Claudstermind", "feature-x");
  const otherId = workspaceId("OtherRepo", "main");

  const mainDir = wsDir(root, mainId);
  const kdb1 = openKnowledgeDb(mainDir); addFact(kdb1, { text: "fact A", ...PROV, at: 1000 }); kdb1.close();

  const featDir = wsDir(root, featId);
  const kdb2 = openKnowledgeDb(featDir); addFact(kdb2, { text: "fact B", ...PROV }); kdb2.close();   // newer (real Date.now())

  wsDir(root, otherId);   // exists, but genuinely empty — still a zero row, not dropped

  const rows = aggregateByRepo(root);
  assert.equal(rows.length, 2, "Claudstermind's two worktrees merge into ONE row; OtherRepo is its own");
  const cm = rows.find((r) => r.repo === "Claudstermind");
  assert.equal(cm.facts, 2, "2 facts total across BOTH worktrees");
  assert.equal(cm.workspaceCount, 2);
  assert.equal(rows[0].repo, "Claudstermind", "most recently active repo sorts first");
  const other = rows.find((r) => r.repo === "OtherRepo");
  assert.equal(other.facts, 0);
  rmSync(root, { recursive: true, force: true });
});

test("overviewTotals: sums every repo's row into one grand total, with a correct workspace count", () => {
  const perRepo = [
    { repo: "A", facts: 3, decisions: 1, skillsPending: 1, skillsApproved: 0, skillsRejected: 0, agentsPending: 0, agentsApproved: 1, agentsRejected: 0, staleSkills: 0, ftsRows: 10, lastActivityAt: 500, workspaceCount: 2 },
    { repo: "B", facts: 2, decisions: 0, skillsPending: 0, skillsApproved: 2, skillsRejected: 1, agentsPending: 0, agentsApproved: 0, agentsRejected: 0, staleSkills: 1, ftsRows: 5, lastActivityAt: 900, workspaceCount: 1 },
  ];
  const t = overviewTotals(perRepo);
  assert.equal(t.repos, 2);
  assert.equal(t.facts, 5);
  assert.equal(t.decisions, 1);
  assert.equal(t.skillsApproved, 2);
  assert.equal(t.staleSkills, 1);
  assert.equal(t.ftsRows, 15);
  assert.equal(t.workspaces, 3, "2 + 1 workspaces across both repos");
  assert.equal(t.lastActivityAt, 900, "the LATEST activity across every repo, not the first");
});

test("factsForRepo / decisionsForRepo: pull from every worktree of a repo, newest first, each row tagged with its own workspaceId", () => {
  const root = tmpTranscriptDir();
  const mainId = workspaceId("Claudstermind", "main");
  const featId = workspaceId("Claudstermind", "feature-x");
  const mainDir = wsDir(root, mainId), featDir = wsDir(root, featId);

  const k1 = openKnowledgeDb(mainDir); addFact(k1, { text: "older fact", ...PROV, createdAt: undefined }); k1.close();
  // addFact stamps createdAt = Date.now() itself; separate the two calls by a tick so order is deterministic
  const k2 = openKnowledgeDb(featDir); addDecision(k2, { title: "a decision in the feature worktree", ...PROV }); addFact(k2, { text: "newer fact", ...PROV }); k2.close();

  const facts = factsForRepo(root, "Claudstermind");
  assert.equal(facts.length, 2);
  assert.ok(facts.every((f) => f.workspaceId === mainId || f.workspaceId === featId));
  assert.ok(facts[0].createdAt >= facts[1].createdAt, "newest first");

  const decisions = decisionsForRepo(root, "Claudstermind");
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].workspaceId, featId);
  rmSync(root, { recursive: true, force: true });
});

test("skillsForRepo + skillRuns: skills and agents both surface (kind discriminates), and a skill's run ledger is readable by workspace + skillId", () => {
  const root = tmpTranscriptDir();
  const id = workspaceId("Claudstermind", "main");
  const dir = wsDir(root, id);
  const sdb = openSkillDb(dir);
  const skill = proposeSkill(sdb, { skillId: "my-skill", content: "do the thing", kind: "skill", observationCount: 2, ...PROV });
  proposeSkill(sdb, { skillId: "my-agent", content: "review the thing", kind: "agent", observationCount: 3, ...PROV });
  recordSkillRun(sdb, skill.skillId, { outcome: "success", ...PROV });
  recordSkillRun(sdb, skill.skillId, { outcome: "failure", failureReason: "timed out", ...PROV });
  sdb.close();

  const rows = skillsForRepo(root, "Claudstermind");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.kind).sort(), ["agent", "skill"]);

  const runs = skillRuns(dir, "my-skill");
  assert.equal(runs.length, 2);
  assert.equal(runs[0].outcome, "failure", "newest run first");
  rmSync(root, { recursive: true, force: true });
});

test("searchRepo: finds a real indexed row across a repo's workspaces via BM25, tagged with which workspace it came from", () => {
  const root = tmpTranscriptDir();
  const id = workspaceId("Claudstermind", "main");
  const dir = wsDir(root, id);
  const fdb = openFtsDb(dir);
  upsertRow(fdb, { conversationId: "conv-1", segmentRef: "seg-1", workspaceId: id, kind: "response", number: 1, text: "the seamless key failover was shipped in 1.22.2", at: Date.now() });
  upsertRow(fdb, { conversationId: "conv-1", segmentRef: "seg-1", workspaceId: id, kind: "response", number: 2, text: "unrelated row about pact gas limits", at: Date.now() });
  fdb.close();

  const hits = searchRepo(root, "Claudstermind", "seamless key failover");
  assert.equal(hits.length, 1);
  assert.match(hits[0].text, /seamless key failover/);
  assert.equal(hits[0].workspaceId, id);
  assert.deepEqual(searchRepo(root, "Claudstermind", ""), [], "an empty query finds nothing, not everything");
  rmSync(root, { recursive: true, force: true });
});

test("listRepos: the distinct set of repos with ANY exocortex data, for a picker", () => {
  const root = tmpTranscriptDir();
  wsDir(root, workspaceId("B-repo", "main"));
  wsDir(root, workspaceId("A-repo", "main"));
  wsDir(root, workspaceId("A-repo", "feature-x"));
  assert.deepEqual(listRepos(root), ["A-repo", "B-repo"], "distinct AND sorted");
  rmSync(root, { recursive: true, force: true });
});
