#!/usr/bin/env node
// Test: hive.md command file has correct frontmatter, dynamic context,
// NOT_INITIALIZED guard, start/stop subcommands, script delegation
// (hive-start.sh, hive-stop.sh, hive-utils.sh), already_running race handling,
// AskUserQuestion menu, and Design Notes. Asserts file structure only; does
// not execute shell scripts.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'hive.md'
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
  console.log('FAIL: hive.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lowerContent = content.toLowerCase();
const frontmatter = extractFrontmatter(content);

// ============================================================
// Test 1: hive.md exists
// ============================================================
console.log('Test 1: File exists');
assert(
  fs.existsSync(CMD_PATH),
  'hive.md exists at plugins/bee/commands/hive.md'
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
  /description:.*(?:dashboard|hive|server)/i.test(frontmatter),
  'Description mentions dashboard/hive/server'
);
assert(
  frontmatter.includes('argument-hint:'),
  'Frontmatter has argument-hint field'
);
assert(
  /argument-hint:.*stop/i.test(frontmatter),
  'argument-hint mentions stop subcommand'
);

// ============================================================
// Test 3: Current State section present
// ============================================================
console.log('\nTest 3: Current State section');
assert(
  content.includes('## Current State'),
  'Has ## Current State section'
);
assert(
  content.includes('.bee/STATE.md'),
  'Current State reads .bee/STATE.md'
);

// ============================================================
// Test 4: NOT_INITIALIZED guard
// ============================================================
console.log('\nTest 4: NOT_INITIALIZED guard');
assert(
  content.includes('NOT_INITIALIZED'),
  'Has NOT_INITIALIZED guard'
);
assert(
  content.includes('/bee:init'),
  'Suggests /bee:init when not initialized'
);

// ============================================================
// Test 5: Instructions section with numbered steps
// ============================================================
console.log('\nTest 5: Instructions section');
assert(
  content.includes('## Instructions'),
  'Has ## Instructions section'
);
assert(
  /###\s*Step\s*1/i.test(content) || /^\s*1\.\s/m.test(content),
  'Has numbered steps'
);

// ============================================================
// Test 6: Parses $ARGUMENTS for stop subcommand
// ============================================================
console.log('\nTest 6: Argument parsing for stop subcommand');
assert(
  content.includes('$ARGUMENTS'),
  'References $ARGUMENTS for parsing'
);
assert(
  /stop/i.test(lowerContent) && (lowerContent.includes('stop mode') || lowerContent.includes('stop subcommand') || /stop.*mode/i.test(lowerContent)),
  'Defines STOP mode branch'
);
assert(
  lowerContent.includes('start mode') || lowerContent.includes('start subcommand') || /start.*mode/i.test(lowerContent),
  'Defines START mode branch'
);

// ============================================================
// Test 7: References hive-stop.sh for STOP mode
// ============================================================
console.log('\nTest 7: hive-stop.sh delegation');
assert(
  content.includes('hive-stop.sh'),
  'References hive-stop.sh script'
);
assert(
  content.includes('plugins/bee/scripts/hive-stop.sh'),
  'Uses full path to hive-stop.sh'
);
assert(
  lowerContent.includes('"status"') || lowerContent.includes('status field') || content.includes('status'),
  'Parses status field from hive-stop.sh JSON output'
);
assert(
  content.includes('stopped') && content.includes('not_running'),
  'Handles stopped and not_running status values'
);

// ============================================================
// Test 8: References hive-start.sh and hive-utils.sh for START mode
// ============================================================
console.log('\nTest 8: hive-start.sh and hive-utils.sh delegation');
assert(
  content.includes('hive-start.sh'),
  'References hive-start.sh script'
);
assert(
  content.includes('plugins/bee/scripts/hive-start.sh'),
  'Uses full path to hive-start.sh'
);
assert(
  content.includes('hive-utils.sh'),
  'References hive-utils.sh library'
);
assert(
  content.includes('source plugins/bee/scripts/hive-utils.sh') || content.includes('source ') && content.includes('hive-utils.sh'),
  'Sources hive-utils.sh via shell'
);
assert(
  content.includes('check_running'),
  'Calls check_running function from hive-utils.sh'
);
assert(
  content.includes('open_browser'),
  'Calls open_browser function from hive-utils.sh'
);

// ============================================================
// Test 9: check_running branches — running / not_running / unresponsive
// ============================================================
console.log('\nTest 9: check_running status handling');
assert(
  lowerContent.includes('running') && content.includes('not_running'),
  'Handles running and not_running statuses'
);
assert(
  content.includes('unresponsive'),
  'Handles unresponsive status (stale PID)'
);
assert(
  lowerContent.includes('already running') || lowerContent.includes('dashboard already'),
  'Reports "already running" when status=running'
);

// ============================================================
// Test 10: Handles already_running race condition from hive-start.sh
// ============================================================
console.log('\nTest 10: already_running race condition');
assert(
  content.includes('already_running'),
  'Handles already_running JSON from hive-start.sh (race condition)'
);
assert(
  lowerContent.includes('race') || lowerContent.includes('already_running'),
  'Documents race handling for already_running'
);

// ============================================================
// Test 11: Handles failed status from hive-start.sh
// ============================================================
console.log('\nTest 11: failed status handling');
assert(
  content.includes('"failed"') || content.includes('failed') && content.includes('error'),
  'Handles failed JSON from hive-start.sh'
);

// ============================================================
// Test 12: Success URL parsing and browser open
// ============================================================
console.log('\nTest 12: Success handling and URL parsing');
assert(
  content.includes('server-started') || content.includes('"url"'),
  'Parses server-started JSON for url field'
);
assert(
  lowerContent.includes('open_browser') && content.includes('url'),
  'Opens browser with parsed URL'
);

// ============================================================
// Test 13: STATE.md Last Action update (Read-Modify-Write)
// ============================================================
console.log('\nTest 13: STATE.md update');
assert(
  content.includes('Last Action') || content.includes('last action'),
  'Updates STATE.md Last Action'
);
assert(
  lowerContent.includes('read-modify-write') || (lowerContent.includes('re-read') || lowerContent.includes('read state.md')),
  'Uses Read-Modify-Write pattern for STATE.md'
);

// ============================================================
// Test 14: Interactive menu (AskUserQuestion) at end
// ============================================================
console.log('\nTest 14: AskUserQuestion menu');
assert(
  content.includes('AskUserQuestion'),
  'Presents AskUserQuestion menu at end'
);
assert(
  content.includes('Custom'),
  'Menu includes Custom option'
);
assert(
  lowerContent.includes('view in browser') || lowerContent.includes('stop dashboard') || lowerContent.includes('browser'),
  'Menu offers browser/stop dashboard options'
);

// ============================================================
// Test 15: Design Notes at end after --- separator
// ============================================================
console.log('\nTest 15: Design Notes block');
assert(
  content.includes('Design Notes'),
  'Has Design Notes block'
);
assert(
  /---\s*\n+\**Design Notes/i.test(content) || /---\s*\n+#+\s*Design Notes/i.test(content),
  'Design Notes come after --- separator'
);
assert(
  lowerContent.includes('do not display to user'),
  'Design Notes marked as internal (do not display to user)'
);
assert(
  lowerContent.includes('delegate') || lowerContent.includes('shell script') || lowerContent.includes('orchestrat'),
  'Design Notes explain shell script delegation rationale'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
