#!/usr/bin/env node
// architecture-auditor.js — SubagentStop Node validator for the
// architecture-auditor agent. Translation of plugins/bee/hooks/hooks.json:241.
//
// Hard contract: see validators-lib.js header.

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
  if (msg === null) return emitVerdict(false, 'transcript_path unreadable');
  if (msg.length === 0) return emitVerdict(false, 'empty assistant message');

  const hasFindings = msg.includes('### F-ARCH-');
  const hasNoFindingsSentinel = msg.includes('No architecture issues found.');
  if (!hasFindings && !hasNoFindingsSentinel) {
    return emitVerdict(
      false,
      "missing audit findings: expected '### F-ARCH-' entries or 'No architecture issues found.' sentinel"
    );
  }

  if (!msg.includes('## Architecture Audit Summary')) {
    return emitVerdict(false, "missing '## Architecture Audit Summary' section");
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
