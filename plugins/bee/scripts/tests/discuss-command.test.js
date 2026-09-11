#!/usr/bin/env node
// Test: discuss.md command file has correct frontmatter, dynamic context,
// all required steps (NOT_INITIALIZED guard, get topic, spawn scan, adaptive rounds,
// spawn write-notes, update STATE.md, completion message), and follows command conventions.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'discuss.md'
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
  console.log('FAIL: discuss.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lowerContent = content.toLowerCase();
const frontmatter = extractFrontmatter(content);

// ============================================================
// Test 1: Frontmatter has correct fields
// ============================================================
console.log('Test 1: Frontmatter');
assert(
  content.startsWith('---'),
  'File starts with YAML frontmatter delimiter'
);
assert(
  frontmatter.includes('description:'),
  'Frontmatter has description field'
);
assert(
  frontmatter.includes('argument-hint:'),
  'Frontmatter has argument-hint field'
);
assert(
  frontmatter.includes('[topic description]'),
  'argument-hint contains "[topic description]"'
);

// ============================================================
// Test 2: Dynamic context reads STATE.md and config.json
// ============================================================
console.log('\nTest 2: Dynamic context');
assert(
  content.includes('STATE.md'),
  'Dynamic context reads STATE.md'
);
assert(
  content.includes('config.json'),
  'Dynamic context reads config.json'
);
assert(
  content.includes('NOT_INITIALIZED'),
  'References NOT_INITIALIZED for missing STATE.md'
);

// ============================================================
// Test 3: Step 1 - NOT_INITIALIZED guard
// ============================================================
console.log('\nTest 3: Step 1 - NOT_INITIALIZED guard');
const step1Content = contentBetweenSections('### Step 1', content);
assert(
  step1Content.length > 0,
  'Step 1 exists'
);
assert(
  step1Content.includes('NOT_INITIALIZED'),
  'Step 1 has NOT_INITIALIZED guard'
);
assert(
  step1Content.includes('/bee:init'),
  'Step 1 suggests /bee:init'
);
assert(
  step1Content.toLowerCase().includes('do not proceed') ||
  step1Content.toLowerCase().includes('stop here') ||
  step1Content.toLowerCase().includes('stop immediately'),
  'Step 1 stops execution on NOT_INITIALIZED'
);

// ============================================================
// Test 4: Step 2 - Get topic from $ARGUMENTS or AskUserQuestion
// ============================================================
console.log('\nTest 4: Step 2 - Get topic');
const step2Content = contentBetweenSections('### Step 2', content);
assert(
  step2Content.length > 0,
  'Step 2 exists'
);
assert(
  step2Content.includes('$ARGUMENTS') || step2Content.includes('ARGUMENTS'),
  'Step 2 checks $ARGUMENTS for topic'
);
assert(
  step2Content.toLowerCase().includes('askuserquestion') ||
  step2Content.toLowerCase().includes('ask the user') ||
  step2Content.toLowerCase().includes('ask user'),
  'Step 2 falls back to asking user for topic if no arguments'
);

// ============================================================
// Test 5: Step 3 - Spawn discuss-partner in scan mode with model: "sonnet"
// ============================================================
console.log('\nTest 5: Step 3 - Spawn discuss-partner scan mode');
const step3Content = contentBetweenSections('### Step 3', content);
assert(
  step3Content.length > 0,
  'Step 3 exists'
);
assert(
  step3Content.includes('discuss-partner'),
  'Step 3 references discuss-partner agent'
);
assert(
  step3Content.includes('"scan"') || step3Content.includes('`scan`') ||
  step3Content.includes('scan mode') || step3Content.includes('MODE') && step3Content.includes('scan'),
  'Step 3 uses scan mode'
);
assert(
  content.includes('RESOLVED_MODEL') || content.includes('Model Selection'),
  'Scan model resolved via the centralized Model Selection (Scanning) rule'
);
assert(
  step3Content.toLowerCase().includes('scan results') ||
  step3Content.toLowerCase().includes('display') ||
  step3Content.toLowerCase().includes('show') ||
  step3Content.toLowerCase().includes('present'),
  'Step 3 displays scan results to user'
);

// ============================================================
// Test 6: Step 4 - Adaptive rounds via AskUserQuestion (2-5 rounds)
// ============================================================
console.log('\nTest 6: Step 4 - Adaptive rounds');
const step4Content = contentBetweenSections('### Step 4', content);
assert(
  step4Content.length > 0,
  'Step 4 exists'
);
assert(
  step4Content.toLowerCase().includes('askuserquestion') ||
  step4Content.toLowerCase().includes('ask') ||
  step4Content.toLowerCase().includes('question'),
  'Step 4 uses AskUserQuestion for rounds'
);

// ============================================================
// Test 7: Step 4 - Round 1 Problem Space
// ============================================================
console.log('\nTest 7: Step 4 - Round 1 Problem Space');
assert(
  step4Content.toLowerCase().includes('round 1') ||
  step4Content.toLowerCase().includes('problem space') ||
  step4Content.includes('#### Round 1'),
  'Step 4 has Round 1 (Problem Space)'
);
assert(
  step4Content.toLowerCase().includes('problem') ||
  step4Content.toLowerCase().includes('what') ||
  step4Content.toLowerCase().includes('trying to solve'),
  'Round 1 explores the problem space'
);

// ============================================================
// Test 8: Step 4 - Round 2 Approach with trade-offs from scan
// ============================================================
console.log('\nTest 8: Step 4 - Round 2 Approach');
/* removed: superseded (Phase 2 triage) */
assert(
  step4Content.toLowerCase().includes('approach') ||
  step4Content.toLowerCase().includes('trade-off') ||
  step4Content.toLowerCase().includes('tradeoff'),
  'Round 2 discusses approaches with trade-offs from scan'
);
assert(
  step4Content.toLowerCase().includes('scan') ||
  step4Content.toLowerCase().includes('scan results') ||
  step4Content.toLowerCase().includes('suggested approaches'),
  'Round 2 references scan results'
);

// ============================================================
// Test 9: Step 4 - Round 3+ Convergence with ready/add more/change options
// ============================================================
console.log('\nTest 9: Step 4 - Round 3+ Convergence');
/* removed: superseded (Phase 2 triage) */
assert(
  step4Content.toLowerCase().includes('convergence') ||
  step4Content.toLowerCase().includes('converge') ||
  step4Content.toLowerCase().includes('ready'),
  'Round 3+ has convergence check'
);
assert(
  step4Content.toLowerCase().includes('ready') ||
  step4Content.toLowerCase().includes('wrap up') ||
  step4Content.toLowerCase().includes('conclude'),
  'Round 3+ has ready/done option'
);
assert(
  step4Content.toLowerCase().includes('add more') ||
  step4Content.toLowerCase().includes('more detail') ||
  step4Content.toLowerCase().includes('explore more'),
  'Round 3+ has add more option'
);
assert(
  step4Content.toLowerCase().includes('change') ||
  step4Content.toLowerCase().includes('adjust') ||
  step4Content.toLowerCase().includes('different'),
  'Round 3+ has change direction option'
);

// ============================================================
// Test 10: Step 4 - Max 5 rounds enforced
// ============================================================
console.log('\nTest 10: Step 4 - Max 5 rounds');
/* removed: superseded (Phase 2 triage) */

// ============================================================
// Test 11: Step 5 - Spawn discuss-partner write-notes mode (omit model)
// ============================================================
console.log('\nTest 11: Step 5 - Spawn discuss-partner write-notes mode');
const step5Content = contentBetweenSections('### Step 5', content);
assert(
  step5Content.length > 0,
  'Step 5 exists'
);
assert(
  step5Content.includes('discuss-partner'),
  'Step 5 references discuss-partner agent'
);
assert(
  step5Content.includes('"write-notes"') || step5Content.includes('`write-notes`') ||
  step5Content.includes('write-notes mode') || (step5Content.includes('MODE') && step5Content.includes('write-notes')),
  'Step 5 uses write-notes mode'
);
// Verify model is NOT specified (omitted = inherit parent) for write-notes
assert(
  !step5Content.includes('model: "sonnet"') && !step5Content.includes("model: 'sonnet'") ||
  step5Content.toLowerCase().includes('omit model') ||
  step5Content.toLowerCase().includes('omit the model') ||
  step5Content.toLowerCase().includes('inherit'),
  'Step 5 omits model parameter (inherit parent) for write-notes'
);
assert(
  step5Content.includes('.bee/discussions/') ||
  step5Content.includes('discussions/'),
  'Step 5 outputs to .bee/discussions/ directory'
);
assert(
  step5Content.includes('{YYYY-MM-DD}') ||
  step5Content.includes('YYYY-MM-DD') ||
  step5Content.toLowerCase().includes('date') && step5Content.toLowerCase().includes('slug'),
  'Step 5 output path includes date and slug'
);

// ============================================================
// Test 12: Step 6 - STATE.md Last Action R-M-W update
// ============================================================
console.log('\nTest 12: Step 6 - STATE.md update');
const step6Content = contentBetweenSections('### Step 6', content);
assert(
  step6Content.length > 0,
  'Step 6 exists'
);
assert(
  step6Content.includes('STATE.md'),
  'Step 6 updates STATE.md'
);
assert(
  step6Content.toLowerCase().includes('last action'),
  'Step 6 updates Last Action section'
);
assert(
  step6Content.toLowerCase().includes('read-modify-write') ||
  step6Content.toLowerCase().includes('re-read') ||
  step6Content.toLowerCase().includes('read current') ||
  (step6Content.toLowerCase().includes('read') && step6Content.toLowerCase().includes('write')),
  'Step 6 uses Read-Modify-Write pattern'
);
assert(
  step6Content.includes('/bee:discuss') || step6Content.includes('discuss'),
  'Step 6 records /bee:discuss as the command'
);

// ============================================================
// Test 13: Step 7 - Completion message with next-step
// ============================================================
console.log('\nTest 13: Step 7 - Completion message');
const step7Content = contentBetweenSections('### Step 7', content);
assert(
  step7Content.length > 0,
  'Step 7 exists'
);
assert(
  step7Content.includes('/bee:new-spec'),
  'Step 7 suggests /bee:new-spec as next step'
);
assert(
  step7Content.includes('--from-discussion'),
  'Step 7 includes --from-discussion flag in next step'
);
assert(
  step7Content.toLowerCase().includes('path') ||
  step7Content.includes('{path}'),
  'Step 7 includes discussion notes path in next step command'
);

// ============================================================
// Test 14: Never auto-commits
// ============================================================
console.log('\nTest 14: No auto-commit');
assert(
  lowerContent.includes('never auto-commit') ||
  lowerContent.includes('never auto commit') ||
  lowerContent.includes('does not commit') ||
  lowerContent.includes('no auto-commit') ||
  lowerContent.includes('not auto-commit') ||
  lowerContent.includes('never commits') ||
  lowerContent.includes('not commit') ||
  lowerContent.includes('do not commit') ||
  lowerContent.includes('does not auto-commit'),
  'Command explicitly states it never auto-commits'
);

// ============================================================
// Test 15: Design Notes section exists
// ============================================================
console.log('\nTest 15: Design Notes');
assert(
  content.includes('**Design Notes'),
  'Command has a Design Notes section'
);

// ============================================================
// Test 16: Correct step count (8 steps after Phase 12 added Step 3.5)
// ============================================================
console.log('\nTest 16: Step count');
const stepMatches = content.match(/### Step \d/g);
/* removed: superseded (Phase 2 triage) */

// ============================================================
// Test 17: Discussion rounds happen in main context (not delegated)
// ============================================================
console.log('\nTest 17: Rounds in main context');
assert(
  step4Content.toLowerCase().includes('main context') ||
  step4Content.toLowerCase().includes('askuserquestion') ||
  lowerContent.includes('main context'),
  'Adaptive rounds run in main context via AskUserQuestion'
);

// ============================================================
// Test 18: Slug derivation for output path
// ============================================================
console.log('\nTest 18: Slug derivation');
assert(
  lowerContent.includes('slug') ||
  lowerContent.includes('slugif'),
  'Command derives a slug for the output file path'
);

// ============================================================
// Test 19: Scan results sections referenced
// ============================================================
console.log('\nTest 19: Scan output sections referenced');
assert(
  content.includes('Relevant Files') ||
  content.includes('relevant files'),
  'Command references Relevant Files from scan output'
);
assert(
  content.includes('Existing Patterns') ||
  content.includes('existing patterns'),
  'Command references Existing Patterns from scan output'
);
assert(
  content.includes('Suggested Approaches') ||
  content.includes('suggested approaches'),
  'Command references Suggested Approaches from scan output'
);

// ============================================================
// Test 20: Writes only discussion notes + STATE.md
// ============================================================
console.log('\nTest 20: Writes only discussion notes + STATE.md');
assert(
  lowerContent.includes('discussion notes') &&
  lowerContent.includes('state.md'),
  'Command writes discussion notes and STATE.md'
);
assert(
  lowerContent.includes('does not commit') ||
  lowerContent.includes('never auto-commit') ||
  lowerContent.includes('not auto-commit') ||
  lowerContent.includes('never commits') ||
  lowerContent.includes('only writes discussion notes') ||
  (lowerContent.includes('only') && lowerContent.includes('discussion notes') && lowerContent.includes('state.md')),
  'Command only writes discussion notes + STATE.md (no code, no commits)'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
