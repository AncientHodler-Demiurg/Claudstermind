#!/usr/bin/env node
// Test: nestjs SKILL.md has all 5 enrichment sections
// with required content items, and preserves existing content.

const fs = require('fs');
const path = require('path');

const SKILL_PATH = path.join(
  __dirname, '..', '..', 'skills', 'stacks', 'nestjs', 'SKILL.md'
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
  content.includes('# NestJS Standards'),
  'Title preserved'
);
assert(
  content.includes('## Module Architecture'),
  'Module Architecture section preserved'
);
assert(
  content.includes('## Controllers'),
  'Controllers section preserved'
);
assert(
  content.includes('## Services'),
  'Services section preserved'
);
assert(
  content.includes('## Validation'),
  'Validation section preserved'
);
assert(
  content.includes('## Guards') && content.includes('## Interceptors'),
  'Guards and Interceptors section preserved'
);
assert(
  content.includes('## Database Integration'),
  'Database Integration section preserved'
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
  '@Injectable',
  'ValidationPipe',
  'response DTO',
  'feature module',
  'constructor injection',
];
for (const item of mustHavesItems) {
  assert(
    mustHavesSection.toLowerCase().includes(item.toLowerCase()),
    `Must-Haves mentions "${item}"`
  );
}
// Verify min 5 entries (bullet points)
const mustHavesBullets = (mustHavesSection.match(/^- /gm) || []).length;
assert(mustHavesBullets >= 5, `Must-Haves has at least 5 entries (found ${mustHavesBullets})`);

// ============================================================
// Test 4: Good Practices section contains required items
// ('exception filter' moved to its own ## Exception Filters section)
// ============================================================
console.log('\nTest 4: Good Practices section content');
const goodPracticesSection = contentBetweenSections('## Good Practices', content);
const goodPracticesItems = [
  'separate DTO',
  'PartialType',
  'guard',
  'repository pattern',
];
for (const item of goodPracticesItems) {
  assert(
    goodPracticesSection.toLowerCase().includes(item.toLowerCase()),
    `Good Practices mentions "${item}"`
  );
}
const goodPracticesBullets = (goodPracticesSection.match(/^- /gm) || []).length;
assert(goodPracticesBullets >= 5, `Good Practices has at least 5 entries (found ${goodPracticesBullets})`);

// ============================================================
// Test 5: Common Bugs section contains required items (min 5)
// ============================================================
console.log('\nTest 5: Common Bugs section content');
const commonBugsSection = contentBetweenSections('## Common Bugs', content);
const commonBugsItems = [
  'export',
  'request-scoped',
  'singleton',
  'interceptor',
  'TypeOrmModule',
  'unhandled promise',
];
for (const item of commonBugsItems) {
  assert(
    commonBugsSection.toLowerCase().includes(item.toLowerCase()),
    `Common Bugs mentions "${item}"`
  );
}
const commonBugsBullets = (commonBugsSection.match(/^- /gm) || []).length;
assert(commonBugsBullets >= 5, `Common Bugs has at least 5 entries (found ${commonBugsBullets})`);

// ============================================================
// Test 6: Anti-Patterns section contains required items (min 5)
// ============================================================
console.log('\nTest 6: Anti-Patterns section content');
const antiPatternsSection = contentBetweenSections('## Anti-Patterns', content);
const antiPatternsItems = [
  'business logic in controller',
  'raw SQL',
  'expos',
  'sync',
  'validation',
];
for (const item of antiPatternsItems) {
  assert(
    antiPatternsSection.toLowerCase().includes(item.toLowerCase()),
    `Anti-Patterns mentions "${item}"`
  );
}
const antiPatternsBullets = (antiPatternsSection.match(/^- /gm) || []).length;
assert(antiPatternsBullets >= 5, `Anti-Patterns has at least 5 entries (found ${antiPatternsBullets})`);

// ============================================================
// Test 7: Standards section contains required items (min 5)
// ============================================================
console.log('\nTest 7: Standards section content');
const standardsSection = contentBetweenSections('## Standards', content);
const standardsItems = [
  'plural',
  '.module',
  '.controller',
  '.service',
  'dto',
  'e2e',
  'unit',
];
for (const item of standardsItems) {
  assert(
    standardsSection.toLowerCase().includes(item.toLowerCase()),
    `Standards mentions "${item}"`
  );
}
const standardsBullets = (standardsSection.match(/^- /gm) || []).length;
assert(standardsBullets >= 5, `Standards has at least 5 entries (found ${standardsBullets})`);

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

assert(content.includes('## Exception Filters'), 'Exception Filters section present');
