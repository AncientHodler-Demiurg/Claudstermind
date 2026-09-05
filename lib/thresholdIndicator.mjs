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

import { k } from './contextUsage.mjs';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Strict: `Number(null)`/`Number([])` are 0, which would quietly turn "unavailable" into "0%"
// and a null `preTokens` into "0 tokens". Only real numbers (or numeric strings) count.
const finite = (x) => (typeof x === 'number' || typeof x === 'string') && x !== '' && Number.isFinite(Number(x));

// ---------------------------------------------------------------------------
// Warning tiers — the "I need an indicator of thresholds" ask.
// ---------------------------------------------------------------------------

/** Below this the window is comfortable and no advice is worth showing. */
export const TIER_FILLING_PCT = 60;
/** Past this, act at the next natural break: roll or start a new chat. */
export const TIER_ACT_NOW_PCT = 80;
/** Past this, auto-compaction is close and WILL silently drop detail. */
export const TIER_CRITICAL_PCT = 92;

/**
 * The percentage at which we are willing to SAY "compaction is likely soon".
 * This is a client heuristic (CONTRACT.md §3c) — there is no server signal.
 */
export const COMPACTING_INFERRED_PCT = TIER_CRITICAL_PCT;

/** Ordered low → high. `minPct` is inclusive. */
export const CONTEXT_TIERS = Object.freeze([
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
export const TIER_UNKNOWN = Object.freeze({
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
export function contextTier(percentage) {
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
export function contextTierFromPopover(popover) {
  if (!isObj(popover) || popover.available !== true) return contextTier(null);
  const pct = isObj(popover.headline) ? popover.headline.pct : null;
  return contextTier(pct);
}

// ---------------------------------------------------------------------------
// Indicator lifetimes
// ---------------------------------------------------------------------------

/** §3a: a roll is fast and has NO paired "rolled" event → the cue self-expires. */
export const ROLLING_CUE_MS = 4000;
/** §3b: `recall` always arrives — but if a frame is lost, drop the cue rather than wedge the UI. */
export const LOOKING_UP_TIMEOUT_MS = 20000;
/** §3c: `compacted` is a confirmation, shown briefly and then gone. */
export const COMPACTED_NOTICE_MS = 15000;
/** §3d: cold load of a >25 MB session log; 61 MB measured at ~42 s, so allow generous headroom. */
export const COLD_LOAD_TIMEOUT_MS = 300000;

export const INDICATOR_TTL_MS = Object.freeze({
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
export const INDICATOR_SPECS = Object.freeze({
  coldLoad: { kind: 'coldLoad', priority: 0, icon: '⏳', tone: 'notice', confidence: 'observed' },
  lookingUp: { kind: 'lookingUp', priority: 1, icon: '🔍', tone: 'notice', confidence: 'observed' },
  rolling: { kind: 'rolling', priority: 2, icon: '⟳', tone: 'notice', confidence: 'observed' },
  compacting: { kind: 'compacting', priority: 3, icon: '⟳', tone: 'warn', confidence: 'heuristic' },
  compacted: { kind: 'compacted', priority: 4, icon: '🗜', tone: 'ok', confidence: 'observed' },
});

/** The kinds that live in the reducer state (i.e. driven by server events). */
export const INDICATOR_KINDS = Object.freeze(['coldLoad', 'lookingUp', 'rolling', 'compacted']);

// ---------------------------------------------------------------------------
// Reducer — one state object PER CONVERSATION (route on the frame's sessionKey, §0).
// ---------------------------------------------------------------------------

/** @returns a fresh, empty indicator state. */
export function emptyIndicatorState() {
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
export function reduceIndicator(state, event, now) {
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
export function isStale(kind, startedAt, now) {
  const ttl = INDICATOR_TTL_MS[kind];
  if (!finite(ttl)) return false;
  // A cue with no usable timestamp can never be aged out normally — treat it as stale so a
  // malformed event can't pin the UI on forever.
  if (!finite(startedAt)) return true;
  if (!finite(now)) return false;
  return Number(now) - Number(startedAt) >= ttl;
}

/** Kinds currently present in `state` that are stale at `now`. */
export function staleIndicators(state, now) {
  const st = base(state);
  return INDICATOR_KINDS.filter((kind) => isObj(st[kind]) && isStale(kind, st[kind].startedAt, now));
}

/** pruneIndicators(state, now) → state with every stale cue cleared (same object if nothing expired). */
export function pruneIndicators(state, now) {
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
export function nextIndicatorDeadline(state, now) {
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
export function shapeIndicators(state, opts = {}) {
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
