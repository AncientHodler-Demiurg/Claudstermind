#!/usr/bin/env node
// bug-detector.js — SubagentStop validator for the bug-detector agent
// (generic and stack-prefixed variants both match `(?<!audit-)bug-detector$`).
//
// Ported verbatim from the prompt at plugins/bee/hooks/hooks.json:141.
// Structural checks:
//   1) `## Bugs Detected` heading with severity subsections (### Critical /
//      ### High / ### Medium) OR the literal `No bugs detected.` message.
//   2) Backtick file:line reference present at least once (e.g. `file.js:42`).
//   3) Total tally line `**Total: X critical, Y high, Z medium**` present OR
//      `No bugs detected.` was used.
//   4) Each finding includes Evidence, Impact, Test Gap fields (per the
//      finding schema sourced from .bee/reviews/2026-04-26-1.md).
//
// Hard contract per validators-lib.js: emit exactly one JSON verdict, never
// throw, always exit 0. The top-level catch handler MUST emit a verdict
// BEFORE exiting (CI-001 cross-plan rule) so the aggregator never sees an
// empty stdout from an in-band exception.

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

  const noBugs = msg.includes('No bugs detected.');
  if (noBugs) {
    return emitVerdict(true);
  }

  // Findings-present path: all structural checks must hold.
  if (!msg.includes('## Bugs Detected')) {
    return emitVerdict(false, "missing '## Bugs Detected' heading");
  }

  const hasAnySeveritySection =
    /^###\s+(Critical|High|Medium)\b/m.test(msg);
  if (!hasAnySeveritySection) {
    return emitVerdict(false, 'missing severity subsection (### Critical / High / Medium)');
  }

  // Backtick file:line — must match `<something>:<digits>` inside backticks.
  if (!/`[^`\n]+:\d+`/.test(msg)) {
    return emitVerdict(false, 'missing backtick file:line reference');
  }

  if (!/\*\*Total:\s*\d+\s*critical,\s*\d+\s*high,\s*\d+\s*medium\*\*/i.test(msg)) {
    return emitVerdict(false, "missing total tally line '**Total: X critical, Y high, Z medium**'");
  }

  // Per-finding evidence/impact/test-gap presence — required by REQ checks 6
  // in the source prompt. Each finding MUST include these fields; we verify
  // they appear at all (the count-equality check happens in T1.7 integration).
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

if (require.main === module) {
  try {
    main();
  } catch (err) {
    emitVerdict(false, 'validator threw: ' + (err && err.message ? err.message : String(err)));
  }
  process.exit(0);
}

module.exports = { main };
