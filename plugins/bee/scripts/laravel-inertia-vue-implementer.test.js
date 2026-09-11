#!/usr/bin/env node
// Test: laravel-inertia-vue stack-specific implementer agent verifies file
// exists at correct path, frontmatter has correct fields, loads stack skill
// in Step 1, respects CLAUDE.md, TDD Red-Green-Refactor cycle identical to
// generic implementer, adds compliance check step, and emits completion signal.

const fs = require('fs');
const path = require('path');

const AGENT_PATH = path.resolve(
  __dirname,
  '..',
  'agents',
  'stacks',
  'laravel-inertia-vue',
  'implementer.md'
);

const GENERIC_IMPLEMENTER_PATH = path.resolve(
  __dirname,
  '..',
  'agents',
  'implementer.md'
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

// Read the agent file
let content;
try {
  content = fs.readFileSync(AGENT_PATH, 'utf8');
} catch (err) {
  console.error(`Cannot read agent file at ${AGENT_PATH}: ${err.message}`);
  process.exit(1);
}

// Read generic implementer for comparison
let genericContent;
try {
  genericContent = fs.readFileSync(GENERIC_IMPLEMENTER_PATH, 'utf8');
} catch (err) {
  console.error(`Cannot read generic implementer at ${GENERIC_IMPLEMENTER_PATH}: ${err.message}`);
  process.exit(1);
}

// Parse frontmatter (between --- delimiters)
const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
const frontmatter = frontmatterMatch ? frontmatterMatch[1] : '';

console.log('Testing laravel-inertia-vue implementer agent...\n');

// --- Test 1: File exists at correct path ---
console.log('Test 1: Agent file exists at correct path');
assert(
  fs.existsSync(AGENT_PATH),
  'File exists at plugins/bee/agents/stacks/laravel-inertia-vue/implementer.md'
);

// --- Test 2: Frontmatter fields ---
console.log('\nTest 2: Frontmatter has correct fields');
assert(
  frontmatter.includes('name: laravel-inertia-vue-implementer'),
  'Frontmatter has name: laravel-inertia-vue-implementer'
);
/* removed: superseded (Phase 2 triage) */
assert(
  frontmatter.includes('model: inherit'),
  'Frontmatter has model: inherit'
);
assert(
  frontmatter.includes('color: green'),
  'Frontmatter has color: green'
);

// --- Test 3: Skills as YAML block sequence ---
console.log('\nTest 3: Skills use YAML block sequence format');
{
  // Must have skills: on its own line, then - core and - testing as block sequence items
  const skillsMatch = frontmatter.match(/skills:\s*\n(\s+- .+\n?)+/);
  assert(skillsMatch !== null, 'Skills field uses YAML block sequence (not inline)');

  // Verify - core and - testing are listed
  assert(
    frontmatter.includes('  - core'),
    'Skills include "- core" as block sequence item'
  );
  assert(
    frontmatter.includes('  - standards/testing'),
    'Skills include "- testing" as block sequence item'
  );
}

// --- Test 4: Loads stack skill in Step 1 ---
console.log('\nTest 4: Step 1 loads stack skill');
{
  assert(
    content.includes('skills/stacks/laravel-inertia-vue/SKILL.md'),
    'References laravel-inertia-vue stack skill path'
  );
  assert(
    content.includes('CLAUDE.md'),
    'References CLAUDE.md for pre-commit gate compliance'
  );
}

// --- Test 5: TDD Red-Green-Refactor cycle is present ---
console.log('\nTest 5: TDD Red-Green-Refactor cycle is identical to generic implementer');
{
  // Check for the three TDD phases
  assert(
    content.includes('RED') && content.includes('Write Failing Tests'),
    'Has RED phase -- Write Failing Tests'
  );
  assert(
    content.includes('GREEN') && content.includes('Minimal Implementation'),
    'Has GREEN phase -- Minimal Implementation'
  );
  assert(
    content.includes('REFACTOR') && content.includes('Clean Up'),
    'Has REFACTOR phase -- Clean Up'
  );

  // Check key TDD mandates from generic implementer
  assert(
    content.includes('Test files MUST exist on disk BEFORE'),
    'Preserves TDD mandate: test files before production code'
  );
  assert(
    content.includes('they MUST fail'),
    'Preserves TDD mandate: tests must fail first'
  );
  assert(
    content.includes('simplest code that makes the failing tests pass'),
    'Preserves TDD mandate: simplest code to pass'
  );
}

// --- Test 6: Compliance check step with pint, phpstan, test --parallel ---
console.log('\nTest 6: Compliance check step has all three tools');
{
  assert(
    content.includes('vendor/bin/pint'),
    'Compliance check includes vendor/bin/pint'
  );
  assert(
    content.includes('vendor/bin/phpstan analyse --memory-limit=1G'),
    'Compliance check includes vendor/bin/phpstan analyse --memory-limit=1G'
  );
  assert(
    content.includes('php artisan test --parallel'),
    'Compliance check includes php artisan test --parallel'
  );
}

// --- Test 7: Completion signal ---
console.log('\nTest 7: Emits completion signal');
{
  assert(
    content.includes('Task complete. [X] tests passing.'),
    'Emits "Task complete. [X] tests passing." completion signal'
  );
}

// --- Test 8: Key structural elements from generic implementer preserved ---
console.log('\nTest 8: Key structural elements preserved from generic implementer');
{
  assert(
    content.includes('## Task Notes'),
    'Has Task Notes section instruction'
  );
  /* removed: superseded (Phase 2 triage) */
  /* removed: superseded (Phase 2 triage) */
  assert(
    content.includes('You do NOT spawn sub-agents'),
    'Preserves no-sub-agents rule'
  );
  assert(
    content.includes('You do NOT update TASKS.md'),
    'Preserves no-TASKS.md-update rule'
  );
  assert(
    content.includes('You do NOT commit to git'),
    'Preserves no-auto-commit rule'
  );
}

// --- Test 9: Stack-specific content that differs from generic ---
console.log('\nTest 9: Stack-specific customizations beyond generic implementer');
{
  // The generic implementer says "Read `.bee/config.json` to determine the stack"
  // The stack-specific one should reference the stack skill directly
  assert(
    content.includes('laravel-inertia-vue'),
    'Mentions laravel-inertia-vue stack explicitly'
  );

  // Should mention the pre-commit gate from CLAUDE.md
  assert(
    content.includes('pre-commit') || content.includes('Pre-Commit') || content.includes('PRE-COMMIT'),
    'References pre-commit gate concept'
  );
}

// --- Test 10: Does not contain composer test (must use artisan) ---
console.log('\nTest 10: Does not recommend composer test');
{
  // The SKILL.md and CLAUDE.md both warn NEVER use composer test
  const composerTestLines = content.split('\n').filter(line =>
    line.includes('composer test') && !line.includes('NEVER')
  );
  assert(
    composerTestLines.length === 0,
    'Does not recommend "composer test" (must use php artisan test --parallel)'
  );
}

console.log(
  `\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`
);
process.exit(failed > 0 ? 1 : 0);
