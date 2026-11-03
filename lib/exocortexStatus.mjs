// lib/exocortexStatus.mjs — the aggregation layer behind the Exocortex dashboard (the user's own
// words: "i need a way to visualise everything it brought to the table, the ingestion engine, the
// graph, its live knowledge base, how it evolves live... otherwise it is a feedbackless
// functionality of the system, i would have no way of knowing if it works as intended or if it
// works at all").
//
// Every exocortex store (lib/knowledgeStore.mjs's facts/decisions, lib/skillStore.mjs's
// skills/agents, lib/conversationFts.mjs's search index) lives PER WORKSPACE — one SQLite file per
// `<repo>@<worktree>[#slot]`, under `<transcriptDir>/<slugFor(workspaceId)>/` (lib/storage.mjs).
// There is no single global database to just open and query; "what does the exocortex know, across
// my whole multi-repo workspace" only exists if something walks every workspace directory and adds
// it up. That is what this module does — read-only, best-effort (a missing/corrupt store for one
// workspace degrades to zeros for it, never throws and never blocks the others), so a monitoring
// dashboard built on it can never itself become a new way for the engine to look broken.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { idFromSlug, parseWorkspaceId } from "./storage.mjs";
import { openDb as openKnowledgeDb, listFacts as storeListFacts, listDecisions as storeListDecisions } from "./knowledgeStore.mjs";
import { openDb as openSkillDb, listSkills as storeListSkills, listSkillRuns as storeListSkillRuns } from "./skillStore.mjs";
import { openDb as openFtsDb, search as ftsSearch } from "./conversationFts.mjs";

function closeQuiet(db) { try { db?.close?.(); } catch { /* best effort */ } }

/** One scalar from a `SELECT ... AS n` query, or `0` on any failure (missing table, corrupt file,
 *  no db at all). The single guarded read every aggregation below is built from. */
function scalar(db, sql) {
  if (!db) return 0;
  try { const row = db.prepare(sql).get(); const v = row && Object.values(row)[0]; return Number.isFinite(v) ? v : 0; }
  catch { return 0; }
}

/** Every workspace directory under `transcriptDir`, decoded back to its `{repo, worktree, slot}`
 *  identity (lib/storage.mjs's slugFor/idFromSlug/parseWorkspaceId — the exact inverse of how
 *  WorkspaceManager derives a workspace's own directory). A missing/unreadable transcriptDir is
 *  the ordinary "nothing ingested yet" case, not an error — `[]`, never a throw. */
export function listWorkspaces(transcriptDir) {
  let entries;
  try { entries = readdirSync(transcriptDir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory || !e.isDirectory()) continue;
    const id = idFromSlug(e.name);
    const { repo, worktree, slot } = parseWorkspaceId(id);
    out.push({ id, repo, worktree, slot, dir: join(transcriptDir, e.name) });
  }
  return out;
}

/** Everything the dashboard needs to know about ONE workspace's exocortex state — fact/decision/
 *  skill/agent counts (skills and agents share `skillStore`'s table, discriminated by `kind` —
 *  see Ch.2.2c), how many are stale/decayed, the FTS recall index's row count, and the most recent
 *  activity timestamp across all of it (the dashboard's own "is this actually alive" signal — a
 *  store with data but nothing recent reads differently from one that's actively growing). */
export function workspaceStats(dir) {
  const kdb = openKnowledgeDb(dir);
  const sdb = openSkillDb(dir);
  const fdb = openFtsDb(dir);
  const stats = {
    facts: scalar(kdb, "SELECT COUNT(*) AS n FROM facts"),
    decisions: scalar(kdb, "SELECT COUNT(*) AS n FROM decisions"),
    skillsPending: scalar(sdb, "SELECT COUNT(*) AS n FROM skills WHERE kind='skill' AND status='pending'"),
    skillsApproved: scalar(sdb, "SELECT COUNT(*) AS n FROM skills WHERE kind='skill' AND status='approved'"),
    skillsRejected: scalar(sdb, "SELECT COUNT(*) AS n FROM skills WHERE kind='skill' AND status='rejected'"),
    agentsPending: scalar(sdb, "SELECT COUNT(*) AS n FROM skills WHERE kind='agent' AND status='pending'"),
    agentsApproved: scalar(sdb, "SELECT COUNT(*) AS n FROM skills WHERE kind='agent' AND status='approved'"),
    agentsRejected: scalar(sdb, "SELECT COUNT(*) AS n FROM skills WHERE kind='agent' AND status='rejected'"),
    staleSkills: scalar(sdb, "SELECT COUNT(*) AS n FROM skills WHERE decayStatus='stale'"),
    ftsRows: scalar(fdb, "SELECT COUNT(*) AS n FROM segment_rows"),
  };
  const factsLastAt = scalar(kdb, "SELECT COALESCE(MAX(createdAt),0) AS n FROM facts");
  const decisionsLastAt = scalar(kdb, "SELECT COALESCE(MAX(createdAt),0) AS n FROM decisions");
  const skillsLastAt = scalar(sdb, "SELECT COALESCE(MAX(createdAt),0) AS n FROM skills");
  const last = Math.max(factsLastAt, decisionsLastAt, skillsLastAt);
  stats.lastActivityAt = last > 0 ? last : null;
  closeQuiet(kdb); closeQuiet(sdb); closeQuiet(fdb);
  return stats;
}

const EMPTY_TOTALS = () => ({
  facts: 0, decisions: 0, skillsPending: 0, skillsApproved: 0, skillsRejected: 0,
  agentsPending: 0, agentsApproved: 0, agentsRejected: 0, staleSkills: 0, ftsRows: 0,
  lastActivityAt: null, workspaceCount: 0,
});
function addInto(totals, s) {
  for (const k of ["facts", "decisions", "skillsPending", "skillsApproved", "skillsRejected",
    "agentsPending", "agentsApproved", "agentsRejected", "staleSkills", "ftsRows"]) totals[k] += s[k] || 0;
  if (s.lastActivityAt) totals.lastActivityAt = Math.max(totals.lastActivityAt || 0, s.lastActivityAt);
  totals.workspaceCount += 1;
}

/** Every workspace's stats, rolled up to ONE row per REPO (merging its worktrees/conversation
 *  slots — "all the data that sits now on the workspace containing all repositories" is a
 *  per-repo question, not a per-worktree one). Sorted by most-recently-active first, so the
 *  dashboard's default view answers "what's actually being used" before "what exists". */
export function aggregateByRepo(transcriptDir) {
  const byRepo = new Map();
  for (const w of listWorkspaces(transcriptDir)) {
    const s = workspaceStats(w.dir);
    const row = byRepo.get(w.repo) || { repo: w.repo, ...EMPTY_TOTALS() };
    addInto(row, s);
    byRepo.set(w.repo, row);
  }
  return [...byRepo.values()].sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
}

/** The whole-workspace totals row — what the Overview page's top strip shows. */
export function overviewTotals(perRepo) {
  const t = { repos: perRepo.length, ...EMPTY_TOTALS() };
  delete t.workspaceCount;
  for (const r of perRepo) { addInto(t, r); }
  t.workspaces = perRepo.reduce((n, r) => n + (r.workspaceCount || 0), 0);
  delete t.workspaceCount;
  return t;
}

/** Facts for one repo (across all its worktrees/slots), newest first, capped at `opts.limit`
 *  (default 100) — the Knowledge Base browser's feed. Each row carries which workspace it came
 *  from, since the same repo can have facts recorded in more than one worktree/conversation. */
export function factsForRepo(transcriptDir, repo, opts = {}) {
  const dirs = listWorkspaces(transcriptDir).filter((w) => w.repo === repo);
  const out = [];
  for (const w of dirs) {
    const db = openKnowledgeDb(w.dir);
    if (db) { out.push(...storeListFacts(db, opts).map((f) => ({ ...f, workspaceId: w.id }))); closeQuiet(db); }
  }
  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return out.slice(0, Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : 100);
}

/** Decisions for one repo, same shape/ordering as factsForRepo. */
export function decisionsForRepo(transcriptDir, repo, opts = {}) {
  const dirs = listWorkspaces(transcriptDir).filter((w) => w.repo === repo);
  const out = [];
  for (const w of dirs) {
    const db = openKnowledgeDb(w.dir);
    if (db) { out.push(...storeListDecisions(db, opts).map((d) => ({ ...d, workspaceId: w.id }))); closeQuiet(db); }
  }
  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return out.slice(0, Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : 100);
}

/** Skills AND agents for one repo (same table, `kind` discriminates — see skillStore.mjs). */
export function skillsForRepo(transcriptDir, repo, opts = {}) {
  const dirs = listWorkspaces(transcriptDir).filter((w) => w.repo === repo);
  const out = [];
  for (const w of dirs) {
    const db = openSkillDb(w.dir);
    if (db) { out.push(...storeListSkills(db, { ...opts, includeStale: true }).map((s) => ({ ...s, workspaceId: w.id }))); closeQuiet(db); }
  }
  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return out.slice(0, Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : 100);
}

/** The run ledger for one skill — opens the specific workspace's own skill db (skillId alone isn't
 *  enough to find it without knowing which workspace it belongs to). */
export function skillRuns(workspaceDir, skillId, opts = {}) {
  const db = openSkillDb(workspaceDir);
  if (!db) return [];
  const rows = storeListSkillRuns(db, skillId, opts);
  closeQuiet(db);
  return rows;
}

/** FTS recall search across every one of a repo's workspaces at once — the "does total recall
 *  actually work" tester. Each hit carries which workspace it was found in. */
export function searchRepo(transcriptDir, repo, query, limit = 20) {
  const dirs = listWorkspaces(transcriptDir).filter((w) => w.repo === repo);
  const out = [];
  for (const w of dirs) {
    const db = openFtsDb(w.dir);
    if (db) { out.push(...ftsSearch(db, { query, limit }).map((r) => ({ ...r, workspaceId: w.id }))); closeQuiet(db); }
  }
  return out.slice(0, limit);
}

/** The distinct repo names with any exocortex data at all — the dashboard's repo picker. */
export function listRepos(transcriptDir) {
  return [...new Set(listWorkspaces(transcriptDir).map((w) => w.repo))].sort();
}
