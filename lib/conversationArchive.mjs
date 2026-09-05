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

const SEG_DIR = "_segments";
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
    for (const row of arr) {
      const role = rowRole(row);
      if (role === "user") prompts++;
      else if (role === "assistant") responses++;
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
      n: Number.isFinite(n) ? Math.floor(n) : 0,
      path: filePath,
      rows: arr.length,
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

      const rows = readSegmentRows(entry.path);
      // The (num - start + 1)-th row of the wanted role within this segment.
      const ordinal = num - start + 1;
      let seen = 0;
      for (const row of rows) {
        if (rowRole(row) === wantRole) {
          seen++;
          if (seen === ordinal) {
            return { segmentRef: entry.segmentRef, kind, number: num, text: rowText(row), row };
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
      const rows = readSegmentRows(entry.path);
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
        out.push({ segmentRef: entry.segmentRef, kind, number, snippet: makeSnippet(text, needleLower) });
        if (out.length >= cap) return out;
      }
    }
    return out;
  } catch {
    return [];
  }
}
