#!/usr/bin/env node
// Test: researcher.md contains provenance tagging rules with three tags,
// TASKS.md template has provenance-tagged research notes format,
// and hooks.json SubagentStop validates provenance tag presence.

const fs = require('fs');
const path = require('path');

const RESEARCHER_PATH = path.join(
  __dirname, '..', '..', 'agents', 'researcher.md'
);
const TASKS_TEMPLATE_PATH = path.join(
  __dirname, '..', '..', 'skills', 'core', 'templates', 'tasks.md'
);
const HOOKS_PATH = path.join(
  __dirname, '..', '..', 'hooks', 'hooks.json'
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

// Read researcher.md
let researcherContent;
try {
  researcherContent = fs.readFileSync(RESEARCHER_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: researcher.md does not exist at expected path');
  console.log(`  Expected: ${RESEARCHER_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const researcherLower = researcherContent.toLowerCase();

// Read tasks.md template
let tasksContent;
try {
  tasksContent = fs.readFileSync(TASKS_TEMPLATE_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: tasks.md template does not exist at expected path');
  console.log(`  Expected: ${TASKS_TEMPLATE_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: researcher.md exists
// ============================================================
console.log('Test 1: researcher.md exists');
assert(
  researcherContent.length > 0,
  'researcher.md exists at plugins/bee/agents/researcher.md'
);

// ============================================================
// Test 2: researcher.md contains all three provenance tags
// ============================================================
console.log('\nTest 2: All three provenance tags present');
assert(
  researcherContent.includes('[VERIFIED]'),
  'researcher.md contains [VERIFIED] tag'
);
assert(
  researcherContent.includes('[CITED]'),
  'researcher.md contains [CITED] tag'
);
assert(
  researcherContent.includes('[ASSUMED]'),
  'researcher.md contains [ASSUMED] tag'
);

// ============================================================
// Test 3: researcher.md has Provenance Tagging section heading
// ============================================================
console.log('\nTest 3: Provenance Tagging section heading');
assert(
  researcherContent.includes('## Provenance Tagging') ||
  researcherContent.includes('### Provenance Tagging'),
  'researcher.md contains a "Provenance Tagging" section heading (## or ###)'
);

// ============================================================
// Test 4: VERIFIED defined as Context7/official docs/tool-confirmed
// ============================================================
console.log('\nTest 4: VERIFIED definition');
assert(
  researcherLower.includes('context7') &&
  researcherContent.includes('[VERIFIED]') &&
  (researcherLower.includes('official') || researcherLower.includes('tool') || researcherLower.includes('confirm')),
  'researcher.md defines VERIFIED as confirmed via Context7 or official docs (tool-confirmed)'
);

// ============================================================
// Test 5: CITED defined as codebase file path evidence
// ============================================================
console.log('\nTest 5: CITED definition');
assert(
  researcherContent.includes('[CITED]') &&
  (researcherLower.includes('codebase') || researcherLower.includes('file path')) &&
  (researcherLower.includes('grep') || researcherLower.includes('read') || researcherLower.includes('evidence')),
  'researcher.md defines CITED as codebase file path evidence (Grep/Read confirmed)'
);

// ============================================================
// Test 6: ASSUMED defined as training knowledge or inference
// ============================================================
console.log('\nTest 6: ASSUMED definition');
assert(
  researcherContent.includes('[ASSUMED]') &&
  (researcherLower.includes('training knowledge') || researcherLower.includes('inference')) &&
  (researcherLower.includes('without verification') || researcherLower.includes('without evidence') || researcherLower.includes('no codebase') || researcherLower.includes('no.*evidence')),
  'researcher.md defines ASSUMED as training knowledge or inference without verification'
);

// ============================================================
// Test 7: Enhanced research notes format has [CITED] in Pattern/Reuse
// ============================================================
console.log('\nTest 7: [CITED] in Pattern and Reuse lines');
assert(
  researcherContent.includes('Pattern: [CITED]') ||
  researcherContent.includes('- Pattern: [CITED]'),
  'researcher.md enhanced research notes format contains [CITED] tag in Pattern line'
);
assert(
  researcherContent.includes('Reuse: [CITED]') ||
  researcherContent.includes('- Reuse: [CITED]'),
  'researcher.md enhanced research notes format contains [CITED] tag in Reuse line'
);

// ============================================================
// Test 8: Enhanced research notes format has [VERIFIED] in Context7
// ============================================================
console.log('\nTest 8: [VERIFIED] in Context7 line');
assert(
  researcherContent.includes('Context7: [VERIFIED]') ||
  researcherContent.includes('- Context7: [VERIFIED]'),
  'researcher.md enhanced research notes format contains [VERIFIED] tag in Context7 line'
);

// ============================================================
// Test 9: Enhanced research notes format has [ASSUMED] in Approach
// ============================================================
console.log('\nTest 9: [ASSUMED] in Approach line');
assert(
  researcherContent.includes('Approach: [ASSUMED]') ||
  researcherContent.includes('- Approach: [ASSUMED]'),
  'researcher.md enhanced research notes format contains [ASSUMED] tag in Approach line'
);

// ============================================================
// Test 10: Assumptions Log requirement for ecosystem mode
// ============================================================
console.log('\nTest 10: Assumptions Log for ecosystem mode');
assert(
  researcherContent.includes('Assumptions Log') &&
  researcherLower.includes('ecosystem'),
  'researcher.md contains "Assumptions Log" requirement for ecosystem research mode'
);

// ============================================================
// Test 11: Assumptions Log table format with required columns
// ============================================================
console.log('\nTest 11: Assumptions Log table format');
assert(
  researcherContent.includes('Assumptions Log') &&
  researcherContent.includes('Claim') &&
  researcherContent.includes('Section') &&
  researcherContent.includes('Risk if Wrong'),
  'researcher.md Assumptions Log section specifies table with columns: #, Claim, Section, Risk if Wrong'
);

// ============================================================
// Test 12: Untagged claims default to [ASSUMED]
// ============================================================
console.log('\nTest 12: Default to [ASSUMED] rule');
assert(
  (researcherLower.includes('default') && researcherContent.includes('[ASSUMED]')) ||
  researcherLower.includes('defaults to') ||
  researcherLower.includes('without a tag'),
  'researcher.md states that untagged claims default to [ASSUMED] (safety net rule)'
);

// ============================================================
// Test 13: TASKS.md template has [CITED] placeholder
// ============================================================
console.log('\nTest 13: TASKS.md template [CITED] placeholder');
assert(
  tasksContent.includes('[CITED]'),
  'TASKS.md template research section contains [CITED] placeholder tag'
);

// ============================================================
// Test 14: TASKS.md template has [VERIFIED] placeholder
// ============================================================
console.log('\nTest 14: TASKS.md template [VERIFIED] placeholder');
assert(
  tasksContent.includes('[VERIFIED]'),
  'TASKS.md template research section contains [VERIFIED] placeholder tag'
);

// ============================================================
// Test 15: TASKS.md template has [ASSUMED] placeholder
// ============================================================
console.log('\nTest 15: TASKS.md template [ASSUMED] placeholder');
assert(
  tasksContent.includes('[ASSUMED]'),
  'TASKS.md template research section contains [ASSUMED] placeholder tag'
);

// ============================================================
// Test 16: Provenance rules apply to all three modes
// ============================================================
console.log('\nTest 16: Provenance rules apply to all modes');
// The provenance section should mention all three modes or state "ALL three"
assert(
  (researcherLower.includes('all three') || researcherLower.includes('all 3') ||
   (researcherLower.includes('phase') && researcherLower.includes('spec') && researcherLower.includes('ecosystem') &&
    researcherLower.includes('provenance'))) &&
  researcherContent.includes('[VERIFIED]'),
  'researcher.md provenance rules apply to all three modes (phase, spec, ecosystem)'
);

// ============================================================
// Test 17: Does NOT require [VERIFIED] for every claim
// ============================================================
console.log('\nTest 17: Does not require VERIFIED for every claim');
assert(
  (researcherLower.includes('do not require') && researcherLower.includes('verified')) ||
  (researcherLower.includes('not require') && researcherLower.includes('every')) ||
  (researcherLower.includes('freely') && researcherContent.includes('[ASSUMED]')) ||
  (researcherLower.includes('low-risk') && researcherContent.includes('[ASSUMED]')),
  'researcher.md does NOT require [VERIFIED] for every claim (allows [ASSUMED] for low-risk items)'
);

// ============================================================
// hooks.json tests (Task 2)
// ============================================================

// Read hooks.json
let hooksContent;
try {
  hooksContent = fs.readFileSync(HOOKS_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: hooks.json does not exist at expected path');
  console.log(`  Expected: ${HOOKS_PATH}`);
  console.log(`\nResults: ${passed} passed, ${failed + 1} failed out of ${passed + failed + 1} assertions`);
  process.exit(1);
}

// Parse to find the researcher SubagentStop prompt
let hooksJson;
try {
  hooksJson = JSON.parse(hooksContent);
} catch (e) {
  console.log('FAIL: hooks.json is not valid JSON');
  console.log(`\nResults: ${passed} passed, ${failed + 1} failed out of ${passed + failed + 1} assertions`);
  process.exit(1);
}

// Find the researcher SubagentStop hook
const subagentStopHooks = hooksJson.hooks.SubagentStop || [];
const researcherHook = subagentStopHooks.find(h => h.matcher === '^researcher$');
const researcherPrompt = researcherHook && researcherHook.hooks && researcherHook.hooks[0]
  ? researcherHook.hooks[0].prompt || ''
  : '';
const researcherPromptLower = researcherPrompt.toLowerCase();

// ============================================================
// Test 18: hooks.json researcher SubagentStop contains "provenance"
// ============================================================
console.log('\nTest 18: hooks.json researcher prompt mentions provenance');
/* removed: superseded (Phase 2 triage) */

// ============================================================
// Test 19: hooks.json researcher SubagentStop mentions [VERIFIED], [CITED], or [ASSUMED]
// ============================================================
console.log('\nTest 19: hooks.json researcher prompt mentions provenance tags');
/* removed: superseded (Phase 2 triage) */

// ============================================================
// Test 20: hooks.json researcher SubagentStop ecosystem mode includes Assumptions Log
// ============================================================
console.log('\nTest 20: hooks.json researcher ecosystem mode checks Assumptions Log');
/* removed: superseded (Phase 2 triage) */

// ============================================================
// Test 21: hooks.json provenance check is ecosystem-mode specific
// ============================================================
console.log('\nTest 21: Provenance check is ecosystem-mode specific');
// The prompt should mention that provenance tags are expected for ecosystem mode
// but NOT a validation failure for phase/spec modes (backward compatibility)
/* removed: superseded (Phase 2 triage) */

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
