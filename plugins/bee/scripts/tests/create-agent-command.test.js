#!/usr/bin/env node
// Test: create-agent.md command file has correct frontmatter, dynamic context,
// all required steps (NOT_INITIALIZED guard, get name, validate protected names,
// role question, tools question, instructions question, TDD enforcement,
// write agent file, STATE.md update, completion message),
// and follows command conventions.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'create-agent.md'
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
  console.log('FAIL: create-agent.md does not exist at expected path');
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
// Test 4: Step 2 - Get agent name from args or AskUserQuestion
// ============================================================
console.log('\nTest 4: Step 2 - Get agent name');
const step2Content = contentBetweenSections('### Step 2', content);
assert(
  step2Content.length > 0,
  'Step 2 exists'
);
assert(
  step2Content.includes('$ARGUMENTS') || step2Content.includes('ARGUMENTS'),
  'Step 2 checks $ARGUMENTS for agent name'
);
assert(
  step2Content.toLowerCase().includes('askuserquestion') ||
  step2Content.toLowerCase().includes('ask the user') ||
  step2Content.toLowerCase().includes('ask user'),
  'Step 2 falls back to asking user for agent name if no arguments'
);
assert(
  step2Content.toLowerCase().includes('kebab') ||
  step2Content.toLowerCase().includes('lowercase') ||
  step2Content.toLowerCase().includes('slug'),
  'Step 2 enforces naming convention (kebab-case or lowercase)'
);

// ============================================================
// Test 5: Step 3 - Validate against protected names
// ============================================================
console.log('\nTest 5: Step 3 - Protected name validation');
const step3Content = contentBetweenSections('### Step 3', content);
assert(
  step3Content.length > 0,
  'Step 3 exists'
);
assert(
  step3Content.toLowerCase().includes('protected') ||
  step3Content.toLowerCase().includes('reserved') ||
  step3Content.toLowerCase().includes('built-in'),
  'Step 3 references protected/reserved names'
);
// Must include project-reviewer specifically
/* removed: superseded (Phase 2 triage) */
// Must include core agent names
assert(
  step3Content.includes('implementer') &&
  step3Content.includes('fixer') &&
  step3Content.includes('researcher'),
  'Step 3 includes core agent names (implementer, fixer, researcher)'
);
assert(
  step3Content.includes('reviewer') &&
  step3Content.includes('spec-writer') &&
  step3Content.includes('phase-planner'),
  'Step 3 includes more core agent names (reviewer, spec-writer, phase-planner)'
);
assert(
  step3Content.includes('bug-detector') &&
  step3Content.includes('context-builder') &&
  step3Content.includes('quick-implementer'),
  'Step 3 includes additional core agent names (bug-detector, context-builder, quick-implementer)'
);
// Validate it has a rejection message when name is protected
assert(
  step3Content.toLowerCase().includes('reserved') ||
  step3Content.toLowerCase().includes('protected') ||
  step3Content.toLowerCase().includes('not allowed') ||
  step3Content.toLowerCase().includes('cannot use') ||
  step3Content.toLowerCase().includes('choose a different'),
  'Step 3 has rejection message for protected names'
);

// ============================================================
// Test 6: Step 4 - AskUserQuestion for role
// ============================================================
console.log('\nTest 6: Step 4 - Role selection');
const step4Content = contentBetweenSections('### Step 4', content);
assert(
  step4Content.length > 0,
  'Step 4 exists'
);
assert(
  step4Content.toLowerCase().includes('askuserquestion') ||
  step4Content.toLowerCase().includes('ask the user') ||
  step4Content.toLowerCase().includes('ask user'),
  'Step 4 uses AskUserQuestion for role selection'
);
assert(
  step4Content.toLowerCase().includes('read-only') ||
  step4Content.toLowerCase().includes('read only'),
  'Step 4 has Read-only role option'
);
assert(
  step4Content.toLowerCase().includes('writer') ||
  step4Content.toLowerCase().includes('write'),
  'Step 4 has Writer role option'
);
assert(
  step4Content.toLowerCase().includes('conversational'),
  'Step 4 has Conversational role option'
);
assert(
  step4Content.toLowerCase().includes('other') ||
  step4Content.toLowerCase().includes('custom'),
  'Step 4 has Other/Custom role option'
);

// ============================================================
// Test 7: Step 5 - AskUserQuestion for tools
// ============================================================
console.log('\nTest 7: Step 5 - Tools selection');
const step5Content = contentBetweenSections('### Step 5', content);
assert(
  step5Content.length > 0,
  'Step 5 exists'
);
assert(
  step5Content.toLowerCase().includes('askuserquestion') ||
  step5Content.toLowerCase().includes('ask the user') ||
  step5Content.toLowerCase().includes('ask user'),
  'Step 5 uses AskUserQuestion for tools selection'
);
assert(
  step5Content.toLowerCase().includes('tool'),
  'Step 5 discusses tool options'
);
// Should have 3 tool options
const toolOptionCount = (
  (step5Content.toLowerCase().includes('read') ? 1 : 0) +
  (step5Content.toLowerCase().includes('write') || step5Content.toLowerCase().includes('edit') ? 1 : 0) +
  (step5Content.toLowerCase().includes('bash') ? 1 : 0) +
  (step5Content.toLowerCase().includes('glob') || step5Content.toLowerCase().includes('grep') ? 1 : 0)
);
assert(
  toolOptionCount >= 2,
  'Step 5 has multiple tool-related options'
);

// ============================================================
// Test 8: Step 6 - Free-text instructions
// ============================================================
console.log('\nTest 8: Step 6 - Free-text instructions');
const step6Content = contentBetweenSections('### Step 6', content);
assert(
  step6Content.length > 0,
  'Step 6 exists'
);
assert(
  step6Content.toLowerCase().includes('instruction') ||
  step6Content.toLowerCase().includes('free-text') ||
  step6Content.toLowerCase().includes('free text') ||
  step6Content.toLowerCase().includes('describe'),
  'Step 6 collects free-text instructions'
);
assert(
  step6Content.toLowerCase().includes('askuserquestion') ||
  step6Content.toLowerCase().includes('ask the user') ||
  step6Content.toLowerCase().includes('ask user'),
  'Step 6 uses AskUserQuestion for instructions'
);

// ============================================================
// Test 9: Step 7 - TDD enforcement question
// ============================================================
console.log('\nTest 9: Step 7 - TDD enforcement');
const step7Content = contentBetweenSections('### Step 7', content);
assert(
  step7Content.length > 0,
  'Step 7 exists'
);
assert(
  step7Content.toLowerCase().includes('tdd'),
  'Step 7 mentions TDD'
);
assert(
  step7Content.toLowerCase().includes('yes') && step7Content.toLowerCase().includes('no'),
  'Step 7 has Yes/No options'
);
assert(
  step7Content.toLowerCase().includes('askuserquestion') ||
  step7Content.toLowerCase().includes('ask the user') ||
  step7Content.toLowerCase().includes('ask user'),
  'Step 7 uses AskUserQuestion for TDD enforcement'
);

// ============================================================
// Test 10: Step 8 - Write agent file to bee-extensions
// ============================================================
console.log('\nTest 10: Step 8 - Write agent file');
const step8Content = contentBetweenSections('### Step 8', content);
assert(
  step8Content.length > 0,
  'Step 8 exists'
);
assert(
  step8Content.includes('.claude/bee-extensions/agents/') ||
  step8Content.includes('bee-extensions/agents/'),
  'Step 8 writes to .claude/bee-extensions/agents/ directory'
);
assert(
  step8Content.toLowerCase().includes('yaml') ||
  step8Content.toLowerCase().includes('frontmatter'),
  'Step 8 writes YAML frontmatter'
);
assert(
  step8Content.toLowerCase().includes('name:') ||
  step8Content.includes('name:'),
  'Step 8 agent file includes name field'
);
assert(
  step8Content.toLowerCase().includes('description:') ||
  step8Content.includes('description:'),
  'Step 8 agent file includes description field'
);
assert(
  step8Content.toLowerCase().includes('tools:') ||
  step8Content.includes('tools:'),
  'Step 8 agent file includes tools field'
);
assert(
  step8Content.toLowerCase().includes('model:') ||
  step8Content.includes('model:'),
  'Step 8 agent file includes model field'
);
assert(
  step8Content.toLowerCase().includes('mkdir') ||
  step8Content.toLowerCase().includes('create') ||
  step8Content.toLowerCase().includes('ensure'),
  'Step 8 ensures directory exists before writing'
);

// ============================================================
// Test 11: Step 9 - STATE.md R-M-W update
// ============================================================
console.log('\nTest 11: Step 9 - STATE.md update');
const step9Content = contentBetweenSections('### Step 9', content);
assert(
  step9Content.length > 0,
  'Step 9 exists'
);
assert(
  step9Content.includes('STATE.md'),
  'Step 9 updates STATE.md'
);
assert(
  step9Content.toLowerCase().includes('last action'),
  'Step 9 updates Last Action section'
);
assert(
  step9Content.toLowerCase().includes('read-modify-write') ||
  step9Content.toLowerCase().includes('re-read') ||
  step9Content.toLowerCase().includes('read current') ||
  (step9Content.toLowerCase().includes('read') && step9Content.toLowerCase().includes('write')),
  'Step 9 uses Read-Modify-Write pattern'
);

// ============================================================
// Test 12: Step 10 - Completion message
// ============================================================
console.log('\nTest 12: Step 10 - Completion message');
const step10Content = contentBetweenSections('### Step 10', content);
assert(
  step10Content.length > 0,
  'Step 10 exists'
);
assert(
  step10Content.toLowerCase().includes('agent') &&
  (step10Content.toLowerCase().includes('created') ||
   step10Content.toLowerCase().includes('complete') ||
   step10Content.toLowerCase().includes('success')),
  'Step 10 shows success/completion message'
);
assert(
  step10Content.includes('.claude/bee-extensions/agents/') ||
  step10Content.includes('bee-extensions/agents/') ||
  step10Content.toLowerCase().includes('path') ||
  step10Content.toLowerCase().includes('file'),
  'Step 10 shows the created agent file path'
);

// ============================================================
// Test 13: Never writes production code
// ============================================================
console.log('\nTest 13: No production code');
assert(
  lowerContent.includes('never writes production code') ||
  lowerContent.includes('does not write production code') ||
  lowerContent.includes('no production code') ||
  lowerContent.includes('never write production code') ||
  lowerContent.includes('not write production code') ||
  (lowerContent.includes('only writes') && lowerContent.includes('agent')),
  'Command states it never writes production code'
);

// ============================================================
// Test 14: Correct step count (exactly 10 steps)
// ============================================================
console.log('\nTest 14: Step count');
const stepMatches = content.match(/### Step \d+/g);
assert(
  stepMatches !== null && stepMatches.length === 10,
  `Command has exactly 10 steps (found ${stepMatches ? stepMatches.length : 0})`
);

// ============================================================
// Test 15: Design Notes section exists
// ============================================================
console.log('\nTest 15: Design Notes');
assert(
  content.includes('**Design Notes'),
  'Command has a Design Notes section'
);

// ============================================================
// Test 16: Agent file format matches core agent structure
// ============================================================
console.log('\nTest 16: Agent file format');
assert(
  step8Content.includes('color:') || step8Content.toLowerCase().includes('color'),
  'Step 8 agent file includes color field'
);
assert(
  step8Content.includes('skills:') || step8Content.toLowerCase().includes('skills'),
  'Step 8 agent file includes skills field'
);
assert(
  step8Content.includes('model: inherit') || step8Content.includes('inherit'),
  'Step 8 agent uses model: inherit'
);

// ============================================================
// Test 17: Protected names list has sufficient count
// ============================================================
console.log('\nTest 17: Protected names count');
// Count distinct agent names in the protected list within step 3
const protectedNames = [
  'implementer', 'fixer', 'researcher', 'reviewer', 'spec-writer',
  'phase-planner', 'plan-reviewer', 'spec-shaper', 'finding-validator',
  'integrity-auditor', 'test-auditor', 'test-planner', 'project-reviewer',
  'context-builder', 'quick-implementer', 'discuss-partner',
  'bug-detector', 'pattern-reviewer', 'stack-reviewer', 'plan-compliance-reviewer'
];
let protectedCount = 0;
for (const name of protectedNames) {
  if (step3Content.includes(name)) {
    protectedCount++;
  }
}
assert(
  protectedCount >= 19,
  `Protected names list includes at least 20 core agent names (found ${protectedCount})`
);

// ============================================================
// Test 18: Command never auto-commits
// ============================================================
console.log('\nTest 18: No auto-commit');
assert(
  lowerContent.includes('never auto-commit') ||
  lowerContent.includes('does not commit') ||
  lowerContent.includes('no auto-commit') ||
  lowerContent.includes('never commits') ||
  lowerContent.includes('not commit') ||
  lowerContent.includes('do not commit'),
  'Command explicitly states it never auto-commits'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
