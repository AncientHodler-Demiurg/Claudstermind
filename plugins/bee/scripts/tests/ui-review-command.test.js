#!/usr/bin/env node
// Test: ui-review.md command file has correct frontmatter, dynamic context,
// all required steps (NOT_INITIALIZED guard, phase resolution, UI-SPEC.md check,
// agent spawn, model selection, results display, STATE.md update, completion menu),
// and follows command conventions.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'ui-review.md'
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
  console.log('FAIL: ui-review.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lowerContent = content.toLowerCase();
const frontmatter = extractFrontmatter(content);

// ============================================================
// Test 1: ui-review.md exists
// ============================================================
console.log('Test 1: File exists');
assert(
  fs.existsSync(CMD_PATH),
  'ui-review.md exists at plugins/bee/commands/ui-review.md'
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
  /description:.*(?:ui|review|audit)/i.test(frontmatter),
  'Description mentions UI, review, or audit'
);
assert(
  frontmatter.includes('argument-hint:'),
  'Frontmatter has argument-hint field'
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

// ============================================================
// Test 4: Reads config.json for implementation_mode
// ============================================================
console.log('\nTest 4: Config reading');
assert(
  content.includes('config.json'),
  'References config.json'
);
assert(
  lowerContent.includes('implementation_mode') || lowerContent.includes('impl_mode'),
  'Reads implementation_mode from config'
);

// ============================================================
// Test 5: Resolves current phase from STATE.md
// ============================================================
console.log('\nTest 5: Phase resolution');
assert(
  lowerContent.includes('phase') && (lowerContent.includes('resolve') || lowerContent.includes('determine') || lowerContent.includes('current')),
  'Resolves current phase from STATE.md'
);
assert(
  content.includes('$ARGUMENTS') || content.includes('argument'),
  'Accepts phase as argument'
);

// ============================================================
// Test 6: Checks for existing UI-SPEC.md
// ============================================================
console.log('\nTest 6: UI-SPEC.md check');
assert(
  content.includes('UI-SPEC.md'),
  'Checks for UI-SPEC.md in phase directory'
);

// ============================================================
// Test 7: Spawns ui-auditor agent via Task tool
// ============================================================
console.log('\nTest 7: Agent spawn');
assert(
  content.includes('ui-auditor'),
  'References ui-auditor agent'
);
assert(
  lowerContent.includes('task') && content.includes('ui-auditor'),
  'Spawns ui-auditor via Task tool'
);

// ============================================================
// Test 8: Model resolution -- sonnet for economy, inherit for quality/premium
// ============================================================
console.log('\nTest 8: Model resolution');
assert(
  lowerContent.includes('economy') && lowerContent.includes('sonnet'),
  'Economy mode uses sonnet'
);
assert(
  lowerContent.includes('quality') || lowerContent.includes('premium'),
  'References quality/premium modes'
);

// ============================================================
// Test 9: Handles agent return and presents results summary
// ============================================================
console.log('\nTest 9: Agent return handling');
assert(
  lowerContent.includes('pillar') && lowerContent.includes('score'),
  'Displays pillar scores from agent return'
);
assert(
  content.includes('/24') || (lowerContent.includes('overall') && lowerContent.includes('score')),
  'Shows overall score out of 24'
);
assert(
  lowerContent.includes('top 3') || lowerContent.includes('priority fix'),
  'Shows top 3 priority fixes'
);

// ============================================================
// Test 10: Completion menu with Custom as last option
// ============================================================
console.log('\nTest 10: Completion menu');
assert(
  lowerContent.includes('askuserquestion'),
  'Uses AskUserQuestion for completion menu'
);
assert(
  content.includes('"Custom"') || content.includes("'Custom'"),
  'Menu includes Custom option'
);
// Check that Custom is the last option in at least one menu
const menuMatches = content.match(/options:\s*\[([^\]]+)\]/g);
if (menuMatches) {
  const hasCustomLast = menuMatches.some(m => m.trimEnd().endsWith('"Custom"]') || m.trimEnd().endsWith("'Custom']"));
  assert(
    hasCustomLast,
    'Custom is the last option in completion menu'
  );
} else {
  failed++;
  console.log('  FAIL: No options arrays found in menus');
}

// ============================================================
// Test 11: Updates STATE.md after review
// ============================================================
console.log('\nTest 11: STATE.md update');
assert(
  lowerContent.includes('update') && lowerContent.includes('state.md'),
  'Updates STATE.md after review'
);
assert(
  lowerContent.includes('last action') || lowerContent.includes('last_action'),
  'Updates Last Action in STATE.md'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
