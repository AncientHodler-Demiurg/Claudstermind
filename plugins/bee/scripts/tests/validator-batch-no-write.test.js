#!/usr/bin/env node
// validator-batch-no-write.test.js — load-bearing enforcement of REQ-12
// (conductor-sole-writer). The 15 batch validator scripts plus the shared
// batch-lib.js helper module are STRICTLY read-only at the filesystem layer.
// The only allowed stdout path is `process.stdout.write` via emitBatchVerdict
// (which re-exports validators-lib.emitVerdict). Any fs write/append/stream
// call in these files breaks the conductor's exclusive-writer contract and
// invites silent state corruption across parallel batch dispatches.
//
// Why a static scan is the right defense: a runtime-only test would require
// driving each validator through every code path that could touch the
// filesystem. The write surface is small and bounded — five fs symbols — and
// any future regression is a textual addition, not a runtime branch. The
// regex sweep catches the regression at the source level, before it ever
// runs in CI under a real payload.
//
// Failure mode this prevents: a future contributor adds
// `fs.writeFileSync(logPath, ...)` to a batch validator for "just one line of
// debug telemetry". That single call now races every other parallel batch
// emit, fights the conductor for stdout ordering, and silently mutates state
// the conductor never asked to mutate. This test fails on the offending line
// before review even loads.

'use strict';

const fs = require('fs');
const path = require('path');

const { BATCH_VALIDATOR_ROSTER } = require('../hooks/validators/batch-lib');

const BATCH_DIR = path.join(__dirname, '..', 'hooks', 'validators', 'batch');
const BATCH_LIB_PATH = path.join(__dirname, '..', 'hooks', 'validators', 'batch-lib.js');

// The five fs-write surfaces a batch script could plausibly reach for. Sync
// and async/promise variants are both covered — the async forms are the
// escape hatch a contributor might think slips past a "no writeFileSync"
// review comment. `\b` word boundaries reject false positives on identifiers
// that merely contain these substrings (e.g. a hypothetical custom
// `fsWriteFileSyncWrapper` symbol would not trigger).
const WRITE_REGEXES = [
  { re: /\bfs\.writeFileSync\b/, name: 'fs.writeFileSync' },
  { re: /\bfs\.appendFileSync\b/, name: 'fs.appendFileSync' },
  { re: /\bfs\.createWriteStream\b/, name: 'fs.createWriteStream' },
  { re: /\bfs\.promises\.writeFile\b/, name: 'fs.promises.writeFile' },
  { re: /\bfs\.promises\.appendFile\b/, name: 'fs.promises.appendFile' },
];

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

// Returns the 1-based line number of the first match, or -1 when absent.
// Line-number reporting is what makes the failure message actionable: a CI
// log that says "fs.writeFileSync in audit-parallel-auditors.js:42" lets the
// reviewer jump straight to the offending edit without grepping locally.
function findLine(src, re) {
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i + 1;
  }
  return -1;
}

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Roster sanity — the imported constant MUST match REQ-09's 15-insertion-
// point count. If T2.1's BATCH_VALIDATOR_ROSTER ever drifts from 15 entries,
// every consumer of this constant (T2.9 here, T2.10's parameterized paired-
// contract test) silently scans the wrong file set; the roster-length
// assertion catches that drift before the no-write sweep runs.
// ---------------------------------------------------------------------------

console.log('=== Batch validator roster sanity ===');
assert(
  Array.isArray(BATCH_VALIDATOR_ROSTER),
  'BATCH_VALIDATOR_ROSTER is an array',
);
assert(
  BATCH_VALIDATOR_ROSTER.length === 15,
  `BATCH_VALIDATOR_ROSTER has 15 entries (REQ-09 insertion-point count) — got ${BATCH_VALIDATOR_ROSTER.length}`,
);

// ---------------------------------------------------------------------------
// No-write sweep — for each of the 15 batch validator scripts and the shared
// batch-lib.js helper, assert ZERO occurrences of every fs-write surface.
// Each file × regex pair is one assertion; the failure message names the
// offending file and line number so a single FAIL surfaces the exact edit
// that broke the conductor-sole-writer contract.
// ---------------------------------------------------------------------------

console.log('=== Batch validator no-write sweep ===');

const scanTargets = [
  ...BATCH_VALIDATOR_ROSTER.map((name) => ({
    label: `batch/${name}`,
    path: path.join(BATCH_DIR, name),
  })),
  { label: 'batch-lib.js', path: BATCH_LIB_PATH },
];

for (const target of scanTargets) {
  const src = readFileSafe(target.path);
  // Read failure is itself a failure: the roster claims this file exists.
  // Surfacing the missing-file case prevents a silent zero-match pass when a
  // batch validator file has been deleted but not removed from the roster.
  assert(src !== null, `${target.label} is readable at ${target.path}`);
  if (src === null) continue;

  for (const { re, name } of WRITE_REGEXES) {
    const line = findLine(src, re);
    const ok = line === -1;
    const detail = ok
      ? `${target.label}: no ${name} call (read-only contract intact)`
      : `${target.label}:${line}: forbidden ${name} call breaks conductor-sole-writer (REQ-12)`;
    assert(ok, detail);
  }
}

console.log('');
console.log(`tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
