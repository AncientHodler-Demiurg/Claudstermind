#!/usr/bin/env node
// review-implementation-4-agent.js — batch validator for /bee:review-
// implementation Step 4.7's parallel review spawn (review-implementation.md
// :304-305). Mirrors review-4-agent.js but adds `audit-bug-detector` to the
// roster in full-spec mode (per review-implementation.md:38, full-spec spawns
// 5 agents: 3 per-stack + plan-compliance-reviewer + audit-bug-detector;
// ad-hoc mode at :47 spawns only 3 per-stack agents).
//
// The conductor passes `expected_count` reflecting the actual spawn count
// (5 in full spec, 3 in ad-hoc, or (3 × N) + 1 + 1 in multi-stack full spec).
// Each `output.agent` slug resolves to its matching per-agent validator via
// `<agent>.js`; multi-stack prefixes (e.g. `laravel-bug-detector`) match the
// Phase 1 non-anchored matcher regexes (REQ-02).
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
