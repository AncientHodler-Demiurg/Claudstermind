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
 *  Returns `start`/`end` (end = index AFTER the last returned row, slice-style — EXCLUSIVE) plus
 *  `truncatedBefore`/`truncatedAfter` flags and the absolute offsets.
 *  `center` is the CLAMPED centre actually used and `clamped` says whether the caller's centre was
 *  out of range — the client should not have to infer "you didn't land where I asked" from the band. */
export function windowAround(arr, center, { before = 60, after = 60 } = {}) {
  if (!Array.isArray(arr) || arr.length === 0) {
    return { transcript: [], start: 0, end: 0, truncatedBefore: false, truncatedAfter: false, total: 0, promptOffset: 0, responseOffset: 0, center: 0, clamped: false };
  }
  const total = arr.length;
  const b = Math.max(0, Math.floor(before) || 0);
  const a = Math.max(0, Math.floor(after) || 0);
  const wanted = Math.floor(center) || 0;
  const c = Math.max(0, Math.min(wanted, total - 1));
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
    center: c,
    clamped: c !== wanted,
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

/** How many prompts / responses the whole array holds. The ROW total (`arr.length`) counts tool
 *  output too, so it can never answer "turn 137 of 600" — this can. */
export function countTurns(arr) {
  return countOffsets(arr, Array.isArray(arr) ? arr.length : 0);
}

/** Normalize a turn kind to the two the transcript actually labels rows with.
 *  Accepts both the row vocabulary ("user"/"assistant") and the recall vocabulary
 *  ("prompt"/"response"), because callers arrive from both. */
export function normalizeTurnKind(kind) {
  return (kind === "assistant" || kind === "response") ? "response" : "prompt";
}

/**
 * resolveTurnIndex(arr, kind, number) → { index, kind, number, resolved, clamped, reason, count }
 *
 * THE jump-to-#N primitive that the client cannot compute itself: turn number → ROW INDEX.
 * A P#/R# is a position among rows of ONE role; a row index counts every row including tool
 * output, so the mapping is only knowable where the full transcript is — here.
 *
 *   `number`   what was asked for (floored; NaN → 1)
 *   `resolved` the turn number actually landed on after clamping
 *   `index`    its row index, or the best clamp target
 *   `clamped`  true when `resolved !== number` (or there were no turns of that kind at all)
 *   `reason`   "exact" | "below-range" | "above-range" | "no-turns" | "empty"
 *   `count`    how many turns of that kind the array holds
 *
 * Out-of-range is CLAMPED, never an error — but it always says so, so a caller can offer
 * `recall` for a turn that is genuinely not in this array rather than silently showing the
 * wrong band.
 */
export function resolveTurnIndex(arr, kind, number) {
  const k = normalizeTurnKind(kind);
  const rows = Array.isArray(arr) ? arr : [];
  const counts = countOffsets(rows, rows.length);
  const count = k === "response" ? counts.responseOffset : counts.promptOffset;
  const raw = Math.floor(Number(number));
  const want = Number.isFinite(raw) ? raw : 1;

  if (rows.length === 0) return { index: 0, kind: k, number: want, resolved: 0, clamped: true, reason: "empty", count: 0 };
  // No turns of that role at all (an assistant-only or tool-only transcript): the honest answer is
  // "I cannot place this", so land on the tail and say it was clamped.
  if (count === 0) return { index: rows.length - 1, kind: k, number: want, resolved: 0, clamped: true, reason: "no-turns", count: 0 };

  const resolved = Math.max(1, Math.min(want, count));
  const at = k === "response" ? indexOfResponse(rows, resolved) : indexOfPrompt(rows, resolved);
  const index = at >= 0 ? at : rows.length - 1;
  const reason = resolved === want ? "exact" : (want < resolved ? "below-range" : "above-range");
  return { index, kind: k, number: want, resolved, clamped: resolved !== want, reason, count };
}

/**
 * windowAroundTurn(arr, { kind, number }, opts) → the SAME band shape as `windowAround`, centred
 * on a TURN NUMBER instead of a row index, plus `turn: <resolveTurnIndex result>`.
 *
 * `clamped` on the result is true if EITHER the turn number was out of range or the resulting
 * centre had to be clamped to the array.
 */
export function windowAroundTurn(arr, { kind, number } = {}, opts = {}) {
  const turn = resolveTurnIndex(arr, kind, number);
  const w = windowAround(arr, turn.index, opts);
  return { ...w, turn, clamped: w.clamped || turn.clamped };
}
