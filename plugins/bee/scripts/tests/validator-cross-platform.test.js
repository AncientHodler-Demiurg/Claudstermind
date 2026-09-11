#!/usr/bin/env node
// Cross-platform invariance static-scan over every SubagentStop validator
// under plugins/bee/scripts/hooks/validators/*.js plus the shared
// validators-lib.js module.
//
// REQ-13 + NFR-05 contract:
//   - No validator branches on `process.platform === 'win32'`. Validators are
//     plain Node code that runs identically on Mac / Linux / Windows. Any
//     uname-style branching is forbidden — if a behavior diverges per OS the
//     fix is to use a cross-platform Node API, NOT a conditional.
//   - No validator shells out to `uname` or calls `os.type()` for platform
//     classification. Both leak host-environment differences into the verdict.
//   - Every validator that handles a `file_path` string from a tool_use input
//     MUST normalize Windows backslashes to POSIX separators via
//     `.replace(/\\/g, '/')` OR call `path.posix.normalize`. Without this,
//     a Windows-authored file_path (`C:\\Users\\x\\file.md`) fails the
//     containment check on a Mac/Linux validator host even though the
//     underlying intent is satisfied (F-006 class of bugs).
//
// Windows trust rationale:
//   Windows cross-platform invariance is anchored on the existing Node-hook
//   precedent — `plugins/bee/scripts/hooks/emit-event.js`,
//   `plugins/bee/scripts/setup-statusline.js`,
//   `plugins/bee/scripts/bee-statusline.js`, and
//   `plugins/bee/scripts/extract-fingerprint.js` all run on Windows
//   empirically and use the same cross-platform Node stdlib surface
//   (`path.join`, `os.homedir()`, `fs.*Sync`) without `uname` branches.
//   A dedicated Windows CI matrix is deferred to a follow-up release.
//   If a Windows user reports a validator failure, the offending validator
//   can be patched independently of the agent it serves — the static-scan
//   regexes here prevent the entire class of platform-branch bugs from
//   re-entering the codebase.
//
// Iterates via VALIDATOR_ROSTER imported from validators-lib.js — the same
// source of truth used by T1.10 (anti-duplication) and T1.12 (hooks.json
// roster). Raw `fs.readdirSync` is used ONLY for the roster integrity check
// (disk listing must equal the constant), never for the static scans.
//
// Mirrors the assert + counter idiom from command-primitives.test.js:31-58.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { VALIDATOR_ROSTER } = require('../hooks/validators/validators-lib');

const VALIDATORS_DIR = path.join(__dirname, '..', 'hooks', 'validators');
const LIB_FILENAME = 'validators-lib.js';
// Files that share the validators/ directory but are not per-agent validators:
// validators-lib.js (Phase 1) + batch-lib.js (Phase 2 sibling helper) +
// dispatch.js (perf/validator-dispatcher in-process routing shim).
// None of these belong in VALIDATOR_ROSTER.
const NON_ROSTER_FILES = new Set(['validators-lib.js', 'batch-lib.js', 'dispatch.js']);

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

function readValidatorSource(filename) {
  const p = path.join(VALIDATORS_DIR, filename);
  return fs.readFileSync(p, 'utf8');
}

// ---------------------------------------------------------------------------
// Roster integrity — disk listing must match VALIDATOR_ROSTER. If a developer
// adds a new validator without registering it in the roster, the static scans
// below would silently skip it. This check fails loudly first.
// ---------------------------------------------------------------------------

console.log('=== Roster integrity ===');

const diskListing = fs
  .readdirSync(VALIDATORS_DIR)
  .filter((f) => f.endsWith('.js') && !NON_ROSTER_FILES.has(f))
  .sort();
const rosterSorted = [...VALIDATOR_ROSTER].sort();

assert(
  diskListing.length === rosterSorted.length,
  `disk listing under hooks/validators/ (${diskListing.length} files) matches VALIDATOR_ROSTER size (${rosterSorted.length}) — guarantees the static scan covers every validator on disk`
);
assert(
  diskListing.join(',') === rosterSorted.join(','),
  'disk listing exactly equals VALIDATOR_ROSTER (sorted) — no validator on disk is missing from the roster and vice versa'
);

// ---------------------------------------------------------------------------
// Static-scan check (a) — no validator contains `process.platform === 'win32'`.
// The wallclock test `validator-wallclock.test.js` lives in scripts/tests/, NOT
// hooks/validators/, so the scan never sees it. No exclusion filter needed.
// ---------------------------------------------------------------------------

console.log('\n=== Anti-pattern (a): no process.platform === "win32" branches ===');

const PLATFORM_BRANCH_RE = /process\.platform\s*===\s*['"]win32['"]/;

for (const filename of VALIDATOR_ROSTER) {
  const src = readValidatorSource(filename);
  assert(
    !PLATFORM_BRANCH_RE.test(src),
    `${filename} contains no process.platform === "win32" branch — REQ-13 forbids per-OS branching inside validators`
  );
}
// validators-lib.js is also subject to the no-branching rule.
const libSrc = fs.readFileSync(path.join(VALIDATORS_DIR, LIB_FILENAME), 'utf8');
assert(
  !PLATFORM_BRANCH_RE.test(libSrc),
  `${LIB_FILENAME} contains no process.platform === "win32" branch — the shared library must be platform-uniform`
);

// ---------------------------------------------------------------------------
// Static-scan check (b) — no validator shells out to `uname` or calls
// `os.type()` for platform classification. Both leak host OS differences into
// the verdict and break Windows trust.
// ---------------------------------------------------------------------------

console.log('\n=== Anti-pattern (b): no uname shell-out or os.type() platform branching ===');

const UNAME_RE = /\buname\b/;
const OS_TYPE_RE = /os\.type\(\)/;

for (const filename of VALIDATOR_ROSTER) {
  const src = readValidatorSource(filename);
  assert(
    !UNAME_RE.test(src),
    `${filename} does not invoke uname — validators run pure Node, never shell out to OS-specific binaries`
  );
  assert(
    !OS_TYPE_RE.test(src),
    `${filename} does not call os.type() — os.type() classification is forbidden because it forces per-OS branching`
  );
}
assert(
  !UNAME_RE.test(libSrc),
  `${LIB_FILENAME} does not invoke uname — shared helpers stay platform-uniform`
);
assert(
  !OS_TYPE_RE.test(libSrc),
  `${LIB_FILENAME} does not call os.type() — shared helpers stay platform-uniform`
);

// ---------------------------------------------------------------------------
// Static-scan check (c) — positive normalization enforcement.
// Any validator whose source references `file_path` (a tool_use input
// commonly populated with a host-native path string by Claude Code on
// Windows) MUST also include `.replace(/\\/g, '/')` OR `path.posix.normalize`.
// This catches the F-006 class of Windows-separator bugs at CI time.
// ---------------------------------------------------------------------------

console.log('\n=== Anti-pattern (c): file_path-handling validators include normalization ===');

const FILE_PATH_RE = /\bfile_path\b/;
const NORM_RE_WIN_TO_POSIX = /\.replace\(\s*\/\\\\\/g/;
const NORM_RE_POSIX_NORMALIZE = /path\.posix\.normalize/;

let filePathHandlerCount = 0;
for (const filename of VALIDATOR_ROSTER) {
  const src = readValidatorSource(filename);
  if (!FILE_PATH_RE.test(src)) continue;
  filePathHandlerCount++;
  const hasWinToPosix = NORM_RE_WIN_TO_POSIX.test(src);
  const hasPosixNormalize = NORM_RE_POSIX_NORMALIZE.test(src);
  assert(
    hasWinToPosix || hasPosixNormalize,
    `${filename} references file_path AND includes cross-platform normalization (.replace(/\\\\/g, '/') or path.posix.normalize) — prevents F-006 class of Windows-separator containment bugs`
  );
}
// Floor: at least one validator handles file_path. debug-investigator (T1.5)
// inspects Write/Edit tool_use file_path inputs and must satisfy this rule.
assert(
  filePathHandlerCount >= 1,
  `at least one validator references file_path (current: ${filePathHandlerCount}); the static scan would be a no-op without a file_path handler in the roster`
);

// ---------------------------------------------------------------------------
// Syntax check — every validator must be parseable by Node. `node --check`
// reports parse errors without executing. Catches a stray editor save that
// leaves a syntactically broken file on disk.
// ---------------------------------------------------------------------------

console.log('\n=== Node syntax check ===');

for (const filename of VALIDATOR_ROSTER) {
  const fullPath = path.join(VALIDATORS_DIR, filename);
  const result = spawnSync(process.execPath, ['--check', fullPath], { encoding: 'utf8' });
  assert(
    result.status === 0,
    `${filename} parses cleanly under node --check — guards against committed syntax errors that would crash the SubagentStop hook at runtime`
  );
}
const libCheck = spawnSync(process.execPath, ['--check', path.join(VALIDATORS_DIR, LIB_FILENAME)], {
  encoding: 'utf8',
});
assert(
  libCheck.status === 0,
  `${LIB_FILENAME} parses cleanly under node --check — the shared library must load without error or every validator that requires it crashes`
);

// ---------------------------------------------------------------------------
// LF line endings — Windows-authored validators must not commit CRLF, which
// would change every line's hash and confuse downstream string matching in
// the static scans above (regex anchors operate per-character, not per-line).
// ---------------------------------------------------------------------------

console.log('\n=== Line endings (LF only, no CRLF) ===');

for (const filename of VALIDATOR_ROSTER) {
  const src = readValidatorSource(filename);
  assert(
    !src.includes('\r\n'),
    `${filename} uses LF line endings — CRLF would silently break per-line regex anchors in the static scans and complicate cross-platform diffs`
  );
}
assert(
  !libSrc.includes('\r\n'),
  `${LIB_FILENAME} uses LF line endings — same reason as above for shared helpers`
);

// ---------------------------------------------------------------------------
// Final results
// ---------------------------------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
