// recallCue — pure shaping for the inline "🔍 Looking up historical turns…" cue and the recalled
// turn that replaces it (ROADMAP 2.5 / T3.5). Consumes the `lookingUp` / `recall` event pair
// described in docs/work/agentic-chat-engine/CONTRACT.md §3b and §5.
//
// TWO THINGS THIS MODULE REFUSES TO DO, because they are the failure modes that matter:
//
//   1. A STUCK SPINNER. The contract guarantees exactly one `lookingUp` and exactly one terminal
//      `recall` per accepted request — including on the not-found, unknown-conversation and
//      internal-error paths — and one bare `recall` with no `lookingUp` on the refusal path. So the
//      reducer here treats ANY `recall` as "cue off", unconditionally, even one it never saw a
//      `lookingUp` for. There is no code path that leaves `active: true`.
//
//   2. A SILENT NO-OP. Every outcome produces something renderable. "Nothing matched" is a result,
//      not an absence, and it carries the server's own explanation (which distinguishes "not
//      archived yet" from "still in the active window") verbatim.
//
// PROVENANCE IS THE POINT. A recalled excerpt is only trustworthy if the reader can see WHERE it
// came from, so every hit is shaped with its absolute P#/R# number and its stable `segmentRef`, and
// images are only ever marked renderable when the `workspaceId` needed to resolve them is present
// (CONTRACT.md §5: an image path is relative to the workspace dir — never build the URL without it).
//
// PURE: no imports, no Date, no DOM, no fetch. Deterministic for a given input.

/** Excerpt cap for an inline recalled turn. Anything longer is cut WITH a visible marker. */
export const RECALL_EXCERPT_MAX_CHARS = 2000;

/** Client-side cap on rendered query hits. The server's own `limit` defaults to 10 (CONTRACT §5);
 *  this is an independent guard so a future larger `limit` cannot flood the transcript. */
export const RECALL_MAX_HITS = 10;

/** The route that resolves an archived image (see dashboard/public/app.js). */
export const RECALL_IMAGE_ROUTE = "/api/workspace/image";

/** Terminal outcomes. `pending` only ever appears while a `lookingUp` is outstanding. */
export const RECALL_STATUSES = ["pending", "hit", "hits", "empty", "refused", "error"];

/** Why a recall produced nothing. NOTE: the server carries no machine-readable reason code — only a
 *  human `error` string — so these are recovered by matching the known strings, with an honest
 *  "internal-error" fallback for anything unrecognized. See `classifyRecallError`. */
export const RECALL_REASONS = ["not-found", "no-archive", "refused", "internal-error"];

export const RECALL_CUE_INITIAL = Object.freeze({ active: false, request: null, result: null });

const isObj = (v) => v !== null && typeof v === "object";
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const str = (v) => (typeof v === "string" ? v : "");
const posInt = (v) => (fin(Number(v)) && Number(v) >= 1 ? Math.floor(Number(v)) : null);

const kindOf = (v) => (v === "response" ? "response" : "prompt");

/** "P#12" / "R#1237" — the same coordinate the transcript already labels rows with. */
export function recallRef(kind, number) {
  const n = posInt(number);
  return `${kindOf(kind) === "response" ? "R" : "P"}#${n === null ? "?" : n}`;
}

/**
 * classifyRecallError(error) → one of RECALL_REASONS.
 *
 * String sniffing, deliberately: `lib/workspace.mjs _recall` emits four distinguishable messages but
 * no code. Unrecognized text falls back to "internal-error" — the safe direction, because it renders
 * the raw message rather than claiming a clean "nothing matched".
 */
export function classifyRecallError(error) {
  const s = str(error).trim();
  if (!s) return "internal-error";
  if (/^nothing to recall\b/i.test(s)) return "refused";
  if (/^no archive for this conversation\b/i.test(s)) return "no-archive";
  if (/^no archived (prompt|response) #/i.test(s)) return "not-found";
  if (/^nothing archived matches\b/i.test(s)) return "not-found";
  return "internal-error";
}

/**
 * recallExcerpt(text, max) → { text, display, marker, truncated, omittedChars, fullLength }
 *
 * Hard cut at `max` characters (a hard cut is deterministic; a word-boundary cut is not, once the
 * text may be code). `display` is what to render when you want the marker inline; `marker` is
 * separated out so a UI can render it as a chip / "show full turn" affordance instead.
 */
export function recallExcerpt(text, max = RECALL_EXCERPT_MAX_CHARS) {
  const full = str(text);
  const cap = fin(max) && max > 0 ? Math.floor(max) : RECALL_EXCERPT_MAX_CHARS;
  if (full.length <= cap) {
    return { text: full, display: full, marker: "", truncated: false, omittedChars: 0, fullLength: full.length };
  }
  const cut = full.slice(0, cap);
  const omitted = full.length - cap;
  const marker = `… [truncated — ${omitted} more character${omitted === 1 ? "" : "s"} of ${full.length}]`;
  return { text: cut, display: `${cut}\n${marker}`, marker, truncated: true, omittedChars: omitted, fullLength: full.length };
}

/** recallImageUrl(workspaceId, path, route?) → the resolvable URL, or null when it CANNOT be built.
 *  Returning null (rather than a workspace-less URL that 404s) is the whole guard. */
export function recallImageUrl(workspaceId, path, route = RECALL_IMAGE_ROUTE) {
  const w = str(workspaceId);
  const p = str(path);
  if (!w || !p) return null;
  return `${route}?workspaceId=${encodeURIComponent(w)}&path=${encodeURIComponent(p)}`;
}

/** recallImageRefs(hit, route?) → [{ path, hash, mediaType, workspaceId, url, resolvable }]
 *  Only meaningful in NUMBER mode: a query hit's `images` is a COUNT, not an array (CONTRACT §5),
 *  and is deliberately not coerced into fake refs. */
export function recallImageRefs(hit, route = RECALL_IMAGE_ROUTE) {
  if (!isObj(hit) || !Array.isArray(hit.images)) return [];
  const workspaceId = str(hit.workspaceId);
  const out = [];
  for (const im of hit.images) {
    if (!isObj(im)) continue;
    const path = str(im.path);
    if (!path) continue;
    const url = recallImageUrl(workspaceId, path, route);
    out.push({ path, hash: str(im.hash), mediaType: str(im.mediaType), workspaceId, url, resolvable: url !== null });
  }
  return out;
}

/** recallProvenance(hitLike) → where this text came from, in renderable form. `linkable` is false
 *  when the archive did not give us a stable segment id to deep-link to. */
export function recallProvenance(hitLike) {
  const h = isObj(hitLike) ? hitLike : {};
  const kind = kindOf(h.kind);
  const number = posInt(h.number);
  const segmentRef = str(h.segmentRef);
  const workspaceId = str(h.workspaceId);
  const ref = recallRef(kind, number);
  return {
    kind, number, segmentRef, workspaceId, ref,
    label: segmentRef ? `${ref} · ${segmentRef}` : ref,
    linkable: !!segmentRef,
    resolvable: !!workspaceId,
  };
}

const hitKey = (h) => `${str(h.segmentRef)}|${kindOf(h.kind)}|${posInt(h.number)}`;

/**
 * rankRecallHits(hits, query, opts?) → a deterministic ordering, deduped and capped.
 *
 * The server does NOT rank: it returns a newest-segment-first substring scan (CONTRACT §5). That
 * order is the default everywhere in this module, because it is the documented, stable one. This is
 * the opt-in alternative (`order: "relevance"`), scored purely on what a snippet can tell us:
 *   1. more occurrences of the needle   2. earlier first occurrence
 *   3. higher absolute turn number (more recent)   4. original position (final tiebreak)
 * Every tiebreak is total, so the result never depends on sort stability.
 */
export function rankRecallHits(hits, query, opts = {}) {
  const limit = fin(opts && opts.limit) && opts.limit > 0 ? Math.floor(opts.limit) : RECALL_MAX_HITS;
  const needle = str(query).trim().toLowerCase();
  const rows = dedupeHits(hits);
  const scored = rows.map((h, i) => {
    const snippet = str(h.snippet).toLowerCase();
    let occurrences = 0;
    let first = Number.MAX_SAFE_INTEGER;
    if (needle) {
      let idx = snippet.indexOf(needle);
      if (idx >= 0) first = idx;
      while (idx >= 0) { occurrences++; idx = snippet.indexOf(needle, idx + needle.length); }
    }
    return { h, i, occurrences, first, number: posInt(h.number) ?? 0 };
  });
  scored.sort((a, b) =>
    (b.occurrences - a.occurrences) ||
    (a.first - b.first) ||
    (b.number - a.number) ||
    (a.i - b.i));
  return scored.slice(0, limit).map((s) => s.h);
}

function dedupeHits(hits) {
  if (!Array.isArray(hits)) return [];
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    if (!isObj(h)) continue;
    const key = hitKey(h);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

/**
 * shapeLookingUp(event, opts?) → the ON half of the cue.
 *   { active: true, mode, kindOf, number, query, label, at }
 * Returns null for anything that is not a `lookingUp` event.
 */
export function shapeLookingUp(event, opts = {}) {
  if (!isObj(event) || event.kind !== "lookingUp") return null;
  const mode = event.mode === "number" ? "number" : "query";
  const k = kindOf(event.kindOf);
  const number = posInt(event.number);
  const query = str(event.query);
  const label = mode === "number"
    ? `Looking up ${recallRef(k, number)}…`
    : `Searching archived turns for “${query}”…`;
  return {
    active: true, mode, kindOf: k, number, query, label,
    at: fin(event.at) ? event.at : (fin(opts && opts.now) ? opts.now : null),
  };
}

function shapeQueryHit(h, opts) {
  const prov = recallProvenance(h);
  const excerpt = recallExcerpt(str(h.snippet), opts.maxChars);
  const imageCount = fin(Number(h.images)) && Number(h.images) > 0 ? Math.floor(Number(h.images)) : 0;
  return {
    ref: prov.ref, kind: prov.kind, number: prov.number,
    segmentRef: prov.segmentRef, workspaceId: prov.workspaceId, provenance: prov,
    excerpt, snippet: excerpt.display,
    images: [], imageCount, imagesResolvable: imageCount > 0 ? prov.resolvable : true,
  };
}

function shapeNumberHit(h, opts) {
  const prov = recallProvenance(h);
  const excerpt = recallExcerpt(str(h.text), opts.maxChars);
  const images = recallImageRefs(h, opts.imageRoute || RECALL_IMAGE_ROUTE);
  return {
    ref: prov.ref, kind: prov.kind, number: prov.number,
    segmentRef: prov.segmentRef, workspaceId: prov.workspaceId, provenance: prov,
    excerpt, text: excerpt.display,
    images, imageCount: images.length,
    imagesResolvable: images.every((im) => im.resolvable),
    row: isObj(h.row) ? h.row : null,
  };
}

/**
 * shapeRecallCue(event, opts?) → the OFF half: what to render in the transcript.
 *
 * opts = { maxChars, limit, order: "server"|"relevance", imageRoute, now }
 *
 * Returns:
 * {
 *   active: false, ok, status, reason, mode, kindOf, number, query,
 *   message, error, at,
 *   hit, hits, totalHits, shownHits, capped
 * }
 *
 * `status` is one of RECALL_STATUSES minus "pending". `mode` is taken from the event but INFERRED
 * from the payload shape when absent, so an older/odd event still renders.
 */
export function shapeRecallCue(event, opts = {}) {
  if (!isObj(event) || event.kind !== "recall") return null;
  const o = isObj(opts) ? opts : {};
  const at = fin(event.at) ? event.at : (fin(o.now) ? o.now : null);
  const mode = event.mode === "number" || event.mode === "query"
    ? event.mode
    : (isObj(event.hit) || fin(event.number) ? "number" : "query");
  const k = kindOf(event.kindOf ?? (isObj(event.hit) ? event.hit.kind : undefined));
  const number = posInt(event.number ?? (isObj(event.hit) ? event.hit.number : undefined));
  const query = str(event.query);
  const error = str(event.error);
  const ok = event.ok === true;

  const base = { active: false, mode, kindOf: k, number, query, error: error || null, at };

  if (mode === "number") {
    const hit = ok && isObj(event.hit) ? shapeNumberHit(event.hit, o) : null;
    if (hit) {
      return {
        ...base, ok: true, status: "hit", reason: null, hit, hits: [],
        totalHits: 1, shownHits: 1, capped: false,
        message: `${hit.provenance.label}`,
      };
    }
    const reason = missReason(error);
    return {
      ...base, ok: false, status: statusFor(reason),
      reason, hit: null, hits: [], totalHits: 0, shownHits: 0, capped: false,
      message: recallMessage(reason, error, { mode, kindOf: k, number, query }),
    };
  }

  const raw = dedupeHits(event.hits);
  const limit = fin(o.limit) && o.limit > 0 ? Math.floor(o.limit) : RECALL_MAX_HITS;
  const ordered = o.order === "relevance" ? rankRecallHits(raw, query, { limit }) : raw.slice(0, limit);
  const hits = ordered.map((h) => shapeQueryHit(h, o));

  if (hits.length) {
    return {
      ...base, ok: true, status: "hits", reason: null, hit: null, hits,
      totalHits: raw.length, shownHits: hits.length, capped: raw.length > hits.length,
      message: `${raw.length} archived turn${raw.length === 1 ? "" : "s"} match “${query}”${raw.length > hits.length ? ` (showing ${hits.length})` : ""}`,
    };
  }

  const reason = missReason(error);
  return {
    ...base, ok: false, status: statusFor(reason),
    reason, hit: null, hits: [], totalHits: 0, shownHits: 0, capped: false,
    message: recallMessage(reason, error, { mode, kindOf: k, number, query }),
  };
}

// `classifyRecallError` is the pure string classifier: hand it a message you believe exists and an
// unrecognized one fails safe to "internal-error". Here the situation is different — NO message at
// all means the server reported no failure, so the honest reading of an empty result is
// "nothing matched", not "something broke".
const missReason = (error) => (error ? classifyRecallError(error) : "not-found");
const statusFor = (reason) => (reason === "refused" ? "refused" : reason === "internal-error" ? "error" : "empty");

// The server's `error` text is already human-readable and more specific than anything we could
// invent (it distinguishes "not archived" from "still in the active window"), so it is preferred
// verbatim. These fallbacks only cover an event that arrived with no message at all.
function recallMessage(reason, error, ctx) {
  if (error) return reason === "internal-error" ? `Recall failed: ${error}` : error;
  if (reason === "refused") return "Nothing to recall — give a turn number or a search query.";
  if (reason === "no-archive") return "No archive for this conversation yet.";
  if (ctx.mode === "number") return `No archived ${ctx.kindOf} ${recallRef(ctx.kindOf, ctx.number)} — it may still be in the active window.`;
  return "Nothing archived matches that.";
}

/**
 * reduceRecallCue(state, event, opts?) → { active, request, result }
 *
 * The strict ON/OFF pair, as a reducer:
 *   - `lookingUp` → `active: true`, `request` set, previous `result` cleared
 *   - `recall`    → `active: false` ALWAYS, `result` set (even with no preceding `lookingUp`, which
 *                   is exactly the refusal path in CONTRACT §3b)
 *   - anything else, or junk → state returned unchanged
 *
 * ROUTING: `lookingUp`/`recall` are manager-sent and do NOT repeat `sessionKey` in the body
 * (CONTRACT §0), so the caller must key this reducer per conversation using the FRAME's sessionKey.
 * This function deliberately does not guess.
 */
export function reduceRecallCue(state, event, opts = {}) {
  const base = isObj(state) ? state : RECALL_CUE_INITIAL;
  if (!isObj(event)) return base;

  if (event.kind === "lookingUp") {
    const request = shapeLookingUp(event, opts);
    return request ? { active: true, request, result: null } : base;
  }

  if (event.kind === "recall") {
    const result = shapeRecallCue(event, opts);
    if (!result) return base;
    // `request` is kept for context (what was asked), but the cue is OFF regardless.
    return { active: false, request: isObj(base.request) ? base.request : null, result };
  }

  return base;
}

/** Clear the cue entirely (user dismissed the recalled block). Never leaves it spinning. */
export function dismissRecallCue() {
  return { active: false, request: null, result: null };
}

/** One line for the indicator strip. Returns "" when there is nothing to say. */
export function recallCueLabel(state) {
  if (!isObj(state)) return "";
  if (state.active && isObj(state.request)) return state.request.label;
  if (isObj(state.result)) return state.result.message;
  return "";
}
