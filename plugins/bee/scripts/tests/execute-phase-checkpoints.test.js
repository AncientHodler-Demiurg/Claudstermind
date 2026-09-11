#!/usr/bin/env node
// Test: execute-phase.md includes checkpoint classification with 4 types and economy mode auto-approve

const fs = require('fs');
const path = require('path');

const EXECUTE_PHASE_PATH = path.join(__dirname, '..', '..', 'commands', 'execute-phase.md');

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

// Helper: extract content between two markers
function contentBetween(startMarker, endMarker, fullContent) {
  const startIdx = fullContent.indexOf(startMarker);
  if (startIdx === -1) return '';
  const afterStart = fullContent.substring(startIdx);
  if (!endMarker) return afterStart;
  const endIdx = afterStart.indexOf(endMarker, startMarker.length);
  if (endIdx === -1) return afterStart;
  return afterStart.substring(0, endIdx);
}

// Helper: extract content from a marker to end of file
function contentFrom(marker, fullContent) {
  const idx = fullContent.indexOf(marker);
  if (idx === -1) return '';
  return fullContent.substring(idx);
}

const content = fs.readFileSync(EXECUTE_PHASE_PATH, 'utf8');
const step5d = contentBetween('**5d.', '**5e.', content);

// ============================================================
// Test 1: Step 5d contains checkpoint classification logic
// ============================================================
console.log('Test 1: Checkpoint classification in Step 5d');

assert(
  step5d.toLowerCase().includes('checkpoint'),
  'Step 5d contains "checkpoint" classification logic'
);

// ============================================================
// Test 2: Decision checkpoint with BLOCKED: trigger
// ============================================================
console.log('\nTest 2: Decision checkpoint');

assert(
  step5d.toLowerCase().includes('decision') && step5d.includes('BLOCKED:'),
  'Contains "decision" checkpoint type with "BLOCKED:" trigger'
);

// ============================================================
// Test 3: Action checkpoint with auth gate trigger
// ============================================================
console.log('\nTest 3: Action checkpoint');

assert(
  step5d.toLowerCase().includes('action') &&
  (step5d.includes('401') || step5d.includes('403') || step5d.toLowerCase().includes('auth gate') || step5d.includes('missing env var')),
  'Contains "action" checkpoint type with 401/403/auth gate/missing env var trigger'
);

// ============================================================
// Test 4: Verify checkpoint with Wave 1 trigger
// ============================================================
console.log('\nTest 4: Verify checkpoint');

assert(
  step5d.toLowerCase().includes('verify') && step5d.includes('Wave 1'),
  'Contains "verify" checkpoint type with "Wave 1" trigger'
);

// ============================================================
// Test 5: Info checkpoint as default
// ============================================================
console.log('\nTest 5: Info checkpoint (default)');

assert(
  step5d.toLowerCase().includes('info') && (step5d.toLowerCase().includes('default') || step5d.toLowerCase().includes('other waves')),
  'Contains "info" checkpoint as default type'
);

// ============================================================
// Test 6: Economy mode / implementation_mode for auto-approve
// ============================================================
console.log('\nTest 6: Economy mode auto-approve');

assert(
  step5d.includes('implementation_mode') || step5d.toLowerCase().includes('economy'),
  'Contains "implementation_mode" or "economy" mode reference for auto-approve'
);

assert(
  step5d.toLowerCase().includes('auto-approve') || step5d.toLowerCase().includes('auto approve'),
  'Contains auto-approve mechanism for economy mode'
);

// Action checkpoints NOT auto-approved
assert(
  step5d.toLowerCase().includes('not action') || step5d.toLowerCase().includes('except action') ||
  (step5d.toLowerCase().includes('action') && step5d.toLowerCase().includes('not') && step5d.toLowerCase().includes('auto')),
  'Action checkpoints are NOT auto-approved (even in economy mode)'
);

// ============================================================
// Test 7: Decision checkpoint menu options
// ============================================================
console.log('\nTest 7: Decision checkpoint menu');

assert(
  step5d.includes('Approve direction'),
  'Decision checkpoint menu contains "Approve direction" option'
);

assert(
  step5d.includes('Reject'),
  'Decision checkpoint menu contains "Reject" option'
);

// ============================================================
// Test 8: Action checkpoint menu options
// ============================================================
console.log('\nTest 8: Action checkpoint menu');

assert(
  step5d.includes('Done -- continue'),
  'Action checkpoint menu contains "Done -- continue" option'
);

// ============================================================
// Test 9: Verify checkpoint menu options
// ============================================================
console.log('\nTest 9: Verify checkpoint menu');

assert(
  step5d.includes('Looks good -- continue') || step5d.includes('Looks good'),
  'Verify checkpoint menu contains "Looks good" option'
);

// ============================================================
// Test 10: Info checkpoint menu options
// ============================================================
console.log('\nTest 10: Info checkpoint menu');

assert(
  step5d.includes('Continue next wave'),
  'Info checkpoint menu contains "Continue next wave" option'
);

// ============================================================
// Test 11: All 4 checkpoint types use AskUserQuestion format
// ============================================================
console.log('\nTest 11: AskUserQuestion format for all types');

// Count AskUserQuestion occurrences in checkpoint section
const checkpointArea = contentFrom('Wave completion checkpoint', step5d);
const askCount = (checkpointArea.match(/AskUserQuestion/g) || []).length;
assert(
  askCount >= 4,
  `All 4 checkpoint types have AskUserQuestion format (found ${askCount})`
);

// ============================================================
// Test 12: STATE.md wave progress update still present
// ============================================================
console.log('\nTest 12: STATE.md wave progress preserved');

assert(
  step5d.includes('STATE.md') || step5d.includes('state.md'),
  'Step 5d still contains STATE.md wave progress update'
);

assert(
  step5d.includes('Wave {M}/{total_waves}') || step5d.includes('Wave {M}'),
  'Step 5d still contains wave progress tracking'
);

// ============================================================
// Test 13: BLOCKED: detection step before 5d
// ============================================================
console.log('\nTest 13: BLOCKED: detection step');

const step5c = contentBetween('**5c.', '**5d.', content);
assert(
  step5c.includes('BLOCKED:') && (step5c.includes('5c.5') || step5c.includes('Rule 4')),
  'BLOCKED: detection step exists in 5c area before Step 5d'
);

// ============================================================
// Test 14: Design Notes mention checkpoint and economy
// ============================================================
console.log('\nTest 14: Design Notes updated');

const designNotes = contentFrom('**Design Notes', content);
assert(
  designNotes.toLowerCase().includes('checkpoint'),
  'Design Notes mention "checkpoint"'
);

assert(
  designNotes.toLowerCase().includes('economy') || designNotes.toLowerCase().includes('auto-approve'),
  'Design Notes mention "economy mode" or "auto-approve"'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
