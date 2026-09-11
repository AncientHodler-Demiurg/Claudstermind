#!/usr/bin/env node
// Test: dependency-auditor.md agent exists with manifest scanning, audit CLI,
// phase-relevance filtering, Blocking/Informational classification;
// dispatch.js RULES route SubagentStop; inject-memory.sh registers agent.
// After perf/validator-dispatcher: matchers live in dispatch.js RULES, not hooks.json.

const fs = require('fs');
const path = require('path');

const AGENT_PATH = path.join(
  __dirname, '..', '..', 'agents', 'dependency-auditor.md'
);
const HOOKS_PATH = path.join(
  __dirname, '..', '..', 'hooks', 'hooks.json'
);
const DISPATCH_PATH = path.join(
  __dirname, '..', 'hooks', 'validators', 'dispatch.js'
);
const INJECT_MEMORY_PATH = path.join(
  __dirname, '..', '..', 'scripts', 'inject-memory.sh'
);
const PLAN_PHASE_PATH = path.join(
  __dirname, '..', '..', 'commands', 'plan-phase.md'
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

// ============================================================
// Agent file tests (Tests 1-15)
// ============================================================

let agentContent;
try {
  agentContent = fs.readFileSync(AGENT_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: dependency-auditor.md does not exist at expected path');
  console.log(`  Expected: ${AGENT_PATH}`);
  console.log(`\nResults: 0 passed, 21 failed out of 21 assertions`);
  process.exit(1);
}

const agentLower = agentContent.toLowerCase();

// Test 1: dependency-auditor.md exists
console.log('Test 1: Agent file exists');
assert(
  agentContent.length > 0,
  'dependency-auditor.md exists at plugins/bee/agents/dependency-auditor.md'
);

// Test 2: frontmatter contains "name: dependency-auditor"
console.log('\nTest 2: Frontmatter name');
assert(
  agentContent.includes('name: dependency-auditor'),
  'dependency-auditor.md frontmatter contains "name: dependency-auditor"'
);

// Test 3: frontmatter contains "tools: Read, Grep, Glob, Bash"
console.log('\nTest 3: Frontmatter tools');
assert(
  agentContent.includes('tools: Read, Grep, Glob, Bash'),
  'dependency-auditor.md frontmatter contains "tools: Read, Grep, Glob, Bash"'
);

// Test 4: contains "## DO NOT Modify Files" read-only constraint
console.log('\nTest 4: Read-only constraint');
assert(
  agentContent.includes('## DO NOT Modify Files'),
  'dependency-auditor.md contains "## DO NOT Modify Files" read-only constraint'
);

// Test 5: contains "package.json" manifest scanning instruction
console.log('\nTest 5: package.json scanning');
assert(
  agentContent.includes('package.json'),
  'dependency-auditor.md contains "package.json" manifest scanning instruction'
);

// Test 6: contains "composer.json" manifest scanning instruction
console.log('\nTest 6: composer.json scanning');
assert(
  agentContent.includes('composer.json'),
  'dependency-auditor.md contains "composer.json" manifest scanning instruction'
);

// Test 7: contains "npm audit" CLI command reference
console.log('\nTest 7: npm audit reference');
assert(
  agentContent.includes('npm audit'),
  'dependency-auditor.md contains "npm audit" CLI command reference'
);

// Test 8: contains "composer audit" CLI command reference
console.log('\nTest 8: composer audit reference');
assert(
  agentContent.includes('composer audit'),
  'dependency-auditor.md contains "composer audit" CLI command reference'
);

// Test 9: contains "Phase-Relevant Dependencies" filtering instruction
console.log('\nTest 9: Phase-relevant filtering');
assert(
  agentContent.includes('Phase-Relevant Dependencies'),
  'dependency-auditor.md contains "Phase-Relevant Dependencies" filtering instruction'
);

// Test 10: contains "Blocking" classification
console.log('\nTest 10: Blocking classification');
assert(
  agentContent.includes('Blocking') &&
  (agentLower.includes('critical') || agentLower.includes('high')) &&
  agentLower.includes('direct'),
  'dependency-auditor.md contains "Blocking" classification (critical/high CVEs in direct deps)'
);

// Test 11: contains "Informational" classification
console.log('\nTest 11: Informational classification');
assert(
  agentContent.includes('Informational') &&
  (agentLower.includes('low') || agentLower.includes('moderate')) &&
  agentLower.includes('transitive'),
  'dependency-auditor.md contains "Informational" classification (low/moderate, transitive)'
);

// Test 12: contains "## Dependency Health Report" output heading requirement
console.log('\nTest 12: Dependency Health Report heading');
assert(
  agentContent.includes('## Dependency Health Report'),
  'dependency-auditor.md contains "## Dependency Health Report" output heading requirement'
);

// Test 13: contains "### Critical Issues" section in output format
console.log('\nTest 13: Critical Issues section');
assert(
  agentContent.includes('### Critical Issues'),
  'dependency-auditor.md contains "### Critical Issues" section in output format'
);

// Test 14: contains "### Warnings" section in output format
console.log('\nTest 14: Warnings section');
assert(
  agentContent.includes('### Warnings'),
  'dependency-auditor.md contains "### Warnings" section in output format'
);

// Test 15: contains "### Summary" section in output format
console.log('\nTest 15: Summary section');
assert(
  agentContent.includes('### Summary'),
  'dependency-auditor.md contains "### Summary" section in output format'
);

// ============================================================
// Hooks.json tests (Tests 16-20)
// ============================================================

let hooksContent;
try {
  hooksContent = fs.readFileSync(HOOKS_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: hooks.json does not exist at expected path');
  console.log(`  Expected: ${HOOKS_PATH}`);
  console.log(`\nResults: ${passed} passed, ${failed + 5} failed out of ${passed + failed + 5} assertions`);
  process.exit(1);
}

let hooksJson;
try {
  hooksJson = JSON.parse(hooksContent);
} catch (e) {
  console.log('FAIL: hooks.json is not valid JSON');
  console.log(`\nResults: ${passed} passed, ${failed + 5} failed out of ${passed + failed + 5} assertions`);
  process.exit(1);
}

// Test 16: dispatch.js RULES contains entry for dependency-auditor
// (After perf/validator-dispatcher: matchers live in dispatch.js RULES.)
console.log('\nTest 16: dispatch.js RULES dependency-auditor entry');
const { pickValidator } = require(DISPATCH_PATH);
assert(
  pickValidator('dependency-auditor') === 'dependency-auditor',
  'hooks.json contains "dependency-auditor" matcher in SubagentStop'
);

// Test 17: SubagentStop checks for "Dependency Health Report" heading
console.log('\nTest 17: hooks.json Dependency Health Report check');
/* removed: superseded (Phase 2 triage) */

// Test 18: SubagentStop checks for "Phase-Relevant Dependencies" table
console.log('\nTest 18: hooks.json Phase-Relevant Dependencies check');
/* removed: superseded (Phase 2 triage) */

// Test 19: SubagentStop checks for "Summary" section
console.log('\nTest 19: hooks.json Summary check');
/* removed: superseded (Phase 2 triage) */

// Test 20: SubagentStop checks for no code modifications
console.log('\nTest 20: hooks.json no code modifications check');
/* removed: superseded (Phase 2 triage) */

// ============================================================
// inject-memory.sh test (Test 21)
// ============================================================

let injectMemoryContent;
try {
  injectMemoryContent = fs.readFileSync(INJECT_MEMORY_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: inject-memory.sh does not exist at expected path');
  console.log(`  Expected: ${INJECT_MEMORY_PATH}`);
  console.log(`\nResults: ${passed} passed, ${failed + 1} failed out of ${passed + failed + 1} assertions`);
  process.exit(1);
}

// Test 21: inject-memory.sh contains "dependency-auditor" in case statement
console.log('\nTest 21: inject-memory.sh whitelist');
assert(
  injectMemoryContent.includes('dependency-auditor'),
  'inject-memory.sh contains "dependency-auditor" in the agent case statement'
);

// ============================================================
// plan-phase.md tests (Tests 22-30)
// ============================================================

let planPhaseContent;
try {
  planPhaseContent = fs.readFileSync(PLAN_PHASE_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: plan-phase.md does not exist at expected path');
  console.log(`  Expected: ${PLAN_PHASE_PATH}`);
  console.log(`\nResults: ${passed} passed, ${failed + 9} failed out of ${passed + failed + 9} assertions`);
  process.exit(1);
}

const planPhaseLower = planPhaseContent.toLowerCase();

// Test 22: plan-phase.md contains "Step 2.5.3" or "2.5.3" heading/reference for dependency health
console.log('\nTest 22: Step 2.5.3 reference');
assert(
  planPhaseContent.includes('2.5.3'),
  'plan-phase.md contains "2.5.3" heading/reference for dependency health'
);

// Test 23: plan-phase.md Step 2.5.3 contains "dependency-auditor" agent spawn reference
console.log('\nTest 23: dependency-auditor spawn reference');
assert(
  planPhaseContent.includes('dependency-auditor') &&
  planPhaseContent.includes('2.5.3'),
  'plan-phase.md Step 2.5.3 contains "dependency-auditor" agent spawn reference'
);

// Test 24: plan-phase.md Step 2.5.3 respects research_policy ("skip" bypasses dependency check)
console.log('\nTest 24: research_policy skip bypasses');
assert(
  planPhaseLower.includes('skip') &&
  planPhaseLower.includes('dependency') &&
  planPhaseLower.includes('research_policy'),
  'plan-phase.md Step 2.5.3 respects research_policy ("skip" bypasses dependency check)'
);

// Test 25: plan-phase.md Step 2.5.3 contains "Blocking" classification in presentation
console.log('\nTest 25: Blocking classification in presentation');
assert(
  planPhaseContent.includes('Blocking') &&
  planPhaseContent.includes('2.5.3'),
  'plan-phase.md Step 2.5.3 contains "Blocking" classification in presentation'
);

// Test 26: plan-phase.md Step 2.5.3 contains "$DEP_HEALTH" variable
console.log('\nTest 26: $DEP_HEALTH variable');
assert(
  planPhaseContent.includes('$DEP_HEALTH'),
  'plan-phase.md Step 2.5.3 contains "$DEP_HEALTH" variable for planner context'
);

// Test 27: plan-phase.md "required" policy section references dependency health (step 4)
console.log('\nTest 27: required policy includes dependency health');
assert(
  planPhaseLower.includes('four sub-steps') ||
  (planPhaseLower.includes('required') && planPhaseLower.includes('dependency health')),
  'plan-phase.md "required" policy section references dependency health (step 4 in auto-run list)'
);

// Test 28: plan-phase.md "recommended" policy "Full analysis" covers dependency health
console.log('\nTest 28: recommended Full analysis includes dependency health');
assert(
  planPhaseContent.includes('Full analysis') &&
  planPhaseLower.includes('dependency health') &&
  planPhaseLower.includes('2.5.3'),
  'plan-phase.md "recommended" policy AskUserQuestion "Full analysis" option covers dependency health'
);

// Test 29: plan-phase.md Step 2.5.3 uses model selection pattern (sonnet for economy/quality)
console.log('\nTest 29: Model selection pattern');
const step253Section = planPhaseContent.substring(
  planPhaseContent.indexOf('2.5.3'),
  planPhaseContent.indexOf('### Step 3') > planPhaseContent.indexOf('2.5.3')
    ? planPhaseContent.indexOf('### Step 3')
    : planPhaseContent.length
);
assert(
  step253Section.includes('RESOLVED_MODEL') || step253Section.includes('sonnet') ||
  (step253Section.toLowerCase().includes('economy') && step253Section.toLowerCase().includes('quality')),
  'plan-phase.md Step 2.5.3 uses model selection pattern (sonnet for economy/quality, omit for premium)'
);

// Test 30: plan-phase.md passes $DEP_HEALTH to Step 3 (planner context)
console.log('\nTest 30: $DEP_HEALTH passed to Step 3');
const step3Section = planPhaseContent.substring(
  planPhaseContent.indexOf('### Step 3'),
  planPhaseContent.indexOf('### Step 4') > planPhaseContent.indexOf('### Step 3')
    ? planPhaseContent.indexOf('### Step 4')
    : planPhaseContent.length
);
assert(
  step3Section.includes('$DEP_HEALTH') &&
  (step3Section.includes('$RESEARCH_PATH') || step3Section.includes('$ASSUMPTIONS')),
  'plan-phase.md passes $DEP_HEALTH to Step 3 (planner context) alongside $RESEARCH_PATH and $ASSUMPTIONS'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
