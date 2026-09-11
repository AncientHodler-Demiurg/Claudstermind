#!/usr/bin/env node
// Test: laravel-inertia-vue SKILL.md has all 5 enrichment sections
// with required content items, and preserves existing content.

const fs = require('fs');
const path = require('path');

const SKILL_PATH = path.join(
  __dirname, '..', '..', 'skills', 'stacks', 'laravel-inertia-vue', 'SKILL.md'
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

// Read the file
const content = fs.readFileSync(SKILL_PATH, 'utf8');

// ============================================================
// Test 1: Existing content is preserved
// ============================================================
console.log('Test 1: Existing content is preserved');
assert(
  content.includes('# Laravel + Inertia + Vue Standards'),
  'Title preserved'
);
assert(
  content.includes('## Laravel 12 Conventions'),
  'Laravel 12 Conventions section preserved'
);
assert(
  content.includes('## Inertia 2 Patterns'),
  'Inertia 2 Patterns section preserved'
);
assert(
  content.includes('## Vue 3.5 Composition API'),
  'Vue 3.5 Composition API section preserved'
);
assert(
  content.includes('## TailwindCSS Conventions'),
  'TailwindCSS Conventions section preserved'
);
assert(
  content.includes('## CRUD Patterns (Architecture)'),
  'CRUD Patterns section preserved'
);
assert(
  content.includes('## TanStack Table Columns'),
  'TanStack Table Columns section preserved'
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
// Test 3: Must-Haves section contains required items
// ============================================================
console.log('\nTest 3: Must-Haves section content');
const mustHavesItems = [
  'Gate::authorize',
  'FormRequest',
  'scopeWithSearch',
  'WithSortableScope',
  'bootstrap/app.php',
  'script setup',
  'TypeScript',
  'TDD',
];
for (const item of mustHavesItems) {
  assert(
    content.includes('## Must-Haves') && contentBetweenSections('## Must-Haves', content).includes(item),
    `Must-Haves mentions "${item}"`
  );
}

// ============================================================
// Test 4: Good Practices section contains required items
// ============================================================
console.log('\nTest 4: Good Practices section content');
const goodPracticesItems = [
  'thin controller',
  'DI',
  'event',
  'listener',
  'auto-discover',
  'partial reload',
  'wayfinder',
];
for (const item of goodPracticesItems) {
  assert(
    contentBetweenSections('## Good Practices', content).toLowerCase().includes(item.toLowerCase()),
    `Good Practices mentions "${item}"`
  );
}

// ============================================================
// Test 5: Common Bugs section contains required items
// ============================================================
console.log('\nTest 5: Common Bugs section content');
const commonBugsItems = [
  'notify',
  'race condition',
  'Event::listen',
  'duplicate',
  'trait namespace',
  'getRoutePrefix',
  'colSpan',
  'singleRowAction',
  'sort',
  'empty string',
];
for (const item of commonBugsItems) {
  assert(
    contentBetweenSections('## Common Bugs', content).toLowerCase().includes(item.toLowerCase()),
    `Common Bugs mentions "${item}"`
  );
}

// ============================================================
// Test 6: Anti-Patterns section contains required items
// ============================================================
console.log('\nTest 6: Anti-Patterns section content');
const antiPatternsItems = [
  'Options API',
  'business logic in controller',
  'prop mutation',
  '@apply',
  'nested pagination',
  'any',
  'Show.vue',
];
for (const item of antiPatternsItems) {
  assert(
    contentBetweenSections('## Anti-Patterns', content).toLowerCase().includes(item.toLowerCase()),
    `Anti-Patterns mentions "${item}"`
  );
}

// ============================================================
// Test 7: Standards section contains required items
// ============================================================
console.log('\nTest 7: Standards section content');
const standardsItems = [
  'PascalCase',
  'snake_case',
  'resource route',
  'lang file',
  'abilities',
];
for (const item of standardsItems) {
  assert(
    contentBetweenSections('## Standards', content).toLowerCase().includes(item.toLowerCase()),
    `Standards mentions "${item}"`
  );
}

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
// Helper: extract content between a section heading and the next H2
// ============================================================
function contentBetweenSections(sectionHeading, fullContent) {
  const startIdx = fullContent.indexOf(sectionHeading);
  if (startIdx === -1) return '';
  const afterHeading = fullContent.substring(startIdx + sectionHeading.length);
  // Find the next ## heading (but not the current one)
  const nextH2 = afterHeading.search(/\n## /);
  if (nextH2 === -1) return afterHeading;
  return afterHeading.substring(0, nextH2);
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
