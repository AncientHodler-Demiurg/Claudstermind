#!/usr/bin/env node
// review-finding-validation.js — batch validator for /bee:review Step 5's
// finding-validator wave (review.md:280-287). Spawns up to 10 finding-validator
// agents in parallel; this script aggregates their per-agent verdicts after
// the wave completes. The finding-validator agent slug resolves to the Phase 1
// per-agent validator `audit-finding-validator.js` via VALIDATOR_ROSTER row 20.
//
// Conductor passes `agent_outputs[i].agent` as the kebab-case slug
// `audit-finding-validator` for each invocation; expected_count equals the
// number of findings dispatched in this batch (≤10 per review.md:284).
//
// Hard Contract: read-only, marker-skip prelude self-exits early, top-level
// try/catch on main() emits a fail verdict and exits 0 on uncaught throw.

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
