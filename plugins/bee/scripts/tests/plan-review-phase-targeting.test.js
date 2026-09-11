#!/usr/bin/env node
// Test: plan-review.md already accepts phase number -- confirm no regression.
// AC9: plan-review.md should remain unchanged with its existing phase number argument.

const fs = require('fs');
const path = require('path');

const PLAN_REVIEW_PATH = path.join(__dirname, '..', '..', 'commands', 'plan-review.md');

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

let content;
try {
  content = fs.readFileSync(PLAN_REVIEW_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: plan-review.md does not exist');
  process.exit(1);
}

console.log('=== plan-review.md: Phase Number Acceptance (No Regression) ===\n');

// ----------------------------------------------------------
// Test 1: argument-hint still has [phase-number]
// ----------------------------------------------------------
assert(
  content.includes('argument-hint: "[phase-number]"'),
  'argument-hint is "[phase-number]"'
);

// ----------------------------------------------------------
// Test 2: Step 1 guard 3 checks $ARGUMENTS for phase number
// ----------------------------------------------------------
assert(
  content.includes('$ARGUMENTS') && content.toLowerCase().includes('phase number'),
  'Step 1 guard checks $ARGUMENTS for phase number'
);

// ----------------------------------------------------------
// Test 3: Validation handles missing phase number
// ----------------------------------------------------------
assert(
  content.includes('Please provide a phase number') || content.includes('missing or empty'),
  'Handles missing phase number with user guidance'
);

// ----------------------------------------------------------
// Test 4: Validation handles non-existent phase
// ----------------------------------------------------------
assert(
  content.includes('does not exist'),
  'Handles non-existent phase number'
);

// ----------------------------------------------------------
// Test 5: Steps 1-4 structure intact (no accidental breakage)
// ----------------------------------------------------------
assert(
  content.includes('### Step 1: Validation Guards'),
  'Step 1 heading preserved'
);
assert(
  content.includes('### Step 2: Load Phase Context'),
  'Step 2 heading preserved'
);
assert(
  content.includes('### Step 3: Spawn Four Specialized Agents'),
  'Step 3 heading preserved'
);
assert(
  content.includes('### Step 4: Present Findings'),
  'Step 4 heading preserved'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
