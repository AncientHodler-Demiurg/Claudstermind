#!/usr/bin/env node
// review-specialist-escalation.js — batch validator for /bee:review Step 5
// specialist-escalation wave (review.md:288-319). Per the Q4 resolution
// (TASKS.md research note for T2.5) and review.md:290, specialist escalation
// re-spawns the `finding-validator` agent for a second opinion — NOT the
// source specialist agents (those have SubagentStop hooks expecting standard
// output format, not escalation format).
//
// Per-agent set is therefore N invocations of `audit-finding-validator`
// (identical roster to review-finding-validation.js; separate batch script
// because the insertion point + expected_count source are distinct, which
// keeps T2.10 paired-contract dispatch unambiguous).
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
