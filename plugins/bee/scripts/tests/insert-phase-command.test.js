#!/usr/bin/env node
// Test: insert-phase.md command file has correct frontmatter, decimal numbering,
// ROADMAP.md update with (INSERTED) marker, phases.md update, STATE.md update,
// directory format {NN}-{DD}-{slug}/, validation guards, and completion menu.
// Also tests autonomous.md ROADMAP re-read and decimal phase support.

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

let insertPhase;
try {
  insertPhase = readFile('commands/insert-phase.md');
} catch (e) {
  console.log('FAIL: insert-phase.md does not exist at expected path');
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const insertPhaseLower = insertPhase.toLowerCase();
const frontmatter = extractFrontmatter(insertPhase);

let autonomous;
try {
  autonomous = readFile('commands/autonomous.md');
} catch (e) {
  console.log('FAIL: autonomous.md does not exist at expected path');
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const autonomousLower = autonomous.toLowerCase();

// ============================================================
// insert-phase.md Tests (1-15)
// ============================================================

console.log('--- insert-phase.md Tests ---');

// Test 1: File exists
console.log('\nTest 1: File exists');
assert(
  insertPhase.length > 0,
  'insert-phase.md exists at plugins/bee/commands/insert-phase.md'
);

// Test 2: Frontmatter has description mentioning insert and decimal
console.log('\nTest 2: Frontmatter description');
assert(
  frontmatter.includes('description:') &&
  frontmatter.toLowerCase().includes('insert') &&
  frontmatter.toLowerCase().includes('decimal'),
  'Frontmatter has description field mentioning "insert" and "decimal"'
);

// Test 3: Frontmatter has argument-hint with N.M pattern
console.log('\nTest 3: Frontmatter argument-hint');
assert(
  frontmatter.includes('argument-hint:') &&
  frontmatter.includes('N.M'),
  'Frontmatter has argument-hint with N.M pattern'
);

// Test 4: NOT_INITIALIZED guard
console.log('\nTest 4: NOT_INITIALIZED guard');
assert(
  insertPhase.includes('NOT_INITIALIZED') && insertPhase.includes('/bee:init'),
  'NOT_INITIALIZED guard present directing to /bee:init'
);

// Test 5: NO_SPEC guard
console.log('\nTest 5: NO_SPEC guard');
assert(
  insertPhase.includes('NO_SPEC') && insertPhase.includes('/bee:new-spec'),
  'NO_SPEC guard present directing to /bee:new-spec'
);

// Test 6: NO_PHASES guard
console.log('\nTest 6: NO_PHASES guard');
assert(
  insertPhase.includes('NO_PHASES') && insertPhaseLower.includes('phases.md'),
  'NO_PHASES guard present (phases.md required)'
);

// Test 7: NO_ROADMAP guard
console.log('\nTest 7: NO_ROADMAP guard');
assert(
  insertPhase.includes('NO_ROADMAP') && insertPhase.includes('ROADMAP.md'),
  'NO_ROADMAP guard present (ROADMAP.md required)'
);

// Test 8: Decimal numbering logic (parse N.M format)
console.log('\nTest 8: Decimal numbering logic');
assert(
  insertPhaseLower.includes('decimal') && (
    insertPhase.includes('N.M') || insertPhase.includes('$DECIMAL_SUFFIX') || insertPhase.includes('$PHASE_NUMBER')
  ),
  'Decimal numbering logic present (parse N.M format)'
);

// Test 9: Directory format {NN}-{DD}-{slug}/
console.log('\nTest 9: Directory format');
assert(
  insertPhase.includes('{NN}-{DD}-{slug}') || insertPhase.includes('NN}-{DD}'),
  'Directory format {NN}-{DD}-{slug}/ mentioned'
);

// Test 10: ROADMAP.md update with (INSERTED) marker
console.log('\nTest 10: ROADMAP.md update with (INSERTED) marker');
assert(
  insertPhase.includes('ROADMAP.md') && insertPhase.includes('(INSERTED)'),
  'ROADMAP.md update with (INSERTED) marker mentioned'
);

// Test 11: phases.md update step
console.log('\nTest 11: phases.md update');
assert(
  insertPhaseLower.includes('update phases.md') || (
    insertPhaseLower.includes('phases.md') && insertPhaseLower.includes('insert')
  ),
  'phases.md update step present'
);

// Test 12: STATE.md Phases table update
console.log('\nTest 12: STATE.md Phases table update');
assert(
  insertPhase.includes('STATE.md') && insertPhaseLower.includes('phases table'),
  'STATE.md Phases table update present'
);

// Test 13: AskUserQuestion for completion menu
console.log('\nTest 13: AskUserQuestion completion menu');
assert(
  insertPhase.includes('AskUserQuestion'),
  'AskUserQuestion present for completion menu'
);

// Test 14: "Plan Phase" option in completion menu
console.log('\nTest 14: Plan Phase option');
assert(
  insertPhase.includes('Plan Phase'),
  '"Plan Phase" option in completion menu'
);

// Test 15: Does NOT auto-commit
console.log('\nTest 15: No auto-commit');
assert(
  !insertPhase.includes('git commit'),
  'Does NOT contain git commit (no auto-commit)'
);

// ============================================================
// autonomous.md ROADMAP re-read Tests (16-21)
// ============================================================

console.log('\n--- autonomous.md ROADMAP Re-read Tests ---');

// Test 16: re-read present (case-insensitive)
console.log('\nTest 16: ROADMAP re-read');
assert(
  autonomousLower.includes('re-read'),
  'autonomous.md contains "re-read" (ROADMAP re-read step)'
);

// Test 17: 3d-bis step identifier
console.log('\nTest 17: 3d-bis step');
assert(
  autonomous.includes('3d-bis'),
  'autonomous.md contains "3d-bis" (the re-read step identifier)'
);

// Test 18: detecting inserted phases
console.log('\nTest 18: inserted detection');
assert(
  autonomousLower.includes('inserted'),
  'autonomous.md contains "inserted" (detecting inserted phases)'
);

// Test 19: decimal phase number handling
console.log('\nTest 19: decimal handling');
assert(
  autonomousLower.includes('decimal'),
  'autonomous.md contains "decimal" (decimal phase number handling)'
);

// Test 20: numeric sorting of phases
console.log('\nTest 20: numeric sorting');
assert(
  autonomousLower.includes('sort'),
  'autonomous.md contains "sort" (numeric sorting of phases)'
);

// Test 21: references insert-phase or inserted phases in re-read context
console.log('\nTest 21: insert-phase reference in re-read');
assert(
  autonomous.includes('insert-phase') || (
    autonomousLower.includes('inserted phases') && autonomousLower.includes('re-read')
  ),
  'autonomous.md references "insert-phase" or "inserted phases" in the re-read context'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
