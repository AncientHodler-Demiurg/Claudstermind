// skillStore.mjs — Ch.2.2, skill crystallisation storage: PROPOSE-ONLY (D6), with the verb ECC
// never built.
//
// Per docs/work/exocortex/HANDOFF.md's D6 and ECC verdict:
//   - Hermes: nudge → background review subagent → skill create/patch, with an age curator and an
//     audit ledger. Proposal + review, never auto-adoption.
//   - ECC (scripts/lib/state-store/migrations.js:26-77): `skill_versions(skill_id, version,
//     content_hash, amendment_reason, promoted_at, rolled_back_at)` — an audit ledger with
//     rollback in six columns. Its `pending/` directory has NO approve command (promotion is a
//     manual file move) and its `trust` field is a one-valued enum (`unreviewed`) its own docs
//     admit is never set.
// THIS MODULE BUILDS THE VERB ECC OMITTED: a real `approveSkill`/`rejectSkill` with a genuine
// state transition (pending → approved | rejected), never silent, always requiring a reason to
// reject. Nothing here auto-adopts a proposal — `proposeSkill` only ever lands a candidate in
// `pending`.
//
// SCOPE OF THIS MODULE (deliberate): the storage + approve-verb layer, NOT the "nudge" detector.
// `proposeSkill`/`amendSkill` take already-computed content and counts — they do not themselves
// watch conversations for repeated-work patterns or spawn a background review subagent. That
// clustering/draft-injection orchestration is lib/skillNudge.mjs (Ch.2.2b/2.2c), one layer up,
// same split as lib/retrieval.mjs sitting above lib/knowledgeStore.mjs. This file owns three
// tables: `skills`/`skill_versions`/`skill_runs` (the state machine, above), `skill_observations`
// (Ch.2.2b's raw nudge signal for a SKILL candidate), and `agent_instincts` (Ch.2.2c's raw signal
// for an AGENT candidate — a different candidate type than a skill, per D6, now distinguished by
// the `skills.kind` column so both share the same propose/approve/version/decay machinery without
// duplicating it).
//
// REUSES lib/conversationFts.mjs's `openDatabaseFile` engine (Ch.2.0/2.1's pattern) and
// lib/provenance.mjs's shared provenance contract (Ch.2.1) — no new sqlite-loading or
// provenance-validation code here.
//
// ESM, node:sqlite + node:crypto only (both builtins, zero new dependencies). Every exported
// function guards against bad input and never throws.

import path from "node:path";
import crypto from "node:crypto";
import { openNonDisposableDb } from "./conversationFts.mjs";
import { normalizeProvenance } from "./provenance.mjs";

export const SKILL_DB_FILE = "skills.sqlite3";

// NOTE: `CREATE TABLE IF NOT EXISTS` does not retroactively add a column to an already-existing
// table — if a real skills.sqlite3 predating the `kind` column (or any later column) is ever
// opened by a newer version of this schema, `kind` would be missing and inserts referencing it
// would fail at runtime. Verified harmless TODAY: no skills.sqlite3 exists anywhere on this
// machine (`find / -name skills.sqlite3` returns nothing) — this store has no live caller yet
// (lib/skillNudge.mjs, Ch.2.2b/2.2c, is the first). A real `ALTER TABLE ... ADD COLUMN` migration
// path is deliberately NOT built speculatively for a gap that doesn't exist yet — same judgment
// call as knowledgeStore.mjs's nullable `at` column, revisit if/when a real install predates a
// future schema change.

// D6's starting threshold for a SKILL candidate: cluster >= 2 observations of the same repeated
// work. A tunable constant, not architecture — "start there, tune from what it actually proposes"
// (HANDOFF). Used by lib/skillNudge.mjs's clustering logic (Ch.2.2b).
export const SKILL_CLUSTER_THRESHOLD = 2;

// D6's SEPARATE threshold for an AGENT candidate — a different candidate type than a skill (per
// 2.2a's own deferral note): >= 3 "instincts" at >= 0.75 average confidence. Used by
// lib/skillNudge.mjs's nudgeAgent (Ch.2.2c).
export const AGENT_INSTINCT_MIN_COUNT = 3;
export const AGENT_INSTINCT_MIN_AVG_CONFIDENCE = 0.75;

// Ch.2.4 decay constants — "however the constant is defined, start simple: last N runs below a
// success threshold" (plan.md 2.4). All tunable, not architecture, same spirit as the cluster
// threshold above.
export const SKILL_DECAY_WINDOW = 5;       // consider at most the last N runs
export const SKILL_DECAY_MIN_RUNS = 3;     // don't judge decay off fewer runs than this — one bad
                                            // run in a window of one would flag every skill stale
                                            // the very first time it fails.
export const SKILL_DECAY_SUCCESS_THRESHOLD = 0.5; // success rate below this over the window -> stale

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skillId TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'skill',
  status TEXT NOT NULL DEFAULT 'pending',
  currentVersion INTEGER NOT NULL DEFAULT 1,
  conversationId TEXT NOT NULL,
  turnKind TEXT NOT NULL,
  turnNumber INTEGER NOT NULL,
  at INTEGER,
  createdAt INTEGER NOT NULL,
  decidedAt INTEGER,
  decisionReason TEXT NOT NULL DEFAULT '',
  decayStatus TEXT NOT NULL DEFAULT 'fresh',
  staleAt INTEGER,
  staleReason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_skills_kind ON skills(kind);

-- Ch.2.2b — the raw "nudge" signal for a SKILL candidate: one row per observation of the same
-- repeated work, grouped by clusterKey. Deliberately separate from the facts table in
-- knowledgeStore.mjs -- this is crystallisation telemetry, not durable knowledge, and it needs a
-- clusterKey column the facts table does not have. Always recorded, regardless of whether the
-- cluster has crossed threshold yet -- the record of "this was noticed" must survive even a
-- below-threshold nudge.
CREATE TABLE IF NOT EXISTS skill_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clusterKey TEXT NOT NULL,
  skillId TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  conversationId TEXT NOT NULL,
  turnKind TEXT NOT NULL,
  turnNumber INTEGER NOT NULL,
  at INTEGER,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skill_observations_clusterKey ON skill_observations(clusterKey);

-- Ch.2.2c — the raw signal for an AGENT candidate: D6's OTHER threshold (>=3 instincts, >=0.75
-- avg confidence) is a different shape than a skill's observation count, so it gets its own table
-- rather than overloading skill_observations with a confidence column most rows would leave null.
CREATE TABLE IF NOT EXISTS agent_instincts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clusterKey TEXT NOT NULL,
  agentId TEXT NOT NULL,
  confidence REAL NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  conversationId TEXT NOT NULL,
  turnKind TEXT NOT NULL,
  turnNumber INTEGER NOT NULL,
  at INTEGER,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_instincts_clusterKey ON agent_instincts(clusterKey);

CREATE TABLE IF NOT EXISTS skill_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skillId TEXT NOT NULL REFERENCES skills(skillId),
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  contentHash TEXT NOT NULL,
  amendmentReason TEXT NOT NULL DEFAULT '',
  createdAt INTEGER NOT NULL,
  promotedAt INTEGER,
  rolledBackAt INTEGER,
  UNIQUE(skillId, version)
);
CREATE INDEX IF NOT EXISTS idx_skill_versions_skillId ON skill_versions(skillId);

-- ECC's audit-ledger shape (per HANDOFF): outcome, failure_reason, tokens_used, duration_ms,
-- user_feedback -- the MEASURED decay signal, distinct from the editorial approve/reject state
-- machine above. A run can be recorded against a skill regardless of its approval status
-- (nothing here assumes only approved skills get run; that policy belongs to whatever invokes a
-- skill, not to this ledger).
CREATE TABLE IF NOT EXISTS skill_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skillId TEXT NOT NULL REFERENCES skills(skillId),
  outcome TEXT NOT NULL,
  failureReason TEXT NOT NULL DEFAULT '',
  tokensUsed INTEGER,
  durationMs INTEGER,
  userFeedback TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skill_runs_skillId ON skill_runs(skillId);
`;

const VALID_STATUS = new Set(["pending", "approved", "rejected"]);
const VALID_OUTCOME = new Set(["success", "failure", "partial"]);
const VALID_KIND = new Set(["skill", "agent"]);

/**
 * openDb(baseDir) → an open DatabaseSync at `<baseDir>/skills.sqlite3`, or null. Uses
 * `conversationFts.openNonDisposableDb`: this store (the skill audit ledger) has nothing to
 * rebuild from either, so a corrupt file returns null rather than being silently wiped, and the
 * FK enforcement `skill_versions`/`skill_runs` rely on is verified, not just requested.
 */
export function openDb(baseDir) {
  if (baseDir == null) return null;
  return openNonDisposableDb(path.join(String(baseDir), SKILL_DB_FILE), SCHEMA_SQL);
}

function contentHashOf(content) {
  return crypto.createHash("sha256").update(String(content), "utf8").digest("hex");
}

/**
 * proposeSkill(db, { skillId, kind = "skill", content, observationCount, conversationId,
 * turnKind, turnNumber, at, amendmentReason }) → the proposed skill (joined with its version-1
 * content), or null if:
 *   - `skillId`/`content` is empty, or `kind` isn't "skill"|"agent",
 *   - `observationCount` is below `SKILL_CLUSTER_THRESHOLD` (the D6 gate — never creates a
 *     sub-threshold proposal). This is the SKILL-candidate gate; an "agent" candidate's own
 *     (stricter) D6 gate — `AGENT_INSTINCT_MIN_COUNT`/`AGENT_INSTINCT_MIN_AVG_CONFIDENCE` — is
 *     enforced by the caller (lib/skillNudge.mjs's `nudgeAgent`) before it ever calls here,
 *     since this function only has `observationCount` to go on, not a confidence average.
 *   - provenance doesn't validate,
 *   - `skillId` already exists (propose a new skillId, or amendSkill an existing one).
 * Always lands in status `'pending'` — this function NEVER auto-approves.
 */
export function proposeSkill(db, opts = {}) {
  try {
    if (!db) return null;
    const skillId = typeof opts.skillId === "string" ? opts.skillId.trim() : "";
    const content = typeof opts.content === "string" ? opts.content : "";
    const kind = typeof opts.kind === "string" && opts.kind.trim() ? opts.kind.trim() : "skill";
    if (!skillId || !content.trim() || !VALID_KIND.has(kind)) return null;
    const observationCount = Number.isFinite(opts.observationCount) ? opts.observationCount : 0;
    if (observationCount < SKILL_CLUSTER_THRESHOLD) return null; // the D6 gate
    const prov = normalizeProvenance(opts);
    if (!prov) return null;

    const existing = db.prepare("SELECT id FROM skills WHERE skillId = ?").get(skillId);
    if (existing) return null; // use amendSkill for an existing candidate

    const now = Date.now();
    const amendmentReason = typeof opts.amendmentReason === "string" && opts.amendmentReason.trim()
      ? opts.amendmentReason.trim() : "initial proposal";

    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO skills (skillId, kind, status, currentVersion, conversationId, turnKind, turnNumber, at, createdAt)
         VALUES (?, ?, 'pending', 1, ?, ?, ?, ?, ?)`
      ).run(skillId, kind, prov.conversationId, prov.turnKind, prov.turnNumber, prov.at, now);
      db.prepare(
        `INSERT INTO skill_versions (skillId, version, content, contentHash, amendmentReason, createdAt)
         VALUES (?, 1, ?, ?, ?, ?)`
      ).run(skillId, content, contentHashOf(content), amendmentReason, now);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return getSkill(db, skillId);
  } catch {
    return null;
  }
}

/** getSkill(db, skillId) → the skill row joined with its CURRENT version's content/contentHash,
 *  or null if not found. */
export function getSkill(db, skillId) {
  try {
    if (!db || !skillId) return null;
    const skill = db.prepare("SELECT * FROM skills WHERE skillId = ?").get(String(skillId));
    if (!skill) return null;
    const version = db.prepare(
      "SELECT * FROM skill_versions WHERE skillId = ? AND version = ?"
    ).get(skill.skillId, skill.currentVersion);
    return { ...skill, content: version ? version.content : null, contentHash: version ? version.contentHash : null };
  } catch {
    return null;
  }
}

/**
 * listSkills(db, { status, kind, limit = 50, includeStale = false }) → skill rows (no joined
 * content — use getSkill for that), newest first. `status` filters to one of
 * pending/approved/rejected when given; `kind` filters to one of skill/agent when given (both
 * live in the same table — see Ch.2.2c). Excludes `decayStatus = 'stale'` by default (Ch.2.4 — a
 * decayed skill must not be silently kept authoritative in ordinary listings); pass
 * `includeStale: true` to see everything.
 */
export function listSkills(db, opts = {}) {
  try {
    if (!db) return [];
    const { status, kind, limit = 50, includeStale = false } = opts && typeof opts === "object" ? opts : {};
    const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
    const clauses = [];
    const args = [];
    if (status != null) {
      if (!VALID_STATUS.has(status)) return [];
      clauses.push("status = ?");
      args.push(status);
    }
    if (kind != null) {
      if (!VALID_KIND.has(kind)) return [];
      clauses.push("kind = ?");
      args.push(kind);
    }
    if (!includeStale) clauses.push("decayStatus != 'stale'");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    args.push(cap);
    return db.prepare(`SELECT * FROM skills ${where} ORDER BY id DESC LIMIT ?`).all(...args);
  } catch {
    return [];
  }
}

/** listSkillVersions(db, skillId) → the full audit ledger for a skill, oldest version first. */
export function listSkillVersions(db, skillId) {
  try {
    if (!db || !skillId) return [];
    return db.prepare("SELECT * FROM skill_versions WHERE skillId = ? ORDER BY version ASC").all(String(skillId));
  } catch {
    return [];
  }
}

/**
 * amendSkill(db, skillId, { content, amendmentReason }) → the new version row, or null if the
 * skill doesn't exist, is `rejected` (propose a fresh skillId instead of amending a rejected
 * one), or `content` is empty. Appends a new `skill_versions` row (never mutates an old one) and
 * advances `skills.currentVersion` to match.
 */
export function amendSkill(db, skillId, opts = {}) {
  try {
    if (!db || !skillId) return null;
    const content = typeof opts.content === "string" ? opts.content : "";
    if (!content.trim()) return null;
    const skill = db.prepare("SELECT * FROM skills WHERE skillId = ?").get(String(skillId));
    if (!skill || skill.status === "rejected") return null;

    const nextVersion = skill.currentVersion + 1;
    const now = Date.now();
    const amendmentReason = typeof opts.amendmentReason === "string" && opts.amendmentReason.trim()
      ? opts.amendmentReason.trim() : "amendment";

    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO skill_versions (skillId, version, content, contentHash, amendmentReason, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(skill.skillId, nextVersion, content, contentHashOf(content), amendmentReason, now);
      db.prepare("UPDATE skills SET currentVersion = ? WHERE skillId = ?").run(nextVersion, skill.skillId);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return listSkillVersions(db, skillId).find((v) => v.version === nextVersion) || null;
  } catch {
    return null;
  }
}

/**
 * rollbackSkill(db, skillId, { toVersion }) → the NEW version row (its content/contentHash
 * restored to match `toVersion`), or null if the skill or `toVersion` doesn't exist.
 *
 * Never mutates or deletes the row being rolled back FROM — it only stamps that row's
 * `rolledBackAt`, then appends a fresh version whose content is a copy of `toVersion`'s. The
 * ledger stays append-only and the full history remains inspectable; "restores the previous
 * content_hash" means the SKILL's current state matches it again, not that history is rewritten.
 */
export function rollbackSkill(db, skillId, opts = {}) {
  try {
    if (!db || !skillId) return null;
    const toVersion = Number.isFinite(opts.toVersion) ? Math.floor(opts.toVersion) : NaN;
    if (!(toVersion >= 1)) return null;
    const skill = db.prepare("SELECT * FROM skills WHERE skillId = ?").get(String(skillId));
    if (!skill) return null;
    const target = db.prepare("SELECT * FROM skill_versions WHERE skillId = ? AND version = ?").get(skill.skillId, toVersion);
    if (!target) return null;

    const now = Date.now();
    const nextVersion = skill.currentVersion + 1;
    db.exec("BEGIN");
    try {
      db.prepare(
        "UPDATE skill_versions SET rolledBackAt = ? WHERE skillId = ? AND version = ?"
      ).run(now, skill.skillId, skill.currentVersion);
      db.prepare(
        `INSERT INTO skill_versions (skillId, version, content, contentHash, amendmentReason, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(skill.skillId, nextVersion, target.content, target.contentHash, `rollback to v${toVersion}`, now);
      db.prepare("UPDATE skills SET currentVersion = ? WHERE skillId = ?").run(nextVersion, skill.skillId);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return listSkillVersions(db, skillId).find((v) => v.version === nextVersion) || null;
  } catch {
    return null;
  }
}

/**
 * approveSkill(db, skillId, { reason = "" }) → the updated skill row, or null if the skill
 * doesn't exist or isn't currently `pending` (approving is a one-way transition FROM pending —
 * an already-decided skill must be re-proposed or amended, not silently re-approved).
 * Stamps `promotedAt` on the CURRENT version row too, per ECC's ledger shape.
 */
export function approveSkill(db, skillId, opts = {}) {
  return decideSkill(db, skillId, "approved", opts);
}

/**
 * rejectSkill(db, skillId, { reason }) → the updated skill row, or null if the skill doesn't
 * exist, isn't `pending`, or `reason` is empty. A reason is REQUIRED to reject — "rejecting one
 * records why" (plan.md 2.2) is not optional the way it is for approve.
 */
export function rejectSkill(db, skillId, opts = {}) {
  const reason = typeof opts.reason === "string" ? opts.reason.trim() : "";
  if (!reason) return null;
  return decideSkill(db, skillId, "rejected", { reason });
}

function decideSkill(db, skillId, status, opts = {}) {
  try {
    if (!db || !skillId || !VALID_STATUS.has(status) || status === "pending") return null;
    const skill = db.prepare("SELECT * FROM skills WHERE skillId = ?").get(String(skillId));
    if (!skill || skill.status !== "pending") return null;

    const now = Date.now();
    const reason = typeof opts.reason === "string" ? opts.reason.trim() : "";
    db.exec("BEGIN");
    try {
      db.prepare(
        "UPDATE skills SET status = ?, decidedAt = ?, decisionReason = ? WHERE skillId = ?"
      ).run(status, now, reason, skill.skillId);
      if (status === "approved") {
        db.prepare(
          "UPDATE skill_versions SET promotedAt = ? WHERE skillId = ? AND version = ?"
        ).run(now, skill.skillId, skill.currentVersion);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return getSkill(db, skillId);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ch.2.4 — decay: the MEASURED signal (skill_runs), distinct from the editorial approve/reject
// state machine above. `decayStatus` is its own column precisely so the two axes never tangle:
// an approved skill can independently go stale from bad performance, and a demoted skill can
// recover without touching its approval history.
// ---------------------------------------------------------------------------

/**
 * computeDecayStatus(runs) → { decayStatus: 'fresh'|'stale', successRate: number|null, window:
 * number, reason: string|null }
 *
 * Pure function over an array of run rows (newest first, as `listSkillRuns` returns them) —
 * considers at most the most recent `SKILL_DECAY_WINDOW` runs, and requires at least
 * `SKILL_DECAY_MIN_RUNS` of them before judging anything (one bad run in a tiny sample must not
 * flag a skill stale on its very first use). Below that minimum, or given no runs at all,
 * `successRate` is null and `decayStatus` is `'fresh'` — decay is something evidence
 * demonstrates, not something the absence of evidence implies.
 */
export function computeDecayStatus(runs) {
  const list = Array.isArray(runs) ? runs.slice(0, SKILL_DECAY_WINDOW) : [];
  if (list.length < SKILL_DECAY_MIN_RUNS) {
    return { decayStatus: "fresh", successRate: null, window: list.length, reason: null };
  }
  const successes = list.filter((r) => r && r.outcome === "success").length;
  const successRate = successes / list.length;
  if (successRate < SKILL_DECAY_SUCCESS_THRESHOLD) {
    const pct = Math.round(successRate * 100);
    return {
      decayStatus: "stale",
      successRate,
      window: list.length,
      reason: `success rate ${pct}% over the last ${list.length} run(s), below the ${Math.round(SKILL_DECAY_SUCCESS_THRESHOLD * 100)}% threshold`,
    };
  }
  return { decayStatus: "fresh", successRate, window: list.length, reason: null };
}

/**
 * recordSkillRun(db, skillId, { outcome, failureReason, tokensUsed, durationMs, userFeedback, at })
 * → { run, decay } | null, where `run` is the inserted ledger row and `decay` is this call's
 * `computeDecayStatus` result — null if the skill doesn't exist or `outcome` isn't one of
 * success/failure/partial.
 *
 * After inserting, RECOMPUTES `skills.decayStatus` from the current window (not a one-way
 * ratchet — a skill that recovers after a bad stretch comes back to `'fresh'` on its own, the
 * same as `refreshFact`'s reversibility for facts). This is the automatic half of decay; contrast
 * with the human-gated `approveSkill`/`rejectSkill` verb above.
 */
export function recordSkillRun(db, skillId, opts = {}) {
  try {
    if (!db || !skillId) return null;
    const outcome = opts.outcome;
    if (!VALID_OUTCOME.has(outcome)) return null;
    const skill = db.prepare("SELECT * FROM skills WHERE skillId = ?").get(String(skillId));
    if (!skill) return null;

    const at = Number.isFinite(opts.at) ? Math.floor(opts.at) : Date.now();
    const failureReason = typeof opts.failureReason === "string" ? opts.failureReason : "";
    const tokensUsed = Number.isFinite(opts.tokensUsed) ? Math.floor(opts.tokensUsed) : null;
    const durationMs = Number.isFinite(opts.durationMs) ? Math.floor(opts.durationMs) : null;
    const userFeedback = typeof opts.userFeedback === "string" ? opts.userFeedback : "";

    let runId;
    let decay;
    db.exec("BEGIN");
    try {
      const info = db.prepare(
        `INSERT INTO skill_runs (skillId, outcome, failureReason, tokensUsed, durationMs, userFeedback, at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(skill.skillId, outcome, failureReason, tokensUsed, durationMs, userFeedback, at);
      runId = Number(info.lastInsertRowid);

      const recent = db.prepare(
        "SELECT * FROM skill_runs WHERE skillId = ? ORDER BY id DESC LIMIT ?"
      ).all(skill.skillId, SKILL_DECAY_WINDOW);
      decay = computeDecayStatus(recent);
      if (decay.decayStatus === "stale") {
        db.prepare(
          "UPDATE skills SET decayStatus = 'stale', staleAt = ?, staleReason = ? WHERE skillId = ?"
        ).run(at, decay.reason, skill.skillId);
      } else {
        db.prepare(
          "UPDATE skills SET decayStatus = 'fresh', staleAt = NULL, staleReason = '' WHERE skillId = ?"
        ).run(skill.skillId);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    const run = db.prepare("SELECT * FROM skill_runs WHERE id = ?").get(runId);
    return { run, decay };
  } catch {
    return null;
  }
}

/** listSkillRuns(db, skillId, { limit = 50 }) → run rows, newest first. */
export function listSkillRuns(db, skillId, opts = {}) {
  try {
    if (!db || !skillId) return [];
    const { limit = 50 } = opts && typeof opts === "object" ? opts : {};
    const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
    return db.prepare("SELECT * FROM skill_runs WHERE skillId = ? ORDER BY id DESC LIMIT ?").all(String(skillId), cap);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Ch.2.2b — the raw "nudge" signal (storage primitives only; the clustering/threshold/draft
// orchestration that calls these plus proposeSkill/amendSkill above lives one layer up, in
// lib/skillNudge.mjs — same layering as lib/retrieval.mjs sitting above lib/knowledgeStore.mjs).
// ---------------------------------------------------------------------------

/**
 * recordObservation(db, { clusterKey, skillId, note, conversationId, turnKind, turnNumber, at })
 * → the inserted row, or null if `clusterKey`/`skillId` is empty or provenance doesn't validate.
 * ALWAYS records — there is no threshold gate here; that's lib/skillNudge.mjs's job once it has
 * the count this function makes possible (`countObservations`).
 */
export function recordObservation(db, opts = {}) {
  try {
    if (!db) return null;
    const clusterKey = typeof opts.clusterKey === "string" ? opts.clusterKey.trim() : "";
    const skillId = typeof opts.skillId === "string" ? opts.skillId.trim() : "";
    if (!clusterKey || !skillId) return null;
    const prov = normalizeProvenance(opts);
    if (!prov) return null;
    const note = typeof opts.note === "string" ? opts.note : "";
    const now = Date.now();
    const info = db.prepare(
      `INSERT INTO skill_observations (clusterKey, skillId, note, conversationId, turnKind, turnNumber, at, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(clusterKey, skillId, note, prov.conversationId, prov.turnKind, prov.turnNumber, prov.at, now);
    return db.prepare("SELECT * FROM skill_observations WHERE id = ?").get(Number(info.lastInsertRowid));
  } catch {
    return null;
  }
}

/** countObservations(db, clusterKey) → the number of observations recorded for this clusterKey, 0 on any bad input. */
export function countObservations(db, clusterKey) {
  try {
    if (!db || !clusterKey) return 0;
    const row = db.prepare("SELECT COUNT(*) AS n FROM skill_observations WHERE clusterKey = ?").get(String(clusterKey));
    return row ? Number(row.n) : 0;
  } catch {
    return 0;
  }
}

/** listObservations(db, clusterKey, { limit = 50 }) → observation rows for a clusterKey, oldest first (draft context reads chronologically). */
export function listObservations(db, clusterKey, opts = {}) {
  try {
    if (!db || !clusterKey) return [];
    const { limit = 50 } = opts && typeof opts === "object" ? opts : {};
    const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
    return db.prepare(
      "SELECT * FROM skill_observations WHERE clusterKey = ? ORDER BY id ASC LIMIT ?"
    ).all(String(clusterKey), cap);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Ch.2.2c — the raw "instinct" signal for an AGENT candidate (D6's other, stricter threshold).
// Same storage-only/orchestration-elsewhere split as the observation functions above.
// ---------------------------------------------------------------------------

/**
 * recordInstinct(db, { clusterKey, agentId, confidence, note, conversationId, turnKind,
 * turnNumber, at }) → the inserted row, or null if `clusterKey`/`agentId` is empty, `confidence`
 * isn't a finite number in [0, 1], or provenance doesn't validate.
 */
export function recordInstinct(db, opts = {}) {
  try {
    if (!db) return null;
    const clusterKey = typeof opts.clusterKey === "string" ? opts.clusterKey.trim() : "";
    const agentId = typeof opts.agentId === "string" ? opts.agentId.trim() : "";
    const confidence = Number.isFinite(opts.confidence) ? opts.confidence : NaN;
    if (!clusterKey || !agentId || !(confidence >= 0 && confidence <= 1)) return null;
    const prov = normalizeProvenance(opts);
    if (!prov) return null;
    const note = typeof opts.note === "string" ? opts.note : "";
    const now = Date.now();
    const info = db.prepare(
      `INSERT INTO agent_instincts (clusterKey, agentId, confidence, note, conversationId, turnKind, turnNumber, at, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(clusterKey, agentId, confidence, note, prov.conversationId, prov.turnKind, prov.turnNumber, prov.at, now);
    return db.prepare("SELECT * FROM agent_instincts WHERE id = ?").get(Number(info.lastInsertRowid));
  } catch {
    return null;
  }
}

/**
 * instinctStats(db, clusterKey) → { count, avgConfidence } — `avgConfidence` is `null` when
 * `count` is 0 (an average of nothing is not zero confidence, it's no evidence yet — same
 * distinction `computeDecayStatus` already draws for a skill with too few runs).
 */
export function instinctStats(db, clusterKey) {
  try {
    if (!db || !clusterKey) return { count: 0, avgConfidence: null };
    const row = db.prepare(
      "SELECT COUNT(*) AS n, AVG(confidence) AS avg FROM agent_instincts WHERE clusterKey = ?"
    ).get(String(clusterKey));
    const count = row ? Number(row.n) : 0;
    return { count, avgConfidence: count > 0 ? Number(row.avg) : null };
  } catch {
    return { count: 0, avgConfidence: null };
  }
}

/** listInstincts(db, clusterKey, { limit = 50 }) → instinct rows for a clusterKey, oldest first. */
export function listInstincts(db, clusterKey, opts = {}) {
  try {
    if (!db || !clusterKey) return [];
    const { limit = 50 } = opts && typeof opts === "object" ? opts : {};
    const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
    return db.prepare(
      "SELECT * FROM agent_instincts WHERE clusterKey = ? ORDER BY id ASC LIMIT ?"
    ).all(String(clusterKey), cap);
  } catch {
    return [];
  }
}
