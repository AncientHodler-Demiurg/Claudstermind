#!/usr/bin/env node
// Test: Phase 31 Error Recovery Enhancement (ERR-01, ERR-02) structural validation
// Validates all structural additions to execute-phase.md and progress.md

const fs = require('fs');
const path = require('path');

const EXECUTE_PHASE_PATH = path.join(__dirname, '..', '..', 'commands', 'execute-phase.md');
const PROGRESS_PATH = path.join(__dirname, '..', '..', 'commands', 'progress.md');

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

const execContent = fs.readFileSync(EXECUTE_PHASE_PATH, 'utf8');
const progressContent = fs.readFileSync(PROGRESS_PATH, 'utf8');

// ============================================================
// ERR-02: Failure Classification (execute-phase.md Step 5c)
// ============================================================
console.log('ERR-02: Failure Classification (Step 5c)');

const step5c = contentBetween('**5c.', '**5c.5.', execContent);

// 1. Step 5c contains "Failure Classification" heading
assert(
  step5c.includes('Failure Classification'),
  '1. Step 5c contains "Failure Classification" heading'
);

// 2. Step 5c contains classification table with Transient, Architectural, Persistent rows
assert(
  step5c.includes('| **Transient**') && step5c.includes('| **Architectural**') && step5c.includes('| **Persistent**'),
  '2. Step 5c contains classification table with Transient, Architectural, Persistent rows'
);

// 3. Transient patterns include expected error types
assert(
  step5c.includes('Network error') && step5c.includes('timeout') && step5c.includes('rate limit') && step5c.includes('503') && step5c.includes('ECONNREFUSED'),
  '3. Transient patterns include Network error, timeout, rate limit, 503, ECONNREFUSED'
);

// 4. Architectural patterns include expected error types
assert(
  step5c.includes('schema mismatch') && step5c.includes('missing dependency') && step5c.includes('module not found'),
  '4. Architectural patterns include schema mismatch, missing dependency, module not found'
);

// 5. Persistent is the catch-all
assert(
  step5c.includes('All other failures'),
  '5. Persistent classification is the catch-all for all other failures'
);

// 6. Priority order stated
assert(
  step5c.includes('Transient > Architectural > Persistent'),
  '6. Priority order stated: Transient > Architectural > Persistent'
);

// 7. $FAILURE_TYPE_COUNTS initialization mentioned in Step 5 area
const step5area = contentBetween('### Step 5:', '### Step 6:', execContent);
assert(
  step5area.includes('$FAILURE_TYPE_COUNTS'),
  '7. $FAILURE_TYPE_COUNTS initialization mentioned in Step 5 area'
);

// ============================================================
// ERR-02: Adaptive Retry Strategies (execute-phase.md Step 5c)
// ============================================================
console.log('\nERR-02: Adaptive Retry Strategies (Step 5c)');

// 8. Transient strategy mentions unlimited retries and exponential backoff
assert(
  step5c.includes('unlimited retries') || (step5c.includes('Unlimited retries') && step5c.includes('exponential backoff')),
  '8. Transient strategy mentions unlimited retries and exponential backoff'
);

// 9. Backoff formula includes 2^ and max 30s
assert(
  step5c.includes('2^') && step5c.includes('max 30s'),
  '9. Backoff formula includes 2^ and max 30s'
);

// 10. Transient has safety cap of 10 consecutive retries
assert(
  step5c.includes('10 consecutive transient retries'),
  '10. Transient has safety cap: 10 consecutive transient retries'
);

// 11. Architectural strategy mentions 1 attempt and escalate/conductor_blocked
assert(
  step5c.includes('1 attempt then escalate') && step5c.includes('conductor_blocked'),
  '11. Architectural strategy mentions 1 attempt then escalate and conductor_blocked'
);

// 12. Persistent strategy preserves 3-attempt budget
assert(
  step5c.includes('3-attempt budget'),
  '12. Persistent strategy preserves 3-attempt budget'
);

// 13. Attempt 1, 2, 3 logic is present in persistent section
const persistentSection = contentBetween('**Persistent failure strategy', '**5c.5.', execContent);
assert(
  persistentSection.includes('Attempt 1 failed') && persistentSection.includes('Attempt 2 failed') && persistentSection.includes('Attempt 3 failed'),
  '13. Attempt 1, 2, 3 logic is present in persistent section'
);

// 14. Per-task retry log recorded (type, attempts, reasons)
assert(
  step5c.includes('per-task retry log') || step5c.includes('retry log'),
  '14. Per-task retry log recorded'
);

// ============================================================
// ERR-01: Cascading Failure Detection (execute-phase.md Step 5c.8)
// ============================================================
console.log('\nERR-01: Cascading Failure Detection (Step 5c.8)');

const step5c8 = contentBetween('**5c.8.', '**5d.', execContent);

// 15. Step 5c.8 section exists (between 5c.7 and 5d)
assert(
  step5c8.length > 0 && step5c8.includes('Cascading Failure Detection'),
  '15. Step 5c.8 section exists with Cascading Failure Detection'
);

// 16. Cascading detection is Wave 2+ only
assert(
  step5c8.includes('Wave 2+ only') || step5c8.includes('Wave 2 or later'),
  '16. Cascading detection is Wave 2+ only'
);

// 17. Detection reads needs: field for dependency task IDs
assert(
  step5c8.includes('needs:') && step5c8.includes('dependency task ID'),
  '17. Detection reads needs: field for dependency task IDs'
);

// 18. Detection compares error messages against dependency notes
assert(
  step5c8.includes('error messages') && step5c8.includes('dependency') && step5c8.includes('notes'),
  '18. Detection compares error messages against dependency notes'
);

// 19. Overlap signals include file paths, function names, undefined, not found
assert(
  step5c8.includes('File paths') && step5c8.includes('Function') && step5c8.includes('undefined') && step5c8.includes('not found'),
  '19. Overlap signals include file paths, function names, undefined, not found'
);

// 20. Display format includes "upstream issue in"
assert(
  step5c8.includes('upstream issue in'),
  '20. Display format includes "upstream issue in"'
);

// 21. AskUserQuestion with "Re-execute root-cause task" option exists
assert(
  step5c8.includes('AskUserQuestion') && step5c8.includes('Re-execute root-cause task'),
  '21. AskUserQuestion with "Re-execute root-cause task" option exists'
);

// 22. Re-execute root-cause task handler resets task from [x] to [ ]
assert(
  step5c8.includes('Reset') && step5c8.includes('[x]') && step5c8.includes('[ ]'),
  '22. Re-execute root-cause task handler resets task from [x] to [ ]'
);

// ============================================================
// ERR-02: Metrics and SUMMARY (execute-phase.md Steps 4b, 6b, 7)
// ============================================================
console.log('\nERR-02: Metrics and SUMMARY (Steps 4b, 6b, 7)');

const step4b = contentBetween('### Step 4b:', '### Step 5:', execContent);
const step6b = contentBetween('### Step 6b:', '### Step 7:', execContent);
const step7 = contentBetween('### Step 7:', '### Step 8:', execContent);

// 23. Step 4b initial metrics JSON contains failure_types
assert(
  step4b.includes('failure_types') && step4b.includes('"transient"') && step4b.includes('"persistent"') && step4b.includes('"architectural"'),
  '23. Step 4b initial metrics JSON contains failure_types with all three types'
);

// 24. Step 6b mentions failure_types and $FAILURE_TYPE_COUNTS
assert(
  step6b.includes('failure_types') && step6b.includes('$FAILURE_TYPE_COUNTS'),
  '24. Step 6b mentions failure_types and $FAILURE_TYPE_COUNTS'
);

// 25. Step 7 SUMMARY.md template contains "Adaptive Retry Decisions" section
assert(
  step7.includes('Adaptive Retry Decisions'),
  '25. Step 7 SUMMARY.md template contains "Adaptive Retry Decisions" section'
);

// 26. Step 7 SUMMARY.md template contains "Cascading Failures" subsection
assert(
  step7.includes('Cascading Failures'),
  '26. Step 7 SUMMARY.md template contains "Cascading Failures" subsection'
);

// 27. Step 7 Metrics table contains "Failure types" row
assert(
  step7.includes('Failure types'),
  '27. Step 7 Metrics table contains "Failure types" row'
);

// ============================================================
// ERR-02: Progress Display (progress.md)
// ============================================================
console.log('\nERR-02: Progress Display (progress.md)');

// 28. progress.md contains "Failure Recovery" section
assert(
  progressContent.includes('Failure Recovery'),
  '28. progress.md contains "Failure Recovery" section'
);

// 29. progress.md references failure_types from metrics JSON
assert(
  progressContent.includes('failure_types'),
  '29. progress.md references failure_types from metrics JSON'
);

// 30. progress.md mentions transient, persistent, architectural
assert(
  progressContent.includes('transient') && progressContent.includes('persistent') && progressContent.includes('architectural'),
  '30. progress.md mentions transient, persistent, architectural'
);

// ============================================================
// Structural Integrity
// ============================================================
console.log('\nStructural Integrity');

// 31. All original execute-phase.md step markers still present
assert(
  execContent.includes('### Step 1:') &&
  execContent.includes('### Step 2:') &&
  execContent.includes('### Step 3:') &&
  execContent.includes('### Step 4:') &&
  execContent.includes('### Step 5:') &&
  execContent.includes('### Step 6:') &&
  execContent.includes('### Step 7:') &&
  execContent.includes('### Step 8:') &&
  execContent.includes('**5a.') &&
  execContent.includes('**5b.') &&
  execContent.includes('**5c.') &&
  execContent.includes('**5d.') &&
  execContent.includes('**5e.') &&
  execContent.includes('**5c.5.') &&
  execContent.includes('**5c.7.'),
  '31. All original step markers present (Steps 1-8, 5a-5e, 5c.5, 5c.7)'
);

// 32. Step 5d still contains wave completion checkpoint logic
const step5d = contentBetween('**5d.', '**5e.', execContent);
assert(
  step5d.includes('Wave completion checkpoint') || step5d.includes('checkpoint'),
  '32. Step 5d still contains wave completion checkpoint logic'
);

// 33. Design Notes section contains failure classification design note
const designNotes = contentFrom('**Design Notes', execContent);
assert(
  designNotes.includes('Failure classification') && designNotes.includes('pattern matching'),
  '33. Design Notes section contains failure classification design note'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
