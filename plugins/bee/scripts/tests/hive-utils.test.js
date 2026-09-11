#!/usr/bin/env node
// Test: hive-utils.sh — STRUCTURAL tests only.
//
// This file asserts that the sourceable shell library at
// `plugins/bee/scripts/hive-utils.sh` exposes the expected function
// definitions, logic branches, JSON output shapes, and platform
// handling required by T2.4. It reads the script as text and asserts
// via substring / regex checks in the spirit of the debug-command
// test pattern (hand-rolled assert helper, no test runner).
//
// These tests DO NOT source the script, do not probe live processes,
// and do not launch a browser. Runtime behavior is validated by the
// conductor when T2.5 wires hive-utils.sh into the command flow.

const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '..', 'hive-utils.sh');

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
  console.log('FAIL: hive-utils.sh does not exist at expected path');
  console.log(`  Expected: ${SRC_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: File exists and has bash shebang
// ============================================================
console.log('Test 1: File exists and has bash shebang');
assert(
  fs.existsSync(SRC_PATH),
  'hive-utils.sh exists at plugins/bee/scripts/hive-utils.sh'
);
assert(
  /^#!\/usr\/bin\/env bash/.test(content),
  'File starts with `#!/usr/bin/env bash` shebang'
);

// ============================================================
// Test 2: check_running function is defined
// ============================================================
console.log('\nTest 2: check_running function');
assert(
  /check_running\s*\(\s*\)\s*\{/.test(content),
  'Defines check_running function (POSIX `name() {` form)'
);

// ============================================================
// Test 3: check_running reads the PID file (.bee/.hive-pid)
// ============================================================
console.log('\nTest 3: check_running reads .bee/.hive-pid');
assert(
  content.includes('.hive-pid'),
  'References .hive-pid PID file path'
);
// Must guard file existence before reading
assert(
  /-f\s+"?\$\{?[A-Za-z_][A-Za-z0-9_]*/i.test(content) ||
    /-f\s+"[^"]*\.hive-pid/.test(content),
  'Guards PID file existence with `-f` test before reading'
);

// ============================================================
// Test 4: check_running emits not_running JSON when PID file missing
// ============================================================
console.log('\nTest 4: not_running JSON when PID file missing');
assert(
  /\{"status":\s*"not_running"\}/.test(content),
  'Emits `{"status": "not_running"}` JSON shape'
);

// ============================================================
// Test 5: check_running uses `kill -0` liveness probe
// ============================================================
console.log('\nTest 5: kill -0 liveness probe');
assert(
  /kill\s+-0\s+"?\$/.test(content),
  'Uses `kill -0` to probe if PID is alive'
);

// ============================================================
// Test 6: Stale PID cleanup — removes PID file but PRESERVES log file
// ============================================================
console.log('\nTest 6: Stale PID cleanup preserves log file');
assert(
  /rm\s+-f\s+"?\$\{?[A-Za-z_][A-Za-z0-9_]*/.test(content) ||
    /rm\s+-f\s+"[^"]*\.hive-pid/.test(content),
  'Removes stale PID file with `rm -f`'
);
// Must NOT remove the log file when the PID is stale -- crash logs must survive
assert(
  !/rm\s+-f\s+[^\n]*\.hive\.log/.test(content),
  'Does NOT remove .hive.log on stale PID cleanup (preserves crash logs)'
);

// ============================================================
// Test 7: running JSON shape with pid and url
// ============================================================
console.log('\nTest 7: running JSON shape');
assert(
  /"status":\s*"running"/.test(content),
  'Emits `"status": "running"` when server is alive and responsive'
);
assert(
  /"pid":/.test(content),
  'Running JSON includes pid field'
);
assert(
  /"url":/.test(content),
  'Running JSON includes url field'
);
assert(
  /http:\/\/(localhost|127\.0\.0\.1)/.test(content),
  'Running JSON url points at localhost / 127.0.0.1'
);

// ============================================================
// Test 8: unresponsive JSON shape when HTTP probe fails
// ============================================================
console.log('\nTest 8: unresponsive JSON shape');
assert(
  /"status":\s*"unresponsive"/.test(content),
  'Emits `"status": "unresponsive"` when process is alive but HTTP probe fails'
);

// ============================================================
// Test 9: HTTP probe via node -e using built-in http module
// ============================================================
console.log('\nTest 9: Node.js HTTP probe');
assert(
  /node\s+-e\s+/.test(content),
  'Uses `node -e` to run an inline HTTP probe'
);
assert(
  /require\(['"]http['"]\)/.test(content),
  "Node probe requires the built-in 'http' module"
);
assert(
  content.includes('/api/snapshot'),
  'HTTP probe hits /api/snapshot endpoint'
);
assert(
  /statusCode\s*===?\s*200/.test(content),
  'HTTP probe checks for statusCode 200'
);
// Must not use curl or nc for the probe (minimal systems may lack them)
assert(
  !/\bcurl\b[^'\n]*\/api\/snapshot/.test(content),
  'Does NOT use curl for the HTTP probe'
);
assert(
  !/\bnc\b\s+-z/.test(content),
  'Does NOT use nc for port probing'
);

// ============================================================
// Test 10: HIVE_PORT environment variable with sensible default (3333)
// ============================================================
console.log('\nTest 10: HIVE_PORT honored with default 3333');
assert(
  /HIVE_PORT/.test(content),
  'References HIVE_PORT environment variable'
);
assert(
  /HIVE_PORT:-3333/.test(content) || /HIVE_PORT:-"?3333/.test(content),
  'Defaults HIVE_PORT to 3333 when unset'
);

// ============================================================
// Test 11: open_browser function is defined
// ============================================================
console.log('\nTest 11: open_browser function');
assert(
  /open_browser\s*\(\s*\)\s*\{/.test(content),
  'Defines open_browser function'
);

// ============================================================
// Test 12: open_browser accepts a URL argument
// ============================================================
console.log('\nTest 12: open_browser URL argument');
// Assert the function body references a positional parameter ($1 / ${1})
const openBrowserMatch = content.match(
  /open_browser\s*\(\s*\)\s*\{([\s\S]*?)\n\}/
);
assert(
  openBrowserMatch !== null,
  'open_browser function body is parseable'
);
const openBrowserBody = openBrowserMatch ? openBrowserMatch[1] : '';
assert(
  /\$\{?1/.test(openBrowserBody),
  'open_browser reads URL from positional parameter $1'
);

// ============================================================
// Test 13: Platform detection via `uname -s`
// ============================================================
console.log('\nTest 13: Platform detection');
assert(
  /uname\s+-s/.test(content),
  'Detects platform with `uname -s`'
);
assert(
  /Darwin/.test(content),
  'Branches on Darwin (macOS)'
);
assert(
  /Linux/.test(content),
  'Branches on Linux'
);

// ============================================================
// Test 14: Darwin uses `open`, Linux uses `xdg-open`
// ============================================================
console.log('\nTest 14: Platform-specific open commands');
assert(
  /\bopen\s+"?\$/.test(openBrowserBody) || /\bopen\s+"?\$\{?URL/.test(content),
  'Darwin branch calls `open "$URL"`'
);
assert(
  /xdg-open\s+"?\$/.test(content),
  'Linux branch calls `xdg-open "$URL"`'
);

// ============================================================
// Test 15: Browser open is backgrounded (non-blocking) + disown
// ============================================================
console.log('\nTest 15: Backgrounded + disowned browser open');
// Look for a trailing `&` after an open / xdg-open invocation
assert(
  /(open|xdg-open)\s+"?\$[^\n]*&/.test(content),
  'Browser open invocation is backgrounded with trailing `&`'
);
assert(
  /\bdisown\b/.test(content),
  'Calls `disown` so the caller does not wait on the browser process'
);

// ============================================================
// Test 16: Unknown platform emits a warning but is non-fatal
// ============================================================
console.log('\nTest 16: Unknown platform warning');
// Warning must be printed (stderr echo or JSON warning)
assert(
  /warning/i.test(openBrowserBody) ||
    /unsupported/i.test(openBrowserBody) ||
    /unknown/i.test(openBrowserBody),
  'Unknown platform path emits a warning message'
);

// ============================================================
// Test 17: Browser open failure is non-fatal (errors suppressed)
// ============================================================
console.log('\nTest 17: Non-fatal browser open failure');
// Either `|| true`, `2>/dev/null`, or `|| echo '{"warning"...'` pattern
assert(
  /\|\|\s*true/.test(openBrowserBody) ||
    /2>\/dev\/null/.test(openBrowserBody) ||
    /\|\|\s*echo/.test(openBrowserBody),
  'Browser open failure is suppressed (|| true, 2>/dev/null, or fallback echo)'
);

// ============================================================
// Test 18: File is sourceable — no top-level `set -e` that would
// break the caller's shell, and no auto-execution of check_running
// or open_browser at load time.
// ============================================================
console.log('\nTest 18: Sourceable (no auto-execution at load time)');
// The script must not invoke check_running or open_browser
// unconditionally at the top level (they are library functions).
// Allow them inside a `main`-style guard or inside function bodies,
// but not as a bare top-level call.
const topLevelLines = content
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith('#'));
// A bare call would look like `check_running` or `open_browser "$1"` on
// its own line NOT inside a function body. We approximate this by
// ensuring the last function's closing `}` is the last non-trivial
// token AFTER which only empty lines or comments appear.
const lastBraceIdx = content.lastIndexOf('\n}');
const afterLastBrace = lastBraceIdx >= 0 ? content.slice(lastBraceIdx + 2) : content;
const hasTopLevelCall =
  /^\s*(check_running|open_browser)\b/m.test(afterLastBrace);
assert(
  !hasTopLevelCall,
  'No top-level invocation of check_running/open_browser (file is sourceable)'
);

// ============================================================
// Test 19: No `set -e` at the top level (would affect caller's shell)
// ============================================================
console.log('\nTest 19: No top-level `set -e`');
// `set -e` inside a function body is local to that function in bash,
// but at the top level it would leak into the sourcing shell. Scan
// only the lines outside any function body.
let depth = 0;
let topLevelSetE = false;
for (const rawLine of content.split('\n')) {
  const line = rawLine.trim();
  if (line.startsWith('#')) continue;
  // Crude brace tracking: count '{' and '}' tokens after a function header
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)\s*\{/.test(line)) {
    depth++;
    continue;
  }
  if (line === '}') {
    depth = Math.max(0, depth - 1);
    continue;
  }
  if (depth === 0 && /^set\s+-e(\s|$)/.test(line)) {
    topLevelSetE = true;
  }
}
assert(
  !topLevelSetE,
  'No top-level `set -e` that would leak into the sourcing shell'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
