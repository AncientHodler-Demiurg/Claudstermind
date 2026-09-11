#!/usr/bin/env node
// Test: test-gen.md command file has correct frontmatter, NOT_INITIALIZED guard,
// NO_SPEC guard, phase detection, TASKS.md loading, testing-auditor spawn
// with MODE: generate, result presentation, STATE.md update, and completion menu.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'test-gen.md'
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

// Helper: extract YAML frontmatter
function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

// Read the file
let content;
try {
  content = fs.readFileSync(CMD_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: test-gen.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lowerContent = content.toLowerCase();
const frontmatter = extractFrontmatter(content);

// ============================================================
// Test 1: test-gen.md exists
// ============================================================
console.log('Test 1: File exists');
assert(
  content.length > 0,
  'test-gen.md exists at plugins/bee/commands/test-gen.md'
);

// ============================================================
// Test 2: Frontmatter has description and argument-hint with "phase"
// ============================================================
console.log('\nTest 2: Frontmatter');
assert(
  content.startsWith('---'),
  'File starts with YAML frontmatter delimiter'
);
assert(
  frontmatter.includes('description:'),
  'Frontmatter has description field'
);
assert(
  frontmatter.includes('argument-hint:') &&
  frontmatter.toLowerCase().includes('phase'),
  'Frontmatter has argument-hint field containing "phase"'
);

// ============================================================
// Test 3: NOT_INITIALIZED guard
// ============================================================
console.log('\nTest 3: NOT_INITIALIZED guard');
assert(
  content.includes('NOT_INITIALIZED'),
  'Has NOT_INITIALIZED guard'
);
assert(
  lowerContent.includes('stop') || lowerContent.includes('do not proceed'),
  'Stops execution when not initialized'
);

// ============================================================
// Test 3b: NO_SPEC guard
// ============================================================
console.log('\nTest 3b: NO_SPEC guard');
assert(
  lowerContent.includes('no spec') || lowerContent.includes('no.*spec') ||
  (lowerContent.includes('spec') && lowerContent.includes('(none)')),
  'Has NO_SPEC guard (checks for missing spec)'
);
assert(
  content.includes('new-spec'),
  'References /bee:new-spec for NO_SPEC guard'
);

// ============================================================
// Test 4: Phase detection (from $ARGUMENTS or STATE.md)
// ============================================================
console.log('\nTest 4: Phase detection');
assert(
  content.includes('$ARGUMENTS') || content.includes('ARGUMENTS'),
  'Checks $ARGUMENTS for phase number'
);
assert(
  content.includes('STATE.md') && lowerContent.includes('phase'),
  'Reads STATE.md for phase detection'
);

// ============================================================
// Test 5: Loads TASKS.md for the target phase
// ============================================================
console.log('\nTest 5: TASKS.md loading');
assert(
  content.includes('TASKS.md'),
  'References TASKS.md'
);
const tasksMatches = content.match(/TASKS\.md/g);
assert(
  tasksMatches && tasksMatches.length >= 2,
  'TASKS.md referenced at least twice (path construction + reading)'
);

// ============================================================
// Test 6: Spawns testing-auditor agent via Task tool
// ============================================================
console.log('\nTest 6: Spawns testing-auditor');
assert(
  content.includes('testing-auditor'),
  'Spawns testing-auditor agent'
);
assert(
  lowerContent.includes('task') && lowerContent.includes('spawn') ||
  lowerContent.includes('task tool'),
  'Uses Task tool to spawn agent'
);

// ============================================================
// Test 7: Passes MODE: generate instruction
// ============================================================
console.log('\nTest 7: MODE: generate');
assert(
  content.includes('MODE: generate'),
  'Passes "MODE: generate" instruction to testing-auditor'
);

// ============================================================
// Test 8: Passes TASKS.md path in spawn context
// ============================================================
console.log('\nTest 8: TASKS.md path in spawn');
assert(
  lowerContent.includes('tasks.md') &&
  (lowerContent.includes('path') || lowerContent.includes('context')),
  'Passes TASKS.md path in the spawn context'
);

// ============================================================
// Test 8b: Model selection (economy=sonnet, quality/premium=inherit)
// ============================================================
console.log('\nTest 8b: Model selection');
assert(
  lowerContent.includes('economy') && lowerContent.includes('sonnet'),
  'Economy mode uses sonnet model'
);
assert(
  (lowerContent.includes('quality') || lowerContent.includes('premium')) &&
  (lowerContent.includes('omit') || lowerContent.includes('inherit')),
  'Quality/premium mode inherits parent model'
);

// ============================================================
// Test 8c: Phase status validation for explicit argument
// ============================================================
console.log('\nTest 8c: Phase status validation');
assert(
  lowerContent.includes('executed') || lowerContent.includes('reviewed'),
  'Validates phase has been executed before generating tests'
);

// ============================================================
// Test 9: Displays results summary after agent completes
// ============================================================
console.log('\nTest 9: Results presentation');
assert(
  (lowerContent.includes('coverage') || lowerContent.includes('generated')) &&
  (lowerContent.includes('result') || lowerContent.includes('summary')),
  'Displays results with coverage/generated info after agent completes'
);

// ============================================================
// Test 10: Has AskUserQuestion completion menu
// ============================================================
console.log('\nTest 10: Completion menu');
assert(
  content.includes('AskUserQuestion'),
  'Has AskUserQuestion completion menu'
);

// ============================================================
// Test 11: Updates STATE.md Last Action
// ============================================================
console.log('\nTest 11: STATE.md update');
const stateMatches = content.match(/STATE\.md/g);
assert(
  stateMatches && stateMatches.length >= 3,
  'STATE.md referenced at least 3 times (read + guard + update)'
);
assert(
  lowerContent.includes('last action') || lowerContent.includes('last_action'),
  'Updates Last Action in STATE.md'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
