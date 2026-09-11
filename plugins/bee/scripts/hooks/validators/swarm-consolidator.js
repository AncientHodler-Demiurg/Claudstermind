#!/usr/bin/env node
// swarm-consolidator.js — SubagentStop Node validator for the
// swarm-consolidator agent. Translation of plugins/bee/hooks/hooks.json:351.
//
// Distinct shape from the other 10 audit validators: SF-NNN findings (not
// F-XYZ-NNN), explicit per-finding Consensus + Source Agents fields, and a
// Dedup Summary. The agent may also emit a zero-findings shape (Summary
// with raw findings 0 / after dedup 0 / consensus escalations 0) which is
// equally valid — the checks below cover both shapes.
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

  if (!msg.includes('## Swarm Review Consolidation')) {
    return emitVerdict(false, "missing '## Swarm Review Consolidation' heading");
  }

  if (!msg.includes('### Summary')) {
    return emitVerdict(false, "missing '### Summary' section");
  }

  // Summary counts — the prompt lists five explicit count tokens. All must
  // appear so the Summary block is structurally complete on both the
  // findings-present and zero-findings shapes.
  const summaryTokens = [
    'segments analyzed',
    'agents dispatched',
    'raw findings',
    'after dedup',
    'consensus escalations',
  ];
  for (const token of summaryTokens) {
    if (!msg.includes(token)) {
      return emitVerdict(false, "missing summary count '" + token + "'");
    }
  }

  // Has-findings shape — only enforce per-finding fields when findings exist.
  // The zero-findings shape is allowed to omit the Findings heading entirely
  // per the prompt's explicit allowance.
  const hasFindingsHeading = msg.includes('### Findings (severity-ordered)');
  const hasSFEntries = /SF-\d{3}/.test(msg);

  if (hasFindingsHeading || hasSFEntries) {
    if (!msg.includes('Consensus')) {
      return emitVerdict(false, "findings present but no 'Consensus' field on finding entries");
    }
    if (!msg.includes('Source Agents')) {
      return emitVerdict(false, "findings present but no 'Source Agents' field on finding entries");
    }
  }

  if (!msg.includes('### Dedup Summary')) {
    return emitVerdict(false, "missing '### Dedup Summary' section");
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
