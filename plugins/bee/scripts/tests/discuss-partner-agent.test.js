#!/usr/bin/env node
// Test: discuss-partner.md agent has correct frontmatter, structure,
// and behavioral instructions.

const fs = require('fs');
const path = require('path');

const AGENT_PATH = path.join(
  __dirname, '..', '..', 'agents', 'discuss-partner.md'
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

// ============================================================
// Test 1: File exists
// ============================================================
console.log('Test 1: discuss-partner.md file exists');
const exists = fs.existsSync(AGENT_PATH);
assert(exists, 'discuss-partner.md exists at plugins/bee/agents/');
if (!exists) {
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  process.exit(1);
}

const content = fs.readFileSync(AGENT_PATH, 'utf8');
const frontmatter = extractFrontmatter(content);
const lowerContent = content.toLowerCase();

// ============================================================
// Test 2: Frontmatter has correct name
// ============================================================
console.log('\nTest 2: Frontmatter name');
assert(
  frontmatter.includes('name: discuss-partner'),
  'Frontmatter has name: discuss-partner'
);

// ============================================================
// Test 3: Frontmatter tools has exactly Read, Glob, Grep, Write
// ============================================================
console.log('\nTest 3: Frontmatter tools');
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
// Test 4: Frontmatter color is cyan
// ============================================================
console.log('\nTest 4: Frontmatter color');
assert(
  frontmatter.includes('color: cyan'),
  'Frontmatter has color: cyan'
);

// ============================================================
// Test 5: Frontmatter model is inherit
// ============================================================
console.log('\nTest 5: Frontmatter model');
assert(
  frontmatter.includes('model: inherit'),
  'Frontmatter has model: inherit'
);

// ============================================================
// Test 6: Frontmatter skills uses YAML block sequence with core
// ============================================================
console.log('\nTest 6: Frontmatter skills');
assert(
  frontmatter.includes('skills:'),
  'Frontmatter has skills field'
);
assert(
  frontmatter.includes('- core'),
  'Skills include core'
);

// ============================================================
// Test 7: Reads config.json with stacks[0].name // .stack pattern
// ============================================================
console.log('\nTest 7: Config reading pattern');
assert(
  content.includes('.stacks[0].name') || content.includes('stacks[0].name'),
  'Instructions mention .stacks[0].name config path'
);
assert(
  content.includes('.stack') && (content.includes('fall back') || content.includes('fallback')),
  'Instructions mention .stack fallback'
);
assert(
  content.includes('config.json'),
  'Instructions mention config.json'
);

// ============================================================
// Test 8: Receives $MODE from context with scan and write-notes
// ============================================================
console.log('\nTest 8: MODE context variable');
assert(
  content.includes('$MODE') || content.includes('MODE'),
  'Instructions reference MODE variable'
);
assert(
  content.includes('"scan"') || content.includes('`scan`'),
  'Instructions reference scan mode'
);
assert(
  content.includes('"write-notes"') || content.includes('`write-notes`'),
  'Instructions reference write-notes mode'
);

// ============================================================
// Test 9: Scan mode outputs correct sections
// ============================================================
console.log('\nTest 9: Scan mode output sections');
assert(
  content.includes('## Relevant Files'),
  'Scan mode outputs ## Relevant Files'
);
assert(
  content.includes('## Existing Patterns'),
  'Scan mode outputs ## Existing Patterns'
);
assert(
  content.includes('## Suggested Approaches'),
  'Scan mode outputs ## Suggested Approaches'
);

// ============================================================
// Test 10: Scan mode mentions trade-offs in Suggested Approaches
// ============================================================
console.log('\nTest 10: Scan mode trade-offs');
assert(
  lowerContent.includes('trade-off') || lowerContent.includes('tradeoff') || lowerContent.includes('trade off'),
  'Scan mode mentions trade-offs'
);

// ============================================================
// Test 11: Scan mode completion signal
// ============================================================
console.log('\nTest 11: Scan mode completion signal');
assert(
  content.includes('Scan complete:') &&
  content.includes('relevant files found') &&
  content.includes('patterns identified'),
  'Scan mode has correct completion signal format'
);

// ============================================================
// Test 12: Scan mode does NOT write files
// ============================================================
console.log('\nTest 12: Scan mode no file writes');
// Check that the scan mode section explicitly says it does not write files
const scanSection = content.substring(
  content.indexOf('scan') > -1 ? content.indexOf('scan') : 0
);
assert(
  lowerContent.includes('does not write') || lowerContent.includes('do not write files') ||
  lowerContent.includes('not write any file') || lowerContent.includes('output only') ||
  lowerContent.includes('does not write file'),
  'Scan mode explicitly states it does not write files'
);

// ============================================================
// Test 13: Write-notes mode receives conversation log
// ============================================================
console.log('\nTest 13: Write-notes mode receives conversation log');
assert(
  lowerContent.includes('conversation log') || lowerContent.includes('conversation history') ||
  lowerContent.includes('full conversation'),
  'Write-notes mode receives conversation log'
);

// ============================================================
// Test 14: Write-notes mode output format has required sections
// ============================================================
console.log('\nTest 14: Write-notes mode output format');
assert(
  content.includes('# Discussion: {topic}') || content.includes('# Discussion:'),
  'Write-notes format has # Discussion: {topic}'
);
assert(
  content.includes('## Date'),
  'Write-notes format has ## Date section'
);
assert(
  content.includes('## Topic'),
  'Write-notes format has ## Topic section'
);
assert(
  content.includes('## Codebase Context'),
  'Write-notes format has ## Codebase Context section'
);
assert(
  content.includes('## Discussion Summary'),
  'Write-notes format has ## Discussion Summary section'
);
assert(
  content.includes('## Suggested Approaches'),
  'Write-notes format has ## Suggested Approaches section'
);
assert(
  content.includes('## Open Questions'),
  'Write-notes format has ## Open Questions section'
);
assert(
  content.includes('## Notes for Spec Creation'),
  'Write-notes format has ## Notes for Spec Creation section'
);

// ============================================================
// Test 15: Write-notes mode completion signal
// ============================================================
console.log('\nTest 15: Write-notes mode completion signal');
assert(
  content.includes('Discussion notes written:') &&
  (content.includes('{output-path}') || content.includes('output-path') || content.includes('output path')),
  'Write-notes mode has correct completion signal format'
);

// ============================================================
// Test 16: Does NOT write code
// ============================================================
console.log('\nTest 16: Does not write code');
assert(
  lowerContent.includes('does not write code') || lowerContent.includes('do not write code') ||
  lowerContent.includes('not write production code') || lowerContent.includes('never write code'),
  'Instructions prohibit writing code'
);

// ============================================================
// Test 17: Does NOT create test files
// ============================================================
console.log('\nTest 17: Does not create test files');
assert(
  lowerContent.includes('does not create test') || lowerContent.includes('do not create test') ||
  lowerContent.includes('not create test files') || lowerContent.includes('never create test'),
  'Instructions prohibit creating test files'
);

// ============================================================
// Test 18: Ends with IMPORTANT notices (read-only constraint pattern)
// ============================================================
console.log('\nTest 18: IMPORTANT notices');
const importantCount = (content.match(/^IMPORTANT:/gm) || []).length;
assert(
  importantCount >= 2,
  `Agent has at least 2 IMPORTANT notices (found ${importantCount})`
);

// Verify the IMPORTANT notices are at the end of the file
const lastImportantIdx = content.lastIndexOf('IMPORTANT:');
const contentAfterLastImportant = content.substring(lastImportantIdx);
// Should not have any heading sections after the last IMPORTANT block
const headingsAfterImportant = contentAfterLastImportant.match(/^## /gm);
assert(
  headingsAfterImportant === null,
  'No heading sections after IMPORTANT notices (they are at the end)'
);

// ============================================================
// Test 19: Uses Glob and Grep for scanning
// ============================================================
console.log('\nTest 19: Uses Glob and Grep for scanning');
assert(
  lowerContent.includes('glob') && lowerContent.includes('grep'),
  'Instructions mention using Glob and Grep for scanning'
);

// ============================================================
// Test 20: Writes notes to specified path
// ============================================================
console.log('\nTest 20: Writes to specified path');
assert(
  lowerContent.includes('specified path') || lowerContent.includes('output path') ||
  lowerContent.includes('output-path') || lowerContent.includes('provided path'),
  'Write-notes mode writes to a specified/provided path'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
