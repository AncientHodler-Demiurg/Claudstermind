#!/usr/bin/env node
// Test: ui-spec.md command file has correct frontmatter, NOT_INITIALIZED guard,
// ROADMAP.md phase discovery with fallback, AskUserQuestion for phase selection,
// frontend relevance keyword detection, phase TASKS.md context loading,
// UI-SPEC.md generation with 5 required sections (component specs, accessibility/WCAG AA,
// responsive breakpoints, interaction flows, visual acceptance criteria),
// output to phase directory, STATE.md update, and completion menu with Custom last.

const fs = require('fs');
const path = require('path');

const CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'ui-spec.md'
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
  console.log('FAIL: ui-spec.md does not exist at expected path');
  console.log(`  Expected: ${CMD_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lowerContent = content.toLowerCase();
const frontmatter = extractFrontmatter(content);

// ============================================================
// Test 1: ui-spec.md exists
// ============================================================
console.log('Test 1: File exists');
assert(
  fs.existsSync(CMD_PATH),
  'ui-spec.md exists at plugins/bee/commands/ui-spec.md'
);

// ============================================================
// Test 2: YAML frontmatter with description containing "UI" and argument-hint containing "phase"
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
  /description:.*(?:UI|ui-spec|design contract|ui spec)/i.test(frontmatter),
  'Description mentions UI, ui-spec, or design contract'
);
assert(
  frontmatter.includes('argument-hint:'),
  'Frontmatter has argument-hint field'
);
assert(
  /argument-hint:.*phase/i.test(frontmatter),
  'argument-hint references phase'
);

// ============================================================
// Test 3: NOT_INITIALIZED guard checking .bee/STATE.md
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
// Test 4: Reads config.json for implementation_mode
// ============================================================
console.log('\nTest 4: Config loading');
assert(
  content.includes('config.json'),
  'References config.json'
);

// ============================================================
// Test 5: Reads ROADMAP.md to discover phases (with fallback if missing)
// ============================================================
console.log('\nTest 5: ROADMAP.md phase discovery');
assert(
  content.includes('ROADMAP.md'),
  'References ROADMAP.md for phase discovery'
);
assert(
  lowerContent.includes('fallback') || lowerContent.includes('if not found') ||
  lowerContent.includes('if missing') || lowerContent.includes('does not exist') ||
  lowerContent.includes('backward compat') || lowerContent.includes('no roadmap'),
  'Has fallback when ROADMAP.md is missing'
);

// ============================================================
// Test 6: Uses AskUserQuestion for phase selection when not provided via $ARGUMENTS
// ============================================================
console.log('\nTest 6: AskUserQuestion for phase selection');
assert(
  content.includes('AskUserQuestion'),
  'Uses AskUserQuestion'
);
assert(
  lowerContent.includes('$arguments') || lowerContent.includes('argument'),
  'Checks for arguments before asking'
);
assert(
  lowerContent.includes('which phase') || lowerContent.includes('select') ||
  lowerContent.includes('target phase'),
  'Asks user to select target phase'
);

// ============================================================
// Test 7: Detects frontend relevance via keyword matching
// ============================================================
console.log('\nTest 7: Frontend relevance keyword detection');
assert(
  lowerContent.includes('frontend') || lowerContent.includes('front-end'),
  'References frontend keyword'
);
assert(
  lowerContent.includes('component'),
  'References component keyword'
);
assert(
  (lowerContent.includes('ui') || lowerContent.includes('user interface')) &&
  (lowerContent.includes('keyword') || lowerContent.includes('detect') ||
   lowerContent.includes('scan') || lowerContent.includes('match')),
  'Detects UI relevance via keyword matching/scanning'
);

// ============================================================
// Test 8: Reads target phase TASKS.md and spec files for context
// ============================================================
console.log('\nTest 8: Phase context loading');
assert(
  content.includes('TASKS.md'),
  'References TASKS.md for phase context'
);
assert(
  content.includes('SPEC.md') || content.includes('spec'),
  'References spec files for context'
);

// ============================================================
// Test 9: Generates UI-SPEC.md with component specifications section
// ============================================================
console.log('\nTest 9: Component specifications section');
assert(
  content.includes('UI-SPEC.md'),
  'References UI-SPEC.md output'
);
assert(
  lowerContent.includes('component specification') || lowerContent.includes('component spec'),
  'Has component specifications section'
);

// ============================================================
// Test 10: Generates UI-SPEC.md with accessibility requirements (WCAG AA)
// ============================================================
console.log('\nTest 10: Accessibility requirements');
assert(
  content.includes('WCAG') || content.includes('wcag'),
  'References WCAG standard'
);
assert(
  lowerContent.includes('accessibility') || lowerContent.includes('a11y'),
  'Has accessibility requirements section'
);

// ============================================================
// Test 11: Generates UI-SPEC.md with responsive breakpoints (mobile, tablet, desktop)
// ============================================================
console.log('\nTest 11: Responsive breakpoints');
assert(
  lowerContent.includes('breakpoint') || lowerContent.includes('responsive'),
  'Has responsive breakpoints section'
);
assert(
  lowerContent.includes('mobile') && lowerContent.includes('tablet') && lowerContent.includes('desktop'),
  'Includes mobile, tablet, and desktop breakpoints'
);

// ============================================================
// Test 12: Generates UI-SPEC.md with interaction flows section
// ============================================================
console.log('\nTest 12: Interaction flows');
assert(
  lowerContent.includes('interaction flow') || lowerContent.includes('interaction'),
  'Has interaction flows section'
);

// ============================================================
// Test 13: Generates UI-SPEC.md with visual acceptance criteria
// ============================================================
console.log('\nTest 13: Visual acceptance criteria');
assert(
  lowerContent.includes('visual acceptance') || lowerContent.includes('acceptance criteria'),
  'Has visual acceptance criteria section'
);

// ============================================================
// Test 14: Writes output to the target phase directory as UI-SPEC.md
// ============================================================
console.log('\nTest 14: Output to phase directory');
assert(
  content.includes('UI-SPEC.md') && (
    lowerContent.includes('write') || lowerContent.includes('create') ||
    lowerContent.includes('output')
  ),
  'Writes UI-SPEC.md to target phase directory'
);
assert(
  lowerContent.includes('phase directory') || lowerContent.includes('target phase') ||
  lowerContent.includes('phase dir'),
  'Specifies phase directory as output location'
);

// ============================================================
// Test 15: Has completion menu with "Custom" as last option
// ============================================================
console.log('\nTest 15: Completion menu with Custom last');
assert(
  content.includes('Custom'),
  'Has Custom option in menus'
);
// Check that Custom appears as the last option in at least one AskUserQuestion block
const askBlocks = content.match(/AskUserQuestion\([\s\S]*?\)/g) || [];
const hasCustomLast = askBlocks.some(block => {
  const optionsMatch = block.match(/options:\s*\[([\s\S]*?)\]/);
  if (!optionsMatch) return false;
  const options = optionsMatch[1].trim();
  return options.endsWith('"Custom"') || options.endsWith("'Custom'");
});
assert(
  hasCustomLast,
  'Custom is the last option in at least one AskUserQuestion menu'
);

// ============================================================
// Test 16: Updates STATE.md after generation
// ============================================================
console.log('\nTest 16: STATE.md update');
assert(
  lowerContent.includes('update') && lowerContent.includes('state.md'),
  'Updates STATE.md after generation'
);
assert(
  lowerContent.includes('last action') || lowerContent.includes('ui-spec') ||
  lowerContent.includes('/bee:ui-spec'),
  'Records ui-spec action in STATE.md'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
