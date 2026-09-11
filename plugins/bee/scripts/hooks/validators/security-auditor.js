#!/usr/bin/env node
// security-auditor.js — SubagentStop Node validator for the security-auditor agent.
//
// Mirror of the prompt block at plugins/bee/hooks/hooks.json:211 translated into
// deterministic structural checks. Reads the SubagentStop payload from stdin,
// loads the agent's last assistant message from the JSONL transcript, then
// enforces the audit-finding schema documented in
// plugins/bee/agents/security-auditor.md.
//
// Hard contract (per validators-lib.js header):
//   - emits EXACTLY ONE verdict JSON to stdout via emitVerdict
//   - process.exit(0) on every code path
//   - top-level try/catch — catch handler emits a verdict BEFORE exit so the
//     Phase 2 runPerAgentValidator aggregator never sees empty stdout
//     (CI-001 cross-plan fix)

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

  // Check 1: findings present (### F-SEC-) OR the no-findings sentinel.
  const hasFindings = msg.includes('### F-SEC-');
  const hasNoFindingsSentinel = msg.includes('No security issues found.');
  if (!hasFindings && !hasNoFindingsSentinel) {
    return emitVerdict(
      false,
      "missing audit findings: expected '### F-SEC-' entries or 'No security issues found.' sentinel"
    );
  }

  // Check 2: trailing summary section is mandatory.
  if (!msg.includes('## Security Audit Summary')) {
    return emitVerdict(false, "missing '## Security Audit Summary' section");
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
