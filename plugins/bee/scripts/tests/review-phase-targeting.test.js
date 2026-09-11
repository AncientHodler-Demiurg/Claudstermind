#!/usr/bin/env node
// Test: review.md, test.md, commit.md phase detection uses "last" instead of "first",
// and each command accepts an optional phase argument with argument-hint updates.

const fs = require('fs');
const path = require('path');

const COMMANDS_DIR = path.join(__dirname, '..', '..', 'commands');
const REVIEW_PATH = path.join(COMMANDS_DIR, 'review.md');
const TEST_PATH = path.join(COMMANDS_DIR, 'test.md');
const COMMIT_PATH = path.join(COMMANDS_DIR, 'commit.md');

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

// Read all three files
let reviewContent, testContent, commitContent;
try {
  reviewContent = fs.readFileSync(REVIEW_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: review.md does not exist');
  process.exit(1);
}
try {
  testContent = fs.readFileSync(TEST_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: test.md does not exist');
  process.exit(1);
}
try {
  commitContent = fs.readFileSync(COMMIT_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: commit.md does not exist');
  process.exit(1);
}

// ==============================================================
// AC1: review.md uses "last" not "first" for phase detection
// ==============================================================
console.log('=== AC1: review.md phase detection uses "last" ===\n');

// The phase-detection contract: review targets the LAST executed/reviewed
// phase, never the first. (The old 800-char indexOf window was broken — the
// anchor phrase never existed in review.md, so it silently checked the file
// header. Pin the contract on the whole file instead.)
assert(
  reviewContent.includes('last EXECUTED or REVIEWED phase') ||
    (reviewContent.toLowerCase().includes('auto-detect') && reviewContent.toLowerCase().includes('last')),
  'review.md phase detection targets the most recently executed phase'
);
assert(
  !reviewContent.toLowerCase().includes('find the first phase'),
  'review.md phase detection does NOT say "find the first phase"'
);

// Design notes should also reflect "last"
const reviewDesignNotes = reviewContent.substring(reviewContent.lastIndexOf('**Design Notes'));
assert(
  !reviewDesignNotes.includes('first EXECUTED'),
  'review.md design notes do NOT say "first EXECUTED"'
);

// ==============================================================
// AC2: test.md uses "last" not "first" for phase detection
// ==============================================================
console.log('\n=== AC2: test.md phase detection uses "last" ===\n');

const testPhaseDetection = testContent.substring(
  testContent.indexOf('Phase detection'),
  testContent.indexOf('Phase detection') + 800
);

assert(
  testPhaseDetection.toLowerCase().includes('last'),
  'test.md phase detection says "last"'
);
assert(
  !testPhaseDetection.toLowerCase().includes('find the first phase'),
  'test.md phase detection does NOT say "find the first phase"'
);

// Design notes should also reflect "last"
const testDesignNotes = testContent.substring(testContent.lastIndexOf('**Design Notes'));
assert(
  !testDesignNotes.includes('first REVIEWED'),
  'test.md design notes do NOT say "first REVIEWED"'
);

// ==============================================================
// AC3: commit.md uses "last" not "first" for phase detection
// ==============================================================
console.log('\n=== AC3: commit.md phase detection uses "last" ===\n');

const commitPhaseDetection = commitContent.substring(
  commitContent.indexOf('Phase detection'),
  commitContent.indexOf('Phase detection') + 800
);

assert(
  commitPhaseDetection.toLowerCase().includes('last'),
  'commit.md phase detection says "last"'
);
assert(
  !commitPhaseDetection.toLowerCase().includes('find the first phase'),
  'commit.md phase detection does NOT say "find the first phase"'
);

// ==============================================================
// AC4: review.md accepts --phase N argument and argument-hint updated
// ==============================================================
console.log('\n=== AC4: review.md --phase N argument ===\n');

// argument-hint should include --phase N
assert(
  reviewContent.includes('[--phase N]'),
  'review.md argument-hint includes "[--phase N]"'
);

// Should also still include --loop
assert(
  reviewContent.includes('[--loop]'),
  'review.md argument-hint still includes "[--loop]"'
);

// Should describe parsing --phase N from $ARGUMENTS
assert(
  reviewContent.includes('--phase') && reviewContent.includes('$ARGUMENTS'),
  'review.md describes parsing --phase from $ARGUMENTS'
);

// ==============================================================
// AC5: test.md accepts optional phase number argument
// ==============================================================
console.log('\n=== AC5: test.md phase number argument ===\n');

// argument-hint should include phase number
assert(
  testContent.includes('argument-hint:') &&
    (testContent.includes('[phase-number]') || testContent.includes('[N]')),
  'test.md argument-hint includes phase number'
);

// Should describe checking $ARGUMENTS for a phase number
assert(
  testContent.includes('$ARGUMENTS') && testContent.toLowerCase().includes('phase number'),
  'test.md describes checking $ARGUMENTS for phase number'
);

// ==============================================================
// AC6: commit.md accepts optional phase number argument
// ==============================================================
console.log('\n=== AC6: commit.md phase number argument ===\n');

// argument-hint should include phase number
assert(
  commitContent.includes('argument-hint:') &&
    (commitContent.includes('[phase-number]') || commitContent.includes('[N]')),
  'commit.md argument-hint includes phase number'
);

// Should describe checking $ARGUMENTS for a phase number
assert(
  commitContent.includes('$ARGUMENTS') && commitContent.toLowerCase().includes('phase number'),
  'commit.md describes checking $ARGUMENTS for phase number'
);

// ==============================================================
// AC7: Explicit phase argument error handling for non-existent/wrong status
// ==============================================================
console.log('\n=== AC7: Error handling for explicit phase argument ===\n');

// review.md phase-status validation: owned by the Validation Guards primitive,
// applied with explicit allowed statuses. (The old asserts matched unrelated
// text — "does not exist" came from FP-extraction prose — so they pin the
// actual guard now.)
assert(
  reviewContent.includes('Phase Status') && reviewContent.includes('$ALLOWED_STATUSES'),
  'review.md applies the Phase Status validation guard with explicit allowed statuses'
);
assert(
  reviewContent.includes('EXECUTED, REVIEWED, REVIEWING'),
  'review.md allowed statuses cover executed/reviewed/reviewing phases'
);

// test.md should handle invalid explicit phase
assert(
  testContent.toLowerCase().includes('does not exist') ||
    (testContent.includes('$ARGUMENTS') && testContent.toLowerCase().includes('phase') && testContent.toLowerCase().includes('error')),
  'test.md handles invalid explicit phase argument'
);

// commit.md should handle invalid explicit phase
assert(
  commitContent.toLowerCase().includes('does not exist') ||
    (commitContent.includes('$ARGUMENTS') && commitContent.toLowerCase().includes('phase') && commitContent.toLowerCase().includes('error')),
  'commit.md handles invalid explicit phase argument'
);

// ==============================================================
// AC9: plan-review.md already accepts phase number -- no change needed
// ==============================================================
console.log('\n=== AC9: plan-review.md unchanged ===\n');

const planReviewContent = fs.readFileSync(path.join(COMMANDS_DIR, 'plan-review.md'), 'utf8');
assert(
  planReviewContent.includes('[phase-number]'),
  'plan-review.md still has [phase-number] argument-hint'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
