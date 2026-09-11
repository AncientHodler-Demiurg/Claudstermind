#!/usr/bin/env node
// Test: hive-server.js lifecycle management (T2.3) -- STRUCTURAL tests only.
//
// These tests read hive-server.js as text and assert that owner-PID monitoring,
// signal handling, and graceful shutdown are wired into the entry-point block.
// They do NOT spawn the server. Real runtime verification happens via the hive
// integration tests and manual dashboard exercises.
//
// Acceptance criteria covered (T2.3):
//   1. Reads HIVE_OWNER_PID from environment at startup.
//   2. Validates owner PID at startup (dead → disable monitoring, clearInterval,
//      warning log, no idle-timeout fallback).
//   3. Performs immediate liveness check right after server.listen() callback.
//   4. Polls owner PID every 30 seconds via process.kill(pid, 0).
//   5. EPERM exception treated as alive (cross-user / container).
//   6. Owner dead → graceful shutdown: close HTTP server, log
//      { type: 'server-stopped', reason: 'owner process exited' }, exit 0.
//   7. SIGTERM handler → graceful close, exit 0.
//   8. SIGINT handler → graceful close, exit 0.
//   9. lifecycleCheck.unref() so interval does not block natural exit.
//  10. Existing T1.1 functionality is preserved (additive change).

const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '..', 'hive-server.js');

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

let content;
try {
  content = fs.readFileSync(SRC_PATH, 'utf8');
} catch (e) {
  console.log('FAIL: hive-server.js does not exist at expected path');
  console.log(`  Expected: ${SRC_PATH}`);
  console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
  process.exit(1);
}

// ============================================================
// Test 1: HIVE_OWNER_PID environment variable is read
// ============================================================
console.log('Test 1: HIVE_OWNER_PID environment variable');
assert(
  /process\.env\.HIVE_OWNER_PID/.test(content),
  'Reads HIVE_OWNER_PID from process.env'
);
assert(
  /ownerPid/.test(content),
  'Declares an ownerPid binding'
);
// The owner PID must be coerced to a Number (env vars are always strings).
assert(
  /Number\s*\(\s*process\.env\.HIVE_OWNER_PID\s*\)/.test(content),
  'Coerces HIVE_OWNER_PID to a Number'
);

// ============================================================
// Test 2: ownerAlive helper using process.kill(pid, 0)
// ============================================================
console.log('\nTest 2: ownerAlive helper');
assert(
  /function\s+ownerAlive\s*\(/.test(content) || /const\s+ownerAlive\s*=/.test(content),
  'Defines an ownerAlive helper'
);
assert(
  /process\.kill\s*\(\s*ownerPid\s*,\s*0\s*\)/.test(content),
  'Uses process.kill(ownerPid, 0) for liveness check'
);
// EPERM must be treated as "alive" (cross-user / container case).
assert(
  /EPERM/.test(content),
  'Handles EPERM exception code'
);
assert(
  /e\.code\s*===\s*['"]EPERM['"]/.test(content) ||
    /err\.code\s*===\s*['"]EPERM['"]/.test(content) ||
    /\.code\s*===\s*['"]EPERM['"]/.test(content),
  'EPERM comparison returns true (alive)'
);

// ============================================================
// Test 3: Periodic liveness check via setInterval(30 * 1000)
// ============================================================
console.log('\nTest 3: Periodic liveness check');
assert(
  /setInterval\s*\(/.test(content),
  'Uses setInterval for periodic liveness check'
);
assert(
  /30\s*\*\s*1000/.test(content) || /30000/.test(content),
  'Interval period is 30 seconds (30 * 1000 ms)'
);
assert(
  /lifecycleCheck/.test(content),
  'Declares a lifecycleCheck interval handle'
);
assert(
  /lifecycleCheck\s*=\s*setInterval/.test(content),
  'lifecycleCheck is assigned the setInterval handle'
);

// ============================================================
// Test 4: lifecycleCheck.unref() to not block process exit
// ============================================================
console.log('\nTest 4: Interval.unref()');
assert(
  /lifecycleCheck\.unref\s*\(\s*\)/.test(content),
  'Calls lifecycleCheck.unref() so interval does not block exit'
);

// ============================================================
// Test 5: Startup validation -- dead owner disables monitoring
// ============================================================
console.log('\nTest 5: Startup owner PID validation');
// There must be a guard around the startup path that checks ownerAlive() and
// clears the interval if the owner is already dead. The key signals:
//   - owner-pid-invalid log message
//   - clearInterval call inside that guard
//   - no idle-timeout fallback (no IDLE_TIMEOUT_MS constant borrowed from the
//     brainstorm pattern -- T2.3 removes it explicitly)
assert(
  /owner-pid-invalid/.test(content),
  'Logs { type: "owner-pid-invalid" } when owner is dead at startup'
);
assert(
  /clearInterval\s*\(/.test(content),
  'Calls clearInterval to tear down the interval when owner dies'
);
assert(
  !/IDLE_TIMEOUT/.test(content),
  'Does NOT reintroduce an idle timeout fallback'
);
// The startup validation should set ownerPid to null (or a similar disable)
// after detecting the dead owner. We accept `ownerPid = null` or equivalent.
assert(
  /ownerPid\s*=\s*null/.test(content),
  'Disables ownerPid (sets to null) after dead-at-startup detection'
);

// ============================================================
// Test 6: Immediate liveness check after server.listen callback
// ============================================================
console.log('\nTest 6: Immediate post-listen liveness check');
// The lifecycle setup must be invoked AFTER server.listen(). We check that a
// setupLifecycle-like function exists and that it is called inside the listen
// callback (not before it). Structural proxy: the require.main guard contains
// a server.listen call whose callback references lifecycle/ownerAlive wiring.
assert(
  /function\s+setupLifecycle\s*\(/.test(content) || /const\s+setupLifecycle\s*=/.test(content),
  'Defines a setupLifecycle function'
);
// The listen callback OR setupLifecycle must perform an immediate liveness
// check (separate from the setInterval tick). We require that ownerAlive() is
// called at least twice in the source: once for the startup validation and
// once (or more) inside the interval body.
const ownerAliveCalls = (content.match(/ownerAlive\s*\(/g) || []).length;
assert(
  ownerAliveCalls >= 2,
  `ownerAlive() is invoked at least twice (startup + interval) (found ${ownerAliveCalls})`
);

// ============================================================
// Test 7: Graceful shutdown helper
// ============================================================
console.log('\nTest 7: shutdown helper');
assert(
  /function\s+shutdown\s*\(/.test(content) || /const\s+shutdown\s*=/.test(content),
  'Defines a shutdown helper'
);
assert(
  /server-stopped/.test(content),
  'Logs { type: "server-stopped" } on shutdown'
);
assert(
  /owner process exited/.test(content),
  'Shutdown reason is "owner process exited" when owner dies'
);
// shutdown must call server.close(...) and then process.exit(0).
assert(
  /server\.close\s*\(/.test(content),
  'shutdown calls server.close()'
);
assert(
  /process\.exit\s*\(\s*0\s*\)/.test(content),
  'shutdown exits with code 0'
);

// ============================================================
// Test 8: Signal handlers -- SIGTERM and SIGINT
// ============================================================
console.log('\nTest 8: SIGTERM/SIGINT signal handlers');
assert(
  /process\.on\s*\(\s*['"]SIGTERM['"]/.test(content),
  'Registers a SIGTERM handler'
);
assert(
  /process\.on\s*\(\s*['"]SIGINT['"]/.test(content),
  'Registers a SIGINT handler'
);
// Both handlers should trigger shutdown(...) -- we check each signal name is
// in the same neighborhood as a shutdown call.
const sigtermBlock = content.match(/SIGTERM['"][\s\S]{0,200}/);
assert(
  sigtermBlock !== null && /shutdown/.test(sigtermBlock[0]),
  'SIGTERM handler invokes shutdown()'
);
const sigintBlock = content.match(/SIGINT['"][\s\S]{0,200}/);
assert(
  sigintBlock !== null && /shutdown/.test(sigintBlock[0]),
  'SIGINT handler invokes shutdown()'
);

// ============================================================
// Test 9: Lifecycle setup is guarded by require.main === module
// ============================================================
console.log('\nTest 9: Lifecycle only runs under require.main === module');
// The setupLifecycle call (or inlined lifecycle wiring) MUST live inside the
// `if (require.main === module)` block so tests that `require` hive-server.js
// do not accidentally register signal handlers or spawn intervals.
const guardMatch = content.match(/if\s*\(\s*require\.main\s*===\s*module\s*\)\s*\{([\s\S]*?)\n\}/);
assert(
  guardMatch !== null,
  'require.main === module guard is present and well-formed'
);
assert(
  guardMatch !== null &&
    (/setupLifecycle\s*\(/.test(guardMatch[1]) || /lifecycleCheck/.test(guardMatch[1])),
  'Lifecycle wiring is inside the require.main guard'
);
// Extra: signal handlers must NOT fire at module top level. We approximate by
// requiring the SIGTERM/SIGINT calls to be inside a function body (not at
// column 0). A simple proxy: every process.on('SIGTERM'|'SIGINT', ...) call
// must be preceded by some indentation (leading whitespace on the line).
const sigtermLine = content.split('\n').find(l => /process\.on\s*\(\s*['"]SIGTERM['"]/.test(l));
assert(
  sigtermLine !== undefined && /^\s+/.test(sigtermLine),
  'SIGTERM handler is not registered at module top level'
);
const sigintLine = content.split('\n').find(l => /process\.on\s*\(\s*['"]SIGINT['"]/.test(l));
assert(
  sigintLine !== undefined && /^\s+/.test(sigintLine),
  'SIGINT handler is not registered at module top level'
);

// ============================================================
// Test 10: Existing T1.1 functionality is preserved (regression guard)
// ============================================================
console.log('\nTest 10: T1.1 regression guard');
assert(
  /function\s+createServer\s*\(/.test(content),
  'createServer function still defined'
);
assert(
  /function\s+handleRequest\s*\(/.test(content),
  'handleRequest function still defined'
);
assert(
  /function\s+setSnapshotHandler\s*\(/.test(content),
  'setSnapshotHandler function still defined'
);
assert(
  /const\s+MIME_TYPES\s*=/.test(content),
  'MIME_TYPES constant still defined'
);
assert(
  /module\.exports[\s\S]{0,400}createServer/.test(content),
  'createServer still exported'
);
assert(
  /module\.exports[\s\S]{0,400}handleRequest/.test(content),
  'handleRequest still exported'
);
assert(
  /module\.exports[\s\S]{0,400}setSnapshotHandler/.test(content),
  'setSnapshotHandler still exported'
);
assert(
  /module\.exports[\s\S]{0,400}MIME_TYPES/.test(content),
  'MIME_TYPES still exported'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
