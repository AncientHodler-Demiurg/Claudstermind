#!/usr/bin/env node
// Paired-contract test for the 11 review/research-pipeline SubagentStop
// validators (10 from T1.3 + finding-validator.js added in the F-BUG-001
// cross-flow contract fix):
//
//   bug-detector.js
//   pattern-reviewer.js
//   plan-compliance-reviewer.js          (2 modes: code-review / plan-review)
//   stack-reviewer.js
//   fixer.js
//   researcher.js                        (3 modes: phase / inline / ecosystem)
//   assumptions-analyzer.js
//   dependency-auditor.js
//   testing-auditor.js                   (3 modes: scan / generate / pre-plan)
//   audit-finding-validator.js           (audit `### Validation: F-` schema)
//   finding-validator.js                 (review `## Classification` schema)
//
// Each validator under plugins/bee/scripts/hooks/validators/<agent>.js is
// exercised end-to-end via spawnSync with a synthesized JSONL transcript
// and a SubagentStop-shaped stdin payload. Every assertion encodes WHY the
// behavior matters (per skills/thinking-principles/SKILL.md Rule 9):
//
//   - happy path:           required heading + tally + per-finding fields → {ok:true}
//   - sentinel/no-findings: validator must short-circuit to {ok:true}
//   - per-validator fail:   first-failure-wins reason matches the named contract
//   - mode-coverage:        each documented mode produces {ok:true} on its
//                           canonical shape; mode-detection failures are flagged
//   - marker-absent:        when .bee/.autonomous-run-active is missing, every
//                           validator short-circuits to {ok:true} (REQ-10 base
//                           inclusion semantics — validators run only during
//                           autonomous executions)
//   - transcript missing:   payload missing transcript_path produces
//                           {ok:false, reason:"invalid SubagentStop payload..."}
//                           and exits 0 (Phase 2 aggregator must never see
//                           empty stdout from in-band failure — CI-001)
//   - minimal-fixture pass: per-validator minimal synthetic review fixtures
//                           (iter 3 F-006) confirm the validator accepts the
//                           smallest legal shape, NOT a live .bee/reviews/ snapshot
//
// Scaffold mirrors plugins/bee/scripts/tests/validator-audit-family.test.js
// (T1.2). Uses the plain-Node assert + counter idiom from
// command-primitives.test.js:31-58. Inline fixtures only — no on-disk fixture
// directory (F-PAT-003). Explicit cleanupTmpDirs() before process.exit (F-PAT-005).

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-validator-review-'));
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
// opts:
//   skipMarker      - do NOT create the auto-mode marker (validator should
//                     short-circuit to {ok:true})
//   omitTranscript  - delete transcript_path from the payload (validator
//                     should emit {ok:false, reason: "invalid SubagentStop..."} )
//   unreadablePath  - point transcript_path at a path that does not exist
//                     (readLastAssistantMessage returns null → {ok:false})
function runValidator(validatorFilename, content, opts) {
  opts = opts || {};
  const root = opts.skipMarker ? makeTmpRoot() : makeAutoModeRoot();
  let transcript;
  if (opts.unreadablePath) {
    transcript = path.join(root, 'definitely-does-not-exist.jsonl');
  } else if (content === null) {
    transcript = path.join(root, 'transcript.jsonl');
  } else {
    transcript = writeTranscript(root, content);
  }
  const payload = {
    session_id: 'test-session',
    cwd: root,
    transcript_path: transcript,
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

function parseVerdict(stdout) {
  if (typeof stdout !== 'string' || stdout.length === 0) return null;
  try {
    return JSON.parse(stdout);
  } catch (_) {
    return null;
  }
}

// check() — one assertion against the expected verdict shape. expected.ok
// drives the assertion's failure mode:
//   - { ok: true }                  → asserts validator emitted {ok:true}
//   - { ok: false, reasonContains } → asserts validator emitted {ok:false}
//                                     with reason including the substring.
//                                     The substring is the first-failure-wins
//                                     contract from the validator itself; if
//                                     the validator changes emit-order or
//                                     drops the check, the assertion fails.
function check(validator, content, expected, label, opts) {
  const result = runValidator(validator, content, opts);
  const verdict = parseVerdict(result.stdout);
  assert(
    result.status === 0,
    `${validator}: ${label} → exits 0 (hard contract CI-001)`
  );
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

// ---------------------------------------------------------------------------
// Cross-cutting: marker-absent + transcript-missing contracts for all 10.
//
// The marker-absent short-circuit and the transcript-missing failure path
// are identical surfaces across every validator (they live in the shared
// preamble of each validator's main()). Asserting them in one loop catches
// any single validator that drifts off the shared preamble shape.
// ---------------------------------------------------------------------------

const REVIEW_ROSTER = [
  'bug-detector.js',
  'pattern-reviewer.js',
  'plan-compliance-reviewer.js',
  'stack-reviewer.js',
  'fixer.js',
  'researcher.js',
  'assumptions-analyzer.js',
  'dependency-auditor.js',
  'testing-auditor.js',
  'audit-finding-validator.js',
  'finding-validator.js',
];

console.log('=== review-pipeline validators: marker-absent pass-thru ===');
// REQ-10 base inclusion semantics: validators MUST short-circuit to {ok:true}
// when the .bee/.autonomous-run-active marker is missing. Without this, every
// non-autonomous agent run would be gated by validators that have nothing to
// validate (since the agent isn't operating under autonomous-execution rules).
for (const validator of REVIEW_ROSTER) {
  const result = runValidator(validator, 'irrelevant content', { skipMarker: true });
  const verdict = parseVerdict(result.stdout);
  assert(
    verdict !== null && verdict.ok === true,
    `${validator}: short-circuits to {ok:true} when auto-mode marker absent`
  );
}

console.log('=== review-pipeline validators: transcript missing → {ok:false} + exit 0 ===');
// CI-001 cross-plan fix: a validator that exits 0 with EMPTY stdout would
// break Phase 2's runPerAgentValidator aggregator (which interprets empty
// stdout as "validator crashed → fail open" vs. an explicit verdict). Every
// validator MUST emit a parseable {ok:false} verdict on bad payload.
for (const validator of REVIEW_ROSTER) {
  const result = runValidator(validator, 'irrelevant content', { omitTranscript: true });
  assert(result.status === 0, `${validator}: exits 0 on missing transcript_path`);
  const verdict = parseVerdict(result.stdout);
  assert(
    verdict !== null && verdict.ok === false,
    `${validator}: emits {ok:false} verdict on missing transcript_path`
  );
}

console.log('=== review-pipeline validators: transcript unreadable → {ok:false} ===');
// readLastAssistantMessage returns null when the JSONL path exists in the
// payload but cannot be read. Validators MUST translate that into an
// explicit failure verdict naming the cause, NOT silently pass.
for (const validator of REVIEW_ROSTER) {
  const result = runValidator(validator, 'irrelevant content', { unreadablePath: true });
  const verdict = parseVerdict(result.stdout);
  assert(
    verdict !== null
      && verdict.ok === false
      && typeof verdict.reason === 'string'
      && verdict.reason.includes('transcript_path unreadable'),
    `${validator}: transcript unreadable → reason names the cause`
  );
}

// ---------------------------------------------------------------------------
// Per-validator structural contracts.
//
// Each block exercises:
//   - happy path: the canonical shape the prompt asks the agent to produce.
//   - sentinel / alternate modes: shapes the validator accepts as legal.
//   - negative: the first-failure-wins reason the validator emits when a
//               specific required field is missing.
//   - minimal-fixture pass (5 review-family agents per iter 3 F-006):
//               smallest synthetic shape that satisfies the contract.
// ---------------------------------------------------------------------------

// ---- bug-detector.js -------------------------------------------------------
// Per validator: '## Bugs Detected' + severity heading + backtick file:line
// + total tally + Evidence/Impact/Test Gap per finding; OR 'No bugs detected.'
console.log('=== bug-detector ===');
const BUG_DETECTOR_HAPPY = [
  '## Bugs Detected',
  '',
  '### Critical',
  '- Race condition in `app/Auth.php:42`',
  '  **Evidence:** Two callers mutate session state without locking.',
  '  **Impact:** Stale session on concurrent login.',
  '  **Test Gap:** No concurrency test in auth suite.',
  '',
  '**Total: 1 critical, 0 high, 0 medium**',
].join('\n');
check('bug-detector.js', BUG_DETECTOR_HAPPY, { ok: true },
  'happy path: bugs heading + severity + backtick ref + tally + finding fields');
check('bug-detector.js', 'No bugs detected.', { ok: true },
  'sentinel path: no-bugs message short-circuits to pass');
check('bug-detector.js',
  '## Bugs Detected\n### Critical\nno backtick refs here',
  { ok: false, reasonContains: 'missing backtick file:line reference' },
  'negative: heading + severity but no backtick file:line');
// Minimal synthetic fixture (iter 3 F-006): smallest legal shape — sentinel.
const BUG_DETECTOR_PASS_MIN = 'No bugs detected.';
check('bug-detector.js', BUG_DETECTOR_PASS_MIN, { ok: true },
  'minimal-fixture (iter 3 F-006): sentinel-only message is the smallest legal pass');

// ---- pattern-reviewer.js ---------------------------------------------------
// Per validator: '## Project Pattern Deviations' + Existing pattern + This code
// + backtick ref + '**Total: X deviations**' + Evidence/Impact/Test Gap.
console.log('=== pattern-reviewer ===');
const PATTERN_REVIEWER_HAPPY = [
  '## Project Pattern Deviations',
  '',
  '- New helper in `app/Services/Foo.php:10`',
  '  **Existing pattern:** Service classes live under `app/Domain/`.',
  '  **This code:** Helper placed under `app/Services/` instead.',
  '  **Evidence:** 12 service classes under app/Domain, 1 deviation here.',
  '  **Impact:** Inconsistent service location confuses readers.',
  '  **Test Gap:** No directory-structure lint.',
  '',
  '**Total: 1 deviations**',
].join('\n');
check('pattern-reviewer.js', PATTERN_REVIEWER_HAPPY, { ok: true },
  'happy path: deviations heading + existing/this + backtick + tally + fields');
check('pattern-reviewer.js', 'No project pattern deviations found.', { ok: true },
  'sentinel path: no-deviations message short-circuits to pass');
check('pattern-reviewer.js',
  '## Project Pattern Deviations\n- thing\n**Existing pattern:** x\n**This code:** y\n**Total: 1 deviations**\n**Evidence:** e\n**Impact:** i\n**Test Gap:** t',
  { ok: false, reasonContains: 'missing backtick file:line reference' },
  'negative: heading + sub-items but no file:line reference');
// Minimal synthetic fixture.
const PATTERN_REVIEWER_PASS_MIN = 'No project pattern deviations found.';
check('pattern-reviewer.js', PATTERN_REVIEWER_PASS_MIN, { ok: true },
  'minimal-fixture (iter 3 F-006): sentinel-only message is the smallest legal pass');

// ---- plan-compliance-reviewer.js -------------------------------------------
// Two modes (exclusive):
//   - code-review: '## Plan Compliance Findings' + category heading
//                  + SG/CI/OS-NNN ID + Acceptance Criteria checklist [x]/[ ]
//                  + Evidence/Impact/Test Gap.
//   - plan-review: '## Plan Compliance Review: Phase' + '### Coverage Matrix'
//                  + COVERED/PARTIAL/NOT COVERED status.
console.log('=== plan-compliance-reviewer ===');
const PLAN_COMPLIANCE_CODE_HAPPY = [
  '## Plan Compliance Findings',
  '',
  '### Spec Gap',
  '',
  '- SG-001: missing acceptance for X',
  '',
  'Acceptance Criteria:',
  '- [x] AC-1 verified in test',
  '- [ ] AC-2 not addressed',
  '',
  '**Evidence:** No test covers AC-2.',
  '**Impact:** Spec gap.',
  '**Test Gap:** Add AC-2 test.',
].join('\n');
check('plan-compliance-reviewer.js', PLAN_COMPLIANCE_CODE_HAPPY, { ok: true },
  'happy path (code-review mode): findings + category + ID + checklist + fields');
const PLAN_COMPLIANCE_PLAN_HAPPY = [
  '## Plan Compliance Review: Phase 1',
  '',
  '### Coverage Matrix',
  '',
  '| Requirement | Status |',
  '|-------------|--------|',
  '| REQ-01      | COVERED |',
  '| REQ-02      | PARTIAL |',
  '| REQ-03      | NOT COVERED |',
].join('\n');
check('plan-compliance-reviewer.js', PLAN_COMPLIANCE_PLAN_HAPPY, { ok: true },
  'happy path (plan-review mode): Phase heading + Coverage Matrix + statuses');
check('plan-compliance-reviewer.js',
  '## Plan Compliance Findings\n## Plan Compliance Review: Phase 1\n### Coverage Matrix\nCOVERED',
  { ok: false, reasonContains: 'ambiguous mode' },
  'negative: both mode signals present → ambiguous-mode rejection');
check('plan-compliance-reviewer.js',
  'no mode signal here at all',
  { ok: false, reasonContains: 'no mode signal detected' },
  'negative: neither mode signal present → mode-detection failure');
// Minimal synthetic fixture (plan-review mode).
const PLAN_COMPLIANCE_PASS_MIN = [
  '## Plan Compliance Review: Phase 1',
  '### Coverage Matrix',
  '| REQ-01 | COVERED |',
].join('\n');
check('plan-compliance-reviewer.js', PLAN_COMPLIANCE_PASS_MIN, { ok: true },
  'minimal-fixture (iter 3 F-006): smallest plan-review shape (heading + matrix + status)');

// ---- stack-reviewer.js -----------------------------------------------------
// Three pass shapes: violations + tally + fields; no-violations sentinel;
// early-exit "no stack skill loaded, skipping" when no stack skill is present.
console.log('=== stack-reviewer ===');
const STACK_REVIEWER_HAPPY = [
  '## Stack Best Practice Violations',
  '',
  '- N+1 query in `app/Models/User.php:50`',
  '  **Evidence:** Loop calls relation per iteration.',
  '  **Impact:** Linear query growth.',
  '  **Test Gap:** No query-count test.',
  '',
  '**Total: 1 violations**',
].join('\n');
check('stack-reviewer.js', STACK_REVIEWER_HAPPY, { ok: true },
  'happy path: violations heading + backtick + tally + fields');
check('stack-reviewer.js', 'No stack best practice violations found.', { ok: true },
  'sentinel path: no-violations message short-circuits to pass');
check('stack-reviewer.js', 'no stack skill loaded, skipping', { ok: true },
  'early-exit path: no-skill marker short-circuits to pass (legal when no stack loaded)');
check('stack-reviewer.js',
  '## Stack Best Practice Violations\n- thing in `f.js:1`',
  { ok: false, reasonContains: "missing total tally line '**Total: X violations**'" },
  'negative: heading + backtick ref but missing tally line');
// Minimal synthetic fixture.
const STACK_REVIEWER_PASS_MIN = 'No stack best practice violations found.';
check('stack-reviewer.js', STACK_REVIEWER_PASS_MIN, { ok: true },
  'minimal-fixture (iter 3 F-006): sentinel-only message is the smallest legal pass');

// ---- fixer.js --------------------------------------------------------------
// Fix Report with Finding ID + Status + Files Changed + What Changed + Tests.
// Exactly ONE finding addressed per invocation.
console.log('=== fixer ===');
const FIXER_HAPPY = [
  'Fix Report',
  '',
  'Finding ID: F-001',
  'Status: Fixed',
  'Files Changed: app/Auth.php',
  'What Changed: Added mutex around session write.',
  'Tests: 12 passing, 0 failing',
].join('\n');
check('fixer.js', FIXER_HAPPY, { ok: true },
  'happy path: Fix Report + all five required fields + single Finding ID');
check('fixer.js',
  'Fix Report\nStatus: Fixed\nFiles Changed: x\nWhat Changed: y\nTests: ok',
  { ok: false, reasonContains: "missing field 'Finding ID'" },
  'negative: Fix Report present but Finding ID field absent');
check('fixer.js',
  [
    'Fix Report',
    'Finding ID: F-001',
    'Status: Fixed',
    'Files Changed: a',
    'What Changed: b',
    'Tests: ok',
    'Finding ID: F-002',
    'Status: Fixed',
    'Files Changed: c',
    'What Changed: d',
    'Tests: ok',
  ].join('\n'),
  { ok: false, reasonContains: 'must be exactly 1' },
  'negative: two findings addressed in one fix run → exactly-one contract fails');

// ---- researcher.js ---------------------------------------------------------
// Three modes:
//   - phase:     'Research complete: [N] tasks enriched' (or numeric count).
//   - ecosystem: 'Ecosystem research complete:' + provenance tag.
//   - inline:    structured summary (headings / patterns / reusable).
console.log('=== researcher ===');
check('researcher.js',
  'Research complete: 5 tasks enriched\n\n## Findings\n- thing',
  { ok: true },
  'happy path (phase mode): completion signal with numeric count');
check('researcher.js',
  'Research complete: [N] tasks enriched',
  { ok: true },
  'happy path (phase mode): completion signal with literal [N] placeholder');
check('researcher.js',
  'Ecosystem research complete:\n\n[VERIFIED] React 18 supports concurrent rendering.\n[CITED] docs/react.md:10',
  { ok: true },
  'happy path (ecosystem mode): completion signal + provenance tag');
check('researcher.js',
  '## Project structure\n- src/...\n\n## Patterns\n- factory pattern reused\n',
  { ok: true },
  'happy path (inline mode): structured summary without completion signal');
check('researcher.js',
  'Ecosystem research complete:\n\nSome text but no provenance tags.',
  { ok: false, reasonContains: 'ecosystem mode missing provenance tag' },
  'negative: ecosystem mode without any [VERIFIED]/[CITED]/[ASSUMED] tag');

// ---- assumptions-analyzer.js -----------------------------------------------
// '## Assumptions' + Confidence + file citation + Impact + Risk:N + Mitigation
// + '## Risk Matrix'.
console.log('=== assumptions-analyzer ===');
const ASSUMPTIONS_HAPPY = [
  '## Assumptions',
  '',
  '- Assumption 1 about `plugins/bee/scripts/foo.js`',
  '  Confidence: Likely',
  '  Impact: Medium',
  '  Risk: 6 (monitor)',
  '  Mitigation: Add integration test before merge.',
  '',
  '## Risk Matrix',
  '| ID | Risk | Mitigation |',
].join('\n');
check('assumptions-analyzer.js', ASSUMPTIONS_HAPPY, { ok: true },
  'happy path: all 7 required fields (heading + Confidence + path + Impact + Risk + Mitigation + Matrix)');
check('assumptions-analyzer.js',
  '## Assumptions\n- a thing\nImpact: High\nRisk: 5 (mitigate)\nMitigation: x\n## Risk Matrix',
  { ok: false, reasonContains: "missing 'Confidence:' field" },
  'negative: Assumptions heading but no Confidence field');
check('assumptions-analyzer.js',
  '## Assumptions\n- a thing in `f.js`\nConfidence: Likely\nImpact: Medium\nRisk: 5 (mitigate)\nMitigation: x',
  { ok: false, reasonContains: "missing '## Risk Matrix' section" },
  'negative: all fields present but Risk Matrix section absent');

// ---- dependency-auditor.js -------------------------------------------------
// '## Dependency Health Report' + Phase-Relevant Dependencies table OR
// no-deps statement + '### Summary' with Dependencies scanned + Verdict.
console.log('=== dependency-auditor ===');
const DEPENDENCY_HAPPY = [
  '## Dependency Health Report',
  '',
  '### Phase-Relevant Dependencies',
  '| Package | Version | Health |',
  '|---------|---------|--------|',
  '| laravel | 11.0    | green  |',
  '',
  '### Summary',
  'Dependencies scanned: 27',
  'Verdict: HEALTHY',
].join('\n');
check('dependency-auditor.js', DEPENDENCY_HAPPY, { ok: true },
  'happy path: report heading + phase-relevant table + Summary + scanned count + Verdict');
check('dependency-auditor.js',
  [
    '## Dependency Health Report',
    'no phase-relevant dependencies for this phase',
    '### Summary',
    'Dependencies scanned: 27',
    'Verdict: HEALTHY',
  ].join('\n'),
  { ok: true },
  'happy path (alt): no-phase-relevant-deps statement substitutes for the table');
check('dependency-auditor.js',
  '## Dependency Health Report\n### Phase-Relevant Dependencies\n### Summary\nVerdict: HEALTHY',
  { ok: false, reasonContains: "missing 'Dependencies scanned' count" },
  'negative: all sections present but Dependencies scanned count missing');

// ---- testing-auditor.js ----------------------------------------------------
// Three modes (exclusive):
//   - scan:     '## Testing Audit Summary' + F-TEST-NNN findings or no-findings
//               + '## Test Coverage Map' + summary fields.
//   - generate: '## Test Generation Summary' + '## Requirement Coverage Map'
//               + COVERED/PARTIAL/UNCOVERED + summary fields.
//   - pre-plan: '## Test Gap Analysis' + Infrastructure Status table + Verdict
//               + Summary.
console.log('=== testing-auditor ===');
const TESTING_SCAN_HAPPY = [
  '## Testing Audit Summary',
  '',
  '### F-TEST-001 missing coverage on auth flow',
  '',
  '## Test Coverage Map',
  '| Module | Coverage |',
  '|--------|----------|',
  '| Auth   | 60%      |',
  '',
  'test files found: 12',
  'test cases found: 87',
  'critical paths covered: 5/8',
].join('\n');
check('testing-auditor.js', TESTING_SCAN_HAPPY, { ok: true },
  'happy path (scan mode): summary heading + F-TEST finding + coverage map + summary fields');
const TESTING_GENERATE_HAPPY = [
  '## Test Generation Summary',
  '',
  '## Requirement Coverage Map',
  '| REQ-01 | COVERED |',
  '| REQ-02 | PARTIAL |',
  '',
  'acceptance criteria: 8',
  'tests generated: 12',
  'tests passing: 12',
].join('\n');
check('testing-auditor.js', TESTING_GENERATE_HAPPY, { ok: true },
  'happy path (generate mode): summary + Requirement Coverage Map + status + summary fields');
const TESTING_PREPLAN_HAPPY = [
  '## Test Gap Analysis',
  '',
  '| Stack | Test Runner | Config | Can Run | Status |',
  '|-------|-------------|--------|---------|--------|',
  '| laravel | pest | phpunit.xml | yes | green |',
  'Infrastructure Status: ready',
  '',
  '### Verdict',
  'READY',
  '',
  '### Summary',
  'All stacks ready.',
].join('\n');
check('testing-auditor.js', TESTING_PREPLAN_HAPPY, { ok: true },
  'happy path (pre-plan mode): gap analysis + infra table + Verdict READY + Summary');
check('testing-auditor.js',
  '## Test Gap Analysis\n## Test Generation Summary\n## Testing Audit Summary',
  { ok: false, reasonContains: 'ambiguous testing-auditor mode' },
  'negative: multiple mode signals → ambiguous-mode rejection');
check('testing-auditor.js',
  '## Random heading\nnothing useful',
  { ok: false, reasonContains: 'no testing-auditor mode signal detected' },
  'negative: no mode signal → mode-detection failure');

// ---- audit-finding-validator.js --------------------------------------------
// '### Validation: F-' + Verdict + Confidence + File verified + Evidence
// verified + Reason + '## Validation Summary' + false positive rate.
console.log('=== audit-finding-validator ===');
const AUDIT_FINDING_HAPPY = [
  '### Validation: F-SEC-001',
  '',
  'Verdict: CONFIRMED',
  'Confidence: HIGH',
  'File verified: app/Auth.php exists',
  'Evidence verified: line 42 matches',
  'Reason: Same SQLi pattern observed.',
  '',
  '## Validation Summary',
  'Total: 5; Confirmed: 4; False Positive: 1; Needs Context: 0',
  'false positive rate: 20%',
].join('\n');
check('audit-finding-validator.js', AUDIT_FINDING_HAPPY, { ok: true },
  'happy path: validation entry + verdict + confidence + all field labels + summary + FP rate');
check('audit-finding-validator.js',
  '### Validation: F-SEC-001\nVerdict: MAYBE\nConfidence: HIGH\nFile verified\nEvidence verified\nReason: x\n## Validation Summary\nfalse positive rate: 0%',
  { ok: false, reasonContains: "missing 'Verdict:' value" },
  'negative: Verdict value not in CONFIRMED/FALSE POSITIVE/NEEDS CONTEXT enum');
check('audit-finding-validator.js',
  '### Validation: F-SEC-001\nVerdict: CONFIRMED\nConfidence: HIGH\nFile verified\nEvidence verified\nReason: x\n## Validation Summary',
  { ok: false, reasonContains: "missing 'false positive rate'" },
  'negative: Validation Summary present but false positive rate field absent');
// Minimal synthetic fixture.
const AUDIT_FINDING_PASS_MIN = [
  '### Validation: F-SEC-001',
  'Verdict: CONFIRMED',
  'Confidence: HIGH',
  'File verified: ok',
  'Evidence verified: ok',
  'Reason: matches',
  '## Validation Summary',
  'false positive rate: 0%',
].join('\n');
check('audit-finding-validator.js', AUDIT_FINDING_PASS_MIN, { ok: true },
  'minimal-fixture (iter 3 F-006): smallest legal shape (entry + all fields + summary + FP rate)');

// ---- finding-validator.js --------------------------------------------------
// F-BUG-001 cross-flow contract fix: the `finding-validator` agent emits
// `## Classification` + Finding/Verdict/Confidence/Source Agent/Reason —
// distinct from audit-finding-validator's `### Validation: F-` schema. The
// review pipeline's ship/review/review-implementation dispatch sites now
// route their finding-validator agent transcripts through this validator.
console.log('=== finding-validator ===');
const FINDING_VALIDATOR_HAPPY = [
  '## Classification',
  '',
  '- **Finding:** F-001',
  '- **Verdict:** REAL BUG',
  '- **Confidence:** HIGH',
  '- **Source Agent:** bug-detector',
  '- **Reason:** Null pointer dereference in error path.',
].join('\n');
check('finding-validator.js', FINDING_VALIDATOR_HAPPY, { ok: true },
  'happy path: REAL BUG verdict + all required fields → pass');
// All four enum verdicts should pass.
check('finding-validator.js',
  '## Classification\n- **Finding:** F-002\n- **Verdict:** FALSE POSITIVE\n- **Confidence:** HIGH\n- **Source Agent:** pattern-reviewer\n- **Reason:** framework convention',
  { ok: true },
  'enum coverage: FALSE POSITIVE verdict passes');
check('finding-validator.js',
  '## Classification\n- **Finding:** F-003\n- **Verdict:** STYLISTIC\n- **Confidence:** MEDIUM\n- **Source Agent:** stack-reviewer\n- **Reason:** naming preference',
  { ok: true },
  'enum coverage: STYLISTIC verdict + MEDIUM confidence passes');
check('finding-validator.js',
  '## Classification\n- **Finding:** F-004\n- **Verdict:** DROPPED\n- **Confidence:** HIGH\n- **Source Agent:** plan-compliance-reviewer\n- **Evidence Strength Gate:** DROPPED: missing Evidence Strength',
  { ok: true },
  'DROPPED verdict: Reason field is optional (gate-failure cause lives in Evidence Strength Gate)');
// Negative cases — first-failure-wins.
check('finding-validator.js',
  '- **Finding:** F-001\n- **Verdict:** REAL BUG\n- **Confidence:** HIGH\n- **Source Agent:** bug-detector\n- **Reason:** x',
  { ok: false, reasonContains: "missing '## Classification'" },
  'negative: missing Classification heading');
check('finding-validator.js',
  '## Classification\n- **Verdict:** REAL BUG\n- **Confidence:** HIGH\n- **Source Agent:** bug-detector\n- **Reason:** x',
  { ok: false, reasonContains: "missing 'Finding: F-'" },
  'negative: missing Finding: F- identifier');
check('finding-validator.js',
  '## Classification\n- **Finding:** F-001\n- **Verdict:** MAYBE\n- **Confidence:** HIGH\n- **Source Agent:** bug-detector\n- **Reason:** x',
  { ok: false, reasonContains: "missing 'Verdict:' value" },
  'negative: Verdict value not in enum (REAL BUG / FALSE POSITIVE / STYLISTIC / DROPPED)');
check('finding-validator.js',
  '## Classification\n- **Finding:** F-001\n- **Verdict:** REAL BUG\n- **Confidence:** LOW\n- **Source Agent:** bug-detector\n- **Reason:** x',
  { ok: false, reasonContains: "missing 'Confidence:' value" },
  'negative: Confidence value not in HIGH/MEDIUM enum (LOW is forbidden per agent prompt)');
check('finding-validator.js',
  '## Classification\n- **Finding:** F-001\n- **Verdict:** REAL BUG\n- **Confidence:** HIGH\n- **Reason:** x',
  { ok: false, reasonContains: "missing 'Source Agent:'" },
  'negative: missing Source Agent field');
check('finding-validator.js',
  '## Classification\n- **Finding:** F-001\n- **Verdict:** REAL BUG\n- **Confidence:** HIGH\n- **Source Agent:** bug-detector',
  { ok: false, reasonContains: "missing 'Reason:'" },
  'negative: non-DROPPED verdict requires Reason field');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`Tests passed: ${passed}`);
console.log(`Tests failed: ${failed}`);
console.log(`Total tests:  ${passed + failed}`);

cleanupTmpDirs();
process.exit(failed > 0 ? 1 : 0);
