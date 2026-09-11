#!/usr/bin/env node
// integration-checker.js — SubagentStop Node validator for the
// integration-checker agent. Translation of plugins/bee/hooks/hooks.json:341.
//
// Contract is heavier than the base audit schema: it requires BOTH a
// completion heading AND a summary section, plus the wiring counts, plus an
// explicit health rating from a fixed enum.
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

const HEALTH_RATINGS = ['HEALTHY', 'MODERATE', 'CONCERNING', 'BROKEN'];

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

  if (!msg.includes('## Integration Check Complete')) {
    return emitVerdict(false, "missing '## Integration Check Complete' completion heading");
  }

  if (!msg.includes('Integration Audit Summary')) {
    return emitVerdict(false, "missing 'Integration Audit Summary' section");
  }

  // Wiring Summary requires all three categories (Connected / Orphaned /
  // Missing) so the orphan + missing counts are explicit, not implicit.
  if (!msg.includes('Wiring Summary')) {
    return emitVerdict(false, "missing 'Wiring Summary' section");
  }
  if (!msg.includes('Connected')) {
    return emitVerdict(false, "missing 'Connected' wiring count");
  }
  if (!msg.includes('Orphaned')) {
    return emitVerdict(false, "missing 'Orphaned' wiring count");
  }
  if (!msg.includes('Missing')) {
    return emitVerdict(false, "missing 'Missing' wiring count");
  }

  // Exactly one of the four ratings must appear (per the prompt's fixed enum).
  const ratingMatched = HEALTH_RATINGS.some((rating) => msg.includes(rating));
  if (!ratingMatched) {
    return emitVerdict(
      false,
      "missing integration health rating (HEALTHY / MODERATE / CONCERNING / BROKEN)"
    );
  }

  const hasFindings = msg.includes('### F-INT-');
  const hasNoFindingsSentinel = msg.includes('No integration issues found.');
  if (!hasFindings && !hasNoFindingsSentinel) {
    return emitVerdict(
      false,
      "missing audit findings: expected '### F-INT-' entries or 'No integration issues found.' sentinel"
    );
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
