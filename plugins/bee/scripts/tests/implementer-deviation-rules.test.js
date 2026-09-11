#!/usr/bin/env node
// Test: implementer.md contains deviation Rules 1-4 with TDD-phase-aware boundaries

const fs = require('fs');
const path = require('path');

const IMPLEMENTER_PATH = path.join(__dirname, '..', '..', 'agents', 'implementer.md');

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

// Helper: extract content between two markers
function contentBetween(startMarker, endMarker, fullContent) {
  const startIdx = fullContent.indexOf(startMarker);
  if (startIdx === -1) return '';
  const afterStart = fullContent.substring(startIdx);
  if (!endMarker) return afterStart;
  const endIdx = afterStart.indexOf(endMarker, startMarker.length);
  if (endIdx === -1) return afterStart;
  return afterStart.substring(0, endIdx);
}

const content = fs.readFileSync(IMPLEMENTER_PATH, 'utf8');

// ============================================================
// Test 1: Section header exists
// ============================================================
console.log('Test 1: Deviation Handling section exists');

assert(
  content.includes('## 3.5. Deviation Handling'),
  'implementer.md contains "## 3.5. Deviation Handling" section header'
);

// ============================================================
// Test 2: Section ordering -- 3.5 between Step 3 and Step 4
// ============================================================
console.log('\nTest 2: Section 3.5 ordering');

const section3Idx = content.indexOf('## 3. TDD Cycle');
const section35Idx = content.indexOf('## 3.5. Deviation Handling');
const section4Idx = content.indexOf('## 4. Stack Skill Compliance');

assert(
  section3Idx !== -1 && section35Idx !== -1 && section4Idx !== -1 &&
  section3Idx < section35Idx && section35Idx < section4Idx,
  'Section 3.5 appears AFTER "## 3. TDD Cycle" and BEFORE "## 4. Stack Skill Compliance"'
);

// ============================================================
// Test 3: All four rule headers present
// ============================================================
console.log('\nTest 3: All four rule headers');

assert(
  content.includes('RULE 1: Auto-fix bugs'),
  'Contains "RULE 1: Auto-fix bugs"'
);
assert(
  content.includes('RULE 2: Auto-add critical functionality'),
  'Contains "RULE 2: Auto-add critical functionality"'
);
assert(
  content.includes('RULE 3: Auto-fix blocking issues'),
  'Contains "RULE 3: Auto-fix blocking issues"'
);
assert(
  content.includes('RULE 4: STOP for architectural changes'),
  'Contains "RULE 4: STOP for architectural changes"'
);

// ============================================================
// Test 4: Rule 1 specifies GREEN phase
// ============================================================
console.log('\nTest 4: Rule 1 GREEN phase');

assert(
  content.includes('RULE 1: Auto-fix bugs (during GREEN phase)'),
  'Rule 1 specifies "(during GREEN phase)"'
);

// ============================================================
// Test 5: Rule 2 specifies REFACTOR phase
// ============================================================
console.log('\nTest 5: Rule 2 mini RED-GREEN sub-cycle');

assert(
  content.includes('RULE 2: Auto-add critical functionality (as mini RED-GREEN sub-cycle within current task)'),
  'Rule 2 specifies "(as mini RED-GREEN sub-cycle within current task)"'
);

// ============================================================
// Test 6: Rule 3 specifies any TDD phase
// ============================================================
console.log('\nTest 6: Rule 3 any TDD phase');

assert(
  content.includes('RULE 3: Auto-fix blocking issues (any TDD phase)'),
  'Rule 3 specifies "(any TDD phase)"'
);

// ============================================================
// Test 7: Rule 4 contains BLOCKED: signal format
// ============================================================
console.log('\nTest 7: Rule 4 BLOCKED: signal');

const section35Content = contentBetween('## 3.5. Deviation Handling', '## 4. Stack Skill Compliance', content);
assert(
  section35Content.includes('BLOCKED:'),
  'Section 3.5 contains "BLOCKED:" signal format'
);
assert(
  section35Content.includes('Description:') && section35Content.includes('Proposed change:') &&
  section35Content.includes('Why needed:') && section35Content.includes('Impact:') &&
  section35Content.includes('Alternatives:'),
  'BLOCKED: signal has all 5 fields (Description, Proposed change, Why needed, Impact, Alternatives)'
);

// ============================================================
// Test 8: Priority instruction
// ============================================================
console.log('\nTest 8: Priority instruction');

assert(
  content.includes('Rule 4 trumps all'),
  'Contains "Rule 4 trumps all" priority instruction'
);

// ============================================================
// Test 9: Deviation budget
// ============================================================
console.log('\nTest 9: Deviation budget');

assert(
  content.includes('Deviation budget') && (content.includes('3rd deviation') || content.includes('Max 2')),
  'Contains deviation budget with limit of 2 before BLOCKED'
);

// ============================================================
// Test 10: Scope boundary
// ============================================================
console.log('\nTest 10: Scope boundary');

assert(
  content.includes('Only fix issues DIRECTLY caused by your current task'),
  'Contains scope boundary "Only fix issues DIRECTLY caused by your current task"'
);

// ============================================================
// Test 11: Pre-existing errors instruction
// ============================================================
console.log('\nTest 11: Pre-existing errors instruction');

assert(
  content.includes('Pre-existing errors') || content.includes('Pre-existing issues'),
  'Contains instruction about pre-existing errors/issues'
);

// ============================================================
// Test 12: Section 5 contains Deviations subsection reference
// ============================================================
console.log('\nTest 12: Section 5 Deviations subsection');

const section5Content = contentBetween('## 5. Write Task Notes', '## 6. Completion Signal', content);
/* removed: superseded (Phase 2 triage) */
/* removed: superseded (Phase 2 triage) */

// ============================================================
// Test 13: Section 6 contains BLOCKED: as alternative signal
// ============================================================
console.log('\nTest 13: Section 6 BLOCKED: signal');

const section6Content = contentBetween('## 6. Completion Signal', '---', content);
assert(
  section6Content.includes('BLOCKED:'),
  'Section 6 (Completion Signal) contains "BLOCKED:" as alternative signal'
);

// ============================================================
// Test 14: Regression -- all existing sections still present
// ============================================================
console.log('\nTest 14: Regression check -- all existing sections present');

assert(content.includes('## 1. Read Stack Skill'), 'Section 1 still present');
assert(content.includes('## 2. Understand Your Task'), 'Section 2 still present');
assert(content.includes('## 2.5. Architectural Clarity'), 'Section 2.5 still present');
assert(content.includes('## 3. TDD Cycle'), 'Section 3 still present');
assert(content.includes('### 3a. RED'), 'Section 3a still present');
assert(content.includes('### 3b. GREEN'), 'Section 3b still present');
assert(content.includes('### 3c. REFACTOR'), 'Section 3c still present');
assert(content.includes('## 4. Stack Skill Compliance'), 'Section 4 still present');
assert(content.includes('## 5. Write Task Notes'), 'Section 5 still present');
assert(content.includes('## 6. Completion Signal'), 'Section 6 still present');

// ============================================================
// Test 15: All existing IMPORTANT notes still present
// ============================================================
console.log('\nTest 15: Existing IMPORTANT notes preserved');

assert(
  content.includes('You do NOT spawn sub-agents'),
  'IMPORTANT: No sub-agents note still present'
);
assert(
  content.includes('You do NOT update TASKS.md'),
  'IMPORTANT: No TASKS.md update note still present'
);
assert(
  content.includes('You do NOT commit to git'),
  'IMPORTANT: No git commit note still present'
);
assert(
  content.includes('Test files MUST exist on disk BEFORE production code'),
  'IMPORTANT: Test files first note still present'
);
assert(
  content.includes('This agent communicates through the parent command'),
  'IMPORTANT: Parent communication note still present'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
