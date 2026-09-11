#!/usr/bin/env node
// dependency-auditor.js — SubagentStop validator for dependency-auditor.
//
// Ported verbatim from plugins/bee/hooks/hooks.json:131.
// Structural checks:
//   1) `## Dependency Health Report` heading.
//   2) `### Phase-Relevant Dependencies` table OR a statement about
//      no phase-relevant dependencies.
//   3) `### Summary` section with Dependencies scanned count + Verdict.

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

  if (!msg.includes('## Dependency Health Report')) {
    return emitVerdict(false, "missing '## Dependency Health Report' heading");
  }

  const hasPhaseRelevant =
    msg.includes('### Phase-Relevant Dependencies') ||
    /no phase-relevant dependencies/i.test(msg);
  if (!hasPhaseRelevant) {
    return emitVerdict(false, "missing '### Phase-Relevant Dependencies' table or no-deps statement");
  }

  if (!msg.includes('### Summary')) {
    return emitVerdict(false, "missing '### Summary' section");
  }

  if (!/Dependencies scanned/i.test(msg)) {
    return emitVerdict(false, "missing 'Dependencies scanned' count in Summary");
  }

  if (!/Verdict\b/i.test(msg)) {
    return emitVerdict(false, "missing 'Verdict' field in Summary");
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
