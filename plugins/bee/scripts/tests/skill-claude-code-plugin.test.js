#!/usr/bin/env node
// Test: claude-code-plugin SKILL.md has correct frontmatter, all required sections,
// and required content items.

const fs = require('fs');
const path = require('path');

const SKILL_PATH = path.join(
  __dirname, '..', '..', 'skills', 'stacks', 'claude-code-plugin', 'SKILL.md'
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

// Helper: count bullet items (lines starting with - or numbered items) in a section
function countBulletItems(sectionContent) {
  const lines = sectionContent.split('\n');
  return lines.filter(l => /^\s*[-*]\s/.test(l) || /^\s*\d+\.\s/.test(l)).length;
}

// Read the file
let content;
try {
  content = fs.readFileSync(SKILL_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: SKILL.md file does not exist at expected path');
  console.log(`  Expected: ${SKILL_PATH}`);
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
  content.includes('name: claude-code-plugin'),
  'Frontmatter has name: claude-code-plugin'
);
assert(
  content.includes('description:') && content.includes('Claude Code plugin'),
  'Frontmatter has description mentioning Claude Code plugin'
);

// ============================================================
// Test 2: All required H2 sections exist
// ============================================================
console.log('\nTest 2: All required sections exist');
const requiredSections = [
  '## Architecture',
  '## Commands',
  '## Agents',
  '## Skills',
  '## Must-Haves',
  '## Good Practices',
  '## Common Bugs',
  '## Anti-Patterns',
  '## Standards',
  '## Context7 Instructions',
];
for (const section of requiredSections) {
  assert(content.includes(section), `Section "${section}" exists`);
}

// ============================================================
// Test 3: Must-Haves section has min 6 entries and required items
// ============================================================
console.log('\nTest 3: Must-Haves section content');
const mustHavesContent = contentBetweenSections('## Must-Haves', content);
assert(
  countBulletItems(mustHavesContent) >= 6,
  'Must-Haves has at least 6 entries'
);
// Required items per AC
const mustHaveItems = [
  ['read-only', 'agents must not write code'],
  ['IMPORTANT', 'read-only agents end with IMPORTANT notices'],
  ['auto-commit', 'commands must not auto-commit'],
  ['inject-memory', 'new agents added to inject-memory.sh'],
  ['hooks.json', 'new agents added to hooks.json'],
  ['SubagentStop', 'SubagentStop validates output'],
  ['hardcode', 'never hardcode framework rules in agents'],
];
for (const [keyword, desc] of mustHaveItems) {
  assert(
    mustHavesContent.toLowerCase().includes(keyword.toLowerCase()),
    `Must-Haves mentions "${keyword}" (${desc})`
  );
}

// ============================================================
// Test 4: Good Practices section has min 6 entries and required items
// ============================================================
console.log('\nTest 4: Good Practices section content');
const goodPracticesContent = contentBetweenSections('## Good Practices', content);
assert(
  countBulletItems(goodPracticesContent) >= 6,
  'Good Practices has at least 6 entries'
);
const goodPracticeItems = [
  ['frontmatter', 'consistent frontmatter format'],
  ['numbered steps', 'numbered steps in agents'],
  ['file paths', 'context packets include file paths not contents'],
  ['progressive disclosure', 'progressive disclosure in skills'],
  ['TDD', 'TDD with hand-rolled assert pattern'],
];
for (const [keyword, desc] of goodPracticeItems) {
  assert(
    goodPracticesContent.toLowerCase().includes(keyword.toLowerCase()),
    `Good Practices mentions "${keyword}" (${desc})`
  );
}

// ============================================================
// Test 5: Common Bugs section has min 5 entries and required items
// ============================================================
console.log('\nTest 5: Common Bugs section content');
const commonBugsContent = contentBetweenSections('## Common Bugs', content);
assert(
  countBulletItems(commonBugsContent) >= 5,
  'Common Bugs has at least 5 entries'
);
const commonBugItems = [
  ['SubagentStart', 'SubagentStart matcher missing new agents'],
  ['renumber', 'step renumbering breaking internal references'],
  ['trailing comma', 'hooks.json trailing commas'],
  ['research notes', 'stale research notes referencing parallel task outputs'],
  ['colocated', 'test files placed in subdirectories instead of colocated'],
];
for (const [keyword, desc] of commonBugItems) {
  assert(
    commonBugsContent.toLowerCase().includes(keyword.toLowerCase()),
    `Common Bugs mentions "${keyword}" (${desc})`
  );
}

// ============================================================
// Test 6: Anti-Patterns section has min 5 entries and required items
// ============================================================
console.log('\nTest 6: Anti-Patterns section content');
const antiPatternsContent = contentBetweenSections('## Anti-Patterns', content);
assert(
  countBulletItems(antiPatternsContent) >= 5,
  'Anti-Patterns has at least 5 entries'
);
const antiPatternItems = [
  ['parallel', 'spawning fixers in parallel'],
  ['auto-approv', 'auto-approving plans'],
  ['code in command', 'writing code in command files'],
  ['file contents', 'agents reading file contents instead of paths'],
];
for (const [keyword, desc] of antiPatternItems) {
  assert(
    antiPatternsContent.toLowerCase().includes(keyword.toLowerCase()),
    `Anti-Patterns mentions "${keyword}" (${desc})`
  );
}

// ============================================================
// Test 7: Standards section has min 5 entries and required items
// ============================================================
console.log('\nTest 7: Standards section content');
const standardsContent = contentBetweenSections('## Standards', content);
assert(
  countBulletItems(standardsContent) >= 5,
  'Standards has at least 5 entries'
);
const standardsItems = [
  ['kebab-case', 'kebab-case file names'],
  ['YAML', 'YAML block sequence for skills list'],
  ['markdown', 'markdown prose instructions'],
  ['pseudocode', 'no pseudocode'],
  ['Context7', 'Context7 section at end of skills'],
];
for (const [keyword, desc] of standardsItems) {
  assert(
    standardsContent.toLowerCase().includes(keyword.toLowerCase()),
    `Standards mentions "${keyword}" (${desc})`
  );
}

// ============================================================
// Test 8: Context7 Instructions is the last H2 section
// ============================================================
console.log('\nTest 8: Context7 Instructions placement');
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
// Test 9: Architecture section describes plugin structure
// ============================================================
console.log('\nTest 9: Architecture section content');
const architectureContent = contentBetweenSections('## Architecture', content);
assert(
  architectureContent.toLowerCase().includes('command') &&
  architectureContent.toLowerCase().includes('agent'),
  'Architecture mentions commands and agents'
);
assert(
  architectureContent.toLowerCase().includes('hook') ||
  architectureContent.toLowerCase().includes('hooks.json'),
  'Architecture mentions hooks'
);
assert(
  architectureContent.toLowerCase().includes('skill'),
  'Architecture mentions skills'
);

// ============================================================
// Test 10: Commands section describes command conventions
// ============================================================
console.log('\nTest 10: Commands section content');
const commandsContent = contentBetweenSections('## Commands', content);
assert(
  commandsContent.toLowerCase().includes('frontmatter') ||
  commandsContent.toLowerCase().includes('---'),
  'Commands section describes frontmatter'
);

// ============================================================
// Test 11: Agents section describes agent conventions
// ============================================================
console.log('\nTest 11: Agents section content');
const agentsContent = contentBetweenSections('## Agents', content);
assert(
  agentsContent.toLowerCase().includes('read-only') ||
  agentsContent.toLowerCase().includes('read only'),
  'Agents section mentions read-only agents'
);
assert(
  agentsContent.toLowerCase().includes('memory'),
  'Agents section mentions agent memory'
);

// ============================================================
// Test 12: Skills section describes skill conventions
// ============================================================
console.log('\nTest 12: Skills section content');
const skillsContent = contentBetweenSections('## Skills', content);
assert(
  skillsContent.toLowerCase().includes('stack') ||
  skillsContent.toLowerCase().includes('stacks'),
  'Skills section mentions stacks'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
