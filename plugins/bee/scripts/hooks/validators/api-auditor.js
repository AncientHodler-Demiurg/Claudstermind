#!/usr/bin/env node
// api-auditor.js — SubagentStop Node validator for the api-auditor agent.
// Translation of plugins/bee/hooks/hooks.json:251. Adds an extra contract
// over the base schema: the endpoint inventory table is mandatory.
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

  const hasFindings = msg.includes('### F-API-');
  const hasNoFindingsSentinel = msg.includes('No API issues found.');
  if (!hasFindings && !hasNoFindingsSentinel) {
    return emitVerdict(
      false,
      "missing audit findings: expected '### F-API-' entries or 'No API issues found.' sentinel"
    );
  }

  if (!msg.includes('## Endpoint Inventory')) {
    return emitVerdict(false, "missing '## Endpoint Inventory' section");
  }

  if (!msg.includes('## API Audit Summary')) {
    return emitVerdict(false, "missing '## API Audit Summary' section");
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
