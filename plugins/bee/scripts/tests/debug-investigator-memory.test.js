#!/usr/bin/env node
// Test: inject-memory.sh case statement includes debug-investigator in the agent whitelist.

const fs = require('fs');
const path = require('path');

const INJECT_MEMORY_PATH = path.join(
  __dirname, '..', '..', 'scripts', 'inject-memory.sh'
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

// Read inject-memory.sh
let content;
try {
  content = fs.readFileSync(INJECT_MEMORY_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: inject-memory.sh could not be read');
  console.log(`  Error: ${e.message}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 15: Case statement includes debug-investigator
// ============================================================
console.log('Test 15: inject-memory.sh includes debug-investigator');
assert(
  content.includes('debug-investigator'),
  'inject-memory.sh case statement includes "debug-investigator"'
);

// Verify it's in the actual case statement (not just a comment)
const caseMatch = content.match(/case\s+"\$(?:AGENT_TYPE|1)"\s+in\s*\n\s*([\s\S]*?)\)/);
if (caseMatch) {
  assert(
    caseMatch[1].includes('debug-investigator'),
    'debug-investigator is inside the case statement pattern'
  );
} else {
  failed++;
  console.log('  FAIL: Could not find case statement pattern');
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
