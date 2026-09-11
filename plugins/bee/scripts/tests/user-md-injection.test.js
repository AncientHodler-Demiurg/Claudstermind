#!/usr/bin/env node
// Test: load-context.sh and inject-memory.sh support .bee/user.md injection

const fs = require('fs');
const path = require('path');

const LOAD_CONTEXT_PATH = path.join(__dirname, '..', 'load-context.sh');
const INJECT_MEMORY_PATH = path.join(__dirname, '..', 'inject-memory.sh');
const RESUME_PATH = path.join(__dirname, '..', '..', 'commands', 'resume.md');

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

// Read files
let loadContext, injectMemory, resume;
try {
  loadContext = fs.readFileSync(LOAD_CONTEXT_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: load-context.sh does not exist');
  process.exit(1);
}
try {
  injectMemory = fs.readFileSync(INJECT_MEMORY_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: inject-memory.sh does not exist');
  process.exit(1);
}
try {
  resume = fs.readFileSync(RESUME_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: resume.md does not exist');
  process.exit(1);
}

// ============================================================
// Test 1: load-context.sh reads user.md conditionally
// ============================================================
console.log('Test 1: load-context.sh reads user.md conditionally');
assert(
  loadContext.includes('user.md'),
  'load-context.sh references user.md'
);
assert(
  loadContext.includes('-f "$BEE_DIR/user.md"'),
  'load-context.sh checks user.md existence with -f'
);
assert(
  loadContext.includes('cat "$BEE_DIR/user.md"'),
  'load-context.sh cats user.md content'
);

// ============================================================
// Test 2: load-context.sh user.md injection has correct header
// ============================================================
console.log('\nTest 2: load-context.sh user.md has section header');
assert(
  loadContext.includes('User Preferences'),
  'load-context.sh includes "User Preferences" header for user.md'
);

// ============================================================
// Test 3: load-context.sh user.md appears between config.json and SESSION-CONTEXT.md
// ============================================================
console.log('\nTest 3: load-context.sh user.md position');
const configJsonIdx = loadContext.indexOf('config.json');
const userMdIdx = loadContext.indexOf('user.md');
const sessionContextIdx = loadContext.indexOf('SESSION-CONTEXT.md');
assert(
  configJsonIdx !== -1 && userMdIdx !== -1 && sessionContextIdx !== -1,
  'All three sections exist in load-context.sh'
);
assert(
  configJsonIdx < userMdIdx && userMdIdx < sessionContextIdx,
  'user.md section appears after config.json and before SESSION-CONTEXT.md'
);

// ============================================================
// Test 4: load-context.sh preserves existing functionality
// ============================================================
console.log('\nTest 4: load-context.sh preserves existing functionality');
assert(
  loadContext.includes('STATE.md'),
  'STATE.md reading preserved'
);
assert(
  loadContext.includes('config.json'),
  'config.json reading preserved'
);
assert(
  loadContext.includes('SESSION-CONTEXT.md'),
  'SESSION-CONTEXT.md reading preserved'
);
assert(
  loadContext.includes('.review-reminder-shown'),
  'Review reminder cleanup preserved'
);

// ============================================================
// Test 5: inject-memory.sh reads user.md conditionally
// ============================================================
console.log('\nTest 5: inject-memory.sh reads user.md conditionally');
assert(
  injectMemory.includes('user.md'),
  'inject-memory.sh references user.md'
);
assert(
  injectMemory.includes('-f "$BEE_DIR/user.md"'),
  'inject-memory.sh checks user.md existence with -f'
);

// ============================================================
// Test 6: inject-memory.sh user.md has distinct header
// ============================================================
console.log('\nTest 6: inject-memory.sh user.md section header');
assert(
  injectMemory.includes('## User Preferences'),
  'inject-memory.sh includes "## User Preferences" header for user.md'
);

// ============================================================
// Test 7: inject-memory.sh reads user.md from .bee/
// ============================================================
console.log('\nTest 7: inject-memory.sh user.md reading');
const userMdIdxInject = injectMemory.indexOf('user.md');
assert(
  userMdIdxInject !== -1,
  'user.md is referenced in inject-memory.sh'
);
const userMdBlockIdx = injectMemory.indexOf('if [ -f "$BEE_DIR/user.md"');
assert(
  userMdBlockIdx !== -1,
  'user.md conditional block exists in inject-memory.sh'
);

// ============================================================
// Test 8: inject-memory.sh preserves existing functionality
// ============================================================
console.log('\nTest 8: inject-memory.sh preserves existing functionality');
assert(
  injectMemory.includes('hookEventName'),
  'Hook output JSON preserved'
);
assert(
  injectMemory.includes('additionalContext'),
  'additionalContext output preserved'
);

// ============================================================
// Test 9: resume.md includes user.md in read directives
// ============================================================
console.log('\nTest 9: resume.md includes user.md');
assert(
  resume.includes('user.md'),
  'resume.md references user.md'
);
// user.md should be in the Saved State read directives
const savedStateSection = resume.substring(
  resume.indexOf('## Saved State'),
  resume.indexOf('## Instructions')
);
assert(
  savedStateSection.includes('user.md'),
  'resume.md Saved State section includes user.md'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
