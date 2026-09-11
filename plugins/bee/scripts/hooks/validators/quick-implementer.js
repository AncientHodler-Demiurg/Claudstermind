#!/usr/bin/env node
// quick-implementer.js — SubagentStop Node validator for the quick-implementer
// agent.
//
// Translates the prompt block at plugins/bee/hooks/hooks.json:177-185 into
// deterministic structural checks. The semantic algorithm mirrors
// implementer.js exactly, with ONE intentional divergence (Rule 7 — Surface
// Conflicts): the BLOCKED schema requires 4 fields (no Alternatives) per
// plugins/bee/agents/quick-implementer.md:149-156. The full implementer
// BLOCKED schema requires 5 fields (Alternatives included). The two schemas
// are kept distinct rather than averaged.
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
  splitIntoChunks,
} = require('./validators-lib.js');

const BLOCKED_FIELDS_QUICK = [
  'Description:',
  'Proposed change:',
  'Why needed:',
  'Impact:',
];

const FAIL_NONZERO_COUNT = /\b[1-9]\d*\s+(failed|failing)\b/;
const FAIL_LINE_MARKER = /^[\s✗×]*FAIL\b/m;
const FAIL_PHPUNIT = 'FAILURES!';

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

function detectBlocked(msg, requiredFields) {
  if (msg.indexOf('BLOCKED:') === -1) return null;
  for (const field of requiredFields) {
    if (msg.indexOf(field) === -1) {
      return { ok: false, reason: 'BLOCKED schema incomplete (missing ' + field + ')' };
    }
  }
  return { ok: true };
}

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
  if (msg.length === 0) return emitVerdict(false, 'empty assistant message');

  const blockedVerdict = detectBlocked(msg, BLOCKED_FIELDS_QUICK);
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
