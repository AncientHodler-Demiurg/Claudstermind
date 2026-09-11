#!/usr/bin/env node
// Test: hive-stop.sh is a well-formed bash script that reads the PID from
// .bee/.hive-pid, performs a kill -0 liveness pre-check to detect stale PID
// files (reporting not_running and cleaning up without touching the log file),
// sends SIGTERM followed by a grace-period poll loop (20 * 0.1s = 2s), escalates
// to SIGKILL if still alive, cleans up the PID file on success, preserves
// .bee/.hive.log on clean stop, outputs the required JSON shapes, and accepts
// a --bee-dir argument. These are STRUCTURAL assertions -- the test reads the
// script file as text and asserts on the source, mirroring the pattern used by
// debug-command.test.js. No real processes are spawned, no real PID files are
// written, no real server is started.

const fs = require('fs');
const path = require('path');

const SCRIPT_PATH = path.join(
  __dirname, '..', 'hive-stop.sh'
);

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

// Read the file under test
let content;
let stat;
try {
  content = fs.readFileSync(SCRIPT_PATH, 'utf8');
  stat = fs.statSync(SCRIPT_PATH);
} catch (e) {
  console.log('FAIL: hive-stop.sh does not exist at expected path');
  console.log(`  Expected: ${SCRIPT_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: File exists and is executable
// ============================================================
console.log('Test 1: File exists and is executable');
assert(
  fs.existsSync(SCRIPT_PATH),
  'hive-stop.sh exists at plugins/bee/scripts/hive-stop.sh'
);
// chmod +x check: any exec bit (user/group/other) set
assert(
  (stat.mode & 0o111) !== 0,
  'hive-stop.sh has execute bit set (chmod +x)'
);

// ============================================================
// Test 2: Shebang
// ============================================================
console.log('\nTest 2: Shebang');
assert(
  content.startsWith('#!/usr/bin/env bash'),
  'Script starts with #!/usr/bin/env bash shebang'
);

// ============================================================
// Test 3: Reads PID from .bee/.hive-pid
// ============================================================
console.log('\nTest 3: PID file location and reading');
assert(
  content.includes('.hive-pid'),
  'References .hive-pid file name'
);
assert(
  /PID_FILE\s*=/.test(content) || /pid_file\s*=/.test(content),
  'Defines a PID_FILE variable'
);
assert(
  /\$\(\s*cat\s+["']?\$?\{?PID_FILE\}?["']?\s*\)/.test(content) ||
    /\$\(cat\s+"?\$PID_FILE"?\)/.test(content),
  'Reads the PID by running cat on the PID file'
);

// ============================================================
// Test 4: Log file path is referenced and used for stale cleanup
// ============================================================
console.log('\nTest 4: Log file path reference');
assert(
  content.includes('.hive.log'),
  'References .hive.log file path (must be known so it can be preserved)'
);

// ============================================================
// Test 5: --bee-dir argument parsing
// ============================================================
console.log('\nTest 5: --bee-dir argument');
assert(
  content.includes('--bee-dir'),
  'Accepts --bee-dir argument'
);
assert(
  /case\s+["']?\$\{?1\}?["']?\s+in/.test(content) ||
    /while\s*\[\[?\s*\$#/.test(content) ||
    /getopts/.test(content),
  'Uses case/while argument parsing pattern'
);

// ============================================================
// Test 6: not_running output when PID file is missing
// ============================================================
console.log('\nTest 6: not_running when PID file missing');
assert(
  /\{\s*"status"\s*:\s*"not_running"\s*\}/.test(content),
  'Outputs {"status": "not_running"} JSON shape'
);
assert(
  /-f\s+"?\$\{?PID_FILE\}?"?/.test(content) ||
    /-e\s+"?\$\{?PID_FILE\}?"?/.test(content),
  'Tests for PID file existence with -f or -e'
);

// ============================================================
// Test 7: EARLY CHECK -- kill -0 liveness probe BEFORE SIGTERM
// ============================================================
console.log('\nTest 7: Early kill -0 liveness probe (stale PID detection)');
assert(
  /kill\s+-0/.test(content),
  'Uses kill -0 for liveness probe'
);
// Count kill -0 occurrences -- we expect at least 3:
// 1) early stale check before SIGTERM
// 2) grace-period polling loop
// 3) post-grace alive verification before SIGKILL
// (and optionally a post-SIGKILL verification)
const kill0Matches = content.match(/kill\s+-0/g) || [];
assert(
  kill0Matches.length >= 3,
  `Uses kill -0 at least 3 times (early check + grace loop + post-grace check) -- found ${kill0Matches.length}`
);

// The early check must occur before the first SIGTERM.
const firstTermIdx = (() => {
  // Find the first plain `kill "$pid"` (no -0, no -9) -- this is the SIGTERM send.
  const termRegex = /kill\s+(-TERM\s+)?"?\$\{?pid\}?"?/g;
  let match;
  while ((match = termRegex.exec(content)) !== null) {
    const lineStart = content.lastIndexOf('\n', match.index) + 1;
    const line = content.slice(lineStart, match.index + match[0].length);
    if (/kill\s+-0/.test(line) || /kill\s+-9/.test(line)) continue;
    return match.index;
  }
  return -1;
})();
const firstKill0Idx = content.search(/kill\s+-0/);
assert(
  firstKill0Idx !== -1 && (firstTermIdx === -1 || firstKill0Idx < firstTermIdx),
  'First kill -0 liveness probe occurs before the SIGTERM send'
);

// ============================================================
// Test 8: SIGTERM grace-period polling loop (20 * 0.1s)
// ============================================================
console.log('\nTest 8: SIGTERM + grace-period polling loop');
assert(
  /kill\s+(-TERM\s+)?"?\$\{?pid\}?"?\s+2>\/dev\/null/.test(content) ||
    /kill\s+"?\$\{?pid\}?"?\s+2>\/dev\/null/.test(content),
  'Sends SIGTERM (kill without -0/-9) silencing stderr'
);
assert(
  /for\s+i\s+in\s+\{1\.\.20\}/.test(content) ||
    /for\s*\(\(\s*i\s*=\s*(?:0|1)\s*;\s*i\s*<[=]?\s*20\s*;/.test(content),
  'Polls 20 iterations in grace period loop'
);
assert(
  /sleep\s+0\.1/.test(content),
  'Uses sleep 0.1 for 100ms poll interval'
);

// ============================================================
// Test 9: SIGKILL escalation after grace period
// ============================================================
console.log('\nTest 9: SIGKILL escalation');
assert(
  /kill\s+-9/.test(content),
  'Escalates to SIGKILL (kill -9) if still alive after grace period'
);
// The SIGKILL must come AFTER the grace-period loop, not before SIGTERM.
const sigkillIdx = content.search(/kill\s+-9/);
const loopIdx = content.search(/for\s+i\s+in\s+\{1\.\.20\}/);
assert(
  sigkillIdx !== -1 && loopIdx !== -1 && sigkillIdx > loopIdx,
  'SIGKILL escalation occurs after the grace-period polling loop'
);

// ============================================================
// Test 10: PID file cleanup after successful stop
// ============================================================
console.log('\nTest 10: PID file cleanup');
assert(
  /rm\s+-f\s+"?\$\{?PID_FILE\}?"?/.test(content),
  'Removes the PID file with rm -f after successful stop'
);

// ============================================================
// Test 11: Log file PRESERVATION on clean stop (NO rm of .hive.log)
// ============================================================
console.log('\nTest 11: Log file preservation');
// Ensure no rm command targets .hive.log or LOG_FILE on any code path.
const rmLines = content
  .split('\n')
  .filter((line) => /\brm\b/.test(line) && !line.trim().startsWith('#'));
const removesLog = rmLines.some(
  (line) => line.includes('.hive.log') || line.includes('LOG_FILE') || line.includes('$LOG')
);
assert(
  !removesLog,
  'Does NOT remove .hive.log on any code path (log is preserved for user inspection)'
);

// ============================================================
// Test 12: stopped output on success
// ============================================================
console.log('\nTest 12: stopped success output');
assert(
  /\{\s*"status"\s*:\s*"stopped"\s*\}/.test(content),
  'Outputs {"status": "stopped"} JSON on successful stop'
);

// ============================================================
// Test 13: failed output with error message when kill fails
// ============================================================
console.log('\nTest 13: failed error output');
assert(
  /\{\s*"status"\s*:\s*"failed"\s*,\s*"error"\s*:\s*"process still running"\s*\}/.test(
    content
  ),
  'Outputs {"status": "failed", "error": "process still running"} when kill cannot terminate process'
);

// ============================================================
// Test 14: Stale PID path outputs not_running and cleans PID file
// ============================================================
console.log('\nTest 14: Stale PID file handling');
// Before the SIGTERM send, the stale-PID path must contain both
// rm -f PID_FILE AND the not_running JSON output.
const sigTermIdx = (() => {
  const m = content.match(/kill\s+(-TERM\s+)?"?\$\{?pid\}?"?\s+2>\/dev\/null/);
  return m ? m.index : content.length;
})();
const preTermSlice = content.slice(0, sigTermIdx);
assert(
  /rm\s+-f\s+"?\$\{?PID_FILE\}?"?/.test(preTermSlice) &&
    /\{\s*"status"\s*:\s*"not_running"\s*\}/.test(preTermSlice),
  'Stale PID cleanup path (before SIGTERM) removes PID file and outputs not_running'
);

// ============================================================
// Test 15: Script structure -- no obviously dangerous ops
// ============================================================
console.log('\nTest 15: Safety checks');
assert(
  !/rm\s+-rf\s+\//.test(content),
  'Does not contain rm -rf / (safety check)'
);
assert(
  !/rm\s+-rf\s+\$\{?HOME\}?/.test(content),
  'Does not contain rm -rf $HOME (safety check)'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
