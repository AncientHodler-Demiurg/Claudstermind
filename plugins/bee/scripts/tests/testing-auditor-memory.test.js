#!/usr/bin/env node
// Test: inject-memory.sh includes testing-auditor in the case statement whitelist
// (alongside the separate test-auditor agent).

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

let content;
try {
  content = fs.readFileSync(INJECT_MEMORY_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: inject-memory.sh could not be read');
  process.exit(1);
}

// ============================================================
// Test 14: inject-memory.sh includes testing-auditor
// ============================================================
console.log('\nTest 14: inject-memory.sh includes testing-auditor');
assert(
  content.includes('testing-auditor'),
  'inject-memory.sh case statement includes "testing-auditor"'
);

// Find the case statement line
const caseMatch = content.match(/case\s+"\$(?:AGENT_TYPE|1)"\s+in\s*\n\s*(.*?\))/s);
if (caseMatch) {
  const caseLine = caseMatch[1];
  assert(
    caseLine.includes('testing-auditor'),
    'testing-auditor is inside the case statement pattern (not just a comment)'
  );
  assert(
    caseLine.includes('test-auditor'),
    'test-auditor (EOD agent) is ALSO present -- both agents coexist'
  );
} else {
  failed += 2;
  console.log('  FAIL: Could not find case statement');
  console.log('  FAIL: Could not verify test-auditor coexistence');
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
