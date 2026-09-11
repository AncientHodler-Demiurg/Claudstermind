#!/usr/bin/env node
// Test: context-builder.md agent has correct frontmatter, structure,
// and behavioral instructions.

const fs = require('fs');
const path = require('path');

const AGENT_PATH = path.join(
  __dirname, '..', '..', 'agents', 'context-builder.md'
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

// Helper: extract content between a section heading and the next same-level heading
function contentBetweenSections(sectionHeading, fullContent) {
  const startIdx = fullContent.indexOf(sectionHeading);
  if (startIdx === -1) return '';
  const afterHeading = fullContent.substring(startIdx + sectionHeading.length);
  const level = sectionHeading.match(/^#+/)[0];
  const regex = new RegExp(`\n${level} (?!#)`);
  const nextHeading = afterHeading.search(regex);
  if (nextHeading === -1) return afterHeading;
  return afterHeading.substring(0, nextHeading);
}

// Helper: extract YAML frontmatter
function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

// Read the file
let content;
try {
  content = fs.readFileSync(AGENT_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: context-builder.md does not exist at expected path');
  console.log(`  Expected: ${AGENT_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const frontmatter = extractFrontmatter(content);

// ============================================================
// Test 1: Frontmatter has correct fields
// ============================================================
console.log('Test 1: Frontmatter fields');
assert(
  content.startsWith('---'),
  'File starts with YAML frontmatter delimiter'
);
assert(
  frontmatter.includes('name: context-builder'),
  'Frontmatter has name: context-builder'
);
assert(
  frontmatter.includes('color: blue'),
  'Frontmatter has color: blue'
);
assert(
  frontmatter.includes('model: inherit'),
  'Frontmatter has model: inherit'
);

// ============================================================
// Test 2: Frontmatter tools field has exactly the right tools
// ============================================================
console.log('\nTest 2: Frontmatter tools');
const toolsMatch = frontmatter.match(/tools:\s*(.+)/);
assert(
  toolsMatch !== null,
  'Frontmatter has tools field'
);
if (toolsMatch) {
  const tools = toolsMatch[1].split(',').map(t => t.trim());
  assert(tools.includes('Read'), 'Tools include Read');
  assert(tools.includes('Glob'), 'Tools include Glob');
  assert(tools.includes('Grep'), 'Tools include Grep');
  assert(tools.includes('Write'), 'Tools include Write');
  assert(tools.length === 4, `Tools has exactly 4 entries (found ${tools.length})`);
}

// ============================================================
// Test 3: Frontmatter skills includes core
// ============================================================
console.log('\nTest 3: Frontmatter skills');
assert(
  frontmatter.includes('skills:'),
  'Frontmatter has skills field'
);
assert(
  frontmatter.includes('- core'),
  'Skills include core'
);

// ============================================================
// Test 4: Reads config.json with stacks[0].name // .stack pattern
// ============================================================
console.log('\nTest 4: Config reading pattern');
assert(
  content.includes('.stacks[0].name') || content.includes('stacks[0].name'),
  'Instructions mention .stacks[0].name config path'
);
assert(
  content.includes('.stack') && content.includes('fall back'),
  'Instructions mention .stack fallback'
);
assert(
  content.includes('config.json'),
  'Instructions mention config.json'
);

// ============================================================
// Test 5: Scans codebase via Glob/Grep for key areas
// ============================================================
console.log('\nTest 5: Codebase scanning instructions');
const lowerContent = content.toLowerCase();
assert(
  lowerContent.includes('controller') || lowerContent.includes('route'),
  'Scanning covers controllers/routes'
);
assert(
  lowerContent.includes('model') || lowerContent.includes('entit'),
  'Scanning covers models/entities'
);
assert(
  lowerContent.includes('component') || lowerContent.includes('view'),
  'Scanning covers components/views'
);
assert(
  lowerContent.includes('service') || lowerContent.includes('repo'),
  'Scanning covers services/repos'
);
assert(
  lowerContent.includes('test'),
  'Scanning covers tests'
);
assert(
  lowerContent.includes('glob') && lowerContent.includes('grep'),
  'Instructions mention using Glob and Grep'
);

// ============================================================
// Test 6: Documents only observed patterns (no invented rules)
// ============================================================
console.log('\nTest 6: Observed patterns constraint');
assert(
  lowerContent.includes('observed') || lowerContent.includes('actually found') || lowerContent.includes('actually exist'),
  'Instructions emphasize documenting observed patterns'
);
assert(
  lowerContent.includes('do not invent') || lowerContent.includes('not invent') ||
  lowerContent.includes('do not assume') || lowerContent.includes('not assume') ||
  lowerContent.includes('no invented') || lowerContent.includes('never invent'),
  'Instructions warn against inventing rules'
);

// ============================================================
// Test 7: Output file is .bee/CONTEXT.md
// ============================================================
console.log('\nTest 7: Output file');
assert(
  content.includes('.bee/CONTEXT.md'),
  'Output file is .bee/CONTEXT.md'
);

// ============================================================
// Test 8: Multi-document output files
// ============================================================
console.log('\nTest 8: Multi-document output files');
assert(
  content.includes('STACK.md'),
  'Output includes STACK.md document'
);
assert(
  content.includes('ARCHITECTURE.md'),
  'Output includes ARCHITECTURE.md document'
);
assert(
  content.includes('CONVENTIONS.md'),
  'Output includes CONVENTIONS.md document'
);
assert(
  content.includes('CONCERNS.md'),
  'Output includes CONCERNS.md document'
);

// ============================================================
// Test 9: Bullet points only, no prose paragraphs
// ============================================================
console.log('\nTest 9: Bullet points constraint');
assert(
  lowerContent.includes('bullet point') || lowerContent.includes('bullet-point') || lowerContent.includes('bullets only'),
  'Instructions specify bullet points only'
);
assert(
  lowerContent.includes('no prose') || lowerContent.includes('no paragraph'),
  'Instructions warn against prose paragraphs'
);

// ============================================================
// Test 10: Completion message format
// ============================================================
console.log('\nTest 10: Completion message');
assert(
  content.includes('Context extracted: 5 files written to .bee/'),
  'Completion message starts with correct text'
);
assert(
  content.includes('{N} observations') && content.includes('4 structured documents'),
  'Completion message includes {N} observations across 4 structured documents'
);

// ============================================================
// Test 11: Read-only constraint (no code, no tests, only .bee/ context files)
// ============================================================
console.log('\nTest 11: Read-only constraints');
assert(
  lowerContent.includes('does not write code') || lowerContent.includes('do not write code') ||
  lowerContent.includes('not write production code') || lowerContent.includes('not create') ||
  lowerContent.includes('not modify any file') || lowerContent.includes('only file you write'),
  'Instructions prohibit writing code'
);
assert(
  content.includes('CONTEXT.md') && content.includes('STACK.md') &&
  (lowerContent.includes('context files') || lowerContent.includes('output files') ||
   lowerContent.includes('structured output')),
  'Instructions limit writes to only .bee/ context files'
);

// ============================================================
// Test 12: Agent ends with IMPORTANT notices (per plugin conventions)
// ============================================================
console.log('\nTest 12: IMPORTANT notices');
const importantCount = (content.match(/^IMPORTANT:/gm) || []).length;
assert(
  importantCount >= 2,
  `Agent has at least 2 IMPORTANT notices (found ${importantCount})`
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
