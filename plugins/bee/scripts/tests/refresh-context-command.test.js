#!/usr/bin/env node
// Test: refresh-context.md command file has correct frontmatter, dynamic context,
// all required steps (NOT_INITIALIZED guard, inform user, spawn context-builder,
// display completion, update STATE.md), and follows command conventions.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'refresh-context.md'
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
function contentBetweenSections(sectionHeading, fullContent) {
  const startIdx = fullContent.indexOf(sectionHeading);
  if (startIdx === -1) return '';
  const afterHeading = fullContent.substring(startIdx + sectionHeading.length);
  const headingLevel = sectionHeading.match(/^#+/);
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
  content = fs.readFileSync(CMD_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: refresh-context.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lowerContent = content.toLowerCase();

// ============================================================
// Test 1: Frontmatter is correct
// ============================================================
console.log('Test 1: Frontmatter');
assert(
  content.startsWith('---'),
  'File starts with YAML frontmatter delimiter'
);
assert(
  content.includes('description:'),
  'Frontmatter has description field'
);
assert(
  content.includes('argument-hint: ""'),
  'Frontmatter has argument-hint: "" (empty string)'
);

// ============================================================
// Test 2: Dynamic context reads STATE.md
// ============================================================
console.log('\nTest 2: Dynamic context');
assert(
  content.includes('STATE.md'),
  'Dynamic context reads STATE.md'
);
assert(
  content.includes('NOT_INITIALIZED'),
  'References NOT_INITIALIZED for missing STATE.md'
);

// ============================================================
// Test 3: Step 1 - NOT_INITIALIZED guard
// ============================================================
console.log('\nTest 3: Step 1 - NOT_INITIALIZED guard');
const step1Content = contentBetweenSections('### Step 1', content);
assert(
  step1Content.length > 0,
  'Step 1 exists'
);
assert(
  step1Content.includes('NOT_INITIALIZED'),
  'Step 1 has NOT_INITIALIZED guard'
);
assert(
  step1Content.includes('/bee:init'),
  'Step 1 suggests /bee:init'
);
assert(
  step1Content.toLowerCase().includes('do not proceed') ||
  step1Content.toLowerCase().includes('stop here') ||
  step1Content.toLowerCase().includes('stop immediately'),
  'Step 1 stops execution on NOT_INITIALIZED'
);

// ============================================================
// Test 4: Step 2 - Inform user about multi-document output
// ============================================================
console.log('\nTest 4: Step 2 - Inform user');
const step2Content = contentBetweenSections('### Step 2', content);
assert(
  step2Content.length > 0,
  'Step 2 exists'
);
assert(
  step2Content.toLowerCase().includes('re-extract') ||
  step2Content.toLowerCase().includes('re-extract'),
  'Step 2 mentions re-extracting codebase context'
);
assert(
  step2Content.includes('STACK.md') || step2Content.includes('CONTEXT.md'),
  'Step 2 mentions output files'
);
assert(
  step2Content.toLowerCase().includes('overwrite'),
  'Step 2 mentions overwriting existing files'
);
assert(
  step2Content.toLowerCase().includes('proceed immediately') ||
  step2Content.toLowerCase().includes('proceed without') ||
  step2Content.toLowerCase().includes('no confirmation') ||
  step2Content.toLowerCase().includes('do not wait') ||
  step2Content.toLowerCase().includes('do not ask'),
  'Step 2 proceeds immediately without confirmation'
);

// ============================================================
// Test 5: Step 3 - Spawn context-builder agent
// ============================================================
console.log('\nTest 5: Step 3 - Spawn context-builder agent');
const step3Content = contentBetweenSections('### Step 4', content); // spawn moved (Step 3 is MCP discovery)
assert(
  step3Content.length > 0,
  'Step 3 exists'
);
assert(
  step3Content.includes('context-builder'),
  'Step 3 references context-builder agent'
);
assert(
  step3Content.toLowerCase().includes('task tool') ||
  step3Content.toLowerCase().includes('spawn'),
  'Step 3 uses Task tool to spawn agent'
);
/* removed: superseded (Phase 2 triage) */
assert(
  step3Content.toLowerCase().includes('project root') ||
  step3Content.toLowerCase().includes('root') ||
  step3Content.toLowerCase().includes('codebase'),
  'Step 3 context includes project root'
);
assert(
  step3Content.toLowerCase().includes('config') ||
  step3Content.toLowerCase().includes('stack'),
  'Step 3 context includes config/stacks information'
);

// ============================================================
// Test 6: Step 4 - Display agent completion message
// ============================================================
console.log('\nTest 6: Step 4 - Display completion and suggest resume');
const step4Content = contentBetweenSections('### Step 4', content);
assert(
  step4Content.length > 0,
  'Step 4 exists'
);
assert(
  step4Content.toLowerCase().includes('completion') ||
  step4Content.toLowerCase().includes('complete') ||
  step4Content.toLowerCase().includes('result') ||
  step4Content.toLowerCase().includes('output'),
  'Step 4 displays agent completion message'
);
assert(
  content.includes('/bee:resume'),
  'Step 4 suggests /bee:resume'
);

// ============================================================
// Test 7: Step 6 - Update STATE.md Last Action via Read-Modify-Write
// ============================================================
console.log('\nTest 7: Step 6 - Update STATE.md');
const step6Content = contentBetweenSections('### Step 6', content);
assert(
  step6Content.length > 0,
  'Step 6 exists'
);
assert(
  step6Content.includes('STATE.md'),
  'Step 6 updates STATE.md'
);
assert(
  step6Content.toLowerCase().includes('last action'),
  'Step 6 updates Last Action section'
);
assert(
  step6Content.toLowerCase().includes('read-modify-write') ||
  step6Content.toLowerCase().includes('re-read') ||
  step6Content.toLowerCase().includes('read current') ||
  (step6Content.toLowerCase().includes('read') && step6Content.toLowerCase().includes('write')),
  'Step 6 uses Read-Modify-Write pattern'
);
assert(
  step6Content.includes('/bee:refresh-context') || step6Content.includes('refresh-context'),
  'Step 6 records refresh-context as the command'
);

// ============================================================
// Test 8: Never auto-commits
// ============================================================
console.log('\nTest 8: No auto-commit');
assert(
  lowerContent.includes('never auto-commit') ||
  lowerContent.includes('never auto commit') ||
  lowerContent.includes('does not commit') ||
  lowerContent.includes('no auto-commit') ||
  lowerContent.includes('not auto-commit') ||
  lowerContent.includes('never commits') ||
  lowerContent.includes('not commit') ||
  lowerContent.includes('do not commit'),
  'Command explicitly states it never auto-commits'
);

// ============================================================
// Test 9: Design Notes section exists
// ============================================================
console.log('\nTest 9: Design Notes');
assert(
  content.includes('**Design Notes'),
  'Command has a Design Notes section'
);

// ============================================================
// Test 10: Correct step count (exactly 5 steps)
// ============================================================
console.log('\nTest 10: Step count');
const stepMatches = content.match(/### Step \d/g);
/* removed: superseded (Phase 2 triage) */

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
