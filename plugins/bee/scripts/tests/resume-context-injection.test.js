#!/usr/bin/env node
// Test: resume.md command injects CONTEXT.md content into context restoration briefing.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'resume.md'
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

// Read the file
let content;
try {
  content = fs.readFileSync(CMD_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: resume.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: Saved State block includes CONTEXT.md read instruction
// ============================================================
console.log('Test 1: Saved State block includes CONTEXT.md');

const savedStateHeadingIdx = content.indexOf('## Saved State');
const instructionsHeadingIdx = content.indexOf('## Instructions');
const savedStateBlock = content.substring(savedStateHeadingIdx, instructionsHeadingIdx);

assert(
  savedStateBlock.includes('.bee/CONTEXT.md'),
  'Saved State block references .bee/CONTEXT.md'
);
assert(
  savedStateBlock.includes('NO_CONTEXT'),
  'Saved State block includes NO_CONTEXT sentinel'
);
// Must use em dash pattern consistent with other entries
assert(
  savedStateBlock.includes('.bee/CONTEXT.md') &&
  savedStateBlock.includes('\u2014') &&
  savedStateBlock.includes('NO_CONTEXT'),
  'CONTEXT.md entry uses em dash sentinel pattern like other entries'
);

// ============================================================
// Test 2: New section 6 - Codebase Context exists
// ============================================================
console.log('\nTest 2: Section 6 - Codebase Context exists');

assert(
  content.includes('**6. Codebase Context'),
  'Section 6 heading "Codebase Context" exists'
);

// Verify it comes AFTER section 5
const section5Idx = content.indexOf('**5. What To Do Next');
const section6Idx = content.indexOf('**6. Codebase Context');
assert(
  section5Idx > -1 && section6Idx > -1 && section6Idx > section5Idx,
  'Section 6 appears after section 5'
);

// ============================================================
// Test 3: When CONTEXT.md available - presents with proper label
// ============================================================
console.log('\nTest 3: CONTEXT.md available - proper label');

assert(
  content.includes('Codebase Context (from .bee/CONTEXT.md)'),
  'When available, presents as "Codebase Context (from .bee/CONTEXT.md)"'
);

// ============================================================
// Test 4: When NO_CONTEXT - section 6 shows fallback message
// ============================================================
console.log('\nTest 4: NO_CONTEXT fallback message');

assert(
  content.includes('No codebase context extracted yet'),
  'NO_CONTEXT fallback includes "No codebase context extracted yet"'
);
assert(
  content.includes('/bee:refresh-context'),
  'NO_CONTEXT fallback mentions /bee:refresh-context command'
);

// ============================================================
// Test 5: Existing sections 1-5 still present and unchanged
// ============================================================
console.log('\nTest 5: Existing sections preserved');

assert(
  content.includes('**1. Where You Left Off**'),
  'Section 1 "Where You Left Off" still present'
);
assert(
  content.includes('**2. Current Position**'),
  'Section 2 "Current Position" still present'
);
assert(
  content.includes('**3. Session Context'),
  'Section 3 "Session Context" still present'
);
assert(
  content.includes('**4. Phase Details'),
  'Section 4 "Phase Details" still present'
);
assert(
  content.includes('**5. What To Do Next**'),
  'Section 5 "What To Do Next" still present'
);

// ============================================================
// Test 6: Frontmatter and core structure not broken
// ============================================================
console.log('\nTest 6: Core structure intact');

assert(
  content.startsWith('---'),
  'File still starts with YAML frontmatter'
);
assert(
  content.includes('description:'),
  'Frontmatter still has description field'
);
/* removed: superseded (Phase 2 triage) */
assert(
  content.includes('## Instructions'),
  'Instructions section still exists'
);
assert(
  content.includes('### Not Initialized'),
  'Not Initialized guard still exists'
);
assert(
  content.includes('### Context Restoration Briefing'),
  'Context Restoration Briefing section still exists'
);

// ============================================================
// Test 7: Section 6 conditional follows Section 3 pattern
// ============================================================
console.log('\nTest 7: Section 6 follows conditional pattern like Section 3');

// Section 3 uses "If NO_SESSION_CONTEXT" pattern for conditional
// Section 6 should use "If NO_CONTEXT" pattern similarly
assert(
  content.includes('NO_CONTEXT') &&
  content.indexOf('NO_CONTEXT') < content.indexOf('### Output Format'),
  'NO_CONTEXT sentinel is used before Output Format section'
);

// Section 6 content should be within the briefing, not in a separate section
const briefingStart = content.indexOf('### Context Restoration Briefing');
const outputFormatStart = content.indexOf('### Output Format');
const briefingContent = content.substring(briefingStart, outputFormatStart);
assert(
  briefingContent.includes('**6. Codebase Context'),
  'Section 6 is within the Context Restoration Briefing'
);

// ============================================================
// Test 8: Existing Saved State entries not modified
// ============================================================
console.log('\nTest 8: Existing Saved State entries preserved');

assert(
  savedStateBlock.includes('.bee/STATE.md'),
  'STATE.md entry still in Saved State block'
);
assert(
  savedStateBlock.includes('.bee/config.json'),
  'config.json entry still in Saved State block'
);
assert(
  savedStateBlock.includes('.bee/COMPACT-CONTEXT.md') ||
  savedStateBlock.includes('.bee/SESSION-CONTEXT.md'),
  'COMPACT-CONTEXT.md / SESSION-CONTEXT.md entry still in Saved State block'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
