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
// SCOPE OF THIS SLICE (deliberate): the storage + approve-verb layer, NOT the "nudge" detector.
// `proposeSkill` takes an already-computed `observationCount` and gates on the D6 cluster
// threshold (>=2) — it does not itself watch conversations for repeated-work patterns or spawn a
// background review subagent. That detection/nudge machinery is a separate, later slice; building
// it now would be exactly the scope creep the plan warns against. D6 also names a SEPARATE
// "agent candidate" threshold (>=3 instincts, >=0.75 avg confidence) — out of scope here too: this
// module is skill crystallisation only, per its task name.
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

// D6's starting threshold for a SKILL candidate: cluster >= 2 observations of the same repeated
// work. A tunable constant, not architecture — "start there, tune from what it actually proposes"
// (HANDOFF). Exported so a future nudge detector imports the same number rather than a copy of it.
export const SKILL_CLUSTER_THRESHOLD = 2;

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
 * proposeSkill(db, { skillId, content, observationCount, conversationId, turnKind, turnNumber,
 * at, amendmentReason }) → the proposed skill (joined with its version-1 content), or null if:
 *   - `skillId`/`content` is empty,
 *   - `observationCount` is below `SKILL_CLUSTER_THRESHOLD` (the D6 gate — never creates a
 *     sub-threshold proposal),
 *   - provenance doesn't validate,
 *   - `skillId` already exists (propose a new skillId, or amendSkill an existing one).
 * Always lands in status `'pending'` — this function NEVER auto-approves.
 */
export function proposeSkill(db, opts = {}) {
  try {
    if (!db) return null;
    const skillId = typeof opts.skillId === "string" ? opts.skillId.trim() : "";
    const content = typeof opts.content === "string" ? opts.content : "";
    if (!skillId || !content.trim()) return null;
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
        `INSERT INTO skills (skillId, status, currentVersion, conversationId, turnKind, turnNumber, at, createdAt)
         VALUES (?, 'pending', 1, ?, ?, ?, ?, ?)`
      ).run(skillId, prov.conversationId, prov.turnKind, prov.turnNumber, prov.at, now);
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
 * listSkills(db, { status, limit = 50, includeStale = false }) → skill rows (no joined content —
 * use getSkill for that), newest first. `status` filters to one of pending/approved/rejected when
 * given. Excludes `decayStatus = 'stale'` by default (Ch.2.4 — a decayed skill must not be
 * silently kept authoritative in ordinary listings); pass `includeStale: true` to see everything.
 */
export function listSkills(db, opts = {}) {
  try {
    if (!db) return [];
    const { status, limit = 50, includeStale = false } = opts && typeof opts === "object" ? opts : {};
    const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
    const clauses = [];
    const args = [];
    if (status != null) {
      if (!VALID_STATUS.has(status)) return [];
      clauses.push("status = ?");
      args.push(status);
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
