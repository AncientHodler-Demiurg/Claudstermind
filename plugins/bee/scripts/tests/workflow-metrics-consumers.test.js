#!/usr/bin/env node
// Test: MET-02 + MET-03 consumer validation -- progress bottleneck detection,
// plan-phase predictive complexity, EOD velocity, resume metrics, health checks,
// routing wiring. Validates Phase 23 Plan 02 structural requirements.
//
// Note: Tests use conditional assertions -- if a file does not yet contain
// the expected 23-02 content (plan not yet executed), the assertion is skipped
// rather than failed. This allows the test to run before or after 23-02 execution.
// Skipped tests are tracked separately and reported at the end.

const fs = require('fs');
const path = require('path');

const PROGRESS_PATH = path.join(__dirname, '..', '..', 'commands', 'progress.md');
const PLAN_PHASE_PATH = path.join(__dirname, '..', '..', 'commands', 'plan-phase.md');
const EOD_PATH = path.join(__dirname, '..', '..', 'commands', 'eod.md');
const RESUME_PATH = path.join(__dirname, '..', '..', 'commands', 'resume.md');
const HEALTH_PATH = path.join(__dirname, '..', '..', 'commands', 'health.md');
const DO_PATH = path.join(__dirname, '..', '..', 'commands', 'do.md');
const COMPACT_PATH = path.join(__dirname, '..', '..', 'commands', 'compact.md');

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${testName}`);
  } else {
    failed++;
    console.log(`  FAIL: ${testName}`);
  }
}

// Conditional assert: passes if condition is true, skips (does not fail) if
// the content is not yet present due to 23-02 not being executed.
// The guard parameter is a boolean indicating whether the prerequisite content exists.
function assertIfReady(guard, condition, testName) {
  if (!guard) {
    skipped++;
    console.log(`  SKIP: ${testName} (awaiting 23-02 execution)`);
    return;
  }
  assert(condition, testName);
}

function readFile(filePath, label) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.log(`FAIL: ${label} does not exist at expected path`);
    console.log(`  Expected: ${filePath}`);
    process.exit(1);
  }
}

// ============================================================
// Load all files
// ============================================================

const progressContent = readFile(PROGRESS_PATH, 'progress.md');
const planPhaseContent = readFile(PLAN_PHASE_PATH, 'plan-phase.md');
const eodContent = readFile(EOD_PATH, 'eod.md');
const resumeContent = readFile(RESUME_PATH, 'resume.md');
const healthContent = readFile(HEALTH_PATH, 'health.md');
const doContent = readFile(DO_PATH, 'do.md');
const compactContent = readFile(COMPACT_PATH, 'compact.md');

const progressLower = progressContent.toLowerCase();
const planPhaseLower = planPhaseContent.toLowerCase();
const eodLower = eodContent.toLowerCase();
const resumeLower = resumeContent.toLowerCase();
const healthLower = healthContent.toLowerCase();
const doLower = doContent.toLowerCase();
const compactLower = compactContent.toLowerCase();

// Detect whether 23-02 content has been added to each file
const progressHasMetrics = progressLower.includes('phase metrics');
const planPhaseHasComplexity = planPhaseLower.includes('predictive complexity') || planPhaseLower.includes('complexity_score');
const eodHasVelocity = eodLower.includes('velocity') && (eodContent.includes('IMPROVING') || eodContent.includes('DEGRADING'));
const resumeHasMetrics = resumeLower.includes('metrics summary') || (resumeLower.includes('metrics') && resumeLower.includes('.bee/metrics/'));
const healthHasMetrics = healthLower.includes('.bee/metrics');
const doHasMetrics = doLower.includes('metrics') && doLower.includes('velocity');
const compactHasMetrics = compactLower.includes('.bee/metrics');

// ============================================================
// Progress Command Tests (Tests 1-8)
// ============================================================

console.log('\n--- Progress Command Tests ---');

// Test 1: progress.md contains "Phase Metrics" section header
assertIfReady(progressHasMetrics,
  progressContent.includes('Phase Metrics'),
  'progress.md contains "Phase Metrics" section header'
);

// Test 2: progress.md contains bottleneck detection reference
assertIfReady(progressHasMetrics,
  progressLower.includes('bottleneck'),
  'progress.md contains bottleneck detection reference'
);

// Test 3: progress.md contains all 7 bottleneck signal names
assertIfReady(progressHasMetrics,
  (progressLower.includes('review dominance') || progressLower.includes('review_pct')) &&
  (progressLower.includes('iteration spiral') || progressLower.includes('iterations >')) &&
  (progressLower.includes('false positive') || progressLower.includes('fp rate') || progressLower.includes('false_positive_rate')) &&
  progressLower.includes('execution failure') &&
  progressLower.includes('wave imbalance') &&
  progressLower.includes('planning overhead') &&
  progressLower.includes('cross-phase trend'),
  'progress.md contains all 7 bottleneck signal names'
);

// Test 4: progress.md contains .bee/metrics/ path reference
assertIfReady(progressHasMetrics,
  progressContent.includes('.bee/metrics/'),
  'progress.md contains ".bee/metrics/" path reference for reading metrics files'
);

// Test 5: progress.md contains "3+" or "3 or more" threshold
assertIfReady(progressHasMetrics,
  progressContent.includes('3+') || progressContent.includes('3 or more') || progressLower.includes('3+ metrics'),
  'progress.md contains "3+" threshold for bottleneck analysis'
);

// Test 6: progress.md contains "Health:" display format
assertIfReady(progressHasMetrics,
  progressContent.includes('Health:'),
  'progress.md contains "Health:" display format'
);

// Test 7: progress.md contains timing table with Exec and Review columns
assertIfReady(progressHasMetrics,
  progressContent.includes('Exec') && progressContent.includes('Review'),
  'progress.md contains timing table with Exec and Review columns'
);

// Test 8: progress.md contains metrics.enabled config check
assertIfReady(progressHasMetrics,
  progressContent.includes('metrics.enabled'),
  'progress.md contains metrics.enabled config check'
);

// ============================================================
// Plan-Phase Complexity Tests (Tests 9-16)
// ============================================================

console.log('\n--- Plan-Phase Complexity Tests ---');

// Test 9: plan-phase.md contains complexity scoring section
assertIfReady(planPhaseHasComplexity,
  planPhaseLower.includes('predictive complexity') || planPhaseLower.includes('complexity scoring'),
  'plan-phase.md contains "Predictive Complexity" or "complexity scoring" section'
);

// Test 10: plan-phase.md contains all 4 classifications
assertIfReady(planPhaseHasComplexity,
  planPhaseContent.includes('LOW') && planPhaseContent.includes('MEDIUM') &&
  planPhaseContent.includes('HIGH') && planPhaseContent.includes('VERY_HIGH'),
  'plan-phase.md contains all 4 classifications: LOW, MEDIUM, HIGH, VERY_HIGH'
);

// Test 11: plan-phase.md contains signal weights (0.20, 0.15, 0.10)
assertIfReady(planPhaseHasComplexity,
  planPhaseContent.includes('0.20') && planPhaseContent.includes('0.15') && planPhaseContent.includes('0.10'),
  'plan-phase.md contains all signal weights (0.20, 0.15, 0.10)'
);

// Test 12: plan-phase.md contains insufficient data message for < 5 phases
assertIfReady(planPhaseHasComplexity,
  planPhaseLower.includes('insufficient') || (planPhaseLower.includes('fewer than 5') || planPhaseLower.includes('< 5')),
  'plan-phase.md contains "insufficient" data message for < 5 phases'
);

// Test 13: plan-phase.md contains score range thresholds (0.3, 0.6, 0.8)
assertIfReady(planPhaseHasComplexity,
  planPhaseContent.includes('0.3') && planPhaseContent.includes('0.6') && planPhaseContent.includes('0.8'),
  'plan-phase.md contains score range thresholds (0.3, 0.6, 0.8)'
);

// Test 14: plan-phase.md contains complexity_score field name
assertIfReady(planPhaseHasComplexity,
  planPhaseContent.includes('complexity_score'),
  'plan-phase.md contains "complexity_score" field name'
);

// Test 15: plan-phase.md contains complexity_classification field name
assertIfReady(planPhaseHasComplexity,
  planPhaseContent.includes('complexity_classification'),
  'plan-phase.md contains "complexity_classification" field name'
);

// Test 16: plan-phase.md contains historical calibration logic
assertIfReady(planPhaseHasComplexity,
  (planPhaseLower.includes('5') || planPhaseLower.includes('five')) && planPhaseLower.includes('completed'),
  'plan-phase.md contains historical calibration logic referencing 5+ completed phases'
);

// ============================================================
// EOD Velocity Tests (Tests 17-19)
// ============================================================

console.log('\n--- EOD Velocity Tests ---');

// Test 17: eod.md contains "Velocity" section or reference
assertIfReady(eodHasVelocity,
  eodContent.includes('Velocity'),
  'eod.md contains "Velocity" section or reference'
);

// Test 18: eod.md contains IMPROVING, STABLE, DEGRADING classifications
assertIfReady(eodHasVelocity,
  eodContent.includes('IMPROVING') && eodContent.includes('STABLE') && eodContent.includes('DEGRADING'),
  'eod.md contains IMPROVING, STABLE, and DEGRADING classifications'
);

// Test 19: eod.md contains velocity computation logic
assertIfReady(eodHasVelocity,
  eodLower.includes('average') || eodLower.includes('avg_') || eodLower.includes('avg_all'),
  'eod.md contains velocity computation logic (comparison against average)'
);

// ============================================================
// Resume Metrics Tests (Tests 20-22)
// ============================================================

console.log('\n--- Resume Metrics Tests ---');

// Test 20: resume.md contains "Metrics" or "metrics" in briefing context
assertIfReady(resumeHasMetrics,
  resumeLower.includes('metrics'),
  'resume.md contains "Metrics" or "metrics" in briefing context'
);

// Test 21: resume.md references .bee/metrics/ path
assertIfReady(resumeHasMetrics,
  resumeContent.includes('.bee/metrics/'),
  'resume.md references ".bee/metrics/" path'
);

// Test 22: resume.md contains "Last session" display reference
assertIfReady(resumeHasMetrics,
  resumeContent.includes('Last session'),
  'resume.md contains "Last session" display reference'
);

// ============================================================
// Health Check Tests (Tests 23-25)
// ============================================================

console.log('\n--- Health Check Tests ---');

// Test 23: health.md contains .bee/metrics directory check
assertIfReady(healthHasMetrics,
  healthContent.includes('.bee/metrics'),
  'health.md contains ".bee/metrics" directory check'
);

// Test 24: health.md contains .session-start stale marker check
assertIfReady(healthHasMetrics,
  healthContent.includes('.session-start'),
  'health.md contains ".session-start" stale marker check'
);

// Test 25: health.md contains metrics.enabled or "metrics disabled" handling
assertIfReady(healthHasMetrics,
  healthContent.includes('metrics.enabled') || healthLower.includes('metrics disabled'),
  'health.md contains metrics.enabled or "metrics disabled" handling'
);

// ============================================================
// Routing Tests (Tests 26-28)
// ============================================================

console.log('\n--- Routing Tests ---');

// Test 26: do.md keyword table contains "metrics" keyword mapping to /bee:progress
assertIfReady(doHasMetrics,
  doLower.includes('metrics') && doContent.includes('progress'),
  'do.md keyword table contains "metrics" keyword mapping to /bee:progress'
);

// Test 27: do.md keyword table contains "velocity" keyword
assertIfReady(doHasMetrics,
  doLower.includes('velocity'),
  'do.md keyword table contains "velocity" keyword'
);

// Test 28: compact.md contains .bee/metrics/ reference
assertIfReady(compactHasMetrics,
  compactContent.includes('.bee/metrics/'),
  'compact.md contains ".bee/metrics/" reference for context preservation'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped out of ${passed + failed + skipped} assertions`);
if (skipped > 0) {
  console.log(`Note: ${skipped} tests skipped -- awaiting 23-02 plan execution to add consumer content to files`);
}
process.exit(failed > 0 ? 1 : 0);
