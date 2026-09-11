#!/usr/bin/env node
// Test: forensics.md has Phase 28 enhancements -- severity scoring (FRN-01),
// cross-phase dependency tracing (FRN-02), rollback path generation (FRN-03),
// enhanced report template, and severity-sorted presentation.

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
// Test Group 1: File exists and has frontmatter (2 tests)
// ============================================================
console.log('Test Group 1: File exists and has frontmatter');
assert(
  content.length > 0,
  'forensics.md exists at expected path'
);
assert(
  frontmatter.includes('description:'),
  'Frontmatter contains description field'
);

// ============================================================
// Test Group 2: Original structure preserved (4+8 tests)
// ============================================================
console.log('\nTest Group 2: Original structure preserved');
assert(
  content.includes('### Step 1: Validation Guards'),
  'Contains Step 1: Validation Guards'
);
assert(
  content.includes('### Step 2: Gather Evidence'),
  'Contains Step 2: Gather Evidence'
);
assert(
  content.includes('### Step 3: Artifact Consistency Check'),
  'Contains Step 3: Artifact Consistency Check'
);
assert(
  content.includes('### Step 4: Anomaly Detection'),
  'Contains Step 4: Anomaly Detection'
);

// 8 original detection rule categories
const detectionCategories = [
  'Stuck loop',
  'Missing artifacts',
  'Abandoned work',
  'Time gaps',
  'Failed tasks',
  'Orphaned specs',
  'Incomplete reviews',
  'Revert patterns',
];
detectionCategories.forEach(cat => {
  assert(
    content.includes(cat),
    `Contains detection rule category: "${cat}"`
  );
});

// ============================================================
// Test Group 3: FRN-01 Severity Scoring (7 tests)
// ============================================================
console.log('\nTest Group 3: FRN-01 Severity Scoring');
assert(
  content.includes('Step 4a: Severity Escalation') || content.includes('#### Step 4a'),
  'Contains Step 4a: Severity Escalation'
);
assert(
  content.includes('Step 4b: Impact Assessment') || content.includes('#### Step 4b'),
  'Contains Step 4b: Impact Assessment'
);
assert(
  content.includes('Step 4c: Affected Components') || content.includes('#### Step 4c'),
  'Contains Step 4c: Affected Components'
);
assert(
  content.includes('Blocks active work'),
  'Contains escalation factor: "Blocks active work"'
);
assert(
  content.includes('Multi-phase impact'),
  'Contains escalation factor: "Multi-phase impact"'
);
assert(
  content.includes('Cap at CRITICAL'),
  'Contains escalation cap: "Cap at CRITICAL"'
);
assert(
  lowerContent.includes('affected components list') || lowerContent.includes('affected components'),
  'Contains affected components in anomaly record description'
);

// ============================================================
// Test Group 4: FRN-02 Cross-Phase Dependency Tracing (6 tests)
// ============================================================
console.log('\nTest Group 4: FRN-02 Cross-Phase Dependency Tracing');
assert(
  content.includes('Step 4.5: Cross-Phase Dependency Tracing') || content.includes('### Step 4.5'),
  'Contains Step 4.5: Cross-Phase Dependency Tracing'
);
assert(
  content.includes('4.5a'),
  'Contains sub-step 4.5a (identify anomalous phase)'
);
assert(
  content.includes('4.5b'),
  'Contains sub-step 4.5b (read phase dependency history)'
);
assert(
  content.includes('4.5c'),
  'Contains sub-step 4.5c (scan git history)'
);
assert(
  content.includes('4.5d'),
  'Contains sub-step 4.5d (build causal chain)'
);
assert(
  content.includes('4.5e'),
  'Contains sub-step 4.5e (evidence quality assessment)'
);

// ============================================================
// Test Group 5: FRN-03 Rollback Path Generation (6 tests)
// ============================================================
console.log('\nTest Group 5: FRN-03 Rollback Path Generation');
assert(
  content.includes('Step 4.6: Rollback Path Generation') || content.includes('### Step 4.6'),
  'Contains Step 4.6: Rollback Path Generation'
);
assert(
  content.includes('4.6a'),
  'Contains sub-step 4.6a (path generation rules)'
);
assert(
  content.includes('4.6b'),
  'Contains sub-step 4.6b (confidence scoring)'
);
assert(
  content.includes('4.6c'),
  'Contains sub-step 4.6c (risk assessment)'
);
assert(
  content.includes('4.6d'),
  'Contains sub-step 4.6d (ordering)'
);
assert(
  lowerContent.includes('safest') && lowerContent.includes('aggressive'),
  'Contains path ordering terms: "safest" and "aggressive"'
);

// ============================================================
// Test Group 6: Enhanced Report Template (7 tests)
// ============================================================
console.log('\nTest Group 6: Enhanced Report Template');
assert(
  content.includes('Severity Summary'),
  'Contains "Severity Summary" section heading'
);
assert(
  content.includes('Anomalies (severity-sorted)'),
  'Contains "Anomalies (severity-sorted)" section heading'
);
assert(
  content.includes('Dependency Chain'),
  'Contains "Dependency Chain" section heading'
);
assert(
  content.includes('Rollback Matrix'),
  'Contains "Rollback Matrix" section heading'
);
assert(
  content.includes('Root Cause Assessment'),
  'Contains "Root Cause Assessment" section heading'
);
assert(
  content.includes('Recovery Suggestions'),
  'Contains "Recovery Suggestions" section heading'
);
assert(
  content.includes('Escalation Factors') && content.includes('Base Severity'),
  'Contains "Escalation Factors" and "Base Severity" in anomaly template'
);

// ============================================================
// Test Group 7: Enhanced Presentation - Step 6 (4 tests)
// ============================================================
console.log('\nTest Group 7: Enhanced Presentation (Step 6)');
assert(
  /critical.*high.*medium.*low/i.test(content),
  'Contains severity breakdown pattern (critical, high, medium, low)'
);
assert(
  content.includes('View dependency chain'),
  'Contains menu option: "View dependency chain"'
);
assert(
  content.includes('View rollback options'),
  'Contains menu option: "View rollback options"'
);
assert(
  content.includes('View full report'),
  'Contains preserved menu option: "View full report"'
);

// ============================================================
// Test Group 8: Step ordering (2 tests)
// ============================================================
console.log('\nTest Group 8: Step ordering');
const step4Pos = content.indexOf('### Step 4:');
const step45Pos = content.indexOf('Step 4.5');
const step46Pos = content.indexOf('Step 4.6');
const step5Pos = content.indexOf('### Step 5:');

assert(
  step4Pos >= 0 && step45Pos >= 0 && step5Pos >= 0 &&
  step45Pos > step4Pos && step45Pos < step5Pos,
  'Step 4.5 appears AFTER Step 4 and BEFORE Step 5'
);
assert(
  step45Pos >= 0 && step46Pos >= 0 && step5Pos >= 0 &&
  step46Pos > step45Pos && step46Pos < step5Pos,
  'Step 4.6 appears AFTER Step 4.5 and BEFORE Step 5'
);

// ============================================================
// Test Group 9: Read-only constraint preserved (1 test)
// ============================================================
console.log('\nTest Group 9: Read-only constraint preserved');
assert(
  lowerContent.includes('read-only'),
  'Contains "read-only" constraint documentation'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
