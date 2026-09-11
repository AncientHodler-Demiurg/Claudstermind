#!/usr/bin/env node
// Test: generic implementer.md and fixer.md agents read CLAUDE.md

const fs = require('fs');
const path = require('path');

const IMPLEMENTER_PATH = path.join(
  __dirname, '..', '..', 'agents', 'implementer.md'
);
const FIXER_PATH = path.join(
  __dirname, '..', '..', 'agents', 'fixer.md'
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

// Helper: extract content between a section heading and the next same-level heading
function contentBetweenSections(sectionHeading, fullContent) {
  const startIdx = fullContent.indexOf(sectionHeading);
  if (startIdx === -1) return '';
  const afterHeading = fullContent.substring(startIdx + sectionHeading.length);
  // Determine heading level from the section heading
  const level = sectionHeading.match(/^#+/)[0];
  const regex = new RegExp(`\n${level} (?!#)`);
  const nextHeading = afterHeading.search(regex);
  if (nextHeading === -1) return afterHeading;
  return afterHeading.substring(0, nextHeading);
}

const implementerContent = fs.readFileSync(IMPLEMENTER_PATH, 'utf8');
const fixerContent = fs.readFileSync(FIXER_PATH, 'utf8');

// ============================================================
// Test 1: implementer.md Step 1 mentions CLAUDE.md
// ============================================================
console.log('Test 1: implementer.md Step 1 has CLAUDE.md sub-step');
const implStep1 = contentBetweenSections('## 1.', implementerContent);
assert(
  implStep1.toLowerCase().includes('claude.md'),
  'Step 1 mentions CLAUDE.md'
);
assert(
  implStep1.toLowerCase().includes('project root'),
  'Step 1 mentions checking at project root'
);
assert(
  implStep1.toLowerCase().includes('higher-priority') || implStep1.toLowerCase().includes('higher priority'),
  'Step 1 describes CLAUDE.md as higher-priority guidance'
);
assert(
  implStep1.toLowerCase().includes('read if present') || implStep1.toLowerCase().includes('read it'),
  'Step 1 says to read CLAUDE.md if present'
);

// ============================================================
// Test 2: implementer.md Step 4 has CLAUDE.md conventions bullet
// ============================================================
console.log('\nTest 2: implementer.md Step 4 has CLAUDE.md conventions bullet');
const implStep4 = contentBetweenSections('## 4.', implementerContent);
assert(
  implStep4.toLowerCase().includes('claude.md'),
  'Step 4 mentions CLAUDE.md'
);
assert(
  implStep4.toLowerCase().includes('conventions'),
  'Step 4 mentions CLAUDE.md conventions'
);
assert(
  implStep4.toLowerCase().includes('step 1'),
  'Step 4 references Step 1 for CLAUDE.md'
);

// ============================================================
// Test 3: fixer.md Step 1 has CLAUDE.md sub-step
// ============================================================
console.log('\nTest 3: fixer.md Step 1 has CLAUDE.md sub-step');
const fixerStep1 = contentBetweenSections('## 1.', fixerContent);
assert(
  fixerStep1.toLowerCase().includes('claude.md'),
  'Step 1 mentions CLAUDE.md'
);
assert(
  fixerStep1.toLowerCase().includes('project root'),
  'Step 1 mentions checking at project root'
);
assert(
  fixerStep1.toLowerCase().includes('higher-priority') || fixerStep1.toLowerCase().includes('higher priority'),
  'Step 1 describes CLAUDE.md as higher-priority guidance'
);
assert(
  fixerStep1.toLowerCase().includes('read if present') || fixerStep1.toLowerCase().includes('read it'),
  'Step 1 says to read CLAUDE.md if present'
);

// ============================================================
// Test 4: TDD cycle steps in implementer.md are unchanged
// ============================================================
console.log('\nTest 4: implementer.md TDD cycle steps are unchanged');
assert(
  implementerContent.includes('## 3. TDD Cycle (MANDATORY'),
  'TDD Cycle heading preserved (with or without applicability qualifier)'
);
assert(
  implementerContent.includes('### 3a. RED -- Write Failing Tests'),
  'RED step preserved'
);
assert(
  implementerContent.includes('### 3b. GREEN -- Minimal Implementation'),
  'GREEN step preserved'
);
assert(
  implementerContent.includes('### 3c. REFACTOR -- Clean Up (if needed)'),
  'REFACTOR step preserved'
);

// ============================================================
// Test 5: Completion signal in implementer.md is unchanged
// ============================================================
console.log('\nTest 5: implementer.md completion signal unchanged');
assert(
  implementerContent.includes('Task complete. [X] tests passing.'),
  'Completion signal preserved'
);

// ============================================================
// Test 6: implementer.md Step 4 has exactly 5 bullets (original 4 + CLAUDE.md)
// ============================================================
console.log('\nTest 6: implementer.md Step 4 has 5 bullets');
const implStep4Lines = implStep4.split('\n').filter(l => l.match(/^- /));
assert(
  implStep4Lines.length === 5,
  `Step 4 has 5 bullet points (found ${implStep4Lines.length})`
);

// ============================================================
// Test 7: implementer.md preserves all original Step 4 bullets
// ============================================================
console.log('\nTest 7: implementer.md Step 4 preserves original bullets');
assert(
  implStep4.includes('Naming conventions'),
  'Original bullet: Naming conventions preserved'
);
assert(
  implStep4.includes('Directory structure'),
  'Original bullet: Directory structure preserved'
);
assert(
  implStep4.includes('Import patterns'),
  'Original bullet: Import patterns preserved'
);
assert(
  implStep4.includes('Framework-specific best practices'),
  'Original bullet: Framework-specific best practices preserved'
);

// ============================================================
// Test 8: No unintended modifications to other sections
// ============================================================
console.log('\nTest 8: No unintended modifications');
/* removed: superseded (Phase 2 triage) */
assert(
  implementerContent.includes('## 2. Understand Your Task'),
  'implementer.md: Step 2 preserved'
);
assert(
  implementerContent.includes('## 5. Write Task Notes (MANDATORY)'),
  'implementer.md: Step 5 preserved'
);
assert(
  implementerContent.includes('## 6. Completion Signal'),
  'implementer.md: Step 6 preserved'
);
/* removed: superseded (Phase 2 triage) */
assert(
  fixerContent.includes('## 2. Understand the Finding'),
  'fixer.md: Step 2 preserved'
);
assert(
  fixerContent.includes('## 6. Report Fix'),
  'fixer.md: Step 6 preserved'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
