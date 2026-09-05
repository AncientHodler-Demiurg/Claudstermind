// transcriptWindow.mjs — the CLIENT-side windowed transcript model.
//
// Server counterpart: lib/conversationWindow.mjs. That module decides which slice of a
// transcript array to SEND (`windowTail`, `windowAround`, `countOffsets`); this module decides
// which slice to ASK FOR and how to reconcile what came back into something a renderer can
// paint. The two speak the same language ON PURPOSE — `start` / `end` (end EXCLUSIVE,
// slice-style) / `total` / `promptOffset` / `responseOffset` / `truncatedBefore` /
// `truncatedAfter` mean exactly what they mean there. Nothing here duplicates the server's
// slicing: we never slice a full transcript, because the client never has one.
//
// Wire format is `docs/work/agentic-chat-engine/CONTRACT.md` §4. The server answers an
// `{ action: "open"|"resync", args: { around: <ROW INDEX> } }` with a payload whose windowing
// fields are `transcript` / `transcriptTotal` / `transcriptTruncated` / `promptOffset` /
// `responseOffset` / `windowStart` / `windowEnd`. `normalizeBand()` is the ONLY place those
// wire names appear; everything downstream uses the conversationWindow vocabulary.
//
// ── THE ONE BUG CLASS THIS MODULE EXISTS TO PREVENT ────────────────────────────────────────
// There are TWO coordinate systems here and they are not interchangeable:
//
//   ROW INDEX      0-based position in the transcript ARRAY. Counts tool rows, notes, init
//                  rows — everything. This is what `around` takes. This is what `windowStart`
//                  and `windowEnd` are.
//   TURN NUMBER    absolute 1-based P#/R#, counting ONLY user rows (P) or assistant rows (R),
//                  across the WHOLE conversation including rolled-off segments. This is what
//                  the badges show, what `recall` takes, and what a human means by "turn 1237".
//
// Confusing them is exactly the bug the server agent just fixed in the roll archive
// (overlapping absolute P#/R# ranges made `recall` answer with the WRONG turn). So: no public
// function here takes a bare number that could be either. Every turn-shaped argument is
// `(kind, number)` with kind ∈ "prompt"|"response"; every index-shaped value is named
// `index`/`start`/`end`/`around`. `mergeBands()` additionally CROSS-CHECKS the two systems
// against each other and refuses to merge when they disagree — see `conflict` below.
//
// ESM, NO IMPORTS (same stance as conversationWindow.mjs) so a browser can load this file
// as-is. Pure: no DOM, no timers, no globals, no Date. Every function guards bad input and
// returns a sane empty shape instead of throwing.

/** Fallback band half-widths, mirroring the server's WS_RESYNC_MSG_CAP (250 before + 250
 *  after = at most 501 rows). CONTRACT §4 says not to hardcode 501: the real span is LEARNED
 *  from the first unclamped band that comes back (see `applyBand`'s `center` option) and this
 *  is used only until then. */
export const DEFAULT_BAND = Object.freeze({ before: 250, after: 250 });

/** How many rows a planned extension deliberately overlaps the band it is extending. One row
 *  is enough to prove adjacency; it costs one duplicate row on the wire and it makes a
 *  server-side clamp impossible to mistake for a gap. */
export const EXTEND_OVERLAP = 1;

/**
 * How many `around` round-trips a jump-to-#N may take before we accept the closest band we
 * landed on.
 *
 * A jump to an UNLOADED turn is a SEARCH, not a lookup: `around` takes a row index, the user
 * gave a turn number, and only the server knows how many tool rows sit between them. The first
 * probe interpolates and — on realistic transcripts — lands on the turn immediately. Every
 * probe that misses still returns a band, and a band is two exact anchors (row index ↔ absolute
 * P#/R#), so a miss strictly narrows the bracket the turn must live in. From the second probe
 * on we BISECT that bracket, which makes the worst case logarithmic instead of dependent on how
 * evenly tool output is distributed:
 *
 *     attempts ≈ 1 + ceil(log2(rows / bandWidth))
 *
 * With the server's 501-row band that is ~6 for a 25k-row conversation and ~12 for a 2M-row
 * one, so 12 covers anything that can physically exist here while still bounding a runaway.
 */
export const MAX_JUMP_ATTEMPTS = 12;

/** How many index↔turn anchors a view remembers. Each probe contributes two, so this only
 *  matters after dozens of jumps in one session; the interior is thinned (keeping the spread)
 *  rather than letting the list grow without bound. */
export const MAX_ANCHORS = 64;

const KIND_PROMPT = "prompt";
const KIND_RESPONSE = "response";

function isNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function intOr(v, fallback) {
  if (!isNum(v)) return fallback;
  return Math.floor(v);
}

function clamp(n, lo, hi) {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(n, hi));
}

/** Role of a transcript row: "user" (a PROMPT) or "assistant" (a RESPONSE), else null.
 *  Persisted transcript rows key this as `role`; live event rows key it as `kind` (see
 *  lib/conversationRoll.mjs `rowRole` and app.js `wsStampNumbers`, which both accept either).
 *  `role` WINS when both are present, because `role` is what the server counted when it
 *  computed `promptOffset`/`responseOffset` — matching it exactly is what keeps client
 *  numbering identical to server numbering. */
export function rowRole(row) {
  if (!row || typeof row !== "object") return null;
  if (row.role === "user" || row.role === "assistant") return row.role;
  if (row.kind === "user" || row.kind === "assistant") return row.kind;
  return null;
}

/** Count prompt/response rows in `rows[0 .. upto)`. `upto` is clamped to [0, rows.length].
 *  Same job as conversationWindow.countOffsets, over a BAND rather than a full transcript. */
export function countRoles(rows, upto) {
  const arr = Array.isArray(rows) ? rows : [];
  const end = clamp(intOr(upto, arr.length), 0, arr.length);
  let prompts = 0;
  let responses = 0;
  for (let i = 0; i < end; i++) {
    const role = rowRole(arr[i]);
    if (role === "user") prompts++;
    else if (role === "assistant") responses++;
  }
  return { prompts, responses };
}

/**
 * normalizeBand(payload) → a BAND, or null if the payload carries no transcript array.
 *
 * A band is the client-side unit of loaded transcript:
 *   { rows, start, end, total, promptOffset, responseOffset,
 *     truncatedBefore, truncatedAfter, isBand }
 *
 * `start` is the ABSOLUTE row index of `rows[0]`; `end` is exclusive. `promptOffset` /
 * `responseOffset` are how many prompts / responses precede `start` in the WHOLE conversation
 * (CONTRACT §4) — that is what makes absolute P#/R# derivable from a band alone.
 *
 * Handles all three server window modes:
 *   • `around` → `windowStart`/`windowEnd` present ⇒ `isBand: true`, exact bounds.
 *   • tail (`limit`) → no window fields ⇒ start derived as `total - rows.length`.
 *   • full → no window fields, nothing truncated ⇒ start 0.
 *
 * windowEnd ambiguity: CONTRACT §4 never states whether `windowEnd` is inclusive or
 * exclusive. Its own example (windowStart 350, windowEnd 851, "at most 501 rows") is
 * EXCLUSIVE and matches conversationWindow.windowAround's slice-style `end`, so exclusive is
 * what we assume — but we verify against `rows.length` and silently accept an inclusive
 * `windowEnd` too, because guessing wrong by one row would shift every P#/R# in the band.
 */
export function normalizeBand(payload) {
  const p = payload && typeof payload === "object" ? payload : null;
  if (!p || !Array.isArray(p.transcript)) return null;
  const rows = p.transcript.slice();
  const len = rows.length;

  const hasWindow = isNum(p.windowStart) && isNum(p.windowEnd);
  let start = hasWindow ? Math.max(0, Math.floor(p.windowStart)) : 0;
  let total = Math.max(0, intOr(p.transcriptTotal, 0));

  if (!hasWindow && len > 0) {
    // Tail/full: no window fields, so the band ends at the live end of the conversation.
    start = Math.max(0, total - len);
  }

  // `end` is ALWAYS derived from rows.length, never from `windowEnd`. That makes the
  // inclusive-vs-exclusive ambiguity in CONTRACT §4 unable to shift a single P#/R#: whatever
  // `windowEnd` means, `rows[i]` is at absolute index `windowStart + i` and there are
  // `rows.length` of them. `windowEnd` is used only as a corroborating signal below.
  const end = start + len;
  if (total < end) total = end;

  const declaredEnd = hasWindow ? Math.floor(p.windowEnd) : end;
  // "exclusive" is the documented/observed shape (windowStart 350 + 501 rows → 851);
  // "inclusive" is tolerated; anything else means the server disagrees with its own array.
  const windowEndStyle = !hasWindow || len === 0
    ? "n/a"
    : declaredEnd === end
      ? "exclusive"
      : declaredEnd === end - 1
        ? "inclusive"
        : "inconsistent";

  const truncatedFlag = !!p.transcriptTruncated;
  const truncatedBefore = start > 0;
  const truncatedAfter = end < total;

  return {
    rows,
    start,
    end,
    total,
    promptOffset: Math.max(0, intOr(p.promptOffset, 0)),
    responseOffset: Math.max(0, intOr(p.responseOffset, 0)),
    // `transcriptTruncated` is true when EITHER side withheld rows. The per-side flags are
    // derived from the bounds, which is strictly more information; `truncated` keeps the
    // server's flag OR'd in so a payload that under-reports its own bounds still says
    // "there is more".
    truncatedBefore,
    truncatedAfter,
    truncated: truncatedFlag || truncatedBefore || truncatedAfter,
    isBand: hasWindow,
    windowEndStyle,
  };
}

/** Absolute P#/R# range a band covers, named like a conversationArchive index entry
 *  (`promptStart`/`promptEnd`/`responseStart`/`responseEnd`, CONTRACT §7). Ends are INCLUSIVE
 *  and are 0 when the band holds no row of that kind. */
export function bandTurnRange(band) {
  const b = band && typeof band === "object" ? band : null;
  if (!b) return { promptStart: 0, promptEnd: 0, responseStart: 0, responseEnd: 0, prompts: 0, responses: 0 };
  const { prompts, responses } = countRoles(b.rows, Array.isArray(b.rows) ? b.rows.length : 0);
  const po = Math.max(0, intOr(b.promptOffset, 0));
  const ro = Math.max(0, intOr(b.responseOffset, 0));
  return {
    promptStart: prompts > 0 ? po + 1 : 0,
    promptEnd: prompts > 0 ? po + prompts : 0,
    responseStart: responses > 0 ? ro + 1 : 0,
    responseEnd: responses > 0 ? ro + responses : 0,
    prompts,
    responses,
  };
}

/** The turn a given ABSOLUTE ROW INDEX carries: `{ kind, number }` with a 1-based absolute
 *  P#/R#, or null when the index is outside the band or the row is not a turn (a tool row). */
export function turnAt(band, index) {
  const b = band && typeof band === "object" ? band : null;
  if (!b || !Array.isArray(b.rows)) return null;
  const i = intOr(index, NaN);
  if (!isNum(i)) return null;
  const local = i - Math.max(0, intOr(b.start, 0));
  if (local < 0 || local >= b.rows.length) return null;
  const role = rowRole(b.rows[local]);
  if (!role) return null;
  const { prompts, responses } = countRoles(b.rows, local);
  return role === "user"
    ? { kind: KIND_PROMPT, number: Math.max(0, intOr(b.promptOffset, 0)) + prompts + 1 }
    : { kind: KIND_RESPONSE, number: Math.max(0, intOr(b.responseOffset, 0)) + responses + 1 };
}

/** ABSOLUTE ROW INDEX of turn (kind, number) inside `band`, or -1 if the band does not hold
 *  it. This is the ONLY exact index↔turn conversion; everything else is an estimate. */
export function indexOfTurn(band, kind, number) {
  const b = band && typeof band === "object" ? band : null;
  if (!b || !Array.isArray(b.rows)) return -1;
  const target = intOr(number, NaN);
  if (!isNum(target) || target < 1) return -1;
  const wantUser = kind !== KIND_RESPONSE;
  const base = Math.max(0, intOr(wantUser ? b.promptOffset : b.responseOffset, 0));
  if (target <= base) return -1; // before this band — a real answer, not an error
  let seen = base;
  const start = Math.max(0, intOr(b.start, 0));
  for (let i = 0; i < b.rows.length; i++) {
    const role = rowRole(b.rows[i]);
    if (!role) continue;
    if (wantUser ? role === "user" : role === "assistant") {
      seen++;
      if (seen === target) return start + i;
    }
  }
  return -1;
}

/** Does this band hold turn (kind, number)? */
export function containsTurn(band, kind, number) {
  return indexOfTurn(band, kind, number) >= 0;
}

// Recompute a band's offsets AT a given absolute index, walking forward from its own start.
// Returns null when `index` is outside [start, end].
function offsetsAt(band, index) {
  const start = Math.max(0, intOr(band.start, 0));
  const local = index - start;
  if (local < 0 || local > band.rows.length) return null;
  const { prompts, responses } = countRoles(band.rows, local);
  return {
    promptOffset: Math.max(0, intOr(band.promptOffset, 0)) + prompts,
    responseOffset: Math.max(0, intOr(band.responseOffset, 0)) + responses,
  };
}

/**
 * mergeBands(a, b) → { ok, band, reason, conflict }
 *
 * Merge two bands of the SAME conversation into one contiguous band, without duplicating a
 * single row. `ok: false` means "these cannot be merged, replace instead" and `reason` says
 * why — the caller (applyBand) turns that into a replace.
 *
 * Rules:
 *   • Disjoint with a gap between them → NOT merged (`reason: "gap"`). Merging across a hole
 *     would produce a band whose row indices lie about what is in it, and every P#/R# after
 *     the hole would be wrong. Touching (a.end === b.start) IS merged.
 *   • Overlapping rows come from the NEWER band (`b`) — the server is authoritative and a
 *     re-fetched row may have been edited/streamed since the older copy was taken.
 *   • CROSS-CHECK (the index-vs-absolute guard): the two bands independently assert absolute
 *     P#/R# offsets. If the earlier band, walked forward to the later band's start, does NOT
 *     produce the later band's `promptOffset`/`responseOffset`, then one of them is wrong
 *     about where it sits in the conversation. That is precisely the archive bug class, so we
 *     REFUSE the merge (`ok: false`, `conflict: true`, `reason: "offset-conflict"`) and let the
 *     caller fall back to the fresher band alone. Never average, never pick silently.
 */
export function mergeBands(a, b) {
  const A = a && Array.isArray(a.rows) ? a : null;
  const B = b && Array.isArray(b.rows) ? b : null;
  if (!A && !B) return { ok: false, band: null, reason: "empty", conflict: false };
  if (!A) return { ok: true, band: B, reason: "only-b", conflict: false };
  if (!B) return { ok: true, band: A, reason: "only-a", conflict: false };
  if (A.rows.length === 0) return { ok: true, band: B, reason: "only-b", conflict: false };
  if (B.rows.length === 0) return { ok: true, band: A, reason: "only-a", conflict: false };

  const first = A.start <= B.start ? A : B;
  const second = first === A ? B : A;

  if (second.start > first.end) {
    return { ok: false, band: null, reason: "gap", conflict: false };
  }

  // Cross-check: what does `first` think the offsets are at `second.start`?
  const expected = offsetsAt(first, second.start);
  if (
    expected &&
    (expected.promptOffset !== Math.max(0, intOr(second.promptOffset, 0)) ||
      expected.responseOffset !== Math.max(0, intOr(second.responseOffset, 0)))
  ) {
    return { ok: false, band: null, reason: "offset-conflict", conflict: true };
  }

  const start = first.start;
  const end = Math.max(first.end, second.end);
  const rows = [];
  // Keep `first`'s rows up to where `second` begins, then all of `second`; if `second` is
  // wholly inside `first`, take the newer copy for the overlap and `first`'s tail after it.
  const headCount = Math.max(0, Math.min(second.start - first.start, first.rows.length));
  for (let i = 0; i < headCount; i++) rows.push(first.rows[i]);
  for (let i = 0; i < second.rows.length; i++) rows.push(second.rows[i]);
  if (second.end < first.end) {
    for (let i = second.end - first.start; i < first.rows.length; i++) rows.push(first.rows[i]);
  }

  const total = Math.max(intOr(first.total, 0), intOr(second.total, 0), end);
  return {
    ok: true,
    conflict: false,
    reason: "merged",
    band: {
      rows,
      start,
      end,
      total,
      promptOffset: Math.max(0, intOr(first.promptOffset, 0)),
      responseOffset: Math.max(0, intOr(first.responseOffset, 0)),
      truncatedBefore: start > 0,
      truncatedAfter: end < total,
      truncated: start > 0 || end < total,
      isBand: !!(first.isBand || second.isBand),
    },
  };
}

// ── anchors: the index ↔ absolute-turn map the client accumulates ───────────────────────────
//
// An ANCHOR is one fact the server has told us: "at ROW INDEX i, exactly `prompts` prompts and
// `responses` responses precede". Every band yields two (its start and its end), and they stay
// true after the band itself is discarded — which is what lets a later jump interpolate over
// regions that are no longer loaded. Anchor 0 is free and always present.
//
// Anchors are a SEARCH ACCELERATOR, never a source of truth: a jump is only ever declared
// satisfied by `containsTurn` on real rows. That separation is deliberate — a wrong anchor can
// cost a round-trip, but it can never put the wrong turn on screen.

function makeAnchor(index, prompts, responses, seq) {
  return { index: Math.max(0, intOr(index, 0)), prompts: Math.max(0, intOr(prompts, 0)), responses: Math.max(0, intOr(responses, 0)), seq: Math.max(0, intOr(seq, 0)) };
}

const ORIGIN_ANCHOR = Object.freeze(makeAnchor(0, 0, 0, 0));

// Sort by index and drop anything that contradicts monotonicity (counts can only grow with the
// index). A contradiction means one of the two anchors is stale — the roll/renumber case, and
// the same index-vs-absolute bug class `mergeBands` guards against — so the NEWER one (higher
// `seq`) survives and the stale one is dropped.
function sanitizeAnchors(list) {
  const byIndex = new Map();
  for (const a of list) {
    if (!a) continue;
    const prev = byIndex.get(a.index);
    if (!prev || a.seq >= prev.seq) byIndex.set(a.index, a);
  }
  const sorted = Array.from(byIndex.values()).sort((x, y) => x.index - y.index);
  const out = [];
  for (const a of sorted) {
    let skip = false;
    while (out.length) {
      const last = out[out.length - 1];
      if (a.prompts >= last.prompts && a.responses >= last.responses) break;
      if (a.seq >= last.seq) out.pop();
      else { skip = true; break; }
    }
    if (!skip) out.push(a);
  }
  if (out.length > MAX_ANCHORS) {
    // Thin the interior, keeping the two ends and an even spread between them.
    const kept = [out[0]];
    const stride = (out.length - 2) / (MAX_ANCHORS - 2);
    for (let i = 1; i < MAX_ANCHORS - 1; i++) kept.push(out[Math.min(out.length - 2, Math.round(i * stride))]);
    kept.push(out[out.length - 1]);
    return sanitizeAnchors(kept);
  }
  return out;
}

/** The anchors a view currently holds, index-ascending. Diagnostics + tests. */
export function viewAnchors(view) {
  const v = view && typeof view === "object" && Array.isArray(view.anchors) ? view.anchors : [ORIGIN_ANCHOR];
  return v.map((a) => ({ index: a.index, prompts: a.prompts, responses: a.responses }));
}

function anchorsOf(view) {
  const list = view && Array.isArray(view.anchors) && view.anchors.length ? view.anchors : [ORIGIN_ANCHOR];
  return list;
}

function anchorCount(anchor, wantPrompt) {
  return wantPrompt ? anchor.prompts : anchor.responses;
}

/**
 * turnBracket(view, kind, number) → the row-index interval turn (kind, number) MUST lie in,
 * given everything the client has been told so far:
 *   { lo, hi, loCount, hiCount, width, bounded }
 * `hi` is null / `bounded: false` when the turn is past every anchor we have (we know it is
 * somewhere after `lo`, and `total` is the only upper bound). This is what a UI should use to
 * say "narrowing down…" honestly instead of pretending it knows where the turn is.
 */
export function turnBracket(view, kind, number) {
  const v = view && typeof view === "object" ? view : emptyView();
  const wantPrompt = kind !== KIND_RESPONSE;
  const target = intOr(number, NaN);
  const total = Math.max(0, intOr(v.total, 0));
  const anchors = anchorsOf(v);
  let lo = anchors[0];
  let hi = null;
  if (isNum(target) && target >= 1) {
    for (const a of anchors) {
      if (anchorCount(a, wantPrompt) < target) lo = a;
      else { hi = a; break; }
    }
  }
  const hiIndex = hi ? hi.index : total;
  return {
    lo: lo.index,
    hi: hi ? hi.index : null,
    loCount: anchorCount(lo, wantPrompt),
    hiCount: hi ? anchorCount(hi, wantPrompt) : null,
    width: Math.max(0, hiIndex - lo.index),
    bounded: !!hi,
  };
}

/** A fresh, empty view model. The view is a band plus the navigation state a renderer needs:
 *  the learned band span, the accumulated anchors, and a `generation` counter that bumps on
 *  every REPLACE (so a renderer can throw away cached DOM nodes / a scroll anchor wholesale).
 *  The view holds no jump/target state of its own: a jump is driven by the caller passing
 *  (kind, number) to `planJump`, which keeps this model free of hidden in-flight state. */
export function emptyView() {
  return {
    rows: [],
    start: 0,
    end: 0,
    total: 0,
    promptOffset: 0,
    responseOffset: 0,
    truncatedBefore: false,
    truncatedAfter: false,
    truncated: false,
    isBand: false,
    generation: 0,
    seq: 0,
    anchors: [ORIGIN_ANCHOR],
    bandBefore: null,
    bandAfter: null,
  };
}

function viewFromBand(band, prev, generation) {
  return {
    rows: band.rows,
    start: band.start,
    end: band.end,
    total: band.total,
    promptOffset: band.promptOffset,
    responseOffset: band.responseOffset,
    truncatedBefore: band.start > 0,
    truncatedAfter: band.end < band.total,
    truncated: band.start > 0 || band.end < band.total,
    isBand: !!band.isBand,
    generation,
    seq: prev.seq,
    anchors: prev.anchors,
    bandBefore: prev.bandBefore,
    bandAfter: prev.bandAfter,
  };
}

/**
 * applyBand(view, band, opts) → { view, action, reason, conflict }
 *
 * The reconciliation step. Two DISTINCT operations, because they mean different things to the
 * user and to the renderer:
 *
 *   mode "extend"  — the user scrolled past an edge. MERGE into what is already loaded, and
 *                    keep `generation` (the existing rows stay mounted; only the new ones are
 *                    appended/prepended). Falls back to a replace when the bands cannot be
 *                    merged, and says so in `reason`.
 *   mode "replace" — the user jumped somewhere else. DROP what is loaded and bump
 *                    `generation`, because none of the mounted rows are reusable.
 *   mode "auto"    — merge if mergeable, replace otherwise. The default.
 *
 * `opts.center` is the row index that was REQUESTED as `around`. When given, and the returned
 * band was not clamped at either end, the real band half-widths are learned from it and used
 * for subsequent `planExtend` calls — CONTRACT §4 explicitly says to derive the span rather
 * than hardcode 501.
 */
export function applyBand(view, band, opts = {}) {
  const v = view && typeof view === "object" ? view : emptyView();
  const b = band && typeof band === "object" && Array.isArray(band.rows) ? band : null;
  if (!b) return { view: v, action: "ignored", reason: "no-band", conflict: false };

  const mode = opts.mode === "extend" || opts.mode === "replace" ? opts.mode : "auto";
  const held = v.rows.length > 0 ? { ...v } : null;

  let action = "replaced";
  let reason = "replace";
  let conflict = false;
  let next = b;

  if (held && mode !== "replace") {
    const m = mergeBands(held, b);
    if (m.ok) {
      next = m.band;
      action = "extended";
      reason = m.reason;
    } else {
      conflict = m.conflict;
      reason = m.reason; // "gap" | "offset-conflict"
      action = "replaced";
    }
  }

  const generation = action === "extended" ? v.generation : v.generation + 1;
  const out = viewFromBand(next, v, generation);

  // Record the two anchors this band proves, whatever we did with its rows. Even a band we
  // REJECTED for merging told us the truth about where it sits, and that knowledge is what
  // makes the next probe of a jump smarter.
  const seq = Math.max(0, intOr(v.seq, 0)) + 1;
  const inBand = countRoles(b.rows, b.rows.length);
  out.seq = seq;
  out.anchors = sanitizeAnchors([
    ...anchorsOf(v),
    ORIGIN_ANCHOR,
    makeAnchor(b.start, b.promptOffset, b.responseOffset, seq),
    makeAnchor(b.end, b.promptOffset + inBand.prompts, b.responseOffset + inBand.responses, seq),
  ]);

  // Learn the real band span from an UNCLAMPED around-response only. A clamped band (it hit
  // row 0 or the live end) is narrower than the server's true span and would under-estimate
  // every future extension.
  const center = intOr(opts.center, NaN);
  if (b.isBand && isNum(center) && b.start > 0 && b.end < b.total) {
    const before = center - b.start;
    const after = b.end - center - 1;
    if (before >= 0 && after >= 0) {
      out.bandBefore = before;
      out.bandAfter = after;
    }
  }
  return { view: out, action, reason, conflict };
}

/** The learned (or fallback) band half-widths. */
export function bandSpanOf(view) {
  const v = view && typeof view === "object" ? view : null;
  const before = v && isNum(v.bandBefore) && v.bandBefore >= 0 ? v.bandBefore : DEFAULT_BAND.before;
  const after = v && isNum(v.bandAfter) && v.bandAfter >= 0 ? v.bandAfter : DEFAULT_BAND.after;
  return { before, after, learned: !!(v && isNum(v.bandBefore) && isNum(v.bandAfter)) };
}

/**
 * viewAffordances(view) → what the UI may HONESTLY claim about what is off-screen.
 *
 * The distinction that matters: `turnsAbove` is EXACT (it is literally
 * promptOffset + responseOffset — the server counted it), while the number of turns BELOW the
 * window is genuinely unknown, because `transcriptTotal` counts ROWS and rows include tool
 * output. So `turnsBelow` is null unless the view already reaches the end, in which case it is
 * 0. Render "N earlier turns" above and only "more below" (no count) below — do not invent a
 * number by dividing rows by two.
 */
export function viewAffordances(view) {
  const v = view && typeof view === "object" ? view : emptyView();
  const rows = Array.isArray(v.rows) ? v.rows : [];
  const start = Math.max(0, intOr(v.start, 0));
  const end = Math.max(start, intOr(v.end, start + rows.length));
  const total = Math.max(end, intOr(v.total, end));
  const range = bandTurnRange({ rows, promptOffset: v.promptOffset, responseOffset: v.responseOffset });
  const rowsBelow = Math.max(0, total - end);
  return {
    rowsAbove: start,
    rowsBelow,
    hasAbove: start > 0,
    hasBelow: rowsBelow > 0,
    atStart: start === 0,
    atEnd: rowsBelow === 0,
    promptsAbove: Math.max(0, intOr(v.promptOffset, 0)),
    responsesAbove: Math.max(0, intOr(v.responseOffset, 0)),
    turnsAbove: Math.max(0, intOr(v.promptOffset, 0)) + Math.max(0, intOr(v.responseOffset, 0)),
    turnsBelow: rowsBelow === 0 ? 0 : null,
    loadedRows: rows.length,
    totalRows: total,
    coverage: total > 0 ? rows.length / total : 0,
    firstPrompt: range.promptStart || null,
    lastPrompt: range.promptEnd || null,
    firstResponse: range.responseStart || null,
    lastResponse: range.responseEnd || null,
  };
}

/**
 * estimateIndexOfTurn(view, kind, number, opts) → { index, exact, confidence, reason, bracket }
 *
 * Turn number → ROW INDEX, which is the conversion `around` forces on us (CONTRACT §4:
 * "`around` is a ROW INDEX into the transcript array, not a P#/R# number. Convert first").
 *
 * Exact only for a turn the view currently HOLDS. Otherwise it is a probe, computed from the
 * anchors (see above) that bracket the target:
 *
 *   strategy "interpolate" (default) — assume the rows between the bracketing anchors are
 *     evenly divided among the turns between them, and land proportionally. On real
 *     transcripts this hits the band first time.
 *   strategy "bisect" — take the midpoint of the bracket instead. Slower to converge when
 *     density IS even, but immune to it being uneven, which is why `planJump` switches to it
 *     after the first miss. This is what turns "usually fine" into a bound.
 *
 * `confidence` is "exact" | "interpolated" | "bisected" | "extrapolated" (past every anchor —
 * we know it is somewhere ahead, not where) | "guess" (no usable information at all). Anything
 * other than "exact" is a PROBE and must be confirmed with `containsTurn` on the band that
 * comes back — never rendered as "you are looking at turn N".
 */
export function estimateIndexOfTurn(view, kind, number, opts = {}) {
  const v = view && typeof view === "object" ? view : emptyView();
  const rows = Array.isArray(v.rows) ? v.rows : [];
  const target = intOr(number, NaN);
  const wantPrompt = kind !== KIND_RESPONSE;
  const bisect = opts && opts.strategy === "bisect";
  if (!isNum(target) || target < 1) {
    return { index: 0, exact: false, confidence: "guess", reason: "bad-number", bracket: null };
  }

  const exact = indexOfTurn({ rows, start: v.start, promptOffset: v.promptOffset, responseOffset: v.responseOffset }, kind, target);
  if (exact >= 0) return { index: exact, exact: true, confidence: "exact", reason: "loaded", bracket: null };

  const start = Math.max(0, intOr(v.start, 0));
  const end = Math.max(start, intOr(v.end, start + rows.length));
  const total = Math.max(end, intOr(v.total, end));
  const lastIndex = Math.max(0, total - 1);
  if (total === 0) return { index: 0, exact: false, confidence: "guess", reason: "empty", bracket: null };

  const bracket = turnBracket(v, kind, target);

  if (bracket.bounded) {
    // The turn is somewhere in [bracket.lo, bracket.hi). Both ends are FACTS.
    const span = bracket.hi - bracket.lo;
    const turns = bracket.hiCount - bracket.loCount;
    let idx;
    let confidence;
    if (bisect || turns <= 0) {
      idx = bracket.lo + Math.floor(span / 2);
      confidence = "bisected";
    } else {
      idx = bracket.lo + Math.round((target - bracket.loCount - 0.5) * (span / turns));
      confidence = "interpolated";
    }
    return {
      index: clamp(idx, bracket.lo, Math.max(bracket.lo, bracket.hi - 1)),
      exact: false,
      confidence,
      reason: "bracketed",
      bracket,
    };
  }

  // Past every anchor: the turn is somewhere in [bracket.lo, total). Bisect that, or
  // extrapolate with the best density sample we have (the loaded band's own).
  const inBand = countRoles(rows, rows.length);
  const bandCount = wantPrompt ? inBand.prompts : inBand.responses;
  if (bisect) {
    const idx = clamp(bracket.lo + Math.floor((total - bracket.lo) / 2), bracket.lo, lastIndex);
    return { index: idx, exact: false, confidence: "bisected", reason: "beyond-anchors", bracket };
  }
  let rowsPerTurn;
  let confidence = "extrapolated";
  if (bandCount > 0 && end > start) rowsPerTurn = (end - start) / bandCount;
  else if (bracket.loCount > 0 && bracket.lo > 0) rowsPerTurn = bracket.lo / bracket.loCount;
  else { rowsPerTurn = 2; confidence = "guess"; } // last resort: strict prompt/response alternation
  const ahead = target - bracket.loCount;
  const idx = clamp(Math.round(bracket.lo + (ahead - 0.5) * rowsPerTurn), bracket.lo, lastIndex);
  return { index: idx, exact: false, confidence, reason: "beyond-anchors", bracket };
}

/**
 * planJump(view, kind, number, opts) → the control args for a jump-to-#N, plus honesty flags.
 *
 * { args: { sessionKey?, around, scoped? }, around, exact, confidence, attempt, exhausted,
 *   satisfied }
 *
 * `satisfied: true` means the view ALREADY holds that turn and no request is needed (args is
 * still returned so a caller can re-centre if it wants). `exhausted: true` means we have spent
 * `MAX_JUMP_ATTEMPTS` probes without landing on the turn — the UI should stop and say "closest
 * we could get", not keep fetching.
 *
 * Note `around` is clamped to [0, total-1]. The server clamps too (CONTRACT §4: an
 * out-of-range `around` yields a valid clamped band, never an error), but clamping here keeps
 * the CACHE key honest — an unclamped 99999 and a clamped 1199 must not be two cache entries
 * for the same band.
 */
export function planJump(view, kind, number, opts = {}) {
  const v = view && typeof view === "object" ? view : emptyView();
  const attempt = Math.max(1, intOr(opts.attempt, 1));
  // Probe 1 interpolates (it lands on the turn outright on any normal transcript); every probe
  // after that bisects the bracket the previous miss narrowed, so convergence stops depending
  // on how evenly tool output happens to be spread. `opts.strategy` forces one or the other.
  const strategy = opts.strategy === "interpolate" || opts.strategy === "bisect"
    ? opts.strategy
    : (attempt > 1 ? "bisect" : "interpolate");
  const est = estimateIndexOfTurn(v, kind, number, { strategy });
  const total = Math.max(0, intOr(v.total, 0));
  const around = total > 0 ? clamp(est.index, 0, total - 1) : 0;
  const args = { around };
  if (typeof opts.sessionKey === "string" && opts.sessionKey) args.sessionKey = opts.sessionKey;
  if (opts.scoped === true) args.scoped = true;
  return {
    args,
    around,
    kind: kind === KIND_RESPONSE ? KIND_RESPONSE : KIND_PROMPT,
    number: intOr(number, 0),
    exact: est.exact,
    confidence: est.confidence,
    reason: est.reason,
    bracket: est.bracket,
    strategy,
    attempt,
    exhausted: attempt >= MAX_JUMP_ATTEMPTS && !est.exact,
    satisfied: est.exact,
  };
}

/**
 * planExtend(view, direction, opts) → the control args to grow the window, or null at the edge.
 *
 * `direction` is "up" (older) or "down" (newer). The requested centre is chosen so the band
 * that comes back OVERLAPS the held one by `EXTEND_OVERLAP` rows — that guarantees
 * `mergeBands` sees adjacency rather than a gap even if the server clamps the far side.
 *
 * Returns { args, around, direction, predicted: { start, end }, overlap } or null.
 */
export function planExtend(view, direction, opts = {}) {
  const v = view && typeof view === "object" ? view : emptyView();
  const rows = Array.isArray(v.rows) ? v.rows : [];
  const start = Math.max(0, intOr(v.start, 0));
  const end = Math.max(start, intOr(v.end, start + rows.length));
  const total = Math.max(end, intOr(v.total, end));
  if (total <= 0) return null;

  const span = bandSpanOf(v);
  const overlap = Math.max(0, intOr(opts.overlap, EXTEND_OVERLAP));
  const up = direction !== "down";

  if (up && start <= 0) return null;
  if (!up && end >= total) return null;

  // up:   want the returned band to END at (start + overlap) ⇒ centre = start + overlap - after - 1
  // down: want the returned band to START at (end - overlap)  ⇒ centre = end - overlap + before
  const raw = up ? start + overlap - span.after - 1 : end - overlap + span.before;
  const around = clamp(raw, 0, total - 1);
  const args = { around };
  if (typeof opts.sessionKey === "string" && opts.sessionKey) args.sessionKey = opts.sessionKey;
  if (opts.scoped === true) args.scoped = true;
  return {
    args,
    around,
    direction: up ? "up" : "down",
    overlap,
    predicted: {
      start: clamp(around - span.before, 0, total),
      end: clamp(around + span.after + 1, 0, total),
    },
  };
}
