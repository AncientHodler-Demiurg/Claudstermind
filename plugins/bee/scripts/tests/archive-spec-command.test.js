#!/usr/bin/env node
// Test: archive-spec.md command file has correct frontmatter, dynamic context,
// all required steps (guards, pre-archive checklist, confirm, move, reset STATE,
// bump version, summary), and follows command conventions.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'archive-spec.md'
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
  // Match next heading of same or higher level (### or ##)
  const headingLevel = sectionHeading.match(/^#+/);
  if (!headingLevel) return afterHeading;
  const level = headingLevel[0].length;
  // Find next heading with level <= current level
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
  console.log('FAIL: archive-spec.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

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
// Test 2: Dynamic context reads STATE.md and config.json
// ============================================================
console.log('\nTest 2: Dynamic context');
assert(
  content.includes('STATE.md') && content.includes('config.json'),
  'Dynamic context reads STATE.md and config.json'
);
assert(
  content.includes('NOT_INITIALIZED'),
  'References NOT_INITIALIZED for missing STATE.md'
);

// ============================================================
// Test 3: Step 1 - Guards (NOT_INITIALIZED, no active spec, spec dir not on disk)
// ============================================================
console.log('\nTest 3: Step 1 - Guards');
const step1Content = contentBetweenSections('### Step 1', content);
assert(
  step1Content.toLowerCase().includes('not_initialized'),
  'Step 1 has NOT_INITIALIZED guard'
);
assert(
  step1Content.toLowerCase().includes('no_spec') ||
  step1Content.toLowerCase().includes('no active spec') ||
  step1Content.toLowerCase().includes('(none)'),
  'Step 1 has no active spec guard'
);
assert(
  step1Content.toLowerCase().includes('spec dir') ||
  step1Content.toLowerCase().includes('spec folder') ||
  step1Content.toLowerCase().includes('spec path') ||
  step1Content.toLowerCase().includes('directory'),
  'Step 1 checks spec directory on disk'
);

// ============================================================
// Test 4: Step 2 - Pre-archive checklist
// ============================================================
console.log('\nTest 4: Step 2 - Pre-archive checklist');
const step2Content = contentBetweenSections('### Step 2', content);
assert(
  step2Content.toLowerCase().includes('committed'),
  'Step 2 checks phase COMMITTED status'
);
assert(
  step2Content.toLowerCase().includes('warn') ||
  step2Content.toLowerCase().includes('warning'),
  'Step 2 warns about uncommitted phases'
);
assert(
  step2Content.toLowerCase().includes('archive anyway') ||
  step2Content.toLowerCase().includes('continue') ||
  step2Content.toLowerCase().includes('proceed'),
  'Step 2 asks user to confirm archiving with uncommitted phases'
);

// ============================================================
// Test 5: Step 3 - Confirm archive
// ============================================================
console.log('\nTest 5: Step 3 - Confirm archive');
const step3Content = contentBetweenSections('### Step 3', content);
assert(
  step3Content.toLowerCase().includes('spec name') ||
  step3Content.toLowerCase().includes('spec path') ||
  step3Content.toLowerCase().includes('display'),
  'Step 3 displays spec name/path'
);
assert(
  step3Content.toLowerCase().includes('yes') ||
  step3Content.toLowerCase().includes('confirm'),
  'Step 3 asks yes/no confirmation'
);

// ============================================================
// Test 6: Step 4 - Move spec
// ============================================================
console.log('\nTest 6: Step 4 - Move spec');
const step4Content = contentBetweenSections('### Step 4', content);
assert(
  step4Content.includes('.bee/archive/') || step4Content.includes('.bee/archive'),
  'Step 4 references .bee/archive/ directory'
);
assert(
  step4Content.toLowerCase().includes('mkdir') ||
  step4Content.toLowerCase().includes('create'),
  'Step 4 creates archive directory (mkdir -p)'
);
assert(
  step4Content.toLowerCase().includes('mv') ||
  step4Content.toLowerCase().includes('move'),
  'Step 4 moves the spec directory'
);
assert(
  step4Content.toLowerCase().includes('verify') ||
  step4Content.toLowerCase().includes('confirm') ||
  step4Content.toLowerCase().includes('test -d') ||
  step4Content.toLowerCase().includes('check'),
  'Step 4 verifies the move operation'
);

// ============================================================
// Test 7: Step 5 - Reset STATE.md (double-write: ARCHIVED then NO_SPEC)
// ============================================================
console.log('\nTest 7: Step 5 - Reset STATE.md');
const step5Content = contentBetweenSections('### Step 5', content);
assert(
  step5Content.includes('ARCHIVED'),
  'Step 5 sets ARCHIVED status'
);
assert(
  step5Content.includes('NO_SPEC'),
  'Step 5 sets NO_SPEC status'
);
assert(
  step5Content.includes('(none)'),
  'Step 5 clears name/path to "(none)"'
);
assert(
  step5Content.toLowerCase().includes('phases') ||
  step5Content.toLowerCase().includes('table'),
  'Step 5 mentions preserving/leaving Phases table'
);
assert(
  step5Content.toLowerCase().includes('double') ||
  step5Content.toLowerCase().includes('two writes') ||
  step5Content.toLowerCase().includes('write again') ||
  step5Content.toLowerCase().includes('second write') ||
  (step5Content.toLowerCase().includes('first') && step5Content.toLowerCase().includes('then')),
  'Step 5 describes double-write pattern (ARCHIVED then NO_SPEC)'
);

// ============================================================
// Test 8: Ceremony does NOT bump plugin version (downstream-safe)
// ============================================================
console.log('\nTest 8: Ceremony does NOT bump plugin version');

// The /bee:archive-spec ceremony must NOT mutate plugin.json. Downstream
// users running this command in their own projects must not have the bee
// plugin's install cache (or any other plugin.json) silently rewritten.
// Bee plugin versions are managed manually by the plugin author.

assert(
  !/Bump Plugin Version/i.test(content) &&
  !/Plugin version bumped:/i.test(content),
  'Command does NOT contain a "Bump Plugin Version" step'
);

assert(
  !/Write the updated plugin\.json back to disk/i.test(content) &&
  !/increment.{0,20}PATCH/i.test(content),
  'Command does NOT instruct writing to plugin.json or incrementing PATCH'
);

assert(
  !/\$\{CLAUDE_PLUGIN_ROOT\}.{0,40}plugin\.json/.test(content),
  'Command does NOT reference ${CLAUDE_PLUGIN_ROOT}/.../plugin.json (write fallback)'
);

// ============================================================
// Test 9: Step 6 - Summary (renumbered after bump removal)
// ============================================================
console.log('\nTest 9: Step 6 - Summary');
const step6Content = contentBetweenSections('### Step 6', content);
assert(
  step6Content.toLowerCase().includes('archived') ||
  step6Content.toLowerCase().includes('archive'),
  'Step 6 displays archived path'
);
assert(
  step6Content.includes('NO_SPEC'),
  'Step 6 shows NO_SPEC state'
);
assert(
  step6Content.includes('/bee:new-spec'),
  'Step 6 suggests /bee:new-spec'
);

// ============================================================
// Test 10: Never auto-commits
// ============================================================
console.log('\nTest 10: No auto-commit');
assert(
  content.toLowerCase().includes('never auto-commit') ||
  content.toLowerCase().includes('never auto commit') ||
  content.toLowerCase().includes('does not commit') ||
  content.toLowerCase().includes('no auto-commit') ||
  content.toLowerCase().includes('not auto-commit') ||
  content.toLowerCase().includes('never commits') ||
  content.toLowerCase().includes('not commit'),
  'Command explicitly states it never auto-commits'
);

// ============================================================
// Test 11: Read-Modify-Write pattern used
// ============================================================
console.log('\nTest 11: Read-Modify-Write pattern');
assert(
  content.toLowerCase().includes('read') &&
  content.toLowerCase().includes('write') &&
  (content.toLowerCase().includes('re-read') ||
   content.toLowerCase().includes('fresh read') ||
   content.toLowerCase().includes('read-modify-write') ||
   content.toLowerCase().includes('read current')),
  'Command follows Read-Modify-Write pattern for state updates'
);

// ============================================================
// Test 12: Design Notes section exists
// ============================================================
console.log('\nTest 12: Design Notes');
assert(
  content.includes('**Design Notes'),
  'Command has a Design Notes section'
);

// ============================================================
// Test 13: Step 4.5 - terminalize spec in multi-spec registry
// ============================================================
console.log('\nTest 13: Step 4.5 - terminalize spec in multi-spec registry');
assert(
  content.includes('### Step 4.5'),
  'Step 4.5 (Close the spec in the multi-spec registry) exists'
);
assert(
  content.includes('specs-cli.js set-stage'),
  'Step 4.5 invokes specs-cli.js set-stage'
);
assert(
  content.includes('--stage archived'),
  'Step 4.5 uses --stage archived for archive ceremony'
);
assert(
  content.includes('unknown spec') || content.includes('legacy spec'),
  'Step 4.5 handles legacy specs gracefully (unknown spec / legacy spec)'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
