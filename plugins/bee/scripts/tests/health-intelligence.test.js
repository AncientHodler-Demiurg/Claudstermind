#!/usr/bin/env node
// Test: HLT-01/02/03 structural validation -- health history + baseline (HLT-01),
// trend detection + resume integration (HLT-02), new check dimensions (HLT-03),
// and ecosystem wiring (do.md, help.md).
// Validates all Phase 30 Plan 02 structural requirements.

const fs = require('fs');
const path = require('path');

const HEALTH_PATH = path.join(
  __dirname, '..', '..', 'commands', 'health.md'
);
const RESUME_PATH = path.join(
  __dirname, '..', '..', 'commands', 'resume.md'
);
const DO_PATH = path.join(
  __dirname, '..', '..', 'commands', 'do.md'
);
const HELP_PATH = path.join(
  __dirname, '..', '..', 'commands', 'help.md'
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

// Read all files
let healthContent, resumeContent, doContent, helpContent;

try {
  healthContent = fs.readFileSync(HEALTH_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: health.md does not exist at expected path');
  console.log(`  Expected: ${HEALTH_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

try {
  resumeContent = fs.readFileSync(RESUME_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: resume.md does not exist at expected path');
  console.log(`  Expected: ${RESUME_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

try {
  doContent = fs.readFileSync(DO_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: do.md does not exist at expected path');
  console.log(`  Expected: ${DO_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

try {
  helpContent = fs.readFileSync(HELP_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: help.md does not exist at expected path');
  console.log(`  Expected: ${HELP_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// --- HLT-01: Health History and Baseline Tests ---
// ============================================================
console.log('\n--- HLT-01: Health History and Baseline Tests ---');

// Test 1: health.md contains health-history.json path reference
assert(
  healthContent.includes('health-history.json'),
  'health.md contains "health-history.json" path reference'
);

// Test 2: health.md contains JSON schema with "timestamp" field
assert(
  healthContent.includes('"timestamp"'),
  'health.md contains JSON schema with "timestamp" field'
);

// Test 3: health.md contains JSON schema with "overall_status" field
assert(
  healthContent.includes('"overall_status"'),
  'health.md contains JSON schema with "overall_status" field'
);

// Test 4: health.md contains JSON schema with "checks" object
assert(
  healthContent.includes('"checks"'),
  'health.md contains JSON schema with "checks" object'
);

// Test 5: health.md contains all 13 check keys in the checks object
const checkKeys = [
  'state_md', 'config_json', 'spec_path', 'phase_dirs',
  'hung_phases', 'tasks_md', 'git', 'metrics',
  'seeds', 'workflow_health', 'code_quality', 'productivity',
  'forensic_xref'
];
const allKeysPresent = checkKeys.every(key =>
  healthContent.includes(`"${key}"`)
);
assert(
  allKeysPresent,
  'health.md contains all 13 check keys (state_md, config_json, spec_path, phase_dirs, hung_phases, tasks_md, git, metrics, seeds, workflow_health, code_quality, productivity, forensic_xref)'
);

// Test 6: health.md contains baseline computation (reference to "5" entries threshold)
assert(
  healthContent.includes('5') && healthContent.includes('baseline'),
  'health.md contains baseline computation with 5-entry threshold'
);

// Test 7: health.md contains "Establishing" (pre-baseline state display)
assert(
  healthContent.includes('Establishing'),
  'health.md contains "Establishing" pre-baseline state display'
);

// Test 8: health.md contains "mkdir -p" for metrics directory creation
assert(
  healthContent.includes('mkdir -p'),
  'health.md contains "mkdir -p" for metrics directory creation'
);

// Test 9: health.md contains "last 20" (history cap)
assert(
  healthContent.includes('last 20'),
  'health.md contains "last 20" history cap reference'
);

// ============================================================
// --- HLT-02: Trend Detection Tests ---
// ============================================================
console.log('\n--- HLT-02: Trend Detection Tests ---');

// Test 10: health.md contains "trend" or "Trend" (trend detection section)
assert(
  /[Tt]rend/.test(healthContent),
  'health.md contains trend detection references'
);

// Test 11: health.md contains "3" and "consecutive" (degradation threshold)
assert(
  healthContent.includes('3') && healthContent.includes('consecutive'),
  'health.md contains degradation threshold (3 consecutive)'
);

// Test 12: health.md contains "remediation" (recovery suggestions for trends)
assert(
  healthContent.includes('remediation'),
  'health.md contains "remediation" recovery suggestions for trends'
);

// Test 13: health.md contains "degraded_since" or "degrading since" (trend alert info)
assert(
  healthContent.includes('degraded_since') || healthContent.includes('degrading since'),
  'health.md contains degradation tracking info (degraded_since or degrading since)'
);

// Test 14: resume.md contains "health-history.json" (reads for briefing)
assert(
  resumeContent.includes('health-history.json'),
  'resume.md contains "health-history.json" reference for briefing'
);

// Test 15: resume.md contains "Health baseline" (baseline display in briefing)
assert(
  resumeContent.includes('Health baseline'),
  'resume.md contains "Health baseline" display in briefing'
);

// Test 16: resume.md contains "degrading" (trend alert in briefing)
assert(
  resumeContent.includes('degrading'),
  'resume.md contains "degrading" trend alert in briefing'
);

// ============================================================
// --- HLT-03: New Check Dimensions Tests ---
// ============================================================
console.log('\n--- HLT-03: New Check Dimensions Tests ---');

// Test 17: health.md contains "Check 10" with "Workflow Health"
assert(
  healthContent.includes('Check 10') && healthContent.includes('Workflow Health'),
  'health.md contains Check 10 with Workflow Health'
);

// Test 18: health.md contains "Check 11" with "Code Quality"
assert(
  healthContent.includes('Check 11') && healthContent.includes('Code Quality'),
  'health.md contains Check 11 with Code Quality'
);

// Test 19: health.md contains "Check 12" with "Productivity"
assert(
  healthContent.includes('Check 12') && healthContent.includes('Productivity'),
  'health.md contains Check 12 with Productivity'
);

// Test 20: health.md contains "No metrics data yet" (backward compat)
assert(
  healthContent.includes('No metrics data yet'),
  'health.md contains "No metrics data yet" backward compatibility message'
);

// Test 21: health.md contains "review.findings" or "findings.critical" (finding data access)
assert(
  healthContent.includes('review.findings') || healthContent.includes('findings.critical'),
  'health.md contains findings data access (review.findings or findings.critical)'
);

// Test 22: health.md contains bottleneck signal reference (review_pct or review.duration_seconds)
assert(
  healthContent.includes('review_pct') || healthContent.includes('review.duration_seconds'),
  'health.md contains bottleneck signal reference (review_pct or review.duration_seconds)'
);

// Test 23: health.md contains "execution.duration_seconds" or total duration computation
assert(
  healthContent.includes('execution.duration_seconds'),
  'health.md contains "execution.duration_seconds" for total duration computation'
);

// ============================================================
// --- Integration Wiring Tests ---
// ============================================================
console.log('\n--- Integration Wiring Tests ---');

// Test 24: do.md contains "baseline" in keyword routing
assert(
  doContent.includes('baseline'),
  'do.md contains "baseline" in keyword routing'
);

// Test 25: do.md contains "trend" in keyword routing
assert(
  doContent.includes('trend'),
  'do.md contains "trend" in keyword routing'
);

// Test 26: help.md contains "baseline" near health description
assert(
  helpContent.includes('baseline'),
  'help.md contains "baseline" near health description'
);

// Test 27: help.md contains "13" near health description (13 checks after Phase 32 added Check 13)
assert(
  helpContent.includes('13 checks'),
  'help.md contains "13 checks" near health description'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
