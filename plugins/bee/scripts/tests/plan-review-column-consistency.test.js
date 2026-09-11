#!/usr/bin/env node
// Test: Verify STATE.md Plan Review column consistency between
// plan-phase and plan-review commands.

const fs = require('fs');
const path = require('path');

const PLAN_PHASE_PATH = path.join(__dirname, '..', '..', 'commands', 'plan-phase.md');
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

// Helper: extract section from heading to next heading of same or higher level
function extractSection(heading, fullContent) {
  const startIdx = fullContent.indexOf(heading);
  if (startIdx === -1) return '';
  const afterHeading = fullContent.substring(startIdx + heading.length);
  const headingLevel = heading.match(/^#+/)?.[0].length || 2;
  const nextHeadingPattern = new RegExp(`\\n#{1,${headingLevel}} `);
  const nextH = afterHeading.search(nextHeadingPattern);
  if (nextH === -1) return afterHeading;
  return afterHeading.substring(0, nextH);
}

// Read both files
let planPhase, planReview;
try {
  planPhase = fs.readFileSync(PLAN_PHASE_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: plan-phase.md does not exist');
  process.exit(1);
}
try {
  planReview = fs.readFileSync(PLAN_REVIEW_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: plan-review.md does not exist');
  process.exit(1);
}

console.log('=== Plan Review Column Consistency ===\n');

// ----------------------------------------------------------
// Test 1: plan-phase Step 8 writes "Yes (1)" as baseline
// ----------------------------------------------------------
console.log('Test 1: plan-phase Step 8 writes "Yes (1)" as baseline');
const ppStep8 = extractSection('### Step 8:', planPhase);
assert(
  ppStep8.includes('Yes (1)'),
  'plan-phase Step 8 contains "Yes (1)" for Plan Review column'
);
// Verify the reviewed result sets it to "Yes (1)" specifically
const reviewedLines = ppStep8.split('\n').filter(l =>
  l.toLowerCase().includes('reviewed') && l.includes('Yes (1)')
);
assert(
  reviewedLines.length > 0,
  'plan-phase Step 8 reviewed result specifically sets "Yes (1)"'
);

// ----------------------------------------------------------
// Test 2: plan-review CLEAN path parses and increments N
// ----------------------------------------------------------
console.log('\nTest 2: plan-review CLEAN path parses and increments N');
const prStep4 = extractSection('### Step 4:', planReview);
// CLEAN path must mention parsing current value
assert(
  prStep4.includes('Parse') || prStep4.includes('parse'),
  'plan-review CLEAN path parses current Plan Review value'
);
// CLEAN path must mention "Yes (1)" -> N=1 parsing example
assert(
  prStep4.includes('"Yes (1)"') && prStep4.includes('N=1'),
  'plan-review CLEAN path documents "Yes (1)" -> N=1 parsing'
);
// CLEAN path must write "Yes ({N+1})"
assert(
  prStep4.includes('{N+1}'),
  'plan-review CLEAN path writes "Yes ({N+1})"'
);

// ----------------------------------------------------------
// Test 3: plan-review Approve option uses parse+increment
// ----------------------------------------------------------
console.log('\nTest 3: plan-review Approve option uses parse+increment');
// Find the Approve handler section (option a)
// Letter menus were replaced by AskUserQuestion; the parse+increment contract
// lives in the command's design notes now. Pin it content-wide.
const approveSection = planReview;
assert(
  approveSection.includes('parse') || approveSection.includes('Parse'),
  'Approve option explicitly uses parse approach'
);
assert(
  approveSection.includes('increment') || approveSection.includes('N+1'),
  'Approve option explicitly increments'
);
assert(
  approveSection.includes('never use file-count') || approveSection.includes('never use file count') ||
    approveSection.toLowerCase().includes('always parse and increment'),
  'Approve option explicitly states parse+increment (not file-count)'
);

// ----------------------------------------------------------
// Test 4: plan-review does NOT use file-counting for Plan Review value
// ----------------------------------------------------------
console.log('\nTest 4: plan-review does NOT use file-counting for Plan Review N');
// The Approve section should not describe counting PLAN-REVIEW-*.md files to determine N
// (File-counting is only used in Re-review for archive numbering, not for Plan Review column value)
assert(
  approveSection.includes('Always parse the current STATE.md Plan Review value and increment'),
  'Approve option does not count PLAN-REVIEW-*.md files for N'
);

// ----------------------------------------------------------
// Test 5: Design note with required text in plan-review.md
// ----------------------------------------------------------
console.log('\nTest 5: plan-review.md contains required design note');
const designNotesIdx = planReview.lastIndexOf('**Design Notes');
const designNotes = designNotesIdx !== -1 ? planReview.substring(designNotesIdx) : '';
// Required design note text (exact or near-exact match)
assert(
  designNotes.includes('Always parse the current STATE.md Plan Review value and increment by 1'),
  'Design note starts with "Always parse the current STATE.md Plan Review value and increment by 1"'
);
assert(
  designNotes.includes("plan-phase writes 'Yes (1)' as the baseline") ||
    designNotes.includes('plan-phase writes "Yes (1)" as the baseline'),
  'Design note mentions plan-phase writes "Yes (1)" as the baseline'
);
assert(
  designNotes.includes("Each standalone plan-review Approve writes 'Yes (N+1)'") ||
    designNotes.includes('Each standalone plan-review Approve writes "Yes (N+1)"'),
  'Design note mentions standalone plan-review Approve writes "Yes (N+1)"'
);
assert(
  designNotes.includes('N is parsed from the current value'),
  'Design note mentions N is parsed from the current value'
);

// ----------------------------------------------------------
// Test 6: No conflicting STATE.md writes -- plan-phase only writes baseline
// ----------------------------------------------------------
console.log('\nTest 6: plan-phase only writes "Yes (1)" baseline (not dynamic increment)');
// plan-phase should not have any parse+increment logic for Plan Review
// It writes a fixed "Yes (1)" and does NOT parse existing values
assert(
  !ppStep8.includes('N+1') && !ppStep8.includes('increment'),
  'plan-phase Step 8 does not use increment logic (fixed baseline only)'
);

// ----------------------------------------------------------
// Test 7: Flow trace -- "Yes (1)" -> "Yes (2)" -> "Yes (3)" is achievable
// ----------------------------------------------------------
console.log('\nTest 7: Flow trace -- parse+increment chain is documented');
// plan-review must document that "Yes (2)" is the result after first standalone review
// This is captured by the parse rules: "Yes (1)" -> N=1, write "Yes (2)"
assert(
  prStep4.includes('"Yes (2)"') || prStep4.includes("'Yes (2)'") ||
    (prStep4.includes('"Yes (1)"') && prStep4.includes('N=1') && prStep4.includes('{N+1}')),
  'plan-review documents the chain: "Yes (1)" -> N=1 -> writes "Yes (N+1)" i.e. "Yes (2)"'
);

// ----------------------------------------------------------
// Test 8: Both commands reference Plan Review in STATE.md consistently
// ----------------------------------------------------------
console.log('\nTest 8: Both commands reference Plan Review column consistently');
assert(
  planPhase.includes('Plan Review') && planReview.includes('Plan Review'),
  'Both commands reference "Plan Review" column name'
);
// Both write to STATE.md
assert(
  planPhase.includes('STATE.md') && planReview.includes('STATE.md'),
  'Both commands reference STATE.md'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
