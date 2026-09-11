#!/usr/bin/env node
// Test: execute-phase.md includes 3-attempt retry with diagnostic escalation and transient detection

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

let content = fs.readFileSync(EXECUTE_PHASE_PATH, 'utf8');
// v4.7: execute-phase routes its wave-execution core through the shared
// wave-execution skill — the contract is pinned on the execution path.
if (content.includes('skills/wave-execution/SKILL.md')) {
  content += fs.readFileSync(
    path.join(__dirname, '..', '..', 'skills', 'wave-execution', 'SKILL.md'),
    'utf8'
  );
}
const step5c = contentBetween('**5c.', '**5d.', content);
const failureSection = contentFrom('**On failure', step5c);
const successSection = contentBetween('**On success', '**On failure', step5c) +
  (content.includes('## Success Handling (TASKS.md Choreography)')
    ? content.substring(content.indexOf('## Success Handling (TASKS.md Choreography)'))
    : '');

// ============================================================
// Test 1: Transient error detection
// ============================================================
console.log('Test 1: Transient error detection in On failure section');

assert(
  failureSection.toLowerCase().includes('transient'),
  'On failure section contains "transient" error detection'
);

assert(
  failureSection.includes('Network error'),
  'Contains transient pattern: "Network error"'
);

assert(
  failureSection.includes('timeout'),
  'Contains transient pattern: "timeout"'
);

assert(
  failureSection.includes('rate limit'),
  'Contains transient pattern: "rate limit"'
);

assert(
  failureSection.includes('503'),
  'Contains transient pattern: "503"'
);

assert(
  failureSection.includes('ECONNREFUSED'),
  'Contains transient pattern: "ECONNREFUSED"'
);

assert(
  failureSection.includes('Do NOT count') || failureSection.includes('without counting'),
  'Transient errors do not count against attempt budget'
);

// ============================================================
// Test 2: Attempt tracking
// ============================================================
console.log('\nTest 2: Attempt number tracking');

assert(
  failureSection.includes('attempt number') || failureSection.includes('attempt count'),
  'Contains attempt number/count tracking'
);

// ============================================================
// Test 3: Attempt 1 - Diagnose root cause
// ============================================================
console.log('\nTest 3: Attempt 1 with diagnostic instruction');

assert(
  (failureSection.includes('Attempt 1 failed') || failureSection.includes('attempt 1')) &&
  (failureSection.includes('Diagnose') || failureSection.includes('root cause')),
  'Attempt 1 failed includes "Diagnose" or "root cause" instruction'
);

// ============================================================
// Test 4: Attempt 2 - Architectural check
// ============================================================
console.log('\nTest 4: Attempt 2 with architectural check');

assert(
  (failureSection.includes('Attempt 2 failed') || failureSection.includes('attempt 2')) &&
  failureSection.includes('architectural'),
  'Attempt 2 failed includes "architectural" check'
);

// ============================================================
// Test 5: Attempt 3 - Final failure with [FAILED] marking
// ============================================================
console.log('\nTest 5: Attempt 3 with [FAILED] marking');

assert(
  (failureSection.includes('Attempt 3 failed') || failureSection.includes('attempt 3') || failureSection.includes('final')) &&
  failureSection.includes('[FAILED]'),
  'Attempt 3 / final failure marks task as [FAILED]'
);

// ============================================================
// Test 6: 3 attempts not old single retry
// ============================================================
console.log('\nTest 6: Uses 3 attempts not single retry');

assert(
  failureSection.includes('three') || failureSection.includes('3') ||
  (failureSection.includes('Attempt 1') && failureSection.includes('Attempt 2') && failureSection.includes('Attempt 3')),
  'Contains reference to 3 attempts (not single retry)'
);

// Old single retry mechanism should be gone
assert(
  !failureSection.includes('Re-spawn ONE fresh implementer'),
  'Old "Re-spawn ONE fresh implementer" single-retry is removed'
);

// ============================================================
// Test 7: TaskUpdate in failure path
// ============================================================
console.log('\nTest 7: TaskUpdate in failure path');

assert(
  failureSection.includes('TaskUpdate') && (failureSection.includes('failed') || failureSection.includes('mark')),
  'Failure path contains TaskUpdate for marking task as failed'
);

// ============================================================
// Test 8: On success section preserved
// ============================================================
console.log('\nTest 8: On success section preserved');

assert(
  successSection.includes('TaskUpdate') && successSection.includes('completed'),
  'On success section still contains TaskUpdate and completed'
);

// ============================================================
// Test 9: All step headers intact
// ============================================================
console.log('\nTest 9: All step headers still present');

assert(content.includes('### Step 1'), 'Step 1 header present');
assert(content.includes('### Step 2'), 'Step 2 header present');
assert(content.includes('### Step 3'), 'Step 3 header present');
assert(content.includes('### Step 4'), 'Step 4 header present');
assert(content.includes('### Step 5'), 'Step 5 header present');
assert(content.includes('### Step 6'), 'Step 6 header present');

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
