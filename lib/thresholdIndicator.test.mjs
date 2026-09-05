import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contextTier,
  contextTierFromPopover,
  emptyIndicatorState,
  reduceIndicator,
  isStale,
  staleIndicators,
  pruneIndicators,
  nextIndicatorDeadline,
  shapeIndicators,
  CONTEXT_TIERS,
  TIER_UNKNOWN,
  TIER_FILLING_PCT,
  TIER_ACT_NOW_PCT,
  TIER_CRITICAL_PCT,
  COMPACTING_INFERRED_PCT,
  ROLLING_CUE_MS,
  LOOKING_UP_TIMEOUT_MS,
  COMPACTED_NOTICE_MS,
  COLD_LOAD_TIMEOUT_MS,
  INDICATOR_TTL_MS,
  INDICATOR_KINDS,
} from './thresholdIndicator.mjs';
import { shapeContextPopover } from './contextPopover.mjs';

const T0 = 1784801237739;
const kinds = (r) => r.indicators.map((i) => i.kind);
const find = (r, kind) => r.indicators.find((i) => i.kind === kind);

// ---------------------------------------------------------------------------
// Warning tiers
// ---------------------------------------------------------------------------

test('tiers: thresholds are named constants in ascending order', () => {
  assert.ok(TIER_FILLING_PCT < TIER_ACT_NOW_PCT);
  assert.ok(TIER_ACT_NOW_PCT < TIER_CRITICAL_PCT);
  assert.deepEqual(CONTEXT_TIERS.map((t) => t.minPct), [0, TIER_FILLING_PCT, TIER_ACT_NOW_PCT, TIER_CRITICAL_PCT]);
  assert.deepEqual(CONTEXT_TIERS.map((t) => t.severity), [0, 1, 2, 3]);
});

test('tiers: boundaries are inclusive at the lower edge', () => {
  const at = (pct) => contextTier(pct).key;
  assert.equal(at(0), 'roomy');
  assert.equal(at(TIER_FILLING_PCT - 0.1), 'roomy');
  assert.equal(at(TIER_FILLING_PCT), 'filling');
  assert.equal(at(TIER_ACT_NOW_PCT - 0.1), 'filling');
  assert.equal(at(TIER_ACT_NOW_PCT), 'actNow');
  assert.equal(at(TIER_CRITICAL_PCT - 0.1), 'actNow');
  assert.equal(at(TIER_CRITICAL_PCT), 'critical');
  assert.equal(at(100), 'critical');
  assert.equal(at(140), 'critical');   // over capacity is still just "critical"
  assert.equal(at(-5), 'roomy');
});

test('tiers: every warning tier tells the user WHAT TO DO, not just a number', () => {
  for (const t of CONTEXT_TIERS) {
    assert.ok(t.advice.length > 10, t.key);
    assert.ok(['ok', 'notice', 'warn', 'danger'].includes(t.tone), t.key);
  }
  assert.deepEqual(contextTier(0).actions, []);
  assert.deepEqual(contextTier(TIER_FILLING_PCT).actions, ['roll']);
  assert.deepEqual(contextTier(TIER_ACT_NOW_PCT).actions, ['roll', 'newChat']);
  assert.deepEqual(contextTier(TIER_CRITICAL_PCT).actions, ['roll', 'compact']);
  // actions are a copy, so a caller can't mutate the frozen table through the result
  const a = contextTier(TIER_ACT_NOW_PCT).actions;
  a.push('nonsense');
  assert.deepEqual(contextTier(TIER_ACT_NOW_PCT).actions, ['roll', 'newChat']);
});

test('tiers: unavailable is its OWN tier, never "roomy" (0% would be a lie)', () => {
  for (const bad of [null, undefined, NaN, 'x', {}]) {
    const t = contextTier(bad);
    assert.equal(t.key, 'unknown', String(bad));
    assert.equal(t.available, false);
    assert.equal(t.pct, null);
    assert.equal(t.severity, -1);
    assert.notEqual(t.key, contextTier(0).key);
  }
  assert.equal(TIER_UNKNOWN.key, 'unknown');
});

test('tiers: compose directly with shapeContextPopover output', () => {
  const unavailable = shapeContextPopover({ ok: false, totalTokens: 0, maxTokens: 0, percentage: 0, categories: [] });
  assert.equal(contextTierFromPopover(unavailable).key, 'unknown');

  const empty = shapeContextPopover({ ok: true, totalTokens: 0, maxTokens: 1000000, percentage: 0, categories: [] });
  assert.equal(contextTierFromPopover(empty).key, 'roomy');
  assert.equal(contextTierFromPopover(empty).pct, 0);

  const full = shapeContextPopover({
    ok: true, totalTokens: 950000, maxTokens: 1000000, percentage: 95,
    categories: [{ name: 'Messages', tokens: 950000 }],
  });
  assert.equal(contextTierFromPopover(full).key, 'critical');
  assert.equal(contextTierFromPopover(null).key, 'unknown');
  assert.equal(contextTierFromPopover('x').key, 'unknown');
});

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

test('reducer: rolling turns on a self-expiring cue carrying the segment ref', () => {
  const st = reduceIndicator(emptyIndicatorState(), { kind: 'rolling', segment: 2, sourceRef: 'Repo@main#seg2' }, T0);
  assert.equal(st.rolling.startedAt, T0);
  assert.equal(st.rolling.sourceRef, 'Repo@main#seg2');

  const r = shapeIndicators(st, { now: T0 + 500, percentage: 10 });
  assert.deepEqual(kinds(r), ['rolling']);
  assert.match(r.primary.text, /Rolling to a fresh window/);
  assert.match(r.primary.text, /segment 2/);
  assert.equal(r.primary.inferred, false);
  assert.equal(r.primary.confidence, 'observed');
  assert.equal(r.primary.expiresAt, T0 + ROLLING_CUE_MS);

  // There is no paired "rolled" event (CONTRACT §3a) — it must expire on its own.
  const later = shapeIndicators(st, { now: T0 + ROLLING_CUE_MS, percentage: 10 });
  assert.deepEqual(kinds(later), []);
  assert.deepEqual(later.stale, ['rolling']);
});

test('reducer: lookingUp → recall is a balanced pair; recall clears on every path', () => {
  let st = reduceIndicator(emptyIndicatorState(), { kind: 'lookingUp', mode: 'number', kindOf: 'response', number: 1237, at: T0 }, T0);
  assert.ok(st.lookingUp);
  assert.match(shapeIndicators(st, { now: T0 }).primary.text, /R#1237/);

  for (const terminal of [
    { kind: 'recall', mode: 'number', ok: true, at: T0 + 60 },
    { kind: 'recall', mode: 'number', ok: false, error: 'not found', at: T0 + 60 },
    { kind: 'recall', mode: 'query', ok: false, error: 'unknown conversation', at: T0 + 60 },
  ]) {
    const done = reduceIndicator(st, terminal, T0 + 60);
    assert.equal(done.lookingUp, null, JSON.stringify(terminal));
    assert.equal(done.lastRecall.ok, terminal.ok);
    assert.deepEqual(kinds(shapeIndicators(done, { now: T0 + 60 })), []);
  }
});

test('reducer: a refused request (recall with no lookingUp) never turns the cue on', () => {
  const st = reduceIndicator(emptyIndicatorState(), { kind: 'recall', mode: 'number', ok: false, error: 'need a number or query', at: T0 }, T0);
  assert.equal(st.lookingUp, null);
  assert.equal(st.lastRecall.ok, false);
  assert.deepEqual(kinds(shapeIndicators(st, { now: T0 })), []);
});

test('reducer: a second lookingUp restarts the cue and its timeout', () => {
  let st = reduceIndicator(emptyIndicatorState(), { kind: 'lookingUp', mode: 'query', query: 'kadena', at: T0 }, T0);
  st = reduceIndicator(st, { kind: 'lookingUp', mode: 'query', query: 'pact', at: T0 + 5000 }, T0 + 5000);
  assert.equal(st.lookingUp.startedAt, T0 + 5000);
  const r = shapeIndicators(st, { now: T0 + 5000 });
  assert.match(r.primary.text, /pact/);
  assert.equal(r.primary.expiresAt, T0 + 5000 + LOOKING_UP_TIMEOUT_MS);
});

test('reducer: lookingUp text degrades gracefully with no mode/number/query', () => {
  const st = reduceIndicator(emptyIndicatorState(), { kind: 'lookingUp' }, T0);
  assert.equal(shapeIndicators(st, { now: T0 }).primary.text, 'Looking up historical turns…');
});

test('reducer: compacted is an AFTER-THE-FACT confirmation, with null tokens tolerated', () => {
  const st = reduceIndicator(emptyIndicatorState(), { kind: 'compacted', trigger: 'auto', preTokens: 812000, postTokens: 190000 }, T0);
  const r = shapeIndicators(st, { now: T0, percentage: 19 });
  assert.equal(r.primary.kind, 'compacted');
  assert.equal(r.primary.text, 'Compacted 812k → 190k (auto)');
  assert.equal(r.primary.tone, 'ok');
  assert.equal(r.primary.inferred, false);

  const partial = reduceIndicator(emptyIndicatorState(), { kind: 'compacted', trigger: 'manual', preTokens: null, postTokens: null }, T0);
  assert.equal(shapeIndicators(partial, { now: T0, percentage: 19 }).primary.text, 'Context compacted (manual)');

  // and it does not linger forever
  assert.deepEqual(kinds(shapeIndicators(st, { now: T0 + COMPACTED_NOTICE_MS, percentage: 19 })), []);
});

test('reducer: cold-load pair (§3d) on and off', () => {
  let st = reduceIndicator(emptyIndicatorState(), { kind: 'loadingHistory', bytes: 61_000_000 }, T0);
  const r = shapeIndicators(st, { now: T0 });
  assert.equal(r.primary.kind, 'coldLoad');
  assert.equal(r.primary.text, 'Loading conversation history (61 MB)…');
  st = reduceIndicator(st, { kind: 'loadingHistoryDone', ms: 42000, bytes: 61_000_000 }, T0 + 42000);
  assert.equal(st.coldLoad, null);
});

test('reducer: unknown / malformed events are ignored and the state object is not mutated', () => {
  const st = reduceIndicator(emptyIndicatorState(), { kind: 'rolling', segment: 1 }, T0);
  const snapshot = JSON.parse(JSON.stringify(st));
  for (const junk of [null, undefined, 'x', 42, [], {}, { kind: 'assistant' }, { kind: 'result' }, { kind: 42 }]) {
    assert.equal(reduceIndicator(st, junk, T0 + 1), st, JSON.stringify(junk));
  }
  assert.deepEqual(st, snapshot);
  // a fresh state is produced from garbage rather than throwing
  assert.deepEqual(reduceIndicator(null, { kind: 'nope' }, T0), emptyIndicatorState());
});

// ---------------------------------------------------------------------------
// Staleness — the cue must never wedge
// ---------------------------------------------------------------------------

test('staleness: a lost `recall` cannot leave the lookingUp cue stuck on forever', () => {
  const st = reduceIndicator(emptyIndicatorState(), { kind: 'lookingUp', mode: 'number', number: 7, at: T0 }, T0);
  assert.equal(isStale('lookingUp', T0, T0 + LOOKING_UP_TIMEOUT_MS - 1), false);
  assert.equal(isStale('lookingUp', T0, T0 + LOOKING_UP_TIMEOUT_MS), true);

  const justBefore = shapeIndicators(st, { now: T0 + LOOKING_UP_TIMEOUT_MS - 1 });
  assert.deepEqual(kinds(justBefore), ['lookingUp']);

  const after = shapeIndicators(st, { now: T0 + LOOKING_UP_TIMEOUT_MS });
  assert.deepEqual(kinds(after), []);
  assert.deepEqual(after.stale, ['lookingUp']);          // reported, so a shell can log the lost frame
  assert.equal(pruneIndicators(st, T0 + LOOKING_UP_TIMEOUT_MS).lookingUp, null);
  // …even an absurdly late render stays clear
  assert.deepEqual(kinds(shapeIndicators(st, { now: T0 + 86_400_000 })), []);
});

test('staleness: a cue with an unusable timestamp is treated as stale (belt and braces)', () => {
  const st = { ...emptyIndicatorState(), lookingUp: { startedAt: null, mode: '', kindOf: '', number: null, query: '' } };
  assert.equal(isStale('lookingUp', null, T0), true);
  assert.deepEqual(kinds(shapeIndicators(st, { now: T0 })), []);
  // an unknown kind has no TTL and is never force-expired
  assert.equal(isStale('compacting', T0, T0 + 1e9), false);
  // with no clock at all we cannot judge, so we do not drop a well-formed cue
  assert.equal(isStale('lookingUp', T0, NaN), false);
});

test('staleness: TTLs are exported per kind and cover every reducer-driven kind', () => {
  assert.deepEqual(Object.keys(INDICATOR_TTL_MS).sort(), [...INDICATOR_KINDS].sort());
  assert.equal(INDICATOR_TTL_MS.rolling, ROLLING_CUE_MS);
  assert.equal(INDICATOR_TTL_MS.lookingUp, LOOKING_UP_TIMEOUT_MS);
  assert.equal(INDICATOR_TTL_MS.compacted, COMPACTED_NOTICE_MS);
  assert.equal(INDICATOR_TTL_MS.coldLoad, COLD_LOAD_TIMEOUT_MS);
  assert.ok(COLD_LOAD_TIMEOUT_MS > LOOKING_UP_TIMEOUT_MS);
});

test('staleness: nextIndicatorDeadline lets the shell schedule ONE timer instead of polling', () => {
  assert.equal(nextIndicatorDeadline(emptyIndicatorState(), T0), null);

  let st = reduceIndicator(emptyIndicatorState(), { kind: 'lookingUp', at: T0 }, T0);
  st = reduceIndicator(st, { kind: 'rolling', at: T0 + 100 }, T0 + 100);
  // the roll cue expires first
  assert.equal(nextIndicatorDeadline(st, T0 + 100), T0 + 100 + ROLLING_CUE_MS);
  // once something is already due, "now" is returned so the caller re-renders immediately
  assert.equal(nextIndicatorDeadline(st, T0 + 1e6), T0 + 1e6);

  const pruned = pruneIndicators(st, T0 + 1e6);
  assert.equal(nextIndicatorDeadline(pruned, T0 + 1e6), null);
  // pruning is a no-op (identity) when nothing has expired
  assert.equal(pruneIndicators(st, T0 + 200), st);
  assert.deepEqual(staleIndicators(st, T0 + 200), []);
});

// ---------------------------------------------------------------------------
// The compacting HEURISTIC (CONTRACT §3c)
// ---------------------------------------------------------------------------

test('compacting: is inferred from the local percentage and is labelled as a heuristic', () => {
  const r = shapeIndicators(emptyIndicatorState(), { now: T0, percentage: 95 });
  const c = find(r, 'compacting');
  assert.ok(c, 'expected an inferred compacting cue at 95%');
  assert.equal(c.inferred, true);
  assert.equal(c.confidence, 'heuristic');
  assert.equal(c.detail.source, 'client-threshold');
  assert.equal(c.detail.threshold, COMPACTING_INFERRED_PCT);
  // Worded as a prediction, NOT as the server-asserted "⟳ Compacting context…" the contract forbids.
  assert.match(c.text, /likely soon/);
  assert.doesNotMatch(c.text, /^Compacting context/);
  assert.equal(c.expiresAt, null);  // derived fresh from the percentage each render, so no TTL
});

test('compacting: not inferred below the threshold, and never when usage is unavailable', () => {
  assert.equal(find(shapeIndicators(emptyIndicatorState(), { now: T0, percentage: COMPACTING_INFERRED_PCT - 0.1 }), 'compacting'), undefined);
  assert.ok(find(shapeIndicators(emptyIndicatorState(), { now: T0, percentage: COMPACTING_INFERRED_PCT }), 'compacting'));
  // unavailable (ok:false) must not be read as 0% NOR guessed at
  const r = shapeIndicators(emptyIndicatorState(), { now: T0, percentage: null, contextAvailable: false });
  assert.equal(find(r, 'compacting'), undefined);
  assert.equal(r.tier.key, 'unknown');
});

test('compacting: the heuristic yields to a real `compacted` confirmation', () => {
  const st = reduceIndicator(emptyIndicatorState(), { kind: 'compacted', trigger: 'auto', preTokens: 812000, postTokens: 190000 }, T0);
  const r = shapeIndicators(st, { now: T0, percentage: 99 });
  assert.deepEqual(kinds(r), ['compacted']);
});

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

test('shape: multiple live cues come back in a stable priority order', () => {
  let st = reduceIndicator(emptyIndicatorState(), { kind: 'loadingHistory', bytes: 30_000_000, at: T0 }, T0);
  st = reduceIndicator(st, { kind: 'lookingUp', mode: 'number', number: 1, at: T0 }, T0);
  st = reduceIndicator(st, { kind: 'rolling', segment: 3, at: T0 }, T0);
  st = reduceIndicator(st, { kind: 'compacted', trigger: 'auto', at: T0 }, T0);
  const r = shapeIndicators(st, { now: T0, percentage: 50 });
  assert.deepEqual(kinds(r), ['coldLoad', 'lookingUp', 'rolling', 'compacted']);
  assert.equal(r.primary.kind, 'coldLoad');
  assert.ok(r.indicators.every((i) => typeof i.text === 'string' && i.text.length > 0));
  assert.ok(r.indicators.every((i) => typeof i.icon === 'string' && i.icon.length > 0));
});

test('shape: idle state is empty but still reports a tier', () => {
  const r = shapeIndicators(emptyIndicatorState(), { now: T0, percentage: 42 });
  assert.deepEqual(r.indicators, []);
  assert.equal(r.primary, null);
  assert.equal(r.tier.key, 'roomy');
  assert.equal(r.tier.pct, 42);
});

test('shape: accepts a popover instead of a raw percentage', () => {
  const popover = shapeContextPopover({
    ok: true, totalTokens: 850000, maxTokens: 1000000, percentage: 85,
    categories: [{ name: 'Messages', tokens: 850000 }],
  });
  const r = shapeIndicators(emptyIndicatorState(), { now: T0, popover });
  assert.equal(r.tier.key, 'actNow');
  assert.equal(r.tier.pct, 85);
  assert.deepEqual(r.tier.actions, ['roll', 'newChat']);

  const unavailable = shapeContextPopover(null);
  assert.equal(shapeIndicators(emptyIndicatorState(), { now: T0, popover: unavailable }).tier.key, 'unknown');
});

test('shape: survives garbage state/opts without throwing', () => {
  for (const st of [null, undefined, 'x', 42, []]) {
    for (const opts of [undefined, null, {}, 'x', { now: 'nope', percentage: 'nope' }]) {
      assert.doesNotThrow(() => shapeIndicators(st, opts), `${st} / ${JSON.stringify(opts)}`);
      const r = shapeIndicators(st, opts);
      assert.ok(Array.isArray(r.indicators));
      assert.equal(r.tier.key, 'unknown');
    }
  }
});

test('shape: ageMs is measured against the caller-supplied clock (module is pure)', () => {
  const st = reduceIndicator(emptyIndicatorState(), { kind: 'lookingUp', at: T0 }, T0);
  assert.equal(shapeIndicators(st, { now: T0 + 1500 }).primary.ageMs, 1500);
  assert.equal(shapeIndicators(st, { now: T0 - 5000 }).primary.ageMs, 0);   // clock skew never goes negative
});
