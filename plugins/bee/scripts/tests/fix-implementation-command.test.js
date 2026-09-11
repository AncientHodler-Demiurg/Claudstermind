#!/usr/bin/env node
// Test: fix-implementation.md command has correct frontmatter, dynamic context,
// step structure, review file resolution, finding parsing, severity sorting,
// fix loop, and summary behavior.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'fix-implementation.md'
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
  // Match next heading at the same or higher level
  const headingLevel = (sectionHeading.match(/^#+/) || [''])[0].length;
  const regex = new RegExp(`\n#{1,${headingLevel}} [^#]`);
  const nextHeading = afterHeading.search(regex);
  if (nextHeading === -1) return afterHeading;
  return afterHeading.substring(0, nextHeading);
}

// Read the file
let content;
try {
  content = fs.readFileSync(CMD_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: fix-implementation.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: Frontmatter is correct
// ============================================================
console.log('Test 1: Frontmatter');
assert(
  content.startsWith('---'),
  'File starts with YAML frontmatter delimiter'
);
assert(
  content.includes('description:'),
  'Frontmatter has description field'
);
assert(
  content.includes('argument-hint:') && content.includes('[review-file-path]'),
  'Frontmatter has argument-hint with "[review-file-path]"'
);

// ============================================================
// Test 2: Dynamic context reads STATE.md and config.json
// ============================================================
console.log('\nTest 2: Dynamic context');
assert(
  content.includes('STATE.md'),
  'References STATE.md for dynamic context'
);
assert(
  content.includes('config.json'),
  'References config.json for dynamic context'
);
assert(
  content.includes('NOT_INITIALIZED'),
  'Has NOT_INITIALIZED guard'
);

// ============================================================
// Test 3: Step 1 -- Resolve review file with auto-detect
// ============================================================
console.log('\nTest 3: Review file resolution');
// Check for optional arg path
assert(
  content.includes('argument') || content.includes('$ARGUMENTS') || content.includes('arg'),
  'Step 1 references command argument for optional review file path'
);
// Auto-detect path (a): REVIEW-IMPLEMENTATION.md
assert(
  content.includes('REVIEW-IMPLEMENTATION.md'),
  'Auto-detect option (a): {spec-path}/REVIEW-IMPLEMENTATION.md'
);
// Auto-detect path (b): most recent in .bee/reviews/
assert(
  content.includes('.bee/reviews/') || content.includes('reviews/'),
  'Auto-detect option (b): most recent in .bee/reviews/'
);
// Auto-detect path (c): REVIEW-PROJECT.md
assert(
  content.includes('REVIEW-PROJECT.md'),
  'Auto-detect option (c): {spec-path}/REVIEW-PROJECT.md'
);
// Stops if none found
assert(
  content.toLowerCase().includes('no review file found') ||
  content.toLowerCase().includes('stop') ||
  content.toLowerCase().includes('not proceed') ||
  content.toLowerCase().includes('none found'),
  'Stops if no review file is found'
);

// ============================================================
// Test 4: Step 2 -- Parse findings
// ============================================================
console.log('\nTest 4: Finding parsing');
assert(
  content.includes('F-') && (content.includes('### F-') || content.includes('F-NNN')),
  'Parses F-NNN finding sections'
);
assert(
  content.includes('REAL BUG') && content.includes('Validation'),
  'Filters for Validation: REAL BUG'
);
assert(
  content.includes('Fix Status') && content.includes('pending'),
  'Filters for Fix Status: pending'
);
assert(
  content.toLowerCase().includes('stop') ||
  content.toLowerCase().includes('no confirmed') ||
  content.toLowerCase().includes('none'),
  'Stops if no actionable findings'
);

// ============================================================
// Test 5: Step 3 -- Sort by severity
// ============================================================
console.log('\nTest 5: Severity sorting');
assert(
  content.includes('Critical') && content.includes('High') && content.includes('Medium'),
  'References Critical, High, and Medium severities'
);
// Check sort order
const critIdx = content.indexOf('Critical');
const highIdx = content.indexOf('High');
const stdMedIdx = content.indexOf('Standards');
assert(
  critIdx < highIdx,
  'Critical appears before High in sort order'
);
// Standards-Medium as a distinct priority
assert(
  content.includes('Standards') && content.toLowerCase().includes('medium'),
  'Standards-Medium is a distinct sorting priority'
);

// ============================================================
// Test 6: Step 4 -- Fix loop with fixer agents
// ============================================================
console.log('\nTest 6: Fix loop');
assert(
  content.includes('fixer') || content.includes('Fixer'),
  'References fixer agents'
);
assert(
  content.toLowerCase().includes('sequential'),
  'Fixers are spawned sequentially'
);
assert(
  content.toLowerCase().includes('omit model') ||
  content.toLowerCase().includes('omit the model') ||
  (content.toLowerCase().includes('parent model') && !content.includes('model: "sonnet"')),
  'Fixer agents omit model parameter (use parent model)'
);
// Read-Modify-Write review file
assert(
  content.toLowerCase().includes('read') &&
  content.toLowerCase().includes('write') &&
  (content.toLowerCase().includes('review') || content.toLowerCase().includes('review file')),
  'Read-Modify-Write pattern for review file updates'
);
// Revert on failure
assert(
  content.toLowerCase().includes('revert') || content.toLowerCase().includes('failed'),
  'Handles revert on failure'
);

// ============================================================
// Test 7: Step 5 -- Summary
// ============================================================
console.log('\nTest 7: Summary');
assert(
  content.includes('STATE.md') && content.includes('Last Action'),
  'Updates STATE.md Last Action'
);
assert(
  content.includes('git diff'),
  'Suggests git diff'
);
assert(
  content.includes('/bee:commit'),
  'Suggests /bee:commit'
);

// ============================================================
// Test 8: Never auto-commits
// ============================================================
console.log('\nTest 8: No auto-commit');
assert(
  content.toLowerCase().includes('never') &&
  (content.toLowerCase().includes('auto-commit') || content.toLowerCase().includes('auto commit')),
  'Explicitly states never auto-commits'
);

// ============================================================
// Test 9: Stack resolution for fixer context
// ============================================================
console.log('\nTest 9: Stack resolution');
assert(
  (content.includes('stacks[0].name') || content.includes('config.stacks')) ||
  (content.includes('config.stack') && content.includes('fallback')),
  'Resolves stack name from config (stacks[0].name or config.stack fallback)'
);

// ============================================================
// Test 10: Step structure completeness
// ============================================================
console.log('\nTest 10: Step structure');
// Verify all 5 steps exist
const stepPatterns = [
  /step\s*1[:\s]/i,
  /step\s*2[:\s]/i,
  /step\s*3[:\s]/i,
  /step\s*4[:\s]/i,
  /step\s*5[:\s]/i,
];
for (let i = 0; i < stepPatterns.length; i++) {
  assert(
    stepPatterns[i].test(content),
    `Step ${i + 1} exists in the command`
  );
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
