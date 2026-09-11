#!/usr/bin/env node
// Test: audit-spec.md command file has correct frontmatter, dynamic context,
// all required steps (guards, parse requirements, trace to phases/reviews/tests,
// compute coverage, display traceability matrix, present options), and follows
// command conventions.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'audit-spec.md'
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
  // Match next heading of same or higher level (### or ##)
  const headingLevel = sectionHeading.match(/^#+/);
  if (!headingLevel) return afterHeading;
  const level = headingLevel[0].length;
  // Find next heading with level <= current level
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
  console.log('FAIL: audit-spec.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: Frontmatter
// ============================================================
console.log('Test 1: Frontmatter');
assert(
  content.startsWith('---'),
  'File starts with YAML frontmatter delimiter'
);
assert(
  content.includes('description:') && content.toLowerCase().includes('traceability'),
  'Frontmatter has description field with "traceability" keyword'
);
assert(
  content.includes('argument-hint:') && content.includes('--verbose'),
  'Frontmatter has argument-hint with --verbose'
);

// ============================================================
// Test 2: Dynamic context
// ============================================================
console.log('\nTest 2: Dynamic context');
const currentStateSection = contentBetweenSections('## Current State', content);
assert(
  currentStateSection.includes('STATE.md'),
  'Dynamic context reads STATE.md'
);
assert(
  currentStateSection.includes('config.json'),
  'Dynamic context reads config.json'
);

// ============================================================
// Test 3: Validation guards
// ============================================================
console.log('\nTest 3: Validation guards');
const step1Content = contentBetweenSections('### Step 1', content);
assert(
  step1Content.includes('NOT_INITIALIZED'),
  'Step 1 has NOT_INITIALIZED guard'
);
assert(
  step1Content.includes('NO_SPEC'),
  'Step 1 has NO_SPEC guard'
);
assert(
  step1Content.toLowerCase().includes('test -d') ||
  step1Content.toLowerCase().includes('spec directory') ||
  step1Content.toLowerCase().includes('directory exists'),
  'Step 1 has spec directory guard (test -d)'
);

// ============================================================
// Test 4: Core functionality - Parse requirements
// ============================================================
console.log('\nTest 4: Core functionality - Parse requirements');
const step2Content = contentBetweenSections('### Step 2', content);
assert(
  step2Content.toLowerCase().includes('spec.md'),
  'Step 2 reads spec.md for parsing requirements'
);
assert(
  step2Content.includes('REQ-') || step2Content.match(/[A-Z]+-\d+/),
  'Step 2 includes requirement ID pattern matching (REQ- format)'
);

// ============================================================
// Test 5: Core functionality - Trace to phases, reviews, tests
// ============================================================
console.log('\nTest 5: Core functionality - Tracing');
const step3Content = contentBetweenSections('### Step 3', content);
assert(
  step3Content.includes('TASKS.md'),
  'Step 3 traces requirements to phases via TASKS.md'
);
const step4Content = contentBetweenSections('### Step 4', content);
assert(
  step4Content.includes('REVIEW.md'),
  'Step 4 traces requirements to reviews via REVIEW.md'
);
const step5Content = contentBetweenSections('### Step 5', content);
assert(
  step5Content.includes('TESTING.md'),
  'Step 5 traces requirements to tests via TESTING.md'
);

// ============================================================
// Test 6: Coverage computation
// ============================================================
console.log('\nTest 6: Coverage computation');
const step6Content = contentBetweenSections('### Step 6', content);
assert(
  step6Content.toLowerCase().includes('percentage') ||
  step6Content.toLowerCase().includes('coverage') ||
  step6Content.includes('* 100'),
  'Step 6 computes coverage percentage'
);
assert(
  step6Content.includes('Orphaned'),
  'Step 6 defines Orphaned status for unmapped requirements'
);
assert(
  step6Content.includes('Satisfied'),
  'Step 6 defines Satisfied status for fully traced requirements'
);
assert(
  step6Content.includes('Untested'),
  'Step 6 defines Untested status for requirements without test coverage'
);

// ============================================================
// Test 7: Traceability matrix display
// ============================================================
console.log('\nTest 7: Traceability Matrix display');
assert(
  content.includes('Traceability Matrix'),
  'Contains Traceability Matrix heading'
);
assert(
  content.includes('Coverage Summary'),
  'Contains Coverage Summary section'
);
// Note: Step 7 contains a code block with ## headings inside it, which the
// section helper may truncate. Check the full content for the table format.
assert(
  content.includes('| Req |') && content.includes('| Status |'),
  'Has formatted table with Req and Status columns'
);

// ============================================================
// Test 8: UX - User interaction
// ============================================================
console.log('\nTest 8: UX');
assert(
  content.includes('AskUserQuestion'),
  'Contains AskUserQuestion for interactive options'
);
assert(
  content.includes('complete-spec'),
  'Suggests /bee:complete-spec as next step'
);

// ============================================================
// Test 9: Design Notes
// ============================================================
console.log('\nTest 9: Design Notes');
assert(
  content.includes('Design Notes'),
  'Contains Design Notes section'
);
assert(
  !content.includes('Task(') ||
  (content.includes('Task(') && content.includes('No `Task(`')),
  'Does NOT use agent spawning (no Task( pattern for spawning)'
);

// ============================================================
// Test 10: Step 4 - STATE.md Reviewed column primary, REVIEW.md fallback
// ============================================================
console.log('\nTest 10: Step 4 - STATE.md Reviewed column primary');
assert(
  step4Content.includes('STATE.md') &&
  step4Content.toLowerCase().includes('primary'),
  'Step 4 calls out STATE.md as PRIMARY review source'
);
assert(
  step4Content.toLowerCase().includes('reviewed column'),
  'Step 4 references the Reviewed column explicitly'
);
assert(
  step4Content.toLowerCase().includes('fallback'),
  'Step 4 mentions REVIEW.md as fallback'
);
assert(
  step4Content.includes('Yes (N)') || step4Content.includes('via STATE.md'),
  'Step 4 references the Reviewed column value format (Yes (N) / via STATE.md)'
);

// ============================================================
// Test 11: Step 5 - STATE.md Tested column primary, TESTING.md fallback
// ============================================================
console.log('\nTest 11: Step 5 - STATE.md Tested column primary');
assert(
  step5Content.includes('STATE.md') &&
  step5Content.toLowerCase().includes('primary'),
  'Step 5 calls out STATE.md as PRIMARY tested source'
);
assert(
  step5Content.toLowerCase().includes('tested column'),
  'Step 5 references the Tested column explicitly'
);
assert(
  step5Content.includes('Pass'),
  'Step 5 references the "Pass" Tested column value'
);
assert(
  step5Content.toLowerCase().includes('fallback'),
  'Step 5 mentions TESTING.md as fallback'
);

// ============================================================
// Test 12: Step 2 - ROADMAP.md primary requirement source (3-tier chain)
// ============================================================
console.log('\nTest 12: Step 2 - ROADMAP.md primary requirement source');
assert(
  step2Content.includes('ROADMAP.md') &&
  step2Content.toLowerCase().includes('primary'),
  'Step 2 calls out ROADMAP.md as PRIMARY requirement source'
);
assert(
  step2Content.includes('Phase-Requirement Mapping'),
  'Step 2 references the Phase-Requirement Mapping table in ROADMAP.md'
);
assert(
  step2Content.toLowerCase().includes('secondary') ||
  step2Content.toLowerCase().includes('tertiary') ||
  step2Content.toLowerCase().includes('fallback'),
  'Step 2 describes the fallback chain (secondary/tertiary/fallback)'
);
assert(
  step2Content.toLowerCase().includes('all three sources') ||
  step2Content.toLowerCase().includes('all sources') ||
  step2Content.toLowerCase().includes('only stop') ||
  step2Content.toLowerCase().includes('only skip'),
  'Step 2 only stops audit when ALL sources are empty'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
