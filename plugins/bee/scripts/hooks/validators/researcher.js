#!/usr/bin/env node
// researcher.js — SubagentStop validator for the researcher agent.
//
// Three modes (ported from plugins/bee/hooks/hooks.json:111):
//   - Phase research (signal: `Research complete: [N] tasks enriched` —
//     literal N or a numeric count).
//   - Spec/quick inline summary (no completion signal; structured findings
//     embedded inline — the loosest mode).
//   - Ecosystem research (signal: `Ecosystem research complete:`); requires
//     at least one provenance tag [VERIFIED] / [CITED] / [ASSUMED].
// Mode detection: ecosystem first, then phase, otherwise default to inline.

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

  const isEcosystem = msg.includes('Ecosystem research complete:');
  // Phase research signal: literal '[N]' placeholder OR explicit numeric count.
  const phasePattern = /Research complete:\s*(\[N\]|\d+)\s*tasks?\s*enriched/i;
  const isPhase = phasePattern.test(msg);

  if (isEcosystem) {
    const hasProvenance =
      msg.includes('[VERIFIED]') ||
      msg.includes('[CITED]') ||
      msg.includes('[ASSUMED]');
    if (!hasProvenance) {
      return emitVerdict(false, 'ecosystem mode missing provenance tag ([VERIFIED] / [CITED] / [ASSUMED])');
    }
    return emitVerdict(true);
  }

  if (isPhase) {
    return emitVerdict(true);
  }

  // Inline summary mode: per the prompt, structured findings should be
  // present. We accept any of project structure / patterns / reusable code
  // markers as evidence of a structured summary. This is intentionally lax —
  // the prompt itself permits inline summaries without a completion signal.
  const hasStructure =
    /##\s+/.test(msg) ||
    /\bpatterns?\b/i.test(msg) ||
    /\breusable\b/i.test(msg);
  if (!hasStructure) {
    return emitVerdict(false, 'no recognizable researcher output shape (no mode signal and no structured summary)');
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
