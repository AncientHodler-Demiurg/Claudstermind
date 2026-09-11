#!/usr/bin/env node
// Test: compact.md command extended to inject CONTEXT.md content into saved context.
// Verifies Step 2 reads .bee/CONTEXT.md if it exists, Step 3 includes Codebase
// Context section in COMPACT-CONTEXT.md, Step 4 includes Codebase Context inline
// in conversation output, and missing CONTEXT.md is handled gracefully.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'compact.md'
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

// Helper: extract content between two step headings (### Step N to ### Step N+1)
// Uses indexOf for exact boundary matching, avoiding false matches on headings inside code fences
function contentBetweenSteps(stepHeading, nextStepHeading, fullContent) {
  const startIdx = fullContent.indexOf(stepHeading);
  if (startIdx === -1) return '';
  const afterHeading = fullContent.substring(startIdx + stepHeading.length);
  if (!nextStepHeading) return afterHeading;
  const endIdx = afterHeading.indexOf(nextStepHeading);
  if (endIdx === -1) return afterHeading;
  return afterHeading.substring(0, endIdx);
}

// Read the file
let content;
try {
  content = fs.readFileSync(CMD_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: compact.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: Step 2 reads .bee/CONTEXT.md
// ============================================================
console.log('Test 1: Step 2 reads CONTEXT.md');
const step2Content = contentBetweenSteps('### Step 2', '### Step 3', content);
assert(
  step2Content.includes('CONTEXT.md'),
  'Step 2 mentions CONTEXT.md'
);
assert(
  step2Content.toLowerCase().includes('read') && step2Content.includes('CONTEXT.md'),
  'Step 2 reads CONTEXT.md'
);
// Must be gated on existence (not required)
assert(
  step2Content.toLowerCase().includes('if') && step2Content.toLowerCase().includes('exist') ||
  step2Content.toLowerCase().includes('optional') ||
  step2Content.toLowerCase().includes('if found') ||
  step2Content.toLowerCase().includes('if it exists'),
  'Step 2 gates CONTEXT.md read on existence (optional)'
);

// ============================================================
// Test 2: Step 3 includes ## Codebase Context in COMPACT-CONTEXT.md format
// ============================================================
console.log('\nTest 2: Step 3 has Codebase Context section');
const step3Content = contentBetweenSteps('### Step 3', '### Step 4', content);
assert(
  step3Content.includes('## Codebase Context'),
  'Step 3 format block includes ## Codebase Context heading'
);
// The section must appear after ## Decisions
assert(
  step3Content.indexOf('## Decisions') < step3Content.indexOf('## Codebase Context'),
  'Codebase Context section appears after Decisions section'
);
// Must be conditional on CONTEXT.md existing
assert(
  step3Content.toLowerCase().includes('context.md') &&
  (step3Content.toLowerCase().includes('if') || step3Content.toLowerCase().includes('when') || step3Content.toLowerCase().includes('only')),
  'Codebase Context section is conditional on CONTEXT.md existing'
);

// ============================================================
// Test 3: Step 4 includes Codebase Context in conversation output
// ============================================================
console.log('\nTest 3: Step 4 includes Codebase Context in output');
const step4Content = contentBetweenSteps('### Step 4', '### Step 5', content);
assert(
  step4Content.includes('BEE CONTEXT'),
  'Step 4 still has BEE CONTEXT block'
);
assert(
  step4Content.toLowerCase().includes('codebase context') ||
  step4Content.includes('CONTEXT.md'),
  'Step 4 output includes Codebase Context or CONTEXT.md reference'
);

// ============================================================
// Test 4: Graceful handling when CONTEXT.md does not exist
// ============================================================
console.log('\nTest 4: Graceful handling when CONTEXT.md missing');
// The command must not error when CONTEXT.md is absent
assert(
  content.toLowerCase().includes('context.md') &&
  (content.toLowerCase().includes('does not exist') ||
   content.toLowerCase().includes('not found') ||
   content.toLowerCase().includes('if it exists') ||
   content.toLowerCase().includes('if found') ||
   content.toLowerCase().includes('if available')),
  'Command handles missing CONTEXT.md gracefully (no error)'
);
// When CONTEXT.md is missing, the Codebase Context section should be omitted
assert(
  content.toLowerCase().includes('omit') ||
  content.toLowerCase().includes('skip') ||
  content.toLowerCase().includes('no codebase context') ||
  content.toLowerCase().includes('do not include') ||
  content.toLowerCase().includes('not present'),
  'Missing CONTEXT.md results in omitted Codebase Context section'
);

// ============================================================
// Test 5: Existing behavior preserved (spot checks)
// ============================================================
console.log('\nTest 5: Existing behavior preserved');
assert(
  content.includes('### Step 1') && content.includes('### Step 2') &&
  content.includes('### Step 3') && content.includes('### Step 4') &&
  content.includes('### Step 5'),
  'All original steps (1-5) still exist'
);
assert(
  content.includes('STATE.md') && content.includes('config.json'),
  'Step 2 still reads STATE.md and config.json'
);
assert(
  content.includes('COMPACT-CONTEXT.md'),
  'Step 3 still writes COMPACT-CONTEXT.md'
);
assert(
  content.includes('/compact'),
  'Step 5 still prompts user to run /compact'
);
assert(
  content.includes('## Snapshot') && content.includes('## Project') &&
  content.includes('## Phase Progress') && content.includes('## Last Action'),
  'Original sections in COMPACT-CONTEXT.md format preserved'
);

// ============================================================
// Test 6: Codebase Context section includes CONTEXT.md contents
// ============================================================
console.log('\nTest 6: Codebase Context includes CONTEXT.md contents');
assert(
  step3Content.toLowerCase().includes('content') && step3Content.includes('CONTEXT.md') ||
  step3Content.toLowerCase().includes('insert') && step3Content.includes('CONTEXT.md') ||
  step3Content.toLowerCase().includes('include') && step3Content.includes('CONTEXT.md'),
  'Step 3 specifies inserting CONTEXT.md content into Codebase Context section'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
