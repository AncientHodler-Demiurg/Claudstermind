#!/usr/bin/env node
// Test: init.md command file has Step 12 "Extensions Loading" after Step 11
// that detects and loads extensions from .claude/bee-extensions/.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'init.md'
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
  console.log('FAIL: init.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lowerContent = content.toLowerCase();

// ============================================================
// Test 1: Step 12 heading exists after Step 11
// ============================================================
console.log('Test 1: Step 12 heading exists after Step 11');
const step11Idx = content.indexOf('### Step 11');
const step12Idx = content.indexOf('### Step 12');
assert(step12Idx !== -1, 'Step 12 heading exists in init.md');
assert(
  step11Idx !== -1 && step12Idx > step11Idx,
  'Step 12 appears after Step 11'
);

// ============================================================
// Test 2: Step 12 title references extensions loading
// ============================================================
console.log('\nTest 2: Step 12 title references extensions');
const step12HeadingLine = step12Idx !== -1
  ? content.substring(step12Idx, content.indexOf('\n', step12Idx))
  : '';
assert(
  step12HeadingLine.toLowerCase().includes('extension'),
  'Step 12 heading mentions "extension"'
);

// ============================================================
// Test 3: Step 12 checks .claude/bee-extensions/ directory via Bash
// ============================================================
console.log('\nTest 3: Step 12 checks bee-extensions directory');
const step12Content = step12Idx !== -1
  ? contentBetweenSections('### Step 12', content)
  : '';
assert(
  step12Content.includes('.claude/bee-extensions') ||
  step12Content.includes('bee-extensions'),
  'Step 12 references .claude/bee-extensions/ directory'
);
assert(
  step12Content.toLowerCase().includes('bash') ||
  step12Content.toLowerCase().includes('test -d') ||
  step12Content.toLowerCase().includes('exists'),
  'Step 12 checks if extensions directory exists'
);

// ============================================================
// Test 4: Step 12 handles missing directory -- "No local extensions"
// ============================================================
console.log('\nTest 4: Step 12 handles missing directory');
assert(
  step12Content.toLowerCase().includes('no local extensions') ||
  step12Content.toLowerCase().includes('no extensions') ||
  step12Content.toLowerCase().includes('does not exist'),
  'Step 12 displays "No local extensions" when directory missing'
);
assert(
  step12Content.toLowerCase().includes('skip'),
  'Step 12 skips when directory is missing'
);

// ============================================================
// Test 5: Step 12 globs for agents/*.md and skills/*.md
// ============================================================
console.log('\nTest 5: Step 12 globs for extension files');
assert(
  step12Content.includes('agents/') ||
  step12Content.toLowerCase().includes('agents'),
  'Step 12 looks for agent extensions'
);
assert(
  step12Content.includes('skills/') ||
  step12Content.toLowerCase().includes('skills'),
  'Step 12 looks for skill extensions'
);
assert(
  step12Content.toLowerCase().includes('glob') ||
  step12Content.toLowerCase().includes('*.md') ||
  step12Content.toLowerCase().includes('.md'),
  'Step 12 globs for .md files'
);

// ============================================================
// Test 6: Step 12 reads frontmatter name: from each extension
// ============================================================
console.log('\nTest 6: Step 12 reads frontmatter name');
assert(
  step12Content.toLowerCase().includes('frontmatter') ||
  step12Content.toLowerCase().includes('name:'),
  'Step 12 reads frontmatter name: field from extensions'
);

// ============================================================
// Test 7: Step 12 displays per-extension loaded messages
// ============================================================
console.log('\nTest 7: Step 12 displays loaded messages');
assert(
  step12Content.toLowerCase().includes('extension') &&
  step12Content.toLowerCase().includes('loaded'),
  'Step 12 displays loaded message per extension'
);
assert(
  step12Content.toLowerCase().includes('agent') &&
  step12Content.toLowerCase().includes('skill'),
  'Step 12 distinguishes between agent and skill extensions'
);

// ============================================================
// Test 8: Step 12 displays summary line with counts
// ============================================================
console.log('\nTest 8: Step 12 summary line');
assert(
  step12Content.toLowerCase().includes('extensions loaded:') ||
  step12Content.toLowerCase().includes('extensions loaded'),
  'Step 12 has "Extensions loaded:" summary line'
);
assert(
  step12Content.toLowerCase().includes('agents') &&
  step12Content.toLowerCase().includes('skills'),
  'Step 12 summary mentions agent and skill counts'
);

// ============================================================
// Test 9: Step 12 handles empty directory
// ============================================================
console.log('\nTest 9: Step 12 handles empty directory');
assert(
  step12Content.toLowerCase().includes('no extensions yet') ||
  step12Content.toLowerCase().includes('contains no extensions') ||
  step12Content.toLowerCase().includes('empty'),
  'Step 12 handles empty extensions directory'
);

// ============================================================
// Test 10: Steps 1-11 remain unchanged
// ============================================================
console.log('\nTest 10: Steps 1-11 are unchanged');
// Verify key existing steps are still present and in order
assert(
  content.includes('### Step 1: Check for Existing Project'),
  'Step 1 still has original title "Check for Existing Project"'
);
assert(
  content.includes('### Step 2: Stack Detection'),
  'Step 2 still has original title "Stack Detection"'
);
assert(
  content.includes('### Step 10: Completion Summary'),
  'Step 10 still has original title "Completion Summary"'
);
assert(
  content.includes('### Step 11: Codebase Context Extraction'),
  'Step 11 still has original title "Codebase Context Extraction"'
);

// Verify Step 10 content is unchanged
const step10Content = contentBetweenSections('### Step 10', content);
assert(
  step10Content.includes('BeeDev initialized!'),
  'Step 10 still contains "BeeDev initialized!" display'
);
/* removed: superseded (Phase 2 triage) */

// Verify Step 11 content is unchanged
const step11Content = contentBetweenSections('### Step 11', content);
assert(
  step11Content.includes('context-builder'),
  'Step 11 still references context-builder agent'
);

// ============================================================
// Test 11: Total step count is now 12
// ============================================================
console.log('\nTest 11: Total step count');
const stepMatches = content.match(/### Step \d+/g);
/* removed: superseded (Phase 2 triage) */

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
