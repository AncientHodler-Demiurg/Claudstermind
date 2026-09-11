#!/usr/bin/env node
// Test: Enrich laravel-inertia-react stack skill with structured sections.
// Validates that SKILL.md contains 5 enrichment sections with required entries,
// sourced from existing skill + archive/CLAUDE.md backend rules.

const fs = require('fs');
const path = require('path');

const SKILL_MD = path.join(
  __dirname,
  '..',
  'skills',
  'stacks',
  'laravel-inertia-react',
  'SKILL.md'
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

const content = fs.readFileSync(SKILL_MD, 'utf8');

// ============================================================
// Test 1: All 5 required sections exist as ## headings
// ============================================================
console.log('Test 1: All 5 required sections exist');

const REQUIRED_SECTIONS = [
  'Must-Haves',
  'Good Practices',
  'Common Bugs',
  'Anti-Patterns',
  'Standards',
];

for (const section of REQUIRED_SECTIONS) {
  assert(
    content.includes(`## ${section}`),
    `Section "## ${section}" exists`
  );
}

// ============================================================
// Test 2: Must-Haves section contains required entries
// ============================================================
console.log('\nTest 2: Must-Haves section contains required entries');

// Extract Must-Haves section content (from ## Must-Haves to next ## heading)
const mustHavesMatch = content.match(
  /## Must-Haves\n([\s\S]*?)(?=\n## [A-Z])/
);
const mustHavesContent = mustHavesMatch ? mustHavesMatch[1] : '';

assert(mustHavesContent.length > 0, 'Must-Haves section has content');

const MUST_HAVE_ENTRIES = [
  'FormRequest',
  'Gate::authorize',
  'TypeScript',
  'useForm',
  'TDD',
];

for (const entry of MUST_HAVE_ENTRIES) {
  assert(
    mustHavesContent.includes(entry),
    `Must-Haves mentions "${entry}"`
  );
}

// Must-Haves should have at least 5 bullet entries
const mustHavesBullets = mustHavesContent
  .split('\n')
  .filter((line) => line.trim().startsWith('-'));
assert(
  mustHavesBullets.length >= 5,
  `Must-Haves has at least 5 entries (found ${mustHavesBullets.length})`
);

// ============================================================
// Test 3: Good Practices section contains required entries
// ============================================================
console.log('\nTest 3: Good Practices section contains required entries');

const goodPracticesMatch = content.match(
  /## Good Practices\n([\s\S]*?)(?=\n## [A-Z])/
);
const goodPracticesContent = goodPracticesMatch
  ? goodPracticesMatch[1]
  : '';

assert(goodPracticesContent.length > 0, 'Good Practices section has content');

const GOOD_PRACTICE_ENTRIES = [
  { term: 'thin controller', pattern: /thin controller/i },
  { term: 'dependency injection', pattern: /dependency injection|DI rule|constructor inject/i },
  { term: 'partial reload', pattern: /partial reload/i },
  { term: 'custom hook', pattern: /custom hook/i },
  { term: 'React.memo', pattern: /React\.memo|React memo/i },
];

for (const entry of GOOD_PRACTICE_ENTRIES) {
  assert(
    entry.pattern.test(goodPracticesContent),
    `Good Practices mentions "${entry.term}"`
  );
}

const goodPracticesBullets = goodPracticesContent
  .split('\n')
  .filter((line) => line.trim().startsWith('-'));
assert(
  goodPracticesBullets.length >= 5,
  `Good Practices has at least 5 entries (found ${goodPracticesBullets.length})`
);

// ============================================================
// Test 4: Common Bugs section contains required entries
// ============================================================
console.log('\nTest 4: Common Bugs section contains required entries');

const commonBugsMatch = content.match(
  /## Common Bugs\n([\s\S]*?)(?=\n## [A-Z])/
);
const commonBugsContent = commonBugsMatch ? commonBugsMatch[1] : '';

assert(commonBugsContent.length > 0, 'Common Bugs section has content');

const COMMON_BUG_ENTRIES = [
  { term: 'N+1 queries', pattern: /N\+1/i },
  { term: 'direct prop mutation', pattern: /prop mutation|mutating props|mutate.*props/i },
  { term: 'missing null checks', pattern: /null check/i },
  { term: 'stale closures', pattern: /stale closure/i },
  { term: 'CSRF missing', pattern: /CSRF/i },
];

for (const entry of COMMON_BUG_ENTRIES) {
  assert(
    entry.pattern.test(commonBugsContent),
    `Common Bugs mentions "${entry.term}"`
  );
}

const commonBugsBullets = commonBugsContent
  .split('\n')
  .filter((line) => line.trim().startsWith('-'));
assert(
  commonBugsBullets.length >= 5,
  `Common Bugs has at least 5 entries (found ${commonBugsBullets.length})`
);

// ============================================================
// Test 5: Anti-Patterns section contains required entries
// ============================================================
console.log('\nTest 5: Anti-Patterns section contains required entries');

const antiPatternsMatch = content.match(
  /## Anti-Patterns\n([\s\S]*?)(?=\n## [A-Z])/
);
const antiPatternsContent = antiPatternsMatch
  ? antiPatternsMatch[1]
  : '';

assert(antiPatternsContent.length > 0, 'Anti-Patterns section has content');

const ANTI_PATTERN_ENTRIES = [
  { term: 'business logic in controllers', pattern: /business logic.*controller/i },
  { term: 'class components', pattern: /class component/i },
  { term: 'inline styles', pattern: /inline style/i },
  { term: 'synchronous ops', pattern: /synchronous|blocking.*operation|sync.*operation/i },
  { term: 'any type', pattern: /`any`.*type|any.*TypeScript|using `any`|`any` type/i },
];

for (const entry of ANTI_PATTERN_ENTRIES) {
  assert(
    entry.pattern.test(antiPatternsContent),
    `Anti-Patterns mentions "${entry.term}"`
  );
}

const antiPatternsBullets = antiPatternsContent
  .split('\n')
  .filter((line) => line.trim().startsWith('-'));
assert(
  antiPatternsBullets.length >= 5,
  `Anti-Patterns has at least 5 entries (found ${antiPatternsBullets.length})`
);

// ============================================================
// Test 6: Standards section contains required entries
// ============================================================
console.log('\nTest 6: Standards section contains required entries');

// Standards is the last section, so match to end of file
const standardsMatch = content.match(
  /## Standards\n([\s\S]*?)$/
);
const standardsContent = standardsMatch ? standardsMatch[1] : '';

assert(standardsContent.length > 0, 'Standards section has content');

const STANDARD_ENTRIES = [
  { term: 'PascalCase components', pattern: /PascalCase.*component/i },
  { term: 'snake_case columns', pattern: /snake_case.*column/i },
  { term: 'use prefix hooks', pattern: /use.*prefix.*hook|hooks.*use.*prefix|`use` prefix/i },
  { term: 'resource routes', pattern: /resource route/i },
];

for (const entry of STANDARD_ENTRIES) {
  assert(
    entry.pattern.test(standardsContent),
    `Standards mentions "${entry.term}"`
  );
}

const standardsBullets = standardsContent
  .split('\n')
  .filter((line) => line.trim().startsWith('-'));
assert(
  standardsBullets.length >= 5,
  `Standards has at least 5 entries (found ${standardsBullets.length})`
);

// ============================================================
// Test 7: Existing content is preserved
// ============================================================
console.log('\nTest 7: Existing content is preserved');

// Check that original sections still exist
const ORIGINAL_SECTIONS = [
  '## Laravel 12 Conventions',
  '## Inertia 2 Deep Dive',
  '## React 19 Patterns',
  '## TailwindCSS Conventions',
  '## Testing Patterns',
  '## Common Pitfalls -- NEVER Rules',
  '## Context7 Instructions',
];

for (const section of ORIGINAL_SECTIONS) {
  assert(content.includes(section), `Original section "${section}" preserved`);
}

// Check that frontmatter is preserved
assert(
  content.includes('name: laravel-inertia-react'),
  'Frontmatter name preserved'
);
assert(
  content.includes('# Laravel + Inertia + React Standards'),
  'Main heading preserved'
);

// Check that code examples are preserved
assert(
  content.includes('StoreOrderRequest'),
  'Original code example (StoreOrderRequest) preserved'
);
assert(
  content.includes("useForm()"),
  'Original useForm mention preserved'
);
assert(
  content.includes('assertInertia'),
  'Original testing code preserved'
);

// ============================================================
// Test 8: New sections appear AFTER existing content
// ============================================================
console.log('\nTest 8: New sections appear after existing content');

const context7Index = content.indexOf('## Context7 Instructions');
const mustHavesIndex = content.indexOf('## Must-Haves');
const goodPracticesIndex = content.indexOf('## Good Practices');
const commonBugsIndex = content.indexOf('## Common Bugs');
const antiPatternsIndex = content.indexOf('## Anti-Patterns');
const standardsIndex = content.indexOf('## Standards');

/* removed: superseded (Phase 2 triage) */
assert(
  mustHavesIndex < goodPracticesIndex,
  'Good Practices comes after Must-Haves'
);
assert(
  goodPracticesIndex < commonBugsIndex,
  'Common Bugs comes after Good Practices'
);
assert(
  commonBugsIndex < antiPatternsIndex,
  'Anti-Patterns comes after Common Bugs'
);
assert(
  antiPatternsIndex < standardsIndex,
  'Standards comes after Anti-Patterns'
);

// ============================================================
// Test 9: Backend rules sourced from archive/CLAUDE.md are reflected
// ============================================================
console.log('\nTest 9: Backend rules from archive/CLAUDE.md reflected');

// Gate::authorize is a critical rule from CLAUDE.md
assert(
  content.includes('Gate::authorize'),
  'Gate::authorize rule from archive/CLAUDE.md is present'
);

// Service-based business logic (from CLAUDE.md controller section)
assert(
  /service class/i.test(content),
  'Service class pattern from archive/CLAUDE.md referenced'
);

// Eager loading (from CLAUDE.md notes about N+1)
assert(
  /eager load/i.test(content) || content.includes('with()'),
  'Eager loading from archive/CLAUDE.md referenced'
);

// ============================================================
// Results
// ============================================================
console.log(
  `\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`
);
process.exit(failed > 0 ? 1 : 0);
