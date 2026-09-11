#!/usr/bin/env node
// fixer.js — SubagentStop validator for the fixer agent.
//
// Ported verbatim from the prompt at plugins/bee/hooks/hooks.json:101.
// Structural checks:
//   1) `Fix Report` section present with Finding ID, Status, Files Changed,
//      What Changed, Tests fields.
//   2) Tests were run after the fix (Tests field mentions results).
//   3) Only ONE finding addressed — exactly one Finding ID occurrence.
// The "if tests failed twice, changes reverted" check from the prompt is a
// behavioral assertion the validator cannot verify structurally — the
// canonical Status field surface (e.g. 'Reverted') is captured by the Status
// requirement.

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

  if (!/\bFix Report\b/.test(msg)) {
    return emitVerdict(false, "missing 'Fix Report' section");
  }

  const required = ['Finding ID', 'Status', 'Files Changed', 'What Changed', 'Tests'];
  for (const field of required) {
    // Match bolded or plain label followed by colon.
    const pattern = new RegExp(field.replace(/ /g, '\\s+') + ':');
    if (!pattern.test(msg)) {
      return emitVerdict(false, "missing field '" + field + "' in Fix Report");
    }
  }

  // Exactly ONE finding addressed. We count Finding ID occurrences.
  const findingMatches = msg.match(/Finding\s+ID:/g) || [];
  if (findingMatches.length !== 1) {
    return emitVerdict(false, 'fixer addressed ' + findingMatches.length + ' findings; must be exactly 1');
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
