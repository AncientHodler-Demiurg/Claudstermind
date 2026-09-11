#!/usr/bin/env node
// Test: swarm-consolidator.md agent has deduplication, cross-agent consensus scoring,
// evidence chains, severity-ordered output, and read-only constraint.
// dispatch.js RULES cover SubagentStop routing; inject-memory.sh registers agent.
// After perf/validator-dispatcher: matchers live in dispatch.js RULES, not hooks.json.

const fs = require('fs');
const path = require('path');

const CONSOLIDATOR_PATH = path.join(
  __dirname, '..', '..', 'agents', 'swarm-consolidator.md'
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
// Agent file tests (Tests 1-10)
// ============================================================

let agentContent;
try {
  agentContent = fs.readFileSync(CONSOLIDATOR_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: swarm-consolidator.md does not exist at expected path');
  console.log(`  Expected: ${CONSOLIDATOR_PATH}`);
  console.log(`\nResults: 0 passed, 10 failed out of 10 assertions`);
  process.exit(1);
}

const agentLower = agentContent.toLowerCase();

// Test 1: swarm-consolidator.md exists and has valid frontmatter
console.log('Test 1: Valid frontmatter');
const hasFrontmatter = agentContent.includes('name: swarm-consolidator') &&
  agentContent.includes('description:') &&
  agentContent.includes('tools:') &&
  agentContent.includes('model:') &&
  agentContent.includes('skills:');
assert(hasFrontmatter, 'swarm-consolidator.md has valid frontmatter with name, description, tools, model, skills');

// Test 2: Contains cross-agent consensus scoring logic
console.log('\nTest 2: Cross-agent consensus scoring');
assert(
  agentLower.includes('cross-agent consensus'),
  'swarm-consolidator.md contains "cross-agent consensus" scoring logic'
);

// Test 3: Contains deduplication logic checking same file + overlapping line ranges
console.log('\nTest 3: Deduplication logic');
assert(
  agentLower.includes('dedup') &&
  agentLower.includes('same file') &&
  (agentLower.includes('line range') || agentLower.includes('overlapping')),
  'swarm-consolidator.md contains deduplication logic checking same file + overlapping line ranges'
);

// Test 4: Contains severity escalation rule (findings flagged by 2+ agents rank higher)
console.log('\nTest 4: Severity escalation');
assert(
  agentLower.includes('escalat') &&
  (agentContent.includes('2+') || agentContent.includes('2 agents') || agentContent.includes('2+ agents')),
  'swarm-consolidator.md contains severity escalation rule (findings flagged by 2+ agents rank higher)'
);

// Test 5: Contains Evidence chain requirement per finding
console.log('\nTest 5: Evidence chain');
assert(
  agentContent.includes('Evidence') &&
  (agentLower.includes('evidence chain') || agentLower.includes('trace')),
  'swarm-consolidator.md contains "Evidence" chain requirement per finding'
);

// Test 6: Contains Consensus field showing N/M agents and agent names
console.log('\nTest 6: Consensus field');
assert(
  agentContent.includes('Consensus') &&
  (agentContent.includes('N/M') || agentContent.includes('{N}/{M}')),
  'swarm-consolidator.md contains "Consensus" field showing N/M agents and agent names'
);

// Test 7: Contains severity-ordered output format (Critical first, then High, then Medium)
console.log('\nTest 7: Severity-ordered output');
const criticalIdx = agentContent.indexOf('#### Critical');
const highIdx = agentContent.indexOf('#### High');
const mediumIdx = agentContent.indexOf('#### Medium');
assert(
  criticalIdx !== -1 && highIdx !== -1 && mediumIdx !== -1 &&
  criticalIdx < highIdx && highIdx < mediumIdx,
  'swarm-consolidator.md contains severity-ordered output format (Critical first, then High, then Medium)'
);

// Test 8: Contains instruction to NOT modify code (read-only)
console.log('\nTest 8: Read-only constraint');
assert(
  agentLower.includes('do not modify code') || agentLower.includes('not modify code') ||
  agentLower.includes('read-only'),
  'swarm-consolidator.md contains instruction to NOT modify code (read-only)'
);

// Test 9: Output format includes all 13 finding fields
console.log('\nTest 9: All 13 finding fields');
const requiredFields = [
  'Severity', 'Category', 'File', 'Lines', 'Evidence', 'Impact',
  'Test Gap', 'Description', 'Suggested Fix', 'Consensus',
  'Validation', 'Fix Status', 'Source Agents'
];
const hasAllFields = requiredFields.every(field => agentContent.includes(`**${field}:**`));
assert(
  hasAllFields,
  'swarm-consolidator.md output format includes all 13 finding fields (Severity, Category, File, Lines, Evidence, Impact, Test Gap, Description, Suggested Fix, Consensus, Validation, Fix Status, Source Agents)'
);

// Test 10: Contains segment-aware dedup (same segment findings prioritized over cross-segment)
console.log('\nTest 10: Segment-aware dedup');
assert(
  agentLower.includes('same segment') && agentLower.includes('cross-segment'),
  'swarm-consolidator.md contains segment-aware dedup (same segment findings prioritized over cross-segment)'
);

// ============================================================
// Hooks.json tests (Tests 11-15)
// ============================================================

let hooksContent;
try {
  hooksContent = fs.readFileSync(HOOKS_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: hooks.json does not exist at expected path');
  console.log(`  Expected: ${HOOKS_PATH}`);
  console.log(`\nResults: ${passed} passed, ${failed + 6} failed out of ${passed + failed + 6} assertions`);
  process.exit(1);
}

let hooksJson;
try {
  hooksJson = JSON.parse(hooksContent);
} catch (e) {
  console.log('FAIL: hooks.json is not valid JSON');
  console.log(`\nResults: ${passed} passed, ${failed + 6} failed out of ${passed + failed + 6} assertions`);
  process.exit(1);
}

const subagentStopHooks = hooksJson.hooks.SubagentStop || [];

// Test 11: dispatch.js RULES contains entry for swarm-consolidator
// (After perf/validator-dispatcher: matchers live in dispatch.js RULES.)
console.log('\nTest 11: dispatch.js RULES swarm-consolidator entry');
const { pickValidator } = require(DISPATCH_PATH);
assert(
  pickValidator('swarm-consolidator') === 'swarm-consolidator',
  'dispatch.js RULES routes "swarm-consolidator" to swarm-consolidator validator'
);

// Test 12: hooks.json swarm-consolidator SubagentStop validates "## Swarm Review Consolidation" heading
console.log('\nTest 12: hooks.json Swarm Review Consolidation heading check');
/* removed: superseded (Phase 2 triage) */

// Test 13: hooks.json swarm-consolidator SubagentStop validates "Findings (severity-ordered)" section
console.log('\nTest 13: hooks.json Findings severity-ordered check');
/* removed: superseded (Phase 2 triage) */

// Test 14: hooks.json swarm-consolidator SubagentStop validates "Consensus" field presence
console.log('\nTest 14: hooks.json Consensus field check');
/* removed: superseded (Phase 2 triage) */

// Test 15: hooks.json swarm-consolidator SubagentStop checks read-only constraint
console.log('\nTest 15: hooks.json read-only constraint check');
/* removed: superseded (Phase 2 triage) */

// ============================================================
// inject-memory.sh test (Test 16)
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

// Test 16: inject-memory.sh contains "swarm-consolidator" in case statement
console.log('\nTest 16: inject-memory.sh whitelist');
assert(
  injectMemoryContent.includes('swarm-consolidator'),
  'inject-memory.sh contains "swarm-consolidator" in the agent case statement'
);

// ============================================================
// swarm-review.md command tests (Tests 17-32)
// ============================================================

const SWARM_REVIEW_CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'swarm-review.md'
);

let cmdContent;
try {
  cmdContent = fs.readFileSync(SWARM_REVIEW_CMD_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: swarm-review.md command does not exist at expected path');
  console.log(`  Expected: ${SWARM_REVIEW_CMD_PATH}`);
  // All 16 command tests fail
  for (let i = 17; i <= 32; i++) {
    failed++;
    console.log(`  FAIL: Test ${i} (swarm-review.md not found)`);
  }
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  process.exit(1);
}

const cmdLower = cmdContent.toLowerCase();

// Test 17: swarm-review.md exists and has valid frontmatter with description and argument-hint
console.log('\nTest 17: Valid command frontmatter');
assert(
  cmdContent.includes('description:') && cmdContent.includes('argument-hint:'),
  'swarm-review.md has valid frontmatter with description and argument-hint'
);

// Test 18: swarm-review.md contains 6 invocation paths
console.log('\nTest 18: 6 invocation paths');
assert(
  cmdLower.includes('post-phase') &&
  cmdLower.includes('post-implementation') &&
  cmdLower.includes('ad-hoc') &&
  cmdLower.includes('cross-phase') &&
  cmdLower.includes('pre-commit') &&
  cmdLower.includes('external'),
  'swarm-review.md contains all 6 invocation paths: post-phase, post-implementation, ad-hoc, cross-phase, pre-commit, external'
);

// Test 19: swarm-review.md contains segmentation logic with at least 3 strategies
console.log('\nTest 19: Segmentation strategies');
assert(
  cmdLower.includes('per-file') &&
  cmdLower.includes('per-component') &&
  cmdLower.includes('per-layer'),
  'swarm-review.md contains segmentation with 3 strategies: per-file, per-component, per-layer'
);

// Test 20: swarm-review.md contains agent relevance mapping
console.log('\nTest 20: Agent relevance mapping');
assert(
  cmdLower.includes('agent relevance') || cmdLower.includes('relevance mapping'),
  'swarm-review.md contains agent relevance mapping (which agents are dispatched per segment type)'
);

// Test 21: swarm-review.md spawns agents in parallel
console.log('\nTest 21: Parallel dispatch');
assert(
  cmdLower.includes('parallel'),
  'swarm-review.md mentions "parallel" in dispatch step'
);

// Test 21b: swarm-review.md batches validators (cap = 10)
console.log('\nTest 21b: Batch cap = 10');
assert(
  cmdContent.includes('up to 10') && cmdLower.includes('batch'),
  'swarm-review.md pins validator batch cap at 10 (Batch up to 10 validators at a time)'
);

// Test 22: swarm-review.md spawns swarm-consolidator agent
console.log('\nTest 22: Spawns swarm-consolidator');
assert(
  cmdContent.includes('swarm-consolidator'),
  'swarm-review.md spawns swarm-consolidator agent with raw findings'
);

// Test 23: swarm-review.md spawns finding-validator agents
console.log('\nTest 23: Spawns finding-validator');
assert(
  cmdContent.includes('finding-validator'),
  'swarm-review.md spawns finding-validator agents for false positive filtering'
);

// Test 24: swarm-review.md writes SWARM-REVIEW.md output file
console.log('\nTest 24: Writes SWARM-REVIEW.md output');
assert(
  cmdContent.includes('SWARM-REVIEW.md'),
  'swarm-review.md writes SWARM-REVIEW.md output file'
);

// Test 25: swarm-review.md contains implementation_mode model tier table
console.log('\nTest 25: Model tier table');
assert(
  cmdContent.includes('implementation_mode') || cmdContent.includes('IMPL_MODE'),
  'swarm-review.md contains implementation_mode model tier reference'
);
const hasTierTable = cmdContent.includes('Economy') && cmdContent.includes('Quality') && cmdContent.includes('Premium');
assert(
  hasTierTable,
  'swarm-review.md contains Economy/Quality/Premium model tier table'
);

// Test 26: swarm-review.md contains context cache step
console.log('\nTest 26: Context cache step');
assert(
  cmdLower.includes('context cache') &&
  cmdContent.includes('SKILL.md') &&
  cmdContent.includes('CONTEXT.md') &&
  cmdContent.includes('false-positives') &&
  cmdContent.includes('user.md'),
  'swarm-review.md contains context cache step (stack skill, CONTEXT.md, false positives, user.md)'
);

// Test 27: swarm-review.md contains error recovery for agent crashes
console.log('\nTest 27: Error recovery');
assert(
  cmdLower.includes('error recovery') || cmdLower.includes('agent crash'),
  'swarm-review.md contains error recovery for agent crashes'
);

// Test 28: swarm-review.md contains --only flag
console.log('\nTest 28: --only flag');
assert(
  cmdContent.includes('--only'),
  'swarm-review.md contains --only flag for filtering which agents run'
);

// Test 29: swarm-review.md contains --severity flag
console.log('\nTest 29: --severity flag');
assert(
  cmdContent.includes('--severity'),
  'swarm-review.md contains --severity flag for filtering output'
);

// Test 30: swarm-review.md contains interactive menu (AskUserQuestion)
console.log('\nTest 30: Interactive menu');
assert(
  cmdContent.includes('AskUserQuestion'),
  'swarm-review.md contains interactive menu at the end (AskUserQuestion)'
);

// Test 31: swarm-review.md does NOT require .bee/ for ad-hoc and external repo paths
console.log('\nTest 31: No .bee/ requirement for ad-hoc/external');
assert(
  cmdLower.includes('no `.bee/` required') || cmdLower.includes('no .bee/ required') ||
  cmdLower.includes('do not require `.bee/`') || cmdLower.includes('do not require .bee/'),
  'swarm-review.md does NOT require .bee/ initialization for ad-hoc/external repo paths'
);

// Test 32: swarm-review.md contains dependency scan step
console.log('\nTest 32: Dependency scan');
assert(
  cmdLower.includes('dependency scan') &&
  (cmdLower.includes('import') || cmdLower.includes('require')),
  'swarm-review.md contains dependency scan step (import/require expansion)'
);

// ============================================================
// do.md and help.md wiring tests (Tests 33-36)
// ============================================================

const DO_CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'do.md'
);
const HELP_CMD_PATH = path.join(
  __dirname, '..', '..', 'commands', 'help.md'
);

let doContent;
try {
  doContent = fs.readFileSync(DO_CMD_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: do.md does not exist at expected path');
  console.log(`  Expected: ${DO_CMD_PATH}`);
  failed += 2;
  console.log(`  FAIL: Test 33 (do.md not found)`);
  console.log(`  FAIL: Test 34 (do.md not found)`);
  doContent = '';
}

let helpContent;
try {
  helpContent = fs.readFileSync(HELP_CMD_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: help.md does not exist at expected path');
  console.log(`  Expected: ${HELP_CMD_PATH}`);
  failed += 2;
  console.log(`  FAIL: Test 35 (help.md not found)`);
  console.log(`  FAIL: Test 36 (help.md not found)`);
  helpContent = '';
}

const doLower = doContent.toLowerCase();
const helpLower = helpContent.toLowerCase();

// Test 33: do.md routing table contains "swarm-review" command entry
console.log('\nTest 33: do.md swarm-review routing');
if (doContent) {
  assert(
    doContent.includes('swarm-review'),
    'do.md routing table contains "swarm-review" command entry'
  );
}

// Test 34: do.md routing keywords include "swarm" and "deep review" and "multi-agent review"
console.log('\nTest 34: do.md swarm keywords');
if (doContent) {
  assert(
    doLower.includes('swarm') && doLower.includes('deep review') && doLower.includes('multi-agent review'),
    'do.md routing keywords include "swarm" and "deep review" and "multi-agent review"'
  );
}

// Test 35: help.md Quality category contains "swarm-review"
console.log('\nTest 35: help.md swarm-review in Quality');
if (helpContent) {
  assert(
    helpContent.includes('swarm-review'),
    'help.md Quality category contains "swarm-review"'
  );
}

// Test 36: help.md swarm-review entry appears after "audit-to-spec" and before "ui-spec"
console.log('\nTest 36: help.md swarm-review position');
if (helpContent) {
  const auditToSpecIdx = helpContent.indexOf('audit-to-spec');
  const swarmReviewIdx = helpContent.indexOf('swarm-review');
  const uiSpecIdx = helpContent.indexOf('ui-spec');
  assert(
    auditToSpecIdx !== -1 && swarmReviewIdx !== -1 && uiSpecIdx !== -1 &&
    auditToSpecIdx < swarmReviewIdx && swarmReviewIdx < uiSpecIdx,
    'help.md swarm-review entry appears after "audit-to-spec" and before "ui-spec"'
  );
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
