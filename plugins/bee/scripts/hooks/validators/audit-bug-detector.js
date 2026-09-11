#!/usr/bin/env node
// audit-bug-detector.js — SubagentStop Node validator for the
// audit-bug-detector agent. Translation of plugins/bee/hooks/hooks.json:291.
//
// Adds cross-layer-trace contracts on top of the base audit-finding schema:
// every finding must show a Flow + Trace path (Component → API → Controller
// → Service → DB) so the cross-layer claim is grounded in citations.
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

  const hasFindings = msg.includes('### F-BUG-');
  const hasNoFindingsSentinel = msg.includes('No cross-layer bugs found.');
  if (!hasFindings && !hasNoFindingsSentinel) {
    return emitVerdict(
      false,
      "missing audit findings: expected '### F-BUG-' entries or 'No cross-layer bugs found.' sentinel"
    );
  }

  // If findings are present, Flow + Trace are mandatory (per the prompt's
  // "end-to-end path" requirement). The sentinel path skips both.
  if (hasFindings) {
    if (!msg.includes('Flow')) {
      return emitVerdict(false, "findings present but no 'Flow' section found");
    }
    if (!msg.includes('Trace')) {
      return emitVerdict(false, "findings present but no 'Trace' section found");
    }
  }

  if (!msg.includes('## Bug Detection Summary')) {
    return emitVerdict(false, "missing '## Bug Detection Summary' section");
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
