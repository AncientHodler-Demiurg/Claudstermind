#!/usr/bin/env node
// implementer.js — SubagentStop Node validator for the implementer agent.
//
// Translates the prompt block at plugins/bee/hooks/hooks.json:87-95 into
// deterministic structural checks. Validates TWO valid completion states for
// the implementer agent:
//   (a) Success: TDD red-green DISTINCT-block sequence + completion marker.
//   (b) BLOCKED: full 5-field BLOCKED schema (Description / Proposed change /
//       Why needed / Impact / Alternatives).
//
// Hard contract (per validators-lib.js header):
//   - emits EXACTLY ONE verdict JSON to stdout via emitVerdict
//   - process.exit(0) on every code path
//   - top-level try/catch — catch handler emits a verdict BEFORE exit so the
//     Phase 2 runPerAgentValidator aggregator never sees empty stdout
//     (CI-001 cross-plan fix)
//
// DISTINCT-block detection (F-003 fix):
//   A single summary line `Tests: 0 failed, 8 passed, 8 total` lexically
//   contains both "failed" and "passed" tokens but does NOT prove a red-green
//   cycle occurred. splitIntoChunks tokenizes the message into chunks
//   bounded by markdown headings, fenced code blocks, and blank-line gaps,
//   then we confirm the FAIL chunk index strictly precedes the PASS chunk
//   index. Messages with no chunk boundaries (one flat paragraph) cannot
//   confirm red-green by construction.

'use strict';

const {
  readStdinSync,
  safeJsonParse,
  autoModeActive,
  readLastAssistantMessage,
  emitVerdict,
  splitIntoChunks,
} = require('./validators-lib.js');

const BLOCKED_FIELDS_FULL = [
  'Description:',
  'Proposed change:',
  'Why needed:',
  'Impact:',
  'Alternatives:',
];

// FAIL detection: non-zero failure count, FAIL line marker, or PHPUnit
// FAILURES! literal. The non-zero requirement on the count regex is what
// prevents a summary `Tests: 0 failed, 8 passed` line from matching.
const FAIL_NONZERO_COUNT = /\b[1-9]\d*\s+(failed|failing)\b/;
const FAIL_LINE_MARKER = /^[\s✗×]*FAIL\b/m;
const FAIL_PHPUNIT = 'FAILURES!';

// PASS detection: explicit "0 failed ... N passed" summary, PASS line marker,
// or PHPUnit OK (\d+ tests?) literal.
const PASS_ZERO_FAIL_SUMMARY = /\b0\s+failed.*\b[1-9]\d*\s+passed/;
const PASS_LINE_MARKER = /^[\s✓]*PASS\b/m;
const PASS_PHPUNIT_OK = /OK \(\d+ tests?/;

const COMPLETION_LITERAL = 'Task complete.';
const COMPLETION_COUNT = /\d+\s+tests?\s+passing/i;

function chunkIsFail(chunk) {
  if (FAIL_NONZERO_COUNT.test(chunk)) return true;
  if (FAIL_LINE_MARKER.test(chunk)) return true;
  if (chunk.indexOf(FAIL_PHPUNIT) !== -1) return true;
  return false;
}

function chunkIsPass(chunk) {
  if (PASS_ZERO_FAIL_SUMMARY.test(chunk)) return true;
  if (PASS_LINE_MARKER.test(chunk)) return true;
  if (PASS_PHPUNIT_OK.test(chunk)) return true;
  return false;
}

// detectBlocked — returns null if not BLOCKED, otherwise a verdict object
// `{ ok: true }` or `{ ok: false, reason: '...' }` to emit directly. The
// `requiredFields` argument lets quick-implementer.js share the same logic
// with a 4-field schema.
function detectBlocked(msg, requiredFields) {
  if (msg.indexOf('BLOCKED:') === -1) return null;
  for (const field of requiredFields) {
    if (msg.indexOf(field) === -1) {
      return { ok: false, reason: 'BLOCKED schema incomplete (missing ' + field + ')' };
    }
  }
  return { ok: true };
}

// detectTddRedGreen — returns a verdict object. Caller already confirmed
// completion marker presence; this only inspects the chunk sequence.
function detectTddRedGreen(msg) {
  const chunks = splitIntoChunks(msg);
  if (chunks.length < 2) {
    return {
      ok: false,
      reason: 'no distinct FAIL block precedes PASS block (message has no chunk boundaries)',
    };
  }

  let failIdx = -1;
  let passIdx = -1;
  for (let i = 0; i < chunks.length; i++) {
    if (failIdx === -1 && chunkIsFail(chunks[i])) failIdx = i;
  }
  for (let i = 0; i < chunks.length; i++) {
    if (chunkIsPass(chunks[i])) {
      passIdx = i;
      break;
    }
  }

  // No runner output at all → verification evidence missing.
  if (failIdx === -1 && passIdx === -1) {
    return {
      ok: false,
      reason: 'missing verification evidence (no test runner output, only a count claim)',
    };
  }
  if (failIdx === -1) {
    return { ok: false, reason: 'no distinct FAIL block found' };
  }
  if (passIdx === -1) {
    return { ok: false, reason: 'no distinct PASS block found' };
  }
  // Need a PASS chunk AFTER the FAIL chunk — same chunk doesn't count.
  if (passIdx <= failIdx) {
    let laterPassIdx = -1;
    for (let i = failIdx + 1; i < chunks.length; i++) {
      if (chunkIsPass(chunks[i])) {
        laterPassIdx = i;
        break;
      }
    }
    if (laterPassIdx === -1) {
      return { ok: false, reason: 'no distinct FAIL block precedes PASS block' };
    }
    passIdx = laterPassIdx;
  }

  return { ok: true };
}

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
  // F-MED fix: explicit empty-content reason BEFORE structural checks so the
  // failure message names the actual problem instead of falling through to
  // a generic "FAIL block not found" reason.
  if (msg.length === 0) return emitVerdict(false, 'empty assistant message');

  // BLOCKED precedence: if both BLOCKED and Task-complete appear, BLOCKED
  // wins (matches existing implementer.md:228 contract).
  const blockedVerdict = detectBlocked(msg, BLOCKED_FIELDS_FULL);
  if (blockedVerdict) {
    return emitVerdict(blockedVerdict.ok, blockedVerdict.reason);
  }

  if (msg.indexOf(COMPLETION_LITERAL) === -1 || !COMPLETION_COUNT.test(msg)) {
    return emitVerdict(false, 'completion marker missing');
  }

  const tddVerdict = detectTddRedGreen(msg);
  return emitVerdict(tddVerdict.ok, tddVerdict.reason);
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
