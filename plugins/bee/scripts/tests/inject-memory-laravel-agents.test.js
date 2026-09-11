#!/usr/bin/env node
// Test: inject-memory.sh case statement covers ALL agent files and has no stale entries

const fs = require('fs');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, '..', 'inject-memory.sh');
const AGENTS_DIR = path.join(__dirname, '..', '..', 'agents');

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

// Read files
let content;
try {
  content = fs.readFileSync(SCRIPT_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: inject-memory.sh does not exist');
  process.exit(1);
}

const agentFiles = fs.readdirSync(AGENTS_DIR)
  .filter(f => f.endsWith('.md'))
  .map(f => f.replace('.md', ''));

// ============================================================
// Test 1: Valid bash script
// ============================================================
console.log('Test 1: Valid bash script');
assert(content.startsWith('#!/bin/bash'), 'Script starts with #!/bin/bash shebang');

// ============================================================
// Test 2: Case statement exists and is properly closed
// ============================================================
console.log('\nTest 2: Case statement structure');
const caseMatch = content.match(/case\s+"\$(?:AGENT_TYPE|1)"\s+in\s*\n([\s\S]*?)\n\s*\*\)/);
assert(caseMatch !== null, 'case statement for AGENT_TYPE exists');
assert(content.includes('esac'), 'Case statement is properly closed with esac');

// ============================================================
// Test 3: All agent files have an entry in the case statement
// ============================================================
console.log('\nTest 3: All agents covered');
if (caseMatch) {
  const caseBlock = caseMatch[1];
  for (const agent of agentFiles) {
    assert(
      caseBlock.includes(agent),
      `Case statement includes "${agent}"`
    );
  }
}

// ============================================================
// Test 4: No stale laravel-inertia-vue entries (agents removed)
// ============================================================
console.log('\nTest 4: No stale entries');
if (caseMatch) {
  const caseBlock = caseMatch[1];
  const staleAgents = [
    'laravel-inertia-vue-bug-detector',
    'laravel-inertia-vue-pattern-reviewer',
    'laravel-inertia-vue-implementer',
  ];
  for (const stale of staleAgents) {
    assert(
      !caseBlock.includes(stale),
      `No stale entry for "${stale}"`
    );
  }
}

// ============================================================
// Test 5: Core script structure preserved
// ============================================================
console.log('\nTest 5: Script structure');
assert(content.includes('SubagentStart hook'), 'Header comment mentions SubagentStart');
assert(content.includes('hookEventName'), 'Hook output JSON preserved');
assert(content.includes('additionalContext'), 'additionalContext output preserved');
assert(content.trimEnd().endsWith('exit 0'), 'Script ends with exit 0');

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
