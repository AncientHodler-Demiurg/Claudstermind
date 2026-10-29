// conversationArchive.mjs — persists a rolled-off "head" segment to disk and lets it be
// recalled later. This is what makes conversations immortal: when a conversation rolls
// (see lib/conversationRoll.mjs), the OLD "head" turns leave the active window but live on
// as JSONL segments here, retrievable by absolute P#/R# number or by substring query.
//
// Per docs/AGENTIC-CHAT-ENGINE.md §1 (recall) + §2 (segment/archive index).
//
// Layout under a base dir:
//   <baseDir>/_segments/<sanitized segmentRef>.jsonl   — the head rows, one JSON row per line
//   <baseDir>/_segments/_index.json                    — array of index entries (the turn# → segment map)
//
// Row model (from lib/conversationWindow.mjs): role:"user" = prompt, role:"assistant" = response.
// segmentRef format (from lib/conversationRoll.mjs): "<conversationId>#seg<n>".
//
// ESM, node builtins only. Every function guards against bad input and NEVER throws:
// bad/missing input yields null or []. Nothing here calls Date — callers pass `at`.

import fs from "node:fs";
import path from "node:path";

import {
  openDb as openFtsDb,
  upsertRow as ftsUpsertRow,
  deleteSegment as ftsDeleteSegment,
  getSyncFingerprint as ftsGetSyncFingerprint,
  setSyncFingerprint as ftsSetSyncFingerprint,
  search as ftsSearch,
} from "./conversationFts.mjs";
import { SEGMENTS_SUBDIR } from "./storage.mjs";

// Ch.1.1: the literal subdirectory name now lives in lib/storage.mjs (SEGMENTS_SUBDIR) — kept as
// its own export here, same name, same value, so every existing importer (lib/workspace.mjs)
// keeps working unchanged.
export const SEG_DIR = SEGMENTS_SUBDIR;
const INDEX_FILE = "_index.json";

// segmentRef("conv-1", 0) → "conv-1#seg0" (mirrors conversationRoll.segmentRef).
function makeSegmentRef(conversationId, n) {
  const id = conversationId == null ? "" : String(conversationId);
  const seq = Number.isFinite(n) ? Math.floor(n) : 0;
  return `${id}#seg${seq}`;
}

// Deterministic, filesystem-safe filename derived from a segmentRef. Same ref → same file,
// which is what makes re-archiving overwrite in place rather than duplicate.
function sanitize(segmentRef) {
  return String(segmentRef).replace(/[^A-Za-z0-9._-]/g, "_");
}

function segDir(baseDir) {
  return path.join(String(baseDir), SEG_DIR);
}

function indexPath(baseDir) {
  return path.join(segDir(baseDir), INDEX_FILE);
}

function rowRole(row) {
  if (!row || typeof row !== "object") return null;
  if (row.role === "user" || row.role === "assistant") return row.role;
  return null;
}

function rowText(row) {
  return row && typeof row.text === "string" ? row.text : "";
}

/** The row's own timestamp (epoch ms), as workspace.mjs stamps every turn (`at: Date.now()`,
 *  present on every row in real data — see docs/work/exocortex/plan.md 2.1). Nullable: a row
 *  missing it is not treated as an error, only as "timestamp unknown". */
function rowAt(row) {
  return row && Number.isFinite(row.at) ? Math.floor(row.at) : null;
}

/** The image references a row carries, as the store writes them: `{ path, hash, mediaType }`,
 *  where `path` is relative to the WORKSPACE'S OWN dir (see workspaceStore.saveImage) — NOT to
 *  the archive dir and NOT absolute. So an archived row's images are only resolvable if the
 *  reader also knows which workspace the segment belongs to; that is why every index entry
 *  (and every recall result) carries `workspaceId`. Malformed entries are dropped, never thrown. */
function rowImages(row) {
  if (!row || !Array.isArray(row.images)) return [];
  const out = [];
  for (const im of row.images) {
    if (!im || typeof im !== "object") continue;
    const p = typeof im.path === "string" ? im.path : "";
    if (!p) continue;
    out.push({ path: p, hash: typeof im.hash === "string" ? im.hash : "", mediaType: typeof im.mediaType === "string" ? im.mediaType : "" });
  }
  return out;
}

/**
 * archiveSegment(baseDir, { conversationId, n, rows, summary, promptOffset = 0, responseOffset = 0, at })
 *   → the upserted index entry, or null on failure.
 *
 * Writes `rows` (the head turns) as JSONL and upserts an index entry keyed by segmentRef.
 * Idempotent per segmentRef: re-archiving overwrites both the JSONL file and its own index
 * entry (never duplicates). `at` is an optional ISO string; the `at` field is omitted when absent.
 *
 * Ranges are ABSOLUTE P#/R# positions in the full conversation:
 *   promptStart   = promptOffset + 1
 *   promptEnd     = promptOffset + (# user rows)
 *   responseStart = responseOffset + 1
 *   responseEnd   = responseOffset + (# assistant rows)
 * (When a kind has 0 rows, end < start, i.e. an empty range that contains no number.)
 */
export function archiveSegment(baseDir, opts = {}) {
  try {
    if (baseDir == null) return null;
    const {
      conversationId,
      workspaceId,
      n,
      rows,
      summary,
      promptOffset = 0,
      responseOffset = 0,
      at,
    } = opts && typeof opts === "object" ? opts : {};

    const arr = Array.isArray(rows) ? rows : [];
    const segmentRef = makeSegmentRef(conversationId, n);
    const pOff = Number.isFinite(promptOffset) ? Math.floor(promptOffset) : 0;
    const rOff = Number.isFinite(responseOffset) ? Math.floor(responseOffset) : 0;

    let prompts = 0;
    let responses = 0;
    let images = 0;
    let wsFromRows = "";
    for (const row of arr) {
      const role = rowRole(row);
      if (role === "user") prompts++;
      else if (role === "assistant") responses++;
      images += rowImages(row).length;
      // A persisted turn stamps its own `workspaceId` (see workspace.mjs `_persist`), so even when
      // the caller doesn't pass one we can recover it from the rows — which is what makes an OLD
      // archive (written before this field existed) still resolvable for images.
      if (!wsFromRows && row && typeof row.workspaceId === "string" && row.workspaceId) wsFromRows = row.workspaceId;
    }

    const dir = segDir(baseDir);
    fs.mkdirSync(dir, { recursive: true });

    const fileName = `${sanitize(segmentRef)}.jsonl`;
    const filePath = path.join(dir, fileName);
    const jsonl = arr.map((row) => {
      try {
        return JSON.stringify(row);
      } catch {
        return "null";
      }
    }).join("\n");
    fs.writeFileSync(filePath, arr.length ? jsonl + "\n" : "", "utf8");

    const entry = {
      segmentRef,
      conversationId: conversationId == null ? "" : String(conversationId),
      // Which workspace's `images/` dir an archived row's image `path` is relative to. Explicit
      // from the caller, else recovered from the rows' own stamp, else "" (unresolvable images).
      workspaceId: workspaceId == null || workspaceId === "" ? wsFromRows : String(workspaceId),
      n: Number.isFinite(n) ? Math.floor(n) : 0,
      path: filePath,
      // The bare filename too, so an index whose absolute `path` went stale (the archive dir was
      // moved — see migrateLegacyRootSegments) still resolves relative to the index's own dir.
      file: fileName,
      rows: arr.length,
      images,
      promptStart: pOff + 1,
      promptEnd: pOff + prompts,
      responseStart: rOff + 1,
      responseEnd: rOff + responses,
      summary: typeof summary === "string" ? summary : "",
    };
    if (typeof at === "string" && at) entry.at = at;

    // Upsert into the index (overwrite own entry, keep order otherwise).
    const index = readIndex(baseDir);
    const at_i = index.findIndex((e) => e && e.segmentRef === segmentRef);
    if (at_i >= 0) index[at_i] = entry;
    else index.push(entry);
    fs.writeFileSync(indexPath(baseDir), JSON.stringify(index, null, 2), "utf8");

    return entry;
  } catch {
    return null;
  }
}

/** readIndex(baseDir) → array of index entries ([] if none/corrupt). */
export function readIndex(baseDir) {
  try {
    if (baseDir == null) return [];
    const raw = fs.readFileSync(indexPath(baseDir), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Where an index entry's JSONL actually lives NOW. Prefers `<baseDir>/_segments/<file>` (which
 *  survives the archive dir being moved) and only falls back to the recorded absolute `path` —
 *  the reverse would break every entry written before a migration. */
function segmentFileOf(baseDir, entry) {
  const file = entry && typeof entry.file === "string" && entry.file ? entry.file : null;
  if (file) {
    const local = path.join(segDir(baseDir), file);
    if (fs.existsSync(local)) return local;
  }
  if (entry && typeof entry.segmentRef === "string") {
    const derived = path.join(segDir(baseDir), `${sanitize(entry.segmentRef)}.jsonl`);
    if (fs.existsSync(derived)) return derived;
  }
  return entry && typeof entry.path === "string" ? entry.path : "";
}

// Read a segment's JSONL file back into an array of rows (guarded; [] on any failure).
function readSegmentRows(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const out = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed));
      } catch {
        // skip corrupt line
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * recallByNumber(baseDir, { conversationId, kind, number })
 *   → { segmentRef, kind, number, text, images, at, row } | null
 *
 * Finds the archived turn of `kind` ("prompt"|"response") at ABSOLUTE number `number`,
 * locating the segment whose range contains it and reading that segment back.
 */
export function recallByNumber(baseDir, opts = {}) {
  try {
    const { conversationId, kind, number } = opts && typeof opts === "object" ? opts : {};
    if (kind !== "prompt" && kind !== "response") return null;
    const num = Number.isFinite(number) ? Math.floor(number) : NaN;
    if (!(num >= 1)) return null;
    const wantRole = kind === "prompt" ? "user" : "assistant";
    const cid = conversationId == null ? null : String(conversationId);

    const index = readIndex(baseDir);
    for (const entry of index) {
      if (!entry || typeof entry !== "object") continue;
      if (cid != null && String(entry.conversationId) !== cid) continue;
      const start = kind === "prompt" ? entry.promptStart : entry.responseStart;
      const end = kind === "prompt" ? entry.promptEnd : entry.responseEnd;
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (num < start || num > end) continue;

      const rows = readSegmentRows(segmentFileOf(baseDir, entry));
      // The (num - start + 1)-th row of the wanted role within this segment.
      const ordinal = num - start + 1;
      let seen = 0;
      for (const row of rows) {
        if (rowRole(row) === wantRole) {
          seen++;
          if (seen === ordinal) {
            return { segmentRef: entry.segmentRef, workspaceId: entry.workspaceId || "",
              kind, number: num, text: rowText(row), images: rowImages(row), at: rowAt(row), row };
          }
        }
      }
      return null; // range said it's here but the row is missing → no match
    }
    return null;
  } catch {
    return null;
  }
}

// Extract a ~160-char snippet centred on the (lowercased) hit within text.
function makeSnippet(text, needleLower) {
  const hay = String(text);
  const idx = hay.toLowerCase().indexOf(needleLower);
  if (idx < 0) return "";
  const WIDTH = 160;
  const half = Math.floor((WIDTH - needleLower.length) / 2);
  let start = Math.max(0, idx - Math.max(0, half));
  let end = Math.min(hay.length, start + WIDTH);
  start = Math.max(0, end - WIDTH); // pull left if we hit the right edge
  let snippet = hay.slice(start, end);
  if (start > 0) snippet = "…" + snippet;
  if (end < hay.length) snippet = snippet + "…";
  return snippet;
}

// Every row of an archived segment, shaped for the FTS content table (absolute kind+number
// already resolved from the entry's own P#/R# start, same arithmetic recallByQueryScan used).
function* segmentFtsRows(baseDir, entry) {
  const rows = readSegmentRows(segmentFileOf(baseDir, entry));
  let prompts = 0;
  let responses = 0;
  const pStart = Number.isFinite(entry.promptStart) ? entry.promptStart : 1;
  const rStart = Number.isFinite(entry.responseStart) ? entry.responseStart : 1;
  for (const row of rows) {
    const role = rowRole(row);
    if (role === "user") prompts++;
    else if (role === "assistant") responses++;
    else continue;
    yield {
      conversationId: entry.conversationId,
      segmentRef: entry.segmentRef,
      workspaceId: entry.workspaceId || "",
      kind: role === "user" ? "prompt" : "response",
      number: role === "user" ? pStart + prompts - 1 : rStart + responses - 1,
      text: rowText(row),
      images: rowImages(row).length,
      at: rowAt(row),
    };
  }
}

/**
 * Replays any archived segment whose JSONL has changed (by mtime+size fingerprint) since it was
 * last mirrored into the FTS content table — new segments included, since they've never been
 * synced at all.
 * A changed segmentRef is fully deleted and re-inserted (never patched in place), matching
 * archiveSegment's own "re-archiving overwrites, never duplicates" contract exactly, so a segment
 * that shrank on re-archive doesn't leave stale rows/hits behind. Never throws.
 *
 * Staleness fingerprint is `mtimeMs:size`, not mtime alone — a bare mtime is only as trustworthy
 * as the filesystem's timestamp resolution, and two `writeFileSync` calls back-to-back (exactly
 * what a quick re-archive is) are not guaranteed to land in different ticks on every filesystem.
 * Size changes almost always accompany a genuine content change for this data (JSONL rows), so
 * the pair is cheap insurance against silently serving stale content from a same-tick rewrite.
 */
function syncArchiveIntoFts(db, baseDir) {
  try {
    for (const entry of readIndex(baseDir)) {
      if (!entry || typeof entry !== "object" || !entry.segmentRef) continue;
      const file = segmentFileOf(baseDir, entry);
      let stat;
      try { stat = fs.statSync(file); } catch { continue; } // segment file missing — nothing to sync
      const fingerprint = `${stat.mtimeMs}:${stat.size}`;
      if (ftsGetSyncFingerprint(db, entry.segmentRef) === fingerprint) continue; // unchanged since last sync

      ftsDeleteSegment(db, entry.segmentRef);
      for (const row of segmentFtsRows(baseDir, entry)) ftsUpsertRow(db, row);
      ftsSetSyncFingerprint(db, entry.segmentRef, fingerprint);
    }
  } catch { /* best effort — a partial sync still serves whatever it managed to index */ }
}

// Fallback substring scan — kept verbatim as the pre-FTS behavior. Used when node:sqlite/FTS5
// is unavailable (degrade quietly rather than serve nothing, per Hermes's LIKE-fallback pattern),
// so this module works the same on a Node build without SQLite as it did before this slice.
function recallByQueryScan(baseDir, { conversationId, needle, needleLower, cap }) {
  const index = readIndex(baseDir)
    .filter((e) => e && typeof e === "object" && (conversationId == null || String(e.conversationId) === conversationId))
    .sort((a, b) => (Number.isFinite(b.n) ? b.n : 0) - (Number.isFinite(a.n) ? a.n : 0));

  const out = [];
  for (const entry of index) {
    for (const row of segmentFtsRows(baseDir, entry)) {
      if (!row.text.toLowerCase().includes(needleLower)) continue;
      out.push({ segmentRef: row.segmentRef, workspaceId: row.workspaceId,
        kind: row.kind, number: row.number, snippet: makeSnippet(row.text, needleLower), images: row.images, at: row.at });
      if (out.length >= cap) return out;
    }
  }
  return out;
}

/**
 * recallByQuery(baseDir, { conversationId, query, limit = 10 })
 *   → [{ segmentRef, kind, number, snippet, images, at }]
 *
 * SQLite FTS5 (BM25-ranked) search over archived segment rows' text (user + assistant), replayed
 * from the `_segments/*.jsonl` already on disk into a disposable index (see lib/conversationFts.mjs)
 * — same source of truth, same function signature, no embeddings. Falls back to the original
 * linear substring scan if FTS5 is unavailable in this SQLite build, so degraded capability never
 * means degraded correctness, only degraded ranking.
 */
export function recallByQuery(baseDir, opts = {}) {
  try {
    const { conversationId, query, limit = 10 } = opts && typeof opts === "object" ? opts : {};
    const needle = typeof query === "string" ? query.trim() : "";
    if (!needle) return [];
    const needleLower = needle.toLowerCase();
    const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
    const cid = conversationId == null ? null : String(conversationId);

    const db = openFtsDb(baseDir);
    if (db) {
      try {
        syncArchiveIntoFts(db, baseDir);
        const hits = ftsSearch(db, { conversationId: cid, query: needle, limit: cap });
        return hits.map((r) => {
          const snippet = makeSnippet(r.text, needleLower);
          return {
            segmentRef: r.segmentRef,
            workspaceId: r.workspaceId || "",
            kind: r.kind,
            number: r.number,
            snippet: snippet || (r.text.length > 160 ? r.text.slice(0, 160) + "…" : r.text),
            images: r.images,
            at: Number.isFinite(r.at) ? r.at : null,
          };
        });
      } finally {
        try { db.close(); } catch { /* best effort */ }
      }
    }
    return recallByQueryScan(baseDir, { conversationId: cid, needle, needleLower, cap });
  } catch {
    return [];
  }
}

/**
 * readAllArchivedRows(baseDir) → every row across every archived segment for this base dir, in
 * index order (segment order, then row order within each segment). Unlike recallByNumber/
 * recallByQuery, this doesn't index by kind/number at all — it exists for consumers that need to
 * know EVERYTHING an archive references, not to answer a specific lookup. First use: Wave 0.1's
 * image GC (lib/imageGc.mjs) needs every archived row's `images` array to know which hashes an
 * archived segment still references, so a live-and-archived image is never swept as dead. Never
 * throws; a segment that fails to read is skipped, not fatal to the rest.
 */
export function readAllArchivedRows(baseDir) {
  try {
    const out = [];
    for (const entry of readIndex(baseDir)) {
      if (!entry || typeof entry !== "object") continue;
      try {
        for (const row of readSegmentRows(segmentFileOf(baseDir, entry))) out.push(row);
      } catch { /* skip this segment, keep going */ }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * migrateLegacyRootSegments(transcriptDir, dirFor) → { moved, entries, skipped }
 *
 * ONE-TIME BACKFILL. Earlier builds archived rolled-off head segments to the transcript ROOT
 * (`<transcriptDir>/_segments/`) instead of inside the owning workspace's own directory. Two
 * things are wrong with a root archive, and both are live on a real install:
 *
 *   1. `workspaceStore.eachSession` enumerates every top-level directory as a workspace, so the
 *      archive shows up in History as a bogus "_segments" conversation — and, if the segment's
 *      FIRST row happens to carry a `workspaceId` stamp, `readWorkspace` merges the whole
 *      rolled-off head straight back into that workspace's transcript, duplicating it.
 *   2. Archived rows keep image references (`images/<hash>.<ext>`) that are relative to the
 *      WORKSPACE dir. Sitting at the root, an archived turn's images cannot be resolved at all.
 *
 * Moving each segment into `dirFor(workspaceId)/_segments/` fixes both. The destination is
 * derived per entry from its `workspaceId` (recorded, or recovered from the rows' own stamps).
 * Entries with no resolvable workspace are LEFT ALONE (never guessed at, never deleted).
 *
 * Idempotent and non-destructive: a segment already present at the destination is not re-copied,
 * and the source file is only unlinked once the copy is verified. Never throws.
 *
 * @param {string} transcriptDir the `.claude/workspace` root
 * @param {(workspaceId:string)=>string} dirFor maps a workspace id to its own base directory
 */
export function migrateLegacyRootSegments(transcriptDir, dirFor) {
  const out = { moved: 0, entries: 0, skipped: 0 };
  try {
    if (!transcriptDir || typeof dirFor !== "function") return out;
    const rootSeg = segDir(transcriptDir);
    if (!fs.existsSync(rootSeg)) return out;
    const index = readIndex(transcriptDir);
    const leftovers = [];
    for (const entry of index) {
      if (!entry || typeof entry !== "object") { out.skipped++; continue; }
      out.entries++;
      const src = segmentFileOf(transcriptDir, entry);
      // Recover the owning workspace: the recorded field first, else the rows' own stamp.
      let wid = typeof entry.workspaceId === "string" && entry.workspaceId ? entry.workspaceId : "";
      const rows = readSegmentRows(src);
      if (!wid) {
        for (const row of rows) {
          if (row && typeof row.workspaceId === "string" && row.workspaceId) { wid = row.workspaceId; break; }
        }
      }
      if (!wid) { leftovers.push(entry); out.skipped++; continue; }   // unknown owner — leave it exactly where it is
      let base = "";
      try { base = dirFor(wid); } catch { base = ""; }
      if (!base) { leftovers.push(entry); out.skipped++; continue; }
      // Re-archive into the workspace's own dir, preserving every recorded range/summary field.
      const written = archiveSegment(base, {
        conversationId: entry.conversationId, workspaceId: wid, n: entry.n, rows, summary: entry.summary,
        promptOffset: (Number.isFinite(entry.promptStart) ? entry.promptStart : 1) - 1,
        responseOffset: (Number.isFinite(entry.responseStart) ? entry.responseStart : 1) - 1,
        at: entry.at,
      });
      if (!written) { leftovers.push(entry); out.skipped++; continue; }
      out.moved++;
      try { if (src && fs.existsSync(src) && src !== written.path) fs.unlinkSync(src); } catch { /* best effort */ }
    }
    // Rewrite (or remove) the root index so a second run is a no-op and the root archive stops
    // looking like a conversation directory.
    try {
      if (leftovers.length) fs.writeFileSync(indexPath(transcriptDir), JSON.stringify(leftovers, null, 2), "utf8");
      else {
        try { fs.unlinkSync(indexPath(transcriptDir)); } catch {}
        try { if (!fs.readdirSync(rootSeg).length) fs.rmdirSync(rootSeg); } catch {}
      }
    } catch { /* best effort */ }
    return out;
  } catch {
    return out;
  }
}
