#!/usr/bin/env node
// Test: new-spec.md command file has correct --from-discussion flag support.
// Validates: argument-hint updated, Step 2 detects --from-discussion, Step 2.5 loads
// discussion notes, Step 5 includes discussion notes in researcher context, Step 6
// Round 1 presents discussion summary, all other steps unchanged.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'new-spec.md'
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

// Helper: extract content between a section heading and the next heading of same or higher level
function contentBetweenSections(sectionHeading, fullContent) {
  const startIdx = fullContent.indexOf(sectionHeading);
  if (startIdx === -1) return '';
  const afterHeading = fullContent.substring(startIdx + sectionHeading.length);
  const headingLevel = sectionHeading.match(/^#+/);
  if (!headingLevel) return afterHeading;
  const level = headingLevel[0].length;
  const regex = new RegExp(`\n#{1,${level}} [^#]`);
  const nextSection = afterHeading.search(regex);
  if (nextSection === -1) return afterHeading;
  return afterHeading.substring(0, nextSection);
}

// Read the file
let content;
try {
  content = fs.readFileSync(CMD_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: new-spec.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lowerContent = content.toLowerCase();

// ============================================================
// Test 1: argument-hint includes --from-discussion PATH
// ============================================================
console.log('Test 1: argument-hint updated');
assert(
  content.includes('--from-discussion') && content.includes('argument-hint'),
  'argument-hint frontmatter includes --from-discussion'
);
assert(
  content.includes('[--from-discussion PATH]') || content.includes('[--from-discussion path]'),
  'argument-hint shows PATH placeholder after --from-discussion'
);
assert(
  content.includes('[--amend]') && content.includes('[--from-discussion'),
  'argument-hint preserves --amend alongside --from-discussion'
);

// ============================================================
// Test 2: Step 2 detects --from-discussion flag and extracts path
// ============================================================
console.log('\nTest 2: Step 2 detects --from-discussion');
const step2Content = contentBetweenSections('### Step 2', content);
assert(
  step2Content.includes('--from-discussion'),
  'Step 2 mentions --from-discussion flag'
);
assert(
  step2Content.includes('$DISCUSSION_PATH') || step2Content.includes('DISCUSSION_PATH'),
  'Step 2 stores the path as $DISCUSSION_PATH'
);
assert(
  step2Content.includes('$USE_DISCUSSION') || step2Content.includes('USE_DISCUSSION'),
  'Step 2 sets $USE_DISCUSSION variable'
);
assert(
  step2Content.toLowerCase().includes('strip') || step2Content.toLowerCase().includes('remove'),
  'Step 2 strips --from-discussion and path from $ARGUMENTS before Step 3'
);

// ============================================================
// Test 3: Step 2.5 exists and loads discussion notes
// ============================================================
console.log('\nTest 3: Step 2.5 loads discussion notes');
const step25Content = contentBetweenSections('### Step 2.5', content);
assert(
  step25Content.length > 0,
  'Step 2.5 exists in the command'
);
assert(
  step25Content.includes('$DISCUSSION_PATH') || step25Content.includes('DISCUSSION_PATH'),
  'Step 2.5 reads from $DISCUSSION_PATH'
);
assert(
  step25Content.includes('$DISCUSSION_NOTES') || step25Content.includes('DISCUSSION_NOTES'),
  'Step 2.5 stores content as $DISCUSSION_NOTES'
);
assert(
  step25Content.toLowerCase().includes('not found') || step25Content.toLowerCase().includes('does not exist'),
  'Step 2.5 handles file-not-found case'
);
assert(
  step25Content.includes('Discussion notes file not found') ||
  step25Content.toLowerCase().includes('check the path'),
  'Step 2.5 shows clear error message when file not found'
);

// ============================================================
// Test 4: Step 5 researcher context includes discussion notes when available
// ============================================================
console.log('\nTest 4: Step 5 researcher includes discussion notes');
const step5Content = contentBetweenSections('### Step 5', content);
assert(
  step5Content.includes('$USE_DISCUSSION') || step5Content.includes('USE_DISCUSSION'),
  'Step 5 checks $USE_DISCUSSION flag'
);
assert(
  step5Content.includes('$DISCUSSION_NOTES') || step5Content.includes('DISCUSSION_NOTES'),
  'Step 5 references $DISCUSSION_NOTES in researcher context'
);

// ============================================================
// Test 5: Step 6 Round 1 presents discussion summary when USE_DISCUSSION
// ============================================================
console.log('\nTest 5: Step 6 Round 1 discussion pre-population');
const step6Content = contentBetweenSections('### Step 6', content);
assert(
  step6Content.includes('$USE_DISCUSSION') || step6Content.includes('USE_DISCUSSION'),
  'Step 6 checks $USE_DISCUSSION flag'
);
assert(
  step6Content.includes('Discussion Summary'),
  'Step 6 references ## Discussion Summary section from notes'
);
assert(
  step6Content.includes('Notes for Spec Creation'),
  'Step 6 references ## Notes for Spec Creation section from notes'
);

// ============================================================
// Test 6: Step 6 Round 1 offers three options for discussion-based start
// ============================================================
console.log('\nTest 6: Step 6 Round 1 three options');
assert(
  step6Content.toLowerCase().includes('start from these conclusions') ||
  step6Content.toLowerCase().includes('use these as our starting point') ||
  step6Content.toLowerCase().includes('starting point'),
  'Step 6 offers option to use discussion conclusions as starting point'
);
assert(
  step6Content.toLowerCase().includes('start fresh') ||
  step6Content.toLowerCase().includes('ignore discussion'),
  'Step 6 offers option to start fresh / ignore discussion notes'
);
assert(
  step6Content.toLowerCase().includes('review and adjust') ||
  step6Content.toLowerCase().includes('adjust first'),
  'Step 6 offers option to review and adjust'
);

// ============================================================
// Test 7: --amend flag handling is preserved
// ============================================================
console.log('\nTest 7: --amend flag preserved');
assert(
  step2Content.includes('--amend'),
  'Step 2 still checks for --amend flag'
);
const step10Content = contentBetweenSections('### Step 10', content);
assert(
  step10Content.includes('Amend') || step10Content.includes('amend'),
  'Step 10 (Amend Flow) is preserved'
);

// ============================================================
// Test 8: Other steps are unchanged
// ============================================================
console.log('\nTest 8: Other steps unchanged');
const step1Content = contentBetweenSections('### Step 1', content);
assert(
  step1Content.includes('NOT_INITIALIZED'),
  'Step 1 (Initialization Guard) is unchanged'
);
const step3Content = contentBetweenSections('### Step 3', content);
assert(
  step3Content.includes('Spec Name') || step3Content.includes('spec name') || step3Content.toLowerCase().includes('slugify'),
  'Step 3 (Get Spec Name) is unchanged'
);
// Step 3.5 (Archive Previous Spec Memory) was removed in multispec-foundation:
// new-spec no longer archives the previous spec (multiple specs may be active).
// Verify the old archive-memory invocation is gone and the multispec note is present.
assert(
  !content.includes('archive-memory.sh'),
  'Step 3.5 archive-memory.sh removed (multispec: no longer archives previous spec)'
);
assert(
  content.includes('Multiple specs may be active') || content.includes('Archiving happens only at'),
  'Step 3.5 replaced with multispec note (no archive on new-spec)'
);
const step4Content = contentBetweenSections('### Step 4', content);
assert(
  step4Content.toLowerCase().includes('spec folder') || step4Content.toLowerCase().includes('spec directory'),
  'Step 4 (Create Spec Folder Structure) is unchanged'
);

// ============================================================
// Test 9: Step 2 processes flags before --amend check (order matters)
// ============================================================
console.log('\nTest 9: Flag processing order');
// --from-discussion should be detected and stripped BEFORE the --amend check
// or both flags should be handled in the same step
assert(
  step2Content.indexOf('--from-discussion') > -1,
  'Step 2 handles --from-discussion alongside --amend'
);
// The step title should reflect handling both flags
assert(
  content.includes('### Step 2:') || content.includes('### Step 2 ') || content.includes('### Step 2\n'),
  'Step 2 heading exists'
);

// ============================================================
// Test 10: Step 2.5 is conditional on USE_DISCUSSION
// ============================================================
console.log('\nTest 10: Step 2.5 conditional execution');
assert(
  step25Content.includes('$USE_DISCUSSION') || step25Content.includes('USE_DISCUSSION'),
  'Step 2.5 is conditional on $USE_DISCUSSION being true'
);
assert(
  step25Content.toLowerCase().includes('read') || step25Content.toLowerCase().includes('read tool'),
  'Step 2.5 uses Read tool to load the discussion notes file'
);

// ============================================================
// Test 11: Step 6 pre-population does not break standard flow
// ============================================================
console.log('\nTest 11: Standard flow preserved in Step 6');
assert(
  step6Content.includes('#### Phase 1'),
  'Step 6 has Phase 1 (adaptive discovery)'
);
assert(
  step6Content.includes('#### Phase 2'),
  'Step 6 has Phase 2 (adaptive discovery)'
);
assert(
  step6Content.includes('Convergence'),
  'Step 6 has a Convergence phase'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
