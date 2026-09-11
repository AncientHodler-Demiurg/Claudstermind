#!/usr/bin/env node
// Test: hooks.json does NOT have stale SubagentStop entries for nonexistent
// laravel-inertia-vue agents, and generic counterpart entries still exist.
// (The laravel-inertia-vue agent files were removed; hooks were cleaned up.)

const fs = require('fs');
const path = require('path');

const HOOKS_PATH = path.join(
  __dirname, '..', '..', 'hooks', 'hooks.json'
);

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${testName}`);
  } else {
    failed++;
    console.log(`  FAIL: ${testName}`);
  }
}

// ============================================================
// Test 0: hooks.json is valid JSON
// ============================================================
console.log('Test 0: hooks.json is valid JSON');
let hooks;
try {
  const raw = fs.readFileSync(HOOKS_PATH, 'utf8');
  hooks = JSON.parse(raw);
  assert(true, 'hooks.json parses as valid JSON');
} catch (e) {
  assert(false, `hooks.json parses as valid JSON -- Error: ${e.message}`);
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: Stale laravel-inertia-vue entries are REMOVED
// ============================================================
console.log('\nTest 1: Stale laravel-inertia-vue hook entries are removed');
const stopEntries = hooks.hooks.SubagentStop;
assert(Array.isArray(stopEntries), 'SubagentStop array exists');

const staleAgentNames = [
  'laravel-inertia-vue-bug-detector',
  'laravel-inertia-vue-pattern-reviewer',
  'laravel-inertia-vue-implementer',
];
for (const name of staleAgentNames) {
  const entry = stopEntries.find(e => e.matcher === name || e.matcher === `^${name}$`);
  assert(
    entry === undefined,
    `No stale hook entry for "${name}"`
  );
}

// ============================================================
// Test 2: Generic counterpart entries still exist
// ============================================================
console.log('\nTest 2: Generic counterpart entries still exist');
// Use regex test instead of exact match (matchers use lookbehind patterns)
const genericBugDetectorFound = stopEntries.some(e => {
  try { return new RegExp(e.matcher).test('bug-detector'); } catch { return false; }
});
const genericPatternReviewerFound = stopEntries.some(e => {
  try { return new RegExp(e.matcher).test('pattern-reviewer'); } catch { return false; }
});
const genericImplementerFound = stopEntries.some(e => {
  try { return new RegExp(e.matcher).test('implementer'); } catch { return false; }
});

assert(genericBugDetectorFound, 'Generic bug-detector matched by a SubagentStop entry');
assert(genericPatternReviewerFound, 'Generic pattern-reviewer matched by a SubagentStop entry');
assert(genericImplementerFound, 'Generic implementer matched by a SubagentStop entry');

// ============================================================
// Test 3: No stale agent references anywhere in hooks
// ============================================================
console.log('\nTest 3: No stale references in hooks.json');
const agentsDir = path.join(__dirname, '..', '..', 'agents');
const agentFiles = fs.readdirSync(agentsDir)
  .filter(f => f.endsWith('.md'))
  .map(f => f.replace('.md', ''));

for (const entry of stopEntries) {
  // Terminal catch-all entry (e.g., emit-event.js telemetry) has no matcher field — skip it.
  // Phase 1 v4.5.0 introduced the catch-all at end-of-block per REQ-05; this guard prevents
  // a TypeError on undefined.replace when iterating the rewired SubagentStop block.
  if (!entry.matcher) continue;
  // Extract agent name from matcher (strip ^ and $)
  const agentName = entry.matcher.replace(/^\^/, '').replace(/\$$/, '');
  // Check agent file exists (skip matchers that don't look like agent names)
  if (/^[a-z-]+$/.test(agentName)) {
    assert(
      agentFiles.includes(agentName),
      `Hook matcher "${entry.matcher}" has a corresponding agent file`
    );
  }
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
