#!/usr/bin/env node
// error-handling-auditor.js — SubagentStop Node validator for the
// error-handling-auditor agent.
//
// Translation of the prompt block at plugins/bee/hooks/hooks.json:221. Loads
// the agent's last assistant message from the transcript JSONL and asserts
// the audit-finding schema plus an explicit failure-mode token.
//
// Hard contract: see validators-lib.js header. emit verdict, exit 0 always,
// catch handler emits failure verdict before exit (CI-001 cross-plan fix).

'use strict';

const {
  readStdinSync,
  safeJsonParse,
  autoModeActive,
  readLastAssistantMessage,
  emitVerdict,
} = require('./validators-lib.js');

const FAILURE_MODES = ['CRASH', 'SILENT FAILURE', 'DATA LOSS', 'DEGRADED UX'];

function main(rawInput) {
  const payload = safeJsonParse(typeof rawInput === 'string' ? rawInput : readStdinSync());

  if (!autoModeActive(payload)) {
    return emitVerdict(true);
  }

  if (!payload || typeof payload.transcript_path !== 'string') {
    return emitVerdict(false, 'invalid SubagentStop payload (missing transcript_path)');
  }

  const msg = readLastAssistantMessage(payload.transcript_path);
  if (msg === null) return emitVerdict(false, 'transcript_path unreadable');
  if (msg.length === 0) return emitVerdict(false, 'empty assistant message');

  const hasFindings = msg.includes('### F-ERR-');
  const hasNoFindingsSentinel = msg.includes('No error handling issues found.');
  if (!hasFindings && !hasNoFindingsSentinel) {
    return emitVerdict(
      false,
      "missing audit findings: expected '### F-ERR-' entries or 'No error handling issues found.' sentinel"
    );
  }

  // If findings are present, at least one failure-mode token must appear so
  // every finding's failure-mode field is documented. The sentinel path skips
  // this check (no findings → no failure-mode tagging required).
  if (hasFindings) {
    const matched = FAILURE_MODES.some((mode) => msg.includes(mode));
    if (!matched) {
      return emitVerdict(
        false,
        "findings present but no failure-mode token (CRASH / SILENT FAILURE / DATA LOSS / DEGRADED UX) found"
      );
    }
  }

  if (!msg.includes('## Error Handling Audit Summary')) {
    return emitVerdict(false, "missing '## Error Handling Audit Summary' section");
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
