#!/usr/bin/env node
// Test: laravel-inertia-vue stack-specific bug-detector agent validates
// frontmatter, Laravel-specific bug categories, CLAUDE.md reading,
// output format matching generic bug-detector, and read-only notices.

const fs = require('fs');
const path = require('path');

const AGENT_FILE = path.join(
  __dirname, '..', 'agents', 'stacks', 'laravel-inertia-vue', 'bug-detector.md'
);
const GENERIC_BUG_DETECTOR = path.join(__dirname, '..', 'agents', 'bug-detector.md');
const LARAVEL_REVIEWER = path.join(
  __dirname, '..', '..', '..', 'archive', 'agents', 'laravel-reviewer.md'
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

// Read reference files
const genericContent = fs.readFileSync(GENERIC_BUG_DETECTOR, 'utf8');

console.log('Testing laravel-inertia-vue bug-detector agent...\n');

// Test 1: Agent file exists
console.log('Test 1: Agent file exists at correct path');
assert(
  fs.existsSync(AGENT_FILE),
  'plugins/bee/agents/stacks/laravel-inertia-vue/bug-detector.md exists'
);

// Only proceed if file exists
if (!fs.existsSync(AGENT_FILE)) {
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  process.exit(failed > 0 ? 1 : 0);
}

const content = fs.readFileSync(AGENT_FILE, 'utf8');

// Test 2: Frontmatter has correct name
console.log('\nTest 2: Frontmatter has correct name');
assert(
  content.includes('name: laravel-inertia-vue-bug-detector'),
  'name is laravel-inertia-vue-bug-detector'
);

// Test 3: Frontmatter has correct tools
console.log('\nTest 3: Frontmatter has correct tools');
assert(
  content.includes('tools: Read, Glob, Grep, mcp__context7__resolve-library-id, mcp__context7__query-docs'),
  'tools match required set'
);

// Test 4: Frontmatter has correct color
console.log('\nTest 4: Frontmatter has correct color');
assert(
  content.includes('color: red'),
  'color is red'
);

// Test 5: Frontmatter has correct model
console.log('\nTest 5: Frontmatter has correct model');
assert(
  content.includes('model: inherit'),
  'model is inherit'
);

// Test 6: Frontmatter has skills with core as YAML block sequence
console.log('\nTest 6: Frontmatter has skills with core as YAML block sequence');
{
  // Extract frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  assert(fmMatch !== null, 'frontmatter exists');
  if (fmMatch) {
    const fm = fmMatch[1];
    // Skills should use YAML block sequence format: "skills:\n  - core"
    assert(
      fm.includes('skills:') && fm.includes('  - core'),
      'skills uses YAML block sequence with core'
    );
  }
}

// Test 7: Agent loads laravel-inertia-vue stack skill
console.log('\nTest 7: Agent loads laravel-inertia-vue stack skill');
assert(
  content.includes('skills/stacks/laravel-inertia-vue/SKILL.md'),
  'references laravel-inertia-vue stack skill path'
);

// Test 8: Incorporates Laravel-specific bug categories from archive/agents/laravel-reviewer.md
console.log('\nTest 8: Incorporates Laravel-specific bug categories');
{
  const laravelReviewerContent = fs.readFileSync(LARAVEL_REVIEWER, 'utf8');

  // Key Laravel-specific rules that should be incorporated
  assert(
    content.includes('Event::listen()') || content.includes('Event::listen'),
    'includes Event::listen() anti-pattern from laravel-reviewer'
  );
  assert(
    content.includes('routes/console.php') || content.includes('console.php'),
    'includes scheduling anti-pattern (routes/console.php) from laravel-reviewer'
  );
  assert(
    content.includes('N+1') || content.includes('eager load'),
    'includes N+1 / eager loading check from laravel-reviewer'
  );
  assert(
    content.includes('notifications') && content.includes('race condition'),
    'includes notification race condition pattern from laravel-reviewer'
  );
  assert(
    content.includes('constructor injection') || content.includes('dependency injection') || content.includes('app()'),
    'includes dependency injection rules from laravel-reviewer'
  );
}

// Test 9: Respects project CLAUDE.md
console.log('\nTest 9: Respects project CLAUDE.md');
assert(
  content.includes('CLAUDE.md'),
  'mentions CLAUDE.md'
);
assert(
  content.includes('higher-priority') || content.includes('override') || content.includes('take precedence'),
  'CLAUDE.md rules override or take precedence'
);

// Test 10: Output format matches generic bug-detector exactly
console.log('\nTest 10: Output format matches generic bug-detector');
{
  // The output section must include the same structure
  assert(
    content.includes('## Bugs Detected'),
    'output format includes ## Bugs Detected heading'
  );
  assert(
    content.includes('### Critical'),
    'output format includes ### Critical subsection'
  );
  assert(
    content.includes('### High'),
    'output format includes ### High subsection'
  );
  assert(
    content.includes('### Medium'),
    'output format includes ### Medium subsection'
  );
  assert(
    content.includes('**Total: X critical, Y high, Z medium**'),
    'output format includes Total line matching generic format'
  );
  assert(
    content.includes('No bugs detected.'),
    'includes "No bugs detected." for clean results'
  );
}

// Test 11: Ends with same read-only IMPORTANT notices as generic bug-detector
console.log('\nTest 11: Ends with same read-only IMPORTANT notices as generic bug-detector');
{
  // Extract the IMPORTANT notices from generic bug detector
  assert(
    content.includes('IMPORTANT: You do NOT modify code. You are read-only. Report findings only.'),
    'includes read-only notice'
  );
  assert(
    content.includes('IMPORTANT: Only report HIGH confidence findings. When in doubt, leave it out.'),
    'includes high confidence notice'
  );
  assert(
    content.includes('IMPORTANT: This agent communicates through the parent command.'),
    'includes parent command communication notice'
  );
}

// Test 12: Agent reads false positives (same as generic)
console.log('\nTest 12: Agent reads false positives');
assert(
  content.includes('false-positives.md'),
  'mentions false-positives.md'
);

// Test 13: Has confidence filtering section (same as generic)
console.log('\nTest 13: Has confidence filtering section');
assert(
  content.includes('Confidence Filtering') || content.includes('confidence'),
  'includes confidence filtering guidance'
);

// Test 14: Laravel-specific categories are in the "What to Look For" or equivalent section
console.log('\nTest 14: Has both generic and Laravel-specific bug categories');
{
  // Generic categories from bug-detector.md that should still be present
  assert(
    content.includes('Logic Errors'),
    'includes generic Logic Errors category'
  );
  assert(
    content.includes('Security') || content.includes('OWASP'),
    'includes generic Security category'
  );
  assert(
    content.includes('Race Condition'),
    'includes generic Race Conditions category'
  );

  // Laravel-specific additions
  assert(
    content.includes('Mass Assignment') || content.includes('mass assignment'),
    'includes mass assignment check (Laravel-specific)'
  );
}

// Test 15: Context7 documentation reference for Laravel-specific libraries
console.log('\nTest 15: Context7 references for Laravel stack');
assert(
  content.includes('Context7') || content.includes('context7'),
  'references Context7 for documentation lookup'
);

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
