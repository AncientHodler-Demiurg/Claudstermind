#!/usr/bin/env node
// Test: seed.md, backlog.md, and new-spec.md seed integration.
// Validates frontmatter, guards, input parsing, seed limit, auto-archive,
// seed file format, subcommands, trigger matching, and design conventions.

const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', '..');

function readFile(relPath) {
  return fs.readFileSync(path.join(BASE, relPath), 'utf8');
}

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

// Helper: extract YAML frontmatter
function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

// ============================================================
// Load files
// ============================================================

let seedContent;
try {
  seedContent = readFile('commands/seed.md');
} catch (e) {
  console.log('FAIL: seed.md does not exist at expected path');
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

let backlogContent;
try {
  backlogContent = readFile('commands/backlog.md');
} catch (e) {
  console.log('FAIL: backlog.md does not exist at expected path');
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

let newSpecContent;
try {
  newSpecContent = readFile('commands/new-spec.md');
} catch (e) {
  console.log('FAIL: new-spec.md does not exist at expected path');
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const seedFrontmatter = extractFrontmatter(seedContent);
const backlogFrontmatter = extractFrontmatter(backlogContent);
const seedLower = seedContent.toLowerCase();
const backlogLower = backlogContent.toLowerCase();
const newSpecLower = newSpecContent.toLowerCase();

// ============================================================
// seed.md Tests (1-12)
// ============================================================

console.log('--- seed.md Tests ---');

// Test 1: File starts with frontmatter delimiter
console.log('\nTest 1: Frontmatter delimiter');
assert(
  seedContent.startsWith('---'),
  'seed.md starts with YAML frontmatter delimiter'
);

// Test 2: Frontmatter has description mentioning seed or idea
console.log('\nTest 2: Frontmatter description');
assert(
  seedFrontmatter.includes('description:') &&
  (seedFrontmatter.toLowerCase().includes('seed') || seedFrontmatter.toLowerCase().includes('idea')),
  'Frontmatter has description field mentioning "seed" or "idea"'
);

// Test 3: Frontmatter has argument-hint with --trigger
console.log('\nTest 3: Frontmatter argument-hint');
assert(
  seedFrontmatter.includes('argument-hint:') &&
  seedFrontmatter.includes('--trigger'),
  'Frontmatter has argument-hint with --trigger'
);

// Test 4: NOT_INITIALIZED guard
console.log('\nTest 4: NOT_INITIALIZED guard');
assert(
  seedContent.includes('NOT_INITIALIZED') && seedContent.includes('/bee:init'),
  'NOT_INITIALIZED guard present directing to /bee:init'
);

// Test 5: --trigger flag handling
console.log('\nTest 5: --trigger flag handling');
assert(
  seedContent.includes('--trigger') && seedLower.includes('parse'),
  'Contains --trigger flag parsing'
);

// Test 6: Seed limit (20 max active seeds)
console.log('\nTest 6: Seed limit (20 max)');
assert(
  seedContent.includes('20') && seedLower.includes('limit'),
  'Contains 20 active seed limit'
);

// Test 7: Auto-archive for 6 month expiry
console.log('\nTest 7: Auto-archive (6 month expiry)');
assert(
  seedLower.includes('6 month') && seedLower.includes('auto-archive'),
  'Contains 6 month auto-archive logic'
);

// Test 8: Seed file format - status: active
console.log('\nTest 8: Seed file format - status: active');
assert(
  seedContent.includes('status: active'),
  'Seed file template includes status: active'
);

// Test 9: Seed file format - declined: 0
console.log('\nTest 9: Seed file format - declined: 0');
assert(
  seedContent.includes('declined: 0'),
  'Seed file template includes declined: 0'
);

// Test 10: Seed file format - planted date
console.log('\nTest 10: Seed file format - planted date');
assert(
  seedContent.includes('planted:'),
  'Seed file template includes planted: date field'
);

// Test 11: Seed ID pattern (seed-NNN)
console.log('\nTest 11: Seed ID pattern');
assert(
  seedContent.includes('seed-') && seedContent.includes('.bee/seeds/'),
  'Contains seed-NNN file pattern in .bee/seeds/ directory'
);

// Test 12: mkdir -p .bee/seeds/
console.log('\nTest 12: Seeds directory creation');
assert(
  seedContent.includes('mkdir -p .bee/seeds/'),
  'Creates seeds directory with mkdir -p .bee/seeds/'
);

// Test 13: AskUserQuestion present
console.log('\nTest 13: AskUserQuestion');
assert(
  seedContent.includes('AskUserQuestion'),
  'AskUserQuestion present for user interaction'
);

// Test 14: Design Notes section
console.log('\nTest 14: Design Notes');
assert(
  seedContent.includes('Design Notes'),
  'Design Notes section present'
);

// ============================================================
// backlog.md Tests (15-26)
// ============================================================

console.log('\n--- backlog.md Tests ---');

// Test 15: File starts with frontmatter delimiter
console.log('\nTest 15: Frontmatter delimiter');
assert(
  backlogContent.startsWith('---'),
  'backlog.md starts with YAML frontmatter delimiter'
);

// Test 16: Frontmatter has description
console.log('\nTest 16: Frontmatter description');
assert(
  backlogFrontmatter.includes('description:'),
  'Frontmatter has description field'
);

// Test 17: Frontmatter has argument-hint with list|promote|archive
console.log('\nTest 17: Frontmatter argument-hint');
assert(
  backlogFrontmatter.includes('argument-hint:') &&
  backlogFrontmatter.includes('list') &&
  backlogFrontmatter.includes('promote') &&
  backlogFrontmatter.includes('archive'),
  'Frontmatter has argument-hint with list|promote|archive'
);

// Test 18: NOT_INITIALIZED guard
console.log('\nTest 18: NOT_INITIALIZED guard');
assert(
  backlogContent.includes('NOT_INITIALIZED') && backlogContent.includes('/bee:init'),
  'NOT_INITIALIZED guard present directing to /bee:init'
);

// Test 19: List subcommand with table display
console.log('\nTest 19: List subcommand with table');
assert(
  backlogContent.includes('| ID') && backlogContent.includes('| Idea') && backlogContent.includes('| Trigger'),
  'List subcommand displays table with ID, Idea, Trigger columns'
);

// Test 20: Promote subcommand with status update
console.log('\nTest 20: Promote subcommand');
assert(
  backlogLower.includes('promote') && backlogContent.includes('status: promoted'),
  'Promote subcommand updates status to promoted'
);

// Test 21: Archive subcommand with status update
console.log('\nTest 21: Archive subcommand');
assert(
  backlogContent.includes('status: archived') && backlogContent.includes('archived_date'),
  'Archive subcommand sets status: archived and archived_date'
);

// Test 22: Seed glob pattern
console.log('\nTest 22: Seed glob pattern');
assert(
  backlogContent.includes('.bee/seeds/seed-*.md'),
  'Contains .bee/seeds/seed-*.md glob pattern'
);

// Test 23: Empty state message
console.log('\nTest 23: Empty state message');
assert(
  backlogLower.includes('no seeds') && backlogContent.includes('/bee:seed'),
  'Contains message for no seeds found with /bee:seed reference'
);

// Test 24: AskUserQuestion present
console.log('\nTest 24: AskUserQuestion');
assert(
  backlogContent.includes('AskUserQuestion'),
  'AskUserQuestion present for user interaction'
);

// Test 25: Does NOT use agents (no Task() spawning)
console.log('\nTest 25: No agents');
assert(
  !backlogContent.includes('Task(') || backlogContent.includes('No Task()'),
  'Does NOT use Task() agents'
);

// Test 26: Design Notes present
console.log('\nTest 26: Design Notes');
assert(
  backlogContent.includes('Design Notes'),
  'Design Notes section present'
);

// ============================================================
// new-spec.md Seed Integration Tests (27-33)
// ============================================================

console.log('\n--- new-spec.md Seed Integration Tests ---');

// Test 27: Contains Surface Matching Seeds step
console.log('\nTest 27: Surface Matching Seeds step');
assert(
  newSpecContent.includes('Surface Matching Seeds'),
  'new-spec.md contains "Surface Matching Seeds" step'
);

// Test 28: Contains .bee/seeds/ directory check
console.log('\nTest 28: Seeds directory check');
assert(
  newSpecContent.includes('.bee/seeds/') && newSpecLower.includes('exist'),
  'new-spec.md checks if .bee/seeds/ directory exists'
);

// Test 29: Contains LLM trigger matching reference
console.log('\nTest 29: LLM trigger matching');
assert(
  newSpecLower.includes('llm') && newSpecLower.includes('trigger') && newSpecLower.includes('match'),
  'new-spec.md references LLM trigger matching'
);

// Test 30: Contains Include, Skip, and Archive options
console.log('\nTest 30: Include/Skip/Archive options');
assert(
  newSpecContent.includes('"Include"') && newSpecContent.includes('"Skip"') && newSpecContent.includes('"Archive seed"'),
  'new-spec.md has Include, Skip, and Archive seed options'
);

// Test 31: Contains declined count increment logic
console.log('\nTest 31: Declined count increment');
assert(
  newSpecLower.includes('declined') && newSpecLower.includes('increment'),
  'new-spec.md includes declined count increment logic'
);

// Test 32: Contains incorporated status for included seeds
console.log('\nTest 32: Incorporated status');
assert(
  newSpecContent.includes('incorporated'),
  'new-spec.md sets incorporated status for included seeds'
);

// Test 33: Contains seed_scan_on_new_spec config check
console.log('\nTest 33: seed_scan_on_new_spec config');
assert(
  newSpecContent.includes('seed_scan_on_new_spec'),
  'new-spec.md checks seed_scan_on_new_spec config'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
