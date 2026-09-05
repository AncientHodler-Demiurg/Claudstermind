import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeContextUsage, contextSummaryLabel, k } from './contextUsage.mjs';

// Realistic sample modeled on SDKControlGetContextUsageResponse.
const SAMPLE = {
  categories: [
    { name: 'System prompt', tokens: 12000, color: '#e07b53' },
    { name: 'Tools', tokens: 34000, color: '#4a90d9' },
    { name: 'Messages', tokens: 270000, color: '#8bc34a' },
    { name: 'Deferred tools', tokens: 6000, color: '#9c27b0', isDeferred: true },
  ],
  totalTokens: 322000,
  maxTokens: 1000000,
  rawMaxTokens: 1048576,
  percentage: 32.2,
  gridRows: [
    [
      { color: '#e07b53', isFilled: true, categoryName: 'System prompt', tokens: 12000, percentage: 1.2, squareFullness: 1 },
      { color: '#4a90d9', isFilled: true, categoryName: 'Tools', tokens: 34000, percentage: 3.4, squareFullness: 0.5 },
    ],
    [
      { color: '#8bc34a', isFilled: true, categoryName: 'Messages', tokens: 270000, percentage: 27, squareFullness: 1 },
      { color: '', isFilled: false, categoryName: '', tokens: 0, percentage: 0, squareFullness: 0 },
    ],
  ],
  model: 'claude-opus-4-8',
  memoryFiles: [
    { path: '/proj/CLAUDE.md', type: 'project', tokens: 800 },
  ],
  mcpTools: [
    { name: 'search', serverName: 'brave', tokens: 400, isLoaded: true },
  ],
  systemTools: [
    { name: 'Bash', tokens: 1200 },
  ],
  systemPromptSections: [
    { name: 'Identity', tokens: 500 },
  ],
  isAutoCompactEnabled: true,
  autoCompactThreshold: 0.8,
};

test('shapes categories with computed pct and isDeferred', () => {
  const s = shapeContextUsage(SAMPLE);
  assert.equal(s.ok, true);
  assert.equal(s.categories.length, 4);
  assert.deepEqual(s.categories[0], {
    name: 'System prompt', tokens: 12000, color: '#e07b53', pct: 1.2, isDeferred: false,
  });
  // 270000 / 1000000 * 100 = 27
  assert.equal(s.categories[2].pct, 27);
  assert.equal(s.categories[3].isDeferred, true);
});

test('carries totals, model, percentage', () => {
  const s = shapeContextUsage(SAMPLE);
  assert.equal(s.totalTokens, 322000);
  assert.equal(s.maxTokens, 1000000);
  assert.equal(s.percentage, 32.2);
  assert.equal(s.model, 'claude-opus-4-8');
});

test('derives free space (never negative) with pct', () => {
  const s = shapeContextUsage(SAMPLE);
  assert.equal(s.free.tokens, 678000);
  assert.equal(s.free.pct, 67.8);
});

test('free clamps to zero when total exceeds max', () => {
  const s = shapeContextUsage({ totalTokens: 1200000, maxTokens: 1000000 });
  assert.equal(s.free.tokens, 0);
  assert.equal(s.free.pct, 0);
});

test('trims grid to {color,isFilled,tokens,pct}', () => {
  const s = shapeContextUsage(SAMPLE);
  assert.equal(s.grid.length, 2);
  assert.equal(s.grid[0].length, 2);
  assert.deepEqual(s.grid[0][0], {
    color: '#e07b53', isFilled: true, tokens: 12000, pct: 1.2,
  });
  assert.deepEqual(s.grid[1][1], {
    color: '', isFilled: false, tokens: 0, pct: 0,
  });
  // No extra keys leaked through.
  assert.deepEqual(Object.keys(s.grid[0][0]).sort(), ['color', 'isFilled', 'pct', 'tokens']);
});

test('passes through memory/mcp/system tool lists', () => {
  const s = shapeContextUsage(SAMPLE);
  assert.deepEqual(s.memoryFiles, [{ path: '/proj/CLAUDE.md', type: 'project', tokens: 800 }]);
  assert.deepEqual(s.mcpTools, [{ name: 'search', serverName: 'brave', tokens: 400, isLoaded: true }]);
  assert.deepEqual(s.systemTools, [{ name: 'Bash', tokens: 1200 }]);
  assert.deepEqual(s.systemPromptSections, [{ name: 'Identity', tokens: 500 }]);
});

test('contextSummaryLabel formats k/M/pct', () => {
  const s = shapeContextUsage(SAMPLE);
  assert.equal(contextSummaryLabel(s), '322k / 1M (32%)');
});

test('contextSummaryLabel omits size when maxTokens absent', () => {
  // Operates on an already-shaped object; maxTokens 0 => size omitted.
  assert.equal(contextSummaryLabel({ totalTokens: 5000, maxTokens: 0, percentage: 0 }), '5k (0%)');
});

test('k() formatting', () => {
  assert.equal(k(0), '0');
  assert.equal(k(940), '940');
  assert.equal(k(316000), '316k');
  assert.equal(k(1000000), '1M');
  assert.equal(k(1500000), '1.5M');
  assert.equal(k(NaN), '0');
});

test('null / {} / partial inputs give ok:false and never throw', () => {
  for (const bad of [null, undefined, {}, 42, 'x', [], { categories: 'nope' }]) {
    const s = shapeContextUsage(bad);
    assert.equal(s.ok, false, `ok:false for ${JSON.stringify(bad)}`);
    assert.equal(s.totalTokens, 0);
    assert.equal(s.maxTokens, 0);
    assert.equal(s.percentage, 0);
    assert.deepEqual(s.categories, []);
    assert.deepEqual(s.grid, []);
    assert.deepEqual(s.free, { tokens: 0, pct: 0 });
    // label on ok:false shaped is still safe
    assert.equal(contextSummaryLabel(s), '0 (0%)');
  }
});

test('malformed nested entries are filtered/coerced, no throw', () => {
  const s = shapeContextUsage({
    categories: [null, { name: 'X' }, 5],
    gridRows: [null, [null, { isFilled: true }], 'nope'],
    maxTokens: 1000,
    totalTokens: 100,
    memoryFiles: [null, {}],
    mcpTools: 'bad',
  });
  assert.equal(s.ok, true);
  assert.equal(s.categories.length, 1);
  assert.equal(s.categories[0].name, 'X');
  assert.equal(s.categories[0].tokens, 0);
  assert.equal(s.grid.length, 1); // only the one array row kept; null and 'nope' dropped
  assert.equal(s.grid[0].length, 1); // null square dropped, one object kept
  assert.deepEqual(s.mcpTools, []);
});
