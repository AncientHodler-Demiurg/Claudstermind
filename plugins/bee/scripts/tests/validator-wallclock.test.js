#!/usr/bin/env node
// validator-wallclock.test.js — NFR-02 wallclock budget for the 24 SubagentStop
// Node validators.
//
// Acceptance contract (Phase 1 NFR-02):
//   1. Iterates the canonical VALIDATOR_ROSTER exported by validators-lib.js.
//      The roster is the single source of truth for the 24-validator set —
//      this test imports it; it does NOT duplicate the array inline.
//   2. Roster integrity check FIRST: the filtered listing of
//      plugins/bee/scripts/hooks/validators/*.js must exactly match the
//      imported VALIDATOR_ROSTER (catches silent missing files before any
//      timing loops run).
//   3. For each validator, builds a tailored PASS-skeleton transcript on disk
//      under a tmpdir, places the .bee/.autonomous-run-active marker so the
//      validator does NOT short-circuit at the auto-mode gate, then spawns
//      `node <validator>` N=10 times and records each wallclock delta with
//      Date.now().
//   4. Computes the per-validator p95 by sorting the samples ascending and
//      taking index ceil(0.95 * (N - 1)) (N=10 → index 9 → max sample).
//   5. Asserts p95 < THRESHOLD_MS per validator. THRESHOLD_MS relaxes from
//      200 to 300 on Windows per spec.md NFR-02 wording. This `win32` branch
//      is the ONE allowed platform-conditional in the validator codebase
//      (T1.13's static scan excludes this filename).
//   6. Prints a per-validator stats summary (mean / p95 / max) on EVERY run
//      so the operator sees the budget headroom; on failure the summary
//      doubles as the diagnostic payload.
//   7. cleanupTmpDirs() is called BEFORE process.exit (F-PAT-005).

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { VALIDATOR_ROSTER } = require('../hooks/validators/validators-lib.js');

const VALIDATORS_DIR = path.join(__dirname, '..', 'hooks', 'validators');

// THRESHOLD_MS — the ONE allowed `process.platform === 'win32'` branch in the
// validator codebase. Phase 1 spec.md NFR-02: Mac/Linux baseline 200ms;
// Windows 300ms (process spawn cost on win32 is materially higher).
const THRESHOLD_MS = process.platform === 'win32' ? 300 : 200;

// Per-validator sample size. N=10 keeps total wallclock under the 60s CI
// budget (24 × 10 × ~50ms ≈ 12s observed) while still giving a stable p95.
const N = 10;

const tmpDirs = [];
let passed = 0;
let failed = 0;

function track(condition, label) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.log(`  FAIL: ${label}`);
  }
}

function makeTmpRoot(markerPresent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-validator-wc-'));
  tmpDirs.push(dir);
  const beeDir = path.join(dir, '.bee');
  fs.mkdirSync(beeDir, { recursive: true });
  if (markerPresent) {
    // The auto-mode marker — without it, validators short-circuit and emit
    // {"ok":true} immediately, which would underreport wallclock cost.
    fs.writeFileSync(path.join(beeDir, '.autonomous-run-active'), '', 'utf8');
  }
  return dir;
}

function writeTranscript(tmpRoot, assistantContent) {
  const transcriptPath = path.join(tmpRoot, 'transcript.jsonl');
  // One assistant turn with string-shape content (the simpler readLastAssistantMessage
  // branch — block-array shape would add an extra filter pass; string covers
  // the same code path the validator's regex scans hit).
  const line = JSON.stringify({
    type: 'assistant',
    message: { content: assistantContent },
  });
  fs.writeFileSync(transcriptPath, line + '\n', 'utf8');
  return transcriptPath;
}

function cleanupTmpDirs() {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
      /* best effort */
    }
  }
}

function p95Of(samples) {
  const sorted = samples.slice().sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * (sorted.length - 1));
  return sorted[idx];
}

function meanOf(samples) {
  return Math.round(samples.reduce((s, v) => s + v, 0) / samples.length);
}

function maxOf(samples) {
  return samples.reduce((m, v) => (v > m ? v : m), 0);
}

// ---------------------------------------------------------------------------
// PASS_SKELETONS — minimal assistant-message strings that satisfy each
// validator's structural checks. The point is not to comprehensively test
// every PASS path (T1.6/T1.7 cover that) but to ensure each validator runs
// its FULL execution path during timing so we measure realistic wallclock —
// not a short-circuit at the first failing check. Most validators accept a
// no-findings sentinel + summary heading combo; the shapes below mirror what
// each validator's emitVerdict(true) branch actually requires.
// ---------------------------------------------------------------------------

const TDD_TASK_COMPLETE_MSG = [
  '## Test run',
  '',
  '```',
  'FAIL tests/example.test.js',
  '  expected true, got false',
  '```',
  '',
  '## After implementation',
  '',
  '```',
  'PASS tests/example.test.js',
  'Tests: 0 failed, 3 passed, 3 total',
  '```',
  '',
  'Task complete. 3 tests passing.',
].join('\n');

const PASS_SKELETONS = {
  // Audit family — sentinel + summary heading
  'security-auditor.js':
    'No security issues found.\n\n## Security Audit Summary\nClean.\n',
  'error-handling-auditor.js':
    'No error handling issues found.\n\n## Error Handling Audit Summary\nClean.\n',
  'database-auditor.js':
    'No database issues found.\n\n## Database Audit Summary\nClean.\n',
  'architecture-auditor.js':
    'No architecture issues found.\n\n## Architecture Audit Summary\nClean.\n',
  'api-auditor.js':
    'No API issues found.\n\n## Endpoint Inventory\n(empty)\n\n## API Audit Summary\nClean.\n',
  'frontend-auditor.js':
    'No frontend issues found.\n\n## Frontend Audit Summary\nClean.\n',
  'performance-auditor.js':
    'No performance issues found.\n\n## Performance Audit Summary\nClean.\n',
  'audit-bug-detector.js':
    'No cross-layer bugs found.\n\n## Bug Detection Summary\nClean.\n',
  'audit-report-generator.js': [
    'Wrote AUDIT-REPORT.md and audit-findings.json.',
    '',
    '## Executive Summary',
    'Clean.',
    '',
    '## Risk Assessment',
    'Low.',
    '',
    '## Recommendations',
    '',
    '### Immediate Actions',
    'None.',
    '',
    '### Short-term Actions',
    'None.',
    '',
    '### Technical Debt',
    'None.',
  ].join('\n'),
  'integration-checker.js': [
    '## Integration Check Complete',
    '',
    '## Integration Audit Summary',
    '',
    '### Wiring Summary',
    '- Connected: 12',
    '- Orphaned: 0',
    '- Missing: 0',
    '',
    'Overall health: HEALTHY',
    '',
    'No integration issues found.',
  ].join('\n'),
  'swarm-consolidator.js': [
    '## Swarm Review Consolidation',
    '',
    '### Summary',
    '- segments analyzed: 4',
    '- agents dispatched: 12',
    '- raw findings: 0',
    '- after dedup: 0',
    '- consensus escalations: 0',
    '',
    '### Dedup Summary',
    'No findings to deduplicate.',
  ].join('\n'),

  // Review / research-pipeline (10)
  'bug-detector.js': 'No bugs detected.\n',
  'pattern-reviewer.js': 'No project pattern deviations found.\n',
  'plan-compliance-reviewer.js': [
    '## Plan Compliance Review: Phase 1',
    '',
    '### Coverage Matrix',
    '| Task | Status |',
    '|------|--------|',
    '| T1.1 | COVERED |',
  ].join('\n'),
  'stack-reviewer.js': 'No stack best practice violations found.\n',
  'fixer.js': [
    '## Fix Report',
    '',
    '- Finding ID: F-SEC-001',
    '- Status: Fixed',
    '- Files Changed: src/auth.ts',
    '- What Changed: Added input sanitization on the login endpoint.',
    '- Tests: 5 passed, 0 failed.',
  ].join('\n'),
  'researcher.js': 'Ecosystem research complete: 3 references found. [CITED] react-query docs.\n',
  'assumptions-analyzer.js': [
    '## Assumptions',
    '',
    '- A1: The auth service is stateless.',
    '  - Confidence: Confident',
    '  - File: `src/auth/service.ts`',
    '  - Impact: Low',
    '  - Risk: 2 (accept)',
    '  - Mitigation: Add stateless contract test in CI.',
    '',
    '## Risk Matrix',
    '| A | Risk | Action |',
    '|---|------|--------|',
    '| A1 | 2 | accept |',
  ].join('\n'),
  'dependency-auditor.js': [
    '## Dependency Health Report',
    '',
    '### Phase-Relevant Dependencies',
    '| Pkg | Version | Status |',
    '|-----|---------|--------|',
    '| react | 18.3.0 | current |',
    '',
    '### Summary',
    '- Dependencies scanned: 42',
    '- Verdict: HEALTHY',
  ].join('\n'),
  'testing-auditor.js': [
    '## Testing Audit Summary',
    '',
    'No testing issues found.',
    '',
    '## Test Coverage Map',
    '| File | Cases |',
    '|------|-------|',
    '| src/auth.ts | 5 |',
    '',
    '### Summary',
    '- test files found: 12',
    '- test cases found: 84',
    '- critical paths covered: 6/6',
  ].join('\n'),
  'audit-finding-validator.js': [
    '### Validation: F-SEC-001',
    '',
    '- Verdict: CONFIRMED',
    '- Confidence: HIGH',
    '- File verified: src/auth.ts:42',
    '- Evidence verified: Sanitization missing on login endpoint.',
    '- Reason: matches the F-SEC-001 description exactly.',
    '',
    '## Validation Summary',
    '',
    'false positive rate: 0%',
  ].join('\n'),

  'finding-validator.js': [
    '## Classification',
    '',
    'Finding: F-001',
    'Verdict: REAL BUG',
    'Confidence: HIGH',
    'Source Agent: bug-detector',
    'Reason: traced the null deref to src/auth.ts:42 and reproduced it.',
  ].join('\n'),

  // Semantic (2) — TDD red→green + Task complete + N tests passing
  'implementer.js': TDD_TASK_COMPLETE_MSG,
  'quick-implementer.js': TDD_TASK_COMPLETE_MSG,

  // Metadata (1) — ROOT CAUSE FOUND mode (lighter than the tool_use shape)
  'debug-investigator.js': [
    '## ROOT CAUSE FOUND',
    '',
    '### Evidence',
    'Confidence: HIGH',
    '',
    'The failure originates in `src/auth/service.ts:42` where the input is not sanitized.',
  ].join('\n'),
};

// ===========================================================================
// Test 1: Roster integrity — directory listing matches VALIDATOR_ROSTER
// ===========================================================================
console.log('Test 1: Roster integrity (single source of truth)');
// validators-lib.js (Phase 1), batch-lib.js (Phase 2), and dispatch.js
// (perf/validator-dispatcher) live alongside per-agent validators but are
// sibling helper/routing modules, not roster entries.
const dirContents = fs.readdirSync(VALIDATORS_DIR)
  .filter((f) => f.endsWith('.js') && f !== 'validators-lib.js' && f !== 'batch-lib.js' && f !== 'dispatch.js')
  .sort();
const expectedSorted = [...VALIDATOR_ROSTER].sort();
track(
  JSON.stringify(dirContents) === JSON.stringify(expectedSorted),
  `validators directory contents match VALIDATOR_ROSTER (${VALIDATOR_ROSTER.length} entries)`
);

if (failed > 0) {
  console.log('\nRoster drift detected. Directory:');
  console.log('  ' + dirContents.join('\n  '));
  console.log('Expected:');
  console.log('  ' + expectedSorted.join('\n  '));
  cleanupTmpDirs();
  process.exit(1);
}

// Every validator filename in the roster must have a PASS skeleton, otherwise
// the timing measurement would only exercise the early-fail path (read stdin,
// short-circuit at the first missing structural marker). That underreports
// the wallclock budget headroom.
console.log('\nTest 2: PASS_SKELETONS covers every validator in the roster');
for (const validator of VALIDATOR_ROSTER) {
  track(
    typeof PASS_SKELETONS[validator] === 'string' && PASS_SKELETONS[validator].length > 0,
    `PASS skeleton defined for ${validator}`
  );
}

if (failed > 0) {
  cleanupTmpDirs();
  process.exit(1);
}

// ===========================================================================
// Test 3: Per-validator wallclock — p95 < THRESHOLD_MS over N spawns
// ===========================================================================
console.log(`\nTest 3: Per-validator wallclock p95 < ${THRESHOLD_MS}ms (N=${N}, platform=${process.platform})\n`);

const summary = [];

for (const validator of VALIDATOR_ROSTER) {
  const validatorPath = path.join(VALIDATORS_DIR, validator);
  const skeleton = PASS_SKELETONS[validator];

  // One tmpdir per validator with marker present so the full code path runs.
  const tmpRoot = makeTmpRoot(true);
  const transcriptPath = writeTranscript(tmpRoot, skeleton);
  const payload = JSON.stringify({
    session_id: 'wallclock-test',
    transcript_path: transcriptPath,
    cwd: tmpRoot,
    hook_event_name: 'SubagentStop',
  });

  const durations = [];
  for (let i = 0; i < N; i++) {
    const start = Date.now();
    const result = spawnSync('node', [validatorPath], {
      input: payload,
      encoding: 'utf8',
      timeout: 5000,
    });
    durations.push(Date.now() - start);
    // Bail loud if the validator never returned — the entire test depends on
    // bounded spawns. A `status === null` means timeout or signal.
    if (result.status === null) {
      console.log(`  ABORT: ${validator} spawn returned null status (timeout/signal) on iteration ${i}`);
      cleanupTmpDirs();
      process.exit(1);
    }
  }

  const mean = meanOf(durations);
  const p95 = p95Of(durations);
  const max = maxOf(durations);
  summary.push({ validator, mean, p95, max, durations });

  track(
    p95 < THRESHOLD_MS,
    `${validator}: mean=${mean}ms p95=${p95}ms max=${max}ms (budget ${THRESHOLD_MS}ms)`
  );
}

// ===========================================================================
// Summary block — printed regardless of pass/fail so the operator sees
// headroom and the slowest validators. On failure this is the diagnostic.
// ===========================================================================
console.log('\nWallclock summary (sorted by p95 desc):');
console.log('  validator                          mean   p95    max');
console.log('  ' + '-'.repeat(60));
const sortedSummary = summary.slice().sort((a, b) => b.p95 - a.p95);
for (const row of sortedSummary) {
  const name = row.validator.padEnd(34, ' ');
  const mean = String(row.mean + 'ms').padStart(6, ' ');
  const p95 = String(row.p95 + 'ms').padStart(6, ' ');
  const max = String(row.max + 'ms').padStart(6, ' ');
  console.log(`  ${name} ${mean} ${p95} ${max}`);
}

const slowest = sortedSummary[0];
if (slowest) {
  console.log(
    `\nSlowest p95: ${slowest.validator} at ${slowest.p95}ms (budget ${THRESHOLD_MS}ms, headroom ${THRESHOLD_MS - slowest.p95}ms)`
  );
}

cleanupTmpDirs();
const total = passed + failed;
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${total} assertions`);
process.exit(failed > 0 ? 1 : 0);
