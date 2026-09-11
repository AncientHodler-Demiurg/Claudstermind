#!/usr/bin/env node
// ship-per-wave.js — batch validator for /bee:ship Step 3a.4 (per-wave
// parallel implementer spawn at ship.md:323-331). Dispatches per-agent
// validators for the implementer / quick-implementer / stack-prefixed
// implementer agents spawned in the current wave, aggregates the per-agent
// verdicts, and emits a single batch verdict.
//
// Per-agent set (BATCH_PER_INSERTION_AGENT_ROSTER['ship-per-wave.js']):
//   implementer, quick-implementer. Stack-prefixed forms (e.g. laravel-
//   implementer) route to the same validator filenames via REQ-02 non-anchored
//   matchers; the parent command MUST pass the un-prefixed slug in
//   agent_outputs[i].agent.
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
