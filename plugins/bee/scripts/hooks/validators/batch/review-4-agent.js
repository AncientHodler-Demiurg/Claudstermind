#!/usr/bin/env node
// review-4-agent.js — batch validator for /bee:review Step 4.2's parallel
// 4-agent review spawn (review.md:210-285). The conductor invokes this script
// after the wave of bug-detector / pattern-reviewer / plan-compliance-reviewer
// / stack-reviewer agents completes; the script dispatches each agent's
// transcript through its matching per-agent validator and emits a single
// aggregate verdict.
//
// Multi-stack projects spawn (3 × N) + 1 review agents per ship.md/review.md
// preservation of the Phase 1 non-anchored matcher regex (REQ-02). Stack
// prefixes (e.g. `laravel-stack-reviewer`) map to the same `stack-reviewer.js`
// validator via the `<agent>.js` resolution below — `expected_count` arrives
// from the conductor and reflects the actual spawned roster size.
//
// Hard Contract: read-only (no fs.write), self-exits early when the autonomous
// marker is absent (markerSkipPrelude), wraps main() in a top-level try/catch
// that emits a fail verdict and exits 0 on uncaught throw.

'use strict';

const {
  readBatchPayload,
  markerSkipPrelude,
  failClosedOnMissing,
  runPerAgentValidator,
  aggregateVerdict,
  emitBatchVerdict,
  resolveValidatorPath,
} = require('../batch-lib');

function main() {
  const payload = readBatchPayload();
  if (!payload) {
    emitBatchVerdict(false, 'malformed stdin payload');
    return;
  }

  markerSkipPrelude(payload);

  const fcm = failClosedOnMissing(payload.agent_outputs, payload.expected_count);
  if (fcm) {
    emitBatchVerdict(false, fcm.reason);
    return;
  }

  const results = payload.agent_outputs.map((out) => {
    const validatorPath = resolveValidatorPath(out.agent);
    const r = runPerAgentValidator(validatorPath, out.transcript_path, payload.cwd);
    return { agent: out.agent, ok: r.ok, reason: r.reason };
  });

  const verdict = aggregateVerdict(results);
  emitBatchVerdict(verdict.ok, verdict.reason);
}

try {
  main();
} catch (err) {
  emitBatchVerdict(false, 'batch validator threw: ' + (err && err.message ? err.message : String(err)));
}
process.exit(0);
