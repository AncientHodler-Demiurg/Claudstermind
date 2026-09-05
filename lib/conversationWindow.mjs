// Pure transcript-windowing functions — the "Navigation" contract from
// docs/AGENTIC-CHAT-ENGINE.md §3 ("large conversations must never stall the UI"),
// generalized from lib/workspace.mjs `capTranscript`.
//
// A "transcript" is an array of row objects. A row is a PROMPT when `row.role === "user"`
// and a RESPONSE when `row.role === "assistant"` (any other row is ignored for counting).
// These functions let a huge conversation be paged (tail) or jumped-to (band around an index)
// without ever loading the whole thing, and they carry `promptOffset`/`responseOffset` so a
// returned window can be labelled with ABSOLUTE P#/R# positions in the full conversation.
//
// ESM, no imports — pure, total-order-safe. Every function guards against non-arrays and
// out-of-range input and returns a sane empty shape rather than throwing.

/** Count how many user (prompt) and assistant (response) rows occur BEFORE index `start`.
 *  `start` is clamped to [0, arr.length]. Non-array or start<=0 → {0,0}. */
export function countOffsets(arr, start) {
  if (!Array.isArray(arr)) return { promptOffset: 0, responseOffset: 0 };
  const end = Math.max(0, Math.min(Math.floor(start) || 0, arr.length));
  let promptOffset = 0, responseOffset = 0;
  for (let i = 0; i < end; i++) {
    const r = arr[i];
    if (r && r.role === "user") promptOffset++;
    else if (r && r.role === "assistant") responseOffset++;
  }
  return { promptOffset, responseOffset };
}

/** The last `limit` rows (or all if fewer). Mirrors capTranscript's contract.
 *  `start` = index of the first returned row; `truncatedBefore` = start>0. */
export function windowTail(arr, limit) {
  if (!Array.isArray(arr) || arr.length === 0) {
    return { transcript: [], start: 0, truncatedBefore: false, total: 0, promptOffset: 0, responseOffset: 0 };
  }
  const total = arr.length;
  const n = (typeof limit === "number" && limit > 0) ? Math.floor(limit) : total;
  if (n >= total) {
    return { transcript: arr.slice(), start: 0, truncatedBefore: false, total, promptOffset: 0, responseOffset: 0 };
  }
  const start = total - n;
  const { promptOffset, responseOffset } = countOffsets(arr, start);
  return { transcript: arr.slice(start), start, truncatedBefore: start > 0, total, promptOffset, responseOffset };
}

/** A band of rows around index `center`, clamped to the array bounds — the jump-to-#N primitive.
 *  Returns `start`/`end` (end = index AFTER the last returned row, slice-style) plus
 *  `truncatedBefore`/`truncatedAfter` flags and the absolute offsets. */
export function windowAround(arr, center, { before = 60, after = 60 } = {}) {
  if (!Array.isArray(arr) || arr.length === 0) {
    return { transcript: [], start: 0, end: 0, truncatedBefore: false, truncatedAfter: false, total: 0, promptOffset: 0, responseOffset: 0 };
  }
  const total = arr.length;
  const b = Math.max(0, Math.floor(before) || 0);
  const a = Math.max(0, Math.floor(after) || 0);
  const c = Math.max(0, Math.min(Math.floor(center) || 0, total - 1));
  const start = Math.max(0, c - b);
  const end = Math.min(total, c + a + 1);
  const { promptOffset, responseOffset } = countOffsets(arr, start);
  return {
    transcript: arr.slice(start, end),
    start,
    end,
    truncatedBefore: start > 0,
    truncatedAfter: end < total,
    total,
    promptOffset,
    responseOffset,
  };
}

/** Array index of the n-th user prompt (1-based, counting all rows), or -1 if out of range. */
export function indexOfPrompt(arr, n) {
  if (!Array.isArray(arr)) return -1;
  const target = Math.floor(n);
  if (!(target >= 1)) return -1;
  let count = 0;
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i];
    if (r && r.role === "user") {
      count++;
      if (count === target) return i;
    }
  }
  return -1;
}

/** Array index of the n-th assistant response (1-based, counting all rows), or -1 if out of range. */
export function indexOfResponse(arr, n) {
  if (!Array.isArray(arr)) return -1;
  const target = Math.floor(n);
  if (!(target >= 1)) return -1;
  let count = 0;
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i];
    if (r && r.role === "assistant") {
      count++;
      if (count === target) return i;
    }
  }
  return -1;
}
