#!/usr/bin/env node
// stack-reviewer.js — SubagentStop validator for the stack-reviewer agent
// (generic and stack-prefixed variants both match `stack-reviewer$`).
//
// Ported verbatim from the prompt at plugins/bee/hooks/hooks.json:171.
// Three valid output shapes:
//   - Violations present: `## Stack Best Practice Violations` heading +
//     file:line refs + `**Total: X violations**` tally + Evidence/Impact/Test Gap.
//   - No violations: `No stack best practice violations found.`
//   - Early exit (no stack skill): `no stack skill loaded, skipping`.

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

  if (msg.includes('no stack skill loaded, skipping')) {
    return emitVerdict(true);
  }
  if (msg.includes('No stack best practice violations found.')) {
    return emitVerdict(true);
  }

  if (!msg.includes('## Stack Best Practice Violations')) {
    return emitVerdict(false, "missing '## Stack Best Practice Violations' heading");
  }

  if (!/`[^`\n]+:\d+`/.test(msg)) {
    return emitVerdict(false, 'missing backtick file:line reference');
  }

  if (!/\*\*Total:\s*\d+\s*violations\*\*/i.test(msg)) {
    return emitVerdict(false, "missing total tally line '**Total: X violations**'");
  }

  if (!/\*\*Evidence:\*\*/.test(msg) && !/\bEvidence:/.test(msg)) {
    return emitVerdict(false, 'missing Evidence field on findings');
  }
  if (!/\*\*Impact:\*\*/.test(msg) && !/\bImpact:/.test(msg)) {
    return emitVerdict(false, 'missing Impact field on findings');
  }
  if (!/\*\*Test Gap:\*\*/.test(msg) && !/\bTest Gap:/.test(msg)) {
    return emitVerdict(false, 'missing Test Gap field on findings');
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
