// GENERATED FILE — DO NOT EDIT BY HAND.
// Source of truth: lib/{contextUsage,contextPopover,thresholdIndicator,transcriptWindow,scrollCache,agentsPanel,recallCue}.mjs
// Regenerate:  node dashboard/public/exocortex.gen.mjs
// Drift guard: lib/exocortexBundle.test.mjs re-runs the generator and fails if this file is stale.
//
// A classic script (same stance as md-mini.js / deploy-helpers.js) that publishes the Phase-2
// exocortex helpers as `window.EXO.<ns>` for dashboard/public/app.js, which cannot import ESM.
(function (root) {
  "use strict";
  var __m = {};

  // ---- lib/contextUsage.mjs → EXO.usage ----------------------------------------------
  __m.usage = (function (__imp) {
// contextUsage.mjs — pure, no imports.
// Shapes the Claude Agent SDK's SDKControlGetContextUsageResponse into a
// normalized, null-safe model the web client renders as a Claude-GUI-style
// context popover (colored bar + per-category legend + free space).
//
// SDK source shape (node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts,
// type SDKControlGetContextUsageResponse):
//   { categories[{name,tokens,color,isDeferred?}], totalTokens, maxTokens,
//     rawMaxTokens, percentage, gridRows[][{color,isFilled,categoryName,
//     tokens,percentage,squareFullness}], model, memoryFiles[{path,type,tokens}],
//     mcpTools[{name,serverName,tokens,isLoaded?}], deferredBuiltinTools?[],
//     systemTools?[{name,tokens}], systemPromptSections?[{name,tokens}], ... }

/**
 * Format a token count as a compact k/M string.
 * Examples: 0 -> "0", 940 -> "940", 316000 -> "316k", 1000000 -> "1M".
 * @param {number} n
 * @returns {string}
 */
function k(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) {
    const m = v / 1_000_000;
    // Trim trailing ".0"
    const s = m.toFixed(m % 1 === 0 ? 0 : 1);
    return `${s}M`;
  }
  if (abs >= 1000) {
    return `${Math.round(v / 1000)}k`;
  }
  return `${Math.round(v)}`;
}

function num(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function pctOf(tokens, maxTokens) {
  return maxTokens > 0 ? round1((num(tokens) / maxTokens) * 100) : 0;
}

const EMPTY = Object.freeze({
  ok: false,
  totalTokens: 0,
  maxTokens: 0,
  percentage: 0,
  model: '',
  categories: [],
  grid: [],
  free: { tokens: 0, pct: 0 },
  memoryFiles: [],
  mcpTools: [],
  systemTools: [],
  systemPromptSections: [],
});

/**
 * Normalize an SDKControlGetContextUsageResponse into a client-friendly,
 * null-safe shape. Never throws.
 *
 * @param {any} resp
 * @returns {{
 *   ok: boolean,
 *   totalTokens: number,
 *   maxTokens: number,
 *   percentage: number,
 *   model: string,
 *   categories: {name:string,tokens:number,color:string,pct:number,isDeferred:boolean}[],
 *   grid: {color:string,isFilled:boolean,tokens:number,pct:number}[][],
 *   free: {tokens:number,pct:number},
 *   memoryFiles: {path:string,type:string,tokens:number}[],
 *   mcpTools: {name:string,serverName:string,tokens:number,isLoaded:boolean}[],
 *   systemTools: {name:string,tokens:number}[],
 *   systemPromptSections: {name:string,tokens:number}[],
 * }}
 */
function shapeContextUsage(resp) {
  // Treat as malformed unless it's a plain object carrying the core numeric
  // fields the SDK always returns. Rejects null, arrays, primitives, {}, and
  // partial payloads missing totalTokens/maxTokens.
  if (
    !resp ||
    typeof resp !== 'object' ||
    Array.isArray(resp) ||
    !Number.isFinite(Number(resp.totalTokens)) ||
    !Number.isFinite(Number(resp.maxTokens))
  ) {
    return { ...EMPTY, free: { ...EMPTY.free } };
  }

  const maxTokens = num(resp.maxTokens);
  const totalTokens = num(resp.totalTokens);
  const percentage = Number.isFinite(Number(resp.percentage))
    ? round1(Number(resp.percentage))
    : (maxTokens > 0 ? round1((totalTokens / maxTokens) * 100) : 0);
  const model = typeof resp.model === 'string' ? resp.model : '';

  const categories = Array.isArray(resp.categories)
    ? resp.categories.filter((c) => c && typeof c === 'object').map((c) => ({
        name: typeof c.name === 'string' ? c.name : '',
        tokens: num(c.tokens),
        color: typeof c.color === 'string' ? c.color : '',
        pct: pctOf(c.tokens, maxTokens),
        isDeferred: c.isDeferred === true,
      }))
    : [];

  const grid = Array.isArray(resp.gridRows)
    ? resp.gridRows
        .filter((row) => Array.isArray(row))
        .map((row) =>
          row.filter((sq) => sq && typeof sq === 'object').map((sq) => ({
            color: typeof sq.color === 'string' ? sq.color : '',
            isFilled: sq.isFilled === true,
            tokens: num(sq.tokens),
            pct: Number.isFinite(Number(sq.percentage))
              ? round1(Number(sq.percentage))
              : pctOf(sq.tokens, maxTokens),
          }))
        )
    : [];

  const freeTokens = Math.max(0, maxTokens - totalTokens);
  const free = { tokens: freeTokens, pct: pctOf(freeTokens, maxTokens) };

  const memoryFiles = Array.isArray(resp.memoryFiles)
    ? resp.memoryFiles.filter((f) => f && typeof f === 'object').map((f) => ({
        path: typeof f.path === 'string' ? f.path : '',
        type: typeof f.type === 'string' ? f.type : '',
        tokens: num(f.tokens),
      }))
    : [];

  const mcpTools = Array.isArray(resp.mcpTools)
    ? resp.mcpTools.filter((t) => t && typeof t === 'object').map((t) => ({
        name: typeof t.name === 'string' ? t.name : '',
        serverName: typeof t.serverName === 'string' ? t.serverName : '',
        tokens: num(t.tokens),
        isLoaded: t.isLoaded === true,
      }))
    : [];

  const systemTools = Array.isArray(resp.systemTools)
    ? resp.systemTools.filter((t) => t && typeof t === 'object').map((t) => ({
        name: typeof t.name === 'string' ? t.name : '',
        tokens: num(t.tokens),
      }))
    : [];

  const systemPromptSections = Array.isArray(resp.systemPromptSections)
    ? resp.systemPromptSections
        .filter((s) => s && typeof s === 'object')
        .map((s) => ({
          name: typeof s.name === 'string' ? s.name : '',
          tokens: num(s.tokens),
        }))
    : [];

  return {
    ok: true,
    totalTokens,
    maxTokens,
    percentage,
    model,
    categories,
    grid,
    free,
    memoryFiles,
    mcpTools,
    systemTools,
    systemPromptSections,
  };
}

/**
 * Compact one-line summary of the shaped context usage.
 * Examples: "316k / 1M (32%)", or "316k (32%)" when maxTokens is absent.
 * @param {ReturnType<typeof shapeContextUsage>} shaped
 * @returns {string}
 */
function contextSummaryLabel(shaped) {
  if (!shaped || typeof shaped !== 'object') return '0 (0%)';
  const total = num(shaped.totalTokens);
  const max = num(shaped.maxTokens);
  const pct = num(shaped.percentage);
  if (max > 0) {
    return `${k(total)} / ${k(max)} (${Math.round(pct)}%)`;
  }
  return `${k(total)} (${Math.round(pct)}%)`;
}

    return { k: k, shapeContextUsage: shapeContextUsage, contextSummaryLabel: contextSummaryLabel };
  })({  });

  // ---- lib/contextPopover.mjs → EXO.popover ----------------------------------------------
  __m.popover = (function (__imp) {
  var k = __imp.k;
  var shapeContextUsage = __imp.shapeContextUsage;
  var contextSummaryLabel = __imp.contextSummaryLabel;
// contextPopover — pure shaping of the server's context breakdown into exactly what a
// popover renders: ordered segments (label + absolute tokens + percentage + a STABLE key
// for colouring), a total, and a headline percentage.
//
// Composes with lib/contextUsage.mjs rather than duplicating it:
//   - `shapeContextUsage()` normalizes the RAW SDK response  → we accept its output directly,
//     and will run it ourselves if handed a raw SDK response instead.
//   - `contextSummaryLabel()` produces the header badge text → we reuse it for `headline.text`.
//   - `k()` is the repo's existing compact token formatter    → re-exported here as `formatTokens`
//     (reuse over reinvention; there is no other formatter in the repo).
//
// CONTRACT.md §1: `contextBreakdown` is ALWAYS an object — when the session cannot answer it is
// the ZEROED shape with `ok: false`. That MUST render as "unavailable", never as "0% used".
// This module keeps those two apart explicitly:
//     available:false, state:"unavailable"   → nothing is known
//     available:true,  headline.pct === 0    → genuinely an empty context window
// Do not collapse them again.
//
// PURE: no DOM, no clocks, no randomness. Never throws.



/** The repo's compact token formatter (0 → "0", 316000 → "316k", 1000000 → "1M"). */


const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (x) => {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
};
const round1 = (x) => Math.round(x * 10) / 10;
// Strict numeric test — `Number(null)` is 0, which would report a missing percentage as "0%".
const isNum = (x) => (typeof x === 'number' || typeof x === 'string') && x !== '' && Number.isFinite(Number(x));

/**
 * Canonical, stable keys for the category names the SDK ships today. A key is what the client
 * hangs a colour/ordering/legend off, so it must survive a label rewording upstream.
 * Anything NOT in here is slugified and passed through (forward-compatible: an unknown future
 * segment kind is rendered with its own key, never dropped).
 */
const CATEGORY_KEYS = Object.freeze({
  'messages': 'messages',
  'conversation': 'messages',
  'system prompt': 'systemPrompt',
  'system prompts': 'systemPrompt',
  'system tools': 'systemTools',
  'tools': 'tools',
  'mcp tools': 'mcpTools',
  'memory files': 'memoryFiles',
  'memory': 'memoryFiles',
  'custom agents': 'customAgents',
  'deferred tools': 'deferredTools',
  'autocompact buffer': 'autocompactBuffer',
  'auto-compact buffer': 'autocompactBuffer',
  'free space': 'freeSpace',
});

/** Synthetic keys this module can mint (never collide with a real SDK category). */
const SEGMENT_KEY_OTHER = 'other';
const SEGMENT_KEY_FREE = 'free';

/**
 * Stable key for a category name. Known SDK names get a canonical camelCase key; unknown names
 * are slugified (`"Skill files" → "skill-files"`); an unusable name falls back to `segment`.
 * @param {string} name
 * @returns {string}
 */
function segmentKey(name) {
  const raw = typeof name === 'string' ? name.trim() : '';
  if (!raw) return 'segment';
  const known = CATEGORY_KEYS[raw.toLowerCase()];
  if (known) return known;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'segment';
}

/** "21%" / "2.6%" / "—" — one decimal, trailing ".0" trimmed. */
function pctLabel(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(Number(pct))) return '—';
  const v = round1(Number(pct));
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

/**
 * Largest-remainder apportionment in TENTHS of a percent.
 * Guarantees the returned integers sum EXACTLY to `targetTenths`, so per-segment percentages
 * can never compound rounding into a bar that is 99.7% or 100.4% wide.
 * @param {number[]} values non-negative weights
 * @param {number} targetTenths e.g. 1000 for 100.0%
 * @returns {number[]} integers in tenths of a percent
 */
function apportionTenths(values, targetTenths) {
  const vals = values.map((v) => Math.max(0, num(v)));
  const sum = vals.reduce((s, v) => s + v, 0);
  if (!(sum > 0) || !(targetTenths > 0) || vals.length === 0) return vals.map(() => 0);
  const exact = vals.map((v) => (v / sum) * targetTenths);
  const out = exact.map((v) => Math.floor(v));
  let rem = targetTenths - out.reduce((s, v) => s + v, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  let n = 0;
  while (rem > 0) {
    out[order[n % order.length].i] += 1;
    rem -= 1;
    n += 1;
  }
  return out;
}

const emptyPopover = (reason) => ({
  available: false,
  state: 'unavailable',
  reason,
  model: '',
  totalTokens: 0,
  maxTokens: 0,
  freeTokens: 0,
  pctBase: 'max',
  headline: {
    pct: null,
    pctLabel: '—',
    tokensLabel: '—',
    maxLabel: '—',
    text: 'Context usage unavailable',
    available: false,
  },
  segments: [],
  free: null,
  details: { memoryFiles: [], mcpTools: [], systemTools: [], systemPromptSections: [] },
  reconciliation: { kind: 'unavailable', deltaTokens: 0, overCapacity: false },
});

function normalizeInput(input) {
  // Already-shaped breakdown (has an explicit ok flag) — CONTRACT.md §1 guarantees this shape.
  if (isObj(input) && typeof input.ok === 'boolean') {
    return input.ok ? input : null;
  }
  // Raw SDK response (or a server payload we were handed unshaped) — shape it ourselves so the
  // caller can pass `event.usage` or `event.contextBreakdown` interchangeably.
  if (isObj(input)) {
    const shaped = shapeContextUsage(input);
    return shaped.ok ? shaped : null;
  }
  return null;
}

function detailList(list, keyFields) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(isObj)
    .map((row) => {
      const out = { tokens: num(row.tokens), tokensLabel: k(num(row.tokens)) };
      for (const f of keyFields) out[f] = typeof row[f] === 'string' ? row[f] : (row[f] ?? '');
      return out;
    })
    .sort((a, b) => b.tokens - a.tokens);
}

/**
 * Shape a context breakdown into a popover model.
 *
 * @param {any} input  the server's `contextBreakdown` (CONTRACT.md §1), OR a raw SDK
 *                     `SDKControlGetContextUsageResponse`, OR null/undefined/garbage.
 * @param {{ includeFree?: boolean }} [opts]  `includeFree` (default true) appends the free-space
 *                     slice to `segments` as well as exposing it on `free`.
 * @returns {{
 *   available: boolean,
 *   state: 'ready'|'unavailable',
 *   reason: string,
 *   model: string,
 *   totalTokens: number, maxTokens: number, freeTokens: number,
 *   pctBase: 'max'|'used',
 *   headline: { pct: number|null, pctLabel: string, tokensLabel: string, maxLabel: string, text: string, available: boolean },
 *   segments: { key:string, label:string, tokens:number, tokensLabel:string, pct:number, pctLabel:string,
 *               pctTenths:number, share:number, shareTenths:number, color:string, isDeferred:boolean,
 *               isSynthetic:boolean, isFree:boolean, order:number }[],
 *   free: object|null,
 *   details: { memoryFiles:any[], mcpTools:any[], systemTools:any[], systemPromptSections:any[] },
 *   reconciliation: { kind:'exact'|'padded'|'overflow'|'unavailable', deltaTokens:number, overCapacity:boolean }
 * }}
 */
function shapeContextPopover(input, opts = {}) {
  const includeFree = opts && opts.includeFree === false ? false : true;

  if (input === null || input === undefined) return emptyPopover('missing');
  if (!isObj(input)) return emptyPopover('malformed');
  const shaped = normalizeInput(input);
  // CONTRACT.md §1: ok:false is the zeroed "this session cannot answer" object — NOT an empty
  // context window. Report it as unavailable so the UI can say so in words.
  if (!shaped) return emptyPopover(isObj(input) && input.ok === false ? 'unsupported' : 'malformed');

  const maxTokens = Math.max(0, num(shaped.maxTokens));
  const totalTokens = Math.max(0, num(shaped.totalTokens));
  const model = typeof shaped.model === 'string' ? shaped.model : '';

  // --- segments, forward-compatibly ------------------------------------------------
  const rawCats = Array.isArray(shaped.categories) ? shaped.categories.filter(isObj) : [];
  const usedKeys = new Map();
  const segments = rawCats.map((c, i) => {
    const label = typeof c.name === 'string' && c.name.trim() ? c.name.trim() : 'Other';
    let key = segmentKey(c.name);
    // Keys must be UNIQUE as well as stable (they key DOM nodes / colour lookups).
    const seen = usedKeys.get(key) || 0;
    usedKeys.set(key, seen + 1);
    if (seen > 0) key = `${key}#${seen + 1}`;
    return {
      key,
      label,
      tokens: Math.max(0, num(c.tokens)),
      color: typeof c.color === 'string' ? c.color : '',
      isDeferred: c.isDeferred === true,
      isSynthetic: false,
      isFree: false,
      order: i,
    };
  });

  // --- reconcile the parts against the whole ---------------------------------------
  const segSum = segments.reduce((s, c) => s + c.tokens, 0);
  let reconciliation = { kind: 'exact', deltaTokens: 0, overCapacity: false };
  let usedForBar = segSum;
  if (segSum < totalTokens - 0.5) {
    // Categories account for LESS than the reported total → show the shortfall rather than a
    // bar that silently doesn't reach the headline number.
    const delta = totalTokens - segSum;
    segments.push({
      key: SEGMENT_KEY_OTHER,
      label: 'Other',
      tokens: delta,
      color: '',
      isDeferred: false,
      isSynthetic: true,
      isFree: false,
      order: segments.length,
    });
    reconciliation = { kind: 'padded', deltaTokens: round1(delta), overCapacity: false };
    usedForBar = totalTokens;
  } else if (segSum > totalTokens + 0.5) {
    // Categories account for MORE than the reported total → keep every category truthful and
    // widen the bar's basis instead of inventing a negative slice.
    reconciliation = { kind: 'overflow', deltaTokens: round1(segSum - totalTokens), overCapacity: false };
    usedForBar = segSum;
  }

  const freeTokens = Math.max(0, maxTokens - usedForBar);
  if (maxTokens > 0 && usedForBar > maxTokens) reconciliation = { ...reconciliation, overCapacity: true };

  // --- percentages that always add up ----------------------------------------------
  // `pct`   = share of maxTokens  (segments + free sum to EXACTLY 100.0%)
  // `share` = share of used       (segments alone sum to EXACTLY 100.0%)
  const pctBase = maxTokens > 0 ? 'max' : 'used';
  const freeSeg = {
    key: SEGMENT_KEY_FREE,
    label: 'Free space',
    tokens: freeTokens,
    color: '',
    isDeferred: false,
    isSynthetic: true,
    isFree: true,
    order: segments.length,
  };

  const pctWeights = pctBase === 'max' ? [...segments.map((s) => s.tokens), freeTokens] : segments.map((s) => s.tokens);
  const pctTenths = apportionTenths(pctWeights, 1000);
  const shareTenths = apportionTenths(segments.map((s) => s.tokens), 1000);

  // `pctTenths` is the EXACT integer apportionment (tenths of a percent). Sum it, not `pct` —
  // adding the one-decimal floats back up reintroduces the binary-float error this avoided.
  const decorate = (seg, tenths, share) => ({
    ...seg,
    tokensLabel: k(seg.tokens),
    pct: round1(tenths / 10),
    pctLabel: pctLabel(tenths / 10),
    pctTenths: tenths,
    share: round1(share / 10),
    shareTenths: share,
  });

  const outSegments = segments.map((seg, i) => decorate(seg, pctTenths[i] ?? 0, shareTenths[i] ?? 0));
  const outFree = decorate(freeSeg, pctBase === 'max' ? (pctTenths[segments.length] ?? 0) : 0, 0);
  if (includeFree) outSegments.push(outFree);

  // --- headline ---------------------------------------------------------------------
  const headlinePct = isNum(shaped.percentage)
    ? round1(Number(shaped.percentage))
    : (maxTokens > 0 ? round1((totalTokens / maxTokens) * 100) : null);

  const headline = {
    pct: headlinePct,
    pctLabel: pctLabel(headlinePct),
    tokensLabel: k(totalTokens),
    maxLabel: maxTokens > 0 ? k(maxTokens) : '—',
    // Reuse the existing badge formatter so the popover header and the compact header badge
    // can never drift apart.
    text: contextSummaryLabel({ totalTokens, maxTokens, percentage: headlinePct ?? 0 }),
    available: true,
  };

  return {
    available: true,
    state: 'ready',
    reason: '',
    model,
    totalTokens,
    maxTokens,
    freeTokens,
    pctBase,
    headline,
    segments: outSegments,
    free: outFree,
    details: {
      memoryFiles: detailList(shaped.memoryFiles, ['path', 'type']),
      mcpTools: detailList(shaped.mcpTools, ['name', 'serverName']),
      systemTools: detailList(shaped.systemTools, ['name']),
      systemPromptSections: detailList(shaped.systemPromptSections, ['name']),
    },
    reconciliation,
  };
}

/**
 * One-line popover subtitle. "unavailable" is worded as such — never "0%".
 * @param {ReturnType<typeof shapeContextPopover>} popover
 * @returns {string}
 */
function contextPopoverLabel(popover) {
  if (!isObj(popover) || !popover.available) return 'Context usage unavailable';
  return popover.headline.text;
}

    return { formatTokens: k, k: k, CATEGORY_KEYS: CATEGORY_KEYS, SEGMENT_KEY_OTHER: SEGMENT_KEY_OTHER, SEGMENT_KEY_FREE: SEGMENT_KEY_FREE, segmentKey: segmentKey, pctLabel: pctLabel, shapeContextPopover: shapeContextPopover, contextPopoverLabel: contextPopoverLabel };
  })({ k: __m.usage.k, shapeContextUsage: __m.usage.shapeContextUsage, contextSummaryLabel: __m.usage.contextSummaryLabel });

  // ---- lib/thresholdIndicator.mjs → EXO.ind ----------------------------------------------
  __m.ind = (function (__imp) {
  var k = __imp.k;
// thresholdIndicator — pure decision logic for the status line under the compose bar.
//
// Two jobs, both pure (state in → descriptor out; no timers, no DOM, no clocks):
//
//   1. The three transient indicator states of CONTRACT.md §3 — `rolling`, `lookingUp`, plus the
//      after-the-fact `compacted` confirmation and the §3d cold-load pair — reduced from the event
//      stream into a state object and shaped into renderable cues.
//   2. Context-fullness WARNING TIERS: "how full am I, and what should I do about it". The tiers are
//      actionable (roll / compact / new chat), not just a number, and every boundary is a named
//      exported constant.
//
// HONESTY RULES BAKED IN:
//
//   * CONTRACT.md §3c — there is NO live "compacting" signal. The SDK only emits a post-hoc
//     `compact_boundary`. So the `compacting` cue this module produces is a LOCAL INFERENCE from the
//     context percentage and is always stamped `inferred: true, confidence: "heuristic"`, with
//     hedged wording ("likely soon"). Never render it as server truth.
//   * CONTRACT.md §3b — `lookingUp` → `recall` is a strictly balanced pair. We honour that, and we
//     ALSO time it out (`LOOKING_UP_TIMEOUT_MS`): if the terminal `recall` is ever lost in transit
//     (dropped SSE frame on a flaky mobile link), the cue must not stay on forever. Belt and braces.
//   * CONTRACT.md §1 — an unavailable breakdown is NOT "0% used". `contextTier(null)` is the
//     distinct `unknown` tier, never `roomy`.
//   * CONTRACT.md §8 — indicators are data-driven off `INDICATOR_SPECS`, so a real pre-compaction
//     event (if the SDK ever ships one) is a new entry, not a restructure.
//
// Composes with: lib/contextUsage.mjs (`k` for token labels) and lib/contextPopover.mjs
// (`contextTierFromPopover` takes that module's output directly).



const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Strict: `Number(null)`/`Number([])` are 0, which would quietly turn "unavailable" into "0%"
// and a null `preTokens` into "0 tokens". Only real numbers (or numeric strings) count.
const finite = (x) => (typeof x === 'number' || typeof x === 'string') && x !== '' && Number.isFinite(Number(x));

// ---------------------------------------------------------------------------
// Warning tiers — the "I need an indicator of thresholds" ask.
// ---------------------------------------------------------------------------

/** Below this the window is comfortable and no advice is worth showing. */
const TIER_FILLING_PCT = 60;
/** Past this, act at the next natural break: roll or start a new chat. */
const TIER_ACT_NOW_PCT = 80;
/** Past this, auto-compaction is close and WILL silently drop detail. */
const TIER_CRITICAL_PCT = 92;

/**
 * The percentage at which we are willing to SAY "compaction is likely soon".
 * This is a client heuristic (CONTRACT.md §3c) — there is no server signal.
 */
const COMPACTING_INFERRED_PCT = TIER_CRITICAL_PCT;

/** Ordered low → high. `minPct` is inclusive. */
const CONTEXT_TIERS = Object.freeze([
  Object.freeze({
    key: 'roomy',
    minPct: 0,
    label: 'Comfortable',
    tone: 'ok',
    severity: 0,
    advice: 'Plenty of room left — keep going.',
    actions: Object.freeze([]),
  }),
  Object.freeze({
    key: 'filling',
    minPct: TIER_FILLING_PCT,
    label: 'Getting full',
    tone: 'notice',
    severity: 1,
    advice: 'Past halfway. Finish this thread, then roll to a fresh window at a natural break.',
    actions: Object.freeze(['roll']),
  }),
  Object.freeze({
    key: 'actNow',
    minPct: TIER_ACT_NOW_PCT,
    label: 'Act now',
    tone: 'warn',
    severity: 2,
    advice: 'Roll to a fresh window or start a new chat before the next long turn — history is kept and stays searchable.',
    actions: Object.freeze(['roll', 'newChat']),
  }),
  Object.freeze({
    key: 'critical',
    minPct: TIER_CRITICAL_PCT,
    label: 'Critical',
    tone: 'danger',
    severity: 3,
    advice: 'Auto-compaction is imminent and will drop detail you cannot get back. Roll now, or compact deliberately.',
    actions: Object.freeze(['roll', 'compact']),
  }),
]);

/** The tier used when the breakdown is UNAVAILABLE — deliberately not `roomy`. */
const TIER_UNKNOWN = Object.freeze({
  key: 'unknown',
  minPct: null,
  label: 'Unknown',
  tone: 'muted',
  severity: -1,
  advice: 'Context usage is unavailable for this conversation.',
  actions: Object.freeze([]),
});

/**
 * Which tier a context percentage falls into.
 * @param {number|null|undefined} percentage 0..100, or null/NaN when unavailable
 * @returns {{key:string,label:string,tone:string,severity:number,advice:string,actions:string[],pct:number|null,available:boolean,atOrAbove:number|null}}
 */
function contextTier(percentage) {
  if (!finite(percentage)) return { ...TIER_UNKNOWN, actions: [], pct: null, available: false, atOrAbove: null };
  const pct = Number(percentage);
  let tier = CONTEXT_TIERS[0];
  for (const t of CONTEXT_TIERS) if (pct >= t.minPct) tier = t;
  return { ...tier, actions: [...tier.actions], pct, available: true, atOrAbove: tier.minPct };
}

/**
 * Same, but fed straight from `shapeContextPopover()` output — the two modules compose without
 * the shell having to unwrap anything. An `available:false` popover yields the `unknown` tier.
 * @param {{available?:boolean, headline?:{pct?:number|null}}} popover
 */
function contextTierFromPopover(popover) {
  if (!isObj(popover) || popover.available !== true) return contextTier(null);
  const pct = isObj(popover.headline) ? popover.headline.pct : null;
  return contextTier(pct);
}

// ---------------------------------------------------------------------------
// Indicator lifetimes
// ---------------------------------------------------------------------------

/** §3a: a roll is fast and has NO paired "rolled" event → the cue self-expires. */
const ROLLING_CUE_MS = 4000;
/** §3b: `recall` always arrives — but if a frame is lost, drop the cue rather than wedge the UI. */
const LOOKING_UP_TIMEOUT_MS = 20000;
/** §3c: `compacted` is a confirmation, shown briefly and then gone. */
const COMPACTED_NOTICE_MS = 15000;
/** §3d: cold load of a >25 MB session log; 61 MB measured at ~42 s, so allow generous headroom. */
const COLD_LOAD_TIMEOUT_MS = 300000;

const INDICATOR_TTL_MS = Object.freeze({
  rolling: ROLLING_CUE_MS,
  lookingUp: LOOKING_UP_TIMEOUT_MS,
  compacted: COMPACTED_NOTICE_MS,
  coldLoad: COLD_LOAD_TIMEOUT_MS,
});

/**
 * Render specs, ordered by display priority (lowest `priority` wins the single-line slot).
 * Adding a state = adding an entry here. `confidence: "observed"` means a server event said so;
 * `"heuristic"` means the client inferred it.
 */
const INDICATOR_SPECS = Object.freeze({
  coldLoad: { kind: 'coldLoad', priority: 0, icon: '⏳', tone: 'notice', confidence: 'observed' },
  lookingUp: { kind: 'lookingUp', priority: 1, icon: '🔍', tone: 'notice', confidence: 'observed' },
  rolling: { kind: 'rolling', priority: 2, icon: '⟳', tone: 'notice', confidence: 'observed' },
  compacting: { kind: 'compacting', priority: 3, icon: '⟳', tone: 'warn', confidence: 'heuristic' },
  compacted: { kind: 'compacted', priority: 4, icon: '🗜', tone: 'ok', confidence: 'observed' },
});

/** The kinds that live in the reducer state (i.e. driven by server events). */
const INDICATOR_KINDS = Object.freeze(['coldLoad', 'lookingUp', 'rolling', 'compacted']);

// ---------------------------------------------------------------------------
// Reducer — one state object PER CONVERSATION (route on the frame's sessionKey, §0).
// ---------------------------------------------------------------------------

/** @returns a fresh, empty indicator state. */
function emptyIndicatorState() {
  return { rolling: null, lookingUp: null, compacted: null, coldLoad: null, lastRecall: null };
}

const base = (state) => (isObj(state) ? state : emptyIndicatorState());
const at = (event, now) => (finite(event && event.at) ? Number(event.at) : (finite(now) ? Number(now) : null));

/**
 * reduceIndicator(state, event, now) → new state (never mutates; unknown kinds are ignored).
 *
 * Handled event kinds (CONTRACT.md §3):
 *   rolling            → turns the roll cue on (self-expiring, no paired end event)
 *   lookingUp          → turns the recall cue ON
 *   recall             → turns the recall cue OFF (terminal, even on ok:false) + records the result
 *   compacted          → after-the-fact confirmation
 *   loadingHistory     → cold-load cue ON
 *   loadingHistoryDone → cold-load cue OFF
 *
 * @param {object} state
 * @param {{kind?:string}} event
 * @param {number} now epoch ms — used only when the event carries no `at`
 */
function reduceIndicator(state, event, now) {
  const st = base(state);
  if (!isObj(event) || typeof event.kind !== 'string') return st;
  const ts = at(event, now);

  switch (event.kind) {
    case 'rolling':
      return {
        ...st,
        rolling: {
          startedAt: ts,
          segment: finite(event.segment) ? Number(event.segment) : null,
          sourceRef: typeof event.sourceRef === 'string' ? event.sourceRef : '',
        },
      };

    case 'lookingUp':
      // A second lookingUp before the first resolved simply restarts the cue (and its timeout).
      return {
        ...st,
        lookingUp: {
          startedAt: ts,
          mode: typeof event.mode === 'string' ? event.mode : '',
          kindOf: typeof event.kindOf === 'string' ? event.kindOf : '',
          number: finite(event.number) ? Number(event.number) : null,
          query: typeof event.query === 'string' ? event.query : '',
        },
      };

    case 'recall':
      // Terminal for the cue on EVERY path — hit, miss, unknown conversation, internal error.
      // Also valid with no cue on at all (a refused request emits `recall` and no `lookingUp`).
      return {
        ...st,
        lookingUp: null,
        lastRecall: {
          at: ts,
          mode: typeof event.mode === 'string' ? event.mode : '',
          ok: event.ok === true,
          error: typeof event.error === 'string' ? event.error : '',
        },
      };

    case 'compacted':
      return {
        ...st,
        compacted: {
          startedAt: ts,
          trigger: event.trigger === 'manual' ? 'manual' : 'auto',
          preTokens: finite(event.preTokens) ? Number(event.preTokens) : null,
          postTokens: finite(event.postTokens) ? Number(event.postTokens) : null,
        },
      };

    case 'loadingHistory':
      return { ...st, coldLoad: { startedAt: ts, bytes: finite(event.bytes) ? Number(event.bytes) : null } };

    case 'loadingHistoryDone':
      return { ...st, coldLoad: null };

    default:
      return st;
  }
}

// ---------------------------------------------------------------------------
// Staleness — "given now = T, is this cue stale?" The shell owns the timer; we own the answer.
// ---------------------------------------------------------------------------

/**
 * @param {string} kind one of INDICATOR_KINDS
 * @param {number|null} startedAt
 * @param {number} now
 * @returns {boolean} true when the cue has outlived its TTL and must be dropped
 */
function isStale(kind, startedAt, now) {
  const ttl = INDICATOR_TTL_MS[kind];
  if (!finite(ttl)) return false;
  // A cue with no usable timestamp can never be aged out normally — treat it as stale so a
  // malformed event can't pin the UI on forever.
  if (!finite(startedAt)) return true;
  if (!finite(now)) return false;
  return Number(now) - Number(startedAt) >= ttl;
}

/** Kinds currently present in `state` that are stale at `now`. */
function staleIndicators(state, now) {
  const st = base(state);
  return INDICATOR_KINDS.filter((kind) => isObj(st[kind]) && isStale(kind, st[kind].startedAt, now));
}

/** pruneIndicators(state, now) → state with every stale cue cleared (same object if nothing expired). */
function pruneIndicators(state, now) {
  const st = base(state);
  const stale = staleIndicators(st, now);
  if (stale.length === 0) return st;
  const out = { ...st };
  for (const kind of stale) out[kind] = null;
  return out;
}

/**
 * When the shell should next re-render to expire a cue, so it can schedule ONE timeout instead of
 * polling. Returns null when nothing is pending.
 * @returns {number|null} epoch ms
 */
function nextIndicatorDeadline(state, now) {
  const st = base(state);
  let soonest = null;
  for (const kind of INDICATOR_KINDS) {
    const entry = st[kind];
    if (!isObj(entry) || !finite(entry.startedAt)) continue;
    const deadline = Number(entry.startedAt) + INDICATOR_TTL_MS[kind];
    if (finite(now) && deadline <= Number(now)) return Number(now); // already due
    if (soonest === null || deadline < soonest) soonest = deadline;
  }
  return soonest;
}

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

function cue(kind, startedAt, now, text, extra = {}) {
  const spec = INDICATOR_SPECS[kind];
  const ttl = INDICATOR_TTL_MS[kind];
  return {
    key: kind,
    kind,
    text,
    icon: spec.icon,
    tone: spec.tone,
    priority: spec.priority,
    confidence: spec.confidence,
    inferred: spec.confidence === 'heuristic',
    startedAt: finite(startedAt) ? Number(startedAt) : null,
    ageMs: finite(startedAt) && finite(now) ? Math.max(0, Number(now) - Number(startedAt)) : 0,
    expiresAt: finite(startedAt) && finite(ttl) ? Number(startedAt) + ttl : null,
    detail: extra,
  };
}

function lookingUpText(e) {
  if (e.mode === 'number' && finite(e.number)) {
    const prefix = e.kindOf === 'response' ? 'R' : 'P';
    return `Looking up ${prefix}#${Number(e.number)}…`;
  }
  if (e.query) return `Looking up “${e.query}”…`;
  return 'Looking up historical turns…';
}

function compactedText(e) {
  const trigger = e.trigger === 'manual' ? 'manual' : 'auto';
  if (finite(e.preTokens) && finite(e.postTokens)) return `Compacted ${k(e.preTokens)} → ${k(e.postTokens)} (${trigger})`;
  return `Context compacted (${trigger})`;
}

function bytesLabel(bytes) {
  if (!finite(bytes)) return '';
  const mb = Number(bytes) / 1e6;
  return mb >= 1 ? `${Math.round(mb)} MB` : `${Math.max(1, Math.round(Number(bytes) / 1000))} kB`;
}

/**
 * shapeIndicators(state, opts) → everything the status line needs.
 *
 * Stale cues are pruned for rendering purposes (the shell should also persist
 * `pruneIndicators()` so state doesn't grow stale entries), and the dropped kinds are reported
 * on `stale` so a caller can log/diagnose a missing end event.
 *
 * @param {object} state reducer state
 * @param {{now?:number, percentage?:number|null, contextAvailable?:boolean, popover?:object}} opts
 *        `popover` (a `shapeContextPopover()` result) may be passed instead of percentage/available.
 * @returns {{ now:number|null, tier:object, indicators:object[], primary:object|null, stale:string[] }}
 */
function shapeIndicators(state, opts = {}) {
  const o = isObj(opts) ? opts : {};
  const now = finite(o.now) ? Number(o.now) : null;
  const st = base(state);
  const stale = staleIndicators(st, now);
  const live = pruneIndicators(st, now);

  let percentage = null;
  let available = false;
  if (isObj(o.popover)) {
    available = o.popover.available === true;
    percentage = available && isObj(o.popover.headline) ? o.popover.headline.pct : null;
  } else {
    available = o.contextAvailable === undefined ? finite(o.percentage) : o.contextAvailable === true;
    percentage = available && finite(o.percentage) ? Number(o.percentage) : null;
  }
  const tier = contextTier(available ? percentage : null);

  const indicators = [];

  if (isObj(live.coldLoad)) {
    const b = bytesLabel(live.coldLoad.bytes);
    indicators.push(
      cue('coldLoad', live.coldLoad.startedAt, now, b ? `Loading conversation history (${b})…` : 'Loading conversation history…', {
        bytes: live.coldLoad.bytes ?? null,
      })
    );
  }

  if (isObj(live.lookingUp)) {
    indicators.push(cue('lookingUp', live.lookingUp.startedAt, now, lookingUpText(live.lookingUp), { ...live.lookingUp }));
  }

  if (isObj(live.rolling)) {
    const seg = finite(live.rolling.segment) ? ` (segment ${live.rolling.segment})` : '';
    indicators.push(
      cue('rolling', live.rolling.startedAt, now, `Rolling to a fresh window…${seg}`, {
        segment: live.rolling.segment ?? null,
        sourceRef: live.rolling.sourceRef || '',
      })
    );
  }

  // HEURISTIC, not server truth (CONTRACT.md §3c). Suppressed while a real `compacted`
  // confirmation is on screen, since that already tells the honest story.
  if (tier.available && Number(percentage) >= COMPACTING_INFERRED_PCT && !isObj(live.compacted)) {
    indicators.push(
      cue('compacting', now, now, `Context ${Math.round(Number(percentage))}% full — auto-compaction likely soon`, {
        percentage: Number(percentage),
        threshold: COMPACTING_INFERRED_PCT,
        source: 'client-threshold',
      })
    );
  }

  if (isObj(live.compacted)) {
    indicators.push(cue('compacted', live.compacted.startedAt, now, compactedText(live.compacted), { ...live.compacted }));
  }

  indicators.sort((a, b) => a.priority - b.priority);

  return { now, tier, indicators, primary: indicators[0] || null, stale };
}

    return { TIER_FILLING_PCT: TIER_FILLING_PCT, TIER_ACT_NOW_PCT: TIER_ACT_NOW_PCT, TIER_CRITICAL_PCT: TIER_CRITICAL_PCT, COMPACTING_INFERRED_PCT: COMPACTING_INFERRED_PCT, CONTEXT_TIERS: CONTEXT_TIERS, TIER_UNKNOWN: TIER_UNKNOWN, contextTier: contextTier, contextTierFromPopover: contextTierFromPopover, ROLLING_CUE_MS: ROLLING_CUE_MS, LOOKING_UP_TIMEOUT_MS: LOOKING_UP_TIMEOUT_MS, COMPACTED_NOTICE_MS: COMPACTED_NOTICE_MS, COLD_LOAD_TIMEOUT_MS: COLD_LOAD_TIMEOUT_MS, INDICATOR_TTL_MS: INDICATOR_TTL_MS, INDICATOR_SPECS: INDICATOR_SPECS, INDICATOR_KINDS: INDICATOR_KINDS, emptyIndicatorState: emptyIndicatorState, reduceIndicator: reduceIndicator, isStale: isStale, staleIndicators: staleIndicators, pruneIndicators: pruneIndicators, nextIndicatorDeadline: nextIndicatorDeadline, shapeIndicators: shapeIndicators };
  })({ k: __m.usage.k });

  // ---- lib/transcriptWindow.mjs → EXO.win ----------------------------------------------
  __m.win = (function (__imp) {
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
const DEFAULT_BAND = Object.freeze({ before: 250, after: 250 });

/** How many rows a planned extension deliberately overlaps the band it is extending. One row
 *  is enough to prove adjacency; it costs one duplicate row on the wire and it makes a
 *  server-side clamp impossible to mistake for a gap. */
const EXTEND_OVERLAP = 1;

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
const MAX_JUMP_ATTEMPTS = 12;

/** How many index↔turn anchors a view remembers. Each probe contributes two, so this only
 *  matters after dozens of jumps in one session; the interior is thinned (keeping the spread)
 *  rather than letting the list grow without bound. */
const MAX_ANCHORS = 64;

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
function rowRole(row) {
  if (!row || typeof row !== "object") return null;
  if (row.role === "user" || row.role === "assistant") return row.role;
  if (row.kind === "user" || row.kind === "assistant") return row.kind;
  return null;
}

/** Count prompt/response rows in `rows[0 .. upto)`. `upto` is clamped to [0, rows.length].
 *  Same job as conversationWindow.countOffsets, over a BAND rather than a full transcript. */
function countRoles(rows, upto) {
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
function normalizeBand(payload) {
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
function bandTurnRange(band) {
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
function turnAt(band, index) {
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
function indexOfTurn(band, kind, number) {
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
function containsTurn(band, kind, number) {
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
function mergeBands(a, b) {
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
function viewAnchors(view) {
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
function turnBracket(view, kind, number) {
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
function emptyView() {
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
function applyBand(view, band, opts = {}) {
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
function bandSpanOf(view) {
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
function viewAffordances(view) {
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
function estimateIndexOfTurn(view, kind, number, opts = {}) {
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
function planJump(view, kind, number, opts = {}) {
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
function planExtend(view, direction, opts = {}) {
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

    return { DEFAULT_BAND: DEFAULT_BAND, EXTEND_OVERLAP: EXTEND_OVERLAP, MAX_JUMP_ATTEMPTS: MAX_JUMP_ATTEMPTS, MAX_ANCHORS: MAX_ANCHORS, rowRole: rowRole, countRoles: countRoles, normalizeBand: normalizeBand, bandTurnRange: bandTurnRange, turnAt: turnAt, indexOfTurn: indexOfTurn, containsTurn: containsTurn, mergeBands: mergeBands, viewAnchors: viewAnchors, turnBracket: turnBracket, emptyView: emptyView, applyBand: applyBand, bandSpanOf: bandSpanOf, viewAffordances: viewAffordances, estimateIndexOfTurn: estimateIndexOfTurn, planJump: planJump, planExtend: planExtend };
  })({  });

  // ---- lib/scrollCache.mjs → EXO.cache ----------------------------------------------
  __m.cache = (function (__imp) {
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
const CACHE_DEFAULTS = Object.freeze({
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
function rangeKey(start, end) {
  return `${Math.max(0, intOr(start, 0))}:${Math.max(0, intOr(end, 0))}`;
}

/** Approximate retained bytes of a band. Counts every string field on a row (text, thinking,
 *  tool output, …) plus a flat per-row object overhead. Never throws on a weird row. */
function approximateBandBytes(band, rowOverhead = CACHE_DEFAULTS.rowOverhead) {
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
function createScrollCache(opts = {}) {
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
function windowSignature(parts = {}) {
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
function put(cache, band, opts = {}) {
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
function get(cache, start, end) {
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
function findCovering(cache, start, end) {
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
function findContaining(cache, index) {
  const i = Math.max(0, intOr(index, 0));
  return findCovering(cache, i, i + 1);
}

/** True if a band covering [start,end) is cached — WITHOUT touching recency or stats. For
 *  diagnostics and assertions; never use it as the read path. */
function has(cache, start, end) {
  if (!cache || !cache.entries) return false;
  const s = Math.max(0, intOr(start, 0));
  const e = Math.max(s, intOr(end, s));
  return !!findCoveringEntry(cache, s, e);
}

/** Drop every entry that OVERLAPS [start, end). Use when a row range is known to have changed
 *  (an edited turn, a re-rendered tool result). Returns the number dropped. */
function invalidateRange(cache, start, end) {
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
function invalidateFrom(cache, index) {
  return invalidateRange(cache, index, Number.MAX_SAFE_INTEGER);
}

/** Drop everything. Returns the number dropped. */
function clear(cache) {
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
function setSignature(cache, signature) {
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
function noteTotal(cache, total, opts = {}) {
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
function stats(cache) {
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
function ranges(cache) {
  if (!cache || !cache.entries) return [];
  return Array.from(cache.entries.values()).map((e) => ({ start: e.start, end: e.end, rows: e.rows, bytes: e.bytes }));
}

    return { CACHE_DEFAULTS: CACHE_DEFAULTS, rangeKey: rangeKey, approximateBandBytes: approximateBandBytes, createScrollCache: createScrollCache, windowSignature: windowSignature, put: put, get: get, findCovering: findCovering, findContaining: findContaining, has: has, invalidateRange: invalidateRange, invalidateFrom: invalidateFrom, clear: clear, setSignature: setSignature, noteTotal: noteTotal, stats: stats, ranges: ranges };
  })({  });

  // ---- lib/agentsPanel.mjs → EXO.agents ----------------------------------------------
  __m.agents = (function (__imp) {
// agentsPanel — pure VIEW-MODEL shaping for the background-agents fleet panel (ROADMAP 2.4 / T3.2).
//
// WHY THIS EXISTS. The complaint this closes is: "you told me work was happening in background
// agents and I had no way to tell whether anything was actually running or whether it had silently
// died." So the design rule here is HONESTY OVER TIDINESS:
//   - a missing start time renders "unknown", NEVER a plausible-looking "0s";
//   - a negative or absurd elapsed (clock skew between server and browser) renders "unknown" and
//     sets `clockSkew`, NEVER a clamped-to-zero number that looks like real data;
//   - "possibly stalled" is derived, labelled a HEURISTIC on every row and on the panel, and is
//     never presented as "this agent is dead";
//   - counts are recomputed from the rows, and any disagreement with the server's own totals is
//     surfaced as `mismatch` rather than silently preferring one of them.
//
// WHERE THE INPUT COMES FROM (docs/work/agentic-chat-engine/CONTRACT.md §2):
//   - `event.panel`                  on `background` / `taskStarted` / `taskDone`
//   - `sessionSummary.backgroundPanel` on a `state` frame (null on a stub engine = NO DATA)
//   - `sessionSummary.background` / `event.tasks` — the raw ARRAY fallback (no status field)
// All four are accepted by `shapeAgentsPanel`, so a caller never has to unwrap by hand.
//
// COMPOSITION: the server runs `shapeBackground()` from lib/backgroundTasks.mjs and puts the result
// on the wire; this module consumes exactly that shape and adds the things only a client can know
// (its own clock, what it saw last tick). It deliberately does NOT import backgroundTasks.mjs —
// this file must stay inlineable into the browser bundle, same as backgroundTasks.mjs itself.
//
// PURE: no imports, no Date, no Math.random, no DOM, no timers. Callers pass `now`.

/** How long a running agent may go with no observed change before the panel says "possibly stalled".
 *  Five minutes: background subagents legitimately work silently for minutes (see CONTRACT.md §6 on
 *  deep work), and per-agent `tokens` only moves when the SDK reports it — usually once, at settle —
 *  so anything shorter would flag every healthy long-running agent. This is a UI hint only. */
const AGENT_STALE_AFTER_MS = 5 * 60 * 1000;

/** Any elapsed beyond this is treated as clock skew / a bad timestamp rather than a real duration. */
const AGENT_MAX_ELAPSED_MS = 7 * 24 * 60 * 60 * 1000;

/** Fixed wording so every surface says the same thing and nobody re-phrases it as a fact. */
const AGENT_STALE_NOTE =
  "Heuristic: no change seen for over 5 minutes. The agent may simply be working quietly — this is a guess, not a status report.";

/** The normalized states a row can be in. Exported so a renderer can exhaustively switch on them
 *  and still survive a NEW server status (which maps to "unknown", never silently to "running"). */
const AGENT_STATES = ["running", "done", "error", "unknown"];

const isObj = (v) => v !== null && typeof v === "object";
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const str = (v) => (typeof v === "string" ? v : "");

/** Normalize an arbitrary status string into one of AGENT_STATES, forward-compatibly: an unknown
 *  status is NOT coerced into "running" (that would invent liveness) — it becomes "unknown" and the
 *  raw value is preserved on the row so a future server status renders as itself. */
function agentState(status) {
  const s = str(status).toLowerCase();
  if (s === "running") return "running";
  if (s === "done" || s === "completed" || s === "complete" || s === "success") return "done";
  if (s === "error" || s === "failed" || s === "failure") return "error";
  return "unknown";
}

// Unwrap any of the accepted payload shapes into a plain array of agent-ish records.
// Returns null (NOT []) when there is genuinely no data, so "no data" and "no agents" stay distinct.
function pickAgents(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isObj(payload)) return null;
  if (Array.isArray(payload.agents)) return payload.agents;                 // the panel model itself
  if (isObj(payload.panel) && Array.isArray(payload.panel.agents)) return payload.panel.agents;   // an event
  if (isObj(payload.backgroundPanel) && Array.isArray(payload.backgroundPanel.agents)) return payload.backgroundPanel.agents; // a sessionSummary
  if (Array.isArray(payload.background)) return payload.background;         // sessionSummary fallback
  if (Array.isArray(payload.tasks)) return payload.tasks;                   // event fallback
  return null;
}

// The panel object the totals should be compared against, if the payload carried one.
function pickPanel(payload) {
  if (!isObj(payload) || Array.isArray(payload)) return null;
  if (Array.isArray(payload.agents)) return payload;
  if (isObj(payload.panel)) return payload.panel;
  if (isObj(payload.backgroundPanel)) return payload.backgroundPanel;
  return null;
}

/**
 * Elapsed, honestly. Prefers a real `startedAt` against the caller's clock; falls back to the
 * server's snapshot `elapsedMs`; otherwise UNKNOWN.
 *
 * `elapsedMs === 0` from the wire is treated as UNKNOWN on purpose. `shapeBackground()` emits 0 both
 * for "no startedAt" and for "no now", and an agent whose true age is exactly 0 ms is unobservable
 * in practice (the event has already made a round trip). Showing "unknown" for one tick of a
 * genuinely brand-new agent is a far cheaper mistake than showing a frozen "0s" forever, which is
 * the exact symptom that made the fleet look dead.
 */
function readElapsed(a, now) {
  const startedAt = fin(a.startedAt) ? a.startedAt : null;
  if (startedAt !== null && startedAt > 0 && fin(now) && now > 0) {
    const raw = now - startedAt;
    if (raw < 0) return { elapsedMs: null, elapsedKnown: false, clockSkew: true };
    if (raw > AGENT_MAX_ELAPSED_MS) return { elapsedMs: null, elapsedKnown: false, clockSkew: true };
    return { elapsedMs: raw, elapsedKnown: true, clockSkew: false };
  }
  const snap = a.elapsedMs;
  if (fin(snap)) {
    if (snap < 0 || snap > AGENT_MAX_ELAPSED_MS) return { elapsedMs: null, elapsedKnown: false, clockSkew: true };
    if (snap === 0) return { elapsedMs: null, elapsedKnown: false, clockSkew: false };
    return { elapsedMs: snap, elapsedKnown: true, clockSkew: false };
  }
  return { elapsedMs: null, elapsedKnown: false, clockSkew: false };
}

/** "unknown" | "45s" | "3m 07s" | "2h 05m". Never renders a negative or a bare 0 for unknown input. */
function agentElapsedLabel(ms) {
  if (!fin(ms) || ms < 0) return "unknown";
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return `${m}m ${String(s).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

// Identity of "has anything changed about this agent since last tick".
// Description is included because an enriching `background` event is real evidence of liveness.
function fingerprint(row) {
  return `${row.state}|${row.status}|${row.tokens}|${row.description}`;
}

/**
 * trackAgentActivity(prev, payload, now) → { seen: { <id>: { lastChangeAt, fingerprint } } }
 *
 * The one piece of state the panel needs and the server cannot supply: WHEN THIS CLIENT LAST SAW
 * THIS AGENT CHANGE. Call it on every background event / state frame, keep the result, and pass it
 * back into `shapeAgentsPanel` as `opts.tracking`.
 *
 * - unchanged fingerprint → `lastChangeAt` is preserved (that is what makes staleness measurable)
 * - changed fingerprint or first sighting → `lastChangeAt = now`
 * - agents absent from the payload are DROPPED (they left the live set)
 * - a non-finite `now`, or a payload with no agent data at all, returns `prev` untouched — a
 *   reconnect blip must not reset every agent's clock and hide a genuinely stalled fleet
 */
function trackAgentActivity(prev, payload, now) {
  const base = isObj(prev) && isObj(prev.seen) ? prev : { seen: {} };
  const list = pickAgents(payload);
  if (!Array.isArray(list) || !fin(now)) return base;
  const rows = normalizeRows(list, now);
  const seen = {};
  for (const row of rows) {
    const fp = fingerprint(row);
    const old = base.seen[row.id];
    seen[row.id] = isObj(old) && old.fingerprint === fp && fin(old.lastChangeAt)
      ? { lastChangeAt: old.lastChangeAt, fingerprint: fp }
      : { lastChangeAt: now, fingerprint: fp };
  }
  return { seen };
}

// Shared normalization used by both the tracker and the shaper, so a fingerprint is computed over
// exactly the fields the panel renders. Order is PRESERVED (see shapeAgentsPanel docs).
function normalizeRows(list, now) {
  const out = [];
  const ids = new Set();
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!isObj(a)) continue;
    const id = a.id == null || a.id === "" ? `#${i}` : String(a.id);
    if (ids.has(id)) continue; // first sighting wins; a duplicate id must not double-count tokens
    ids.add(id);

    const subagentType = str(a.subagentType) || null;
    const taskType = str(a.taskType) || null;
    // The raw `background` array has no status. It IS the authoritative live set, so "running" is
    // the honest reading — but it is an assumption, and `statusKnown` says so.
    const statusKnown = typeof a.status === "string" && a.status !== "";
    const status = statusKnown ? a.status : "running";
    const label = str(a.label) || subagentType || taskType || "agent";
    const tokens = fin(Number(a.tokens)) && Number(a.tokens) > 0 ? Math.floor(Number(a.tokens)) : 0;
    const description = str(a.description);

    out.push({
      id,
      label,
      type: taskType,
      subagentType,
      description,
      status,
      statusKnown,
      state: agentState(status),
      tokens,
      summary: str(a.summary),
      ...readElapsed(a, now),
    });
  }
  return out;
}

/**
 * shapeAgentsPanel(payload, now, opts?) → view model
 *
 * payload: a panel model, a `background`/`taskStarted`/`taskDone` event, a `sessionSummary`, a bare
 *          agents array, or null/undefined.
 * now:     the client's clock in ms (may be omitted; elapsed then falls back to the server snapshot).
 * opts:    { tracking } from `trackAgentActivity`, { staleAfterMs } to override the heuristic window.
 *
 * Returns:
 * {
 *   hasData, count, running, done, errored, unknown, totalTokens,
 *   staleCount, anyStale, heuristic: true, staleAfterMs, staleNote,
 *   summary, reported, mismatch,
 *   agents: [{ id, label, type, subagentType, description, status, statusKnown, state, tokens,
 *              elapsedMs, elapsedKnown, elapsedLabel, clockSkew,
 *              sinceChangeMs, stale, staleReason, staleNote, title }]
 * }
 *
 * ORDERING is the input's order, verbatim. CONTRACT.md §2a: "Sort order is stable and server-decided:
 * running first, then by start time. Do not re-sort." Preserving it is also what keeps rows from
 * jumping as tokens tick — nothing here orders by a value that changes.
 *
 * `hasData:false` means NO DATA (a null `backgroundPanel`, a stub engine, nothing received yet) and
 * must render differently from `count:0`, which means "there really are no background agents".
 */
function shapeAgentsPanel(payload, now, opts = {}) {
  const staleAfterMs = fin(opts && opts.staleAfterMs) && opts.staleAfterMs > 0 ? opts.staleAfterMs : AGENT_STALE_AFTER_MS;
  const tracking = isObj(opts) && isObj(opts.tracking) && isObj(opts.tracking.seen) ? opts.tracking.seen : null;
  const list = pickAgents(payload);

  if (!Array.isArray(list)) {
    return {
      hasData: false, count: 0, running: 0, done: 0, errored: 0, unknown: 0, totalTokens: 0,
      staleCount: 0, anyStale: false, heuristic: true, staleAfterMs, staleNote: AGENT_STALE_NOTE,
      summary: "background agents: no data", reported: null, mismatch: false, agents: [],
    };
  }

  const rows = normalizeRows(list, now).map((row) => {
    const track = tracking && isObj(tracking[row.id]) && fin(tracking[row.id].lastChangeAt)
      ? tracking[row.id].lastChangeAt
      : null;

    let sinceChangeMs = null;
    let staleReason = null;
    if (track !== null && fin(now)) {
      const d = now - track;
      if (d >= 0 && d <= AGENT_MAX_ELAPSED_MS) sinceChangeMs = d;
      staleReason = "idle-since-last-change";
    } else if (row.tokens === 0 && row.elapsedKnown) {
      // No tracking history (e.g. straight after a reconnect) and the agent has never reported a
      // single token: its whole lifetime is time we have no evidence about. Weaker signal, so it is
      // labelled differently rather than dressed up as the same thing.
      sinceChangeMs = row.elapsedMs;
      staleReason = "no-activity-observed";
    }

    const stale = row.state === "running" && sinceChangeMs !== null && sinceChangeMs >= staleAfterMs;
    const title = row.description ? `${row.label} — ${row.description}` : row.label;
    return {
      ...row,
      elapsedLabel: agentElapsedLabel(row.elapsedMs),
      sinceChangeMs,
      stale,
      staleReason: stale ? staleReason : null,
      staleNote: stale ? AGENT_STALE_NOTE : null,
      title,
    };
  });

  const count = rows.length;
  const running = rows.filter((r) => r.state === "running").length;
  const done = rows.filter((r) => r.state === "done").length;
  const errored = rows.filter((r) => r.state === "error").length;
  const unknown = rows.filter((r) => r.state === "unknown").length;
  const totalTokens = rows.reduce((s, r) => s + r.tokens, 0);
  const staleCount = rows.filter((r) => r.stale).length;

  const panel = pickPanel(payload);
  const reported = panel && (fin(panel.count) || fin(panel.totalTokens))
    ? {
        count: fin(panel.count) ? panel.count : null,
        running: fin(panel.running) ? panel.running : null,
        done: fin(panel.done) ? panel.done : null,
        totalTokens: fin(panel.totalTokens) ? panel.totalTokens : null,
      }
    : null;
  const mismatch = !!reported && (
    (reported.count !== null && reported.count !== count) ||
    (reported.totalTokens !== null && reported.totalTokens !== totalTokens)
  );

  return {
    hasData: true, count, running, done, errored, unknown, totalTokens,
    staleCount, anyStale: staleCount > 0, heuristic: true, staleAfterMs, staleNote: AGENT_STALE_NOTE,
    summary: agentsPanelSummary({ hasData: true, count, running, done, errored, unknown, staleCount }),
    reported, mismatch, agents: rows,
  };
}

/** One line for a collapsed panel header. Token totals are left out on purpose — the caller formats
 *  those with the existing `k()` helper (lib/backgroundTasks.mjs / lib/contextUsage.mjs). */
function agentsPanelSummary(vm) {
  if (!isObj(vm) || vm.hasData === false) return "background agents: no data";
  const count = fin(vm.count) ? vm.count : 0;
  if (count === 0) return "no background agents";
  const parts = [`${count} agent${count === 1 ? "" : "s"}`];
  const detail = [];
  if (vm.running) detail.push(`${vm.running} running`);
  if (vm.done) detail.push(`${vm.done} done`);
  if (vm.errored) detail.push(`${vm.errored} error${vm.errored === 1 ? "" : "s"}`);
  if (vm.unknown) detail.push(`${vm.unknown} unknown`);
  if (detail.length) parts.push(detail.join(", "));
  if (vm.staleCount) parts.push(`${vm.staleCount} possibly stalled`);
  return parts.join(" · ");
}

    return { AGENT_STALE_AFTER_MS: AGENT_STALE_AFTER_MS, AGENT_MAX_ELAPSED_MS: AGENT_MAX_ELAPSED_MS, AGENT_STALE_NOTE: AGENT_STALE_NOTE, AGENT_STATES: AGENT_STATES, agentState: agentState, agentElapsedLabel: agentElapsedLabel, trackAgentActivity: trackAgentActivity, shapeAgentsPanel: shapeAgentsPanel, agentsPanelSummary: agentsPanelSummary };
  })({  });

  // ---- lib/recallCue.mjs → EXO.recall ----------------------------------------------
  __m.recall = (function (__imp) {
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
const RECALL_EXCERPT_MAX_CHARS = 2000;

/** Client-side cap on rendered query hits. The server's own `limit` defaults to 10 (CONTRACT §5);
 *  this is an independent guard so a future larger `limit` cannot flood the transcript. */
const RECALL_MAX_HITS = 10;

/** The route that resolves an archived image (see dashboard/public/app.js). */
const RECALL_IMAGE_ROUTE = "/api/workspace/image";

/** Terminal outcomes. `pending` only ever appears while a `lookingUp` is outstanding. */
const RECALL_STATUSES = ["pending", "hit", "hits", "empty", "refused", "error"];

/** Why a recall produced nothing. NOTE: the server carries no machine-readable reason code — only a
 *  human `error` string — so these are recovered by matching the known strings, with an honest
 *  "internal-error" fallback for anything unrecognized. See `classifyRecallError`. */
const RECALL_REASONS = ["not-found", "no-archive", "refused", "internal-error"];

const RECALL_CUE_INITIAL = Object.freeze({ active: false, request: null, result: null });

const isObj = (v) => v !== null && typeof v === "object";
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const str = (v) => (typeof v === "string" ? v : "");
const posInt = (v) => (fin(Number(v)) && Number(v) >= 1 ? Math.floor(Number(v)) : null);

const kindOf = (v) => (v === "response" ? "response" : "prompt");

/** "P#12" / "R#1237" — the same coordinate the transcript already labels rows with. */
function recallRef(kind, number) {
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
function classifyRecallError(error) {
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
function recallExcerpt(text, max = RECALL_EXCERPT_MAX_CHARS) {
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
function recallImageUrl(workspaceId, path, route = RECALL_IMAGE_ROUTE) {
  const w = str(workspaceId);
  const p = str(path);
  if (!w || !p) return null;
  return `${route}?workspaceId=${encodeURIComponent(w)}&path=${encodeURIComponent(p)}`;
}

/** recallImageRefs(hit, route?) → [{ path, hash, mediaType, workspaceId, url, resolvable }]
 *  Only meaningful in NUMBER mode: a query hit's `images` is a COUNT, not an array (CONTRACT §5),
 *  and is deliberately not coerced into fake refs. */
function recallImageRefs(hit, route = RECALL_IMAGE_ROUTE) {
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
function recallProvenance(hitLike) {
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
function rankRecallHits(hits, query, opts = {}) {
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
function shapeLookingUp(event, opts = {}) {
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
function shapeRecallCue(event, opts = {}) {
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
function reduceRecallCue(state, event, opts = {}) {
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
function dismissRecallCue() {
  return { active: false, request: null, result: null };
}

/** One line for the indicator strip. Returns "" when there is nothing to say. */
function recallCueLabel(state) {
  if (!isObj(state)) return "";
  if (state.active && isObj(state.request)) return state.request.label;
  if (isObj(state.result)) return state.result.message;
  return "";
}

    return { RECALL_EXCERPT_MAX_CHARS: RECALL_EXCERPT_MAX_CHARS, RECALL_MAX_HITS: RECALL_MAX_HITS, RECALL_IMAGE_ROUTE: RECALL_IMAGE_ROUTE, RECALL_STATUSES: RECALL_STATUSES, RECALL_REASONS: RECALL_REASONS, RECALL_CUE_INITIAL: RECALL_CUE_INITIAL, recallRef: recallRef, classifyRecallError: classifyRecallError, recallExcerpt: recallExcerpt, recallImageUrl: recallImageUrl, recallImageRefs: recallImageRefs, recallProvenance: recallProvenance, rankRecallHits: rankRecallHits, shapeLookingUp: shapeLookingUp, shapeRecallCue: shapeRecallCue, reduceRecallCue: reduceRecallCue, dismissRecallCue: dismissRecallCue, recallCueLabel: recallCueLabel };
  })({  });

  root.EXO = __m;
})(typeof window !== "undefined" ? window : this);
