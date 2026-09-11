#!/usr/bin/env node
// Parameterized paired-contract test for the 15 batch validator scripts at
// plugins/bee/scripts/hooks/validators/batch/<insertion>.js (REQ-09).
//
// Each batch validator is exercised end-to-end via spawnSync against four
// standard scenarios:
//
//   1. Pass case (marker present, every per-agent transcript passes).
//      Asserts stdout is exactly {"ok":true}. Pins the happy-path aggregation
//      contract: when N delivered transcripts × N pass verdicts → batch passes.
//
//   2. Fail case (marker present, exactly ONE per-agent transcript fails the
//      per-agent validator's structural check). Asserts stdout is
//      {"ok":false, "reason":"1/N agents failed: <slug>"} — the canonical
//      shape that conductor commands route through. This case ALSO closes the
//      CI-011 disambiguation gap: per-agent validators receive cwd via the
//      runPerAgentValidator stdin payload; if cwd propagation broke and the
//      per-agent re-checked its OWN marker against `process.cwd()` (where no
//      marker exists), the per-agent would short-circuit to {ok:true} and the
//      aggregate would pass — failing this assertion. So this case proves the
//      tmpRoot.bee/.autonomous-run-active marker reaches per-agents through
//      the dispatcher.
//
//   3. Marker-absent case (no .bee/.autonomous-run-active under tmpRoot).
//      Asserts stdout is {"ok":true} regardless of per-agent content
//      (REQ-10 extension: batch validators short-circuit via the marker-skip
//      prelude before any aggregation logic runs).
//
//   4. Missing-input fail-closed case (marker present, but agent_outputs has
//      FEWER entries than expected_count). Asserts stdout begins with
//      {"ok":false, "reason":"missing K per-agent outputs..."} — pins the
//      failClosedOnMissing gate at the conductor edge so silent partial-batch
//      drops are surfaced rather than treated as success.
//
// Total: 15 batch validators × 4 cases = 60 assertions.
//
// Patterns reused:
//   - spawnSync + stdin-feed (validator-audit-family.test.js:91-95).
//   - Inline JSONL fixtures via JSON.stringify (Phase 1 F-PAT-003).
//   - Plain-Node assert + counter (command-primitives.test.js:31-58).
//   - Explicit cleanupTmpDirs() BEFORE process.exit (Phase 1 F-PAT-005).
//   - Flat test layout — no nested batch/ directory (Phase 1 F-PAT-002).
//   - BATCH_VALIDATOR_ROSTER + BATCH_PER_INSERTION_AGENT_ROSTER imported from
//     batch-lib.js (single source of truth — F-CP-005).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  BATCH_VALIDATOR_ROSTER,
  BATCH_PER_INSERTION_AGENT_ROSTER,
} = require('../hooks/validators/batch-lib');

const BATCH_DIR = path.join(__dirname, '..', 'hooks', 'validators', 'batch');

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

function makeTmpRoot(withMarker) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-batch-paired-'));
  tmpDirs.push(dir);
  if (withMarker) {
    fs.mkdirSync(path.join(dir, '.bee'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.bee', '.autonomous-run-active'), '');
  }
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

// Write a one-line JSONL transcript whose only assistant turn has the given
// string content. Returns the transcript path. Mirrors the writeTranscript
// helper in Phase 1 paired-contract tests.
function writeTranscript(root, fileName, content) {
  const fp = path.join(root, fileName);
  const entry = JSON.stringify({ type: 'assistant', message: { content } });
  fs.writeFileSync(fp, entry + '\n');
  return fp;
}

// ---------------------------------------------------------------------------
// FIXTURES — per-agent PASS/FAIL transcript skeletons, keyed by per-agent slug.
//
// Sourced from the canonical happy-path / first-failure-wins fixtures pinned
// in Phase 1 paired-contract tests:
//   - audit family: validator-audit-family.test.js:188-432
//   - review pipeline: validator-review-pipeline.test.js:254-620
//   - implementer family: validator-implementer-family.test.js:265-365
//
// Each entry has:
//   pass: smallest legal content that yields the per-agent validator's
//         {ok:true} verdict.
//   fail: smallest legal content that yields the per-agent validator's
//         {ok:false} verdict (the first-failure-wins reason from the
//         validator itself).
//
// PASS choices favor the no-issues sentinel where the validator supports
// one — it is the minimum surface that exercises the validator's positive
// branch without coupling the test to incidental token requirements that
// might shift in unrelated future edits.
// ---------------------------------------------------------------------------

const IMPLEMENTER_PASS_TDD = [
  '# RED phase',
  '',
  '```',
  'FAIL src/calc.test.js',
  'Tests: 1 failed, 0 passed, 1 total',
  '```',
  '',
  '# GREEN phase',
  '',
  '```',
  'PASS src/calc.test.js',
  'Tests: 0 failed, 1 passed, 1 total',
  '```',
  '',
  'Task complete. 1 test passing.',
].join('\n');

const FIXTURES = {
  'security-auditor': {
    pass: 'No security issues found.\n## Security Audit Summary',
    // FAIL: drop the mandatory summary heading (first-failure-wins after
    // the finding/sentinel check passes).
    fail: '### F-SEC-001 SQLi here',
  },
  'database-auditor': {
    pass: 'No database issues found.\n## Database Audit Summary',
    fail: 'random prose with no findings sentinel and no summary heading',
  },
  'error-handling-auditor': {
    pass: 'No error handling issues found.\n## Error Handling Audit Summary',
    // Finding without the required failure-mode token (CRASH/SILENT/...).
    fail: '### F-ERR-001 details only\n## Error Handling Audit Summary',
  },
  'architecture-auditor': {
    pass: 'No architecture issues found.\n## Architecture Audit Summary',
    fail: '### F-ARCH-001 only — summary section deliberately omitted',
  },
  'api-auditor': {
    pass: 'No API issues found.\n## Endpoint Inventory\n| GET | /x |\n## API Audit Summary',
    // Finding + summary but no Endpoint Inventory.
    fail: '### F-API-001 only\n## API Audit Summary',
  },
  'frontend-auditor': {
    pass: 'No frontend issues found.\n## Frontend Audit Summary',
    fail: 'random prose with no F-FE- finding and no sentinel',
  },
  'performance-auditor': {
    pass: 'No performance issues found.\n## Performance Audit Summary',
    fail: 'random prose with no F-PERF- finding and no sentinel',
  },
  'testing-auditor': {
    // pre-plan mode (smallest legal shape).
    pass: [
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
    ].join('\n'),
    // No mode signal → mode-detection failure.
    fail: '## Random heading\nnothing useful',
  },
  'audit-bug-detector': {
    pass: 'No cross-layer bugs found.\n## Bug Detection Summary',
    // Finding present but Flow section missing.
    fail: '### F-BUG-001 only\n## Bug Detection Summary',
  },
  'integration-checker': {
    pass: [
      '## Integration Check Complete',
      'Integration Audit Summary',
      'Wiring Summary',
      'Connected: 5',
      'Orphaned: 1',
      'Missing: 0',
      'HEALTHY',
      'No integration issues found.',
    ].join('\n'),
    // No health rating enum value present.
    fail: [
      '## Integration Check Complete',
      'Integration Audit Summary',
      'Wiring Summary',
      'Connected: 5',
      'Orphaned: 1',
      'Missing: 0',
      'No integration issues found.',
    ].join('\n'),
  },
  'audit-finding-validator': {
    pass: [
      '### Validation: F-SEC-001',
      'Verdict: CONFIRMED',
      'Confidence: HIGH',
      'File verified: ok',
      'Evidence verified: ok',
      'Reason: matches',
      '## Validation Summary',
      'false positive rate: 0%',
    ].join('\n'),
    // Validation Summary present but false positive rate missing.
    fail: [
      '### Validation: F-SEC-001',
      'Verdict: CONFIRMED',
      'Confidence: HIGH',
      'File verified: ok',
      'Evidence verified: ok',
      'Reason: matches',
      '## Validation Summary',
    ].join('\n'),
  },
  'finding-validator': {
    // Review-pipeline `## Classification` schema (REAL BUG / FALSE POSITIVE /
    // STYLISTIC / DROPPED) — distinct from audit-finding-validator above
    // which uses the audit `### Validation: F-` schema.
    pass: [
      '## Classification',
      '',
      '- **Finding:** F-001',
      '- **Verdict:** REAL BUG',
      '- **Confidence:** HIGH',
      '- **Source Agent:** bug-detector',
      '- **Reason:** The code mishandles the null case.',
    ].join('\n'),
    // Heading + Finding + Confidence + Source Agent + Reason present, but
    // Verdict value out of enum — first-failure-wins on the Verdict check.
    fail: [
      '## Classification',
      '',
      '- **Finding:** F-001',
      '- **Verdict:** MAYBE',
      '- **Confidence:** HIGH',
      '- **Source Agent:** bug-detector',
      '- **Reason:** ambiguous',
    ].join('\n'),
  },
  'implementer': {
    pass: IMPLEMENTER_PASS_TDD,
    // Missing completion marker.
    fail: '# Implementing\n\nSome work happened.\n\n## Done\n\nAll wired up.',
  },
  'quick-implementer': {
    pass: IMPLEMENTER_PASS_TDD,
    fail: '# Implementing\n\nSome work happened.\n\n## Done\n\nAll wired up.',
  },
  'bug-detector': {
    pass: 'No bugs detected.',
    // Heading + severity but no backtick file:line reference.
    fail: '## Bugs Detected\n### Critical\nno backtick refs here',
  },
  'pattern-reviewer': {
    pass: 'No project pattern deviations found.',
    // Heading + sub-items but no backtick file:line reference.
    fail: '## Project Pattern Deviations\n- thing\n**Existing pattern:** x\n**This code:** y\n**Total: 1 deviations**\n**Evidence:** e\n**Impact:** i\n**Test Gap:** t',
  },
  'plan-compliance-reviewer': {
    // plan-review mode is the smallest legal pass shape.
    pass: '## Plan Compliance Review: Phase 1\n### Coverage Matrix\n| REQ-01 | COVERED |',
    // No mode signal detected.
    fail: 'no mode signal here at all',
  },
  'stack-reviewer': {
    pass: 'No stack best practice violations found.',
    // Heading + backtick ref but missing tally line.
    fail: '## Stack Best Practice Violations\n- thing in `f.js:1`',
  },
  'assumptions-analyzer': {
    pass: [
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
    ].join('\n'),
    // All fields present except Confidence (first-failure-wins).
    fail: '## Assumptions\n- a thing\nImpact: High\nRisk: 5 (mitigate)\nMitigation: x\n## Risk Matrix',
  },
  'dependency-auditor': {
    pass: [
      '## Dependency Health Report',
      'no phase-relevant dependencies for this phase',
      '### Summary',
      'Dependencies scanned: 27',
      'Verdict: HEALTHY',
    ].join('\n'),
    // Summary section present but Dependencies scanned count missing.
    fail: '## Dependency Health Report\n### Phase-Relevant Dependencies\n### Summary\nVerdict: HEALTHY',
  },
};

// Sanity: every per-agent slug referenced by any batch validator must have
// a fixture entry. If a future roster edit adds a new slug, this loop
// surfaces the missing FIXTURES key before the first paired-contract case
// runs and emits a confusing "PASS expected, got: {ok:false reason:'transcript
// unreadable'}" diagnostic.
console.log('=== fixture-coverage sanity ===');
{
  const allSlugs = new Set();
  for (const slugs of Object.values(BATCH_PER_INSERTION_AGENT_ROSTER)) {
    for (const slug of slugs) allSlugs.add(slug);
  }
  for (const slug of allSlugs) {
    assert(
      Object.prototype.hasOwnProperty.call(FIXTURES, slug)
        && typeof FIXTURES[slug].pass === 'string'
        && typeof FIXTURES[slug].fail === 'string',
      `FIXTURES has pass/fail entries for per-agent slug: ${slug}`
    );
  }
}

// ---------------------------------------------------------------------------
// runBatchValidator — spawn `node <batchPath>`, feed the batch-validator
// stdin payload, return parsed verdict + raw stdout/status for diagnostic
// surfacing. Mirrors the dispatcher shape that conductor commands use.
// ---------------------------------------------------------------------------
function runBatchValidator(batchScriptName, payload) {
  const batchPath = path.join(BATCH_DIR, batchScriptName);
  const result = spawnSync('node', [batchPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 30000,
  });
  let verdict = null;
  try {
    verdict = JSON.parse(result.stdout);
  } catch (_) {
    /* leave null; assertion will surface the unparseable stdout */
  }
  return { verdict, stdout: result.stdout, stderr: result.stderr, status: result.status };
}

// Build the agent_outputs array for a given roster of slugs, writing one
// transcript per slug. `failSlug` (optional) selects the ONE slug whose
// transcript should use its FAIL fixture; everything else uses PASS.
function buildAgentOutputs(root, slugs, failSlug) {
  return slugs.map((slug, i) => {
    const useFail = failSlug === slug;
    const fixture = useFail ? FIXTURES[slug].fail : FIXTURES[slug].pass;
    const tp = writeTranscript(root, `${slug}-${i}.jsonl`, fixture);
    return { agent: slug, transcript_path: tp, exit_code: 0 };
  });
}

// ---------------------------------------------------------------------------
// Parameterized cases — for each of the 15 batch validators, run the four
// standard scenarios.
// ---------------------------------------------------------------------------

for (const batchScript of BATCH_VALIDATOR_ROSTER) {
  const expectedAgents = BATCH_PER_INSERTION_AGENT_ROSTER[batchScript];
  console.log(`\n=== ${batchScript} (${expectedAgents.length} agents) ===`);

  // Case 1: pass case — marker present, all per-agent transcripts pass.
  {
    const root = makeTmpRoot(true);
    const agentOutputs = buildAgentOutputs(root, expectedAgents, null);
    const payload = { cwd: root, agent_outputs: agentOutputs, expected_count: expectedAgents.length };
    const r = runBatchValidator(batchScript, payload);
    assert(
      r.verdict !== null && r.verdict.ok === true && r.verdict.reason === undefined,
      `${batchScript}: pass case (all ${expectedAgents.length} per-agent transcripts pass) → {"ok":true}`
    );
  }

  // Case 2: fail case — marker present, exactly ONE per-agent transcript fails.
  // The chosen failing slug is the FIRST entry in the roster; the aggregate
  // reason must name it. This case also closes the CI-011 disambiguation gap:
  // if per-agent cwd propagation were broken, the per-agent would skip its
  // structural check and the aggregate would (incorrectly) be {ok:true}.
  {
    const root = makeTmpRoot(true);
    const failSlug = expectedAgents[0];
    const agentOutputs = buildAgentOutputs(root, expectedAgents, failSlug);
    const payload = { cwd: root, agent_outputs: agentOutputs, expected_count: expectedAgents.length };
    const r = runBatchValidator(batchScript, payload);
    const expectedReasonPrefix = `1/${expectedAgents.length} agents failed: ${failSlug}`;
    assert(
      r.verdict !== null
        && r.verdict.ok === false
        && typeof r.verdict.reason === 'string'
        && r.verdict.reason === expectedReasonPrefix,
      `${batchScript}: fail case (1/${expectedAgents.length} per-agent fails — ${failSlug}) → reason "${expectedReasonPrefix}"`
    );
  }

  // Case 3: marker-absent case — no .bee/.autonomous-run-active under tmpRoot.
  // Even when per-agent transcripts WOULD fail their structural check, the
  // marker-skip prelude short-circuits to {ok:true} before any aggregation
  // runs. Use the FAIL fixture for every slug to prove the short-circuit is
  // independent of transcript content.
  {
    const root = makeTmpRoot(false);
    const agentOutputs = expectedAgents.map((slug, i) => {
      const tp = writeTranscript(root, `${slug}-${i}.jsonl`, FIXTURES[slug].fail);
      return { agent: slug, transcript_path: tp, exit_code: 0 };
    });
    const payload = { cwd: root, agent_outputs: agentOutputs, expected_count: expectedAgents.length };
    const r = runBatchValidator(batchScript, payload);
    assert(
      r.verdict !== null && r.verdict.ok === true,
      `${batchScript}: marker-absent case (no .autonomous-run-active marker) → {"ok":true} regardless of per-agent content`
    );
  }

  // Case 4: missing-input fail-closed — marker present, but agent_outputs has
  // FEWER entries than expected_count. The failClosedOnMissing gate must
  // surface the deficit BEFORE any per-agent dispatch runs. Drop the last
  // agent so we have (N-1) delivered / N expected.
  {
    const root = makeTmpRoot(true);
    const droppedExpected = expectedAgents.length;
    const deliveredSlugs = expectedAgents.slice(0, expectedAgents.length - 1);
    // For 1-agent rosters, deliveredSlugs is empty → 0 / 1 case (still
    // missing-input territory, valid for the fail-closed gate).
    const agentOutputs = buildAgentOutputs(root, deliveredSlugs, null);
    const payload = { cwd: root, agent_outputs: agentOutputs, expected_count: droppedExpected };
    const r = runBatchValidator(batchScript, payload);
    const expectedReason = `missing 1 per-agent outputs (expected ${droppedExpected}, got ${droppedExpected - 1})`;
    assert(
      r.verdict !== null
        && r.verdict.ok === false
        && typeof r.verdict.reason === 'string'
        && r.verdict.reason === expectedReason,
      `${batchScript}: missing-input fail-closed (got ${droppedExpected - 1} of ${droppedExpected}) → reason "${expectedReason}"`
    );
  }
}

console.log('');
console.log(`tests: ${passed} passed, ${failed} failed`);

cleanupTmpDirs();
process.exit(failed > 0 ? 1 : 0);
