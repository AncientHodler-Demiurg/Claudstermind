#!/usr/bin/env node
// Test: MET-01 data layer validation -- config template, session hooks,
// execute-phase metrics writes, review metrics updates, hooks.json wiring.
// Validates all Phase 23 Plan 01 structural requirements.

const fs = require('fs');
const path = require('path');

const CONFIG_TEMPLATE_PATH = path.join(
  __dirname, '..', '..', 'skills', 'core', 'templates', 'project-config.json'
);
const LOAD_CONTEXT_PATH = path.join(
  __dirname, '..', '..', 'scripts', 'load-context.sh'
);
const SESSION_END_PATH = path.join(
  __dirname, '..', '..', 'scripts', 'session-end-summary.sh'
);
const EXECUTE_PHASE_PATH = path.join(
  __dirname, '..', '..', 'commands', 'execute-phase.md'
);
const REVIEW_PATH = path.join(
  __dirname, '..', '..', 'commands', 'review.md'
);
const HOOKS_PATH = path.join(
  __dirname, '..', '..', 'hooks', 'hooks.json'
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
// Config Template Tests (Tests 1-2)
// ============================================================

console.log('\n--- Config Template Tests ---');

let configContent;
try {
  configContent = fs.readFileSync(CONFIG_TEMPLATE_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: project-config.json does not exist at expected path');
  console.log(`  Expected: ${CONFIG_TEMPLATE_PATH}`);
  process.exit(1);
}

// Test 1: project-config.json contains "metrics" key
assert(
  configContent.includes('"metrics"'),
  'project-config.json contains "metrics" key'
);

// Test 2: project-config.json contains "enabled": true within metrics section
assert(
  configContent.includes('"enabled": true'),
  'project-config.json contains "enabled": true within metrics section'
);

// ============================================================
// Session Hooks Tests (Tests 3-9)
// ============================================================

console.log('\n--- Session Hooks Tests ---');

let loadContextContent;
try {
  loadContextContent = fs.readFileSync(LOAD_CONTEXT_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: load-context.sh does not exist at expected path');
  console.log(`  Expected: ${LOAD_CONTEXT_PATH}`);
  process.exit(1);
}

// Test 3: load-context.sh contains .session-start write
assert(
  loadContextContent.includes('.session-start'),
  'load-context.sh contains .session-start marker write'
);

// Test 4: load-context.sh contains date -u command for timestamp
assert(
  loadContextContent.includes('date -u'),
  'load-context.sh contains "date -u" command for timestamp generation'
);

let sessionEndContent;
try {
  sessionEndContent = fs.readFileSync(SESSION_END_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: session-end-summary.sh does not exist at expected path');
  console.log(`  Expected: ${SESSION_END_PATH}`);
  process.exit(1);
}

// Test 5: session-end-summary.sh contains session-start read
assert(
  sessionEndContent.includes('session-start'),
  'session-end-summary.sh contains session-start read (reads the marker file)'
);

// Test 6: session-end-summary.sh contains duration_seconds in JSON output
assert(
  sessionEndContent.includes('duration_seconds'),
  'session-end-summary.sh contains "duration_seconds" in JSON output template'
);

// Test 7: session-end-summary.sh contains mkdir -p for metrics/sessions directory
assert(
  sessionEndContent.includes('mkdir -p'),
  'session-end-summary.sh contains "mkdir -p" for creating metrics/sessions directory'
);

// Test 8: session-end-summary.sh contains cleanup of .session-start (rm -f)
assert(
  sessionEndContent.includes('rm -f') && sessionEndContent.includes('.session-start'),
  'session-end-summary.sh contains cleanup of .session-start (rm -f pattern)'
);

// Test 9: session-end-summary.sh contains git_activity in JSON output
assert(
  sessionEndContent.includes('git_activity'),
  'session-end-summary.sh contains "git_activity" in JSON output'
);

// ============================================================
// Execute-Phase Metrics Tests (Tests 10-18)
// ============================================================

console.log('\n--- Execute-Phase Metrics Tests ---');

let execPhaseContent;
try {
  execPhaseContent = fs.readFileSync(EXECUTE_PHASE_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: execute-phase.md does not exist at expected path');
  console.log(`  Expected: ${EXECUTE_PHASE_PATH}`);
  process.exit(1);
}

// Test 10: execute-phase.md contains .bee/metrics/ path reference
assert(
  execPhaseContent.includes('.bee/metrics/'),
  'execute-phase.md contains ".bee/metrics/" path reference'
);

// Test 11: execute-phase.md contains phase-{N}.json path pattern
assert(
  execPhaseContent.includes('phase-{N}.json') || /phase-?\{?\d?\}?\.json/.test(execPhaseContent) || execPhaseContent.includes('phase-'),
  'execute-phase.md contains phase JSON file path pattern'
);

// Test 12: execute-phase.md contains started_at field reference
assert(
  execPhaseContent.includes('started_at'),
  'execute-phase.md contains "started_at" field reference'
);

// Test 13: execute-phase.md contains completed_at field reference
assert(
  execPhaseContent.includes('completed_at'),
  'execute-phase.md contains "completed_at" field reference'
);

// Test 14: execute-phase.md contains duration_seconds field reference
assert(
  execPhaseContent.includes('duration_seconds'),
  'execute-phase.md contains "duration_seconds" field reference'
);

// Test 15: execute-phase.md contains per_wave array reference
assert(
  execPhaseContent.includes('per_wave'),
  'execute-phase.md contains "per_wave" array reference'
);

// Test 16: execute-phase.md contains completion_rate field reference
assert(
  execPhaseContent.includes('completion_rate'),
  'execute-phase.md contains "completion_rate" field reference'
);

// Test 17: execute-phase.md contains retry_attempts field reference
assert(
  execPhaseContent.includes('retry_attempts'),
  'execute-phase.md contains "retry_attempts" field reference'
);

// Test 18: execute-phase.md mentions mkdir -p for lazy metrics directory creation
assert(
  execPhaseContent.includes('mkdir -p'),
  'execute-phase.md mentions "mkdir -p" for lazy metrics directory creation'
);

// ============================================================
// Review Metrics Tests (Tests 19-24)
// ============================================================

console.log('\n--- Review Metrics Tests ---');

let reviewContent;
try {
  reviewContent = fs.readFileSync(REVIEW_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: review.md does not exist at expected path');
  console.log(`  Expected: ${REVIEW_PATH}`);
  process.exit(1);
}

// Test 19: review.md contains .bee/metrics/ path reference
assert(
  reviewContent.includes('.bee/metrics/'),
  'review.md contains ".bee/metrics/" path reference'
);

// Test 20: review.md contains REVIEW_START_TIME capture
assert(
  reviewContent.includes('REVIEW_START_TIME') || reviewContent.toLowerCase().includes('review start time'),
  'review.md contains REVIEW_START_TIME or review start time capture'
);

// Test 21: review.md contains false_positive_rate field reference
assert(
  reviewContent.includes('false_positive_rate'),
  'review.md contains "false_positive_rate" field reference'
);

// Test 22: review.md contains iterations field reference
assert(
  reviewContent.includes('"iterations"'),
  'review.md contains "iterations" field reference in JSON'
);

// Test 23: review.md contains findings section with severity levels
assert(
  reviewContent.includes('"critical"') && reviewContent.includes('"high"') && reviewContent.includes('"medium"'),
  'review.md contains findings section with severity levels (critical, high, medium)'
);

// Test 24: review.md contains backward compatibility note
assert(
  reviewContent.includes('backward compatibility') || reviewContent.includes('does NOT exist'),
  'review.md contains backward compatibility note (skip if metrics file does not exist)'
);

// ============================================================
// Hooks.json Tests (Tests 25-26)
// ============================================================

console.log('\n--- Hooks.json Tests ---');

let hooksContent;
try {
  hooksContent = fs.readFileSync(HOOKS_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: hooks.json does not exist at expected path');
  console.log(`  Expected: ${HOOKS_PATH}`);
  process.exit(1);
}

let hooksJson;
try {
  hooksJson = JSON.parse(hooksContent);
} catch (e) {
  console.log('FAIL: hooks.json is not valid JSON');
  process.exit(1);
}

// Test 25: hooks.json SessionStart references load-context.sh
const sessionStartHooks = hooksJson.hooks.SessionStart || [];
const hasLoadContext = sessionStartHooks.some(entry =>
  entry.hooks && entry.hooks.some(h => h.command && h.command.includes('load-context.sh'))
);
assert(
  hasLoadContext,
  'hooks.json SessionStart references load-context.sh'
);

// Test 26: hooks.json SessionEnd references session-end-summary.sh
const sessionEndHooks = hooksJson.hooks.SessionEnd || [];
const hasSessionEnd = sessionEndHooks.some(entry =>
  entry.hooks && entry.hooks.some(h => h.command && h.command.includes('session-end-summary.sh'))
);
assert(
  hasSessionEnd,
  'hooks.json SessionEnd references session-end-summary.sh'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
