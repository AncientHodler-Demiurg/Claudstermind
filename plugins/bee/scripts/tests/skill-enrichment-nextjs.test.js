#!/usr/bin/env node
// Test: nextjs SKILL.md has all 5 enrichment sections
// with required content items, and preserves existing content.

const fs = require('fs');
const path = require('path');

const SKILL_PATH = path.join(
  __dirname, '..', '..', 'skills', 'stacks', 'nextjs', 'SKILL.md'
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

// Helper: extract content between a section heading and the next H2
function contentBetweenSections(sectionHeading, fullContent) {
  const startIdx = fullContent.indexOf(sectionHeading);
  if (startIdx === -1) return '';
  const afterHeading = fullContent.substring(startIdx + sectionHeading.length);
  const nextH2 = afterHeading.search(/\n## /);
  if (nextH2 === -1) return afterHeading;
  return afterHeading.substring(0, nextH2);
}

// Read the file
const content = fs.readFileSync(SKILL_PATH, 'utf8');

// ============================================================
// Test 1: Existing content is preserved
// ============================================================
console.log('Test 1: Existing content is preserved');
assert(
  content.includes('# Next.js Standards'),
  'Title preserved'
);
assert(
  content.includes('## App Router Structure'),
  'App Router Structure section preserved'
);
assert(
  content.includes('## Server vs Client Components'),
  'Server vs Client Components section preserved'
);
assert(
  content.includes('## Data Fetching'),
  'Data Fetching section preserved'
);
assert(
  content.includes('## Caching and Revalidation'),
  'Caching and Revalidation section preserved'
);
assert(
  content.includes('## Images and Metadata'),
  'Images and Metadata section preserved'
);
assert(
  content.includes('## Middleware'),
  'Middleware section preserved'
);
assert(
  content.includes('## Testing'),
  'Testing section preserved'
);
assert(
  content.includes('## Common Pitfalls -- NEVER Rules'),
  'Common Pitfalls section preserved'
);
assert(
  content.includes('## Context7 Instructions'),
  'Context7 Instructions section preserved'
);

// ============================================================
// Test 2: All 5 new sections exist as H2 headings
// ============================================================
console.log('\nTest 2: All 5 enrichment sections exist');
const requiredSections = [
  '## Must-Haves',
  '## Good Practices',
  '## Common Bugs',
  '## Anti-Patterns',
  '## Standards',
];
for (const section of requiredSections) {
  assert(content.includes(section), `Section "${section}" exists`);
}

// ============================================================
// Test 3: Must-Haves section contains required items (min 5)
// ============================================================
console.log('\nTest 3: Must-Haves section content');
const mustHavesSection = contentBetweenSections('## Must-Haves', content);
const mustHavesItems = [
  'TypeScript',
  'server component',
  'loading.tsx',
  'error.tsx',
  'NEXT_PUBLIC_',
  'TDD',
];
for (const item of mustHavesItems) {
  assert(
    mustHavesSection.toLowerCase().includes(item.toLowerCase()),
    `Must-Haves mentions "${item}"`
  );
}
// Verify min 5 bullet entries
const mustHavesBullets = mustHavesSection.match(/^- /gm) || [];
assert(
  mustHavesBullets.length >= 5,
  `Must-Haves has at least 5 entries (found ${mustHavesBullets.length})`
);

// ============================================================
// Test 4: Good Practices section contains required items (min 5)
// ============================================================
console.log('\nTest 4: Good Practices section content');
const goodPracticesSection = contentBetweenSections('## Good Practices', content);
const goodPracticesItems = [
  'data fetching',
  'route handler',
  'Image',
  'metadata',
];
for (const item of goodPracticesItems) {
  assert(
    goodPracticesSection.toLowerCase().includes(item.toLowerCase()),
    `Good Practices mentions "${item}"`
  );
}
const goodPracticesBullets = goodPracticesSection.match(/^- /gm) || [];
assert(
  goodPracticesBullets.length >= 5,
  `Good Practices has at least 5 entries (found ${goodPracticesBullets.length})`
);

// ============================================================
// Test 5: Common Bugs section contains required items (min 5)
// ============================================================
console.log('\nTest 5: Common Bugs section content');
const commonBugsSection = contentBetweenSections('## Common Bugs', content);
const commonBugsItems = [
  'useState',
  'use client',
  'cache',
  'hydration',
  'cookies',
];
for (const item of commonBugsItems) {
  assert(
    commonBugsSection.toLowerCase().includes(item.toLowerCase()),
    `Common Bugs mentions "${item}"`
  );
}
const commonBugsBullets = commonBugsSection.match(/^- /gm) || [];
assert(
  commonBugsBullets.length >= 5,
  `Common Bugs has at least 5 entries (found ${commonBugsBullets.length})`
);

// ============================================================
// Test 6: Anti-Patterns section contains required items (min 5)
// ============================================================
console.log('\nTest 6: Anti-Patterns section content');
const antiPatternsSection = contentBetweenSections('## Anti-Patterns', content);
const antiPatternsItems = [
  'client',
  'Pages Router',
  'getServerSideProps',
  'prop drilling',
];
for (const item of antiPatternsItems) {
  assert(
    antiPatternsSection.toLowerCase().includes(item.toLowerCase()),
    `Anti-Patterns mentions "${item}"`
  );
}
const antiPatternsBullets = antiPatternsSection.match(/^- /gm) || [];
assert(
  antiPatternsBullets.length >= 5,
  `Anti-Patterns has at least 5 entries (found ${antiPatternsBullets.length})`
);

// ============================================================
// Test 7: Standards section contains required items (min 5)
// ============================================================
console.log('\nTest 7: Standards section content');
const standardsSection = contentBetweenSections('## Standards', content);
const standardsItems = [
  'kebab-case',
  'PascalCase',
  'page.tsx',
  'route group',
  'parallel route',
];
for (const item of standardsItems) {
  assert(
    standardsSection.toLowerCase().includes(item.toLowerCase()),
    `Standards mentions "${item}"`
  );
}
const standardsBullets = standardsSection.match(/^- /gm) || [];
assert(
  standardsBullets.length >= 5,
  `Standards has at least 5 entries (found ${standardsBullets.length})`
);

// ============================================================
// Test 8: Context7 Instructions is the last H2 section
// ============================================================
console.log('\nTest 8: Context7 Instructions is the last H2 section');
const lastH2Match = [...content.matchAll(/^## .+$/gm)];
if (lastH2Match.length > 0) {
  const lastH2 = lastH2Match[lastH2Match.length - 1][0];
  assert(
    lastH2 === '## Context7 Instructions',
    'Context7 Instructions is the last H2 section'
  );
} else {
  assert(false, 'No H2 sections found');
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);

assert(content.toLowerCase().includes('dynamic'), 'dynamic loading guidance present');
assert(content.includes('`any`'), 'no-any rule present');
