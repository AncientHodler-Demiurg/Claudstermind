#!/usr/bin/env node
// Test: testing-auditor.md contains pre-plan mode for test infrastructure readiness audit,
// hooks.json SubagentStop validates pre-plan mode output, and plan-phase.md integrates
// test gap analysis as Step 2.5.4.

const fs = require('fs');
const path = require('path');

const TESTING_AUDITOR_PATH = path.join(
  __dirname, '..', '..', 'agents', 'testing-auditor.md'
);
const HOOKS_PATH = path.join(
  __dirname, '..', '..', 'hooks', 'hooks.json'
);
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

// Read testing-auditor.md
let auditorContent;
try {
  auditorContent = fs.readFileSync(TESTING_AUDITOR_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: testing-auditor.md does not exist at expected path');
  console.log(`  Expected: ${TESTING_AUDITOR_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const auditorLower = auditorContent.toLowerCase();

// Read hooks.json
let hooksContent;
try {
  hooksContent = fs.readFileSync(HOOKS_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: hooks.json does not exist at expected path');
  console.log(`  Expected: ${HOOKS_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

let hooksJson;
try {
  hooksJson = JSON.parse(hooksContent);
} catch (e) {
  console.log('FAIL: hooks.json is not valid JSON');
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// Find the testing-auditor SubagentStop hook
const subagentStopHooks = hooksJson.hooks.SubagentStop || [];
const auditorHook = subagentStopHooks.find(h => h.matcher === '^testing-auditor$');
const auditorPrompt = auditorHook && auditorHook.hooks && auditorHook.hooks[0]
  ? auditorHook.hooks[0].prompt || ''
  : '';
const auditorPromptLower = auditorPrompt.toLowerCase();

// ============================================================
// Task 1 Tests: testing-auditor.md pre-plan mode + hooks.json
// ============================================================

// Test 1: testing-auditor.md contains "MODE: pre-plan" mode detection string
console.log('Test 1: MODE: pre-plan detection string');
assert(
  auditorContent.includes('MODE: pre-plan'),
  'testing-auditor.md contains "MODE: pre-plan" mode detection string'
);

// Test 2: testing-auditor.md contains "Pre-Plan Mode Protocol" section heading
console.log('\nTest 2: Pre-Plan Mode Protocol section');
assert(
  auditorContent.includes('Pre-Plan Mode Protocol'),
  'testing-auditor.md contains "Pre-Plan Mode Protocol" section heading'
);

// Test 3: testing-auditor.md contains "### Infrastructure Status" table requirement in pre-plan output
console.log('\nTest 3: Infrastructure Status table');
assert(
  auditorContent.includes('### Infrastructure Status'),
  'testing-auditor.md contains "### Infrastructure Status" table requirement in pre-plan output'
);

// Test 4: testing-auditor.md contains "### Verdict" section with READY, NEEDS_SETUP, NO_INFRASTRUCTURE values
console.log('\nTest 4: Verdict section with verdict values');
assert(
  auditorContent.includes('### Verdict') &&
  auditorContent.includes('READY') &&
  auditorContent.includes('NEEDS_SETUP') &&
  auditorContent.includes('NO_INFRASTRUCTURE'),
  'testing-auditor.md contains "### Verdict" section with READY, NEEDS_SETUP, NO_INFRASTRUCTURE values'
);

// Test 5: testing-auditor.md contains "### Recommended Pre-Tasks" section for Wave 0 task suggestions
console.log('\nTest 5: Recommended Pre-Tasks section');
assert(
  auditorContent.includes('### Recommended Pre-Tasks'),
  'testing-auditor.md contains "### Recommended Pre-Tasks" section for Wave 0 task suggestions'
);

// Test 6: testing-auditor.md contains "### Gaps Identified" section for specific gap reporting
console.log('\nTest 6: Gaps Identified section');
assert(
  auditorContent.includes('### Gaps Identified'),
  'testing-auditor.md contains "### Gaps Identified" section for specific gap reporting'
);

// Test 7: testing-auditor.md contains infrastructure check instructions for: test framework installed, config present, fixtures exist, coverage tool
console.log('\nTest 7: Infrastructure check instructions');
assert(
  auditorLower.includes('test framework installed') &&
  auditorLower.includes('config present') &&
  (auditorLower.includes('fixtures exist') || auditorLower.includes('fixtures available')) &&
  auditorLower.includes('coverage tool'),
  'testing-auditor.md contains infrastructure check instructions for: test framework installed, config present, fixtures exist, coverage tool'
);

// Test 8: testing-auditor.md mode detection references three modes (scan, generate, pre-plan)
console.log('\nTest 8: Three modes referenced');
assert(
  auditorContent.includes('Scan Mode') &&
  auditorContent.includes('Generate Mode') &&
  auditorContent.includes('Pre-Plan Mode') &&
  (auditorContent.includes('THREE modes') || auditorContent.includes('three modes')),
  'testing-auditor.md mode detection references three modes (scan, generate, pre-plan)'
);

// Test 9: hooks.json testing-auditor SubagentStop contains "Pre-plan mode" validation
console.log('\nTest 9: hooks.json Pre-plan mode validation');
/* removed: superseded (Phase 2 triage) */

// Test 10: hooks.json testing-auditor SubagentStop checks for "## Test Gap Analysis" heading in pre-plan mode
console.log('\nTest 10: hooks.json Test Gap Analysis heading check');
/* removed: superseded (Phase 2 triage) */

// Test 11: hooks.json testing-auditor SubagentStop checks for "Infrastructure Status" table in pre-plan mode
console.log('\nTest 11: hooks.json Infrastructure Status check');
/* removed: superseded (Phase 2 triage) */

// Test 12: hooks.json testing-auditor SubagentStop checks for "Verdict" section in pre-plan mode
console.log('\nTest 12: hooks.json Verdict check');
/* removed: superseded (Phase 2 triage) */

// ============================================================
// Task 2 Tests: plan-phase.md Step 2.5.4 integration
// ============================================================

// Read plan-phase.md
let planPhaseContent;
try {
  planPhaseContent = fs.readFileSync(PLAN_PHASE_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: plan-phase.md does not exist at expected path');
  console.log(`  Expected: ${PLAN_PHASE_PATH}`);
  console.log(`\nResults: ${passed} passed, ${failed + 1} failed out of ${passed + failed + 1} assertions`);
  process.exit(1);
}

const planPhaseLower = planPhaseContent.toLowerCase();

// Test 13: plan-phase.md contains "#### 2.5.4: Test Gap Analysis" or "Step 2.5.4" section heading
console.log('\nTest 13: Step 2.5.4 section heading');
assert(
  planPhaseContent.includes('2.5.4') &&
  (planPhaseContent.includes('Test Gap Analysis') || planPhaseContent.includes('test gap analysis')),
  'plan-phase.md contains Step 2.5.4 section heading for test gap analysis'
);

// Test 14: plan-phase.md Step 2.5.4 references "research_policy" for skip/required/recommended branching
console.log('\nTest 14: research_policy branching in 2.5.4');
assert(
  planPhaseContent.includes('research_policy') &&
  planPhaseContent.includes('$TEST_GAPS'),
  'plan-phase.md Step 2.5.4 references research_policy for skip/required/recommended branching'
);

// Test 15: plan-phase.md Step 2.5.4 spawns "testing-auditor" agent with "MODE: pre-plan" instruction
console.log('\nTest 15: Spawns testing-auditor with MODE: pre-plan');
assert(
  planPhaseContent.includes('testing-auditor') &&
  planPhaseContent.includes('MODE: pre-plan'),
  'plan-phase.md Step 2.5.4 spawns testing-auditor agent with "MODE: pre-plan" instruction'
);

// Test 16: plan-phase.md Step 2.5.4 references verdict values READY, NEEDS_SETUP, NO_INFRASTRUCTURE
console.log('\nTest 16: Verdict values in plan-phase');
assert(
  planPhaseContent.includes('READY') &&
  planPhaseContent.includes('NEEDS_SETUP') &&
  planPhaseContent.includes('NO_INFRASTRUCTURE'),
  'plan-phase.md Step 2.5.4 references verdict values READY, NEEDS_SETUP, NO_INFRASTRUCTURE'
);

// Test 17: plan-phase.md Step 2.5.4 stores findings as "$TEST_GAPS" for Step 3 planner context
console.log('\nTest 17: $TEST_GAPS variable for Step 3');
assert(
  planPhaseContent.includes('$TEST_GAPS') &&
  (planPhaseLower.includes('step 3') || planPhaseLower.includes('planner context')),
  'plan-phase.md Step 2.5.4 stores findings as "$TEST_GAPS" for Step 3 planner context'
);

// Test 18: plan-phase.md Step 2.5.4 passes recommended pre-tasks to planner when verdict is not READY
console.log('\nTest 18: Pre-tasks for non-READY verdicts');
assert(
  planPhaseLower.includes('pre-tasks') &&
  (planPhaseLower.includes('wave 0') || planPhaseLower.includes('wave0')),
  'plan-phase.md Step 2.5.4 passes recommended pre-tasks to planner when verdict is not READY'
);

// Test 19: plan-phase.md "Full analysis" option includes test gap analysis (mentions 2.5.4 or test gap in full analysis flow)
console.log('\nTest 19: Full analysis includes test gap');
assert(
  planPhaseContent.includes('Full analysis') &&
  (planPhaseLower.includes('test gap analysis (2.5.4)') || planPhaseLower.includes('test gap analysis(2.5.4)')),
  'plan-phase.md "Full analysis" option includes test gap analysis (mentions 2.5.4)'
);

// Test 20: plan-phase.md "required" policy section includes test gap analysis step
console.log('\nTest 20: Required policy includes test gap analysis');
assert(
  planPhaseContent.includes('required') &&
  planPhaseLower.includes('test gap analysis (2.5.4)'),
  'plan-phase.md "required" policy section includes test gap analysis step'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
