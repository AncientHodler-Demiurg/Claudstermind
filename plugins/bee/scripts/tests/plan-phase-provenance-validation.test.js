#!/usr/bin/env node
// Test: plan-phase.md contains a post-processing provenance validation step
// after ecosystem research that counts tags in RESEARCH.md, computes coverage
// ratio, warns if below 70%, and does not block planning.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(__dirname, '..', '..', 'commands', 'plan-phase.md');

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

// Read plan-phase.md
let content;
try {
  content = fs.readFileSync(CMD_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: plan-phase.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const contentLower = content.toLowerCase();

// ============================================================
// Test 1: plan-phase.md exists
// ============================================================
console.log('Test 1: plan-phase.md exists');
assert(
  content.length > 0,
  'plan-phase.md exists at plugins/bee/commands/plan-phase.md'
);

// ============================================================
// Test 2: plan-phase.md contains "provenance" at least twice
// ============================================================
console.log('\nTest 2: Contains "provenance" at least twice');
const provenanceMatches = contentLower.match(/provenance/g) || [];
assert(
  provenanceMatches.length >= 2,
  `plan-phase.md contains "provenance" at least twice (found ${provenanceMatches.length})`
);

// ============================================================
// Test 3: plan-phase.md contains Provenance Validation step heading
// ============================================================
console.log('\nTest 3: Provenance Validation step heading');
assert(
  content.includes('Provenance Validation') ||
  content.includes('provenance validation') ||
  content.includes('Post-Research Provenance'),
  'plan-phase.md contains a step labeled "Provenance Validation" or "Post-Research Provenance"'
);

// ============================================================
// Test 4: grep command counting [VERIFIED] tags
// ============================================================
console.log('\nTest 4: grep for [VERIFIED] tags');
assert(
  content.includes('\\[VERIFIED') || content.includes('[VERIFIED'),
  'plan-phase.md contains a grep command counting [VERIFIED] tags in RESEARCH.md'
);

// ============================================================
// Test 5: grep command counting [CITED] tags
// ============================================================
console.log('\nTest 5: grep for [CITED] tags');
assert(
  content.includes('\\[CITED') || content.includes('[CITED'),
  'plan-phase.md contains a grep command counting [CITED] tags in RESEARCH.md'
);

// ============================================================
// Test 6: grep command counting [ASSUMED] tags
// ============================================================
console.log('\nTest 6: grep for [ASSUMED] tags');
assert(
  content.includes('\\[ASSUMED') || content.includes('[ASSUMED'),
  'plan-phase.md contains a grep command counting [ASSUMED] tags in RESEARCH.md'
);

// ============================================================
// Test 7: coverage ratio calculation
// ============================================================
console.log('\nTest 7: Coverage ratio calculation');
assert(
  contentLower.includes('coverage ratio') ||
  contentLower.includes('coverage_ratio') ||
  contentLower.includes('evidence-backed') ||
  (contentLower.includes('verified') && contentLower.includes('cited') && contentLower.includes('percentage')),
  'plan-phase.md references a coverage ratio calculation (verified+cited vs total)'
);

// ============================================================
// Test 8: 70% threshold or warning condition
// ============================================================
console.log('\nTest 8: 70% threshold');
assert(
  content.includes('70') &&
  (contentLower.includes('coverage') || contentLower.includes('threshold') || contentLower.includes('warning')),
  'plan-phase.md contains a 70% threshold for low coverage warning'
);

// ============================================================
// Test 9: provenance summary display
// ============================================================
console.log('\nTest 9: Provenance summary display');
assert(
  (contentLower.includes('provenance summary') || contentLower.includes('research provenance')) &&
  (contentLower.includes('verified') && contentLower.includes('cited') && contentLower.includes('assumed')),
  'plan-phase.md presents a provenance summary to the user with tag counts'
);

// ============================================================
// Test 10: conditional on $RESEARCH_PATH being set
// ============================================================
console.log('\nTest 10: Conditional on $RESEARCH_PATH');
// The provenance validation section should reference RESEARCH_PATH as a condition
const provenanceSection = content.substring(
  content.indexOf('Post-Research Provenance') !== -1
    ? content.indexOf('Post-Research Provenance')
    : content.indexOf('Provenance Validation') !== -1
      ? content.indexOf('Provenance Validation')
      : 0
);
assert(
  provenanceSection.includes('RESEARCH_PATH') &&
  (provenanceSection.includes('is set') || provenanceSection.includes('not null') || provenanceSection.includes('$RESEARCH_PATH')),
  'plan-phase.md provenance validation is conditional on $RESEARCH_PATH being set'
);

// ============================================================
// Test 11: ordering -- provenance validation AFTER researcher, BEFORE 2.5.2
// ============================================================
console.log('\nTest 11: Ordering -- after researcher completion, before Step 2.5.2');
const researcherCompletionPos = content.indexOf('Verify RESEARCH.md was created');
const provenancePos = Math.max(
  content.indexOf('Post-Research Provenance'),
  content.indexOf('Provenance Validation') !== -1 && content.indexOf('2.5.1b') !== -1
    ? content.indexOf('2.5.1b')
    : -1
);
const step252Pos = content.indexOf('#### 2.5.2');
assert(
  researcherCompletionPos !== -1 &&
  provenancePos !== -1 &&
  step252Pos !== -1 &&
  provenancePos > researcherCompletionPos &&
  provenancePos < step252Pos,
  'Provenance validation occurs AFTER researcher completion AND BEFORE Step 2.5.2'
);

// ============================================================
// Test 12: does NOT block planning on low coverage
// ============================================================
console.log('\nTest 12: Does not block planning');
const provenanceSectionFull = provenancePos !== -1
  ? content.substring(provenancePos, step252Pos !== -1 ? step252Pos : content.length)
  : '';
assert(
  (provenanceSectionFull.toLowerCase().includes('warning only') ||
   provenanceSectionFull.toLowerCase().includes('do not block') ||
   provenanceSectionFull.toLowerCase().includes('proceed') ||
   provenanceSectionFull.toLowerCase().includes('informational')) &&
  !(provenanceSectionFull.toLowerCase().includes('stop planning') ||
    provenanceSectionFull.toLowerCase().includes('abort planning')),
  'plan-phase.md provenance validation does NOT block planning on low coverage (warns only)'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
