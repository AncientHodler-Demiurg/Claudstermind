#!/usr/bin/env node
// Test: plan-phase.md Step 8 writes "Yes (1)" format in Plan Review column

const fs = require('fs');
const path = require('path');

const PLAN_PHASE_PATH = path.join(
  __dirname, '..', '..', 'commands', 'plan-phase.md'
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

// Helper: extract content between a section heading and the next heading of same or higher level
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

// Read plan-phase.md
let planPhase;
try {
  planPhase = fs.readFileSync(PLAN_PHASE_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: plan-phase.md does not exist');
  process.exit(1);
}

const step8 = extractSection('### Step 8:', planPhase);
const step9 = extractSection('### Step 9:', planPhase);

console.log('=== plan-phase.md Plan Review "Yes (1)" format ===\n');

// ----------------------------------------------------------
// Test 1: Step 8 item 2 sets Plan Review to "Yes (1)" for reviewed result
// ----------------------------------------------------------
console.log('Test 1: Step 8 Plan Review column uses "Yes (1)" for reviewed result');
assert(
  step8.includes('Yes (1)'),
  'Step 8 mentions "Yes (1)" for plan review column'
);
// The "reviewed" bullet should contain "Yes (1)"
const reviewedLine = step8.split('\n').find(l =>
  l.includes('reviewed') && l.includes('Plan Review') ||
  (l.includes('reviewed') && l.includes('set to'))
);
assert(
  reviewedLine && reviewedLine.includes('Yes (1)'),
  'Step 8 reviewed result line contains "Yes (1)"'
);

// ----------------------------------------------------------
// Test 2: Step 8 item 2 does NOT use bare "Yes" for reviewed result
// ----------------------------------------------------------
console.log('\nTest 2: Step 8 Plan Review column does not use bare "Yes" for reviewed');
// Find the specific line about plan review "reviewed" result
const planReviewLines = step8.split('\n').filter(l =>
  l.includes('reviewed') && (l.includes('set to') || l.includes('Plan Review'))
);
// None of the reviewed-result lines should have bare `Yes` without (1)
const hasBareYes = planReviewLines.some(l => {
  // Match `Yes` that is NOT followed by ` (`
  return /`Yes`/.test(l) && !l.includes('`Yes (1)`');
});
assert(
  !hasBareYes,
  'Step 8 reviewed result does not use bare `Yes` (uses `Yes (1)` instead)'
);

// ----------------------------------------------------------
// Test 3: Step 8 item 2 still sets "Skipped" for skipped result (unchanged)
// ----------------------------------------------------------
console.log('\nTest 3: Step 8 Plan Review column still uses "Skipped" for skipped result');
assert(
  step8.includes('Skipped'),
  'Step 8 still has "Skipped" value for skipped plan review'
);

// ----------------------------------------------------------
// Test 4: Step 9 completion summary shows "Yes (1)" for reviewed
// ----------------------------------------------------------
console.log('\nTest 4: Step 9 shows "Yes (1)" in plan review display');
assert(
  step9.includes('Yes (1)'),
  'Step 9 completion summary mentions "Yes (1)"'
);

// ----------------------------------------------------------
// Test 5: Step 8 Plan column still uses bare "Yes" (unchanged)
// ----------------------------------------------------------
console.log('\nTest 5: Step 8 Plan column still uses bare "Yes"');
const planColumnLine = step8.split('\n').find(l =>
  l.includes('**Plan**') && l.includes('Yes')
);
assert(
  planColumnLine && planColumnLine.includes('`Yes`'),
  'Step 8 Plan column still uses bare `Yes`'
);

// ----------------------------------------------------------
// Test 6: Step 8 status values are unchanged
// ----------------------------------------------------------
console.log('\nTest 6: Step 8 status values are unchanged');
assert(
  step8.includes('PLAN_REVIEWED'),
  'Step 8 still sets PLAN_REVIEWED status for reviewed result'
);
assert(
  step8.includes('PLANNED'),
  'Step 8 still sets PLANNED status for skipped result'
);

// ----------------------------------------------------------
// Test 7: Menu-count -- exactly one AskUserQuestion( after Step 8 (REQ-13)
// ----------------------------------------------------------
console.log('\nTest 7: Exactly one AskUserQuestion( after Step 8 heading');
const fromStep8 = planPhase.substring(planPhase.indexOf('### Step 8:'));
const askCount = (fromStep8.match(/AskUserQuestion\(/g) || []).length;
assert(
  askCount === 1,
  `D7: Exactly one AskUserQuestion( after Step 8 (got ${askCount}, expected 1)`
);

// ----------------------------------------------------------
// Test 8: Step 7 body contains zero AskUserQuestion( (REQ-13)
// ----------------------------------------------------------
console.log('\nTest 8: Step 7 body has zero AskUserQuestion(');
const step7Body = extractSection('### Step 7:', planPhase);
const step7AskCount = (step7Body.match(/AskUserQuestion\(/g) || []).length;
assert(
  step7AskCount === 0,
  `D7: Step 7 body contains zero AskUserQuestion( occurrences (got ${step7AskCount}, expected 0)`
);

// ----------------------------------------------------------
// Test 9: Step 9 conditional rendering references signal + Re-review (REQ-14)
// ----------------------------------------------------------
console.log('\nTest 9: Step 9 references $PLAN_REVIEW_ISSUES_COUNT and "Re-review"');
const step9Body = extractSection('### Step 9:', planPhase);
assert(
  step9Body.includes('$PLAN_REVIEW_ISSUES_COUNT'),
  'D8: Step 9 region references $PLAN_REVIEW_ISSUES_COUNT signal'
);
assert(
  step9Body.includes('Re-review'),
  'D8: Step 9 region contains "Re-review" alternative label'
);

// ----------------------------------------------------------
// Test 10: $PLAN_REVIEW_ISSUES_COUNT = {X} assignment is in non-fenced prose (REQ-14, F-001 fix)
// ----------------------------------------------------------
console.log('\nTest 10: $PLAN_REVIEW_ISSUES_COUNT setpoint assignment is outside display fence');
const lines = planPhase.split('\n');
let inFence = false;
let setpointInsideFence = false;
for (const line of lines) {
  if (line.trim().startsWith('```')) inFence = !inFence;
  if (line.includes('$PLAN_REVIEW_ISSUES_COUNT =') && !line.includes('==') && inFence) {
    setpointInsideFence = true;
    break;
  }
}
assert(
  !setpointInsideFence,
  'D8 F-001 fix: $PLAN_REVIEW_ISSUES_COUNT assignment is in non-fenced prose (not inside display fence)'
);

// ----------------------------------------------------------
// Test 11: Revise plan branch documents STATE.md rollback (F-002 corollary)
// ----------------------------------------------------------
console.log('\nTest 11: Step 9 Revise plan branch mentions rollback/restore');
const reviseIdx = step9Body.indexOf('Revise plan');
const reviseContext = reviseIdx >= 0 ? step9Body.substring(reviseIdx, reviseIdx + 500) : '';
assert(
  /rollback|restore/i.test(reviseContext),
  'D8 F-002 corollary: Revise plan branch documents STATE.md rollback'
);

// ----------------------------------------------------------
// Test 12: F-BUG-002 — Accept-fixes branch sets $PLAN_REVIEW_ISSUES_COUNT = 0
//   (the "Accept fixes" option in Step 6.4.1's menu must reset the issues
//   counter so Step 9 renders "Re-review" not "Plan Review").
// ----------------------------------------------------------
console.log('\nTest 12: F-BUG-002 — Step 6.4.1 Accept-fixes branch resets $PLAN_REVIEW_ISSUES_COUNT = 0');
const acceptFixesIdx = planPhase.indexOf('Accept fixes');
const acceptFixesRegion = acceptFixesIdx >= 0 ? planPhase.substring(acceptFixesIdx, acceptFixesIdx + 600) : '';
assert(
  /\$PLAN_REVIEW_ISSUES_COUNT\s*=\s*0/.test(acceptFixesRegion),
  'F-BUG-002: Accept fixes branch sets $PLAN_REVIEW_ISSUES_COUNT = 0 (issues resolved on user acceptance)'
);

// ----------------------------------------------------------
// Test 13: F-BUG-004 — Step 8 captures $PRE_PLAN_STATUS BEFORE writing new Status
// ----------------------------------------------------------
console.log('\nTest 13: F-BUG-004 — Step 8 snapshots $PRE_PLAN_STATUS before STATE.md write');
assert(
  step8.includes('$PRE_PLAN_STATUS'),
  'F-BUG-004: Step 8 captures $PRE_PLAN_STATUS snapshot before writing new Status'
);

// ----------------------------------------------------------
// Test 14: F-BUG-004 — Step 9 Revise plan branch references $PRE_PLAN_STATUS by name
// ----------------------------------------------------------
console.log('\nTest 14: F-BUG-004 — Step 9 Revise branch references $PRE_PLAN_STATUS for rollback');
assert(
  step9.includes('$PRE_PLAN_STATUS'),
  'F-BUG-004: Step 9 Revise branch references $PRE_PLAN_STATUS by name (rollback target)'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
