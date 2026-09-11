#!/usr/bin/env node
// Test: audit.md references integration-checker as an audit agent, includes it
// in spawn logic, batching, implementation mode table, and --only flag.

const fs = require('fs');
const path = require('path');

const AUDIT_PATH = path.join(
  __dirname, '..', '..', 'commands', 'audit.md'
);
const AUDIT_SKILL_PATH = path.join(
  __dirname, '..', '..', 'skills', 'audit', 'SKILL.md'
);
const CORE_SKILL_PATH = path.join(
  __dirname, '..', '..', 'skills', 'core', 'SKILL.md'
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

// Read audit.md
let auditContent;
try {
  auditContent = fs.readFileSync(AUDIT_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: audit.md could not be read');
  console.log(`  Error: ${e.message}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

const lowerAudit = auditContent.toLowerCase();

// ============================================================
// Test 1: audit.md references integration-checker
// ============================================================
console.log('Test 1: audit.md references integration-checker');
assert(
  auditContent.includes('integration-checker'),
  'audit.md mentions "integration-checker" as an audit agent'
);

// ============================================================
// Test 2: audit.md includes integration-checker in Step 4 spawn logic
// ============================================================
console.log('\nTest 2: Integration-checker in Step 4 spawn logic');
// Check that integration-checker appears in the agent spawn section
const step4Match = auditContent.match(/### Step 4[\s\S]*?### Step 5/);
if (step4Match) {
  assert(
    step4Match[0].includes('integration-checker'),
    'integration-checker is referenced in Step 4 (Run Audit Agents)'
  );
} else {
  failed++;
  console.log('  FAIL: Could not find Step 4 section');
}

// ============================================================
// Test 3: integration-checker runs in the single parallel batch (no sequential Batch 2)
// ============================================================
// The two-batch quality sequencing was removed — audit-bug-detector and
// integration-checker discover the codebase themselves (no dependency on the other
// auditors), so quality now runs all 10 in one parallel batch like premium.
console.log('\nTest 3: single-batch placement (no deferred Batch 2)');
assert(
  !lowerAudit.includes('batch 2'),
  'audit.md no longer defers integration-checker to a sequential Batch 2 (merged into one parallel batch)'
);
assert(
  lowerAudit.includes('integration-checker'),
  'integration-checker is still listed among the parallel audit agents'
);

// ============================================================
// Test 4: Implementation mode delegation table entry
// ============================================================
console.log('\nTest 4: Implementation mode delegation table');
// Look for a table row with integration-checker
const tableRowPattern = /\|\s*integration-checker\s*\|/;
assert(
  tableRowPattern.test(auditContent),
  'audit.md has implementation mode delegation table entry for integration-checker'
);

// ============================================================
// Test 5: --only flag accepts "integration"
// ============================================================
console.log('\nTest 5: --only flag supports integration');
assert(
  auditContent.includes('integration') && (lowerAudit.includes('--only') || lowerAudit.includes('only flag')),
  'audit.md --only flag documentation includes "integration" as valid value'
);

// ============================================================
// Test 6: Agent count updated to 10
// ============================================================
console.log('\nTest 6: Agent count updated');
// The count references should reflect 10 agents total (was 9)
assert(
  auditContent.includes('10 agents') || auditContent.includes('[2/10]') || auditContent.includes('ten agents'),
  'audit.md agent count references updated to 10 agents'
);

// ============================================================
// Test 7: audit/SKILL.md has integration-checker prefix
// ============================================================
console.log('\nTest 7: audit/SKILL.md Agent Prefixes table');
let auditSkillContent;
try {
  auditSkillContent = fs.readFileSync(AUDIT_SKILL_PATH, 'utf8');
} catch (e) {
  failed++;
  console.log('  FAIL: audit/SKILL.md could not be read');
  auditSkillContent = '';
}
if (auditSkillContent) {
  assert(
    auditSkillContent.includes('integration-checker') && auditSkillContent.includes('INT') && auditSkillContent.includes('F-INT'),
    'audit/SKILL.md Agent Prefixes table has integration-checker | INT | F-INT-001 row'
  );
}

// ============================================================
// Test 8: core/SKILL.md has model delegation section
// ============================================================
console.log('\nTest 8: core/SKILL.md model delegation');
let coreSkillContent;
try {
  coreSkillContent = fs.readFileSync(CORE_SKILL_PATH, 'utf8');
} catch (e) {
  failed++;
  console.log('  FAIL: core/SKILL.md could not be read');
  coreSkillContent = '';
}
if (coreSkillContent) {
  assert(
    coreSkillContent.includes('model: "sonnet"') && coreSkillContent.includes('Model selection principle'),
    'core/SKILL.md has model delegation principle with sonnet guidance'
  );
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
