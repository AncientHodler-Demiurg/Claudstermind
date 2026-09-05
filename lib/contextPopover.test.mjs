import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shapeContextPopover,
  contextPopoverLabel,
  segmentKey,
  pctLabel,
  formatTokens,
  CATEGORY_KEYS,
} from './contextPopover.mjs';
import { k, shapeContextUsage } from './contextUsage.mjs';

// The exact CONTRACT.md §1 example, so a drift in the server payload breaks a test here.
const CONTRACT_BREAKDOWN = {
  ok: true,
  totalTokens: 316000,
  maxTokens: 1000000,
  percentage: 31.6,
  model: 'claude-opus-4-6',
  categories: [
    { name: 'Messages', tokens: 210000, color: '#7aa2f7', pct: 21, isDeferred: false },
    { name: 'System tools', tokens: 42000, color: '#9ece6a', pct: 4.2, isDeferred: false },
    { name: 'MCP tools', tokens: 18000, color: '#e0af68', pct: 1.8, isDeferred: false },
    { name: 'Memory files', tokens: 26000, color: '#bb9af7', pct: 2.6, isDeferred: false },
    { name: 'Autocompact buffer', tokens: 20000, color: '#565f89', pct: 2, isDeferred: true },
  ],
  grid: [[{ color: '#7aa2f7', isFilled: true, tokens: 10000, pct: 1 }]],
  free: { tokens: 684000, pct: 68.4 },
  memoryFiles: [{ path: 'CLAUDE.md', type: 'project', tokens: 12000 }],
  mcpTools: [{ name: 'search', serverName: 'brain', tokens: 900, isLoaded: true }],
  systemTools: [{ name: 'Bash', tokens: 1400 }],
  systemPromptSections: [{ name: 'identity', tokens: 800 }],
};

// The zeroed ok:false object the server sends when the session cannot answer (CONTRACT.md §1).
const UNAVAILABLE = {
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
};

// Sum the exact integer tenths — summing the rounded floats is what the module exists to avoid.
const sumPct = (segs) => segs.reduce((s, x) => s + x.pctTenths, 0) / 10;

// ---------------------------------------------------------------------------
// The unavailable-vs-empty distinction (the bug this module must not re-introduce)
// ---------------------------------------------------------------------------

test('contextPopover: ok:false renders as UNAVAILABLE, not as 0% used', () => {
  const p = shapeContextPopover(UNAVAILABLE);
  assert.equal(p.available, false);
  assert.equal(p.state, 'unavailable');
  assert.equal(p.reason, 'unsupported');
  assert.equal(p.headline.pct, null);
  assert.equal(p.headline.pctLabel, '—');
  assert.equal(p.headline.available, false);
  assert.match(p.headline.text, /unavailable/i);
  assert.deepEqual(p.segments, []);
  assert.equal(p.free, null);
  assert.equal(contextPopoverLabel(p), 'Context usage unavailable');
});

test('contextPopover: a genuinely EMPTY window is available and reads 0%', () => {
  const p = shapeContextPopover({ ...UNAVAILABLE, ok: true, maxTokens: 1000000 });
  assert.equal(p.available, true);
  assert.equal(p.state, 'ready');
  assert.equal(p.headline.pct, 0);
  assert.equal(p.headline.pctLabel, '0%');
  // ...and the whole window shows as free, which is the visual difference from "unavailable".
  assert.equal(p.free.tokens, 1000000);
  assert.equal(p.free.pct, 100);
  assert.notEqual(p.state, shapeContextPopover(UNAVAILABLE).state);
});

test('contextPopover: null / undefined / garbage are unavailable with a reason, never a throw', () => {
  for (const [input, reason] of [
    [null, 'missing'],
    [undefined, 'missing'],
    ['nope', 'malformed'],
    [42, 'malformed'],
    [[], 'malformed'],
    [{}, 'malformed'],
    [{ totalTokens: 'x', maxTokens: 'y' }, 'malformed'],
  ]) {
    const p = shapeContextPopover(input);
    assert.equal(p.available, false, JSON.stringify(input));
    assert.equal(p.reason, reason, JSON.stringify(input));
    assert.equal(p.headline.pct, null);
  }
});

// ---------------------------------------------------------------------------
// Happy path against the frozen contract
// ---------------------------------------------------------------------------

test('contextPopover: contract example → ordered segments with stable keys and contract pcts', () => {
  const p = shapeContextPopover(CONTRACT_BREAKDOWN);
  assert.equal(p.available, true);
  assert.equal(p.model, 'claude-opus-4-6');
  assert.equal(p.totalTokens, 316000);
  assert.equal(p.maxTokens, 1000000);
  assert.equal(p.freeTokens, 684000);
  assert.equal(p.pctBase, 'max');
  assert.equal(p.reconciliation.kind, 'exact');

  // server order preserved, free appended last
  assert.deepEqual(p.segments.map((s) => s.key), [
    'messages', 'systemTools', 'mcpTools', 'memoryFiles', 'autocompactBuffer', 'free',
  ]);
  assert.deepEqual(p.segments.map((s) => s.pct), [21, 4.2, 1.8, 2.6, 2, 68.4]);
  assert.deepEqual(p.segments.map((s) => s.tokensLabel), ['210k', '42k', '18k', '26k', '20k', '684k']);
  assert.equal(p.segments[0].label, 'Messages');
  assert.equal(p.segments[0].color, '#7aa2f7');   // SDK colour used verbatim (Claude-GUI parity)
  assert.equal(p.segments[4].isDeferred, true);
  assert.equal(p.segments[5].isFree, true);
  assert.equal(sumPct(p.segments), 100);
});

test('contextPopover: headline reuses contextSummaryLabel so the badge and popover cannot drift', () => {
  const p = shapeContextPopover(CONTRACT_BREAKDOWN);
  assert.equal(p.headline.text, '316k / 1M (32%)');
  assert.equal(p.headline.pct, 31.6);
  assert.equal(p.headline.pctLabel, '31.6%');
  assert.equal(p.headline.tokensLabel, '316k');
  assert.equal(p.headline.maxLabel, '1M');
  assert.equal(contextPopoverLabel(p), '316k / 1M (32%)');
});

test('contextPopover: shares are percentages of USED and also total exactly 100', () => {
  const p = shapeContextPopover(CONTRACT_BREAKDOWN, { includeFree: false });
  assert.equal(p.segments.length, 5);
  assert.equal(p.segments.reduce((s, x) => s + x.shareTenths, 0), 1000);
  assert.ok(p.segments[0].share > p.segments[0].pct); // messages is 66% of used, 21% of max
  assert.equal(p.free.key, 'free');                   // still exposed separately
});

// ---------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------

test('contextPopover: thirds do not compound into 99.9% — largest remainder totals exactly 100', () => {
  const p = shapeContextPopover({
    ok: true, totalTokens: 3, maxTokens: 3, percentage: 100, model: '',
    categories: [
      { name: 'A', tokens: 1, color: '#a' },
      { name: 'B', tokens: 1, color: '#b' },
      { name: 'C', tokens: 1, color: '#c' },
    ],
  });
  assert.equal(sumPct(p.segments), 100);
  assert.deepEqual(p.segments.map((s) => s.pct), [33.4, 33.3, 33.3, 0]);
});

test('contextPopover: seven awkward slices still total exactly 100', () => {
  const cats = Array.from({ length: 7 }, (_, i) => ({ name: `S${i}`, tokens: 1 }));
  const p = shapeContextPopover({ ok: true, totalTokens: 7, maxTokens: 9, percentage: 77.8, categories: cats });
  assert.equal(sumPct(p.segments), 100);
  assert.equal(p.segments.length, 8); // 7 + free
});

test('pctLabel: one decimal, trailing .0 trimmed, unknown is an em dash', () => {
  assert.equal(pctLabel(21), '21%');
  assert.equal(pctLabel(2.64), '2.6%');
  assert.equal(pctLabel(0), '0%');
  assert.equal(pctLabel(null), '—');
  assert.equal(pctLabel(NaN), '—');
});

// ---------------------------------------------------------------------------
// Forward compatibility + key stability
// ---------------------------------------------------------------------------

test('contextPopover: an UNKNOWN future segment kind is passed through with a slug key, never dropped', () => {
  const p = shapeContextPopover({
    ok: true, totalTokens: 300, maxTokens: 1000, percentage: 30,
    categories: [
      { name: 'Messages', tokens: 100, color: '#1' },
      { name: 'Skill Files', tokens: 100, color: '#2' },          // does not exist today
      { name: 'Something Entirely New!', tokens: 100, color: '#3' },
    ],
  });
  assert.deepEqual(p.segments.map((s) => s.key), ['messages', 'skill-files', 'something-entirely-new', 'free']);
  assert.equal(p.segments[1].label, 'Skill Files');
  assert.equal(p.segments[2].tokens, 100);
});

test('contextPopover: duplicate category names still get unique keys', () => {
  const p = shapeContextPopover({
    ok: true, totalTokens: 30, maxTokens: 100, percentage: 30,
    categories: [{ name: 'Tools', tokens: 10 }, { name: 'Tools', tokens: 10 }, { name: 'Tools', tokens: 10 }],
  });
  const keys = p.segments.map((s) => s.key);
  assert.deepEqual(keys, ['tools', 'tools#2', 'tools#3', 'free']);
  assert.equal(new Set(keys).size, keys.length);
});

test('segmentKey: known names are canonical, blanks fall back, case/punctuation tolerated', () => {
  assert.equal(segmentKey('Messages'), 'messages');
  assert.equal(segmentKey('  MCP Tools '), 'mcpTools');
  assert.equal(segmentKey('Auto-compact buffer'), 'autocompactBuffer');
  assert.equal(segmentKey(''), 'segment');
  assert.equal(segmentKey(null), 'segment');
  assert.equal(segmentKey('!!!'), 'segment');
  assert.equal(segmentKey('Memory files'), CATEGORY_KEYS['memory files']);
});

// ---------------------------------------------------------------------------
// Parts vs whole
// ---------------------------------------------------------------------------

test('contextPopover: segments summing to LESS than the total get an "Other" slice', () => {
  const p = shapeContextPopover({
    ok: true, totalTokens: 300, maxTokens: 1000, percentage: 30,
    categories: [{ name: 'Messages', tokens: 100 }],
  });
  assert.equal(p.reconciliation.kind, 'padded');
  assert.equal(p.reconciliation.deltaTokens, 200);
  assert.deepEqual(p.segments.map((s) => s.key), ['messages', 'other', 'free']);
  assert.equal(p.segments[1].tokens, 200);
  assert.equal(p.segments[1].isSynthetic, true);
  assert.equal(p.freeTokens, 700);
  assert.equal(sumPct(p.segments), 100);
});

test('contextPopover: segments summing to MORE than the total stay truthful (no negative free)', () => {
  const p = shapeContextPopover({
    ok: true, totalTokens: 500, maxTokens: 1000, percentage: 50,
    categories: [{ name: 'Messages', tokens: 400 }, { name: 'Tools', tokens: 400 }],
  });
  assert.equal(p.reconciliation.kind, 'overflow');
  assert.equal(p.reconciliation.deltaTokens, 300);
  assert.equal(p.totalTokens, 500);          // the server's number is reported unchanged
  assert.equal(p.freeTokens, 200);           // but the bar is drawn from what the parts actually say
  assert.ok(p.freeTokens >= 0);
  assert.deepEqual(p.segments.map((s) => s.pct), [40, 40, 20]);
  assert.equal(sumPct(p.segments), 100);
});

test('contextPopover: over capacity clamps free to 0, flags it, and still totals 100', () => {
  const p = shapeContextPopover({
    ok: true, totalTokens: 1200, maxTokens: 1000, percentage: 120,
    categories: [{ name: 'Messages', tokens: 800 }, { name: 'Tools', tokens: 400 }],
  });
  assert.equal(p.freeTokens, 0);
  assert.equal(p.reconciliation.overCapacity, true);
  assert.equal(sumPct(p.segments), 100);
  assert.deepEqual(p.segments.map((s) => s.pct), [66.7, 33.3, 0]);
});

test('contextPopover: negative / NaN token counts are clamped, not propagated', () => {
  const p = shapeContextPopover({
    ok: true, totalTokens: 100, maxTokens: 1000, percentage: 10,
    categories: [{ name: 'A', tokens: -50 }, { name: 'B', tokens: 'oops' }, { name: 'C', tokens: 100 }],
  });
  assert.deepEqual(p.segments.map((s) => s.tokens), [0, 0, 100, 900]);
  assert.ok(p.segments.every((s) => s.pct >= 0));
  assert.equal(sumPct(p.segments), 100);
});

// ---------------------------------------------------------------------------
// Partial payloads / composition with contextUsage.mjs
// ---------------------------------------------------------------------------

test('contextPopover: missing categories / lists degrade to free-only, not a throw', () => {
  const p = shapeContextPopover({ ok: true, totalTokens: 0, maxTokens: 200000, percentage: 0 });
  assert.equal(p.available, true);
  assert.deepEqual(p.segments.map((s) => s.key), ['free']);
  assert.deepEqual(p.details, { memoryFiles: [], mcpTools: [], systemTools: [], systemPromptSections: [] });
});

test('contextPopover: accepts a RAW SDK response by running it through shapeContextUsage', () => {
  const raw = {
    totalTokens: 322000,
    maxTokens: 1000000,
    percentage: 32.2,
    model: 'claude-opus-4-8',
    categories: [{ name: 'Messages', tokens: 322000, color: '#8bc34a' }],
    gridRows: [[{ color: '#8bc34a', isFilled: true, tokens: 10000, percentage: 1 }]],
    memoryFiles: [{ path: '/p/CLAUDE.md', type: 'project', tokens: 800 }],
  };
  const fromRaw = shapeContextPopover(raw);
  const fromShaped = shapeContextPopover(shapeContextUsage(raw));
  assert.equal(fromRaw.available, true);
  assert.deepEqual(fromRaw.segments, fromShaped.segments);
  assert.equal(fromRaw.headline.text, fromShaped.headline.text);
});

test('contextPopover: maxTokens of 0 falls back to a used-relative base rather than dividing by zero', () => {
  const p = shapeContextPopover({
    ok: true, totalTokens: 100, maxTokens: 0, percentage: 0,
    categories: [{ name: 'A', tokens: 50 }, { name: 'B', tokens: 50 }],
  });
  assert.equal(p.pctBase, 'used');
  assert.equal(p.headline.maxLabel, '—');
  assert.deepEqual(p.segments.map((s) => s.pct), [50, 50, 0]);
  assert.equal(p.free.tokens, 0);
});

test('contextPopover: details are token-sorted and junk rows are dropped', () => {
  const p = shapeContextPopover({
    ...CONTRACT_BREAKDOWN,
    mcpTools: [
      { name: 'small', serverName: 'a', tokens: 10 },
      null,
      { name: 'big', serverName: 'b', tokens: 5000 },
      'nope',
    ],
  });
  assert.deepEqual(p.details.mcpTools.map((t) => t.name), ['big', 'small']);
  assert.equal(p.details.mcpTools[0].tokensLabel, '5k');
  assert.equal(p.details.memoryFiles[0].path, 'CLAUDE.md');
});

test('formatTokens is the repo\'s existing k() — reused, not reinvented', () => {
  assert.equal(formatTokens, k);
  assert.equal(formatTokens(316000), '316k');
  assert.equal(formatTokens(1000000), '1M');
  assert.equal(formatTokens(0), '0');
});

test('contextPopover: never throws on hostile input', () => {
  const hostile = [
    { ok: true },
    { ok: true, totalTokens: NaN, maxTokens: NaN },
    { ok: true, totalTokens: 1, maxTokens: 2, categories: 'not-an-array' },
    { ok: true, totalTokens: 1, maxTokens: 2, categories: [null, 5, 'x', {}] },
    { ok: true, totalTokens: Infinity, maxTokens: 10, categories: [] },
    { ok: 'yes' },
  ];
  for (const h of hostile) {
    assert.doesNotThrow(() => shapeContextPopover(h), JSON.stringify(h));
    const p = shapeContextPopover(h);
    assert.equal(typeof p.available, 'boolean');
    assert.ok(Array.isArray(p.segments));
  }
  assert.equal(contextPopoverLabel(null), 'Context usage unavailable');
  assert.equal(contextPopoverLabel('x'), 'Context usage unavailable');
});

test('contextPopover: does not mutate its input', () => {
  const input = JSON.parse(JSON.stringify(CONTRACT_BREAKDOWN));
  const copy = JSON.parse(JSON.stringify(input));
  shapeContextPopover(input);
  assert.deepEqual(input, copy);
});
