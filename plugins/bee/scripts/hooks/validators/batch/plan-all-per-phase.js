#!/usr/bin/env node
// plan-all-per-phase.js — batch validator for /bee:plan-all Step 3f.2
// per-phase 4-agent plan-review (plan-all.md:234-236). Dispatches the same
// 4-agent roster as ship-per-phase-review.js (bug-detector + pattern-reviewer
// + plan-compliance-reviewer + stack-reviewer; plan-compliance-reviewer.js is
// multi-mode and validates the plan-review-mode output shape per Phase 1 T1.3),
// aggregates the per-agent verdicts, and emits a single batch verdict.
//
// Hard contracts (cross-plan F-CP-001..F-CP-011):
//   - Conductor-sole-writer: no filesystem-write calls anywhere in this script.
//   - markerSkipPrelude(payload) is a bare statement-expression; the helper
//     self-exits with {ok:true} when the Auto-Mode Marker is absent.
//   - Top-level try/catch ensures emit-before-exit on any uncaught throw.

'use strict';

const {
  readBatchPayload,
  aggregateVerdict,
  failClosedOnMissing,
  runPerAgentValidator,
  emitBatchVerdict,
  markerSkipPrelude,
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

  const perAgentResults = payload.agent_outputs.map((output) => {
    const validatorPath = resolveValidatorPath(output.agent);
    const verdict = runPerAgentValidator(validatorPath, output.transcript_path, payload.cwd);
    return { agent: output.agent, ok: verdict.ok, reason: verdict.reason };
  });

  const aggregate = aggregateVerdict(perAgentResults);
  emitBatchVerdict(aggregate.ok, aggregate.reason);
}

try {
  main();
} catch (err) {
  emitBatchVerdict(false, 'batch validator threw: ' + (err && err.message ? err.message : String(err)));
}
process.exit(0);
