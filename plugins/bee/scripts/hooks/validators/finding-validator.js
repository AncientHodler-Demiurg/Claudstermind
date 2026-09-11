#!/usr/bin/env node
// finding-validator.js — SubagentStop validator for the finding-validator agent
// (matcher: ^finding-validator$, exact match — the agent name is unique).
//
// Ported from plugins/bee/agents/finding-validator.md:65-79.
// Distinct from audit-finding-validator.js: this validator targets the review
// pipeline's `## Classification` schema (REAL BUG | FALSE POSITIVE | STYLISTIC
// | DROPPED), whereas audit-finding-validator.js targets the audit pipeline's
// `### Validation: F-` schema (CONFIRMED | FALSE POSITIVE | NEEDS CONTEXT).
//
// Structural checks:
//   1) `## Classification` heading present.
//   2) `Finding: F-` followed by an ID.
//   3) `Verdict:` followed by one of REAL BUG | FALSE POSITIVE | STYLISTIC | DROPPED.
//   4) `Confidence:` followed by HIGH | MEDIUM.
//   5) `Source Agent:` field present.
//   6) For non-DROPPED verdicts: `Reason:` field present.
//
// Hard contract per validators-lib.js: emit exactly one JSON verdict, never
// throw, always exit 0. The top-level catch handler MUST emit a verdict
// BEFORE exiting (CI-001 cross-plan rule) so the aggregator never sees an
// empty stdout from an in-band exception.

'use strict';

const {
  readStdinSync,
  safeJsonParse,
  autoModeActive,
  readLastAssistantMessage,
  emitVerdict,
} = require('./validators-lib.js');

function main(rawInput) {
  const payload = safeJsonParse(typeof rawInput === 'string' ? rawInput : readStdinSync());

  if (!autoModeActive(payload)) {
    return emitVerdict(true);
  }

  if (!payload || typeof payload.transcript_path !== 'string') {
    return emitVerdict(false, 'invalid SubagentStop payload (missing transcript_path)');
  }

  const msg = readLastAssistantMessage(payload.transcript_path);
  if (msg === null) {
    return emitVerdict(false, 'transcript_path unreadable');
  }
  if (msg.length === 0) {
    return emitVerdict(false, 'empty assistant message');
  }

  if (!/^##\s+Classification\b/m.test(msg)) {
    return emitVerdict(false, "missing '## Classification' heading");
  }

  // The agent prompt at finding-validator.md:71-78 emits field labels with
  // markdown bold (`- **Finding:** F-NNN`), so each field regex tolerates an
  // optional `**` between the label and the colon, then arbitrary whitespace
  // and optional bold/emphasis runs between the colon and the value.
  if (!/\bFinding:\**\s*\**\s*F-/.test(msg)) {
    return emitVerdict(false, "missing 'Finding: F-' identifier");
  }

  const verdictMatch = /\bVerdict:\**\s*\**\s*(REAL BUG|FALSE POSITIVE|STYLISTIC|DROPPED)\b/.exec(msg);
  if (!verdictMatch) {
    return emitVerdict(false, "missing 'Verdict:' value (REAL BUG / FALSE POSITIVE / STYLISTIC / DROPPED)");
  }

  if (!/\bConfidence:\**\s*\**\s*(HIGH|MEDIUM)\b/.test(msg)) {
    return emitVerdict(false, "missing 'Confidence:' value (HIGH / MEDIUM)");
  }

  if (!/\bSource Agent:/i.test(msg)) {
    return emitVerdict(false, "missing 'Source Agent:' field");
  }

  if (verdictMatch[1] !== 'DROPPED' && !/\bReason:/i.test(msg)) {
    return emitVerdict(false, "missing 'Reason:' field");
  }

  return emitVerdict(true);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    emitVerdict(false, 'validator threw: ' + (err && err.message ? err.message : String(err)));
  }
  process.exit(0);
}

module.exports = { main };
