#!/usr/bin/env node
// Test: Review quality rules are present in the review skill and all review agent prompts.
// Validates acceptance criteria from quick task 001-review-quality-rules.

const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = path.join(__dirname, '..', '..');
const SKILL_PATH = path.join(PLUGIN_DIR, 'skills', 'review', 'SKILL.md');
const REVIEW_CMD = path.join(PLUGIN_DIR, 'commands', 'review.md');
const REVIEW_IMPL_CMD = path.join(PLUGIN_DIR, 'commands', 'review-implementation.md');
const PLAN_PHASE_CMD = path.join(PLUGIN_DIR, 'commands', 'plan-phase.md');
const PLAN_REVIEW_CMD = path.join(PLUGIN_DIR, 'commands', 'plan-review.md');
const PLAN_ALL_CMD = path.join(PLUGIN_DIR, 'commands', 'plan-all.md');
const SHIP_CMD = path.join(PLUGIN_DIR, 'commands', 'ship.md');

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

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return null;
  }
}

// ============================================================
// Test 1: Review skill has "Review Quality Rules" section
// ============================================================
console.log('Test 1: Review skill has Review Quality Rules section');
const skillContent = readFile(SKILL_PATH);
assert(skillContent !== null, 'Review skill file exists');
assert(
  skillContent && skillContent.includes('## Review Quality Rules'),
  'Review skill contains "## Review Quality Rules" heading'
);
assert(
  skillContent && skillContent.includes('Same-Class Completeness'),
  'Review skill contains Same-Class Completeness rule'
);
assert(
  skillContent && skillContent.includes('Edge Case Enumeration'),
  'Review skill contains Edge Case Enumeration rule'
);
assert(
  skillContent && skillContent.includes('Crash-Path Tracing'),
  'Review skill contains Crash-Path Tracing rule'
);

// ============================================================
// Test 2: Review Quality Rules section is before Output Format
// ============================================================
console.log('\nTest 2: Review Quality Rules section placement');
if (skillContent) {
  const rulesIdx = skillContent.indexOf('## Review Quality Rules');
  const outputIdx = skillContent.indexOf('## Output Format');
  assert(
    rulesIdx !== -1 && outputIdx !== -1 && rulesIdx < outputIdx,
    'Review Quality Rules section appears before Output Format section'
  );
}

// ============================================================
// Test 3: Bug Detector quality rules on review.md's path (engine-owned since v4.7)
// review.md's agent prompts live in the shared review-pipeline engine; the
// contract is: engine carries the rules AND review.md routes through the engine.
// ============================================================
console.log('\nTest 3: Bug Detector quality rules on review.md path (review-pipeline engine)');
const ENGINE_PATH = path.join(PLUGIN_DIR, 'skills', 'review-pipeline', 'SKILL.md');
const engineContent = readFile(ENGINE_PATH);
const reviewContent = readFile(REVIEW_CMD);
assert(reviewContent !== null, 'review.md exists');
assert(engineContent !== null, 'review-pipeline engine skill exists');
assert(
  reviewContent && reviewContent.includes('skills/review-pipeline/SKILL.md'),
  'review.md routes its review pipeline through the engine skill'
);
assert(
  engineContent && engineContent.includes('same-class completeness'),
  'engine Bug Detector prompt has same-class completeness instruction'
);
assert(
  engineContent && engineContent.includes('edge case enumeration'),
  'engine Bug Detector prompt has edge case enumeration instruction'
);
assert(
  engineContent && engineContent.includes('crash-path tracing'),
  'engine Bug Detector prompt has crash-path tracing instruction'
);

// ============================================================
// Test 4: Pattern Reviewer quality rules on review.md's path (engine-owned)
// ============================================================
console.log('\nTest 4: Pattern Reviewer quality rules on review.md path (engine)');
assert(
  engineContent && engineContent.includes('Apply same-class completeness'),
  'engine Pattern Reviewer prompt has same-class completeness instruction'
);

// ============================================================
// Test 5: Bug Detector quality rules in review-implementation.md
// ============================================================
console.log('\nTest 5: Bug Detector quality rules in review-implementation.md');
let reviewImplContent = readFile(REVIEW_IMPL_CMD);
// v4.7: engine-routed — agent prompts live in the shared engine.
if (reviewImplContent && reviewImplContent.includes('skills/review-pipeline/SKILL.md')) {
  reviewImplContent = reviewImplContent + (engineContent || '');
}
assert(reviewImplContent !== null, 'review-implementation.md exists');
assert(
  reviewImplContent && reviewImplContent.includes('same-class completeness'),
  'review-implementation.md Bug Detector prompt has same-class completeness instruction'
);
assert(
  reviewImplContent && reviewImplContent.includes('edge case enumeration'),
  'review-implementation.md Bug Detector prompt has edge case enumeration instruction'
);
assert(
  reviewImplContent && reviewImplContent.includes('crash-path tracing'),
  'review-implementation.md Bug Detector prompt has crash-path tracing instruction'
);

// ============================================================
// Test 6: Pattern Reviewer quality rules in review-implementation.md
// ============================================================
console.log('\nTest 6: Pattern Reviewer quality rules in review-implementation.md');
assert(
  reviewImplContent && reviewImplContent.includes('Apply same-class completeness'),
  'review-implementation.md Pattern Reviewer prompt has same-class completeness instruction'
);

// ============================================================
// Test 7: Bug Detector quality rules in plan-phase.md
// ============================================================
console.log('\nTest 7: Bug Detector quality rules in plan-phase.md');
const planPhaseContent = readFile(PLAN_PHASE_CMD);
assert(planPhaseContent !== null, 'plan-phase.md exists');
assert(
  planPhaseContent && planPhaseContent.includes('same-class completeness'),
  'plan-phase.md Bug Detector prompt has same-class completeness instruction'
);

// ============================================================
// Test 8: Pattern Reviewer quality rules in plan-phase.md
// ============================================================
console.log('\nTest 8: Pattern Reviewer quality rules in plan-phase.md');
assert(
  planPhaseContent && planPhaseContent.includes('Apply same-class completeness'),
  'plan-phase.md Pattern Reviewer prompt has same-class completeness instruction'
);

// ============================================================
// Test 9: Bug Detector quality rules in plan-review.md
// ============================================================
console.log('\nTest 9: Bug Detector quality rules in plan-review.md');
const planReviewContent = readFile(PLAN_REVIEW_CMD);
assert(planReviewContent !== null, 'plan-review.md exists');
assert(
  planReviewContent && planReviewContent.includes('same-class completeness'),
  'plan-review.md Bug Detector prompt has same-class completeness instruction'
);

// ============================================================
// Test 10: Pattern Reviewer quality rules in plan-review.md
// ============================================================
console.log('\nTest 10: Pattern Reviewer quality rules in plan-review.md');
assert(
  planReviewContent && planReviewContent.includes('Apply same-class completeness'),
  'plan-review.md Pattern Reviewer prompt has same-class completeness instruction'
);

// ============================================================
// Test 11: Bug Detector quality rules in plan-all.md
// ============================================================
console.log('\nTest 11: Bug Detector quality rules in plan-all.md');
const planAllContent = readFile(PLAN_ALL_CMD);
assert(planAllContent !== null, 'plan-all.md exists');
assert(
  planAllContent && planAllContent.includes('same-class completeness'),
  'plan-all.md Bug Detector prompt has same-class completeness instruction'
);

// ============================================================
// Test 12: Pattern Reviewer quality rules in plan-all.md
// ============================================================
console.log('\nTest 12: Pattern Reviewer quality rules in plan-all.md');
assert(
  planAllContent && planAllContent.includes('Apply same-class completeness'),
  'plan-all.md Pattern Reviewer prompt has same-class completeness instruction'
);

// ============================================================
// Test 13: Bug Detector quality rules in ship.md
// ============================================================
console.log('\nTest 13: Bug Detector quality rules in ship.md');
let shipContent = readFile(SHIP_CMD);
// v4.7: engine-routed — agent prompts live in the shared engine.
if (shipContent && shipContent.includes('skills/review-pipeline/SKILL.md')) {
  shipContent = shipContent + (engineContent || '');
}
assert(shipContent !== null, 'ship.md exists');
assert(
  shipContent && shipContent.includes('same-class completeness'),
  'ship.md Bug Detector prompt has same-class completeness instruction'
);

// ============================================================
// Test 14: Pattern Reviewer quality rules in ship.md
// ============================================================
console.log('\nTest 14: Pattern Reviewer quality rules in ship.md');
assert(
  shipContent && shipContent.includes('Apply same-class completeness'),
  'ship.md Pattern Reviewer prompt has same-class completeness instruction'
);

// ============================================================
// Test 15: review-implementation.md references audit-bug-detector
// ============================================================
console.log('\nTest 15: review-implementation.md audit-bug-detector');
assert(
  reviewImplContent && reviewImplContent.includes('audit-bug-detector'),
  'review-implementation.md references audit-bug-detector agent'
);
assert(
  reviewImplContent && reviewImplContent.includes('end-to-end'),
  'review-implementation.md audit-bug-detector traces end-to-end flows'
);

// ============================================================
// Test 16: review-implementation.md agent count formula updated
// ============================================================
console.log('\nTest 16: review-implementation.md agent count formula');
assert(
  reviewImplContent && reviewImplContent.includes('(3 x N) + 2'),
  'review-implementation.md full spec mode agent count formula is (3 x N) + 2'
);

// ============================================================
// Test 17: review-implementation.md parses audit-bug-detector output
// ============================================================
console.log('\nTest 17: review-implementation.md audit-bug-detector parsing');
assert(
  reviewImplContent && reviewImplContent.includes('Bug Detection Summary') ||
  reviewImplContent && reviewImplContent.includes('audit-bug-detector') && reviewImplContent.includes('BUG-'),
  'review-implementation.md has parsing logic for audit-bug-detector output (BUG- prefix or Bug Detection Summary)'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
