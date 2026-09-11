#!/usr/bin/env node
// Test: plan-compliance-reviewer.md agent extended to mark requirements covered
// after code review phase.

const fs = require('fs');
const path = require('path');

const AGENT_PATH = path.join(
  __dirname, '..', '..', 'agents', 'plan-compliance-reviewer.md'
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
function sectionContent(heading, fullContent) {
  const startIdx = fullContent.indexOf(heading);
  if (startIdx === -1) return '';
  const afterHeading = fullContent.substring(startIdx + heading.length);
  const headingLevel = heading.match(/^#+/);
  if (!headingLevel) return afterHeading;
  const level = headingLevel[0].length;
  const regex = new RegExp(`\n#{1,${level}} [^#]`);
  const nextSection = afterHeading.search(regex);
  if (nextSection === -1) return afterHeading;
  return afterHeading.substring(0, nextSection);
}

// Helper: get content from a heading to end of file
function contentFromHeadingToEnd(heading, fullContent) {
  const startIdx = fullContent.indexOf(heading);
  if (startIdx === -1) return '';
  return fullContent.substring(startIdx);
}

// Read the file
let content;
try {
  content = fs.readFileSync(AGENT_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: plan-compliance-reviewer.md does not exist at expected path');
  console.log(`  Expected: ${AGENT_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: Frontmatter tools updated to include Write
// ============================================================
console.log('Test 1: Frontmatter tools include Write');
const frontmatter = extractFrontmatter(content);
assert(
  frontmatter.includes('Write'),
  'Frontmatter tools list includes Write'
);
assert(
  frontmatter.includes('Read') && frontmatter.includes('Glob') && frontmatter.includes('Grep'),
  'Frontmatter retains original tools: Read, Glob, Grep'
);
// Verify the tools line format
const toolsLine = frontmatter.split('\n').find(l => l.startsWith('tools:'));
assert(
  toolsLine && toolsLine.includes('Read') && toolsLine.includes('Glob') && toolsLine.includes('Grep') && toolsLine.includes('Write'),
  'Tools line has all four tools: Read, Glob, Grep, Write'
);

// ============================================================
// Test 2: Step 7c exists for "Mark Covered Requirements"
// ============================================================
console.log('\nTest 2: Step 7c Mark Covered Requirements');
assert(
  content.includes('Step 7c') || content.includes('7c:'),
  'Step 7c exists in the agent'
);
assert(
  content.toLowerCase().includes('mark covered requirements') ||
  content.toLowerCase().includes('mark requirements'),
  'Step 7c is about marking covered requirements'
);

// ============================================================
// Test 3: Step 7c reads requirements.md from context packet
// ============================================================
console.log('\nTest 3: Step 7c reads requirements.md');
const step7cContent = sectionContent('### Step 7c', content);
assert(
  step7cContent.includes('requirements.md'),
  'Step 7c references requirements.md'
);
assert(
  step7cContent.toLowerCase().includes('context') ||
  step7cContent.toLowerCase().includes('provided') ||
  step7cContent.toLowerCase().includes('parent'),
  'Step 7c gets requirements.md path from context/parent'
);

// ============================================================
// Test 4: Step 7c uses R-M-W (Read-Modify-Write) pattern
// ============================================================
console.log('\nTest 4: Step 7c uses Read-Modify-Write pattern');
assert(
  step7cContent.toLowerCase().includes('read') &&
  (step7cContent.toLowerCase().includes('write') || step7cContent.toLowerCase().includes('modify')),
  'Step 7c describes Read-Modify-Write pattern'
);
assert(
  step7cContent.includes('- [ ]') || step7cContent.includes('`- [ ]`'),
  'Step 7c references unchecked checkbox format - [ ]'
);
assert(
  step7cContent.includes('- [x]') || step7cContent.includes('`- [x]`'),
  'Step 7c references checked checkbox format - [x]'
);

// ============================================================
// Test 5: Step 7c outputs summary with covered and unchecked counts
// ============================================================
console.log('\nTest 5: Step 7c outputs summary');
assert(
  step7cContent.toLowerCase().includes('requirements marked covered') ||
  step7cContent.toLowerCase().includes('marked covered'),
  'Step 7c mentions "Requirements marked covered" in output'
);
assert(
  step7cContent.toLowerCase().includes('still unchecked') ||
  step7cContent.toLowerCase().includes('unchecked'),
  'Step 7c mentions unchecked requirements count in output'
);

// ============================================================
// Test 6: Completion signal extended with requirements counts
// ============================================================
console.log('\nTest 6: Completion signal includes requirements counts');
const completionSection = sectionContent('## Completion Signal', content);
assert(
  completionSection.toLowerCase().includes('requirements') &&
  (completionSection.toLowerCase().includes('marked') || completionSection.toLowerCase().includes('covered')),
  'Code review mode completion signal includes requirements coverage info'
);

// ============================================================
// Test 7: IMPORTANT notice updated for requirements.md modification
// ============================================================
console.log('\nTest 7: IMPORTANT notice updated');
assert(
  content.includes('requirements.md'),
  'File mentions requirements.md'
);
// Old notice should be gone: "You do NOT modify code or plan files. You are read-only."
assert(
  !content.includes('You do NOT modify code or plan files. You are read-only. Report findings only.'),
  'Old read-only notice is removed'
);
// New notice should exist: modify ONLY requirements.md
assert(
  content.includes('You modify ONLY requirements.md') ||
  content.includes('you modify ONLY requirements.md'),
  'New IMPORTANT notice states "You modify ONLY requirements.md"'
);

// ============================================================
// Test 8: Handles missing requirements.md gracefully
// ============================================================
console.log('\nTest 8: Handles missing requirements.md gracefully');
assert(
  step7cContent.toLowerCase().includes('missing') ||
  step7cContent.toLowerCase().includes('does not exist') ||
  step7cContent.toLowerCase().includes('not found') ||
  step7cContent.toLowerCase().includes('skip'),
  'Step 7c handles missing requirements.md (skip/graceful)'
);

// ============================================================
// Test 9: Step 7c is placed after Step 6c (output) in code review mode
// ============================================================
console.log('\nTest 9: Step 7c placement');
const step6cIdx = content.indexOf('Step 6c');
const step7cIdx = content.indexOf('Step 7c');
assert(
  step6cIdx > -1 && step7cIdx > -1 && step7cIdx > step6cIdx,
  'Step 7c appears after Step 6c in the document'
);

// ============================================================
// Test 10: Step 7c only applies to Code Review Mode
// ============================================================
console.log('\nTest 10: Step 7c is in Code Review Mode section');
const codeReviewModeIdx = content.indexOf('## Code Review Mode');
const planReviewModeIdx = content.indexOf('## Plan Review Mode');
assert(
  codeReviewModeIdx > -1 && step7cIdx > codeReviewModeIdx && step7cIdx < planReviewModeIdx,
  'Step 7c is between Code Review Mode and Plan Review Mode sections'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
