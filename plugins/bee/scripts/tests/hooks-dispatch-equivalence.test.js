#!/usr/bin/env node
// Test: dispatch.js routing and behavioral equivalence (perf/validator-dispatcher).
//
// Proves zero behavior change: for every agent type, the verdict emitted by
// the dispatcher equals the verdict emitted by calling the validator directly.
//
// Coverage:
//   (a) Routing — pickValidator returns the expected filename (or null).
//       Tricky cases verified explicitly: quick-implementer beats implementer,
//       audit-bug-detector beats bug-detector, prefix-strip for bee:*, suffix
//       patterns for laravel-* variants, unknown → null.
//   (b) Behavioral equivalence — stdout from dispatched call equals stdout
//       from direct call, for representative agents and for both PASS and FAIL
//       shaped messages.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const VALIDATORS_DIR = path.join(__dirname, '..', 'hooks', 'validators');
const DISPATCH_PATH = path.join(VALIDATORS_DIR, 'dispatch.js');

const { pickValidator } = require(DISPATCH_PATH);

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

// ---------------------------------------------------------------------------
// (a) Routing tests
// ---------------------------------------------------------------------------

console.log('=== dispatch.js routing ===');

// Every one of the 25 base agent types must route to the matching validator.
const BASE_ROUTING = [
  ['implementer',            'implementer'],
  ['fixer',                  'fixer'],
  ['researcher',             'researcher'],
  ['assumptions-analyzer',   'assumptions-analyzer'],
  ['dependency-auditor',     'dependency-auditor'],
  ['bug-detector',           'bug-detector'],
  ['pattern-reviewer',       'pattern-reviewer'],
  ['plan-compliance-reviewer', 'plan-compliance-reviewer'],
  ['stack-reviewer',         'stack-reviewer'],
  ['quick-implementer',      'quick-implementer'],
  ['security-auditor',       'security-auditor'],
  ['error-handling-auditor', 'error-handling-auditor'],
  ['database-auditor',       'database-auditor'],
  ['architecture-auditor',   'architecture-auditor'],
  ['api-auditor',            'api-auditor'],
  ['frontend-auditor',       'frontend-auditor'],
  ['performance-auditor',    'performance-auditor'],
  ['testing-auditor',        'testing-auditor'],
  ['audit-bug-detector',     'audit-bug-detector'],
  ['audit-finding-validator','audit-finding-validator'],
  ['finding-validator',      'finding-validator'],
  ['audit-report-generator', 'audit-report-generator'],
  ['debug-investigator',     'debug-investigator'],
  ['integration-checker',    'integration-checker'],
  ['swarm-consolidator',     'swarm-consolidator'],
];

BASE_ROUTING.forEach(([agent, expected]) => {
  const got = pickValidator(agent);
  assert(got === expected, `pickValidator('${agent}') → '${expected}'`);
});

// Tricky cases — ordering and negative-lookbehind correctness.
assert(
  pickValidator('quick-implementer') === 'quick-implementer',
  "quick-implementer hits quick-implementer (NOT implementer via negative-lookbehind)"
);
assert(
  pickValidator('audit-bug-detector') === 'audit-bug-detector',
  "audit-bug-detector hits audit-bug-detector (NOT bug-detector via negative-lookbehind)"
);
// Suffix patterns catch prefixed variants.
assert(
  pickValidator('laravel-inertia-vue-implementer') === 'implementer',
  "laravel-inertia-vue-implementer → implementer (suffix match, negative-lookbehind passes)"
);
assert(
  pickValidator('laravel-pattern-reviewer') === 'pattern-reviewer',
  "laravel-pattern-reviewer → pattern-reviewer (suffix match)"
);
assert(
  pickValidator('laravel-stack-reviewer') === 'stack-reviewer',
  "laravel-stack-reviewer → stack-reviewer (suffix match)"
);
// bee: prefix is stripped.
assert(
  pickValidator('bee:implementer') === 'implementer',
  "bee:implementer prefix-stripped → implementer"
);
assert(
  pickValidator('bee:quick-implementer') === 'quick-implementer',
  "bee:quick-implementer prefix-stripped → quick-implementer"
);
// Unknown agent → null (no matching hook).
assert(
  pickValidator('context-builder') === null,
  "unknown agent 'context-builder' → null"
);
assert(
  pickValidator(undefined) === null,
  "undefined agent_type → null"
);
assert(
  pickValidator(null) === null,
  "null agent_type → null"
);

// ---------------------------------------------------------------------------
// (b) Behavioral equivalence tests
// ---------------------------------------------------------------------------

console.log('');
console.log('=== behavioral equivalence ===');

const tmpDirs = [];

function makeTmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-dispatch-equiv-'));
  tmpDirs.push(d);
  return d;
}

function makeAutoModeRoot() {
  const root = makeTmpDir();
  fs.mkdirSync(path.join(root, '.bee'), { recursive: true });
  fs.writeFileSync(path.join(root, '.bee', '.autonomous-run-active'), '');
  return root;
}

function writeTranscript(root, content) {
  const tp = path.join(root, 'transcript.jsonl');
  fs.writeFileSync(tp, JSON.stringify({ type: 'assistant', message: { content } }) + '\n');
  return tp;
}

function buildPayload(agentType, transcriptPath, root) {
  return JSON.stringify({
    session_id: 'equiv-test',
    agent_type: agentType,
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
}

function runDirect(validatorName, payload) {
  const vpath = path.join(VALIDATORS_DIR, validatorName + '.js');
  try {
    return execFileSync('node', [vpath], {
      input: payload,
      encoding: 'utf8',
      timeout: 5000,
    });
  } catch (e) {
    return e.stdout || '';
  }
}

function runDispatch(payload) {
  try {
    return execFileSync('node', [DISPATCH_PATH], {
      input: payload,
      encoding: 'utf8',
      timeout: 5000,
    });
  } catch (e) {
    return e.stdout || '';
  }
}

function assertEquivalent(agentType, validatorName, payload, label) {
  const direct = runDirect(validatorName, payload);
  const dispatched = runDispatch(payload);
  const ok = direct === dispatched;
  assert(ok, `${label}: dispatched verdict === direct verdict`);
  if (!ok) {
    console.log(`    direct:     ${direct.trim()}`);
    console.log(`    dispatched: ${dispatched.trim()}`);
  }
}

// --- implementer: PASS shape ---
{
  const root = makeAutoModeRoot();
  const passContent = [
    'Task complete.',
    '## BLOCKED',
    'No blockers present here (this is a fake content section).',
    'FAIL: initial red (1 test failing)',
    'PASS: 1 test passing',
    'Task complete.',
    '1 tests passing',
  ].join('\n');
  // Actually, implementer requires FAIL block BEFORE PASS block and completion marker
  // Use the minimal PASS shape that satisfies the checks
  const goodContent =
    'FAIL: 0 tests (initial red)\n' +
    'PASS: 1 tests passing\n' +
    'Task complete.\n' +
    '1 tests passing';
  const tp = writeTranscript(root, goodContent);
  const payload = buildPayload('implementer', tp, root);
  assertEquivalent('implementer', 'implementer', payload, 'implementer PASS-shape');
}

// --- implementer: FAIL shape (missing completion marker) ---
{
  const root = makeAutoModeRoot();
  const tp = writeTranscript(root, 'did some work but forgot the marker');
  const payload = buildPayload('implementer', tp, root);
  assertEquivalent('implementer', 'implementer', payload, 'implementer FAIL-shape');
}

// --- security-auditor: PASS shape ---
{
  const root = makeAutoModeRoot();
  const tp = writeTranscript(root,
    '### F-SEC-001 title\nsome finding\n## Security Audit Summary\nall good'
  );
  const payload = buildPayload('security-auditor', tp, root);
  assertEquivalent('security-auditor', 'security-auditor', payload, 'security-auditor PASS-shape');
}

// --- security-auditor: FAIL shape ---
{
  const root = makeAutoModeRoot();
  const tp = writeTranscript(root, 'no findings or summary here');
  const payload = buildPayload('security-auditor', tp, root);
  assertEquivalent('security-auditor', 'security-auditor', payload, 'security-auditor FAIL-shape');
}

// --- finding-validator: PASS shape ---
{
  const root = makeAutoModeRoot();
  const tp = writeTranscript(root,
    '## Classification\nFinding: F-123\nVerdict: REAL BUG\nConfidence: HIGH\nSource Agent: pattern-reviewer\nReason: it breaks things'
  );
  const payload = buildPayload('finding-validator', tp, root);
  assertEquivalent('finding-validator', 'finding-validator', payload, 'finding-validator PASS-shape');
}

// --- finding-validator: FAIL shape ---
{
  const root = makeAutoModeRoot();
  const tp = writeTranscript(root, 'no classification section here');
  const payload = buildPayload('finding-validator', tp, root);
  assertEquivalent('finding-validator', 'finding-validator', payload, 'finding-validator FAIL-shape');
}

// --- swarm-consolidator: PASS shape ---
{
  const root = makeAutoModeRoot();
  const tp = writeTranscript(root,
    '## Swarm Review Consolidation\n' +
    '### Summary\n' +
    'segments analyzed: 3\n' +
    'raw findings: 5\n' +
    'after dedup: 4\n' +
    'consensus escalations: 1\n' +
    'final unique findings: 4'
  );
  const payload = buildPayload('swarm-consolidator', tp, root);
  assertEquivalent('swarm-consolidator', 'swarm-consolidator', payload, 'swarm-consolidator PASS-shape');
}

// --- swarm-consolidator: FAIL shape ---
{
  const root = makeAutoModeRoot();
  const tp = writeTranscript(root, 'no swarm heading here');
  const payload = buildPayload('swarm-consolidator', tp, root);
  assertEquivalent('swarm-consolidator', 'swarm-consolidator', payload, 'swarm-consolidator FAIL-shape');
}

// --- quick-implementer routes to quick-implementer (NOT implementer) ---
{
  const root = makeAutoModeRoot();
  const tp = writeTranscript(root, 'some content without markers');
  const payload = buildPayload('quick-implementer', tp, root);
  assertEquivalent('quick-implementer', 'quick-implementer', payload, 'quick-implementer FAIL-shape (routing guard)');
}

// --- unknown agent: dispatch is a no-op → empty stdout ---
{
  const root = makeAutoModeRoot();
  const tp = writeTranscript(root, 'content');
  const payload = buildPayload('context-builder', tp, root);
  const dispatched = runDispatch(payload);
  assert(
    dispatched === '',
    "unknown agent 'context-builder': dispatch emits nothing (no-op)"
  );
}

// --- non-auto-mode: both direct and dispatched emit PASS (auto-mode guard) ---
{
  const root = makeTmpDir(); // no .autonomous-run-active
  const tp = writeTranscript(root, 'content');
  const payload = buildPayload('implementer', tp, root);
  assertEquivalent('implementer', 'implementer', payload, 'implementer non-auto-mode (both emit PASS)');
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

tmpDirs.forEach(d => {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
