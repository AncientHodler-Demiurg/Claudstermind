#!/usr/bin/env node
// Test: hive-start.sh — STRUCTURAL tests only.
// These tests read the source file as text and assert expected patterns via regex.
// They MUST NOT spawn real processes — no backgrounded servers, no `nohup` invocation.
// The conductor's real runtime verification lives elsewhere; this file exists to
// enforce the T2.1 acceptance criteria at the source level so downstream tasks
// (T2.2 hive-stop.sh, T2.3 hive-status.sh, commands) can rely on its contract.

const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '..', 'hive-start.sh');

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
try {
  content = fs.readFileSync(SRC_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: hive-start.sh does not exist at expected path');
  console.log(`  Expected: ${SRC_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: File exists and is a bash script
// ============================================================
console.log('Test 1: File exists and is a bash script');
assert(
  fs.existsSync(SRC_PATH),
  'hive-start.sh exists at plugins/bee/scripts/hive-start.sh'
);
assert(
  /^#!\/usr\/bin\/env bash/.test(content),
  'File starts with `#!/usr/bin/env bash` shebang'
);

// ============================================================
// Test 2: Script is executable (chmod +x)
// ============================================================
console.log('\nTest 2: Executable bit');
try {
  const stat = fs.statSync(SRC_PATH);
  // Owner execute bit: 0o100 (S_IXUSR)
  assert(
    (stat.mode & 0o100) !== 0,
    'hive-start.sh has owner execute bit set (chmod +x)'
  );
} catch (_e) {
  assert(false, 'hive-start.sh stat succeeded for executable check');
}

// ============================================================
// Test 3: Launches hive-server.js via nohup and disown
// ============================================================
console.log('\nTest 3: Background launch (nohup + disown)');
assert(
  /\bnohup\b/.test(content),
  'Uses nohup to survive shell exit'
);
assert(
  /\bdisown\b/.test(content),
  'Uses disown to detach from job table'
);
assert(
  /hive-server\.js/.test(content),
  'References hive-server.js (the server to launch)'
);
assert(
  /\bnode\b[^\n]*hive-server\.js/.test(content),
  'Invokes `node hive-server.js`'
);
// nohup ... node hive-server.js ... & (backgrounding)
assert(
  /nohup[\s\S]*hive-server\.js[\s\S]*&/m.test(content),
  'Backgrounds the server process with trailing `&`'
);

// ============================================================
// Test 4: Writes PID to .bee/.hive-pid immediately after backgrounding
// ============================================================
console.log('\nTest 4: PID file write');
assert(
  /\.hive-pid/.test(content),
  'References .hive-pid file name'
);
assert(
  /\$!/.test(content),
  'Captures backgrounded PID via $! special variable'
);
// The captured $! must be written to the pid file path.
assert(
  /\$!.*>[^\n]*\.hive-pid|SERVER_PID[\s\S]*>[^\n]*\.hive-pid|PID_FILE/.test(content),
  'Writes captured server PID to .hive-pid file'
);

// ============================================================
// Test 5: Redirects server stdout/stderr to .bee/.hive.log
// ============================================================
console.log('\nTest 5: Log file redirection');
assert(
  /\.hive\.log/.test(content),
  'References .hive.log file name'
);
assert(
  /2>&1/.test(content),
  'Merges stderr into stdout (2>&1)'
);
assert(
  />[^\n]*\.hive\.log|>[^\n]*\$LOG_FILE|>[^\n]*"\$LOG_FILE"/.test(content),
  'Redirects output to .hive.log via > redirection'
);

// ============================================================
// Test 6: Owner PID resolution (grandparent via ps -o ppid= -p "$PPID")
// ============================================================
console.log('\nTest 6: HIVE_OWNER_PID resolution');
assert(
  /ps\s+-o\s+ppid=\s+-p\s+"\$PPID"/.test(content),
  'Resolves grandparent PID via `ps -o ppid= -p "$PPID"`'
);
assert(
  /HIVE_OWNER_PID/.test(content),
  'Uses HIVE_OWNER_PID variable name'
);
// Fallback: if grandparent is empty or PID 1, fall back to $PPID
assert(
  /OWNER_PID[\s\S]*==\s*"1"|OWNER_PID[\s\S]*-z|OWNER_PID[\s\S]*empty/.test(content),
  'Checks for empty grandparent PID (fallback condition)'
);
assert(
  /"1"[\s\S]*OWNER_PID="\$PPID"|OWNER_PID="\$PPID"/.test(content),
  'Falls back to $PPID when grandparent is empty or PID 1'
);
// HIVE_OWNER_PID is passed to server via env
assert(
  /HIVE_OWNER_PID="?\$OWNER_PID"?/.test(content),
  'Passes HIVE_OWNER_PID env var to the server process'
);

// ============================================================
// Test 7: Waits for server-started via anchored grep, 20 iterations * 0.1s
// ============================================================
console.log('\nTest 7: Server-started wait loop');
assert(
  /grep\s+-q\s+'"type":"server-started"'/.test(content),
  'Uses anchored grep pattern `\'"type":"server-started"\'` (JSON-field-qualified)'
);
assert(
  /\{1\.\.20\}|seq\s+1\s+20|i\s*<=?\s*20/.test(content),
  'Polls up to 20 iterations (2 seconds total at 0.1s each)'
);
assert(
  /sleep\s+0\.1/.test(content),
  'Sleeps 0.1s between poll iterations'
);

// ============================================================
// Test 8: Verifies server PID alive via kill -0 after detection
// ============================================================
console.log('\nTest 8: Liveness probe (kill -0)');
assert(
  /kill\s+-0/.test(content),
  'Uses `kill -0` to probe process liveness'
);
// kill -0 is used twice: once for stale PID probe, once after server-started detection
const killZeroCount = (content.match(/kill\s+-0/g) || []).length;
assert(
  killZeroCount >= 2,
  'Uses `kill -0` at least twice (stale PID probe + post-start verification)'
);

// ============================================================
// Test 9: Outputs server-started JSON on success
// ============================================================
console.log('\nTest 9: Success output');
// On success, print the server-started line from the log and exit 0.
assert(
  /grep[^\n]*'"type":"server-started"'[\s\S]*\$LOG_FILE|grep[^\n]*server-started[\s\S]*"\$LOG_FILE"/.test(content),
  'Greps server-started line from log file to output on success'
);
assert(
  /exit\s+0/.test(content),
  'Has `exit 0` on successful path'
);

// ============================================================
// Test 10: Timeout error JSON + non-zero exit
// ============================================================
console.log('\nTest 10: Timeout / failure output');
assert(
  /"status":\s*"failed"|"error":/.test(content),
  'Emits a failure JSON shape (status=failed or error field)'
);
assert(
  /exit\s+1/.test(content),
  'Exits non-zero on timeout / failure'
);

// ============================================================
// Test 11: --bee-dir argument parsing with default discovery
// ============================================================
console.log('\nTest 11: --bee-dir argument parsing');
assert(
  /--bee-dir/.test(content),
  'Accepts --bee-dir argument'
);
assert(
  /case\s+"\$1"/.test(content) || /while\s*\[\[\s*\$#\s*-gt\s*0\s*\]\]/.test(content),
  'Uses standard bash argument parsing loop (case + while $# > 0)'
);
// Default discovery: walk up from pwd looking for .bee/
assert(
  /walk|parent|dirname\s+"?\$DIR"?|\.bee/.test(content),
  'Discovers .bee/ by walking up from pwd when --bee-dir not passed'
);
assert(
  /\bpwd\b|\$PWD/.test(content),
  'Starts discovery from current working directory (pwd)'
);

// ============================================================
// Test 12: Stale PID handling — alive → abort, dead → remove & proceed
// ============================================================
console.log('\nTest 12: Stale PID handling');
assert(
  /already_running/.test(content),
  'Emits `already_running` status JSON when PID file exists and process is alive'
);
assert(
  /"status":\s*"already_running"|"status": "already_running"/.test(content),
  'already_running JSON has status field'
);
assert(
  /"pid":/.test(content),
  'already_running JSON includes pid field'
);
// DEAD → remove stale file and proceed
assert(
  /rm\s+-f\s+"?\$PID_FILE"?|rm\s+-f[^\n]*\.hive-pid/.test(content),
  'Removes stale .hive-pid file when process is dead'
);
// Must NOT kill existing live instances — search for `kill "$old_pid"` style which would be wrong
assert(
  !/\bkill\s+"\$old_pid"|\bkill\s+\$old_pid|\bkill\s+"\$OLD_PID"|\bkill\s+\$OLD_PID/.test(content),
  'Does NOT kill live existing instances (only kill -0 probe allowed)'
);

// ============================================================
// Test 13: Uses env to pass environment vars to node process
// ============================================================
console.log('\nTest 13: Env var passing');
assert(
  /\benv\b[\s\S]*HIVE_OWNER_PID|HIVE_OWNER_PID="?\$OWNER_PID"?[\s\S]*node|export\s+HIVE_OWNER_PID/.test(content),
  'Passes HIVE_OWNER_PID via env when launching node'
);

// ============================================================
// Test 14: Defensive quoting of paths (shellcheck hygiene)
// ============================================================
console.log('\nTest 14: Path quoting hygiene');
assert(
  /"\$LOG_FILE"|"\$PID_FILE"|"\$BEE_DIR"/.test(content),
  'Quotes path variables defensively (avoids word splitting)'
);

// ============================================================
// Test 15: Forwards HIVE_BEE_DIR to the spawned node process
// ============================================================
// The shell script must pass HIVE_BEE_DIR alongside HIVE_OWNER_PID via
// the same `nohup env ... node` line. Without this, hive-server.js runs
// from the plugin cache where walking up from __dirname finds no .bee/
// ancestor, resolveBeeDir() returns null, and the snapshot handler stays
// on the {timestamp}-only stub — producing an empty dashboard.
console.log('\nTest 15: HIVE_BEE_DIR is forwarded to node');
// Right-anchored to pin the exact variable name — guards against a future
// refactor that introduces e.g. $BEE_DIR_OTHER, which would silently slip
// past a permissive prefix match.
assert(
  /HIVE_BEE_DIR="\$BEE_DIR"(?![A-Z_0-9])/.test(content),
  'Sets HIVE_BEE_DIR="$BEE_DIR" exactly (not a prefix-matched neighbor)'
);
// The variable MUST be on the same `nohup env ... node hive-server.js`
// invocation as HIVE_OWNER_PID — that is the only place env forwarding
// to the spawned node process actually happens. Pin the value to $BEE_DIR
// here too so a same-line refactor cannot drift the binding silently.
assert(
  /\bnohup\b[^\n]*\bHIVE_BEE_DIR="\$BEE_DIR"(?![A-Z_0-9])[^\n]*\bnode\b[^\n]*hive-server\.js/.test(
    content
  ),
  'HIVE_BEE_DIR="$BEE_DIR" is on the same `nohup env ... node hive-server.js` line as HIVE_OWNER_PID'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
