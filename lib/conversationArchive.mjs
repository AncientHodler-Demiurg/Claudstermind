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

export const SEG_DIR = "_segments";
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
 *   → { segmentRef, kind, number, text, row } | null
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
              kind, number: num, text: rowText(row), images: rowImages(row), row };
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

/**
 * recallByQuery(baseDir, { conversationId, query, limit = 10 })
 *   → [{ segmentRef, kind, number, snippet }]
 *
 * Case-insensitive substring scan over archived segment rows' text (user + assistant).
 * Newest-segment-first (highest n first), capped at `limit`. No embeddings.
 */
export function recallByQuery(baseDir, opts = {}) {
  try {
    const { conversationId, query, limit = 10 } = opts && typeof opts === "object" ? opts : {};
    const needle = typeof query === "string" ? query.trim() : "";
    if (!needle) return [];
    const needleLower = needle.toLowerCase();
    const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
    const cid = conversationId == null ? null : String(conversationId);

    const index = readIndex(baseDir)
      .filter((e) => e && typeof e === "object" && (cid == null || String(e.conversationId) === cid))
      .sort((a, b) => (Number.isFinite(b.n) ? b.n : 0) - (Number.isFinite(a.n) ? a.n : 0));

    const out = [];
    for (const entry of index) {
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
        const text = rowText(row);
        if (!text.toLowerCase().includes(needleLower)) continue;
        const kind = role === "user" ? "prompt" : "response";
        const number = role === "user" ? pStart + prompts - 1 : rStart + responses - 1;
        out.push({ segmentRef: entry.segmentRef, workspaceId: entry.workspaceId || "",
          kind, number, snippet: makeSnippet(text, needleLower), images: rowImages(row).length });
        if (out.length >= cap) return out;
      }
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
