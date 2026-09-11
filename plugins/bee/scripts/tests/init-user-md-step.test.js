#!/usr/bin/env node
// Test: init.md includes an optional step to create .bee/user.md

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(__dirname, '..', '..', 'commands', 'init.md');

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
  console.log('FAIL: init.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: Step 9.5 heading exists for user.md creation
// ============================================================
console.log('Test 1: Step 9.5 heading exists');
assert(
  content.includes('### Step 9.5'),
  'Step 9.5 heading exists in init.md'
);

// ============================================================
// Test 2: Step 9.5 appears between Step 9 and Step 10
// ============================================================
console.log('\nTest 2: Step 9.5 position');
const step9Idx = content.indexOf('### Step 9:');
const step95Idx = content.indexOf('### Step 9.5');
const step10Idx = content.indexOf('### Step 10:');
assert(
  step9Idx !== -1 && step95Idx !== -1 && step10Idx !== -1,
  'Steps 9, 9.5, and 10 all exist'
);
assert(
  step9Idx < step95Idx && step95Idx < step10Idx,
  'Step 9.5 appears between Step 9 and Step 10'
);

// ============================================================
// Test 3: Step 9.5 title references user.md or user preferences
// ============================================================
console.log('\nTest 3: Step 9.5 title');
const step95HeadingLine = content.substring(step95Idx, content.indexOf('\n', step95Idx));
assert(
  step95HeadingLine.toLowerCase().includes('user') &&
  (step95HeadingLine.toLowerCase().includes('preferences') || step95HeadingLine.toLowerCase().includes('user.md')),
  'Step 9.5 heading references user preferences or user.md'
);

// ============================================================
// Test 4: Step 9.5 asks the user (optional step)
// ============================================================
console.log('\nTest 4: Step 9.5 is optional (asks user)');
// Extract full Step 9.5 content (between ### Step 9.5 and ### Step 10)
// Using direct index slicing to avoid code-fence heading confusion
const step95Content = content.substring(step95Idx, step10Idx);
assert(
  step95Content.toLowerCase().includes('ask') || step95Content.toLowerCase().includes('should i'),
  'Step 9.5 asks the user before creating user.md'
);

// ============================================================
// Test 5: Step 9.5 template includes required sections
// ============================================================
console.log('\nTest 5: Step 9.5 template sections');
assert(
  step95Content.includes('Working Style'),
  'Template includes "Working Style" section'
);
assert(
  step95Content.includes('Communication Preferences'),
  'Template includes "Communication Preferences" section'
);
assert(
  step95Content.includes('Workflow Overrides'),
  'Template includes "Workflow Overrides" section'
);

// ============================================================
// Test 6: Step 9.5 preserves user.md during re-init
// ============================================================
console.log('\nTest 6: Re-init preserves user.md');
assert(
  step95Content.toLowerCase().includes('re-init') ||
  step95Content.toLowerCase().includes('reinit') ||
  step95Content.toLowerCase().includes('re-initialization'),
  'Step 9.5 mentions re-init behavior'
);
assert(
  step95Content.toLowerCase().includes('untouched') ||
  step95Content.toLowerCase().includes('skip') ||
  step95Content.toLowerCase().includes('do not overwrite') ||
  step95Content.toLowerCase().includes('preserve'),
  'Step 9.5 states user.md is preserved during re-init'
);

// ============================================================
// Test 7: Existing steps are unchanged
// ============================================================
console.log('\nTest 7: Existing steps unchanged');
assert(
  content.includes('### Step 9: Optional .gitignore Update'),
  'Step 9 (.gitignore) is unchanged'
);
assert(
  content.includes('### Step 10: Completion Summary'),
  'Step 10 (Completion Summary) is unchanged'
);

// ============================================================
// Test 8: Step 1 (re-init) skips user.md step
// ============================================================
console.log('\nTest 8: Re-init handling skips user.md');
const step1Content = contentBetweenSections('### Step 1:', content);
// Step 1 mentions skipping CLAUDE.md and .gitignore steps on re-init
// It should also reference user.md or Step 9.5
assert(
  step1Content.toLowerCase().includes('user.md') ||
  step1Content.includes('9.5'),
  'Step 1 re-init section mentions user.md or Step 9.5'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
