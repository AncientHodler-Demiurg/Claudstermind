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

import { k, shapeContextUsage, contextSummaryLabel } from './contextUsage.mjs';

/** The repo's compact token formatter (0 → "0", 316000 → "316k", 1000000 → "1M"). */
export { k as formatTokens, k };

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
export const CATEGORY_KEYS = Object.freeze({
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
export const SEGMENT_KEY_OTHER = 'other';
export const SEGMENT_KEY_FREE = 'free';

/**
 * Stable key for a category name. Known SDK names get a canonical camelCase key; unknown names
 * are slugified (`"Skill files" → "skill-files"`); an unusable name falls back to `segment`.
 * @param {string} name
 * @returns {string}
 */
export function segmentKey(name) {
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
export function pctLabel(pct) {
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
export function shapeContextPopover(input, opts = {}) {
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
export function contextPopoverLabel(popover) {
  if (!isObj(popover) || !popover.available) return 'Context usage unavailable';
  return popover.headline.text;
}
