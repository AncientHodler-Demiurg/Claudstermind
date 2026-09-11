#!/usr/bin/env node
// Test: create-skill.md command file has correct frontmatter, dynamic context,
// all required steps (NOT_INITIALIZED guard, get skill name, validate protected list,
// ask target stack, ask sections, ask content per section, write skill file,
// STATE.md R-M-W update, completion message), and follows command conventions.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'create-skill.md'
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

// Helper: extract YAML frontmatter
function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
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
  console.log('FAIL: create-skill.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lowerContent = content.toLowerCase();
const frontmatter = extractFrontmatter(content);

// ============================================================
// Test 1: Frontmatter has correct fields
// ============================================================
console.log('Test 1: Frontmatter');
assert(
  content.startsWith('---'),
  'File starts with YAML frontmatter delimiter'
);
assert(
  frontmatter.includes('description:'),
  'Frontmatter has description field'
);
assert(
  frontmatter.includes('argument-hint:'),
  'Frontmatter has argument-hint field'
);
assert(
  frontmatter.includes('[skill-name]') || frontmatter.includes('[skill name]') || frontmatter.includes('[name]'),
  'argument-hint references skill name'
);

// ============================================================
// Test 2: Dynamic context reads STATE.md and config.json
// ============================================================
console.log('\nTest 2: Dynamic context');
assert(
  content.includes('STATE.md'),
  'Dynamic context reads STATE.md'
);
assert(
  content.includes('config.json'),
  'Dynamic context reads config.json'
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
// Test 4: Step 2 - Get skill name from args or AskUserQuestion
// ============================================================
console.log('\nTest 4: Step 2 - Get skill name');
const step2Content = contentBetweenSections('### Step 2', content);
assert(
  step2Content.length > 0,
  'Step 2 exists'
);
assert(
  step2Content.includes('$ARGUMENTS') || step2Content.includes('ARGUMENTS'),
  'Step 2 checks $ARGUMENTS for skill name'
);
assert(
  step2Content.toLowerCase().includes('askuserquestion') ||
  step2Content.toLowerCase().includes('ask the user') ||
  step2Content.toLowerCase().includes('ask user'),
  'Step 2 falls back to asking user for skill name if no arguments'
);

// ============================================================
// Test 5: Step 3 - Validate against protected list
// ============================================================
console.log('\nTest 5: Step 3 - Protected list validation');
const step3Content = contentBetweenSections('### Step 3', content);
assert(
  step3Content.length > 0,
  'Step 3 exists'
);

// Check all protected names are present
const protectedNames = [
  'claude-code-plugin',
  'laravel-inertia-vue',
  'laravel-inertia-react',
  'react',
  'nextjs',
  'nestjs',
  'react-native-expo',
  'core',
  'review',
  'standards',
  'context7'
];
for (const name of protectedNames) {
  assert(
    step3Content.includes(name),
    `Step 3 lists "${name}" as protected`
  );
}
assert(
  step3Content.toLowerCase().includes('reject') ||
  step3Content.toLowerCase().includes('reserved') ||
  step3Content.toLowerCase().includes('protected') ||
  step3Content.toLowerCase().includes('not allowed') ||
  step3Content.toLowerCase().includes('cannot use'),
  'Step 3 rejects protected names'
);

// ============================================================
// Test 6: Step 4 - AskUserQuestion for target stack
// ============================================================
console.log('\nTest 6: Step 4 - Target stack selection');
const step4Content = contentBetweenSections('### Step 4', content);
assert(
  step4Content.length > 0,
  'Step 4 exists'
);
assert(
  step4Content.toLowerCase().includes('askuserquestion') ||
  step4Content.toLowerCase().includes('ask the user') ||
  step4Content.toLowerCase().includes('ask user'),
  'Step 4 asks user for target stack'
);
assert(
  step4Content.toLowerCase().includes('stack-agnostic') ||
  step4Content.toLowerCase().includes('agnostic'),
  'Step 4 offers "Stack-agnostic" option'
);
assert(
  step4Content.toLowerCase().includes('config') ||
  step4Content.toLowerCase().includes('stacks'),
  'Step 4 reads stacks from config'
);

// ============================================================
// Test 7: Step 5 - AskUserQuestion multi-select for sections
// ============================================================
console.log('\nTest 7: Step 5 - Section selection');
const step5Content = contentBetweenSections('### Step 5', content);
assert(
  step5Content.length > 0,
  'Step 5 exists'
);
assert(
  step5Content.toLowerCase().includes('askuserquestion') ||
  step5Content.toLowerCase().includes('ask the user') ||
  step5Content.toLowerCase().includes('ask user'),
  'Step 5 asks user for sections'
);
assert(
  step5Content.toLowerCase().includes('section') ||
  step5Content.toLowerCase().includes('multi'),
  'Step 5 mentions section selection'
);

// ============================================================
// Test 8: Step 6 - AskUserQuestion per section for content
// ============================================================
console.log('\nTest 8: Step 6 - Content per section');
const step6Content = contentBetweenSections('### Step 6', content);
assert(
  step6Content.length > 0,
  'Step 6 exists'
);
assert(
  step6Content.toLowerCase().includes('askuserquestion') ||
  step6Content.toLowerCase().includes('ask the user') ||
  step6Content.toLowerCase().includes('ask user') ||
  step6Content.toLowerCase().includes('each section') ||
  step6Content.toLowerCase().includes('per section'),
  'Step 6 asks user for content of each section'
);

// ============================================================
// Test 9: Step 7 - Write to .claude/bee-extensions/skills/{name}.md
// ============================================================
console.log('\nTest 9: Step 7 - Write skill file');
const step7Content = contentBetweenSections('### Step 7', content);
assert(
  step7Content.length > 0,
  'Step 7 exists'
);
assert(
  step7Content.includes('.claude/bee-extensions/skills/') ||
  step7Content.includes('bee-extensions/skills'),
  'Step 7 writes to .claude/bee-extensions/skills/ directory'
);
assert(
  step7Content.toLowerCase().includes('yaml') ||
  step7Content.toLowerCase().includes('frontmatter'),
  'Step 7 mentions YAML frontmatter'
);
assert(
  step7Content.toLowerCase().includes('mkdir') ||
  step7Content.toLowerCase().includes('create') ||
  step7Content.toLowerCase().includes('directory') ||
  step7Content.toLowerCase().includes('ensure'),
  'Step 7 ensures directory exists before writing'
);

// ============================================================
// Test 10: Step 8 - STATE.md R-M-W update
// ============================================================
console.log('\nTest 10: Step 8 - STATE.md update');
const step8Content = contentBetweenSections('### Step 8', content);
assert(
  step8Content.length > 0,
  'Step 8 exists'
);
assert(
  step8Content.includes('STATE.md'),
  'Step 8 updates STATE.md'
);
assert(
  step8Content.toLowerCase().includes('last action'),
  'Step 8 updates Last Action section'
);
assert(
  step8Content.toLowerCase().includes('read-modify-write') ||
  step8Content.toLowerCase().includes('re-read') ||
  step8Content.toLowerCase().includes('read current') ||
  (step8Content.toLowerCase().includes('read') && step8Content.toLowerCase().includes('write')),
  'Step 8 uses Read-Modify-Write pattern'
);
assert(
  step8Content.includes('/bee:create-skill') || step8Content.includes('create-skill'),
  'Step 8 records /bee:create-skill as the command'
);

// ============================================================
// Test 11: Step 9 - Completion message
// ============================================================
console.log('\nTest 11: Step 9 - Completion message');
const step9Content = contentBetweenSections('### Step 9', content);
assert(
  step9Content.length > 0,
  'Step 9 exists'
);
assert(
  step9Content.toLowerCase().includes('skill') &&
  (step9Content.toLowerCase().includes('created') ||
   step9Content.toLowerCase().includes('complete') ||
   step9Content.toLowerCase().includes('success')),
  'Step 9 displays completion message'
);
assert(
  step9Content.includes('.claude/bee-extensions/skills/') ||
  step9Content.includes('bee-extensions/skills') ||
  step9Content.toLowerCase().includes('path'),
  'Step 9 shows the created skill file path'
);

// ============================================================
// Test 12: Never writes production code
// ============================================================
console.log('\nTest 12: No production code');
assert(
  lowerContent.includes('never writes production code') ||
  lowerContent.includes('does not write production code') ||
  lowerContent.includes('no production code') ||
  lowerContent.includes('never write production code') ||
  lowerContent.includes('only writes') ||
  lowerContent.includes('does not commit') ||
  lowerContent.includes('never auto-commit'),
  'Command explicitly states it never writes production code or auto-commits'
);

// ============================================================
// Test 13: Correct step count (exactly 9 steps)
// ============================================================
console.log('\nTest 13: Step count');
const stepMatches = content.match(/### Step \d/g);
assert(
  stepMatches !== null && stepMatches.length === 9,
  `Command has exactly 9 steps (found ${stepMatches ? stepMatches.length : 0})`
);

// ============================================================
// Test 14: Design Notes section exists
// ============================================================
console.log('\nTest 14: Design Notes');
assert(
  content.includes('**Design Notes'),
  'Command has a Design Notes section'
);

// ============================================================
// Test 15: Skill file output has name: and description: frontmatter
// ============================================================
console.log('\nTest 15: Skill file output format');
assert(
  step7Content.toLowerCase().includes('name:') ||
  lowerContent.includes('name:') && lowerContent.includes('description:'),
  'Skill file output includes name: frontmatter field'
);
assert(
  step7Content.toLowerCase().includes('description:') ||
  content.includes('description:'),
  'Skill file output includes description: frontmatter field'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
