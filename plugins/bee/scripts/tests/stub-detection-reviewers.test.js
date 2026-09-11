#!/usr/bin/env node
// Test: bug-detector.md and pattern-reviewer.md contain stub/hollow implementation detection

const fs = require('fs');
const path = require('path');

const BUG_DETECTOR_PATH = path.join(__dirname, '..', '..', 'agents', 'bug-detector.md');
const PATTERN_REVIEWER_PATH = path.join(__dirname, '..', '..', 'agents', 'pattern-reviewer.md');

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

const bugDetector = fs.readFileSync(BUG_DETECTOR_PATH, 'utf8');
const patternReviewer = fs.readFileSync(PATTERN_REVIEWER_PATH, 'utf8');

// ============================================================
// BUG-DETECTOR TESTS
// ============================================================
console.log('=== Bug Detector Tests ===');

// Test 1: Section header
console.log('\nTest 1: Stub detection section header');
assert(
  bugDetector.includes('### Stub / Hollow Implementation Detection') ||
  (bugDetector.includes('Stub') && bugDetector.includes('Hollow Implementation')),
  'bug-detector.md contains stub/hollow implementation detection section'
);

// Test 2: Stub patterns present
console.log('\nTest 2: Stub patterns');
assert(
  bugDetector.includes('= []') && bugDetector.includes('= {}') && bugDetector.includes('= null'),
  'bug-detector.md contains "= []", "= {}", "= null" patterns'
);
assert(
  bugDetector.includes('TODO') && bugDetector.includes('FIXME') && bugDetector.includes('XXX'),
  'bug-detector.md contains "TODO", "FIXME", "XXX" patterns'
);

// Test 3: Placeholder pattern
console.log('\nTest 3: Placeholder pattern');
assert(
  bugDetector.includes('placeholder'),
  'bug-detector.md contains "placeholder" pattern'
);

// Test 4: Empty catch blocks
console.log('\nTest 4: Empty catch blocks');
assert(
  bugDetector.includes('catch') && (bugDetector.includes('empty') || bugDetector.includes('Empty')),
  'bug-detector.md mentions empty catch blocks pattern'
);

// Test 5: Test file exclusion
console.log('\nTest 5: Test file exclusion');
assert(
  bugDetector.includes('.test.') && bugDetector.includes('.spec.') && bugDetector.includes('__tests__/'),
  'bug-detector.md contains ".test.", ".spec.", "__tests__/" exclusion'
);

// Test 6: WARNING severity
console.log('\nTest 6: WARNING severity');
assert(
  bugDetector.includes('WARNING'),
  'bug-detector.md contains "WARNING" severity level'
);

// Test 7: Output format
console.log('\nTest 7: Output format');
assert(
  bugDetector.includes('### Warning (Stubs)'),
  'bug-detector.md contains "### Warning (Stubs)" output format'
);

// Test 8: Existing sections still present (regression)
console.log('\nTest 8: Existing sections regression');
assert(bugDetector.includes('### Logic Errors'), 'bug-detector.md still has "### Logic Errors"');
assert(bugDetector.includes('### Null/Undefined Handling'), 'bug-detector.md still has "### Null/Undefined Handling"');
assert(bugDetector.includes('### Race Conditions'), 'bug-detector.md still has "### Race Conditions"');
assert(bugDetector.includes('### Security'), 'bug-detector.md still has "### Security"');
assert(bugDetector.includes('### Data Integrity'), 'bug-detector.md still has "### Data Integrity"');
assert(bugDetector.includes('### Edge Cases'), 'bug-detector.md still has "### Edge Cases"');

// ============================================================
// PATTERN-REVIEWER TESTS
// ============================================================
console.log('\n=== Pattern Reviewer Tests ===');

// Test 9: Section header
console.log('\nTest 9: Stub detection section');
assert(
  (patternReviewer.includes('Stub') && patternReviewer.includes('Hollow')) ||
  (patternReviewer.includes('stub') && patternReviewer.includes('hollow')),
  'pattern-reviewer.md contains stub/hollow detection section'
);

// Test 10: Stub patterns present
console.log('\nTest 10: Stub patterns');
assert(
  patternReviewer.includes('TODO') && patternReviewer.includes('FIXME') &&
  patternReviewer.includes('= []') && patternReviewer.includes('= {}'),
  'pattern-reviewer.md contains "TODO", "FIXME", "= []", "= {}" patterns'
);

// Test 11: Test file exclusion
console.log('\nTest 11: Test file exclusion');
assert(
  patternReviewer.includes('.test.') && patternReviewer.includes('.spec.') && patternReviewer.includes('__tests__/'),
  'pattern-reviewer.md contains ".test.", ".spec.", "__tests__/" exclusion'
);

// Test 12: WARNING severity
console.log('\nTest 12: WARNING severity');
assert(
  patternReviewer.includes('WARNING'),
  'pattern-reviewer.md contains "WARNING" severity level'
);

// Test 13: Existing sections still present (regression)
console.log('\nTest 13: Existing sections regression');
assert(
  patternReviewer.includes('### Step 1: Read False Positives'),
  'pattern-reviewer.md still has "### Step 1: Read False Positives"'
);
assert(
  patternReviewer.includes('### Step 4: Find Similar Existing Code'),
  'pattern-reviewer.md still has "### Step 4: Find Similar Existing Code"'
);
assert(
  patternReviewer.includes('### Step 5: Extract Patterns'),
  'pattern-reviewer.md still has "### Step 5: Extract Patterns"'
);
assert(
  patternReviewer.includes('### Step 6: Compare'),
  'pattern-reviewer.md still has "### Step 6: Compare"'
);

// ============================================================
// PATTERN REVIEWER DEAD-FIELD TESTS
// ============================================================
console.log('\n=== Pattern Reviewer Dead-Field Tests ===');

// Test 14: Dead-field detection heading present
console.log('\nTest 14: Dead-field detection heading');
assert(
  patternReviewer.includes('### Write-Only / Dead-Field Detection'),
  'pattern-reviewer.md contains "### Write-Only / Dead-Field Detection" heading'
);

// Test 15: Three named dead-data shapes present
console.log('\nTest 15: Three dead-data shapes named');
assert(
  patternReviewer.includes('COMPUTED-THEN-DISCARDED'),
  'pattern-reviewer.md names the "COMPUTED-THEN-DISCARDED" shape'
);
assert(
  patternReviewer.includes('PERSISTED-BUT-NEVER-READ'),
  'pattern-reviewer.md names the "PERSISTED-BUT-NEVER-READ" shape'
);
assert(
  patternReviewer.includes('RESERVED-NEVER-FILLED'),
  'pattern-reviewer.md names the "RESERVED-NEVER-FILLED" shape'
);

// Test 16: Dual-endpoint [CITED] evidence instruction present
console.log('\nTest 16: Dual-endpoint citation instruction');
assert(
  patternReviewer.includes('dual-endpoint') || patternReviewer.includes('DUAL-ENDPOINT'),
  'pattern-reviewer.md instructs a dual-endpoint citation trace'
);
assert(
  /grepp?ed for .* and found none/i.test(patternReviewer) ||
  patternReviewer.includes('found none'),
  'pattern-reviewer.md requires the absent-endpoint "grepped ... found none" evidence form'
);

// Test 16b: per-shape endpoint pairing — the load-bearing semantic (TASKS T4.2 acceptance:
// "the evidence model must generalize, not assume a single write->read pairing"). The most
// error-prone is RESERVED-NEVER-FILLED, whose absent endpoint is the WRITER, not the reader.
// A test that only checks the literals "dual-endpoint"/"found none" would stay green if the
// prose regressed to "absent reader" for all three shapes — so pin the per-shape pairing.
console.log('\nTest 16b: per-shape WRITER-vs-READER evidence pairing');
assert(
  /PERSISTED-BUT-NEVER-READ[\s\S]{0,160}absent READER/i.test(patternReviewer),
  'pattern-reviewer.md pairs PERSISTED-BUT-NEVER-READ with the absent READER grep'
);
assert(
  /RESERVED-NEVER-FILLED[\s\S]{0,260}absent WRITER/i.test(patternReviewer),
  'pattern-reviewer.md pairs RESERVED-NEVER-FILLED with the absent WRITER grep (not the reader)'
);

// Test 16c: string-addressed bag-keys — the dead-field detector must tell the reviewer that a
// media custom-property / EAV / JSON-bag key is reached by the KEY STRING, so the absent-endpoint
// grep targets the key string literal, not a symbolic reference. Without this the detector goes
// inert / false-positive on exactly the ocr_* custom-property case the spec was built to catch.
console.log('\nTest 16c: string-addressed bag-key grep instruction');
assert(
  patternReviewer.includes('KEY STRING') && patternReviewer.includes('getCustomProperty'),
  'pattern-reviewer.md instructs grepping the KEY STRING literal for string-addressed stores (media custom-properties / EAV)'
);

// Test 17: Forthcoming-consumer carve-out present
console.log('\nTest 17: Forthcoming-consumer carve-out');
assert(
  (patternReviewer.includes('forthcoming consumer') || patternReviewer.includes('FORTHCOMING-CONSUMER') || patternReviewer.includes('upcoming consumer')) &&
  patternReviewer.includes('later phase'),
  'pattern-reviewer.md states the forthcoming-consumer carve-out (skip when a later phase declares an upcoming consumer)'
);

// Test 18: Dead-field gating + test-file exclusion reused
console.log('\nTest 18: Dead-field gating and test-file exclusion');
assert(
  patternReviewer.includes('persisted or computed state') || patternReviewer.includes('persisted/computed state'),
  'pattern-reviewer.md gates the dead-field detector on new persisted/computed state to trace'
);
assert(
  /activates NO dead-field findings|SKIP this detector entirely|emit nothing/i.test(patternReviewer),
  'pattern-reviewer.md pins the SKIP/zero-noise branch (no new persisted/computed state => emit nothing)'
);

// Test 19: WARNING severity for dead-field findings (regression-adjacent)
console.log('\nTest 19: Dead-field WARNING severity');
assert(
  patternReviewer.includes('### Warning (Dead Fields)'),
  'pattern-reviewer.md frames dead-field findings as WARNING-level output'
);

// ============================================================
// Results
// ============================================================
// ============================================================
// Test 20 (Phase 3): dead-field symbolic branch admits findReferences as the
// absent-endpoint evidence, gated on config.lsp, with the string-addressed
// clause explicitly excluded from the branch (LSP cannot see string keys)
// ============================================================
console.log('\nTest 20: LSP symbolic branch (Rule 13) in the dead-field detector');
assert(
  patternReviewer.includes('SYMBOLIC IDENTIFIERS (Rule 13 branch)') &&
    patternReviewer.includes('config.lsp'),
  'Symbolic findReferences branch present and gated on config.lsp availability'
);
assert(
  /findReferences on X: zero references/.test(patternReviewer) &&
    /findReferences on X returned zero references/.test(patternReviewer),
  'Zero-result findReferences admitted as dual-endpoint CITED evidence (branch + evidence-form + template)'
);
assert(
  /NEVER use this branch/.test(patternReviewer),
  'String-addressed keys explicitly excluded from the LSP branch'
);
assert(
  patternReviewer.includes('I grepped for {consumers/writers} of X and found none'),
  'Grep evidence wording preserved verbatim (string-addressed/fallback standard unchanged)'
);

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
