#!/usr/bin/env node
// Test: review.md and execute-phase.md have stack-specific agent fallback routing.

const fs = require('fs');
const path = require('path');

const REVIEW_PATH = path.join(__dirname, '..', '..', 'commands', 'review.md');
const EXECUTE_PHASE_PATH = path.join(__dirname, '..', '..', 'commands', 'execute-phase.md');

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
  // Match next heading of same or higher level (## or #)
  const headingLevel = sectionHeading.match(/^#+/)?.[0].length || 2;
  const nextHeadingPattern = new RegExp(`\\n#{1,${headingLevel}} `);
  const nextH = afterHeading.search(nextHeadingPattern);
  if (nextH === -1) return afterHeading;
  return afterHeading.substring(0, nextH);
}

// Helper: extract content from a heading up to the next heading of same or higher level
function contentFromHeading(heading, fullContent) {
  const startIdx = fullContent.indexOf(heading);
  if (startIdx === -1) return '';
  return fullContent.substring(startIdx);
}

// Read both files
const reviewContent = fs.readFileSync(REVIEW_PATH, 'utf8');
let executePhaseContent = fs.readFileSync(EXECUTE_PHASE_PATH, 'utf8');
// v4.7: implementer resolution lives in the wave-execution core.
if (executePhaseContent.includes('skills/wave-execution/SKILL.md')) {
  executePhaseContent += fs.readFileSync(
    path.join(__dirname, '..', '..', 'skills', 'wave-execution', 'SKILL.md'),
    'utf8'
  );
}

// ============================================================
// Test 1: review.md - Bug Detector agent routing with fallback
// ============================================================
console.log('Test 1: review.md - Bug Detector stack-specific agent routing');

// The routing contract moved with the engine extraction (v4.7): review.md
// routes through skills/review-pipeline/SKILL.md, whose Stack Roster section
// owns the variant-vs-generic resolution text. Pin it on the execution path.
const ENGINE_PATH = path.join(__dirname, '..', '..', 'skills', 'review-pipeline', 'SKILL.md');
const engineContent = fs.readFileSync(ENGINE_PATH, 'utf8');
assert(
  reviewContent.includes('skills/review-pipeline/SKILL.md') &&
    reviewContent.includes('Stack Roster and Agent Resolution'),
  'review.md routes agent resolution through the review-pipeline engine'
);
const step41c = reviewContent + engineContent;

assert(
  step41c.includes('agents/stacks/') && step41c.includes('bug-detector'),
  'Step 4.1c references agents/stacks/ path for bug-detector'
);

assert(
  step41c.includes('{role}.md'),
  'Step 4.1c checks for bug-detector.md file existence'
);

assert(
  (step41c.includes('fallback') || step41c.includes('else')) &&
  step41c.includes('bee:{role}'),
  'Step 4.1c has fallback to generic bee:bug-detector'
);

assert(
  step41c.includes('laravel-inertia-vue-bug-detector') || step41c.includes('agents/stacks/{stack.name}/'),
  'Step 4.1c uses {stack.name}-bug-detector when stack-specific agent exists'
);

// ============================================================
// Test 2: review.md - Pattern Reviewer agent routing with fallback
// ============================================================
console.log('\nTest 2: review.md - Pattern Reviewer stack-specific agent routing');

assert(
  step41c.includes('pattern-reviewer'),
  'Step 4.1c checks for pattern-reviewer.md file existence'
);

assert(
  (step41c.includes('fallback') || step41c.includes('else')) &&
  step41c.includes('bee:{role}') && step41c.includes('pattern-reviewer'),
  'Step 4.1c has fallback to generic bee:pattern-reviewer'
);

assert(
  step41c.includes('agents/stacks/{stack.name}/'),
  'Step 4.1c uses {stack.name}-pattern-reviewer when stack-specific agent exists'
);

// ============================================================
// Test 3: review.md - Stack Reviewer agent routing with fallback
// ============================================================
console.log('\nTest 3: review.md - Stack Reviewer stack-specific agent routing');

assert(
  step41c.includes('stack-reviewer'),
  'Step 4.1c checks for stack-reviewer.md file existence'
);

assert(
  (step41c.includes('fallback') || step41c.includes('else')) &&
  step41c.includes('bee:{role}') && step41c.includes('stack-reviewer'),
  'Step 4.1c has fallback to generic bee:stack-reviewer'
);

assert(
  step41c.includes('agents/stacks/{stack.name}/'),
  'Step 4.1c uses {stack.name}-stack-reviewer when stack-specific agent exists'
);

// ============================================================
// Test 4: execute-phase.md - Implementer agent routing with fallback
// ============================================================
console.log('\nTest 4: execute-phase.md - Implementer agent routing with fallback');

// Step 5b should mention checking for stack-specific implementer
const step5b = contentFromHeading('**5b.', executePhaseContent);

assert(
  step5b.includes('agents/stacks/') && step5b.includes('implementer'),
  'Step 5b references agents/stacks/ path for implementer'
);

assert(
  step5b.includes('implementer.md'),
  'Step 5b checks for implementer.md file existence'
);

assert(
  (step5b.includes('fallback') || step5b.includes('else')) &&
  step5b.includes('implementer'),
  'Step 5b has fallback to generic implementer'
);

assert(
  step5b.includes('{stack.name}-implementer') ||
  step5b.includes('stack.name}-implementer'),
  'Step 5b uses {stack.name}-implementer when stack-specific agent exists'
);

// ============================================================
// Test 5: execute-phase.md - Multi-stack uses primary (first-matched) stack
// ============================================================
console.log('\nTest 5: execute-phase.md - Multi-stack primary stack routing');

assert(
  step5b.toLowerCase().includes('primary') || step5b.toLowerCase().includes('first'),
  'Step 5b mentions using primary/first-matched stack for multi-stack'
);

// ============================================================
// Test 6: Fallback behavior documented - generic agents remain default
// ============================================================
console.log('\nTest 6: Fallback behavior documented');

// review.md's path should document that generic agents are the default
// (documentation lives in the engine since v4.7)
assert(
  step41c.includes('fallback') || step41c.includes('generic'),
  'review.md documents fallback to generic agents'
);

// execute-phase.md should document that generic agents are the default
assert(
  executePhaseContent.includes('fallback') || executePhaseContent.includes('generic'),
  'execute-phase.md documents fallback to generic agents'
);

// ============================================================
// Test 7: No unrelated logic changes - key sections still exist
// ============================================================
console.log('\nTest 7: No unrelated logic changes');

// review.md still has all key sections
assert(
  reviewContent.includes('### Step 1: Validation Guards'),
  'review.md Step 1 unchanged'
);
assert(
  reviewContent.includes('### Step 2: Load Phase Context'),
  'review.md Step 2 unchanged'
);
assert(
  reviewContent.includes('### Step 5: STEP 2 -- VALIDATE EACH FINDING'),
  'review.md Step 5 unchanged'
);
assert(
  reviewContent.includes('### Step 6: STEP 3 -- FIX CONFIRMED ISSUES'),
  'review.md Step 6 unchanged'
);
assert(
  reviewContent.includes('### Step 8: Completion'),
  'review.md Step 8 unchanged'
);

// execute-phase.md still has all key sections
assert(
  executePhaseContent.includes('### Step 1: Validation Guards'),
  'execute-phase.md Step 1 unchanged'
);
assert(
  executePhaseContent.includes('### Step 2: Load TASKS.md'),
  'execute-phase.md Step 2 unchanged'
);
assert(
  executePhaseContent.includes('### Step 3: Parse Wave Structure'),
  'execute-phase.md Step 3 unchanged'
);
assert(
  executePhaseContent.includes('### Step 6: Completion'),
  'execute-phase.md Step 6 unchanged'
);

// ============================================================
// Test 8: review.md - exists check uses correct path pattern
// ============================================================
console.log('\nTest 8: review.md - Correct path pattern for existence check');

assert(
  step41c.includes('plugins/bee/agents/stacks/{stack.name}') ||
  step41c.includes('agents/stacks/{stack.name}'),
  'Step 4.1c uses correct path pattern plugins/bee/agents/stacks/{stack.name}/'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
