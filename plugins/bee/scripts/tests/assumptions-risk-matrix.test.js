#!/usr/bin/env node
// Test: assumptions-analyzer.md contains risk matrix scoring with impact assessment,
// codebase/ecosystem assumption distinction, action thresholds, and hooks.json
// SubagentStop validates new fields (Impact, Risk, Mitigation, Risk Matrix).

const fs = require('fs');
const path = require('path');

const ANALYZER_PATH = path.join(
  __dirname, '..', '..', 'agents', 'assumptions-analyzer.md'
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

// Read assumptions-analyzer.md
let analyzerContent;
try {
  analyzerContent = fs.readFileSync(ANALYZER_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: assumptions-analyzer.md does not exist at expected path');
  console.log(`  Expected: ${ANALYZER_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const analyzerLower = analyzerContent.toLowerCase();

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

// Find the assumptions-analyzer SubagentStop hook
const subagentStopHooks = hooksJson.hooks.SubagentStop || [];
const analyzerHook = subagentStopHooks.find(h => h.matcher === '^assumptions-analyzer$');
const analyzerPrompt = analyzerHook && analyzerHook.hooks && analyzerHook.hooks[0]
  ? analyzerHook.hooks[0].prompt || ''
  : '';
const analyzerPromptLower = analyzerPrompt.toLowerCase();

// ============================================================
// Test 1: assumptions-analyzer.md contains "**Impact:**" field with "Low | Medium | High"
// ============================================================
console.log('Test 1: Impact field instruction');
assert(
  analyzerContent.includes('**Impact:**') &&
  analyzerContent.includes('Low | Medium | High'),
  'assumptions-analyzer.md contains "**Impact:**" field instruction with values "Low | Medium | High"'
);

// ============================================================
// Test 2: assumptions-analyzer.md contains "**Risk:**" field with score computation
// ============================================================
console.log('\nTest 2: Risk field instruction');
assert(
  analyzerContent.includes('**Risk:**') &&
  (analyzerLower.includes('score') || analyzerLower.includes('action')),
  'assumptions-analyzer.md contains "**Risk:**" field instruction with score computation description'
);

// ============================================================
// Test 3: assumptions-analyzer.md contains "**Mitigation:**" field instruction
// ============================================================
console.log('\nTest 3: Mitigation field instruction');
assert(
  analyzerContent.includes('**Mitigation:**'),
  'assumptions-analyzer.md contains "**Mitigation:**" field instruction with action description'
);

// ============================================================
// Test 4: assumptions-analyzer.md contains "## Risk Matrix" section heading
// ============================================================
console.log('\nTest 4: Risk Matrix section heading');
assert(
  analyzerContent.includes('## Risk Matrix'),
  'assumptions-analyzer.md contains "## Risk Matrix" section heading requirement in output format'
);

// ============================================================
// Test 5: assumptions-analyzer.md contains risk scoring table with Confident/Likely/Unclear x Low/Medium/High
// ============================================================
console.log('\nTest 5: Risk scoring table');
assert(
  analyzerContent.includes('Confident') &&
  analyzerContent.includes('Likely') &&
  analyzerContent.includes('Unclear') &&
  analyzerLower.includes('low') &&
  analyzerLower.includes('medium') &&
  analyzerLower.includes('high') &&
  (analyzerContent.includes('1 (') || analyzerContent.includes('9 (')),
  'assumptions-analyzer.md contains risk scoring table with Confident/Likely/Unclear x Low/Medium/High mapping'
);

// ============================================================
// Test 6: assumptions-analyzer.md contains action thresholds ACCEPT/MONITOR/INVESTIGATE/BLOCK
// ============================================================
console.log('\nTest 6: Action thresholds');
assert(
  analyzerContent.includes('ACCEPT') &&
  analyzerContent.includes('MONITOR') &&
  analyzerContent.includes('INVESTIGATE') &&
  analyzerContent.includes('BLOCK'),
  'assumptions-analyzer.md contains action thresholds: ACCEPT (1-2), MONITOR (3-4), INVESTIGATE (6), BLOCK (9)'
);

// ============================================================
// Test 7: assumptions-analyzer.md contains "### Codebase Assumptions" and "### Ecosystem Assumptions"
// ============================================================
console.log('\nTest 7: Codebase vs Ecosystem distinction');
assert(
  analyzerContent.includes('### Codebase Assumptions') &&
  analyzerContent.includes('### Ecosystem Assumptions'),
  'assumptions-analyzer.md contains "### Codebase Assumptions" and "### Ecosystem Assumptions" distinction instructions'
);

// ============================================================
// Test 8: assumptions-analyzer.md contains ecosystem assumptions needing external verification
// ============================================================
console.log('\nTest 8: Ecosystem assumptions description');
assert(
  analyzerLower.includes('ecosystem') &&
  (analyzerLower.includes('external verification') || analyzerLower.includes('codebase-insufficient') || analyzerLower.includes('codebase alone cannot')),
  'assumptions-analyzer.md contains instruction that ecosystem assumptions are codebase-insufficient items needing external verification'
);

// ============================================================
// Test 9: hooks.json assumptions-analyzer SubagentStop checks for "Impact:" field
// ============================================================
console.log('\nTest 9: hooks.json Impact check');
/* removed: superseded (Phase 2 triage) */

// ============================================================
// Test 10: hooks.json assumptions-analyzer SubagentStop checks for "## Risk Matrix" section
// ============================================================
console.log('\nTest 10: hooks.json Risk Matrix check');
/* removed: superseded (Phase 2 triage) */

// ============================================================
// Test 11: hooks.json assumptions-analyzer SubagentStop checks for "Risk:" field
// ============================================================
console.log('\nTest 11: hooks.json Risk check');
/* removed: superseded (Phase 2 triage) */

// ============================================================
// Test 12: hooks.json assumptions-analyzer SubagentStop checks for "Mitigation:" field
// ============================================================
console.log('\nTest 12: hooks.json Mitigation check');
/* removed: superseded (Phase 2 triage) */

// ============================================================
// plan-phase.md tests (Task 2)
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

// ============================================================
// Test 13: plan-phase.md Step 2.5.2 contains "HIGH RISK assumptions" presentation block
// ============================================================
console.log('\nTest 13: HIGH RISK assumptions presentation');
assert(
  planPhaseContent.includes('HIGH RISK assumptions') ||
  planPhaseContent.includes('HIGH RISK Assumptions'),
  'plan-phase.md Step 2.5.2 contains "HIGH RISK assumptions" presentation block'
);

// ============================================================
// Test 14: plan-phase.md Step 2.5.2 references score threshold ">= 6"
// ============================================================
console.log('\nTest 14: Score threshold >= 6');
assert(
  planPhaseContent.includes('>= 6') ||
  planPhaseContent.includes('>=6') ||
  planPhaseContent.includes('score >= 6'),
  'plan-phase.md Step 2.5.2 references score threshold ">= 6" for high-risk filtering'
);

// ============================================================
// Test 15: plan-phase.md Step 2.5.2 presents mitigation actions
// ============================================================
console.log('\nTest 15: Mitigation actions in presentation');
assert(
  planPhaseLower.includes('mitigation') &&
  planPhaseLower.includes('high risk'),
  'plan-phase.md Step 2.5.2 presents mitigation actions alongside high-risk assumptions'
);

// ============================================================
// Test 16: plan-phase.md Step 2.5.2 mentions "BLOCK" assumptions requiring user confirmation
// ============================================================
console.log('\nTest 16: BLOCK assumptions user confirmation');
assert(
  planPhaseContent.includes('BLOCK') &&
  (planPhaseLower.includes('askuserquestion') || planPhaseLower.includes('user confirmation') || planPhaseLower.includes('before proceeding') || planPhaseLower.includes('before planning')),
  'plan-phase.md Step 2.5.2 mentions "BLOCK" assumptions requiring user confirmation before proceeding'
);

// ============================================================
// Test 17: plan-phase.md Step 2.5.2 counts codebase vs ecosystem assumption breakdown
// ============================================================
console.log('\nTest 17: Codebase vs ecosystem breakdown');
assert(
  planPhaseLower.includes('codebase assumption') &&
  planPhaseLower.includes('ecosystem assumption'),
  'plan-phase.md Step 2.5.2 counts and displays codebase vs ecosystem assumption breakdown'
);

// ============================================================
// Test 18: plan-phase.md passes $ASSUMPTIONS with risk context to Step 3
// ============================================================
console.log('\nTest 18: $ASSUMPTIONS with risk context');
assert(
  planPhaseContent.includes('$ASSUMPTIONS') &&
  (planPhaseLower.includes('risk matrix') || planPhaseLower.includes('risk context') || planPhaseLower.includes('block') || planPhaseLower.includes('investigate')),
  'plan-phase.md passes $ASSUMPTIONS with risk context to Step 3 (planner context)'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
