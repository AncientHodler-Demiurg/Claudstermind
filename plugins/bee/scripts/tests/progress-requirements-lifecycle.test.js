#!/usr/bin/env node
// Test: progress.md command includes requirements coverage section (2.5)
// and lifecycle messaging for all spec states (NO_SPEC, SPEC_CREATED,
// IN_PROGRESS, COMPLETED, ARCHIVED).

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'progress.md'
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

// Read the file
let content;
try {
  content = fs.readFileSync(CMD_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: progress.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: progress.md reads requirements.md from spec path
// ============================================================
console.log('Test 1: Requirements.md reading');
assert(
  content.includes('requirements.md'),
  'progress.md references requirements.md'
);
assert(
  content.toLowerCase().includes('spec') &&
  content.toLowerCase().includes('path') &&
  content.includes('requirements.md'),
  'progress.md reads requirements.md from spec path'
);

// ============================================================
// Test 2: Checkbox counting logic described
// ============================================================
console.log('\nTest 2: Checkbox counting');
assert(
  content.includes('- [ ]') && content.includes('- [x]'),
  'progress.md describes counting - [ ] (unchecked) and - [x] (checked) checkboxes'
);
assert(
  content.includes('covered') || content.includes('checked'),
  'progress.md mentions covered/checked requirements'
);

// ============================================================
// Test 3: Section 2.5 Requirements Coverage exists
// ============================================================
console.log('\nTest 3: Requirements Coverage section');
assert(
  content.includes('Requirements Coverage') ||
  content.includes('requirements coverage'),
  'progress.md has Requirements Coverage section'
);
// Check format: Requirements: {covered}/{total} covered ({percentage}%)
assert(
  content.includes('Requirements:') &&
  content.includes('covered') &&
  content.includes('%'),
  'Requirements Coverage uses format: Requirements: N/M covered (X%)'
);
// Positioned as section 2.5 (between Phase Progress and Quick Tasks)
const reqCoverageIdx = content.indexOf('Requirements Coverage');
const phaseProgressIdx = content.indexOf('Phase Progress');
const quickTasksIdx = content.indexOf('Quick Tasks');
assert(
  reqCoverageIdx > -1 && phaseProgressIdx > -1 && quickTasksIdx > -1 &&
  reqCoverageIdx > phaseProgressIdx && reqCoverageIdx < quickTasksIdx,
  'Requirements Coverage appears between Phase Progress and Quick Tasks (section 2.5)'
);

// ============================================================
// Test 4: Fallback when no requirements.md or no checkboxes
// ============================================================
console.log('\nTest 4: Fallback messaging');
assert(
  content.includes('No requirements tracking'),
  'Fallback text: "No requirements tracking" when no requirements.md or no checkboxes'
);

// ============================================================
// Test 5: Lifecycle messaging covers all 5 states
// ============================================================
console.log('\nTest 5: Lifecycle messaging states');
assert(
  content.includes('NO_SPEC'),
  'Lifecycle messaging includes NO_SPEC state'
);
assert(
  content.includes('SPEC_CREATED'),
  'Lifecycle messaging includes SPEC_CREATED state'
);
assert(
  content.includes('IN_PROGRESS'),
  'Lifecycle messaging includes IN_PROGRESS state'
);
assert(
  content.includes('COMPLETED'),
  'Lifecycle messaging includes COMPLETED state'
);
assert(
  content.includes('ARCHIVED'),
  'Lifecycle messaging includes ARCHIVED state'
);

// ============================================================
// Test 6: Lifecycle messaging in the suggest next command table
// ============================================================
console.log('\nTest 6: Lifecycle state suggestions');
// The suggest next command section should handle SPEC_CREATED, COMPLETED, ARCHIVED
const suggestSection = sectionContent('### Suggest Next Command', content);
assert(
  suggestSection.includes('SPEC_CREATED') || suggestSection.includes('Spec exists but no phases'),
  'Suggest section handles SPEC_CREATED state'
);
assert(
  suggestSection.includes('COMPLETED') || suggestSection.includes('All phases are complete'),
  'Suggest section handles COMPLETED state'
);
assert(
  suggestSection.includes('ARCHIVED'),
  'Suggest section handles ARCHIVED state'
);

// ============================================================
// Test 7: Output remains concise (no verbose additions)
// ============================================================
console.log('\nTest 7: Concise output');
assert(
  content.includes('concise') || content.includes('one screen'),
  'progress.md still emphasizes concise output'
);

// ============================================================
// Test 8: Requirements reading uses spec path from STATE.md
// ============================================================
console.log('\nTest 8: Spec path used for requirements');
// The command should read requirements.md relative to spec path
assert(
  content.includes('requirements.md') &&
  (content.toLowerCase().includes('spec path') ||
   content.toLowerCase().includes('spec dir') ||
   content.toLowerCase().includes('spec folder') ||
   content.toLowerCase().includes('current spec')),
  'Requirements reading uses the spec path from STATE.md'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
