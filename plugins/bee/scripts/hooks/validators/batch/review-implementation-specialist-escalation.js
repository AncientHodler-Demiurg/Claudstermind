#!/usr/bin/env node
// review-implementation-specialist-escalation.js — batch validator for
// /bee:review-implementation Step 6.1's specialist-escalation wave (review-
// implementation.md:400-431). Identical pattern to review-specialist-
// escalation.js: escalation re-spawns the `finding-validator` agent for a
// second opinion (NOT different specialist agents — see Q4 resolution in
// TASKS.md T2.5 research and review.md:290).
//
// Per-agent set is N invocations of `audit-finding-validator`. Separate batch
// script because the insertion point + expected_count source are distinct
// from the primary review-implementation-finding-validation wave.
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
