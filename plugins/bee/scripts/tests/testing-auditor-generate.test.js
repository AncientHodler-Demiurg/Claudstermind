#!/usr/bin/env node
// Test: testing-auditor.md agent file has dual mode (scan + generate),
// generate mode maps acceptance criteria to tests, generates tests for gaps,
// runs with max 3 debug iterations, escalates implementation bugs,
// uses F-TEST-NNN finding format, and has Requirement Coverage Map output.

const fs = require('fs');
const path = require('path');

const AGENT_PATH = path.join(
  __dirname, '..', '..', 'agents', 'testing-auditor.md'
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
  content = fs.readFileSync(AGENT_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: testing-auditor.md does not exist at expected path');
  console.log(`  Expected: ${AGENT_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lowerContent = content.toLowerCase();
const frontmatter = extractFrontmatter(content);

// ============================================================
// Test 1: testing-auditor.md exists
// ============================================================
console.log('Test 1: File exists');
assert(
  fs.existsSync(AGENT_PATH),
  'testing-auditor.md exists at plugins/bee/agents/testing-auditor.md'
);

// ============================================================
// Test 2: Frontmatter has name: testing-auditor
// ============================================================
console.log('\nTest 2: Frontmatter');
assert(
  frontmatter.includes('name: testing-auditor'),
  'Frontmatter has name: testing-auditor'
);

// ============================================================
// Test 3: Frontmatter tools include Write
// ============================================================
console.log('\nTest 3: Tools include Write');
assert(
  frontmatter.includes('Write'),
  'Frontmatter tools include Write (in addition to Read, Glob, Grep, Bash)'
);
assert(
  frontmatter.includes('Read') && frontmatter.includes('Glob') &&
  frontmatter.includes('Grep') && frontmatter.includes('Bash'),
  'Frontmatter still has original tools: Read, Glob, Grep, Bash'
);

// ============================================================
// Test 3b: Skills are core + audit only (no testing)
// ============================================================
console.log('\nTest 3b: Skills corrected');
assert(
  frontmatter.includes('- core') && frontmatter.includes('- audit'),
  'Skills include core and audit'
);
assert(
  !frontmatter.includes('- testing'),
  'Skills do NOT include testing (broken skill reference removed)'
);

// ============================================================
// Test 3c: Scan mode Write constraint
// ============================================================
console.log('\nTest 3c: Scan mode Write constraint');
assert(
  lowerContent.includes('scan mode') && lowerContent.includes('write') &&
  (lowerContent.includes('must not') || lowerContent.includes('do not')),
  'Scan mode explicitly prohibits Write tool usage'
);

// ============================================================
// Test 4: Has Scan Mode and Generate Mode protocol sections
// ============================================================
console.log('\nTest 4: Dual mode sections');
assert(
  content.includes('Scan Mode'),
  'Has "Scan Mode" section'
);
assert(
  content.includes('Generate Mode'),
  'Has "Generate Mode" section'
);

// ============================================================
// Test 5: Generate mode loads TASKS.md acceptance criteria
// ============================================================
console.log('\nTest 5: TASKS.md loading');
assert(
  content.includes('TASKS.md') &&
  (lowerContent.includes('acceptance criteria') || lowerContent.includes('acceptance')),
  'Generate mode loads TASKS.md acceptance criteria'
);

// ============================================================
// Test 6: Generate mode maps criteria to existing tests
// ============================================================
console.log('\nTest 6: Criteria mapping');
assert(
  (lowerContent.includes('map') || lowerContent.includes('grep')) &&
  (lowerContent.includes('criteria') || lowerContent.includes('criterion')) &&
  (lowerContent.includes('test') || lowerContent.includes('existing')),
  'Generate mode maps criteria to existing tests'
);

// ============================================================
// Test 7: Generate mode classifies as COVERED, PARTIAL, UNCOVERED
// ============================================================
console.log('\nTest 7: Coverage classification');
assert(
  content.includes('COVERED'),
  'Has COVERED classification'
);
assert(
  content.includes('PARTIAL'),
  'Has PARTIAL classification'
);
assert(
  content.includes('UNCOVERED'),
  'Has UNCOVERED classification'
);

// ============================================================
// Test 8: Generate mode generates test files for UNCOVERED
// ============================================================
console.log('\nTest 8: Test generation for UNCOVERED');
assert(
  lowerContent.includes('uncovered') &&
  (lowerContent.includes('generate') || lowerContent.includes('write')) &&
  lowerContent.includes('test'),
  'Generate mode generates test files for UNCOVERED criteria'
);

// ============================================================
// Test 9: Generate mode runs generated tests
// ============================================================
console.log('\nTest 9: Run generated tests');
assert(
  lowerContent.includes('run') && lowerContent.includes('test') &&
  (lowerContent.includes('generated') || lowerContent.includes('each test')),
  'Generate mode runs generated tests'
);

// ============================================================
// Test 10: Max 3 debug iterations
// ============================================================
console.log('\nTest 10: Debug iteration limit');
assert(
  content.includes('max 3') || content.includes('3 iterations') ||
  content.includes('3 attempts') || content.includes('3 debug'),
  'Generate mode has max 3 debug iterations for failing tests'
);

// ============================================================
// Test 11: Escalates implementation bugs (does NOT fix)
// ============================================================
console.log('\nTest 11: Escalation of implementation bugs');
assert(
  content.includes('ESCALATE'),
  'Has ESCALATE keyword for implementation bugs'
);
assert(
  lowerContent.includes('do not fix') || lowerContent.includes('does not fix') ||
  lowerContent.includes('not fix implementation') ||
  (lowerContent.includes('escalate') && lowerContent.includes('implementation')),
  'Escalates implementation bugs without fixing'
);

// ============================================================
// Test 12: Uses F-TEST-NNN finding format
// ============================================================
console.log('\nTest 12: F-TEST-NNN finding format');
assert(
  content.includes('F-TEST-'),
  'Uses F-TEST-NNN finding format'
);

// ============================================================
// Test 13: Has Requirement Coverage Map output
// ============================================================
console.log('\nTest 13: Requirement Coverage Map');
assert(
  content.includes('Requirement Coverage Map'),
  'Has "Requirement Coverage Map" output section'
);

// ============================================================
// Test 14: Implementation files are READ-ONLY in generate mode
// ============================================================
console.log('\nTest 14: Implementation READ-ONLY constraint');
assert(
  content.includes('READ-ONLY'),
  'Has READ-ONLY constraint for implementation files in generate mode'
);

// ============================================================
// Test 15: Mode determined by parent command instruction (MODE: generate)
// ============================================================
console.log('\nTest 15: Mode detection via instruction');
assert(
  content.includes('MODE: generate'),
  'Mode determined by "MODE: generate" from parent command instruction'
);
// Should appear at least twice (detection + reference)
const modeMatches = content.match(/MODE: generate/g);
assert(
  modeMatches && modeMatches.length >= 2,
  '"MODE: generate" appears at least twice (detection + reference sections)'
);

// ============================================================
// Test 16: Has Test Generation Summary
// ============================================================
console.log('\nTest 16: Test Generation Summary');
assert(
  content.includes('Test Generation Summary'),
  'Has "Test Generation Summary" output section'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
