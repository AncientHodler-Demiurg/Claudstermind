#!/usr/bin/env node
// audit-finding-validator.js — SubagentStop validator for audit-finding-validator.
//
// Ported verbatim from plugins/bee/hooks/hooks.json:301.
// Structural checks:
//   1) `### Validation: F-` per entry.
//   2) Verdict value CONFIRMED / FALSE POSITIVE / NEEDS CONTEXT.
//   3) Confidence HIGH / MEDIUM.
//   4) File verified / Evidence verified / Reason fields present.
//   5) `## Validation Summary` section with total + per-verdict counts and
//      false positive rate.

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

  if (!/###\s+Validation:\s+F-/.test(msg)) {
    return emitVerdict(false, "missing '### Validation: F-' entry heading");
  }

  if (!/Verdict:\s*(CONFIRMED|FALSE POSITIVE|NEEDS CONTEXT)\b/.test(msg)) {
    return emitVerdict(false, "missing 'Verdict:' value (CONFIRMED / FALSE POSITIVE / NEEDS CONTEXT)");
  }

  if (!/Confidence:\s*(HIGH|MEDIUM)\b/.test(msg)) {
    return emitVerdict(false, "missing 'Confidence:' value (HIGH / MEDIUM)");
  }

  if (!/File verified/i.test(msg)) {
    return emitVerdict(false, "missing 'File verified' field");
  }
  if (!/Evidence verified/i.test(msg)) {
    return emitVerdict(false, "missing 'Evidence verified' field");
  }
  if (!/\bReason:/i.test(msg)) {
    return emitVerdict(false, "missing 'Reason:' field");
  }

  if (!msg.includes('## Validation Summary')) {
    return emitVerdict(false, "missing '## Validation Summary' section");
  }
  if (!/false positive rate/i.test(msg)) {
    return emitVerdict(false, "missing 'false positive rate' in Validation Summary");
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
