#!/usr/bin/env node
// Test: execute-phase.md includes Step 7 SUMMARY.md generation after all waves complete

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

// ============================================================
// Test 1: Step 7 section exists
// ============================================================
console.log('Test 1: Step 7 section exists');

assert(
  content.includes('### Step 7') || content.includes('Step 7'),
  'Contains Step 7 section header'
);

assert(
  content.includes('SUMMARY.md'),
  'Step 7 mentions SUMMARY.md generation'
);

// ============================================================
// Test 2: Step 7 reads task notes from TASKS.md
// ============================================================
console.log('\nTest 2: Step 7 reads task notes');

const step7 = contentFrom('### Step 7', content);

assert(
  step7.includes('task notes') || step7.includes('TASKS.md'),
  'Step 7 mentions reading task notes or TASKS.md to collect data'
);

// ============================================================
// Test 3: SUMMARY.md path pattern
// ============================================================
console.log('\nTest 3: SUMMARY.md path pattern');

assert(
  step7.includes('phases/') && step7.includes('SUMMARY.md'),
  'Contains SUMMARY.md path pattern with phases/ directory'
);

// ============================================================
// Test 4: Execution Overview section in template
// ============================================================
console.log('\nTest 4: Execution Overview section');

assert(
  step7.includes('Execution Overview'),
  'Contains Execution Overview section in template'
);

// ============================================================
// Test 5: Metrics in Execution Overview
// ============================================================
console.log('\nTest 5: Execution Overview metrics');

assert(
  step7.includes('Total tasks'),
  'Contains Total tasks metric'
);

assert(
  step7.includes('Completed'),
  'Contains Completed metric'
);

assert(
  step7.includes('Failed'),
  'Contains Failed metric'
);

assert(
  step7.includes('Completion rate'),
  'Contains Completion rate metric'
);

// ============================================================
// Test 6: Per-Wave Breakdown section
// ============================================================
console.log('\nTest 6: Per-Wave Breakdown');

assert(
  step7.includes('Per-Wave Breakdown'),
  'Contains Per-Wave Breakdown section'
);

// ============================================================
// Test 7: Deviations section in template
// ============================================================
console.log('\nTest 7: Deviations section');

assert(
  step7.includes('## Deviations'),
  'Contains ## Deviations section in template'
);

// ============================================================
// Test 8: Deviations table columns
// ============================================================
console.log('\nTest 8: Deviations table columns');

assert(
  step7.includes('Task') && step7.includes('Rule') && step7.includes('Type') && step7.includes('Description'),
  'Contains deviations table columns: Task, Rule, Type, Description'
);

// ============================================================
// Test 9: No deviations fallback
// ============================================================
console.log('\nTest 9: No deviations fallback');

assert(
  step7.includes('None -- all tasks executed exactly as planned'),
  'Contains fallback text for no deviations'
);

// ============================================================
// Test 10: Stub detection note (stubs detected at review time, not execution)
// ============================================================
console.log('\nTest 10: Stub detection note');

assert(
  step7.toLowerCase().includes('stub') && step7.toLowerCase().includes('review'),
  'Contains note about stubs being detected during review'
);

// ============================================================
// Test 11: Metrics section in template
// ============================================================
console.log('\nTest 11: Metrics section');

assert(
  step7.includes('## Metrics'),
  'Contains ## Metrics section in template'
);

// ============================================================
// Test 14: Metrics detail values
// ============================================================
console.log('\nTest 14: Metrics detail values');

assert(
  step7.includes('Start time') && step7.includes('End time') && step7.includes('Duration'),
  'Contains Start time, End time, and Duration metrics'
);

assert(
  step7.includes('Retry attempts used'),
  'Contains Retry attempts used metric'
);

assert(
  step7.includes('Deviation fixes applied'),
  'Contains Deviation fixes applied metric'
);

// ============================================================
// Test 15: Status options (COMPLETE / PARTIAL)
// ============================================================
console.log('\nTest 15: Status options');

assert(
  step7.includes('COMPLETE') && step7.includes('PARTIAL'),
  'Contains COMPLETE and PARTIAL status options'
);

// ============================================================
// Test 16: Additional stubs note from review
// ============================================================
console.log('\nTest 16: Stubs detected at review time note');

assert(
  step7.toLowerCase().includes('stub') && (step7.toLowerCase().includes('review') || step7.toLowerCase().includes('/bee:review')),
  'Contains note about stubs being detected during review'
);

// ============================================================
// Test 17: Step 7 appears AFTER Step 6
// ============================================================
console.log('\nTest 17: Step 7 ordering');

const step6Idx = content.indexOf('### Step 6');
const step7Idx = content.indexOf('### Step 7');
assert(
  step6Idx !== -1 && step7Idx !== -1 && step7Idx > step6Idx,
  'Step 7 appears AFTER Step 6 in file order'
);

// ============================================================
// Test 18: Step 6 Completion still present
// ============================================================
console.log('\nTest 18: Step 6 still present');

assert(
  content.includes('### Step 6: Completion') || content.includes('### Step 6'),
  'Existing Step 6 Completion still present'
);

// ============================================================
// Test 19: Existing steps 1-5 regression check
// ============================================================
console.log('\nTest 19: Steps 1-5 regression');

assert(
  content.includes('### Step 1: Validation Guards'),
  'Step 1 still present'
);
assert(
  content.includes('### Step 2: Load TASKS.md'),
  'Step 2 still present'
);
assert(
  content.includes('### Step 3: Parse Wave Structure'),
  'Step 3 still present'
);
assert(
  content.includes('### Step 4: Update STATE.md to EXECUTING'),
  'Step 4 still present'
);
assert(
  content.includes('### Step 5: Execute Waves'),
  'Step 5 still present'
);

// ============================================================
// Test 20: Design Notes mention SUMMARY.md
// ============================================================
console.log('\nTest 20: Design Notes mention SUMMARY.md');

const designNotes = contentFrom('**Design Notes', content);
assert(
  designNotes.includes('SUMMARY.md'),
  'Design Notes section mentions SUMMARY.md'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
