#!/usr/bin/env node
// Test: integration-checker.md agent file has correct frontmatter, read-only constraint,
// export/import dependency graph, API coverage, auth protection, E2E flow tracing,
// F-INT-NNN finding format, and Integration Summary section.

const fs = require('fs');
const path = require('path');

const AGENT_PATH = path.join(
  __dirname, '..', '..', 'agents', 'integration-checker.md'
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
  console.log('FAIL: integration-checker.md does not exist at expected path');
  console.log(`  Expected: ${AGENT_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lowerContent = content.toLowerCase();
const frontmatter = extractFrontmatter(content);

// ============================================================
// Test 1: integration-checker.md exists
// ============================================================
console.log('Test 1: File exists');
assert(
  fs.existsSync(AGENT_PATH),
  'integration-checker.md exists at plugins/bee/agents/integration-checker.md'
);

// ============================================================
// Test 2: Correct frontmatter
// ============================================================
console.log('\nTest 2: Frontmatter');
assert(
  content.startsWith('---'),
  'File starts with YAML frontmatter delimiter'
);
assert(
  frontmatter.includes('name: integration-checker'),
  'Frontmatter has name: integration-checker'
);
assert(
  frontmatter.includes('Read') && frontmatter.includes('Grep') &&
  frontmatter.includes('Glob') && frontmatter.includes('Bash'),
  'Frontmatter has tools: Read, Grep, Glob, Bash'
);
assert(
  frontmatter.includes('- audit'),
  'Frontmatter skills include audit skill'
);
assert(
  frontmatter.includes('model: inherit'),
  'Frontmatter has model: inherit'
);

// ============================================================
// Test 3: Read-only constraint (no code modifications)
// ============================================================
console.log('\nTest 3: Read-only constraint');
assert(
  lowerContent.includes('read-only') || lowerContent.includes('must not modify') ||
  lowerContent.includes('do not modify') || lowerContent.includes('shall not modify'),
  'Has read-only constraint'
);
assert(
  lowerContent.includes('no code modifications') || lowerContent.includes('must not modify any source code') ||
  lowerContent.includes('do not modify any source code') || lowerContent.includes('shall not create, edit'),
  'Explicitly states no code modifications'
);

// ============================================================
// Test 4: Builds export/import dependency graph
// ============================================================
console.log('\nTest 4: Export/import dependency graph');
assert(
  lowerContent.includes('dependency graph') || (lowerContent.includes('export') && lowerContent.includes('import') && lowerContent.includes('graph')),
  'Builds export/import dependency graph'
);
assert(
  lowerContent.includes('export') && lowerContent.includes('import'),
  'References both exports and imports'
);

// ============================================================
// Test 5: Verifies API coverage (routes have consumers)
// ============================================================
console.log('\nTest 5: API coverage');
assert(
  lowerContent.includes('api coverage') || (lowerContent.includes('route') && lowerContent.includes('consumer')),
  'Verifies API coverage (routes have consumers)'
);

// ============================================================
// Test 6: Verifies auth protection on sensitive endpoints
// ============================================================
console.log('\nTest 6: Auth protection');
assert(
  lowerContent.includes('auth') && (lowerContent.includes('protect') || lowerContent.includes('sensitive')),
  'Verifies auth protection on sensitive endpoints'
);

// ============================================================
// Test 7: Traces E2E flows (form -> state update)
// ============================================================
console.log('\nTest 7: E2E flow tracing');
assert(
  lowerContent.includes('form') && lowerContent.includes('state'),
  'Traces flows from form to state update'
);
assert(
  lowerContent.includes('end-to-end') || lowerContent.includes('e2e') || lowerContent.includes('flow trac'),
  'References end-to-end flow tracing'
);

// ============================================================
// Test 8: Produces structured report with findings using F-INT-NNN format
// ============================================================
console.log('\nTest 8: F-INT-NNN finding format');
assert(
  content.includes('F-INT-') || content.includes('F-INT-NNN'),
  'Produces findings with F-INT-NNN format'
);

// ============================================================
// Test 9: Has Integration Summary section with counts
// ============================================================
console.log('\nTest 9: Integration Summary section');
assert(
  content.includes('Integration') && (content.includes('Summary') || content.includes('summary')),
  'Has Integration Summary section'
);
assert(
  lowerContent.includes('connected') && lowerContent.includes('orphaned'),
  'Summary includes connected and orphaned counts'
);
assert(
  lowerContent.includes('unprotected') || lowerContent.includes('missing'),
  'Summary includes unprotected or missing counts'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
