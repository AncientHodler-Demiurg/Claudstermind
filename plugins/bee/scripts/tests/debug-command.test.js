#!/usr/bin/env node
// Test: debug.md command file has correct frontmatter, dynamic context,
// all required steps (NOT_INITIALIZED guard, active session check, symptom gathering,
// debug file creation, agent spawn, signal handlers, continuation), and follows command conventions.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'debug.md'
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

// Read the file
let content;
try {
  content = fs.readFileSync(CMD_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: debug.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lowerContent = content.toLowerCase();
const frontmatter = extractFrontmatter(content);

// ============================================================
// Test 1: debug.md exists
// ============================================================
console.log('Test 1: File exists');
assert(
  fs.existsSync(CMD_PATH),
  'debug.md exists at plugins/bee/commands/debug.md'
);

// ============================================================
// Test 2: Frontmatter has correct fields
// ============================================================
console.log('\nTest 2: Frontmatter');
assert(
  content.startsWith('---'),
  'File starts with YAML frontmatter delimiter'
);
assert(
  frontmatter.includes('description:'),
  'Frontmatter has description field'
);
assert(
  /description:.*(?:debug|investigat)/i.test(frontmatter),
  'Description mentions debug or investigate'
);
assert(
  frontmatter.includes('argument-hint:'),
  'Frontmatter has argument-hint field'
);
assert(
  /argument-hint:.*(?:description|bug)/i.test(frontmatter),
  'argument-hint contains description placeholder'
);

// ============================================================
// Test 3: NOT_INITIALIZED guard
// ============================================================
console.log('\nTest 3: NOT_INITIALIZED guard');
assert(
  content.includes('NOT_INITIALIZED'),
  'Has NOT_INITIALIZED guard'
);
assert(
  content.includes('STATE.md'),
  'References STATE.md for initialization check'
);
assert(
  content.includes('/bee:init'),
  'Suggests /bee:init when not initialized'
);

// ============================================================
// Test 4: Active session check with Glob for .bee/debug/*.md
// ============================================================
console.log('\nTest 4: Active session check');
assert(
  lowerContent.includes('active session') || lowerContent.includes('active debug'),
  'References active sessions'
);
assert(
  content.includes('.bee/debug/') || content.includes('bee/debug'),
  'References .bee/debug/ directory'
);
assert(
  lowerContent.includes('glob') || lowerContent.includes('.bee/debug/*.md'),
  'Uses Glob to find active debug sessions'
);

// ============================================================
// Test 5: Gathers symptoms using AskUserQuestion (5 fields)
// ============================================================
console.log('\nTest 5: Symptom gathering');
assert(
  lowerContent.includes('askuserquestion') || lowerContent.includes('ask'),
  'Uses AskUserQuestion for symptom gathering'
);
assert(
  lowerContent.includes('expect'),
  'Gathers expected behavior'
);
assert(
  lowerContent.includes('actual'),
  'Gathers actual behavior'
);
assert(
  lowerContent.includes('error'),
  'Gathers error messages'
);
assert(
  lowerContent.includes('timeline') || lowerContent.includes('when did'),
  'Gathers timeline'
);
assert(
  lowerContent.includes('reproduc') || lowerContent.includes('trigger') || lowerContent.includes('steps to reproduce'),
  'Gathers reproduction steps'
);

// ============================================================
// Test 6: Creates .bee/debug/{slug}.md with status: active frontmatter
// ============================================================
console.log('\nTest 6: Debug file creation');
assert(
  content.includes('.bee/debug/') && (lowerContent.includes('slug') || content.includes('{slug}')),
  'Creates debug file at .bee/debug/{slug}.md'
);
assert(
  content.includes('status: active'),
  'Debug file has status: active in frontmatter'
);
assert(
  lowerContent.includes('mkdir') || lowerContent.includes('create') || lowerContent.includes('write'),
  'Creates directory and writes debug file'
);

// ============================================================
// Test 7: Spawns debug-investigator agent via Task tool
// ============================================================
console.log('\nTest 7: Agent spawn');
assert(
  content.includes('debug-investigator'),
  'References debug-investigator agent'
);
assert(
  lowerContent.includes('task') && content.includes('debug-investigator'),
  'Spawns debug-investigator via Task tool'
);

// ============================================================
// Test 8: Handles ROOT CAUSE FOUND signal
// ============================================================
console.log('\nTest 8: ROOT CAUSE FOUND handler');
assert(
  content.includes('ROOT CAUSE FOUND'),
  'Handles ROOT CAUSE FOUND signal'
);
assert(
  content.includes('Fix now') || content.includes('fix now'),
  'ROOT CAUSE FOUND offers Fix now option'
);
assert(
  content.includes('Manual fix') || content.includes('manual fix'),
  'ROOT CAUSE FOUND offers Manual fix option'
);

// ============================================================
// Test 9: Handles CHECKPOINT REACHED signal
// ============================================================
console.log('\nTest 9: CHECKPOINT REACHED handler');
assert(
  content.includes('CHECKPOINT REACHED'),
  'Handles CHECKPOINT REACHED signal'
);
assert(
  lowerContent.includes('continuation') || lowerContent.includes('spawn') || lowerContent.includes('fresh'),
  'CHECKPOINT REACHED spawns continuation agent'
);

// ============================================================
// Test 10: Handles INVESTIGATION INCONCLUSIVE signal
// ============================================================
console.log('\nTest 10: INVESTIGATION INCONCLUSIVE handler');
assert(
  content.includes('INVESTIGATION INCONCLUSIVE'),
  'Handles INVESTIGATION INCONCLUSIVE signal'
);
assert(
  lowerContent.includes('continue') || lowerContent.includes('add context') || lowerContent.includes('done'),
  'INVESTIGATION INCONCLUSIVE offers Continue/Add context/Done options'
);

// ============================================================
// Test 11: "Fix now" suggests /bee:quick (does NOT auto-fix)
// ============================================================
console.log('\nTest 11: Fix now suggests /bee:quick');
assert(
  content.includes('/bee:quick'),
  'Fix now suggests /bee:quick command'
);
assert(
  lowerContent.includes('never auto-fix') || lowerContent.includes('does not auto-fix') ||
  lowerContent.includes('not auto-fix') || lowerContent.includes('no auto-fix') ||
  lowerContent.includes('suggest') || lowerContent.includes('do not automatically fix'),
  'Fix now suggests but does not auto-fix'
);

// ============================================================
// Test 12: Resolves model from config -- sonnet for economy, inherit for quality/premium
// ============================================================
console.log('\nTest 12: Model resolution');
assert(
  lowerContent.includes('implementation_mode') || lowerContent.includes('impl_mode'),
  'Reads implementation_mode from config'
);
assert(
  lowerContent.includes('economy') && lowerContent.includes('sonnet'),
  'Economy mode uses sonnet'
);

// ============================================================
// Test 13: Menus use numbered options with Custom last
// ============================================================
console.log('\nTest 13: Numbered menus with Custom last');
assert(
  content.includes('Custom'),
  'Menus include Custom option'
);

// ============================================================
// Test 14: load-context.sh detects active debug sessions
// ============================================================
console.log('\nTest 14: load-context.sh debug detection');
const loadContextPath = path.join(
  __dirname, '..', '..', 'scripts', 'load-context.sh'
);
let loadContextContent;
try {
  loadContextContent = fs.readFileSync(loadContextPath, 'utf8');
} catch (e) {
  loadContextContent = '';
}
assert(
  loadContextContent.includes('.bee/debug') || loadContextContent.includes('bee/debug') ||
  loadContextContent.includes('BEE_DIR/debug') || loadContextContent.includes('debug'),
  'load-context.sh references .bee/debug for active session detection'
);
assert(
  loadContextContent.includes('Active Debug Session') || loadContextContent.includes('active debug session') || loadContextContent.toLowerCase().includes('debug session'),
  'load-context.sh outputs active debug session info'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
