#!/usr/bin/env node
// Test: extract-fingerprint.js parses a review markdown file (the output of
// `/bee:review-implementation`) and emits a JSON sidecar at
// .bee/metrics/quality-baseline-YYYY-MM-DD.json suitable for mechanical diff
// against future review runs.
//
// Verifies:
//   - script file exists and has the canonical Node shebang
//   - given a v4.1 fixture (Evidence Strength + Citation + Validation fields),
//     the JSON has accurate counts for: total_findings, findings_by_severity,
//     evidence_strength (cited/verified/untagged), citation_coverage_pct,
//     validation_outcomes (real_bug/false_positive/stylistic/dropped),
//     false_positive_rate_pct
//   - given a legacy fixture (no Evidence Strength fields), all findings count
//     as untagged_count and citation_coverage_pct is 0
//   - missing/garbage input is handled gracefully (non-zero exit, no crash)

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const os = require('os');

const PLUGIN_DIR = path.join(__dirname, '..', '..');
const SCRIPT_PATH = path.join(PLUGIN_DIR, 'scripts', 'extract-fingerprint.js');

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

function readFile(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (_e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fixtures (inline so the test stays self-contained)
// ---------------------------------------------------------------------------

// v4.1 review with full Evidence Strength + Citation + Validation fields.
// Counts encoded:
//   findings inside ## Findings: 4 (F-001..F-004)
//   findings inside ## False Positives: 1 (F-005)
//   total_findings = 5 (## Findings + ## False Positives, so the rate
//                       denominator includes findings that migrated)
//   severities (only counted from ## Findings): Critical=1, High=2, Medium=1
//   Evidence Strength: [CITED]=2, [VERIFIED]=2 (across the 4 in ## Findings)
//     -> coverage = 4 tagged / 5 total = 80%
//   Validation: REAL BUG=2, STYLISTIC=1, FALSE POSITIVE=1 inline +
//               1 in ## False Positives section
//     -> false_positive_count = 2; rate = 2/5 = 40%
const FIXTURE_V41 = `# Review: Phase 2 -- Sample Phase

## Summary
- Date: 2026-04-22

## Findings

### F-001: Critical bug in handler
- **Severity:** Critical
- **Category:** Bug
- **File:** app/Foo.php
- **Lines:** 10-20
- **Evidence Strength:** [CITED]
- **Citation:** https://example.com/docs/foo
- **Validation:** REAL BUG

### F-002: Pattern drift
- **Severity:** High
- **Category:** Pattern
- **File:** app/Bar.php
- **Lines:** 30-40
- **Evidence Strength:** [VERIFIED]
- **Citation:** app/Pattern.php:5-12
- **Validation:** REAL BUG

### F-003: Naming nitpick
- **Severity:** Medium
- **Category:** Standards
- **File:** app/Baz.php
- **Lines:** 1-1
- **Evidence Strength:** [VERIFIED]
- **Citation:** skills/review/SKILL.md#naming
- **Validation:** STYLISTIC

### F-004: Suspected SQL injection
- **Severity:** High
- **Category:** Security
- **File:** app/Qux.php
- **Lines:** 100-110
- **Evidence Strength:** [CITED]
- **Citation:** https://owasp.org/sql-injection
- **Validation:** FALSE POSITIVE

## False Positives

### F-005: A finding that was moved here
- **Severity:** Medium
- **Validation:** FALSE POSITIVE

## Fix Summary
`;

// Legacy review (predates v4.1) -- no Evidence Strength or Citation fields,
// no Validation classifications. Just F-NNN headings + Severity. The
// extractor must not crash and should report:
//   total_findings: 2, untagged_count: 2, citation_coverage_pct: 0
const FIXTURE_LEGACY = `# Review: Phase 1 -- Legacy

## Findings

### F-001: Old-format finding
- **Severity:** High
- **Category:** Bug
- **File:** src/legacy.ts
- **Description:** No Evidence Strength tag here.

### F-002: Another old finding
- **Severity:** Medium
- **Category:** Standards
- **File:** src/legacy2.ts

## Fix Summary
`;

// ---------------------------------------------------------------------------
// 1. Script existence + structural sanity
// ---------------------------------------------------------------------------

console.log('=== extract-fingerprint.js: file existence ===');

assert(fs.existsSync(SCRIPT_PATH), 'extract-fingerprint.js exists at plugins/bee/scripts/');

const scriptSrc = readFile(SCRIPT_PATH);
assert(scriptSrc !== null, 'extract-fingerprint.js is readable');
if (scriptSrc !== null) {
  assert(/^#!\/usr\/bin\/env node/.test(scriptSrc), 'has canonical Node shebang');
}

// ---------------------------------------------------------------------------
// Helpers for running the script against a fixture file
// ---------------------------------------------------------------------------

function runExtractor(fixtureContent, label, opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-fp-test-'));
  const fixturePath = path.join(tmpDir, `${label}-review.md`);
  fs.writeFileSync(fixturePath, fixtureContent, 'utf8');
  const outDir = path.join(tmpDir, 'metrics');
  fs.mkdirSync(outDir, { recursive: true });
  const FIXED_DATE = '2099-01-01';

  let runOk = false;
  let runErr = null;
  let stdout = '';
  let stderr = '';
  try {
    // spawnSync (not exec) -- argv array, no shell interpretation.
    const res = childProcess.spawnSync('node', [SCRIPT_PATH, fixturePath], {
      env: {
        ...process.env,
        BEE_METRICS_DIR: outDir,
        BEE_DATE: FIXED_DATE,
      },
      encoding: 'utf8',
    });
    stdout = res.stdout || '';
    stderr = res.stderr || '';
    runOk = res.status === 0;
    if (!runOk) {
      runErr = new Error(`exit ${res.status}: ${stderr.trim()}`);
    }
  } catch (e) {
    runErr = e;
  }

  const jsonPath = path.join(outDir, `quality-baseline-${FIXED_DATE}.json`);
  const jsonSrc = readFile(jsonPath);
  let parsed = null;
  if (jsonSrc !== null) {
    try {
      parsed = JSON.parse(jsonSrc);
    } catch (_e) {
      parsed = null;
    }
  }

  return { tmpDir, jsonPath, jsonSrc, parsed, runOk, runErr, stdout, stderr };
}

function cleanup(ctx) {
  try {
    fs.rmSync(ctx.tmpDir, { recursive: true, force: true });
  } catch (_e) {
    // best effort
  }
}

// ---------------------------------------------------------------------------
// 2. v4.1 fixture: full Evidence Strength + Validation extraction
// ---------------------------------------------------------------------------

console.log('\n=== extract-fingerprint.js: v4.1 fixture ===');

const v41 = runExtractor(FIXTURE_V41, 'v41');
assert(v41.runOk, `script runs without error on v4.1 fixture${v41.runErr ? ' (' + v41.runErr.message + ')' : ''}`);
assert(v41.parsed !== null, 'v4.1 fixture produces a valid JSON sidecar');

if (v41.parsed) {
  const j = v41.parsed;
  assert(typeof j.captured_at === 'string', 'captured_at is a string (ISO 8601)');
  assert(typeof j.review_artifact_path === 'string', 'review_artifact_path is set');
  assert(j.total_findings === 5, `total_findings === 5 (got ${j.total_findings})`);

  assert(j.findings_by_severity && j.findings_by_severity.critical === 1, 'critical count = 1');
  assert(j.findings_by_severity && j.findings_by_severity.high === 2, 'high count = 2');
  assert(j.findings_by_severity && j.findings_by_severity.medium === 1, 'medium count = 1');

  assert(j.evidence_strength && j.evidence_strength.cited_count === 2, 'cited_count = 2');
  assert(j.evidence_strength && j.evidence_strength.verified_count === 2, 'verified_count = 2');
  assert(
    j.evidence_strength && j.evidence_strength.untagged_count === 0,
    'untagged_count = 0 (all v4.1 findings are tagged)'
  );

  // 4 tagged out of 5 total = 80% coverage
  assert(j.citation_coverage_pct === 80, `citation_coverage_pct = 80 (got ${j.citation_coverage_pct})`);

  assert(
    j.validation_outcomes && j.validation_outcomes.real_bug === 2,
    `real_bug count = 2 (got ${j.validation_outcomes && j.validation_outcomes.real_bug})`
  );
  assert(
    j.validation_outcomes && j.validation_outcomes.false_positive === 2,
    `false_positive count = 2 (1 inline + 1 in ## False Positives section)`
  );
  assert(
    j.validation_outcomes && j.validation_outcomes.stylistic === 1,
    'stylistic count = 1'
  );

  // 2 false positives across 5 findings (4 in ## Findings + 1 moved to
  // ## False Positives) = 40%. Including the moved entries in the
  // denominator keeps the rate bounded at 100%.
  assert(
    j.false_positive_rate_pct === 40,
    `false_positive_rate_pct = 40 (got ${j.false_positive_rate_pct})`
  );
}

cleanup(v41);

// ---------------------------------------------------------------------------
// 3. Legacy fixture: no Evidence Strength tags -> untagged_count = total
// ---------------------------------------------------------------------------

console.log('\n=== extract-fingerprint.js: legacy fixture ===');

const legacy = runExtractor(FIXTURE_LEGACY, 'legacy');
assert(legacy.runOk, `script runs without error on legacy fixture${legacy.runErr ? ' (' + legacy.runErr.message + ')' : ''}`);
assert(legacy.parsed !== null, 'legacy fixture produces a valid JSON sidecar');

if (legacy.parsed) {
  const j = legacy.parsed;
  assert(j.total_findings === 2, `legacy total_findings = 2 (got ${j.total_findings})`);
  assert(
    j.evidence_strength && j.evidence_strength.cited_count === 0,
    'legacy cited_count = 0'
  );
  assert(
    j.evidence_strength && j.evidence_strength.verified_count === 0,
    'legacy verified_count = 0'
  );
  assert(
    j.evidence_strength && j.evidence_strength.untagged_count === 2,
    `legacy untagged_count = 2 (got ${j.evidence_strength && j.evidence_strength.untagged_count})`
  );
  assert(
    j.citation_coverage_pct === 0,
    `legacy citation_coverage_pct = 0 (got ${j.citation_coverage_pct})`
  );
  // No Validation lines = all zeros, fp rate 0.
  assert(
    j.validation_outcomes && j.validation_outcomes.real_bug === 0,
    'legacy real_bug = 0'
  );
  assert(
    j.validation_outcomes && j.validation_outcomes.false_positive === 0,
    'legacy false_positive = 0'
  );
  assert(j.false_positive_rate_pct === 0, 'legacy false_positive_rate_pct = 0');
}

cleanup(legacy);

// ---------------------------------------------------------------------------
// 4. Missing-input handling
// ---------------------------------------------------------------------------

console.log('\n=== extract-fingerprint.js: missing-input handling ===');

const tmpDir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-fp-missing-'));
const missingPath = path.join(tmpDir3, 'does-not-exist.md');
const res = childProcess.spawnSync('node', [SCRIPT_PATH, missingPath], {
  env: {
    ...process.env,
    BEE_METRICS_DIR: tmpDir3,
    BEE_DATE: '2099-01-01',
  },
  encoding: 'utf8',
});
assert(res.status !== 0, 'script exits non-zero when given a missing review file');
assert(
  /not found|cannot read|no such|does not exist/i.test((res.stderr || '') + (res.stdout || '')),
  'error message mentions missing/not-found file'
);
try {
  fs.rmSync(tmpDir3, { recursive: true, force: true });
} catch (_e) {
  // best effort
}

// ---------------------------------------------------------------------------
// 5. Regression: false_positive_rate_pct must not exceed 100% even when
//    most findings have migrated from ## Findings to ## False Positives.
//    Regression for F-003.
// ---------------------------------------------------------------------------

console.log('\n=== extract-fingerprint.js: false-positive rate cap (F-003) ===');

// 1 finding remaining in ## Findings + 3 in ## False Positives.
//   Pre-fix behavior: numerator = 0 inline + 3 moved = 3,
//                     denominator = 1 (## Findings only),
//                     -> 300% rate.
//   Post-fix behavior: numerator = 3, denominator = 1 + 3 = 4,
//                      -> 75% rate.
const FIXTURE_RATE_CAP = `# Review: rate cap regression

## Findings

### F-001: Real bug that survived validation
- **Severity:** High
- **Category:** Bug
- **Validation:** REAL BUG

## False Positives

### F-002: Moved out
- **Severity:** Medium
- **Validation:** FALSE POSITIVE

### F-003: Moved out
- **Severity:** Medium
- **Validation:** FALSE POSITIVE

### F-004: Moved out
- **Severity:** Medium
- **Validation:** FALSE POSITIVE
`;

const rateCap = runExtractor(FIXTURE_RATE_CAP, 'rate-cap');
assert(rateCap.runOk, `rate-cap fixture runs without error${rateCap.runErr ? ' (' + rateCap.runErr.message + ')' : ''}`);
if (rateCap.parsed) {
  const j = rateCap.parsed;
  assert(j.total_findings === 4, `rate-cap total_findings === 4 (got ${j.total_findings})`);
  assert(
    j.validation_outcomes && j.validation_outcomes.false_positive === 3,
    `rate-cap false_positive count === 3 (got ${j.validation_outcomes && j.validation_outcomes.false_positive})`
  );
  assert(
    j.false_positive_rate_pct === 75,
    `rate-cap false_positive_rate_pct === 75 (got ${j.false_positive_rate_pct}); must NOT exceed 100`
  );
  assert(
    j.false_positive_rate_pct <= 100,
    `rate-cap false_positive_rate_pct must be <= 100 (got ${j.false_positive_rate_pct})`
  );
}
cleanup(rateCap);

// ---------------------------------------------------------------------------
// 6. Regression: severity tally captures Low and routes unknown severities
//    to `other` instead of silently dropping them. Regression for F-005.
// ---------------------------------------------------------------------------

console.log('\n=== extract-fingerprint.js: severity bucketing (F-005) ===');

// One finding per severity: Low (newly tracked) and Info (unrecognized -> other).
const FIXTURE_SEVERITY = `# Review: severity bucketing

## Findings

### F-001: Low-severity finding
- **Severity:** Low
- **Category:** Standards

### F-002: Info-severity finding
- **Severity:** Info
- **Category:** Standards
`;

const sevTest = runExtractor(FIXTURE_SEVERITY, 'severity');
assert(sevTest.runOk, `severity fixture runs without error${sevTest.runErr ? ' (' + sevTest.runErr.message + ')' : ''}`);
if (sevTest.parsed) {
  const j = sevTest.parsed;
  assert(j.total_findings === 2, `severity total_findings === 2 (got ${j.total_findings})`);
  assert(
    j.findings_by_severity && j.findings_by_severity.low === 1,
    `findings_by_severity.low === 1 (got ${j.findings_by_severity && j.findings_by_severity.low}); must NOT silently drop Low`
  );
  assert(
    j.findings_by_severity && j.findings_by_severity.other === 1,
    `findings_by_severity.other === 1 (got ${j.findings_by_severity && j.findings_by_severity.other}); unrecognized severities go to other`
  );
  // Sum of severity buckets must equal the total findings -- this is the
  // structural invariant F-005 broke (silent drops).
  const sevSum =
    j.findings_by_severity.critical +
    j.findings_by_severity.high +
    j.findings_by_severity.medium +
    j.findings_by_severity.low +
    j.findings_by_severity.other;
  assert(
    sevSum === j.total_findings,
    `sum of severity buckets (${sevSum}) === total_findings (${j.total_findings})`
  );
}
cleanup(sevTest);

// ---------------------------------------------------------------------------
// 7. Regression: BEE_DATE input validation. A malicious value like
//    `BEE_DATE=../etc/passwd` must NOT escape BEE_METRICS_DIR; the script
//    falls back to today's date and writes inside the configured dir.
//    Regression for F-004.
// ---------------------------------------------------------------------------

console.log('\n=== extract-fingerprint.js: BEE_DATE validation (F-004) ===');

const safeDateTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-fp-safedate-'));
const safeFixture = path.join(safeDateTmp, 'review.md');
fs.writeFileSync(safeFixture, FIXTURE_LEGACY, 'utf8');
const safeOutDir = path.join(safeDateTmp, 'metrics');
fs.mkdirSync(safeOutDir, { recursive: true });
// Snapshot files outside the metrics dir BEFORE the run so we can detect
// any path-traversal escape.
const beforeOutsideListing = fs.readdirSync(safeDateTmp);

const safeDateRes = childProcess.spawnSync('node', [SCRIPT_PATH, safeFixture], {
  env: {
    ...process.env,
    BEE_METRICS_DIR: safeOutDir,
    BEE_DATE: '../etc/passwd',
  },
  encoding: 'utf8',
});
assert(
  safeDateRes.status === 0,
  `script tolerates poisoned BEE_DATE without throwing (exit ${safeDateRes.status}, stderr=${(safeDateRes.stderr || '').trim()})`
);
assert(
  /BEE_DATE rejected/i.test(safeDateRes.stderr || ''),
  'script warns to stderr when BEE_DATE is rejected'
);

// The output filename must use today's date (YYYY-MM-DD), not the poisoned input.
const todayIso = new Date().toISOString().slice(0, 10);
const expectedSafeOut = path.join(safeOutDir, `quality-baseline-${todayIso}.json`);
assert(
  fs.existsSync(expectedSafeOut),
  `script wrote fallback output to ${expectedSafeOut}`
);

// And nothing was written outside the metrics dir.
const afterOutsideListing = fs.readdirSync(safeDateTmp);
assert(
  afterOutsideListing.length === beforeOutsideListing.length &&
    afterOutsideListing.every((entry) => beforeOutsideListing.includes(entry)),
  'no files written outside BEE_METRICS_DIR via BEE_DATE traversal'
);

try {
  fs.rmSync(safeDateTmp, { recursive: true, force: true });
} catch (_e) {
  // best effort
}

// Also exercise safeDate() directly (unit-level coverage for the helper).
const { safeDate } = require(SCRIPT_PATH);
assert(typeof safeDate === 'function', 'safeDate is exported from extract-fingerprint.js');
assert(safeDate('2026-04-22') === '2026-04-22', 'safeDate accepts well-formed YYYY-MM-DD');
assert(safeDate('') === todayIso, 'safeDate falls back to today when input is empty');
assert(safeDate(undefined) === todayIso, 'safeDate falls back to today when input is undefined');
assert(safeDate('../etc/passwd') === todayIso, 'safeDate rejects path-traversal input');
assert(safeDate('2026/04/22') === todayIso, 'safeDate rejects wrong separator');
assert(safeDate('26-04-22') === todayIso, 'safeDate rejects two-digit year');

// ---------------------------------------------------------------------------
// 8. STYLISTIC-DECLINED FP-NNN entry: backward-compat parsing (mode-b safety).
//    A false-positives.md store may contain entries whose Class field is
//    STYLISTIC-DECLINED, in markdown-bold form (`- **Class:** STYLISTIC-DECLINED`).
//    The canonical regex used by review commands (Step 3.9 dual-mode parse)
//    must recognize both bolded and unbolded forms; a plain `Class:` substring
//    search would fail on the bolded form. We assert the parsing is safe and
//    the canonical regex matches the fixture.
// ---------------------------------------------------------------------------

console.log('\n=== extract-fingerprint.js: STYLISTIC-DECLINED fixture (mode-b safety) ===');

const FIXTURE_STYLISTIC_DECLINED = `# False Positives Store

## Index
- FP-001 — Stylistic naming preference

## FP-001: Method name uses camelCase instead of snake_case
- **Finding:** Reviewer flagged getUserById() should be get_user_by_id()
- **Reason:** Project follows JS conventions; reviewer applied PHP style
- **File:** app/Services/UserService.js
- **Phase:** Phase 2 -- User Service
- **Date:** 2026-04-22
- **Class:** STYLISTIC-DECLINED
`;

// The canonical regex from Step 3.9 (review.md, review-implementation.md,
// swarm-review.md). It tolerates markdown bold variants such as `**Class:**`.
const CANONICAL_REGEX = /(?:\*\*)?Class(?:\*\*)?:?\s*(?:\*\*)?\s*STYLISTIC-DECLINED/;

// Parse-safety check: simple line-by-line iteration mimicking the dual-mode
// parser must not throw on a fixture containing a STYLISTIC-DECLINED entry.
let parseError = null;
try {
  const lines = FIXTURE_STYLISTIC_DECLINED.split('\n');
  for (const line of lines) {
    CANONICAL_REGEX.test(line);
  }
} catch (e) {
  parseError = e;
}
assert(
  parseError === null,
  'STYLISTIC-DECLINED fixture: canonical regex does not throw on bolded form'
);

assert(
  CANONICAL_REGEX.test(FIXTURE_STYLISTIC_DECLINED),
  'STYLISTIC-DECLINED fixture: canonical regex matches markdown-bold `- **Class:** STYLISTIC-DECLINED`'
);

// Also assert the regex matches an unbolded form (covers both v4.1 fixture
// flow and any future plain-text emission).
const UNBOLDED_FIXTURE = '- Class: STYLISTIC-DECLINED';
assert(
  CANONICAL_REGEX.test(UNBOLDED_FIXTURE),
  'STYLISTIC-DECLINED fixture: canonical regex matches unbolded `- Class: STYLISTIC-DECLINED`'
);

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
