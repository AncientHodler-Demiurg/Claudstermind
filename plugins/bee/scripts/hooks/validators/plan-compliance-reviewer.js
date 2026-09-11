#!/usr/bin/env node
// plan-compliance-reviewer.js — SubagentStop validator for the
// plan-compliance-reviewer agent. Two modes:
//   - Code-review mode (signal: '## Plan Compliance Findings'): findings
//     under '### Spec Gap' / '### Cross-Phase Integration' / '### Over-Scope'
//     with SG-NNN / CI-NNN / OS-NNN IDs; Acceptance Criteria checklist with
//     [x]/[ ] marks; Evidence / Impact / Test Gap per finding.
//   - Plan-review mode (signal: '## Plan Compliance Review: Phase'):
//     '### Coverage Matrix' table with COVERED/PARTIAL/NOT COVERED statuses.
// Mode detection is exclusive — exactly one signal must match. Ported from
// plugins/bee/hooks/hooks.json:161.

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

  const isCodeMode = msg.includes('## Plan Compliance Findings');
  const isPlanMode = /##\s+Plan Compliance Review:\s+Phase/.test(msg);

  if (isCodeMode && isPlanMode) {
    return emitVerdict(false, 'ambiguous mode: both code-review and plan-review signals present');
  }
  if (!isCodeMode && !isPlanMode) {
    return emitVerdict(false, 'no mode signal detected (need Findings heading or Review: Phase heading)');
  }

  if (isCodeMode) {
    const hasCategoryHeading =
      /^###\s+Spec Gap\b/m.test(msg) ||
      /^###\s+Cross-Phase Integration\b/m.test(msg) ||
      /^###\s+Over-Scope\b/m.test(msg);
    if (!hasCategoryHeading) {
      return emitVerdict(false, 'code-review mode missing category heading (Spec Gap / Cross-Phase Integration / Over-Scope)');
    }

    const hasFindingId = /\b(SG|CI|OS)-\d{3}\b/.test(msg);
    if (!hasFindingId) {
      return emitVerdict(false, 'code-review mode missing finding ID (SG-NNN / CI-NNN / OS-NNN)');
    }

    // Acceptance Criteria checklist with [x]/[ ] marks.
    const hasAcceptanceChecklist =
      /Acceptance Criteria/i.test(msg) &&
      /\[(x|X|\s)\]/.test(msg);
    if (!hasAcceptanceChecklist) {
      return emitVerdict(false, 'code-review mode missing Acceptance Criteria checklist with [x]/[ ] marks');
    }

    if (!/\*\*Evidence:\*\*/.test(msg) && !/\bEvidence:/.test(msg)) {
      return emitVerdict(false, 'missing Evidence field on findings');
    }
    if (!/\*\*Impact:\*\*/.test(msg) && !/\bImpact:/.test(msg)) {
      return emitVerdict(false, 'missing Impact field on findings');
    }
    if (!/\*\*Test Gap:\*\*/.test(msg) && !/\bTest Gap:/.test(msg)) {
      return emitVerdict(false, 'missing Test Gap field on findings');
    }

    return emitVerdict(true);
  }

  // plan-review mode
  if (!/###\s+Coverage Matrix/.test(msg)) {
    return emitVerdict(false, "plan-review mode missing '### Coverage Matrix' table");
  }
  const hasStatus =
    /\bCOVERED\b/.test(msg) ||
    /\bPARTIAL\b/.test(msg) ||
    /\bNOT COVERED\b/.test(msg);
  if (!hasStatus) {
    return emitVerdict(false, 'plan-review mode missing COVERED/PARTIAL/NOT COVERED status in matrix');
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
