#!/usr/bin/env node
// review-implementation-finding-validation.js — batch validator for
// /bee:review-implementation Step 6.1's finding-validator wave (review-
// implementation.md:392-398). Mirrors review-finding-validation.js: spawns
// up to 10 finding-validator agents in parallel and routes each transcript
// through `audit-finding-validator.js` (VALIDATOR_ROSTER row 20).
//
// Separate file from review-finding-validation.js because the insertion point
// + expected_count source differ (review-implementation reports findings from
// the full-spec/ad-hoc review pass, not the standalone review pass). Test
// parsimony (T2.10 paired-contract) prefers one batch script per insertion
// point over a shared parameterized invocation.
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
