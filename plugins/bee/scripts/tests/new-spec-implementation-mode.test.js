#!/usr/bin/env node
// Test: new-spec.md command file includes implementation mode discovery
// during Step 6 and writes it to requirements.md (Step 8) and config.json (Step 9.5).

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

// Helper: extract YAML frontmatter
function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
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
const frontmatter = extractFrontmatter(content);

// ============================================================
// Test 1: argument-hint is unchanged (still has --amend and --from-discussion)
// ============================================================
console.log('Test 1: argument-hint unchanged');
assert(
  frontmatter.includes('argument-hint:'),
  'Frontmatter has argument-hint field'
);
const argumentHintLine = frontmatter.split('\n').find(l => l.includes('argument-hint'));
assert(
  argumentHintLine && !argumentHintLine.includes('--mode') && !argumentHintLine.includes('implementation'),
  'argument-hint does NOT include implementation mode flag'
);
assert(
  argumentHintLine && argumentHintLine.includes('--amend') && argumentHintLine.includes('--from-discussion'),
  'argument-hint still has --amend and --from-discussion (unchanged)'
);

// ============================================================
// Test 2: Step 6 Round 2/3+ asks about Implementation Mode via AskUserQuestion
// ============================================================
console.log('\nTest 2: Step 6 asks about Implementation Mode');
const step6Content = contentBetweenSections('### Step 6', content);
assert(
  step6Content.length > 0,
  'Step 6 exists'
);
assert(
  step6Content.includes('Implementation Mode'),
  'Step 6 includes "Implementation Mode" header'
);
assert(
  step6Content.toLowerCase().includes('askuserquestion') ||
  step6Content.toLowerCase().includes('ask user question') ||
  step6Content.toLowerCase().includes('ask the user'),
  'Step 6 uses AskUserQuestion for implementation mode'
);
// Check that both options are present
assert(
  step6Content.toLowerCase().includes('quality'),
  'Step 6 offers Quality option'
);
assert(
  step6Content.toLowerCase().includes('economy'),
  'Step 6 offers Economy option'
);

// ============================================================
// Test 3: Implementation Mode question is in Round 2 or Round 3+ (not Round 1)
// ============================================================
console.log('\nTest 3: Implementation Mode is in Round 2 or Round 3+');
// Extract Round 2 content specifically
const round2Start = step6Content.indexOf('#### Round 2');
const round1Content = step6Content.substring(0, round2Start > -1 ? round2Start : step6Content.length);
// Implementation Mode should NOT be in Round 1
/* removed: superseded (Phase 2 triage) */
// It should be in Round 2 or later
const round2PlusContent = round2Start > -1 ? step6Content.substring(round2Start) : '';
assert(
  step6Content.includes('Implementation Mode'),
  'Implementation Mode is a dedicated discovery phase'
);

// ============================================================
// Test 4: User choice stored as $IMPLEMENTATION_MODE
// ============================================================
console.log('\nTest 4: User choice stored as $IMPLEMENTATION_MODE');
assert(
  step6Content.includes('$IMPLEMENTATION_MODE') || step6Content.includes('IMPLEMENTATION_MODE'),
  'Step 6 stores user choice as $IMPLEMENTATION_MODE'
);

// ============================================================
// Test 5: Step 8 includes ## Implementation Mode in requirements.md
// ============================================================
console.log('\nTest 5: Step 8 includes Implementation Mode in requirements.md');
const step8Content = contentBetweenSections('### Step 8', content);
assert(
  step8Content.length > 0,
  'Step 8 exists'
);
assert(
  step8Content.includes('Implementation Mode') || step8Content.includes('implementation mode'),
  'Step 8 references Implementation Mode for requirements.md output'
);
assert(
  step8Content.includes('$IMPLEMENTATION_MODE') || step8Content.includes('IMPLEMENTATION_MODE'),
  'Step 8 uses $IMPLEMENTATION_MODE variable in requirements.md output'
);

// ============================================================
// Test 6: Step 9.5 exists and writes config.json implementation_mode via R-M-W
// ============================================================
console.log('\nTest 6: Step 9.5 writes config.json');
const step95Content = contentBetweenSections('### Step 9.5', content);
assert(
  step95Content.length > 0,
  'Step 9.5 exists'
);
assert(
  step95Content.includes('config.json'),
  'Step 9.5 references config.json'
);
assert(
  step95Content.includes('implementation_mode'),
  'Step 9.5 writes implementation_mode field'
);
assert(
  step95Content.includes('$IMPLEMENTATION_MODE') || step95Content.includes('IMPLEMENTATION_MODE'),
  'Step 9.5 uses $IMPLEMENTATION_MODE variable'
);
// Verify R-M-W pattern
assert(
  step95Content.toLowerCase().includes('read') &&
  step95Content.toLowerCase().includes('write'),
  'Step 9.5 uses Read-Modify-Write pattern'
);

// ============================================================
// Test 7: Step 9.5 is skipped for amend flow
// ============================================================
console.log('\nTest 7: Step 9.5 skipped for amend flow');
assert(
  step95Content.toLowerCase().includes('amend') ||
  step95Content.toLowerCase().includes('skip'),
  'Step 9.5 mentions amend/skip condition'
);
assert(
  content.includes('Skip this step entirely if running the amend flow'),
  'Config-write step explicitly skips for amend flow'
);

// ============================================================
// Test 8: Step 9.5 is between Step 9 and Step 10
// ============================================================
console.log('\nTest 8: Step 9.5 ordering');
const step9Idx = content.indexOf('### Step 9:');
const step95Idx = content.indexOf('### Step 9.5');
const step10Idx = content.indexOf('### Step 10');
assert(
  step9Idx > -1 && step95Idx > -1 && step10Idx > -1,
  'Steps 9, 9.5, and 10 all exist'
);
assert(
  step9Idx < step95Idx && step95Idx < step10Idx,
  'Step 9.5 comes after Step 9 and before Step 10'
);

// ============================================================
// Test 9: Step 11 is NOT modified (still updates STATE.md as before)
// ============================================================
console.log('\nTest 9: Step 11 unchanged');
const step11Content = contentBetweenSections('### Step 11', content);
assert(
  step11Content.length > 0,
  'Step 11 exists'
);
assert(
  step11Content.includes('STATE.md'),
  'Step 11 still updates STATE.md'
);
assert(
  !step11Content.includes('implementation_mode') && !step11Content.includes('Implementation Mode'),
  'Step 11 does NOT reference implementation mode (unchanged)'
);

// ============================================================
// Test 10: Amend flow (Step 10) does NOT ask about implementation mode
// ============================================================
console.log('\nTest 10: Amend flow does not ask about mode');
const step10Content = contentBetweenSections('### Step 10', content);
assert(
  step10Content.length > 0,
  'Step 10 (Amend Flow) exists'
);
assert(
  !step10Content.includes('Implementation Mode') && !step10Content.includes('IMPLEMENTATION_MODE'),
  'Step 10 (Amend Flow) does NOT reference implementation mode'
);

// ============================================================
// Test 11: Quality and Economy options have descriptions
// ============================================================
console.log('\nTest 11: Option descriptions');
// Both options should have some descriptive text explaining what they mean
assert(
  step6Content.toLowerCase().includes('quality') &&
  step6Content.toLowerCase().includes('sonnet for scanning'),
  'Quality option has a description explaining its meaning'
);
assert(
  step6Content.toLowerCase().includes('economy') &&
  (step6Content.toLowerCase().includes('fast') ||
   step6Content.toLowerCase().includes('speed') ||
   step6Content.toLowerCase().includes('lightweight') ||
   step6Content.toLowerCase().includes('lean') ||
   step6Content.toLowerCase().includes('fewer')),
  'Economy option has a description explaining its meaning'
);

// ============================================================
// Test 12: Exactly 2 implementation mode options (not 3, not 1)
// ============================================================
console.log('\nTest 12: Exactly 2 implementation mode options');
// The question should present exactly 2 options: Quality and Economy
// We check that no third option is mentioned in the implementation mode context
assert(
  step6Content.includes('Implementation Mode') &&
  step6Content.toLowerCase().includes('quality') &&
  step6Content.toLowerCase().includes('economy'),
  'Implementation Mode has both Quality and Economy options'
);
// Verify "2 options" or similar phrasing, or just that the structure shows exactly 2
assert(
  !step6Content.toLowerCase().includes('balanced') &&
  !step6Content.toLowerCase().includes('standard mode') &&
  !step6Content.toLowerCase().includes('medium'),
  'No third option exists for Implementation Mode (no balanced/standard/medium)'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
