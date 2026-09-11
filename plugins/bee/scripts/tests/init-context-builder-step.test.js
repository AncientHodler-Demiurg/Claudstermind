#!/usr/bin/env node
// Test: init.md command file has Step 11 that spawns context-builder agent
// after Step 10 (Completion Summary).

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'init.md'
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
  console.log('FAIL: init.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: Step 11 heading exists after Step 10
// ============================================================
console.log('Test 1: Step 11 heading exists');
const step10Idx = content.indexOf('### Step 10');
const step11Idx = content.indexOf('### Step 11');
assert(step11Idx !== -1, 'Step 11 heading exists in init.md');
assert(
  step10Idx !== -1 && step11Idx > step10Idx,
  'Step 11 appears after Step 10'
);

// ============================================================
// Test 2: Step 11 title references context extraction
// ============================================================
console.log('\nTest 2: Step 11 title');
const step11HeadingLine = content.substring(step11Idx, content.indexOf('\n', step11Idx));
assert(
  step11HeadingLine.toLowerCase().includes('context') ||
  step11HeadingLine.toLowerCase().includes('codebase'),
  'Step 11 heading references context extraction'
);

// ============================================================
// Test 3: Step 11 spawns context-builder agent via Task tool
// ============================================================
console.log('\nTest 3: Step 11 spawns context-builder');
const step11Content = contentBetweenSections('### Step 11', content);
assert(
  step11Content.includes('context-builder'),
  'Step 11 references context-builder agent'
);
assert(
  step11Content.toLowerCase().includes('task') &&
  (step11Content.toLowerCase().includes('spawn') ||
   step11Content.toLowerCase().includes('tool')),
  'Step 11 mentions Task tool or spawning'
);

// ============================================================
// Test 4: Step 11 uses model: "sonnet"
// ============================================================
console.log('\nTest 4: Step 11 uses model: "sonnet"');
assert(
  step11Content.includes('sonnet') ||
  step11Content.includes('"sonnet"') ||
  step11Content.includes('`sonnet`'),
  'Step 11 specifies model: sonnet'
);

// ============================================================
// Test 5: Fresh init runs context extraction
// ============================================================
console.log('\nTest 5: Fresh init runs context extraction');
assert(
  step11Content.toLowerCase().includes('fresh') ||
  step11Content.toLowerCase().includes('no_existing_config') ||
  step11Content.toLowerCase().includes('always'),
  'Step 11 describes fresh init behavior (always runs)'
);

// ============================================================
// Test 6: Re-init skips when CONTEXT.md already exists
// ============================================================
console.log('\nTest 6: Re-init skip logic');
assert(
  step11Content.includes('CONTEXT.md'),
  'Step 11 references CONTEXT.md file'
);
assert(
  step11Content.toLowerCase().includes('skip') ||
  step11Content.toLowerCase().includes('already exists'),
  'Step 11 mentions skipping when CONTEXT.md exists'
);
assert(
  step11Content.includes('/bee:refresh-context') ||
  step11Content.includes('refresh-context'),
  'Step 11 mentions /bee:refresh-context for explicit re-run'
);

// ============================================================
// Test 7: Display messages before and after spawning
// ============================================================
console.log('\nTest 7: Display messages');
assert(
  step11Content.includes('Extracting codebase context...'),
  'Step 11 displays "Extracting codebase context..." before spawning'
);
assert(
  step11Content.includes('Codebase context extracted to `.bee/CONTEXT.md`.'),
  'Step 11 displays completion message after spawning'
);

// ============================================================
// Test 8: Step 10 is unchanged (Completion Summary)
// ============================================================
console.log('\nTest 8: Step 10 unchanged');
const step10Content = contentBetweenSections('### Step 10', content);
assert(
  step10Content.includes('Completion Summary') ||
  content.includes('### Step 10: Completion Summary'),
  'Step 10 is still "Completion Summary"'
);
assert(
  step10Content.includes('BeeDev initialized!'),
  'Step 10 still contains "BeeDev initialized!" display'
);
/* removed: superseded (Phase 2 triage) */

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
