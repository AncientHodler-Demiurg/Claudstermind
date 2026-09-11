#!/usr/bin/env node
// testing-auditor.js — SubagentStop validator for testing-auditor (3 modes).
//
// Ported verbatim from plugins/bee/hooks/hooks.json:281.
//   - Scan mode (signal: `## Testing Audit Summary`): F-TEST-NNN findings OR
//     'No testing issues found.'; `## Test Coverage Map` table; summary
//     section with the usual counts.
//   - Generate mode (signal: `## Test Generation Summary`):
//     `## Requirement Coverage Map` with COVERED/PARTIAL/UNCOVERED;
//     summary fields.
//   - Pre-plan mode (signal: `## Test Gap Analysis`):
//     Infrastructure Status table; `### Verdict` with READY / NEEDS_SETUP /
//     NO_INFRASTRUCTURE; `### Summary` section.
// Modes are exclusive — exactly one signal.

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

  const isPrePlan = msg.includes('## Test Gap Analysis');
  const isGenerate = msg.includes('## Test Generation Summary');
  const isScan = msg.includes('## Testing Audit Summary');

  const modeCount = [isPrePlan, isGenerate, isScan].filter(Boolean).length;
  if (modeCount === 0) {
    return emitVerdict(false, 'no testing-auditor mode signal detected (scan / generate / pre-plan)');
  }
  if (modeCount > 1) {
    return emitVerdict(false, 'ambiguous testing-auditor mode: multiple signals present');
  }

  if (isPrePlan) {
    // Infrastructure Status table — header keywords must all appear.
    const hasInfraHeader =
      /Infrastructure Status/i.test(msg) &&
      /\bStack\b/.test(msg) &&
      /Test Runner/i.test(msg) &&
      /\bConfig\b/.test(msg) &&
      /Can Run/i.test(msg) &&
      /\bStatus\b/.test(msg);
    if (!hasInfraHeader) {
      return emitVerdict(false, 'pre-plan mode missing Infrastructure Status table (Stack/Test Runner/Config/Can Run/Status)');
    }
    if (!/###\s+Verdict/.test(msg)) {
      return emitVerdict(false, "pre-plan mode missing '### Verdict' section");
    }
    if (!/\b(READY|NEEDS_SETUP|NO_INFRASTRUCTURE)\b/.test(msg)) {
      return emitVerdict(false, 'pre-plan mode missing verdict value (READY / NEEDS_SETUP / NO_INFRASTRUCTURE)');
    }
    if (!/###\s+Summary/.test(msg)) {
      return emitVerdict(false, "pre-plan mode missing '### Summary' section");
    }
    return emitVerdict(true);
  }

  if (isGenerate) {
    if (!msg.includes('## Requirement Coverage Map')) {
      return emitVerdict(false, "generate mode missing '## Requirement Coverage Map' table");
    }
    const hasCoverageStatus =
      /\bCOVERED\b/.test(msg) ||
      /\bPARTIAL\b/.test(msg) ||
      /\bUNCOVERED\b/.test(msg);
    if (!hasCoverageStatus) {
      return emitVerdict(false, 'generate mode missing coverage status (COVERED / PARTIAL / UNCOVERED)');
    }
    // Summary fields: acceptance criteria count, tests generated, tests
    // passing, implementation bugs escalated.
    if (!/acceptance criteria/i.test(msg)) {
      return emitVerdict(false, "generate mode missing 'acceptance criteria' field in Summary");
    }
    if (!/tests generated/i.test(msg)) {
      return emitVerdict(false, "generate mode missing 'tests generated' field in Summary");
    }
    if (!/tests passing/i.test(msg)) {
      return emitVerdict(false, "generate mode missing 'tests passing' field in Summary");
    }
    return emitVerdict(true);
  }

  // Scan mode
  const hasFindings =
    /###\s+F-TEST-\d+/.test(msg) ||
    msg.includes('No testing issues found.');
  if (!hasFindings) {
    return emitVerdict(false, 'scan mode missing F-TEST-NNN findings or no-findings message');
  }
  if (!msg.includes('## Test Coverage Map')) {
    return emitVerdict(false, "scan mode missing '## Test Coverage Map' table");
  }
  // Required summary fields (literal needles from the prompt).
  if (!/test files found/i.test(msg)) {
    return emitVerdict(false, "scan mode missing 'test files found' field");
  }
  if (!/test cases found/i.test(msg)) {
    return emitVerdict(false, "scan mode missing 'test cases found' field");
  }
  if (!/critical paths covered/i.test(msg)) {
    return emitVerdict(false, "scan mode missing 'critical paths covered' field");
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
