#!/usr/bin/env node
// audit-report-generator.js — SubagentStop Node validator for the
// audit-report-generator agent. Translation of plugins/bee/hooks/hooks.json:311.
//
// Unlike the other 10 audit validators (which are read-only), this agent's
// contract is that it WROTE two artifacts: AUDIT-REPORT.md and
// audit-findings.json. The validator asserts the agent's last message
// references both writes plus the canonical report sections (Executive
// Summary, Risk Assessment, Recommendations with the three sub-categories).
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

  if (!msg.includes('AUDIT-REPORT.md')) {
    return emitVerdict(false, "missing reference to 'AUDIT-REPORT.md' write");
  }

  if (!msg.includes('audit-findings.json')) {
    return emitVerdict(false, "missing reference to 'audit-findings.json' write");
  }

  if (!msg.includes('Executive Summary')) {
    return emitVerdict(false, "missing 'Executive Summary' section");
  }

  if (!msg.includes('Risk Assessment')) {
    return emitVerdict(false, "missing 'Risk Assessment' section");
  }

  if (!msg.includes('Recommendations')) {
    return emitVerdict(false, "missing 'Recommendations' section");
  }

  if (!msg.includes('Immediate Actions')) {
    return emitVerdict(false, "missing 'Immediate Actions' recommendation sub-section");
  }

  if (!msg.includes('Short-term Actions')) {
    return emitVerdict(false, "missing 'Short-term Actions' recommendation sub-section");
  }

  if (!msg.includes('Technical Debt')) {
    return emitVerdict(false, "missing 'Technical Debt' recommendation sub-section");
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
