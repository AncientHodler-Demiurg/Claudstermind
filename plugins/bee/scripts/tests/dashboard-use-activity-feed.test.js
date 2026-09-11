#!/usr/bin/env node
// Test: dashboard-use-activity-feed — STRUCTURAL tests only.
//
// Verifies that plugins/bee/dashboard/src/hooks/useActivityFeed.ts exists and
// implements the activity-feed accumulator contract described by T4.4.
//
// Acceptance reference: T4.4 in
//   .bee/specs/2026-04-10-bee-board-dashboard/phases/04-activity-feed/TASKS.md
//
// The hook accepts BOTH the snapshot AND the connectionStatus from useSnapshot
// (T3.4) because useSnapshot retains the last snapshot on disconnect — without
// the connectionStatus dep, the hook would have no way to know that a fresh
// snapshot following a disconnect represents a reconnect and should re-baseline
// instead of flooding the feed with diff events.

const fs = require('fs');
const path = require('path');

const HOOK_FILE = path.join(
  __dirname, '..', '..', 'dashboard', 'src', 'hooks', 'useActivityFeed.ts'
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

// ============================================================
// Test 1: File exists
// ============================================================
console.log('Test 1: File exists');
assert(
  fs.existsSync(HOOK_FILE),
  'plugins/bee/dashboard/src/hooks/useActivityFeed.ts exists'
);

if (!fs.existsSync(HOOK_FILE)) {
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  process.exit(1);
}

const content = fs.readFileSync(HOOK_FILE, 'utf8');

// ============================================================
// Test 2: Exports useActivityFeed hook
// ============================================================
console.log('\nTest 2: Exports useActivityFeed hook');
assert(
  /export\s+function\s+useActivityFeed\s*\(/.test(content) ||
  /export\s+const\s+useActivityFeed\s*=/.test(content),
  'Exports `useActivityFeed` as function or const'
);

// ============================================================
// Test 3: Imports diffSnapshots and DIFF_SNAPSHOTS_MAX_EVENTS
// ============================================================
console.log('\nTest 3: Imports diffSnapshots and DIFF_SNAPSHOTS_MAX_EVENTS from @/lib/diff-snapshots');
assert(
  /import\s+\{[^}]*\bdiffSnapshots\b[^}]*\}\s+from\s+['"]@\/lib\/diff-snapshots['"]/.test(content),
  'Imports `diffSnapshots` from `@/lib/diff-snapshots`'
);

assert(
  /import\s+\{[^}]*\bDIFF_SNAPSHOTS_MAX_EVENTS\b[^}]*\}\s+from\s+['"]@\/lib\/diff-snapshots['"]/.test(content),
  'Imports `DIFF_SNAPSHOTS_MAX_EVENTS` from `@/lib/diff-snapshots`'
);

// ============================================================
// Test 4: Imports ActivityEvent from @/types/activity
// ============================================================
console.log('\nTest 4: Imports ActivityEvent type from @/types/activity');
assert(
  /import\s+(?:type\s+)?\{[^}]*\bActivityEvent\b[^}]*\}\s+from\s+['"]@\/types\/activity['"]/.test(content),
  'Imports `ActivityEvent` from `@/types/activity`'
);

// ============================================================
// Test 5: Imports Snapshot from @/types/snapshot
// ============================================================
console.log('\nTest 5: Imports Snapshot type from @/types/snapshot');
assert(
  /import\s+(?:type\s+)?\{[^}]*\bSnapshot\b[^}]*\}\s+from\s+['"]@\/types\/snapshot['"]/.test(content),
  'Imports `Snapshot` from `@/types/snapshot`'
);

// ============================================================
// Test 6: Uses useRef<Snapshot | null>
// ============================================================
console.log('\nTest 6: Uses useRef<Snapshot | null> for the baseline');
assert(
  /useRef\s*<\s*Snapshot\s*\|\s*null\s*>\s*\(\s*null\s*\)/.test(content),
  'Declares `useRef<Snapshot | null>(null)` for baseline tracking'
);

// ============================================================
// Test 7: Uses useState<ActivityEvent[]>
// ============================================================
console.log('\nTest 7: Uses useState<ActivityEvent[]> for accumulated events');
assert(
  /useState\s*<\s*ActivityEvent\s*\[\s*\]\s*>/.test(content),
  'Declares `useState<ActivityEvent[]>` for accumulated events'
);

// ============================================================
// Test 8: useEffect with [snapshot, connectionStatus] deps
// ============================================================
console.log('\nTest 8: useEffect runs on [snapshot, connectionStatus]');
assert(
  /\buseEffect\s*\(/.test(content),
  'Uses `useEffect` to run the diff loop'
);

assert(
  /\[\s*snapshot\s*,\s*connectionStatus\s*\]/.test(content),
  'useEffect dependency array is `[snapshot, connectionStatus]`'
);

// ============================================================
// Test 9: References 'disconnected' in the effect for reset logic
// ============================================================
console.log('\nTest 9: Resets baseline when connectionStatus is disconnected');
assert(
  /['"]disconnected['"]/.test(content),
  'Effect references the `disconnected` literal for reset logic'
);

// Also assert a reset assignment of prevRef.current = null exists somewhere.
assert(
  /prevRef\.current\s*=\s*null/.test(content),
  'Effect resets baseline via `prevRef.current = null`'
);

// ============================================================
// Test 10: Baseline check `prevRef.current === null`
// ============================================================
console.log('\nTest 10: Baseline check uses prevRef.current === null');
assert(
  /prevRef\.current\s*===\s*null/.test(content),
  'Baseline seed branch checks `prevRef.current === null`'
);

// ============================================================
// Test 11: Strict inequality `!==` on timestamp comparison
// ============================================================
console.log('\nTest 11: Timestamp comparison uses strict inequality (!==)');
assert(
  /snapshot\.timestamp\s*!==\s*prevRef\.current\.timestamp/.test(content) ||
  /prevRef\.current\.timestamp\s*!==\s*snapshot\.timestamp/.test(content),
  'Compares snapshot.timestamp with prevRef.current.timestamp using `!==`'
);

// Negative assertion: must NOT use strict equality `===` for the timestamp
// gating check (would invert the intended condition).
assert(
  !/snapshot\.timestamp\s*===\s*prevRef\.current\.timestamp/.test(content) &&
  !/prevRef\.current\.timestamp\s*===\s*snapshot\.timestamp/.test(content),
  'Does NOT use `===` for the timestamp gating check'
);

// ============================================================
// Test 12: References DIFF_SNAPSHOTS_MAX_EVENTS cap
// ============================================================
console.log('\nTest 12: Caps the ring buffer at DIFF_SNAPSHOTS_MAX_EVENTS');
assert(
  /\bDIFF_SNAPSHOTS_MAX_EVENTS\b/.test(content),
  'Uses `DIFF_SNAPSHOTS_MAX_EVENTS` to cap the accumulated buffer'
);

// ============================================================
// Test 13: Calls diffSnapshots(prevRef.current, snapshot)
// ============================================================
console.log('\nTest 13: Calls diffSnapshots(prevRef.current, snapshot)');
assert(
  /diffSnapshots\s*\(\s*prevRef\.current\s*,\s*snapshot\s*\)/.test(content),
  'Invokes `diffSnapshots(prevRef.current, snapshot)` on timestamp change'
);

// ============================================================
// Test 14: Hook signature includes snapshot AND connectionStatus
// ============================================================
console.log('\nTest 14: Hook signature accepts snapshot AND connectionStatus');
assert(
  /useActivityFeed\s*\(\s*snapshot\s*:\s*Snapshot\s*\|\s*null\s*,\s*connectionStatus\s*:/.test(content),
  'Signature is `useActivityFeed(snapshot: Snapshot | null, connectionStatus: ...)`'
);

assert(
  /connectionStatus\s*:\s*['"]connecting['"]\s*\|\s*['"]connected['"]\s*\|\s*['"]disconnected['"]/.test(content),
  'connectionStatus parameter typed as the three-literal union'
);

// ============================================================
// Test 15: Returns ActivityEvent[]
// ============================================================
console.log('\nTest 15: Returns ActivityEvent[]');
assert(
  /\)\s*:\s*ActivityEvent\s*\[\s*\]/.test(content),
  'Hook return type annotated as `ActivityEvent[]`'
);

// ============================================================
// Test 16: No DOM/window access
// ============================================================
console.log('\nTest 16: No DOM or window access');
assert(
  !/\bdocument\./.test(content),
  'Does not access `document.*`'
);

assert(
  !/\bwindow\./.test(content),
  'Does not access `window.*`'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
