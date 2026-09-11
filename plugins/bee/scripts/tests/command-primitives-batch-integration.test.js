#!/usr/bin/env node
// Integration grep audit for the batch-validator wiring across the 7 parent
// commands and the 15 batch validator scripts.
//
// Three contracts pinned (REQ-09, REQ-10 extension, REQ-11):
//
//   A. Parent-command insertion-point references (REQ-09).
//      For each of the 7 parent commands keyed in BATCH_VALIDATOR_INSERTION_POINTS,
//      every expected `validators/batch/<insertion>.js` literal MUST appear at
//      least once in the file. The conductor invokes the batch validator by
//      this literal path; a missing reference means the parent command edit
//      from T2.6/T2.7/T2.8 silently regressed to a per-agent-only flow.
//
//   B. --no-aggregate-validate flag wiring (REQ-11).
//      For each of the 4 autonomous commands (ship.md, plan-all.md, audit.md,
//      execute-phase.md), the exact-token regex literal
//      `(^|\s)--no-aggregate-validate(\s|$)` appears exactly once (catches
//      accidental duplication), the argument-hint frontmatter mentions the
//      flag (catches users not seeing it in `/help`), and the bare
//      `--no-validate` literal is ABSENT (catches an incomplete rename from
//      the original Phase 2 draft flag name to the final F-STD-004 rename).
//      For plan-phase.md (NOT in the autonomous flag list per REQ-11), the
//      flag regex literal MUST be absent — plan-phase is interactive and
//      receives no flag to skip aggregate-validate.
//
//   C. Marker-skip uniformity audit (REQ-10 extension).
//      For each of the 15 batch validator scripts, the canonical bare
//      statement `markerSkipPrelude(payload);` appears exactly once (FIX 11
//      iter 1 — rejects predicate use, rejects assignment), it appears
//      BEFORE the `failClosedOnMissing` line (the prelude must short-circuit
//      before the fail-closed gate runs), and the script does NOT contain a
//      bespoke `fs.existsSync('.bee/.autonomous-run-active')` call — the
//      uniform helper from batch-lib.js is the ONLY marker-check surface.
//
// Patterns reused:
//   - BATCH_VALIDATOR_INSERTION_POINTS / BATCH_VALIDATOR_ROSTER imported from
//     batch-lib.js (single source of truth — F-CP-005).
//   - Plain-Node assert + counter (command-primitives.test.js:31-58).
//   - Flat test layout — no nested batch/ directory (F-PAT-002).

'use strict';

const fs = require('fs');
const path = require('path');

const {
  BATCH_VALIDATOR_INSERTION_POINTS,
  BATCH_VALIDATOR_ROSTER,
} = require('../hooks/validators/batch-lib');

const PLUGIN_DIR = path.join(__dirname, '..', '..');
const COMMANDS_DIR = path.join(PLUGIN_DIR, 'commands');
const BATCH_DIR = path.join(__dirname, '..', 'hooks', 'validators', 'batch');

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${testName}`);
  } else {
    failed++;
    console.log(`  FAIL: ${testName}`);
  }
}

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (_) {
    return null;
  }
}

// Return the 1-based line number of the first match, or -1 when absent.
function findLine(src, re) {
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i + 1;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Section A — parent-command insertion-point references (REQ-09).
// ---------------------------------------------------------------------------

console.log('=== Section A: parent-command insertion-point references (REQ-09) ===');

assert(
  Object.keys(BATCH_VALIDATOR_INSERTION_POINTS).length === 7,
  `BATCH_VALIDATOR_INSERTION_POINTS keyed by 7 parent commands — got ${Object.keys(BATCH_VALIDATOR_INSERTION_POINTS).length}`
);

// v4.7: commands routed through the shared review-pipeline engine declare the
// bare script filenames in their $BATCH_VALIDATORS manifest; the engine owns
// the parameterized validators/batch/ invocation sites. The REQ-09 contract is
// pinned across both halves of that path.
const REVIEW_ENGINE_SRC = readFileSafe(
  path.join(COMMANDS_DIR, '..', 'skills', 'review-pipeline', 'SKILL.md')
) || '';

for (const [cmdFile, expectedRefs] of Object.entries(BATCH_VALIDATOR_INSERTION_POINTS)) {
  const cmdPath = path.join(COMMANDS_DIR, cmdFile);
  const src = readFileSafe(cmdPath);
  assert(src !== null, `${cmdFile}: readable at ${cmdPath}`);
  if (src === null) continue;
  const engineRouted = src.includes('skills/review-pipeline/SKILL.md');
  for (const ref of expectedRefs) {
    if (engineRouted && ref.startsWith('validators/batch/')) {
      const bare = ref.replace('validators/batch/', '');
      assert(
        src.includes(bare) && REVIEW_ENGINE_SRC.includes('validators/batch/{$BATCH_VALIDATORS.'),
        `${cmdFile}: manifest declares ${bare} and the engine owns the validators/batch/ invocation site (REQ-09 via engine routing)`
      );
    } else {
      assert(
        src.includes(ref),
        `${cmdFile}: references ${ref} (conductor invokes batch validator by this literal path — REQ-09)`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Section B — --no-aggregate-validate flag wiring (REQ-11).
// ---------------------------------------------------------------------------

console.log('\n=== Section B: --no-aggregate-validate flag wiring (REQ-11) ===');

// The exact-token regex literal as it appears in the parent command prose.
// Matches the EXACT escaped regex string, not the runtime regex behavior.
const FLAG_REGEX_LITERAL = '(^|\\s)--no-aggregate-validate(\\s|$)';

// The bare --no-validate literal that the F-STD-004 rename moved AWAY from.
// Negative assertion catches incomplete renames where one occurrence was
// missed and now points back to the old flag name.
const BARE_NO_VALIDATE_RE = /(^|\s)--no-validate(\s|$)/;

const AUTONOMOUS_FLAG_COMMANDS = [
  'ship.md',
  'plan-all.md',
  'audit.md',
  'execute-phase.md',
];

for (const cmdFile of AUTONOMOUS_FLAG_COMMANDS) {
  const cmdPath = path.join(COMMANDS_DIR, cmdFile);
  const src = readFileSafe(cmdPath);
  assert(src !== null, `${cmdFile}: readable at ${cmdPath}`);
  if (src === null) continue;

  // (B.1) Exactly one occurrence of the exact-token regex literal.
  // More than one means a duplicate paste from a sibling command, which
  // would lead to two flag-resolution branches in the same command body —
  // a contributor reading the file could honor only one and silently bypass
  // the other.
  const flagLiteralCount = src.split(FLAG_REGEX_LITERAL).length - 1;
  assert(
    flagLiteralCount === 1,
    `${cmdFile}: contains the exact-token regex literal '${FLAG_REGEX_LITERAL}' exactly once (got ${flagLiteralCount}) — single flag-resolution branch (REQ-11, F-STD-004)`
  );

  // (B.2) argument-hint frontmatter mentions the flag.
  // Without this, the user typing `/bee:<cmd> --` in the slash-command picker
  // never sees `--no-aggregate-validate` suggested, which makes the flag
  // discoverable only by reading the source.
  const argHintMatch = src.match(/^argument-hint:\s*"([^"]*)"/m);
  assert(
    argHintMatch !== null,
    `${cmdFile}: has an argument-hint frontmatter line (REQ-11 — user-facing flag discovery)`
  );
  if (argHintMatch) {
    assert(
      argHintMatch[1].includes('--no-aggregate-validate'),
      `${cmdFile}: argument-hint mentions --no-aggregate-validate (got "${argHintMatch[1]}") — user-facing flag discovery (REQ-11, F-STD-004)`
    );
  }

  // (B.3) Bare --no-validate literal is ABSENT.
  // Catches an incomplete rename from the original Phase 2 draft flag name.
  // If the rename was partial and one site still says `--no-validate`, the
  // command would silently ignore the user's flag (no parser matches it).
  assert(
    !BARE_NO_VALIDATE_RE.test(src),
    `${cmdFile}: does NOT contain bare --no-validate (catches incomplete F-STD-004 rename from the original flag name)`
  );
}

// plan-phase.md negative assertion — NOT in the autonomous-flag list.
{
  const cmdPath = path.join(COMMANDS_DIR, 'plan-phase.md');
  const src = readFileSafe(cmdPath);
  assert(src !== null, `plan-phase.md: readable at ${cmdPath}`);
  if (src !== null) {
    // plan-phase.md MUST NOT contain the flag regex literal — it is interactive
    // and the REQ-11 list explicitly excludes it. If a future edit accidentally
    // copies the flag-resolution block from a sibling, plan-phase would gain a
    // user-facing flag that contradicts its interactive contract.
    const planPhaseFlagCount = src.split(FLAG_REGEX_LITERAL).length - 1;
    assert(
      planPhaseFlagCount === 0,
      `plan-phase.md: contains ZERO occurrences of '${FLAG_REGEX_LITERAL}' (got ${planPhaseFlagCount}) — interactive command never receives the flag (REQ-11)`
    );
  }
}

// ---------------------------------------------------------------------------
// Section C — marker-skip uniformity audit (REQ-10 extension).
// ---------------------------------------------------------------------------

console.log('\n=== Section C: marker-skip uniformity audit (REQ-10 extension) ===');

assert(
  Array.isArray(BATCH_VALIDATOR_ROSTER) && BATCH_VALIDATOR_ROSTER.length === 15,
  `BATCH_VALIDATOR_ROSTER has 15 entries (REQ-09 insertion-point count) — got ${BATCH_VALIDATOR_ROSTER.length}`
);

// The canonical bare statement form. /m flag because the regex is anchored
// to start-of-line and end-of-statement-line. Predicate use (e.g.
// `if (markerSkipPrelude(payload)) ...`) is REJECTED — the helper is
// self-exiting; treating it as a predicate masks the exit semantics and
// invites a contributor to add post-call logic that never runs in the
// marker-absent case.
const MARKER_SKIP_STMT_RE = /^\s*markerSkipPrelude\s*\(\s*payload\s*\)\s*;\s*$/m;

// Bespoke fs.existsSync of the marker file path. The uniform helper from
// batch-lib.js (which uses validators-lib.autoModeActive) is the single
// source of truth for marker semantics; a bespoke call would diverge on
// the resolveRoot 3-tier fallback and produce a different verdict than the
// helper on edge cases (CLAUDE_PROJECT_DIR env, missing payload.cwd, etc.).
const BARE_FS_EXISTS_RE = /fs\.existsSync\s*\(\s*['"][^'"]*\.autonomous-run-active['"]/;

for (const scriptName of BATCH_VALIDATOR_ROSTER) {
  const scriptPath = path.join(BATCH_DIR, scriptName);
  const src = readFileSafe(scriptPath);
  assert(src !== null, `batch/${scriptName}: readable at ${scriptPath}`);
  if (src === null) continue;

  // (C.1) Exactly one canonical bare statement.
  const stmtMatches = src.match(new RegExp(MARKER_SKIP_STMT_RE.source, 'gm'));
  const stmtCount = stmtMatches ? stmtMatches.length : 0;
  assert(
    stmtCount === 1,
    `batch/${scriptName}: contains exactly one canonical 'markerSkipPrelude(payload);' statement (got ${stmtCount}) — bare-statement form per FIX 11 iter 1`
  );

  // (C.2) markerSkipPrelude line appears BEFORE failClosedOnMissing line.
  // Order matters: if failClosedOnMissing runs first, a marker-absent run
  // with a partial-input payload would emit `{ok:false, reason:"missing K
  // per-agent outputs..."}` instead of the expected `{ok:true}` short-
  // circuit, breaking the REQ-10 base inclusion semantics.
  const preludeLine = findLine(src, MARKER_SKIP_STMT_RE);
  const failClosedLine = findLine(src, /failClosedOnMissing\s*\(/);
  assert(
    preludeLine !== -1 && failClosedLine !== -1 && preludeLine < failClosedLine,
    `batch/${scriptName}: markerSkipPrelude (line ${preludeLine}) appears BEFORE failClosedOnMissing (line ${failClosedLine}) — order guards REQ-10 short-circuit`
  );

  // (C.3) No bespoke fs.existsSync against the marker file path.
  const bespokeLine = findLine(src, BARE_FS_EXISTS_RE);
  assert(
    bespokeLine === -1,
    `batch/${scriptName}: does NOT contain bespoke fs.existsSync('.autonomous-run-active') (uniform helper is the only marker-check surface)`
  );
}

console.log('');
console.log(`tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
