#!/usr/bin/env node
// Test: complete-spec.md command file has correct frontmatter, dynamic context,
// all required steps (guards, pre-check, audit inline, changelog, git tag,
// archive, spec history, STATE.md reset + version bump, summary), and follows
// command conventions.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'complete-spec.md'
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
  console.log('FAIL: complete-spec.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: Frontmatter (3 assertions)
// ============================================================
console.log('Test 1: Frontmatter');
assert(
  content.startsWith('---'),
  'File starts with YAML frontmatter delimiter'
);
assert(
  content.includes('description:') &&
  (content.toLowerCase().includes('lifecycle') || content.toLowerCase().includes('ceremony')),
  'Frontmatter has description with "lifecycle" or "ceremony" keyword'
);
assert(
  content.includes('argument-hint:') &&
  content.includes('--skip-audit') &&
  content.includes('--skip-tag'),
  'Frontmatter has argument-hint with --skip-audit and --skip-tag'
);

// ============================================================
// Test 2: Guard tests (3 assertions)
// ============================================================
console.log('\nTest 2: Validation guards');
const step1Content = contentBetweenSections('### Step 1', content);
assert(
  step1Content.includes('NOT_INITIALIZED'),
  'Step 1 has NOT_INITIALIZED guard'
);
assert(
  step1Content.includes('NO_SPEC'),
  'Step 1 has NO_SPEC guard'
);
assert(
  step1Content.toLowerCase().includes('test -d') ||
  step1Content.toLowerCase().includes('spec directory') ||
  step1Content.toLowerCase().includes('directory exists') ||
  step1Content.toLowerCase().includes('directory does not exist'),
  'Step 1 has spec directory guard'
);

// ============================================================
// Test 3: Step 3 audit tests (4 assertions)
// ============================================================
console.log('\nTest 3: Step 3 - Inline audit');
const step3Content = contentBetweenSections('### Step 3', content);
assert(
  step3Content.toLowerCase().includes('traceability') ||
  step3Content.toLowerCase().includes('audit'),
  'Step 3 contains inline audit logic (traceability/audit references)'
);
assert(
  step3Content.includes('--skip-audit'),
  'Step 3 handles --skip-audit flag'
);
assert(
  step3Content.includes('lifecycle.require_audit_before_complete'),
  'Step 3 checks lifecycle.require_audit_before_complete config'
);
assert(
  step3Content.toLowerCase().includes('coverage') &&
  (step3Content.includes('Proceed') || step3Content.includes('Cancel')),
  'Step 3 has coverage percentage check with proceed/cancel option'
);

// ============================================================
// Test 4: Step 4 changelog tests (3 assertions)
// ============================================================
console.log('\nTest 4: Step 4 - Changelog generation');
const step4Content = contentBetweenSections('### Step 4', content);
assert(
  step4Content.includes('CHANGELOG'),
  'Step 4 contains CHANGELOG generation section'
);
assert(
  step4Content.includes('Added') &&
  step4Content.includes('Changed') &&
  step4Content.includes('Fixed'),
  'Step 4 contains Added/Changed/Fixed categories'
);
assert(
  step4Content.toLowerCase().includes('files changed') ||
  (step4Content.toLowerCase().includes('lines added') && step4Content.toLowerCase().includes('lines removed')) ||
  step4Content.toLowerCase().includes('git diff --stat') ||
  step4Content.toLowerCase().includes('git stats'),
  'Step 4 contains git stats (files changed, lines)'
);

// ============================================================
// Test 5: Step 5 git tag tests (3 assertions)
// ============================================================
console.log('\nTest 5: Step 5 - Git tag');
const step5Content = contentBetweenSections('### Step 5', content);
assert(
  step5Content.includes('git tag -a'),
  'Step 5 contains git tag -a command'
);
assert(
  step5Content.includes('--skip-tag'),
  'Step 5 handles --skip-tag flag'
);
assert(
  step5Content.includes('lifecycle.tag_format') ||
  step5Content.includes('spec/{slug}'),
  'Step 5 contains configurable tag format (lifecycle.tag_format or spec/{slug})'
);

// ============================================================
// Test 5.5: archive-memory.sh is retired — Step 5.5 must NOT exist
// ============================================================
console.log('\nTest 5.5: Step 5.5 - Archive Agent Memory retired');
assert(
  !content.includes('### Step 5.5'),
  'Step 5.5 (Archive Agent Memory) has been removed (retired)'
);
assert(
  !content.includes('archive-memory.sh'),
  'complete-spec.md no longer references archive-memory.sh (retired)'
);
assert(
  !content.includes('Archive Agent Memory'),
  'complete-spec.md no longer has "Archive Agent Memory" heading or text'
);
assert(
  content.includes('.bee/archive/'),
  'complete-spec.md still archives the spec folder (carrying memory.md with it)'
);

// ============================================================
// Test 6: Steps 6-7 archive + history tests (3 assertions)
// ============================================================
console.log('\nTest 6: Steps 6-7 - Archive + history');
const step6Content = contentBetweenSections('### Step 6', content);
assert(
  step6Content.includes('.bee/archive/') &&
  (step6Content.toLowerCase().includes('mv') || step6Content.toLowerCase().includes('move')),
  'Step 6 contains archive move (mv to .bee/archive/)'
);
const step7Content = contentBetweenSections('### Step 7', content);
assert(
  step7Content.includes('SPEC-HISTORY.md'),
  'Step 7 contains SPEC-HISTORY.md creation/update'
);
assert(
  step7Content.includes('.bee/history/'),
  'Step 7 references .bee/history/ directory'
);

// ============================================================
// Test 7: Step 8 STATE.md reset tests (2 assertions)
// ============================================================
console.log('\nTest 7: Step 8 - STATE.md reset');
const step8Content = contentBetweenSections('### Step 8', content);
assert(
  step8Content.includes('ARCHIVED'),
  'Step 8 sets ARCHIVED status'
);
assert(
  step8Content.includes('NO_SPEC'),
  'Step 8 sets NO_SPEC status (double-write)'
);

// ============================================================
// Test 8: UX + design tests (3 assertions)
// ============================================================
console.log('\nTest 8: UX + design');
const askCount = (content.match(/AskUserQuestion/g) || []).length;
assert(
  askCount >= 3,
  `Contains at least 3 AskUserQuestion calls (found ${askCount})`
);
assert(
  content.includes('Design Notes'),
  'Contains "Design Notes" section'
);
assert(
  !content.includes('Task(') ||
  content.includes('No `Task(`') ||
  content.includes('not delegated'),
  'Does NOT use agent spawning (no Task( pattern)'
);

// ============================================================
// Test 9: Additional ceremony coverage (3 bonus assertions)
// ============================================================
console.log('\nTest 9: Additional ceremony coverage');
assert(
  content.includes('spec/{slug}'),
  'Tag format default includes spec/{slug} pattern'
);
assert(
  content.toLowerCase().includes('never auto-commit') ||
  content.toLowerCase().includes('does not commit') ||
  content.toLowerCase().includes('not commit anything') ||
  content.toLowerCase().includes('never commits'),
  'Command explicitly states it never auto-commits'
);

// ============================================================
// Test 9b: Ceremony does NOT bump plugin version (downstream-safe)
// ============================================================
console.log('\nTest 9b: Ceremony does NOT bump plugin version');

// The /bee:complete-spec ceremony must NOT mutate plugin.json. Downstream
// users running this command in their own projects must not have the bee
// plugin's install cache (or any other plugin.json) silently rewritten.
// Bee plugin versions are managed manually by the plugin author.

assert(
  !/\*\*Bump plugin version/i.test(content) &&
  !/Plugin version bumped:/i.test(content),
  'Command does NOT contain a "Bump plugin version" sub-block'
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
// Test 10: Step 3c - STATE.md Reviewed column primary, REVIEW.md fallback
// ============================================================
console.log('\nTest 10: Step 3c - STATE.md Reviewed column primary');
assert(
  step3Content.includes('STATE.md') &&
  step3Content.toLowerCase().includes('primary'),
  'Step 3 calls out STATE.md as PRIMARY review source'
);
assert(
  step3Content.toLowerCase().includes('reviewed column'),
  'Step 3 references the Reviewed column explicitly'
);
assert(
  step3Content.toLowerCase().includes('fallback'),
  'Step 3 mentions REVIEW.md as fallback'
);
assert(
  step3Content.includes('Yes (N)') || step3Content.includes('Yes (via STATE.md)'),
  'Step 3 references the Reviewed column value format (Yes (N) / via STATE.md)'
);

// ============================================================
// Test 11: Step 3d - STATE.md Tested column primary, TESTING.md fallback
// ============================================================
console.log('\nTest 11: Step 3d - STATE.md Tested column primary');
assert(
  step3Content.toLowerCase().includes('tested column'),
  'Step 3 references the Tested column explicitly'
);
assert(
  step3Content.includes('Pass') &&
  step3Content.includes('TESTING.md'),
  'Step 3 references the "Pass" Tested value AND TESTING.md fallback'
);
assert(
  step3Content.includes('via STATE.md') || step3Content.includes('via TESTING.md'),
  'Step 3 distinguishes via STATE.md vs via TESTING.md sources for tested status'
);

// ============================================================
// Test 12: Step 3a - ROADMAP.md primary requirement source (3-tier chain)
// ============================================================
console.log('\nTest 12: Step 3a - ROADMAP.md primary requirement source');
assert(
  step3Content.includes('ROADMAP.md') &&
  step3Content.toLowerCase().includes('primary'),
  'Step 3 calls out ROADMAP.md as PRIMARY requirement source'
);
assert(
  step3Content.includes('Phase-Requirement Mapping'),
  'Step 3 references the Phase-Requirement Mapping table in ROADMAP.md'
);
assert(
  step3Content.toLowerCase().includes('secondary') ||
  step3Content.toLowerCase().includes('tertiary') ||
  step3Content.toLowerCase().includes('fallback'),
  'Step 3 describes the fallback chain (secondary/tertiary/fallback)'
);
assert(
  step3Content.toLowerCase().includes('all three sources are empty') ||
  step3Content.toLowerCase().includes('only skip') ||
  step3Content.toLowerCase().includes('all sources'),
  'Step 3 only skips audit when ALL sources are empty'
);

// ============================================================
// Test 13: Step 5 - Tag slug derived from Current Spec Name
// ============================================================
console.log('\nTest 13: Step 5 - Tag slug from Current Spec Name');
assert(
  step5Content.includes('Current Spec Name'),
  'Step 5 derives slug from Current Spec Name (not folder name)'
);
assert(
  step5Content.toLowerCase().includes('kebab'),
  'Step 5 specifies kebab-case normalization'
);
assert(
  step5Content.toLowerCase().includes('v4.0.3') ||
  step5Content.toLowerCase().includes('not rewritten') ||
  step5Content.toLowerCase().includes('backward'),
  'Step 5 contains a backward-compat note about pre-v4.0.3 tags'
);

// ============================================================
// Test 14: Plugin cache drift warning is REMOVED (no bump = no drift)
// ============================================================
console.log('\nTest 14: Plugin cache drift warning is REMOVED');
assert(
  !/plugin cache drift/i.test(content) &&
  !content.includes('~/.claude/plugins/cache') &&
  !/reload-plugins/i.test(content),
  'Command does NOT contain the plugin cache drift warning (no bump = no drift)'
);

// ============================================================
// Test 15: Step 8 - STATE.md pruning to archive
// ============================================================
console.log('\nTest 15: Step 8 - STATE.md pruning to archive');
assert(
  step8Content.includes('DECISIONS.md'),
  'Step 8 writes Decisions Log entries to DECISIONS.md'
);
assert(
  step8Content.includes('LAST-ACTIONS.md'),
  'Step 8 writes Previous Last Action sections to LAST-ACTIONS.md'
);
assert(
  step8Content.toLowerCase().includes('prun') ||
  step8Content.toLowerCase().includes('truncat'),
  'Step 8 describes pruning/truncation of STATE.md'
);
assert(
  step8Content.includes('Previous Last Action'),
  'Step 8 explicitly references Previous Last Action sections'
);
assert(
  step8Content.includes('Decisions Log'),
  'Step 8 explicitly references Decisions Log section'
);

// ============================================================
// Test 16: Step 4 - CHANGELOG hybrid source (Decisions Log + git log)
// ============================================================
console.log('\nTest 16: Step 4 - CHANGELOG hybrid source');
assert(
  step4Content.includes('Decisions Log'),
  'Step 4 references the Decisions Log as a source'
);
assert(
  step4Content.match(/test:|chore:|refactor:/) !== null,
  'Step 4 references Conventional Commits prefixes (test:/chore:/refactor:)'
);
assert(
  step4Content.toLowerCase().includes('hybrid') ||
  step4Content.toLowerCase().includes('auto-extract') ||
  step4Content.toLowerCase().includes('auto extract'),
  'Step 4 calls out the hybrid / auto-extract source strategy'
);
assert(
  step4Content.toLowerCase().includes('git log'),
  'Step 4 references git log for commit message extraction'
);
assert(
  step4Content.match(/F-\d+|D-\d+|Q-\d+/) !== null ||
  step4Content.includes('F-\\d+') ||
  step4Content.includes('Q-\\d+') ||
  step4Content.includes('[F-') ||
  step4Content.includes('[Q-'),
  'Step 4 references fix marker patterns ([F-NNN], [Q-N], etc.)'
);

// ============================================================
// Test 17: Step 6.5 - terminalize spec in multi-spec registry
// ============================================================
console.log('\nTest 17: Step 6.5 - terminalize spec in multi-spec registry');
assert(
  content.includes('### Step 6.5'),
  'Step 6.5 (Close the spec in the multi-spec registry) exists'
);
assert(
  content.includes('specs-cli.js set-stage'),
  'Step 6.5 invokes specs-cli.js set-stage'
);
assert(
  content.includes('--stage shipped'),
  'Step 6.5 uses --stage shipped for complete ceremony'
);
assert(
  content.includes('unknown spec') || content.includes('legacy spec'),
  'Step 6.5 handles legacy specs gracefully (unknown spec / legacy spec)'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
