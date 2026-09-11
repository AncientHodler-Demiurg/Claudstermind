#!/usr/bin/env node
// Test: resume.md has a new Section 1.6 "Git Drift Check" inside Section 1
// (Where You Left Off), between the Learnings Summary subsection and Section 2
// (Current Position). The section instructs the command to extract the Last
// Action timestamp from STATE.md, run `git log --since="{timestamp}"`, and
// display a warning block if any commits landed after the last bee command.
// If there is no drift, the section stays silent (zero-noise). STRUCTURAL
// assertions only -- reads resume.md as text and asserts on its contents.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'resume.md'
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

// Read the file
let content;
try {
  content = fs.readFileSync(CMD_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: resume.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: Git Drift Check heading exists
// ============================================================
console.log('Test 1: Git Drift Check heading exists');
assert(
  content.includes('Git Drift Check'),
  'resume.md contains a "Git Drift Check" heading'
);
assert(
  content.includes('**Git Drift Check (if available):**'),
  'Heading uses (if available) suffix matching Section 1 convention'
);

// ============================================================
// Test 2: Drift check is located between Learnings Summary and Section 2
// ============================================================
console.log('\nTest 2: Drift check positioned after Section 1 subsections');
const learningsIdx = content.indexOf('Learnings Summary');
const driftIdx = content.indexOf('Git Drift Check');
const section2Idx = content.indexOf('**2. Current Position**');
assert(
  learningsIdx > -1 && driftIdx > -1 && section2Idx > -1,
  'All three landmarks present: Learnings Summary, Git Drift Check, Section 2'
);
assert(
  learningsIdx < driftIdx && driftIdx < section2Idx,
  'Git Drift Check appears after Learnings Summary and before Section 2 (Current Position)'
);

// ============================================================
// Test 3: References `Last Action` timestamp extraction
// ============================================================
console.log('\nTest 3: Last Action timestamp extraction');
// Extract just the drift section for targeted assertions.
// If the drift check heading doesn't exist yet, driftSection is empty so
// the rest of the tests will fail loudly instead of leaking matches from
// the rest of the file.
const driftSectionStart = content.indexOf('Git Drift Check');
let driftSection = '';
if (driftSectionStart !== -1) {
  const driftSectionEnd = content.indexOf('**2. Current Position**', driftSectionStart);
  driftSection = driftSectionEnd !== -1
    ? content.substring(driftSectionStart, driftSectionEnd)
    : content.substring(driftSectionStart);
}
assert(
  driftSection.includes('Last Action'),
  'Drift check references the "Last Action" section of STATE.md'
);
assert(
  driftSection.includes('Timestamp') || driftSection.includes('timestamp'),
  'Drift check references the timestamp value'
);
assert(
  driftSection.includes('STATE.md'),
  'Drift check references STATE.md as the source of the timestamp'
);

// ============================================================
// Test 4: References `git log --since`
// ============================================================
console.log('\nTest 4: git log --since invocation');
assert(
  driftSection.includes('git log --since'),
  'Drift check references `git log --since` for finding post-timestamp commits'
);

// ============================================================
// Test 5: Warning language for drift detected
// ============================================================
console.log('\nTest 5: Warning phrasing for drift detected');
assert(
  driftSection.toLowerCase().includes('landed after last bee command') ||
    driftSection.toLowerCase().includes('landed after the last bee command'),
  'Drift check uses "landed after last bee command" phrasing in warning'
);
assert(
  driftSection.toLowerCase().includes('stale') ||
    driftSection.toLowerCase().includes('STATE.md may'),
  'Drift check warns that STATE.md may be stale'
);

// ============================================================
// Test 6: Suggests /bee:note or /bee:commit as remediation
// ============================================================
console.log('\nTest 6: Remediation suggestion');
assert(
  driftSection.includes('/bee:note') || driftSection.includes('/bee:commit'),
  'Drift check suggests `/bee:note` or `/bee:commit` as remediation'
);

// ============================================================
// Test 7: Zero-noise behavior when no drift
// ============================================================
console.log('\nTest 7: Zero-noise when no drift');
// Accept any of: "display nothing", "0 commits", "no commits", "display NOTHING"
assert(
  /display nothing|display\s+NOTHING|0 commits|zero-noise|no drift/i.test(driftSection),
  'Drift check explicitly states nothing is displayed when there is no drift'
);

// ============================================================
// Test 8: Existing sections still present (no regressions)
// ============================================================
console.log('\nTest 8: Existing briefing sections preserved');
assert(
  content.includes('**1. Where You Left Off**'),
  'Section 1 "Where You Left Off" still present'
);
assert(
  content.includes('**2. Current Position**'),
  'Section 2 "Current Position" still present'
);
assert(
  content.includes('**3. Session Context'),
  'Section 3 "Session Context" still present'
);
assert(
  content.includes('**4. Phase Details'),
  'Section 4 "Phase Details" still present'
);
assert(
  content.includes('**5. What To Do Next**'),
  'Section 5 "What To Do Next" still present'
);
assert(
  content.includes('**6. Codebase Context'),
  'Section 6 "Codebase Context" still present'
);
assert(
  content.includes('**7. Extensions**'),
  'Section 7 "Extensions" still present'
);

// ============================================================
// Test 9: Drift check lives inside the Context Restoration Briefing
// ============================================================
console.log('\nTest 9: Drift check within Context Restoration Briefing');
const briefingStart = content.indexOf('### Context Restoration Briefing');
const outputStart = content.indexOf('### Output Format');
const briefingContent = content.substring(briefingStart, outputStart);
assert(
  briefingContent.includes('Git Drift Check'),
  'Drift check is inside the Context Restoration Briefing block'
);

// ============================================================
// Test 10: Drift check mentions commit list formatting
// ============================================================
console.log('\nTest 10: Commit list formatting');
assert(
  driftSection.includes('{hash}') || driftSection.includes('%h'),
  'Drift check documents commit hash placeholder or git format'
);

// ============================================================
// Test 11: Timestamp guard against empty/missing/malformed values
// ============================================================
console.log('\nTest 11: Timestamp guard');
assert(
  driftSection.toLowerCase().includes('empty') ||
    driftSection.toLowerCase().includes('missing'),
  'Guard language references empty/missing timestamp'
);
assert(
  driftSection.toLowerCase().includes('skip'),
  'Guard language uses "skip" to indicate zero-noise on invalid timestamp'
);
assert(
  driftSection.includes('{TIMESTAMP}') ||
    driftSection.toLowerCase().includes('placeholder') ||
    driftSection.toLowerCase().includes('iso 8601'),
  'Guard references placeholder/ISO format validation'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
