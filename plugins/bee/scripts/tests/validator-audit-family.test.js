#!/usr/bin/env node
// Paired-contract test for the 11 audit-family SubagentStop validators
// authored in T1.2.
//
// Each validator under plugins/bee/scripts/hooks/validators/<agent>.js is
// exercised end-to-end via spawnSync with a synthesized JSONL transcript
// and a SubagentStop-shaped stdin payload. Each assertion encodes WHY the
// behavior matters (per skills/thinking-principles/SKILL.md Rule 9):
//
//   - happy path:    finding + summary + agent-specific extras → {"ok":true}
//   - sentinel path: 'No <domain> issues found.' + summary    → {"ok":true}
//   - negative:      first-failure-wins reason matches the missing field
//   - hard contract: every invocation exits 0 AND emits parseable JSON
//
// Mirrors the assert + counter idiom from command-primitives.test.js:31-58.
// Explicit cleanupTmpDirs() before process.exit (F-PAT-005).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const VALIDATORS_DIR = path.join(__dirname, '..', 'hooks', 'validators');

let passed = 0;
let failed = 0;
const tmpDirs = [];

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${testName}`);
  } else {
    failed++;
    console.log(`  FAIL: ${testName}`);
  }
}

function makeTmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-validator-audit-'));
  tmpDirs.push(dir);
  return dir;
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

// Write a one-line JSONL transcript containing a single assistant turn whose
// content is the supplied string. Returns the transcript path.
function writeTranscript(root, content) {
  const file = path.join(root, 'transcript.jsonl');
  const entry = JSON.stringify({ type: 'assistant', message: { content } });
  fs.writeFileSync(file, entry + '\n');
  return file;
}

// Set up a cwd that has the auto-mode marker so validators do NOT skip.
function makeAutoModeRoot() {
  const root = makeTmpRoot();
  fs.mkdirSync(path.join(root, '.bee'), { recursive: true });
  fs.writeFileSync(path.join(root, '.bee', '.autonomous-run-active'), '');
  return root;
}

// Invoke a validator script with the canonical SubagentStop payload shape.
// Returns { stdout, stderr, status }.
function runValidator(validatorFilename, content, opts) {
  opts = opts || {};
  const root = opts.skipMarker ? makeTmpRoot() : makeAutoModeRoot();
  const transcript = content === null
    ? '/nonexistent/path.jsonl'
    : writeTranscript(root, content);
  const payload = {
    session_id: 'test-session',
    cwd: root,
    transcript_path: opts.omitTranscript ? undefined : transcript,
    hook_event_name: 'SubagentStop',
  };
  if (opts.omitTranscript) delete payload.transcript_path;

  const validatorPath = path.join(VALIDATORS_DIR, validatorFilename);
  const result = spawnSync('node', [validatorPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  return result;
}

// Parse the validator's stdout into a verdict object. Returns null on
// unparseable output so the caller can flag "no JSON emitted" failures.
function parseVerdict(stdout) {
  if (typeof stdout !== 'string' || stdout.length === 0) return null;
  try {
    return JSON.parse(stdout);
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hard contract: every validator exits 0 and emits parseable JSON on every
// invocation, even when the payload is malformed. This is the CI-001 fix that
// Phase 2 runPerAgentValidator relies on (never see empty stdout).
// ---------------------------------------------------------------------------

console.log('=== audit-family validators: hard contract ===');

const ROSTER = [
  'security-auditor.js',
  'error-handling-auditor.js',
  'database-auditor.js',
  'architecture-auditor.js',
  'api-auditor.js',
  'frontend-auditor.js',
  'performance-auditor.js',
  'audit-bug-detector.js',
  'audit-report-generator.js',
  'integration-checker.js',
  'swarm-consolidator.js',
];

for (const validator of ROSTER) {
  // omitTranscript triggers the "invalid SubagentStop payload" branch which
  // exercises the failure path BEFORE readLastAssistantMessage. If the
  // validator silently exits without emitting a verdict, the aggregator
  // would see empty stdout and the Phase 2 contract breaks.
  const result = runValidator(validator, 'irrelevant', { omitTranscript: true });
  assert(result.status === 0, `${validator}: exits 0 on missing transcript_path`);
  const verdict = parseVerdict(result.stdout);
  assert(
    verdict !== null && verdict.ok === false,
    `${validator}: emits {ok:false} verdict on missing transcript_path`
  );
}

// Auto-mode-inactive short-circuit: every validator returns {ok:true} when
// the marker file is absent (REQ-10 base inclusion semantics). This must
// hold even when transcript_path is missing, because the marker check runs
// before payload validation.
console.log('=== audit-family validators: marker-absent pass-thru ===');
for (const validator of ROSTER) {
  const result = runValidator(validator, 'irrelevant', { skipMarker: true });
  const verdict = parseVerdict(result.stdout);
  assert(
    verdict !== null && verdict.ok === true,
    `${validator}: short-circuits to {ok:true} when auto-mode marker absent`
  );
}

// ---------------------------------------------------------------------------
// Per-validator structural contracts. Each block has:
//   - one happy path (findings + summary + agent-specific extras)
//   - one sentinel path (no-findings sentinel + summary)
//   - one negative path that names the FIRST failure the validator reports
// The negative-path expected-reason fragment is the canonical first-failure-
// wins string from the validator itself; if the validator changes its
// emit-order or drops a check, the assertion fails.
// ---------------------------------------------------------------------------

function check(validator, content, expected, label) {
  const result = runValidator(validator, content);
  const verdict = parseVerdict(result.stdout);
  if (expected.ok === true) {
    assert(
      verdict !== null && verdict.ok === true,
      `${validator}: ${label} → {ok:true}`
    );
  } else {
    assert(
      verdict !== null
        && verdict.ok === false
        && typeof verdict.reason === 'string'
        && verdict.reason.includes(expected.reasonContains),
      `${validator}: ${label} → reason contains "${expected.reasonContains}"`
    );
  }
}

console.log('=== security-auditor ===');
check(
  'security-auditor.js',
  '### F-SEC-001 SQLi here\n## Security Audit Summary\n5 files scanned',
  { ok: true },
  'happy path: F-SEC- finding + summary'
);
check(
  'security-auditor.js',
  'No security issues found.\n## Security Audit Summary',
  { ok: true },
  'sentinel path: no-issues + summary'
);
check(
  'security-auditor.js',
  '## Security Audit Summary',
  { ok: false, reasonContains: "expected '### F-SEC-' entries" },
  'negative: missing both findings and sentinel'
);
check(
  'security-auditor.js',
  '### F-SEC-001 detail',
  { ok: false, reasonContains: "## Security Audit Summary" },
  'negative: findings present but summary missing'
);

console.log('=== error-handling-auditor ===');
check(
  'error-handling-auditor.js',
  '### F-ERR-001 CRASH on null\n## Error Handling Audit Summary',
  { ok: true },
  'happy path: F-ERR- + CRASH token + summary'
);
check(
  'error-handling-auditor.js',
  'No error handling issues found.\n## Error Handling Audit Summary',
  { ok: true },
  'sentinel path: no-issues + summary'
);
check(
  'error-handling-auditor.js',
  '### F-ERR-001 details only\n## Error Handling Audit Summary',
  { ok: false, reasonContains: 'no failure-mode token' },
  'negative: findings present but no CRASH/SILENT/DATA-LOSS/DEGRADED token'
);

console.log('=== database-auditor ===');
check(
  'database-auditor.js',
  '### F-DB-001 missing index\n## Database Audit Summary',
  { ok: true },
  'happy path: F-DB- + summary'
);
check(
  'database-auditor.js',
  'No database issues found.\n## Database Audit Summary',
  { ok: true },
  'sentinel path: no-issues + summary'
);
check(
  'database-auditor.js',
  'random prose',
  { ok: false, reasonContains: "expected '### F-DB-' entries" },
  'negative: neither findings nor sentinel'
);

console.log('=== architecture-auditor ===');
check(
  'architecture-auditor.js',
  '### F-ARCH-001 god file\n## Architecture Audit Summary',
  { ok: true },
  'happy path: F-ARCH- + summary'
);
check(
  'architecture-auditor.js',
  'No architecture issues found.\n## Architecture Audit Summary',
  { ok: true },
  'sentinel path: no-issues + summary'
);
check(
  'architecture-auditor.js',
  '### F-ARCH-001 only',
  { ok: false, reasonContains: '## Architecture Audit Summary' },
  'negative: finding present but summary missing'
);

console.log('=== api-auditor ===');
check(
  'api-auditor.js',
  '### F-API-001 missing auth\n## Endpoint Inventory\n| GET | /x |\n## API Audit Summary',
  { ok: true },
  'happy path: F-API- + Endpoint Inventory + summary'
);
check(
  'api-auditor.js',
  'No API issues found.\n## Endpoint Inventory\n| GET | /x |\n## API Audit Summary',
  { ok: true },
  'sentinel path: no-issues + Endpoint Inventory + summary'
);
check(
  'api-auditor.js',
  '### F-API-001 only\n## API Audit Summary',
  { ok: false, reasonContains: "## Endpoint Inventory" },
  'negative: findings + summary but Endpoint Inventory missing'
);

console.log('=== frontend-auditor ===');
check(
  'frontend-auditor.js',
  '### F-FE-001 missing loading state\n## Frontend Audit Summary',
  { ok: true },
  'happy path: F-FE- + summary'
);
check(
  'frontend-auditor.js',
  'No frontend issues found.\n## Frontend Audit Summary',
  { ok: true },
  'sentinel path: no-issues + summary'
);

console.log('=== performance-auditor ===');
check(
  'performance-auditor.js',
  '### F-PERF-001 N+1 query\n## Performance Audit Summary',
  { ok: true },
  'happy path: F-PERF- + summary'
);
check(
  'performance-auditor.js',
  'No performance issues found.\n## Performance Audit Summary',
  { ok: true },
  'sentinel path: no-issues + summary'
);

console.log('=== audit-bug-detector ===');
check(
  'audit-bug-detector.js',
  '### F-BUG-001 cross-layer bug\nFlow: A → B\nTrace: file:1\n## Bug Detection Summary',
  { ok: true },
  'happy path: F-BUG- + Flow + Trace + summary'
);
check(
  'audit-bug-detector.js',
  'No cross-layer bugs found.\n## Bug Detection Summary',
  { ok: true },
  'sentinel path: no-issues + summary'
);
check(
  'audit-bug-detector.js',
  '### F-BUG-001 only\n## Bug Detection Summary',
  { ok: false, reasonContains: "no 'Flow' section" },
  'negative: finding present but Flow missing'
);
check(
  'audit-bug-detector.js',
  '### F-BUG-001 only\nFlow: A → B\n## Bug Detection Summary',
  { ok: false, reasonContains: "no 'Trace' section" },
  'negative: Flow present but Trace missing'
);

console.log('=== audit-report-generator ===');
check(
  'audit-report-generator.js',
  'Wrote AUDIT-REPORT.md and audit-findings.json.\n'
    + 'Executive Summary\nRisk Assessment\nRecommendations\n'
    + 'Immediate Actions\nShort-term Actions\nTechnical Debt',
  { ok: true },
  'happy path: both artifacts + all required report sections'
);
check(
  'audit-report-generator.js',
  'AUDIT-REPORT.md\naudit-findings.json\nExecutive Summary\nRisk Assessment\nRecommendations\nImmediate Actions\nShort-term Actions',
  { ok: false, reasonContains: "'Technical Debt'" },
  'negative: missing Technical Debt sub-section'
);
check(
  'audit-report-generator.js',
  'audit-findings.json\nExecutive Summary\nRisk Assessment\nRecommendations\nImmediate Actions\nShort-term Actions\nTechnical Debt',
  { ok: false, reasonContains: "'AUDIT-REPORT.md'" },
  'negative: missing AUDIT-REPORT.md reference (first-failure-wins ordering)'
);

console.log('=== integration-checker ===');
check(
  'integration-checker.js',
  '## Integration Check Complete\nIntegration Audit Summary\n'
    + 'Wiring Summary\nConnected: 5\nOrphaned: 1\nMissing: 0\n'
    + 'HEALTHY\nNo integration issues found.',
  { ok: true },
  'happy path: completion heading + summary + wiring counts + HEALTHY + sentinel'
);
check(
  'integration-checker.js',
  '## Integration Check Complete\nIntegration Audit Summary\n'
    + 'Wiring Summary\nConnected: 5\nOrphaned: 1\nMissing: 0\n'
    + 'BROKEN\n### F-INT-001',
  { ok: true },
  'happy path: BROKEN rating + F-INT- finding (alternate rating)'
);
check(
  'integration-checker.js',
  '## Integration Check Complete\nIntegration Audit Summary\n'
    + 'Wiring Summary\nConnected: 5\nOrphaned: 1\nMissing: 0\n'
    + 'No integration issues found.',
  { ok: false, reasonContains: 'health rating' },
  'negative: missing any of the four rating enum values'
);

console.log('=== swarm-consolidator ===');
check(
  'swarm-consolidator.js',
  '## Swarm Review Consolidation\n### Summary\n'
    + '- segments analyzed: 0\n- agents dispatched: 0\n'
    + '- raw findings: 0\n- after dedup: 0\n- consensus escalations: 0\n'
    + '### Dedup Summary\n0 merges',
  { ok: true },
  'zero-findings shape: full Summary tokens + Dedup Summary, no Findings heading'
);
check(
  'swarm-consolidator.js',
  '## Swarm Review Consolidation\n### Summary\n'
    + '- segments analyzed: 3\n- agents dispatched: 6\n'
    + '- raw findings: 12\n- after dedup: 8\n- consensus escalations: 2\n'
    + '### Findings (severity-ordered)\nSF-001\n'
    + 'Consensus: 3/6\nSource Agents: security-auditor, frontend-auditor\n'
    + '### Dedup Summary\n4 merges',
  { ok: true },
  'findings shape: SF-NNN + Consensus + Source Agents + Dedup Summary'
);
check(
  'swarm-consolidator.js',
  '## Swarm Review Consolidation\n### Summary\n'
    + '- agents dispatched: 6\n- raw findings: 12\n- after dedup: 8\n'
    + '- consensus escalations: 2',
  { ok: false, reasonContains: "'segments analyzed'" },
  'negative: missing first Summary token (first-failure-wins ordering)'
);
check(
  'swarm-consolidator.js',
  '## Swarm Review Consolidation\n### Summary\n'
    + '- segments analyzed: 3\n- agents dispatched: 6\n'
    + '- raw findings: 12\n- after dedup: 8\n- consensus escalations: 2\n'
    + '### Findings (severity-ordered)\nSF-001\nSource Agents: x',
  { ok: false, reasonContains: "'Consensus'" },
  "negative: findings present but Consensus field missing"
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`Tests passed: ${passed}`);
console.log(`Tests failed: ${failed}`);
console.log(`Total tests:  ${passed + failed}`);

cleanupTmpDirs();
process.exit(failed > 0 ? 1 : 0);
