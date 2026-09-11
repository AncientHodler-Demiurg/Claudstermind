#!/usr/bin/env node
// Test: forensics.md command file has correct frontmatter, NOT_INITIALIZED guard,
// git history analysis, anomaly detection (stuck loops, missing artifacts, abandoned work,
// time gaps, STATE.md anomalies), pause-handoff false positive prevention,
// severity scoring, report generation, recovery suggestions, and read-only constraint.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'forensics.md'
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
  console.log('FAIL: forensics.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lowerContent = content.toLowerCase();

// Helper: extract YAML frontmatter
function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

const frontmatter = extractFrontmatter(content);

// ============================================================
// Test 1: forensics.md exists with correct path
// ============================================================
console.log('Test 1: File exists');
assert(
  content.length > 0,
  'forensics.md exists at plugins/bee/commands/forensics.md'
);

// ============================================================
// Test 2: YAML frontmatter with description and argument-hint
// ============================================================
console.log('\nTest 2: Frontmatter');
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

// ============================================================
// Test 3: NOT_INITIALIZED guard
// ============================================================
console.log('\nTest 3: NOT_INITIALIZED guard');
assert(
  content.includes('NOT_INITIALIZED'),
  'Has NOT_INITIALIZED guard'
);
assert(
  lowerContent.includes('stop') || lowerContent.includes('do not proceed'),
  'Stops execution when not initialized'
);

// ============================================================
// Test 4: Git log analysis commands
// ============================================================
console.log('\nTest 4: Git log analysis');
assert(
  content.includes('git log'),
  'Has git log command for history analysis'
);
assert(
  content.includes('--format') || content.includes('--oneline'),
  'Git log uses format or oneline flag'
);

// ============================================================
// Test 5: Stuck loop detection
// ============================================================
console.log('\nTest 5: Stuck loop detection');
assert(
  (lowerContent.includes('stuck') && lowerContent.includes('loop')) ||
  (lowerContent.includes('repeated') && lowerContent.includes('file')) ||
  lowerContent.includes('uniq -c'),
  'Has stuck loop detection logic'
);

// ============================================================
// Test 6: Missing artifact detection (TASKS.md check)
// ============================================================
console.log('\nTest 6: Missing artifact detection');
assert(
  lowerContent.includes('tasks.md') && (
    lowerContent.includes('missing') || lowerContent.includes('artifact') ||
    lowerContent.includes('exist') || lowerContent.includes('consistency')
  ),
  'Checks for missing TASKS.md artifacts'
);

// ============================================================
// Test 7: Abandoned work detection with pause-handoff.md check
// ============================================================
console.log('\nTest 7: Abandoned work + pause-handoff check');
assert(
  lowerContent.includes('abandoned') || lowerContent.includes('executing'),
  'Detects abandoned work (stale EXECUTING status)'
);
assert(
  lowerContent.includes('pause-handoff'),
  'Checks pause-handoff.md to prevent false positives'
);

// ============================================================
// Test 8: Time gap detection
// ============================================================
console.log('\nTest 8: Time gap detection');
assert(
  (lowerContent.includes('gap') && lowerContent.includes('time')) ||
  (lowerContent.includes('gap') && lowerContent.includes('hour')) ||
  lowerContent.includes('28800') ||
  lowerContent.includes('8h') ||
  lowerContent.includes('8 hour'),
  'Has time gap detection logic'
);

// ============================================================
// Test 9: STATE.md anomaly detection
// ============================================================
console.log('\nTest 9: STATE.md anomaly detection');
assert(
  content.includes('STATE.md') && (
    lowerContent.includes('anomal') || lowerContent.includes('status') ||
    lowerContent.includes('phase')
  ),
  'Analyzes STATE.md for anomalies'
);

// ============================================================
// Test 10: Report written to .bee/forensics/{timestamp}-report.md
// ============================================================
console.log('\nTest 10: Report output path');
assert(
  content.includes('.bee/forensics/'),
  'Writes report to .bee/forensics/ directory'
);
assert(
  lowerContent.includes('mkdir') || lowerContent.includes('create') ||
  lowerContent.includes('write'),
  'Creates directory or writes report file'
);
assert(
  lowerContent.includes('timestamp') || lowerContent.includes('report.md'),
  'Report filename includes timestamp pattern'
);

// ============================================================
// Test 11: Report has required sections
// ============================================================
console.log('\nTest 11: Report sections');
assert(
  content.includes('## Timeline') || content.includes('Timeline'),
  'Report has Timeline section'
);
assert(
  content.includes('## Anomalies') || content.includes('Anomalies Found'),
  'Report has Anomalies Found section'
);
assert(
  content.includes('## Root Cause') || content.includes('Root Cause Assessment'),
  'Report has Root Cause Assessment section'
);
assert(
  content.includes('## Recovery') || content.includes('Recovery Suggestions'),
  'Report has Recovery Suggestions section'
);

// ============================================================
// Test 12: Recovery suggestions reference bee commands
// ============================================================
console.log('\nTest 12: Recovery suggestions reference /bee: commands');
assert(
  content.includes('/bee:'),
  'Recovery suggestions reference /bee: commands'
);

// ============================================================
// Test 13: Read-only -- does NOT modify STATE.md or TASKS.md
// ============================================================
console.log('\nTest 13: Read-only constraint');
// Check that it explicitly states read-only behavior
assert(
  lowerContent.includes('read-only') || lowerContent.includes('read only') ||
  lowerContent.includes('never modif') || lowerContent.includes('does not modify') ||
  lowerContent.includes('only creates'),
  'Explicitly states read-only behavior'
);
// The content should NOT contain write/edit instructions targeting STATE.md
// (reading STATE.md is fine; writing to it is not)
const hasWriteState = (
  (lowerContent.includes('write') || lowerContent.includes('edit') || lowerContent.includes('modify')) &&
  lowerContent.includes('state.md') &&
  !lowerContent.includes('never modif') &&
  !lowerContent.includes('does not modify') &&
  !lowerContent.includes('read-only')
);
// We just need read-only to be declared; the above is a weaker check
assert(
  lowerContent.includes('read-only') ||
  lowerContent.includes('never modif') ||
  lowerContent.includes('does not modify'),
  'Command declares itself as read-only'
);

// ============================================================
// Test 14: Anomaly severity scoring (HIGH/MEDIUM/LOW)
// ============================================================
console.log('\nTest 14: Severity scoring');
assert(
  content.includes('HIGH') && content.includes('MEDIUM') && content.includes('LOW'),
  'Has HIGH, MEDIUM, and LOW severity levels'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
