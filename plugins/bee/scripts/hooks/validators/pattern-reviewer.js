#!/usr/bin/env node
// pattern-reviewer.js — SubagentStop validator for the pattern-reviewer agent
// (generic and stack-prefixed variants both match `pattern-reviewer$`).
//
// Ported verbatim from the prompt at plugins/bee/hooks/hooks.json:151.
// Structural checks:
//   1) `## Project Pattern Deviations` heading OR
//      `No project pattern deviations found.` message.
//   2) Each deviation includes `**Existing pattern:**` and `**This code:**`.
//   3) file:line backtick references present.
//   4) `**Total: X deviations**` tally OR no-findings message used.
//   5) Each finding includes Evidence, Impact, Test Gap fields.

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

  if (msg.includes('No project pattern deviations found.')) {
    return emitVerdict(true);
  }

  if (!msg.includes('## Project Pattern Deviations')) {
    return emitVerdict(false, "missing '## Project Pattern Deviations' heading");
  }

  if (!msg.includes('**Existing pattern:**')) {
    return emitVerdict(false, "missing '**Existing pattern:**' sub-item");
  }
  if (!msg.includes('**This code:**')) {
    return emitVerdict(false, "missing '**This code:**' sub-item");
  }

  if (!/`[^`\n]+:\d+`/.test(msg)) {
    return emitVerdict(false, 'missing backtick file:line reference');
  }

  if (!/\*\*Total:\s*\d+\s*deviations\*\*/i.test(msg)) {
    return emitVerdict(false, "missing total tally line '**Total: X deviations**'");
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
