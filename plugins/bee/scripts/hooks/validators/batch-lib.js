// batch-lib.js — shared helpers for the 15 batch validator scripts at
// plugins/bee/scripts/hooks/validators/batch/<insertion>.js.
//
// Each batch validator dispatches a fixed roster of per-agent validators
// (BATCH_PER_INSERTION_AGENT_ROSTER) over the agent_outputs delivered by the
// parent command's parallel-spawn wave, aggregates the per-agent verdicts,
// and emits a single batch verdict on stdout.
//
// CANONICAL CALL SHAPE (each batch script):
//   const lib = require('../batch-lib.js');
//   const payload = lib.readBatchPayload();
//   lib.markerSkipPrelude(payload);              // self-exits if not autonomous run
//   const fcm = lib.failClosedOnMissing(payload.agent_outputs, payload.expected_count);
//   if (fcm) { lib.emitBatchVerdict(false, fcm.reason); process.exit(0); }
//   const results = payload.agent_outputs.map((o) => {
//     const validatorPath = lib.resolveValidatorPath(o.agent);
//     const r = lib.runPerAgentValidator(validatorPath, o.transcript_path, payload.cwd);
//     return { agent: o.agent, ok: r.ok, reason: r.reason };
//   });
//   const verdict = lib.aggregateVerdict(results);
//   lib.emitBatchVerdict(verdict.ok, verdict.reason);
//
// HARD CONTRACTS (per cross-plan F-CP-001 through F-CP-011):
//   - Conductor-sole-writer: NO filesystem-write calls (write/append). Verdict
//     emission is via process.stdout.write through emitBatchVerdict (which
//     re-exports validators-lib.emitVerdict).
//   - markerSkipPrelude(payload) is SELF-EXITING; callers invoke as a bare
//     statement-expression `markerSkipPrelude(payload);` (no assignment, no
//     predicate). T2.10 audits this with regex
//     /^\s*markerSkipPrelude\s*\(\s*payload\s*\)\s*;\s*$/m.
//   - runPerAgentValidator maps spawn outcomes to FOUR distinct fail reasons:
//       ENOENT                          → "validator file not found: <agent>"
//       status 0 + empty/malformed JSON → "validator produced no verdict: <agent>"
//       status null + signal            → "validator timed out: <agent> (>5000ms)"
//       any other non-zero exit         → "validator crashed: <agent> (exit <code>)"
//   - aggregateVerdict input shape requires `agent` field on every entry;
//     failing-agent names are listed in the fail reason.
//
// Imports from validators-lib.js (sibling module): six bindings — three used
// directly here and three forwarded to batch-script callers via this lib's
// `markerSkipPrelude` / `emitBatchVerdict` / payload-parsing surface.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  readStdinSync,
  safeJsonParse,
  resolveRoot,         // eslint-disable-line no-unused-vars
  autoModeActive,
  emitVerdict,
  VALIDATOR_ROSTER,    // eslint-disable-line no-unused-vars
} = require('./validators-lib.js');

const PER_AGENT_VALIDATOR_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// readBatchPayload — reads stdin JSON via the Phase 1 helpers. Returns the
// parsed payload or null on malformed input. Callers MUST handle null with
// a fail-closed emit (e.g. emitBatchVerdict(false, 'malformed stdin payload')).
// Expected shape:
//   { cwd, agent_outputs: [{agent, transcript_path, exit_code}, ...], expected_count }
// ---------------------------------------------------------------------------
function readBatchPayload() {
  return safeJsonParse(readStdinSync());
}

// ---------------------------------------------------------------------------
// aggregateVerdict — collapse per-agent results into a single batch verdict.
// Input shape (REQUIRED): Array<{ agent: string, ok: boolean, reason?: string }>.
// The `agent` field is read to list failing agent names in the fail reason —
// without it the conductor cannot route fixes (cross-plan F-CP-002).
// Returns: {ok:true} on all-pass; {ok:false, reason: "<n>/<total> agents
// failed: <comma-separated names>"} otherwise.
// ---------------------------------------------------------------------------
function aggregateVerdict(perAgentResults) {
  if (!Array.isArray(perAgentResults) || perAgentResults.length === 0) {
    return { ok: true };
  }
  const failing = perAgentResults.filter((r) => r && r.ok !== true);
  if (failing.length === 0) return { ok: true };
  const names = failing.map((r) => (r && typeof r.agent === 'string' ? r.agent : 'unknown')).join(', ');
  const reason = `${failing.length}/${perAgentResults.length} agents failed: ${names}`;
  return { ok: false, reason };
}

// ---------------------------------------------------------------------------
// failClosedOnMissing — pre-aggregation gate that fails the batch when fewer
// agent outputs were delivered than expected, or any delivered output has an
// unreadable transcript_path. Returns null when inputs are complete; returns
// a fail verdict otherwise. The conductor surfaces silent partial-batch
// drops (e.g. Task tool crashed for 2/5 spawns) through this gate.
// ---------------------------------------------------------------------------
function failClosedOnMissing(agentOutputs, expectedCount) {
  const actual = Array.isArray(agentOutputs) ? agentOutputs.length : 0;
  if (actual < expectedCount) {
    const missing = expectedCount - actual;
    return {
      ok: false,
      reason: `missing ${missing} per-agent outputs (expected ${expectedCount}, got ${actual})`,
    };
  }
  for (const out of agentOutputs) {
    if (!out || typeof out.transcript_path !== 'string' || out.transcript_path.length === 0) {
      return {
        ok: false,
        reason: `missing transcript_path on agent output (agent=${out && out.agent ? out.agent : 'unknown'})`,
      };
    }
    try {
      fs.statSync(out.transcript_path);
    } catch (_) {
      return {
        ok: false,
        reason: `unreadable transcript_path: ${out.transcript_path} (agent=${out.agent || 'unknown'})`,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// agentSlugFromValidatorPath — derive the agent slug from a validator file
// path for inclusion in error reasons. The slug is the basename without
// the .js extension so reasons read like "validator crashed: bug-detector
// (exit 7)" not ".../bug-detector.js (exit 7)".
// ---------------------------------------------------------------------------
function agentSlugFromValidatorPath(validatorPath) {
  const base = path.basename(validatorPath || '');
  return base.endsWith('.js') ? base.slice(0, -3) : base;
}

// ---------------------------------------------------------------------------
// resolveValidatorPath — resolve an agent slug to its per-agent validator
// script path under validators/. Batch scripts live in validators/batch/, so
// the validator file is one directory up: validators/<slug>.js. Stack-prefixed
// slugs (e.g. `laravel-stack-reviewer`) MUST be pre-normalized by the
// conductor to the un-prefixed validator filename before reaching this helper
// — REQ-02 non-anchored matchers handle prefix routing at the matcher layer,
// not here. Centralized so the 15 batch scripts share one resolution surface
// and tests can stub it uniformly.
// ---------------------------------------------------------------------------
function resolveValidatorPath(agentSlug) {
  return path.resolve(__dirname, agentSlug + '.js');
}

// ---------------------------------------------------------------------------
// runPerAgentValidator — spawn `node <validatorPath>`, feed the SubagentStop
// payload as stdin, return the parsed verdict. 5000ms timeout.
//
// Returns one of (all `{ok: boolean, reason?: string}`):
//   - happy:    parsed stdout verdict (caller receives validator's own verdict).
//   - ENOENT:   {ok:false, reason: "validator file not found: <agent>"}
//   - empty:    {ok:false, reason: "validator produced no verdict: <agent>"}
//   - timeout:  {ok:false, reason: "validator timed out: <agent> (>5000ms)"}
//   - crash:    {ok:false, reason: "validator crashed: <agent> (exit <code>)"}
//
// The four error reasons map to distinct CI surfaces (Phase 1 deliverable
// missing / catch-handler regression / runaway transcript / uncaught throw).
// Conflating them obscures the diagnosis path; do not collapse.
// ---------------------------------------------------------------------------
function runPerAgentValidator(validatorPath, transcriptPath, cwd) {
  const agent = agentSlugFromValidatorPath(validatorPath);
  // Detect ENOENT on the validator script file BEFORE spawning node: when
  // `node` is invoked with a missing script path, node itself runs (it exists
  // on PATH) and exits 1 after printing "Cannot find module ..." to stderr —
  // result.error.code is NOT ENOENT in that case, so the spawn outcome would
  // be indistinguishable from a real validator crash. Probing existsSync up
  // front gives us the distinct "file not found" reason the contract requires.
  if (!fs.existsSync(validatorPath)) {
    return { ok: false, reason: `validator file not found: ${agent}` };
  }
  const stdin = JSON.stringify({ transcript_path: transcriptPath, cwd });
  const result = spawnSync('node', [validatorPath], {
    input: stdin,
    encoding: 'utf8',
    timeout: PER_AGENT_VALIDATOR_TIMEOUT_MS,
  });

  if (result.error && result.error.code === 'ENOENT') {
    return { ok: false, reason: `validator file not found: ${agent}` };
  }
  if (result.status === null && result.signal) {
    return {
      ok: false,
      reason: `validator timed out: ${agent} (>${PER_AGENT_VALIDATOR_TIMEOUT_MS}ms)`,
    };
  }
  if (result.status !== 0) {
    return { ok: false, reason: `validator crashed: ${agent} (exit ${result.status})` };
  }
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  if (!stdout.trim()) {
    return { ok: false, reason: `validator produced no verdict: ${agent}` };
  }
  const verdict = safeJsonParse(stdout);
  if (!verdict || typeof verdict.ok !== 'boolean') {
    return { ok: false, reason: `validator produced no verdict: ${agent}` };
  }
  return verdict;
}

// ---------------------------------------------------------------------------
// emitBatchVerdict — re-export of validators-lib.emitVerdict for batch-script
// symmetry. The stdout contract is identical (single JSON object, no trailing
// newline; reason omitted on pass).
// ---------------------------------------------------------------------------
function emitBatchVerdict(ok, reason) {
  emitVerdict(ok, reason);
}

// ---------------------------------------------------------------------------
// markerSkipPrelude — SELF-EXITING helper. When the Auto-Mode Marker
// (.bee/.autonomous-run-active) is absent under the payload's resolved root,
// the validator MUST emit {ok:true} and exit 0 immediately (REQ-10 base
// inclusion semantics: validators only run during autonomous executions).
//
// Callers invoke as a bare statement-expression: `markerSkipPrelude(payload);`
// — NO assignment, NO predicate. The canonical call form is asserted by
// T2.10's audit regex: /^\s*markerSkipPrelude\s*\(\s*payload\s*\)\s*;\s*$/m.
// ---------------------------------------------------------------------------
function markerSkipPrelude(payload) {
  if (!autoModeActive(payload)) {
    emitBatchVerdict(true);
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// BATCH_VALIDATOR_ROSTER — 15 batch validator script filenames, one per
// REQ-09 insertion point across 7 parent commands. Single source of truth
// consumed by T2.9 (no-write static scan) and T2.10 (parameterized paired-
// contract test + integration grep).
// ---------------------------------------------------------------------------
const BATCH_VALIDATOR_ROSTER = [
  // /bee:audit (2)
  'audit-parallel-auditors.js',
  'audit-finding-validation.js',
  // /bee:ship (3)
  'ship-per-wave.js',
  'ship-per-phase-review.js',
  'ship-finding-validation.js',
  // /bee:execute-phase (1)
  'execute-phase-wave.js',
  // /bee:review (3)
  'review-4-agent.js',
  'review-finding-validation.js',
  'review-specialist-escalation.js',
  // /bee:review-implementation (3)
  'review-implementation-4-agent.js',
  'review-implementation-finding-validation.js',
  'review-implementation-specialist-escalation.js',
  // /bee:plan-phase (1)
  'plan-phase-analyzers.js',
  // /bee:plan-all (2)
  'plan-all-per-phase.js',
  'plan-all-cross-plan.js',
];

// ---------------------------------------------------------------------------
// BATCH_VALIDATOR_INSERTION_POINTS — parent command → list of insertion-point
// script paths (relative to validators/). Asserts the 7-command / 15-script
// distribution at the conductor edit layer (T2.6/T2.7/T2.8 invoke these
// scripts; the map is the canonical path source).
// ---------------------------------------------------------------------------
const BATCH_VALIDATOR_INSERTION_POINTS = {
  'audit.md': [
    'validators/batch/audit-parallel-auditors.js',
    'validators/batch/audit-finding-validation.js',
  ],
  'ship.md': [
    'validators/batch/ship-per-wave.js',
    'validators/batch/ship-per-phase-review.js',
    'validators/batch/ship-finding-validation.js',
  ],
  'execute-phase.md': ['validators/batch/execute-phase-wave.js'],
  'review.md': [
    'validators/batch/review-4-agent.js',
    'validators/batch/review-finding-validation.js',
    'validators/batch/review-specialist-escalation.js',
  ],
  'review-implementation.md': [
    'validators/batch/review-implementation-4-agent.js',
    'validators/batch/review-implementation-finding-validation.js',
    'validators/batch/review-implementation-specialist-escalation.js',
  ],
  'plan-phase.md': ['validators/batch/plan-phase-analyzers.js'],
  'plan-all.md': [
    'validators/batch/plan-all-per-phase.js',
    'validators/batch/plan-all-cross-plan.js',
  ],
};

// ---------------------------------------------------------------------------
// BATCH_PER_INSERTION_AGENT_ROSTER — batch script → list of per-agent slugs
// that batch dispatches. Each slug resolves to <validators>/<slug>.js
// (Phase 1 VALIDATOR_ROSTER). The count per batch is the `expected_count`
// the conductor passes in the stdin payload (used by failClosedOnMissing).
//
// audit-parallel-auditors.js: 10 agents per audit.md:102 premium-mode default
//   (8 audit-family + audit-bug-detector + integration-checker). EXCLUDES
//   swarm-consolidator and audit-report-generator — those are serial
//   post-batch agents, not parallel auditors.
// review-implementation-4-agent.js: 5 agents (full-spec mode adds
//   audit-bug-detector to the standard 4-agent block).
// plan-all-cross-plan.js: 3 agents per v4.4.0 cross-plan upgrade.
// ---------------------------------------------------------------------------
const BATCH_PER_INSERTION_AGENT_ROSTER = {
  'audit-parallel-auditors.js': [
    'security-auditor',
    'database-auditor',
    'error-handling-auditor',
    'architecture-auditor',
    'api-auditor',
    'frontend-auditor',
    'performance-auditor',
    'testing-auditor',
    'audit-bug-detector',
    'integration-checker',
  ],
  'audit-finding-validation.js': ['audit-finding-validator'],
  'ship-per-wave.js': ['implementer', 'quick-implementer'],
  'ship-per-phase-review.js': [
    'bug-detector',
    'pattern-reviewer',
    'plan-compliance-reviewer',
    'stack-reviewer',
  ],
  // F-BUG-001: ship/review dispatch sites spawn `finding-validator` (review
  // pipeline's `## Classification` schema), NOT `audit-finding-validator`
  // (audit pipeline's `### Validation: F-` schema). The two agents have
  // disjoint schemas; routing through the wrong validator HALTs autonomous
  // ship/review runs at the first finding-validation step. Only the
  // audit-finding-validation.js batch (above) remains on audit-finding-validator.
  'ship-finding-validation.js': ['finding-validator'],
  'execute-phase-wave.js': ['implementer', 'quick-implementer'],
  'review-4-agent.js': [
    'bug-detector',
    'pattern-reviewer',
    'plan-compliance-reviewer',
    'stack-reviewer',
  ],
  'review-finding-validation.js': ['finding-validator'],
  'review-specialist-escalation.js': ['finding-validator'],
  'review-implementation-4-agent.js': [
    'bug-detector',
    'pattern-reviewer',
    'plan-compliance-reviewer',
    'stack-reviewer',
    'audit-bug-detector',
  ],
  'review-implementation-finding-validation.js': ['finding-validator'],
  'review-implementation-specialist-escalation.js': ['finding-validator'],
  'plan-phase-analyzers.js': ['assumptions-analyzer', 'dependency-auditor', 'testing-auditor'],
  'plan-all-per-phase.js': [
    'bug-detector',
    'pattern-reviewer',
    'plan-compliance-reviewer',
    'stack-reviewer',
  ],
  'plan-all-cross-plan.js': ['plan-compliance-reviewer', 'bug-detector', 'audit-bug-detector'],
};

// ---------------------------------------------------------------------------
// BATCH_PER_INSERTION_CONDITIONAL_MEMBERS — per-batch agents that are spawned
// ONLY WHEN a runtime gate fires, NOT on every run. Kept SEPARATE from
// BATCH_PER_INSERTION_AGENT_ROSTER (whose entries are the always-spawned
// members) so the always-spawned roster lengths stay invariant: review-4-agent.js
// stays 4 and review-implementation-4-agent.js stays 5. The conductor adds the
// conditional member to its spawned set AND increments the stdin expected_count
// by 1 ONLY when the gate fires; when it does not fire, the spawned set and
// expected_count are byte-for-byte unchanged.
//
// architecture-auditor — spawned ONCE globally into the per-phase review run
// (review.md and review-implementation.md full-spec) when the net-new-subsystem
// trigger (`net-new subsystem: yes`, owned by pattern-reviewer.md) is detected
// for the executed phase(s). It performs a structural CODE audit, so it is wired
// only into post-implementation review — never plan-review (no code exists yet).
// The slug resolves to <validators>/architecture-auditor.js (already in
// VALIDATOR_ROSTER), so the batch dispatcher routes it with no script change.
// ---------------------------------------------------------------------------
const BATCH_PER_INSERTION_CONDITIONAL_MEMBERS = {
  'review-4-agent.js': ['architecture-auditor'],
  'review-implementation-4-agent.js': ['architecture-auditor'],
};

module.exports = {
  readBatchPayload,
  aggregateVerdict,
  failClosedOnMissing,
  runPerAgentValidator,
  emitBatchVerdict,
  markerSkipPrelude,
  resolveValidatorPath,
  BATCH_VALIDATOR_ROSTER,
  BATCH_VALIDATOR_INSERTION_POINTS,
  BATCH_PER_INSERTION_AGENT_ROSTER,
  BATCH_PER_INSERTION_CONDITIONAL_MEMBERS,
};
