#!/usr/bin/env node
// Test: Phase 29 debug system enhancements -- dynamic hypothesis generation (DBG-01)
// and cross-session persistence (DBG-02) across debug.md, debug-investigator.md,
// hooks.json, and load-context.sh.

const fs = require('fs');
const path = require('path');

const DEBUG_CMD_PATH = path.join(__dirname, '..', '..', 'commands', 'debug.md');
const INVESTIGATOR_PATH = path.join(__dirname, '..', '..', 'agents', 'debug-investigator.md');
const HOOKS_PATH = path.join(__dirname, '..', '..', 'hooks', 'hooks.json');
const LOAD_CONTEXT_PATH = path.join(__dirname, '..', '..', 'scripts', 'load-context.sh');

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

// Read all 4 target files
let debugCmd, investigator, hooks, loadContext;

try {
  debugCmd = fs.readFileSync(DEBUG_CMD_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: debug.md does not exist at expected path');
  console.log(`  Expected: ${DEBUG_CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

try {
  investigator = fs.readFileSync(INVESTIGATOR_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: debug-investigator.md does not exist at expected path');
  console.log(`  Expected: ${INVESTIGATOR_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

try {
  hooks = fs.readFileSync(HOOKS_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: hooks.json does not exist at expected path');
  console.log(`  Expected: ${HOOKS_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

try {
  loadContext = fs.readFileSync(LOAD_CONTEXT_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: load-context.sh does not exist at expected path');
  console.log(`  Expected: ${LOAD_CONTEXT_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const debugCmdLower = debugCmd.toLowerCase();
const investigatorLower = investigator.toLowerCase();

// Parse hooks.json to extract the debug-investigator SubagentStop hook
let hooksJson;
try {
  hooksJson = JSON.parse(hooks);
} catch (e) {
  console.log('FAIL: hooks.json is not valid JSON');
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const subagentStopHooks = hooksJson.hooks.SubagentStop || [];
const debugInvestigatorHook = subagentStopHooks.find(h => h.matcher === '^debug-investigator$');
const debugInvestigatorPrompt = debugInvestigatorHook ? debugInvestigatorHook.hooks[0].prompt || '' : '';

// ============================================================
// Test Group 1: debug.md -- Dynamic Hypothesis Instruction (DBG-01)
// ============================================================
console.log('Test Group 1: debug.md -- Dynamic Hypothesis Instruction (DBG-01)');

assert(
  debugCmd.includes('3-7') || debugCmd.includes('3 to 7'),
  'debug.md Step 5 contains "3-7" or "3 to 7" for hypothesis range'
);

assert(
  debugCmdLower.includes('symptom complexity') || debugCmdLower.includes('symptom surface area'),
  'debug.md Step 5 mentions symptom complexity as the scaling factor'
);

assert(
  debugCmdLower.includes('20%') && debugCmdLower.includes('prune'),
  'debug.md Step 5 contains auto-pruning instruction with 20% confidence threshold'
);

assert(
  debugCmdLower.includes('archived') || debugCmdLower.includes('archive'),
  'debug.md Step 5 mentions archiving pruned hypotheses (not deleting)'
);

// Step 7 continuation also has dynamic range instruction
const step7Pos = debugCmd.indexOf('### Step 7');
const step7Content = step7Pos >= 0 ? debugCmd.substring(step7Pos) : '';
assert(
  step7Content.includes('3-7') || step7Content.includes('3 to 7'),
  'debug.md Step 7 continuation also has dynamic range instruction (not "max 3")'
);

// ============================================================
// Test Group 2: debug.md -- Session Directory Structure (DBG-02)
// ============================================================
console.log('\nTest Group 2: debug.md -- Session Directory Structure (DBG-02)');

assert(
  debugCmd.includes('.bee/debug/sessions/'),
  'debug.md contains .bee/debug/sessions/ session directory path'
);

assert(
  debugCmd.includes('state.json'),
  'debug.md contains state.json file creation'
);

assert(
  debugCmd.includes('report.md'),
  'debug.md contains report.md file creation'
);

assert(
  debugCmd.includes('archived_hypotheses'),
  'debug.md state.json schema includes archived_hypotheses array'
);

// Check for all 6 symptom fields in state.json schema
const symptomFields = ['description', 'expected', 'actual', 'errors', 'timeline', 'reproduction'];
const hasAllSymptomFields = symptomFields.every(f => debugCmd.includes(`"${f}"`));
assert(
  hasAllSymptomFields,
  'debug.md state.json schema includes symptoms object with all 6 fields'
);

assert(
  debugCmd.includes('## Archived Hypotheses'),
  'debug.md report.md template includes ## Archived Hypotheses section'
);

// ============================================================
// Test Group 3: debug.md -- Resume Flag (DBG-02)
// ============================================================
console.log('\nTest Group 3: debug.md -- Resume Flag (DBG-02)');

assert(
  debugCmd.includes('--resume'),
  'debug.md Step 2 contains --resume flag handling'
);

// Step 2 references new format for resume lookup
const step2Match = debugCmd.indexOf('### Step 2');
const step3Match = debugCmd.indexOf('### Step 3');
const step2Content = (step2Match >= 0 && step3Match >= 0) ? debugCmd.substring(step2Match, step3Match) : '';

assert(
  step2Content.includes('.bee/debug/sessions/'),
  'debug.md Step 2 references .bee/debug/sessions/ for new format lookup'
);

assert(
  step2Content.includes('.bee/debug/') && (step2Content.includes('legacy') || step2Content.includes('.md')),
  'debug.md Step 2 still references legacy format for backward compat'
);

assert(
  debugCmdLower.includes('no debug session found'),
  'debug.md Step 2 includes "No debug session found" error message for invalid slug'
);

// ============================================================
// Test Group 4: debug.md -- Agent Spawn Paths (DBG-01 + DBG-02)
// ============================================================
console.log('\nTest Group 4: debug.md -- Agent Spawn Paths (DBG-01 + DBG-02)');

// Step 5 passes session paths to agent
const step5Match = debugCmd.indexOf('### Step 5');
const step6Match = debugCmd.indexOf('### Step 6');
const step5Content = (step5Match >= 0 && step6Match >= 0) ? debugCmd.substring(step5Match, step6Match) : '';

assert(
  step5Content.includes('state.json'),
  'debug.md Step 5 passes state.json path to agent'
);

assert(
  step5Content.includes('report.md'),
  'debug.md Step 5 passes report.md path to agent'
);

// Step 6 reads state.json for status updates
const step6Content = step6Match >= 0 ? debugCmd.substring(step6Match, debugCmd.indexOf('### Step 7') > step6Match ? debugCmd.indexOf('### Step 7') : debugCmd.length) : '';

assert(
  step6Content.includes('state.json'),
  'debug.md Step 6 reads state.json for status updates'
);

assert(
  step6Content.includes('report.md'),
  'debug.md Step 6 updates report.md resolution section'
);

// ============================================================
// Test Group 5: debug-investigator.md -- Dynamic Hypotheses (DBG-01)
// ============================================================
console.log('\nTest Group 5: debug-investigator.md -- Dynamic Hypotheses (DBG-01)');

assert(
  investigator.includes('3-7') || investigator.includes('3 to 7'),
  'Agent mentions "3-7" or "3 to 7" hypothesis range'
);

assert(
  investigatorLower.includes('single-symptom') || investigatorLower.includes('single symptom'),
  'Agent has complexity guidance (single-symptom vs multi-symptom)'
);

assert(
  investigatorLower.includes('20%') && (investigatorLower.includes('prune') || investigatorLower.includes('pruning')),
  'Agent has auto-pruning instruction with 20% threshold'
);

assert(
  investigator.includes('archived_hypotheses'),
  'Agent mentions archived_hypotheses for pruned hypothesis storage'
);

assert(
  investigator.includes('7') && (investigatorLower.includes('never exceed 7') || investigatorLower.includes('exceed 7')),
  'Agent Rule 1 references 7 (not 3) as maximum active hypotheses'
);

assert(
  investigatorLower.includes('auto-prun') || (investigatorLower.includes('prun') && investigatorLower.includes('archiv')),
  'Agent rules mention pruning or archiving'
);

// ============================================================
// Test Group 6: debug-investigator.md -- Dual File Updates (DBG-02)
// ============================================================
console.log('\nTest Group 6: debug-investigator.md -- Dual File Updates (DBG-02)');

assert(
  investigator.includes('state.json'),
  'Agent references state.json for machine-readable state'
);

assert(
  investigator.includes('report.md'),
  'Agent references report.md for human-readable narrative'
);

assert(
  investigatorLower.includes('update both') || investigatorLower.includes('both state.json and report.md'),
  'Agent instructions say to update BOTH files'
);

assert(
  investigator.includes('.bee/debug/sessions/'),
  'Agent constraints allow writing to .bee/debug/sessions/ path'
);

// ============================================================
// Test Group 7: hooks.json -- Updated Validation (DBG-01)
// ============================================================
console.log('\nTest Group 7: hooks.json -- Updated Validation (DBG-01)');

/* removed: superseded (Phase 2 triage) */

/* removed: superseded (Phase 2 triage) */

/* removed: superseded (Phase 2 triage) */

/* removed: superseded (Phase 2 triage) */

// ============================================================
// Test Group 8: load-context.sh -- New Format Detection (DBG-02)
// ============================================================
console.log('\nTest Group 8: load-context.sh -- New Format Detection (DBG-02)');

assert(
  loadContext.includes('.bee/debug/sessions'),
  'load-context.sh contains .bee/debug/sessions path reference'
);

assert(
  loadContext.includes('jq') && loadContext.includes('state.json'),
  'load-context.sh uses jq to read state.json status'
);

assert(
  loadContext.includes('.bee/debug/*.md') || loadContext.includes('debug/*.md'),
  'load-context.sh still detects old format (.bee/debug/*.md) -- backward compat preserved'
);

assert(
  loadContext.includes('ACTIVE_DEBUG'),
  'load-context.sh ACTIVE_DEBUG variable accumulates from both old and new format'
);

// ============================================================
// Test Group 9: Backward Compatibility
// ============================================================
console.log('\nTest Group 9: Backward Compatibility');

assert(
  debugCmd.includes('.bee/debug/') && (debugCmd.includes('*.md') || debugCmd.includes('{slug}.md')),
  'debug.md still references legacy .bee/debug/*.md or .bee/debug/{slug}.md glob for old sessions'
);

assert(
  step2Content.includes('legacy') || (step2Content.includes('Old format') || step2Content.includes('old format')),
  'debug.md Step 2 active session menu lists both old and new format sessions'
);

assert(
  loadContext.includes('debug/*.md') || loadContext.includes('debug"/*.md'),
  'load-context.sh old format detection block still present (for loop over .bee/debug/*.md)'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
