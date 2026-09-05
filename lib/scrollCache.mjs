// scrollCache.mjs — a bounded LRU cache of fetched transcript BANDS, so scrolling back
// through a very long conversation does not re-fetch what the client already had.
//
// Companion to lib/transcriptWindow.mjs (the windowed view model) and lib/conversationWindow.mjs
// (the server-side slicer). A cached value is a BAND in exactly the transcriptWindow sense:
//   { rows, start, end, total, promptOffset, responseOffset, … }
// with `start` an ABSOLUTE ROW INDEX and `end` EXCLUSIVE. Keys are ranges, not turn numbers —
// see the coordinate-systems note in transcriptWindow.mjs; a turn number must be converted to
// a row index before it comes anywhere near this file.
//
// CONTRACT.md §4: "no server-side LRU / band caching … The scroll cache is entirely a client
// concern." So this is the only cache there is.
//
// ── WHY THE BUDGET IS BYTES, NOT ENTRIES ───────────────────────────────────────────────────
// An entry-count cap is the usual reflex and it is the wrong one HERE, because the thing being
// bounded varies by orders of magnitude:
//
//   • a band is 1..501 rows (CONTRACT §4: 250 before + 250 after, clamped at the edges), so
//     band-to-band the ROW count already varies ~500×;
//   • a row varies far more than that — a one-line prompt is ~40 bytes, a single Bash/Read
//     tool_result row is routinely 50–200 KB. The live install has 4.1 MB of JSONL text in
//     one workspace.
//
// So `maxEntries = 32` promises nothing: it bounds memory at 32 × (worst-case band), which is
// tens of megabytes in a tab that must stay responsive for hours. Bounding by APPROXIMATE
// BYTES makes the promise the user actually needs — "this cache will not exceed N MB" — and it
// naturally keeps many small bands or few large ones, which is the right trade either way.
//
// `maxEntries` is still enforced, but as a SECONDARY guard on bookkeeping overhead (Map slots,
// key strings, per-entry objects), not as the memory bound. Both are configurable.
//
// Sizing is approximate ON PURPOSE: there is no portable way to measure a JS object's
// retained size, and JSON.stringify-ing every band on every put would cost more than the cache
// saves. The default `sizeOf` sums the string payloads it can see plus a fixed per-row
// overhead, which tracks real memory closely enough to bound it, and it is injectable so a
// caller with better information (or a test) can replace it outright.
//
// Pure and injectable: no timers, no Date, no globals, no DOM. Recency is a monotonic counter,
// so every eviction decision is deterministic and unit-testable.

/** Defaults chosen for a browser tab holding several long conversations at once. */
export const CACHE_DEFAULTS = Object.freeze({
  maxBytes: 8 * 1024 * 1024, // ~8 MB of transcript text
  maxEntries: 64,            // bookkeeping guard only — see the note above
  rowOverhead: 128,          // approximate per-row cost of the object itself
});

function isNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function intOr(v, fallback) {
  return isNum(v) ? Math.floor(v) : fallback;
}

/** Cache key for an absolute row range. `end` is EXCLUSIVE, matching conversationWindow. */
export function rangeKey(start, end) {
  return `${Math.max(0, intOr(start, 0))}:${Math.max(0, intOr(end, 0))}`;
}

/** Approximate retained bytes of a band. Counts every string field on a row (text, thinking,
 *  tool output, …) plus a flat per-row object overhead. Never throws on a weird row. */
export function approximateBandBytes(band, rowOverhead = CACHE_DEFAULTS.rowOverhead) {
  const rows = band && Array.isArray(band.rows) ? band.rows : [];
  let bytes = 0;
  for (const row of rows) {
    bytes += rowOverhead;
    if (!row || typeof row !== "object") continue;
    for (const k in row) {
      const v = row[k];
      if (typeof v === "string") bytes += v.length;
      else if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === "string") bytes += item.length;
          else if (item && typeof item === "object") {
            for (const kk in item) if (typeof item[kk] === "string") bytes += item[kk].length;
          }
        }
      }
    }
  }
  return bytes;
}

/**
 * createScrollCache(opts) → cache
 *
 * opts:
 *   maxBytes    approximate byte budget (default 8 MB). THE memory bound.
 *   maxEntries  hard cap on entry count (default 64). Bookkeeping guard.
 *   rowOverhead per-row overhead used by the default sizer.
 *   sizeOf      (band) → bytes. Injectable; defaults to `approximateBandBytes`.
 *   signature   identity of the conversation these bands belong to (see `setSignature`).
 *
 * The cache is a plain object with a Map inside; every operation is a free function taking it
 * as the first argument, matching the pure-module style used across lib/.
 */
export function createScrollCache(opts = {}) {
  const o = opts && typeof opts === "object" ? opts : {};
  const rowOverhead = Math.max(0, intOr(o.rowOverhead, CACHE_DEFAULTS.rowOverhead));
  return {
    entries: new Map(), // key → { key, start, end, band, bytes, rows, used }
    maxBytes: Math.max(0, intOr(o.maxBytes, CACHE_DEFAULTS.maxBytes)),
    maxEntries: Math.max(1, intOr(o.maxEntries, CACHE_DEFAULTS.maxEntries)),
    rowOverhead,
    sizeOf: typeof o.sizeOf === "function" ? o.sizeOf : (band) => approximateBandBytes(band, rowOverhead),
    signature: o.signature == null ? null : String(o.signature),
    total: null, // last known transcriptTotal, for `noteTotal`
    bytes: 0,
    seq: 0,
    stats: { hits: 0, misses: 0, puts: 0, evictions: 0, rejections: 0, invalidations: 0 },
  };
}

/**
 * windowSignature(parts) → a stable identity string for "which conversation, in which shape".
 *
 * DELIBERATELY EXCLUDES the row total. A new turn APPENDS rows; it does not renumber the
 * history, so every band below the old end is still perfectly valid and blowing the whole
 * cache away on each turn would defeat the point. Growth is handled by `noteTotal`, which
 * drops only the entries that touched the old end. What DOES belong in the signature is
 * anything that renumbers or replaces history: a different conversation, a different SDK
 * session, or a roll/archive (`sourceRef`, the segmentRef the roll cue carries — CONTRACT §3a).
 */
export function windowSignature(parts = {}) {
  const p = parts && typeof parts === "object" ? parts : {};
  return [p.sessionKey, p.sessionId, p.workspaceId, p.sourceRef]
    .map((x) => (x == null ? "" : String(x)))
    .join("|");
}

function touch(cache, entry) {
  cache.entries.delete(entry.key);
  entry.used = ++cache.seq;
  cache.entries.set(entry.key, entry);
  return entry;
}

function drop(cache, entry, kind) {
  if (!cache.entries.delete(entry.key)) return;
  cache.bytes -= entry.bytes;
  if (cache.bytes < 0) cache.bytes = 0;
  if (kind === "evict") cache.stats.evictions++;
  else if (kind === "invalidate") cache.stats.invalidations++;
}

// Evict least-recently-used entries until both budgets are satisfied. Map iteration order is
// insertion order and `touch` re-inserts on every hit, so the FIRST key is always the LRU.
function evictToFit(cache) {
  while (cache.entries.size > 0 && (cache.bytes > cache.maxBytes || cache.entries.size > cache.maxEntries)) {
    const oldest = cache.entries.values().next().value;
    drop(cache, oldest, "evict");
  }
}

/**
 * put(cache, band, opts) → { stored, key, reason, evicted }
 *
 * Stores a band under its own absolute range. Re-putting the same range REPLACES it (the
 * server is authoritative; a re-fetch is fresher).
 *
 * Refuses, rather than silently blowing the budget, when a single band is larger than
 * `maxBytes` on its own (`reason: "oversize"`). Admitting it would break the ONE promise this
 * cache makes; the caller still has the band in hand for the current render, it just will not
 * be there later. That is the honest failure mode.
 *
 * `opts.signature` guards against writing a band from conversation A into a cache now holding
 * conversation B: a mismatch clears the cache first (see `setSignature`).
 */
export function put(cache, band, opts = {}) {
  if (!cache || !cache.entries) return { stored: false, key: null, reason: "no-cache", evicted: 0 };
  const b = band && typeof band === "object" && Array.isArray(band.rows) ? band : null;
  if (!b) return { stored: false, key: null, reason: "no-band", evicted: 0 };
  const start = Math.max(0, intOr(b.start, 0));
  const end = Math.max(start, intOr(b.end, start + b.rows.length));
  if (end === start) return { stored: false, key: null, reason: "empty", evicted: 0 };

  if (opts && opts.signature !== undefined) setSignature(cache, opts.signature);
  if (isNum(b.total)) noteTotal(cache, b.total, { grew: "keep" });

  const bytes = Math.max(0, intOr(cache.sizeOf(b), 0));
  if (bytes > cache.maxBytes) {
    cache.stats.rejections++;
    return { stored: false, key: rangeKey(start, end), reason: "oversize", evicted: 0 };
  }

  const key = rangeKey(start, end);
  const prev = cache.entries.get(key);
  if (prev) drop(cache, prev, "replace");

  const before = cache.stats.evictions;
  const entry = { key, start, end, band: b, bytes, rows: b.rows.length, used: ++cache.seq };
  cache.entries.set(key, entry);
  cache.bytes += bytes;
  cache.stats.puts++;
  evictToFit(cache);
  return { stored: cache.entries.has(key), key, reason: "ok", evicted: cache.stats.evictions - before };
}

/** Exact-range lookup. Counts a hit/miss and refreshes recency on a hit. */
export function get(cache, start, end) {
  if (!cache || !cache.entries) return null;
  const entry = cache.entries.get(rangeKey(start, end));
  if (!entry) {
    cache.stats.misses++;
    return null;
  }
  cache.stats.hits++;
  return touch(cache, entry).band;
}

// Pick the entry that covers [start,end) with the FEWEST rows — the cheapest band that
// answers the question. Ties break toward the most recently used, which keeps the working set
// hot. Does not count hits/misses; the public wrappers do.
function findCoveringEntry(cache, start, end) {
  let best = null;
  for (const entry of cache.entries.values()) {
    if (entry.start <= start && entry.end >= end) {
      if (!best || entry.rows < best.rows || (entry.rows === best.rows && entry.used > best.used)) best = entry;
    }
  }
  return best;
}

/** The smallest cached band that fully covers [start, end), or null. Range lookup is the
 *  operation that actually matters for scrolling: the client asks for "rows 400–600" and any
 *  cached band that contains them will do — it does not have to be the same request. */
export function findCovering(cache, start, end) {
  if (!cache || !cache.entries) return null;
  const s = Math.max(0, intOr(start, 0));
  const e = Math.max(s, intOr(end, s));
  const entry = findCoveringEntry(cache, s, e);
  if (!entry) {
    cache.stats.misses++;
    return null;
  }
  cache.stats.hits++;
  return touch(cache, entry).band;
}

/** The smallest cached band containing a single absolute row index, or null. This is the
 *  jump-to-#N lookup: convert the turn to a row index first, then ask here before fetching. */
export function findContaining(cache, index) {
  const i = Math.max(0, intOr(index, 0));
  return findCovering(cache, i, i + 1);
}

/** True if a band covering [start,end) is cached — WITHOUT touching recency or stats. For
 *  diagnostics and assertions; never use it as the read path. */
export function has(cache, start, end) {
  if (!cache || !cache.entries) return false;
  const s = Math.max(0, intOr(start, 0));
  const e = Math.max(s, intOr(end, s));
  return !!findCoveringEntry(cache, s, e);
}

/** Drop every entry that OVERLAPS [start, end). Use when a row range is known to have changed
 *  (an edited turn, a re-rendered tool result). Returns the number dropped. */
export function invalidateRange(cache, start, end) {
  if (!cache || !cache.entries) return 0;
  const s = Math.max(0, intOr(start, 0));
  const e = Math.max(s, intOr(end, Number.MAX_SAFE_INTEGER));
  let n = 0;
  for (const entry of Array.from(cache.entries.values())) {
    if (entry.start < e && entry.end > s) {
      drop(cache, entry, "invalidate");
      n++;
    }
  }
  return n;
}

/** Drop every entry holding any row at or after `index`. The tail-invalidation primitive. */
export function invalidateFrom(cache, index) {
  return invalidateRange(cache, index, Number.MAX_SAFE_INTEGER);
}

/** Drop everything. Returns the number dropped. */
export function clear(cache) {
  if (!cache || !cache.entries) return 0;
  const n = cache.entries.size;
  for (const entry of Array.from(cache.entries.values())) drop(cache, entry, "invalidate");
  cache.entries.clear();
  cache.bytes = 0;
  cache.total = null;
  return n;
}

/**
 * setSignature(cache, signature) → true if the cache was cleared.
 *
 * The coarse invalidation: a different conversation / session / post-roll identity means every
 * cached band is about a different thing, and serving one would put another conversation's
 * turns on screen. Setting the SAME signature is a no-op. Setting it for the first time on an
 * empty cache just records it.
 */
export function setSignature(cache, signature) {
  if (!cache || !cache.entries) return false;
  const sig = signature == null ? null : String(signature);
  if (cache.signature === sig) return false;
  const had = cache.entries.size > 0;
  cache.signature = sig;
  if (had) clear(cache);
  else cache.total = null;
  return had;
}

/**
 * noteTotal(cache, total, opts) → { changed, dropped, cleared }
 *
 * Track `transcriptTotal` across responses and invalidate the minimum that is actually unsafe:
 *
 *   • total GREW  → new turns were appended. History below the old end is untouched, so only
 *     entries REACHING the old end are dropped: a band that ended at the old total was the
 *     tail, and the tail is now incomplete. (`opts.grew: "keep"` skips even that — used
 *     internally by `put`, where the band being stored IS the fresh tail.)
 *   • total SHRANK → rows were removed, rolled off or renumbered. Nothing can be trusted to sit
 *     at the same index any more, so the cache is cleared. This is the roll/archive case, and
 *     it is why a stale band can never be served after a roll even if the signature was not
 *     updated.
 */
export function noteTotal(cache, total, opts = {}) {
  if (!cache || !cache.entries) return { changed: false, dropped: 0, cleared: false };
  const t = intOr(total, NaN);
  if (!isNum(t) || t < 0) return { changed: false, dropped: 0, cleared: false };
  const prev = cache.total;
  cache.total = t;
  if (prev == null || prev === t) return { changed: prev !== t, dropped: 0, cleared: false };
  if (t < prev) {
    const dropped = clear(cache);
    cache.total = t;
    return { changed: true, dropped, cleared: true };
  }
  if (opts && opts.grew === "keep") return { changed: true, dropped: 0, cleared: false };
  // `prev - 1`, not `prev`: an entry ending EXACTLY at the old total was the tail band, and the
  // tail is what just became incomplete. A band that merely stops short of the old end is
  // still whole and stays.
  const dropped = invalidateFrom(cache, Math.max(0, prev - 1));
  return { changed: true, dropped, cleared: false };
}

/** Diagnostics. `hitRate` is null until at least one lookup has happened — reporting 0% for a
 *  cache nobody has asked anything of would be a lie, and this number ends up in a debug
 *  panel. */
export function stats(cache) {
  if (!cache || !cache.entries) {
    return { entries: 0, rows: 0, bytes: 0, maxBytes: 0, maxEntries: 0, fill: 0, hits: 0, misses: 0, puts: 0, evictions: 0, rejections: 0, invalidations: 0, hitRate: null, signature: null, total: null };
  }
  let rows = 0;
  for (const entry of cache.entries.values()) rows += entry.rows;
  const lookups = cache.stats.hits + cache.stats.misses;
  return {
    entries: cache.entries.size,
    rows,
    bytes: cache.bytes,
    maxBytes: cache.maxBytes,
    maxEntries: cache.maxEntries,
    fill: cache.maxBytes > 0 ? cache.bytes / cache.maxBytes : 0,
    hits: cache.stats.hits,
    misses: cache.stats.misses,
    puts: cache.stats.puts,
    evictions: cache.stats.evictions,
    rejections: cache.stats.rejections,
    invalidations: cache.stats.invalidations,
    hitRate: lookups > 0 ? cache.stats.hits / lookups : null,
    signature: cache.signature,
    total: cache.total,
  };
}

/** Cached ranges, LRU-first. Diagnostics only; does not touch recency. */
export function ranges(cache) {
  if (!cache || !cache.entries) return [];
  return Array.from(cache.entries.values()).map((e) => ({ start: e.start, end: e.end, rows: e.rows, bytes: e.bytes }));
}
