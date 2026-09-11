#!/usr/bin/env node
// Test: requirements.md template uses checkbox format for Functional Requirements,
// Non-Functional Requirements, and In Scope items. Out of Scope remains plain bullets.
// All other sections remain unchanged.

const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(
  __dirname, '..', '..', 'skills', 'core', 'templates', 'requirements.md'
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
  content = fs.readFileSync(TEMPLATE_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: requirements.md does not exist at expected path');
  console.log(`  Expected: ${TEMPLATE_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: Functional Requirements use checkbox format
// ============================================================
console.log('Test 1: Functional Requirements checkboxes');
const funcReqContent = sectionContent('### Functional Requirements', content);
assert(
  funcReqContent.includes('- [ ]'),
  'Functional Requirements bullets use - [ ] checkbox format'
);
assert(
  !funcReqContent.match(/^- [^[]/m),
  'No plain bullets (without checkboxes) in Functional Requirements'
);

// ============================================================
// Test 2: Non-Functional Requirements use checkbox format
// ============================================================
console.log('\nTest 2: Non-Functional Requirements checkboxes');
const nonFuncReqContent = sectionContent('### Non-Functional Requirements', content);
assert(
  nonFuncReqContent.includes('- [ ]'),
  'Non-Functional Requirements bullets use - [ ] checkbox format'
);
assert(
  !nonFuncReqContent.match(/^- [^[]/m),
  'No plain bullets (without checkboxes) in Non-Functional Requirements'
);

// ============================================================
// Test 3: In Scope items use checkbox format
// ============================================================
console.log('\nTest 3: Scope Boundaries - In Scope checkboxes');
const scopeContent = sectionContent('### Scope Boundaries', content);
assert(
  scopeContent.includes('In Scope'),
  'Scope Boundaries section contains In Scope label'
);
// In Scope items should have checkboxes
const inScopeIdx = scopeContent.indexOf('In Scope');
const outOfScopeIdx = scopeContent.indexOf('Out of Scope');
const inScopeContent = (outOfScopeIdx > -1)
  ? scopeContent.substring(inScopeIdx, outOfScopeIdx)
  : scopeContent.substring(inScopeIdx);
assert(
  inScopeContent.includes('- [ ]'),
  'In Scope items use - [ ] checkbox format'
);

// ============================================================
// Test 4: Out of Scope items remain plain bullets (no checkboxes)
// ============================================================
console.log('\nTest 4: Scope Boundaries - Out of Scope plain bullets');
assert(
  scopeContent.includes('Out of Scope'),
  'Scope Boundaries section contains Out of Scope label'
);
const outOfScopeContent = (outOfScopeIdx > -1)
  ? scopeContent.substring(outOfScopeIdx)
  : '';
assert(
  !outOfScopeContent.includes('- [ ]'),
  'Out of Scope items do NOT use checkbox format'
);
assert(
  outOfScopeContent.includes('- {') || outOfScopeContent.match(/^- /m),
  'Out of Scope items use plain bullet format'
);

// ============================================================
// Test 5: Other sections remain unchanged
// ============================================================
console.log('\nTest 5: Other sections unchanged');
assert(
  content.includes('# Requirements: {SPEC_NAME}'),
  'Title remains unchanged'
);
assert(
  content.includes('## Initial Description'),
  'Initial Description section present'
);
assert(
  content.includes('## Requirements Discussion'),
  'Requirements Discussion section present'
);
assert(
  content.includes('### Questions & Answers'),
  'Questions & Answers subsection present'
);
assert(
  content.includes('### Existing Code to Reference'),
  'Existing Code to Reference subsection present'
);
assert(
  content.includes('## Visual Assets'),
  'Visual Assets section present'
);
assert(
  content.includes('## Requirements Summary'),
  'Requirements Summary section present'
);
assert(
  content.includes('### Reusability Opportunities'),
  'Reusability Opportunities subsection present (plain bullets)'
);
assert(
  content.includes('### Technical Considerations'),
  'Technical Considerations subsection present (plain bullets)'
);

// Reusability Opportunities should NOT have checkboxes
const reusabilityContent = sectionContent('### Reusability Opportunities', content);
assert(
  !reusabilityContent.includes('- [ ]'),
  'Reusability Opportunities does NOT use checkbox format'
);

// Technical Considerations should NOT have checkboxes
const techContent = sectionContent('### Technical Considerations', content);
assert(
  !techContent.includes('- [ ]'),
  'Technical Considerations does NOT use checkbox format'
);

// ============================================================
// Test 6: Template is valid markdown (basic structural checks)
// ============================================================
console.log('\nTest 6: Valid markdown structure');
assert(
  content.startsWith('#'),
  'Template starts with a markdown heading'
);
// Check no broken heading syntax
const headings = content.match(/^#+\s/gm);
assert(
  headings && headings.length >= 8,
  'Template has at least 8 markdown headings (structure intact)'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
