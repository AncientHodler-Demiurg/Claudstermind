#!/usr/bin/env node
// Test: plan-review.md Step 1 guard 6 non-blocking, Step 4 Approve/Re-review/Modify options,
// CLEAN auto-approve, STATE.md iteration tracking, archiving

const fs = require('fs');
const path = require('path');

const PLAN_REVIEW_PATH = path.join(__dirname, '..', '..', 'commands', 'plan-review.md');

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

// Helper: extract content from a heading pattern to the next heading of same or higher level
function extractSection(heading, fullContent) {
  const startIdx = fullContent.indexOf(heading);
  if (startIdx === -1) return '';
  const afterHeading = fullContent.substring(startIdx + heading.length);
  const headingLevel = heading.match(/^#+/)?.[0].length || 2;
  const nextHeadingPattern = new RegExp(`\\n#{1,${headingLevel}} `);
  const nextH = afterHeading.search(nextHeadingPattern);
  if (nextH === -1) return afterHeading;
  return afterHeading.substring(0, nextH);
}

// Read the file
let content;
try {
  content = fs.readFileSync(PLAN_REVIEW_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: plan-review.md does not exist');
  process.exit(1);
}

console.log('=== plan-review.md: Approve/Re-review/Modify Options ===\n');

// ----------------------------------------------------------
// Test 1: Guard 6 no longer blocks -- informs and continues
// ----------------------------------------------------------
console.log('Test 1: Guard 6 informs about existing review, continues without blocking');
const step1Section = extractSection('### Step 1:', content);
const guard6Idx = step1Section.indexOf('6.');
const guard6Text = guard6Idx !== -1 ? step1Section.substring(guard6Idx, guard6Idx + 600) : '';
// Must NOT contain "Wait for explicit user confirmation" or "stop"/"Do NOT proceed" tied to the guard
assert(
  !guard6Text.includes('Wait for explicit user confirmation') &&
    !guard6Text.includes('If the user declines, stop'),
  'Guard 6 does not block with confirmation prompt'
);
assert(
  guard6Text.toLowerCase().includes('inform') ||
    guard6Text.toLowerCase().includes('note') ||
    guard6Text.toLowerCase().includes('continues') ||
    guard6Text.toLowerCase().includes('continue'),
  'Guard 6 informs about existing review and continues'
);

// ----------------------------------------------------------
// Test 2: Step 4 presents 3 choices (a) Approve, (b) Re-review, (c) Modify
// ----------------------------------------------------------
console.log('\nTest 2: Step 4 has three choices: Approve, Re-review, Modify');
const step4Section = extractSection('### Step 4:', content);
/* removed: superseded (Phase 2 triage) */
assert(
  step4Section.toLowerCase().includes('approve'),
  'Step 4 has Approve option'
);
assert(
  step4Section.toLowerCase().includes('re-review') || step4Section.toLowerCase().includes('re review'),
  'Step 4 has Re-review option'
);
assert(
  step4Section.toLowerCase().includes('modify'),
  'Step 4 has Modify option'
);

// ----------------------------------------------------------
// Test 3: CLEAN path auto-approves without presenting 3-option menu
// ----------------------------------------------------------
console.log('\nTest 3: CLEAN path auto-approves and writes STATE.md');
// The CLEAN path should be in Step 4 and mention auto-approve / writing STATE.md
assert(
  step4Section.toLowerCase().includes('clean') &&
    (step4Section.toLowerCase().includes('auto-approve') || step4Section.toLowerCase().includes('auto approve') || step4Section.includes('automatically')),
  'CLEAN path triggers auto-approve'
);
// CLEAN path must write "Yes (N+1)" to STATE.md
assert(
  step4Section.includes('Yes (') || step4Section.includes('"Yes ('),
  'CLEAN path writes "Yes (N+1)" to STATE.md'
);
// CLEAN path should NOT present the 3-option menu
assert(
  step4Section.includes('Stop') || step4Section.includes('stop') || step4Section.toLowerCase().includes('do not present'),
  'CLEAN path stops without presenting options menu'
);

// ----------------------------------------------------------
// Test 4: Option (a) Approve parses Plan Review value from STATE.md and increments N
// ----------------------------------------------------------
console.log('\nTest 4: Option (a) Approve parses and increments Plan Review from STATE.md');
assert(
  step4Section.includes('Plan Review') && step4Section.includes('STATE.md'),
  'Approve option references Plan Review value in STATE.md'
);
// Must parse N from existing value
assert(
  step4Section.includes('parse') || step4Section.includes('Parse') || step4Section.includes('extract') || step4Section.includes('Extract'),
  'Approve option parses/extracts current value'
);
// Must increment
assert(
  step4Section.includes('increment') || step4Section.includes('N+1') || step4Section.includes('{N+1}'),
  'Approve option increments N'
);
// Must write the new value
assert(
  step4Section.toLowerCase().includes('write') && step4Section.includes('Yes ('),
  'Approve option writes "Yes ({N+1})" to STATE.md'
);

// ----------------------------------------------------------
// Test 5: Option (b) Re-review archives and re-runs pipeline
// ----------------------------------------------------------
console.log('\nTest 5: Option (b) Re-review archives and re-runs pipeline');
assert(
  step4Section.includes('PLAN-REVIEW-') || step4Section.includes('PLAN-REVIEW-*.md'),
  'Re-review option counts existing PLAN-REVIEW-*.md files for archive number'
);
assert(
  step4Section.toLowerCase().includes('rename') || step4Section.toLowerCase().includes('archive'),
  'Re-review option renames/archives current PLAN-REVIEW.md'
);
assert(
  step4Section.includes('3.1') || step4Section.includes('Steps 3.1'),
  'Re-review option re-runs from Step 3.1'
);
assert(
  step4Section.includes('3.6') || step4Section.includes('Steps 3.1-3.6'),
  'Re-review option re-runs through Step 3.6'
);
assert(
  step4Section.toLowerCase().includes('re-present') || step4Section.toLowerCase().includes('return to step 4') || step4Section.toLowerCase().includes('loop back'),
  'Re-review option re-presents Step 4 after pipeline'
);

// ----------------------------------------------------------
// Test 6: Option (c) Modify tells user to edit TASKS.md and re-run
// ----------------------------------------------------------
console.log('\nTest 6: Option (c) Modify tells user to edit TASKS.md and re-run');
assert(
  step4Section.includes('TASKS.md'),
  'Modify option references TASKS.md'
);
assert(
  step4Section.toLowerCase().includes('edit') || step4Section.toLowerCase().includes('revise'),
  'Modify option tells user to edit'
);
assert(
  step4Section.toLowerCase().includes('re-run') || step4Section.toLowerCase().includes('rerun') || step4Section.toLowerCase().includes('re run'),
  'Modify option tells user to re-run'
);
assert(
  step4Section.toLowerCase().includes('stop'),
  'Modify option stops'
);

// ----------------------------------------------------------
// Test 7: STATE.md Read-Modify-Write pattern for Approve
// ----------------------------------------------------------
console.log('\nTest 7: STATE.md Read-Modify-Write on Approve');
// The text should mention reading STATE.md before writing
assert(
  step4Section.toLowerCase().includes('read') && step4Section.toLowerCase().includes('write') && step4Section.includes('STATE.md'),
  'Approve flow describes Read-Modify-Write for STATE.md'
);

// ----------------------------------------------------------
// Test 8: Design note updated -- command now writes STATE.md on Approve
// ----------------------------------------------------------
console.log('\nTest 8: Design note updated about STATE.md writing');
const designNotes = content.substring(content.lastIndexOf('**Design Notes'));
assert(
  designNotes.includes('STATE.md'),
  'Design notes mention STATE.md'
);
assert(
  designNotes.toLowerCase().includes('approve') || designNotes.toLowerCase().includes('writes state'),
  'Design notes mention writing STATE.md on Approve'
);
// Old design note said "does NOT modify TASKS.md or STATE.md" -- that should be updated
assert(
  !designNotes.includes('does NOT modify TASKS.md or STATE.md'),
  'Old "does NOT modify STATE.md" note is removed or updated'
);

// ----------------------------------------------------------
// Test 9: Old Step 4 options (a/b/c) from original are replaced
// ----------------------------------------------------------
console.log('\nTest 9: Old Step 4 options from original are replaced');
// Old options were: (a) Approve plan as-is, (b) Revise plan, (c) Add missing requirements
assert(
  !content.includes('(c) Add missing requirements'),
  'Old option (c) "Add missing requirements" is gone'
);
assert(
  !content.includes('(b) Revise plan'),
  'Old option (b) "Revise plan" is gone'
);

// ----------------------------------------------------------
// Test 10: Parse rules: "Yes (1)" -> N=1, "Yes" -> N=0, empty -> N=0
// ----------------------------------------------------------
console.log('\nTest 10: Parse rules for Plan Review value documented');
assert(
  step4Section.includes('"Yes (1)"') || step4Section.includes('Yes (1)'),
  'Documents parsing "Yes (1)" example'
);
assert(
  step4Section.includes('N=0') || step4Section.includes('N = 0') || (step4Section.includes('"Yes"') && step4Section.includes('0')),
  'Documents "Yes" -> N=0 or empty -> N=0'
);

// ----------------------------------------------------------
// Test 11: Never file-count for N -- always parse+increment
// ----------------------------------------------------------
console.log('\nTest 11: Never use file-count for N -- always parse+increment');
assert(
  step4Section.toLowerCase().includes('never') && step4Section.toLowerCase().includes('file') ||
    step4Section.toLowerCase().includes('always parse') ||
    step4Section.toLowerCase().includes('parse') && step4Section.toLowerCase().includes('increment'),
  'Explicitly states parse+increment (not file-count) for N'
);

// ----------------------------------------------------------
// Test 12: Steps 1-3 structure preserved (not broken)
// ----------------------------------------------------------
console.log('\nTest 12: Steps 1-3 structure preserved');
assert(
  content.includes('### Step 1: Validation Guards'),
  'Step 1 heading preserved'
);
assert(
  content.includes('### Step 2: Load Phase Context'),
  'Step 2 heading preserved'
);
assert(
  content.includes('### Step 3: Spawn Four Specialized Agents'),
  'Step 3 heading preserved'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
