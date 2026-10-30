// conversationFts.mjs — a generic, disposable SQLite FTS5 engine used to index rows of text and
// search them by BM25 relevance. `lib/conversationArchive.mjs` uses this to make `recallByQuery`
// real (Wave 2.0 of docs/work/exocortex/plan.md); the schema here has no knowledge of segments,
// JSONL, or conversations — it just indexes `(conversationId, segmentRef, workspaceId, kind,
// number, text, images)` rows and answers relevance queries. That genericity is deliberate: Ch.2.1
// (the durable knowledge/skill store) is expected to reuse this same engine rather than grow a
// second bespoke SQLite setup.
//
// THE SOURCE OF TRUTH STAYS THE RAW JSONL under `_segments/*.jsonl` (per HANDOFF.md). This module's
// database file is a disposable, rebuildable INDEX over that text — delete it and it is rebuilt
// from scratch on next use, exactly like the FTS5 external-content pattern it borrows from Hermes.
//
// ── The incremental-rebuild guard, copied from Hermes exactly ──────────────────────────────────
// (verified against /home/ancientbox/ClaudeWS/_upstream/hermes-agent/hermes_state_common.py:678-767
// and hermes_state_search.py's `fts_rebuild_step`/`_fts_rebuild_finish` — same two `state_meta`
// keys, same predicate, same shape, renamed to this module's table.)
//
// Two `state_meta` keys define which rows of `segment_rows` are currently reflected in the FTS
// index while a rebuild is in progress:
//   fts_rebuild_high_water  H — MAX(id) in `segment_rows` at the moment the FTS index was found
//                                stale/missing and a rebuild began.
//   fts_rebuild_progress    P — highest id the chunked backfill has re-indexed so far.
// A row is indexed iff  id <= P  (already backfilled)  OR  id > H  (written after the rebuild
// started — `id` is AUTOINCREMENT so a brand-new row is always > H, and the live INSERT/DELETE
// triggers index it immediately without waiting for the sweep to reach it). Rows in (P, H] are
// mid-sweep and deliberately NOT touched by the live triggers, else the sweep would double-index
// them when it gets there. When no rebuild is pending, both keys are absent and COALESCE(...,-1)
// turns the predicate into a tautology (id > -1 OR id <= -1) — i.e. normal live-write behavior.
//
// Why this matters and isn't decorative: verified empirically on this machine (Node v22.22.1,
// SQLite 3.46.1) that an external-content FTS5 table does NOT reject a duplicate-rowid write with
// a constraint error the way a self-contained fts5 table does — and firing a `('delete', rowid, …)`
// command for a rowid that was never indexed corrupts the index outright (observed: "database disk
// image is malformed" on the very next read). SQLite will not catch this for you; the id<=P-or->H
// gate is the only thing standing between a concurrent writer and a corrupted index.
//
// ESM, node:sqlite only (no new dependency — see docs/work/exocortex/HANDOFF.md). Every exported
// function guards against bad input and never throws: failures degrade to null/false/[] so a
// caller can fall back to a non-indexed scan rather than propagate a DB error into a chat turn.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// `node:sqlite`'s API is synchronous (DatabaseSync), which is what makes it usable from these
// synchronous, never-throwing functions without restructuring every caller around a promise.
// Loaded via `require` (not a static `import "node:sqlite"`) so a Node build without the builtin
// — or one where it's been disabled — degrades to `loadSqlite() === null` instead of a hard
// failure to even import this file. Loaded once and memoized; failure is memoized too.
const _require = createRequire(import.meta.url);
let _DatabaseSync = null;
let _sqliteLoadFailed = false;
function loadSqlite() {
  if (_DatabaseSync || _sqliteLoadFailed) return _DatabaseSync;
  try {
    _DatabaseSync = _require("node:sqlite").DatabaseSync;
  } catch {
    _sqliteLoadFailed = true;
  }
  return _DatabaseSync;
}

export const FTS_DB_FILE = "_fts.sqlite3";
export const REBUILD_CHUNK_ROWS = 500;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS state_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS segment_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversationId TEXT NOT NULL,
  segmentRef TEXT NOT NULL,
  workspaceId TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  number INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  images INTEGER NOT NULL DEFAULT 0,
  at INTEGER,
  UNIQUE(conversationId, kind, number)
);
CREATE INDEX IF NOT EXISTS idx_segment_rows_segmentRef ON segment_rows(segmentRef);
CREATE INDEX IF NOT EXISTS idx_segment_rows_conv ON segment_rows(conversationId);

CREATE TABLE IF NOT EXISTS segment_sync (
  segmentRef TEXT PRIMARY KEY,
  fingerprint TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS segment_rows_fts USING fts5(
  text,
  content='segment_rows',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS segment_rows_fts_insert AFTER INSERT ON segment_rows
WHEN (new.id > COALESCE((SELECT CAST(value AS INTEGER) FROM state_meta
                         WHERE key = 'fts_rebuild_high_water'), -1)
   OR new.id <= COALESCE((SELECT CAST(value AS INTEGER) FROM state_meta
                          WHERE key = 'fts_rebuild_progress'), -1))
BEGIN
  INSERT INTO segment_rows_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS segment_rows_fts_delete AFTER DELETE ON segment_rows
WHEN (old.id > COALESCE((SELECT CAST(value AS INTEGER) FROM state_meta
                         WHERE key = 'fts_rebuild_high_water'), -1)
   OR old.id <= COALESCE((SELECT CAST(value AS INTEGER) FROM state_meta
                          WHERE key = 'fts_rebuild_progress'), -1))
BEGIN
  INSERT INTO segment_rows_fts(segment_rows_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
`;

// probeFts5() → true iff this SQLite build supports FTS5. Memoized (cheap to call repeatedly,
// but no reason to spin up a throwaway in-memory DB more than once per process). Mirrors Hermes's
// runtime FTS5 capability probe: never assume, always check, degrade quietly if absent.
let _fts5Probe = null;
export function probeFts5() {
  if (_fts5Probe != null) return _fts5Probe;
  const Database = loadSqlite();
  if (!Database) { _fts5Probe = false; return false; }
  try {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE VIRTUAL TABLE _probe USING fts5(x)");
      _fts5Probe = true;
    } finally {
      db.close();
    }
  } catch {
    _fts5Probe = false;
  }
  return _fts5Probe;
}

/**
 * openDatabaseFile(dbPath, schemaSql, { recreateOnCorruption = true }) → an open DatabaseSync
 * with `schemaSql` applied, or null. Never throws.
 *
 * On a corrupt/unopenable existing file: `new Database(dbPath)` SUCCEEDS even against a garbage
 * file (verified empirically — only the schema `exec()` throws, "file is not a database"), so the
 * failure surfaces one statement later than you'd guess, and the half-open handle from that
 * failed attempt is closed before anything else happens — leaving it open would leak an fd (and
 * that file's disk blocks once unlinked below) on every corruption-recovery cycle.
 *
 * `recreateOnCorruption` (default true) governs what happens next: delete the corrupt file and
 * retry ONCE with a fresh one. That default is correct for a DISPOSABLE, rebuildable-from-source
 * store (this module's own FTS index — a degraded index must not silently serve reads forever,
 * and rebuilding from `_segments/*.jsonl` is always safe). It is WRONG for a store that IS the
 * source of truth: `lib/knowledgeStore.mjs`'s facts/decisions and `lib/skillStore.mjs`'s
 * skills/skill_runs have nothing to rebuild from, so silently wiping a corrupt file there would
 * be silent, permanent, unsignaled data loss — those callers pass `recreateOnCorruption: false`
 * and get `null` (a surfaced failure) instead of a quietly-emptied store.
 *
 * Deliberately generic and exported: this is the "engine" other stores are meant to reuse rather
 * than growing their own sqlite-loading/corruption-recovery boilerplate (see `lib/knowledgeStore.mjs`,
 * Ch.2.1) — this function has no idea what `schemaSql` contains, so it does NOT gate on FTS5
 * support; only a caller whose own schema needs a virtual table should probe first (see `openDb`
 * below, which does exactly that for this module's own FTS5 schema).
 */
export function openDatabaseFile(dbPath, schemaSql, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const recreateOnCorruption = o.recreateOnCorruption !== false;
  const Database = loadSqlite();
  if (!Database || !dbPath) return null;
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  } catch {
    return null;
  }
  const tryOpen = () => {
    const db = new Database(dbPath);
    try {
      db.exec(schemaSql);
    } catch (e) {
      try { db.close(); } catch { /* best effort */ }
      throw e;
    }
    return db;
  };
  try {
    return tryOpen();
  } catch {
    if (!recreateOnCorruption) return null; // preserve the file — a non-disposable store must never be silently wiped
    try {
      fs.rmSync(dbPath, { force: true });
      return tryOpen();
    } catch {
      return null;
    }
  }
}

/**
 * openNonDisposableDb(dbPath, schemaSql) → an open DatabaseSync with real foreign-key
 * enforcement VERIFIED (not just requested), or null. The shared opener for stores that ARE the
 * source of truth (lib/knowledgeStore.mjs's facts/decisions, lib/skillStore.mjs's
 * skills/skill_versions/skill_runs) — unlike this module's own `openDb`, corruption is never
 * silently repaired by wiping the file (`recreateOnCorruption: false`), and `PRAGMA foreign_keys
 * = ON` is followed by a `PRAGMA foreign_keys` read-back: if it didn't actually take, that store's
 * documented FK guarantees (e.g. a decision's `supersedes` rejecting a dangling id) would
 * silently stop being enforced with no way for a caller to notice — treated here as an open
 * failure (null) rather than continuing in a degraded, unsignaled state.
 */
export function openNonDisposableDb(dbPath, schemaSql) {
  const db = openDatabaseFile(dbPath, schemaSql, { recreateOnCorruption: false });
  if (!db) return null;
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const row = db.prepare("PRAGMA foreign_keys").get();
    if (!row || Number(row.foreign_keys) !== 1) {
      db.close();
      return null;
    }
  } catch {
    try { db.close(); } catch { /* best effort */ }
    return null;
  }
  return db;
}

/**
 * openDb(baseDir) → an open DatabaseSync with THIS module's FTS5 schema ensured, or null.
 * Gates on `probeFts5()` first — this schema declares a virtual table, so a SQLite build without
 * FTS5 must not even attempt it (see `openDatabaseFile` for the FTS5-agnostic generic opener).
 */
export function openDb(baseDir) {
  if (!probeFts5() || baseDir == null) return null;
  return openDatabaseFile(path.join(String(baseDir), "_segments", FTS_DB_FILE), SCHEMA_SQL);
}

/** currentMaxId(db) → the highest `id` in segment_rows, 0 if empty. */
export function currentMaxId(db) {
  try {
    const row = db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM segment_rows").get();
    return row && Number.isFinite(row.m) ? row.m : 0;
  } catch {
    return 0;
  }
}

/**
 * upsertRow(db, { conversationId, segmentRef, workspaceId, kind, number, text, images, at })
 * `at` (epoch ms) is nullable — carried forward from the source row's own timestamp when present,
 * never required (see docs/work/exocortex/plan.md 2.1 for why: real data always has it, but the
 * column stays defensive rather than assume that forever).
 * INSERT OR REPLACE keyed on (conversationId, kind, number). A REPLACE deletes the conflicting
 * row first (firing the guarded DELETE trigger) then inserts fresh (firing the guarded INSERT
 * trigger) — verified empirically to keep the FTS index in sync across the replace, not just the
 * content table. Never throws.
 */
export function upsertRow(db, row) {
  try {
    if (!db || !row) return false;
    // `number` is part of the UNIQUE(conversationId, kind, number) key — silently defaulting a
    // missing/non-finite one to 0 would make two genuinely distinct malformed rows for the same
    // (conversationId, kind) collide via INSERT OR REPLACE, silently overwriting one with the
    // other. Reject instead: the current sole caller (conversationArchive.mjs's segmentFtsRows)
    // always computes a real sequential number, so this only ever fires for a future caller
    // passing bad data — exactly when failing loudly beats losing a row quietly.
    if (!Number.isFinite(row.number)) return false;
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO segment_rows
         (conversationId, segmentRef, workspaceId, kind, number, text, images, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      String(row.conversationId ?? ""),
      String(row.segmentRef ?? ""),
      String(row.workspaceId ?? ""),
      String(row.kind ?? ""),
      Math.floor(row.number),
      String(row.text ?? ""),
      Number.isFinite(row.images) ? Math.floor(row.images) : 0,
      Number.isFinite(row.at) ? Math.floor(row.at) : null, // nullable — see the schema comment
    );
    return true;
  } catch {
    return false;
  }
}

/** deleteSegment(db, segmentRef) — removes every row belonging to a segmentRef (used before
 *  re-inserting a re-archived segment's rows fresh, so a segment that shrank doesn't leave stale
 *  rows behind). Fires the guarded DELETE trigger per row. Never throws. */
export function deleteSegment(db, segmentRef) {
  try {
    if (!db || !segmentRef) return;
    db.prepare("DELETE FROM segment_rows WHERE segmentRef = ?").run(String(segmentRef));
  } catch { /* best effort */ }
}

/** getSyncFingerprint(db, segmentRef) → the fingerprint recorded the last time this segmentRef's
 *  JSONL was replayed into segment_rows, or null if never synced. A fingerprint is an opaque
 *  caller-chosen string (conversationArchive.mjs uses `mtimeMs:size`) — mtime ALONE is not
 *  trustworthy on every filesystem's timestamp resolution, so this module doesn't assume a shape. */
export function getSyncFingerprint(db, segmentRef) {
  try {
    const row = db.prepare("SELECT fingerprint FROM segment_sync WHERE segmentRef = ?").get(String(segmentRef));
    return row && typeof row.fingerprint === "string" ? row.fingerprint : null;
  } catch {
    return null;
  }
}

/** setSyncFingerprint(db, segmentRef, fingerprint) — records that a segmentRef's JSONL (as of
 *  this fingerprint) has been fully replayed into segment_rows. */
export function setSyncFingerprint(db, segmentRef, fingerprint) {
  try {
    db.prepare(
      "INSERT INTO segment_sync (segmentRef, fingerprint) VALUES (?, ?) " +
      "ON CONFLICT(segmentRef) DO UPDATE SET fingerprint = excluded.fingerprint"
    ).run(String(segmentRef), String(fingerprint ?? ""));
  } catch { /* best effort */ }
}

function getMeta(db, key) {
  try {
    const row = db.prepare("SELECT value FROM state_meta WHERE key = ?").get(key);
    return row ? row.value : null;
  } catch {
    return null;
  }
}
function setMeta(db, key, value) {
  db.prepare(
    "INSERT INTO state_meta (key, value) VALUES (?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}
function clearRebuildMeta(db) {
  db.prepare("DELETE FROM state_meta WHERE key IN ('fts_rebuild_high_water', 'fts_rebuild_progress')").run();
}

/**
 * seedRebuildMarkers(db, { force = false }) → H (int)
 *
 * Declares "the FTS index may be missing rows up to the current content high-water mark; a
 * chunked rebuild is now pending." Sets H = MAX(id) in segment_rows right now, P = 0. Only call
 * this when there is a KNOWN gap between segment_rows (content) and segment_rows_fts (index) —
 * e.g. after wiping the index to recover from detected staleness/corruption. Calling this
 * routinely with no real gap is wrong: it would make the live triggers skip rows in (0, H] that
 * are already correctly indexed, until a rebuild sweep re-covers them.
 *
 * `force` re-seeds even if markers already exist (used by rebuildFromScratch after wiping).
 * Without `force`, an existing high-water is left alone and only a missing `progress` key (a
 * torn write from a previous crash) is repaired to '0' — mirrors Hermes's `_seed_fts_rebuild_markers`.
 */
export function seedRebuildMarkers(db, { force = false } = {}) {
  const existing = getMeta(db, "fts_rebuild_high_water");
  if (existing != null && !force) {
    if (getMeta(db, "fts_rebuild_progress") == null) setMeta(db, "fts_rebuild_progress", "0");
    return Number(existing) || 0;
  }
  const h = currentMaxId(db);
  setMeta(db, "fts_rebuild_high_water", String(h));
  setMeta(db, "fts_rebuild_progress", "0");
  return h;
}

/** rebuildStatus(db) → { pending, total, indexed, percent } | null (null = no rebuild pending). */
export function rebuildStatus(db) {
  try {
    const hRaw = getMeta(db, "fts_rebuild_high_water");
    if (hRaw == null) return null;
    const total = Number(hRaw) || 0;
    const indexed = Number(getMeta(db, "fts_rebuild_progress") || 0) || 0;
    if (total <= 0) return null;
    const percent = Math.min(100, Math.floor((100 * indexed) / total));
    return { pending: true, total, indexed, percent };
  } catch {
    return null;
  }
}

/**
 * rebuildStep(db, { chunkRows }) → true while more work remains, false when done/nothing pending.
 * Backfills ONE chunk: rows with id in (P, min(P+chunkRows, H)] get inserted straight into
 * segment_rows_fts (bypassing the live trigger, which is exactly why it's safe — those ids are
 * excluded from the trigger's predicate while progress hasn't reached them yet, so this is the
 * only writer touching them). Mirrors Hermes's `fts_rebuild_step` chunk shape.
 */
export function rebuildStep(db, { chunkRows = REBUILD_CHUNK_ROWS } = {}) {
  try {
    const hRaw = getMeta(db, "fts_rebuild_high_water");
    if (hRaw == null) return false;
    const high = Number(hRaw) || 0;
    const pRaw = getMeta(db, "fts_rebuild_progress");
    if (pRaw == null) return false; // cleared/finished already
    const progress = Number(pRaw) || 0;
    if (progress >= high) { finishRebuild(db); return false; }

    const upper = Math.min(progress + chunkRows, high);
    db.prepare(
      "INSERT INTO segment_rows_fts(rowid, text) SELECT id, text FROM segment_rows WHERE id > ? AND id <= ?"
    ).run(progress, upper);
    setMeta(db, "fts_rebuild_progress", String(upper));

    if (upper >= high) { finishRebuild(db); return false; }
    return true;
  } catch {
    return false;
  }
}

/** finishRebuild(db) — boundary sweep (catches any row right at H that a concurrent writer landed
 *  mid-migration, via an anti-join so nothing already indexed is touched twice) then clears the
 *  rebuild markers, returning triggers to tautology (normal live-write) mode. */
export function finishRebuild(db) {
  try {
    const hRaw = getMeta(db, "fts_rebuild_high_water");
    if (hRaw != null) {
      const h = Number(hRaw) || 0;
      // `<table>_docsize` is an FTS5 shadow table with exactly one row per rowid actually IN the
      // index — the anti-join finds any row the chunked steps should have covered (id <= H) but
      // somehow didn't (e.g. a step's transaction died between the INSERT and the progress write).
      db.prepare(
        `INSERT INTO segment_rows_fts(rowid, text)
         SELECT sr.id, sr.text FROM segment_rows sr
         WHERE sr.id <= ?
           AND NOT EXISTS (SELECT 1 FROM segment_rows_fts_docsize d WHERE d.id = sr.id)`
      ).run(h);
    }
  } catch {
    // Best-effort insurance sweep; absence of the shadow table on some SQLite build must not
    // block clearing the markers below.
  }
  try { clearRebuildMeta(db); } catch { /* best effort */ }
}

/**
 * rebuildFromScratch(db, { chunkRows }) — full recovery path: wipe the inverted index, seed fresh
 * markers over the CURRENT content table, then chunk to completion within this call. Bounded by
 * this install's corpus size (a few MB of conversation text, per HANDOFF) so "within this call" is
 * cheap in practice; the chunking exists for safety (a concurrent new archive during the wipe/
 * reseed window is still indexed correctly, live, via id > H) and as insurance if a corpus ever
 * grows past what one call should block on.
 */
export function rebuildFromScratch(db, { chunkRows = REBUILD_CHUNK_ROWS } = {}) {
  try {
    db.exec("INSERT INTO segment_rows_fts(segment_rows_fts) VALUES('delete-all')");
  } catch { /* table may already be empty */ }
  seedRebuildMarkers(db, { force: true });
  let guard = 0;
  while (rebuildStep(db, { chunkRows }) && guard < 100000) guard++;
}

/**
 * search(db, { conversationId, query, limit }) → [{ id, segmentRef, workspaceId, kind, number,
 * text, images, at }], ranked by BM25 (best match first), ties broken by `id` descending (a proxy for
 * recency — rows are synced in archive order, and a replaced row gets a fresh, higher id — so
 * equally-relevant hits still surface the newer one first, matching the old scan's newest-first
 * behavior). The whole query is treated as one quoted phrase so arbitrary user input (punctuation,
 * FTS5 operator characters) can never be interpreted as query syntax.
 */
export function search(db, { conversationId, query, limit = 10 } = {}) {
  try {
    const needle = typeof query === "string" ? query.trim() : "";
    if (!needle || !db) return [];
    const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
    const phrase = `"${needle.replace(/"/g, '""')}"`;
    const cid = conversationId == null ? null : String(conversationId);
    const stmt = db.prepare(
      `SELECT sr.id AS id, sr.segmentRef AS segmentRef, sr.workspaceId AS workspaceId,
              sr.kind AS kind, sr.number AS number, sr.text AS text, sr.images AS images,
              sr.at AS at
       FROM segment_rows_fts
       JOIN segment_rows sr ON sr.id = segment_rows_fts.rowid
       WHERE segment_rows_fts MATCH ?
         AND (? IS NULL OR sr.conversationId = ?)
       ORDER BY bm25(segment_rows_fts) ASC, sr.id DESC
       LIMIT ?`
    );
    return stmt.all(phrase, cid, cid, cap);
  } catch {
    return [];
  }
}
