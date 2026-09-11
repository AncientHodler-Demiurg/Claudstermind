#!/usr/bin/env node
// assumptions-analyzer.js — SubagentStop validator for assumptions-analyzer.
//
// Ported verbatim from plugins/bee/hooks/hooks.json:121.
// Structural checks:
//   1) `## Assumptions` heading.
//   2) `Confidence:` field with value Confident / Likely / Unclear.
//   3) Each assumption cites at least one file path (we verify presence of
//      at least one path-like token in the message).
//   4) `Impact:` field with Low / Medium / High value.
//   5) `Risk:` field with numeric score and parenthesized action.
//   6) `Mitigation:` field present.
//   7) `## Risk Matrix` section present.

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

  if (!msg.includes('## Assumptions')) {
    return emitVerdict(false, "missing '## Assumptions' heading");
  }

  if (!/Confidence:\s*(Confident|Likely|Unclear)\b/i.test(msg)) {
    return emitVerdict(false, "missing 'Confidence:' field with value Confident/Likely/Unclear");
  }

  // File-path citation: detect a path-like token with at least one slash
  // and a file extension OR a known dir.
  const pathLike = /[`(\s][\w./-]+\.[a-zA-Z]{1,6}[\s`):,]/.test(msg) ||
    /\b(plugins|src|app|tests|scripts|\.bee)\/[\w./-]+/.test(msg);
  if (!pathLike) {
    return emitVerdict(false, 'no file path citation found in assumptions');
  }

  if (!/Impact:\s*(Low|Medium|High)\b/i.test(msg)) {
    return emitVerdict(false, "missing 'Impact:' field with value Low/Medium/High");
  }

  // Risk: numeric score followed by parenthesized action, e.g. `Risk: 7 (escalate)`.
  if (!/Risk:\s*\d+\s*\(/.test(msg)) {
    return emitVerdict(false, "missing 'Risk:' field with numeric score and (action)");
  }

  if (!/Mitigation:\s*\S/.test(msg)) {
    return emitVerdict(false, "missing 'Mitigation:' field with concrete action");
  }

  if (!msg.includes('## Risk Matrix')) {
    return emitVerdict(false, "missing '## Risk Matrix' section");
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
