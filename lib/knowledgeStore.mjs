// knowledgeStore.mjs — Ch.2.1, the durable knowledge store: facts, conventions, and decisions,
// each stamped with provenance so nothing the brain "knows" is unmoored from where it came from.
//
// Per docs/work/exocortex/plan.md 2.1 and docs/work/exocortex/HANDOFF.md's ECC verdict:
//   `decisions(title, rationale, alternatives CHECK(json_valid), supersedes FK → decisions(id), status)`
// is ECC's one genuinely reusable artifact — conflict handling as a foreign key, not a runtime
// check. Taken here almost verbatim; `facts` (facts + conventions, discriminated by `kind`) is new,
// simpler shape for everything that isn't a decision.
//
// REUSES lib/conversationFts.mjs's `openDatabaseFile` as the engine (same sqlite-loading +
// corrupt-file-recovery code path as the conversation-recall FTS store) rather than growing a
// second bespoke SQLite setup. This store's schema is plain relational, no FTS5 virtual tables —
// full-text ranking over facts/decisions is Ch.2.3's job (retrieval/budgeting), not this one's.
//
// PROVENANCE IS MANDATORY, NOT ADVISORY: every write requires conversationId + turnKind +
// turnNumber (validated in JS before ever touching SQL, AND enforced NOT NULL in the schema as
// defense in depth — a bypass of this module's functions still can't create an orphan row).
// `at` (the source turn's own epoch-ms timestamp) is carried forward when available but stays
// NULLABLE: verified against this real install that every row has one today (see plan.md 2.1),
// but nothing here should assume that forever.
//
// This module does NOT know how to resolve a conversationId back to an archive directory — that
// mapping is workspace.mjs's `_archiveBaseFor` logic, entirely orthogonal to knowledge storage.
// `resolveText()` below takes the archive `baseDir` as an explicit parameter so this module stays
// decoupled from workspace resolution.
//
// ESM, node:sqlite only (via conversationFts.mjs). Every exported function guards against bad
// input and never throws — invalid writes return null, bad reads return [] or null.

import path from "node:path";
import { openNonDisposableDb } from "./conversationFts.mjs";
import { recallByNumber } from "./conversationArchive.mjs";
import { normalizeProvenance, provenanceOf as sharedProvenanceOf } from "./provenance.mjs";

export const KNOWLEDGE_DB_FILE = "knowledge.sqlite3";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'fact',
  text TEXT NOT NULL,
  conversationId TEXT NOT NULL,
  turnKind TEXT NOT NULL,
  turnNumber INTEGER NOT NULL,
  at INTEGER,
  createdAt INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  confidence REAL,
  scope TEXT NOT NULL DEFAULT 'project',
  staleAt INTEGER,
  staleReason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_facts_conv ON facts(conversationId);
CREATE INDEX IF NOT EXISTS idx_facts_kind ON facts(kind);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  alternatives TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(alternatives)),
  status TEXT NOT NULL DEFAULT 'active',
  supersedes INTEGER REFERENCES decisions(id),
  supersededAt INTEGER,
  conversationId TEXT NOT NULL,
  turnKind TEXT NOT NULL,
  turnNumber INTEGER NOT NULL,
  at INTEGER,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decisions_conv ON decisions(conversationId);
CREATE INDEX IF NOT EXISTS idx_decisions_supersedes ON decisions(supersedes);
`;

/**
 * openDb(baseDir) → an open DatabaseSync at `<baseDir>/knowledge.sqlite3` with the schema
 * ensured, or null. Uses `conversationFts.openNonDisposableDb`: unlike the FTS index, THIS
 * store's facts/decisions have nothing to rebuild from, so a corrupt file returns null (a
 * surfaced failure) rather than being silently wiped — and `decisions.supersedes`'s foreign-key
 * enforcement is verified, not just requested, before this ever returns a usable handle.
 */
export function openDb(baseDir) {
  if (baseDir == null) return null;
  return openNonDisposableDb(path.join(String(baseDir), KNOWLEDGE_DB_FILE), SCHEMA_SQL);
}

/**
 * addFact(db, { kind = "fact", text, conversationId, turnKind, turnNumber, at }) → the inserted
 * row, or null if `text` is empty or provenance doesn't validate. `kind` is a free-form
 * discriminator ("fact" | "convention" | ...); nothing here enumerates it.
 */
export function addFact(db, opts = {}) {
  try {
    if (!db) return null;
    const text = typeof opts.text === "string" ? opts.text.trim() : "";
    if (!text) return null;
    const prov = normalizeProvenance(opts);
    if (!prov) return null;
    const kind = typeof opts.kind === "string" && opts.kind.trim() ? opts.kind.trim() : "fact";
    // Nullable, like `at` — an unscored fact simply never clears Ch.2.3's confidence floor until
    // something scores it (see lib/retrieval.mjs's confidenceFromObservationCount for one way to
    // compute this BEFORE calling addFact; this module does not infer it, to keep storage and
    // scoring separate and avoid a dependency cycle between the two modules).
    const confidence = Number.isFinite(opts.confidence) && opts.confidence >= 0 && opts.confidence <= 1
      ? opts.confidence : null;
    // ECC's own guidance: "when in doubt, default to project — it's safer to be project-specific
    // and promote later than to contaminate the global space."
    const scope = opts.scope === "global" ? "global" : "project";
    const createdAt = Date.now();
    const info = db.prepare(
      `INSERT INTO facts (kind, text, conversationId, turnKind, turnNumber, at, createdAt, confidence, scope)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(kind, text, prov.conversationId, prov.turnKind, prov.turnNumber, prov.at, createdAt, confidence, scope);
    return getFact(db, Number(info.lastInsertRowid));
  } catch {
    return null;
  }
}

/** getFact(db, id) → the row, or null. */
export function getFact(db, id) {
  try {
    if (!db || !Number.isFinite(id)) return null;
    const row = db.prepare("SELECT * FROM facts WHERE id = ?").get(Math.floor(id));
    return row || null;
  } catch {
    return null;
  }
}

/**
 * listFacts(db, { conversationId, kind, limit = 50, includeStale = false }) → rows, newest first.
 * Excludes `status = 'stale'` by default — Ch.2.4: a demoted fact must not be "silently kept
 * authoritative" in ordinary listings (this is also what keeps a stale fact out of
 * `lib/retrieval.mjs`'s `retrieveForContext`, which lists through this same function). Pass
 * `includeStale: true` for the explicit "show me everything, including history" case. Never
 * throws.
 */
export function listFacts(db, opts = {}) {
  try {
    if (!db) return [];
    const { conversationId, kind, limit = 50, includeStale = false } = opts && typeof opts === "object" ? opts : {};
    const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
    const clauses = [];
    const args = [];
    if (conversationId != null) { clauses.push("conversationId = ?"); args.push(String(conversationId)); }
    if (kind != null) { clauses.push("kind = ?"); args.push(String(kind)); }
    if (!includeStale) clauses.push("status != 'stale'");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    args.push(cap);
    return db.prepare(`SELECT * FROM facts ${where} ORDER BY id DESC LIMIT ?`).all(...args);
  } catch {
    return [];
  }
}

/**
 * demoteFact(db, id, { reason }) → the updated (now `status: 'stale'`) row, or null if the fact
 * doesn't exist or is already stale. Nothing is deleted — a stale fact stays fully readable via
 * `getFact` and via `listFacts({ includeStale: true })`; it only drops out of the DEFAULT
 * listing (and therefore out of `retrieveForContext`), which is what "flagged stale, not silently
 * kept authoritative" (plan.md 2.4) means in practice.
 */
export function demoteFact(db, id, opts = {}) {
  try {
    if (!db || !Number.isFinite(id)) return null;
    const fact = getFact(db, id);
    if (!fact || fact.status === "stale") return null;
    const reason = typeof opts.reason === "string" ? opts.reason.trim() : "";
    db.prepare("UPDATE facts SET status = 'stale', staleAt = ?, staleReason = ? WHERE id = ?")
      .run(Date.now(), reason, Math.floor(id));
    return getFact(db, id);
  } catch {
    return null;
  }
}

/** refreshFact(db, id) → the updated (`status: 'active'`, stale markers cleared) row, or null if
 *  the fact doesn't exist or isn't currently stale. The reversal of `demoteFact` — decay is a
 *  reflection of current standing, not a permanent scar. */
export function refreshFact(db, id) {
  try {
    if (!db || !Number.isFinite(id)) return null;
    const fact = getFact(db, id);
    if (!fact || fact.status !== "stale") return null;
    db.prepare("UPDATE facts SET status = 'active', staleAt = NULL, staleReason = '' WHERE id = ?")
      .run(Math.floor(id));
    return getFact(db, id);
  } catch {
    return null;
  }
}

/**
 * addDecision(db, { title, rationale = "", alternatives = [], supersedes = null, conversationId,
 * turnKind, turnNumber, at }) → the inserted row, or null if `title` is empty, provenance doesn't
 * validate, or `supersedes` names a decision that doesn't exist (real FK enforcement — `PRAGMA
 * foreign_keys = ON` is set in `openDb`).
 *
 * Ch.2.4: when `supersedes` names a real decision, THIS is the conflict-resolution moment — the
 * old row's `status` flips to `'superseded'` (`supersededAt` stamped) in the SAME transaction as
 * the new row's insert, so there is never a window where both read as active. Nothing is
 * deleted: the old row stays fully readable via `getDecision` or `listDecisions({
 * includeSuperseded: true })`, it only drops out of the default "current" listing.
 */
export function addDecision(db, opts = {}) {
  try {
    if (!db) return null;
    const title = typeof opts.title === "string" ? opts.title.trim() : "";
    if (!title) return null;
    const prov = normalizeProvenance(opts);
    if (!prov) return null;
    const rationale = typeof opts.rationale === "string" ? opts.rationale : "";
    let alternatives;
    try {
      alternatives = JSON.stringify(opts.alternatives === undefined ? [] : opts.alternatives);
    } catch {
      return null; // uns-serializable alternatives — reject rather than silently drop
    }
    const supersedes = Number.isFinite(opts.supersedes) ? Math.floor(opts.supersedes) : null;
    const createdAt = Date.now();

    db.exec("BEGIN");
    try {
      const info = db.prepare(
        `INSERT INTO decisions
           (title, rationale, alternatives, supersedes, conversationId, turnKind, turnNumber, at, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(title, rationale, alternatives, supersedes, prov.conversationId, prov.turnKind, prov.turnNumber, prov.at, createdAt);
      if (supersedes != null) {
        db.prepare("UPDATE decisions SET status = 'superseded', supersededAt = ? WHERE id = ?")
          .run(createdAt, supersedes);
      }
      db.exec("COMMIT");
      return getDecision(db, Number(info.lastInsertRowid));
    } catch (e) {
      db.exec("ROLLBACK");
      throw e; // includes a FOREIGN KEY constraint failure on a bogus `supersedes`
    }
  } catch {
    return null;
  }
}

/** getDecision(db, id) → the row (with `alternatives` parsed back to a JS value), or null. */
export function getDecision(db, id) {
  try {
    if (!db || !Number.isFinite(id)) return null;
    const row = db.prepare("SELECT * FROM decisions WHERE id = ?").get(Math.floor(id));
    if (!row) return null;
    let alternatives = [];
    try { alternatives = JSON.parse(row.alternatives); } catch { /* leave [] */ }
    return { ...row, alternatives };
  } catch {
    return null;
  }
}

/**
 * listDecisions(db, { conversationId, limit = 50, includeSuperseded = false }) → rows (raw
 * `alternatives` JSON string, NOT parsed — callers that need the parsed value should go through
 * getDecision, or parse it themselves; kept raw here to avoid a per-row JSON.parse on a listing
 * that may just render titles). Newest first. Excludes `status = 'superseded'` by default —
 * Ch.2.4's "current queries" exclusion; pass `includeSuperseded: true` for the explicit history
 * lookup (nothing is deleted, so it's always there to ask for).
 */
export function listDecisions(db, opts = {}) {
  try {
    if (!db) return [];
    const { conversationId, limit = 50, includeSuperseded = false } = opts && typeof opts === "object" ? opts : {};
    const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
    const clauses = [];
    const args = [];
    if (conversationId != null) { clauses.push("conversationId = ?"); args.push(String(conversationId)); }
    if (!includeSuperseded) clauses.push("status != 'superseded'");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    args.push(cap);
    return db.prepare(`SELECT * FROM decisions ${where} ORDER BY id DESC LIMIT ?`).all(...args);
  } catch {
    return [];
  }
}

/**
 * provenanceOf(row) → { conversationId, turnKind, turnNumber, at } from a fact or decision row,
 * or null. Thin accessor so callers don't reach into row internals directly.
 */
export function provenanceOf(row) {
  return sharedProvenanceOf(row);
}

/**
 * resolveText(archiveBaseDir, row) → the ORIGINAL turn text a fact/decision was recorded from,
 * via `conversationArchive.recallByNumber`, or null if it's no longer resolvable (the archive
 * moved, was pruned, or the caller passed the wrong `archiveBaseDir`). `archiveBaseDir` is the
 * caller's responsibility to resolve from `row.conversationId` (see workspace.mjs's
 * `_archiveBaseFor` for the existing pattern) — this module has no opinion on where archives live.
 */
export function resolveText(archiveBaseDir, row) {
  try {
    const prov = provenanceOf(row);
    if (!archiveBaseDir || !prov) return null;
    const hit = recallByNumber(archiveBaseDir, {
      conversationId: prov.conversationId,
      kind: prov.turnKind,
      number: prov.turnNumber,
    });
    return hit ? hit.text : null;
  } catch {
    return null;
  }
}
