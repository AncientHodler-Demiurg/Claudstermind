#!/usr/bin/env node
// Test: dashboard-use-snapshot — STRUCTURAL tests only.
//
// Verifies that plugins/bee/dashboard/src/hooks/useSnapshot.ts exists and
// implements the polling contract described by T3.4.
//
// Acceptance reference: T3.4 in
//   .bee/specs/2026-04-10-bee-board-dashboard/phases/03-dashboard-spa/TASKS.md

const fs = require('fs');
const path = require('path');

const HOOK_FILE = path.join(
  __dirname, '..', '..', 'dashboard', 'src', 'hooks', 'useSnapshot.ts'
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
  'plugins/bee/dashboard/src/hooks/useSnapshot.ts exists'
);

if (!fs.existsSync(HOOK_FILE)) {
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  process.exit(1);
}

const content = fs.readFileSync(HOOK_FILE, 'utf8');

// ============================================================
// Test 2: Exports useSnapshot hook
// ============================================================
console.log('\nTest 2: Exports useSnapshot hook');
assert(
  /export\s+function\s+useSnapshot\s*\(/.test(content) ||
  /export\s+const\s+useSnapshot\s*=/.test(content),
  'Exports `useSnapshot` as function or const'
);

// ============================================================
// Test 3: intervalMs parameter with default 5000
// ============================================================
console.log('\nTest 3: intervalMs parameter with default 5000');
assert(
  /intervalMs[^=]*=\s*5000/.test(content),
  'useSnapshot declares `intervalMs` parameter with default 5000'
);

// ============================================================
// Test 4: Exports ConnectionStatusValue type
// ============================================================
console.log('\nTest 4: Exports ConnectionStatusValue type');
assert(
  /export\s+type\s+ConnectionStatusValue\s*=/.test(content),
  'Exports `ConnectionStatusValue` type'
);

assert(
  /['"]connecting['"]/.test(content) &&
  /['"]connected['"]/.test(content) &&
  /['"]disconnected['"]/.test(content),
  'ConnectionStatusValue includes connecting/connected/disconnected literals'
);

// ============================================================
// Test 5: References /api/snapshot endpoint
// ============================================================
console.log('\nTest 5: Fetches /api/snapshot');
assert(
  /['"`]\/api\/snapshot['"`]/.test(content),
  'References `/api/snapshot` endpoint'
);

// ============================================================
// Test 6: Uses fetch with cache: 'no-store' literal
// ============================================================
console.log('\nTest 6: Uses fetch with cache: no-store');
assert(
  /\bfetch\s*\(/.test(content),
  'Calls `fetch(...)`'
);

assert(
  /cache\s*:\s*['"]no-store['"]/.test(content),
  'Passes `cache: \'no-store\'` literal to fetch options'
);

// ============================================================
// Test 7: setInterval + clearInterval for polling
// ============================================================
console.log('\nTest 7: setInterval + clearInterval for polling loop');
assert(
  /\bsetInterval\s*\(/.test(content),
  'Calls `setInterval(...)` to schedule polling'
);

assert(
  /\bclearInterval\s*\(/.test(content),
  'Calls `clearInterval(...)` on cleanup'
);

// ============================================================
// Test 8: AbortController usage
// ============================================================
console.log('\nTest 8: AbortController usage');
assert(
  /new\s+AbortController\s*\(/.test(content),
  'Creates `new AbortController()` instance'
);

assert(
  /signal\s*:\s*(?:controller\.)?signal\b/.test(content) ||
  /\.signal\b/.test(content),
  'Passes `signal` to the fetch call'
);

// ============================================================
// Test 9: inFlightRef dedup pattern
// ============================================================
console.log('\nTest 9: inFlightRef dedup pattern (StrictMode safe)');
assert(
  /\binFlightRef\b/.test(content),
  'Declares an `inFlightRef` ref for request dedup'
);

assert(
  /useRef\s*<\s*AbortController\s*\|\s*null\s*>\s*\(\s*null\s*\)/.test(content),
  'Uses `useRef<AbortController | null>(null)` for inFlightRef'
);

assert(
  /inFlightRef\.current\s*&&\s*!\s*inFlightRef\.current\.signal\.aborted/.test(content),
  'Dedup check verifies `inFlightRef.current && !inFlightRef.current.signal.aborted`'
);

// ============================================================
// Test 10: Cleanup nulls ref synchronously and aborts
// ============================================================
console.log('\nTest 10: Cleanup aborts inFlightRef and nulls it');
assert(
  /inFlightRef\.current\s*\?\.\s*abort\s*\(\s*\)/.test(content) ||
  /inFlightRef\.current\s*&&\s*inFlightRef\.current\.abort\s*\(\s*\)/.test(content),
  'Cleanup calls `inFlightRef.current?.abort()`'
);

assert(
  /inFlightRef\.current\s*=\s*null/.test(content),
  'Cleanup nulls `inFlightRef.current = null`'
);

// ============================================================
// Test 11: catch block sets 'disconnected'
// ============================================================
console.log('\nTest 11: catch block sets disconnected');
// Walk each `catch (...) {` opener and use a brace counter to find the matching
// closer. A naive non-greedy regex stops at the first nested `}`, which would
// miss `setConnectionStatus('disconnected')` written below an early-return if.
function extractCatchBodies(src) {
  const bodies = [];
  const opener = /catch\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = opener.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    if (depth === 0) {
      bodies.push(src.slice(start, i - 1));
    }
  }
  return bodies;
}
const catchBodies = extractCatchBodies(content);
const foundDisconnectedInCatch = catchBodies.some(
  (body) => /['"]disconnected['"]/.test(body)
);
assert(
  foundDisconnectedInCatch,
  'A catch block sets connection status to `\'disconnected\'`'
);

// ============================================================
// Test 12: Imports Snapshot from @/types/snapshot
// ============================================================
console.log('\nTest 12: Imports Snapshot type from @/types/snapshot');
assert(
  /import\s+(?:type\s+)?\{[^}]*\bSnapshot\b[^}]*\}\s+from\s+['"]@\/types\/snapshot['"]/.test(content),
  'Imports `Snapshot` from `@/types/snapshot`'
);

// ============================================================
// Test 13: Return shape includes snapshot, connectionStatus, lastUpdated
// ============================================================
console.log('\nTest 13: Return shape includes snapshot, connectionStatus, lastUpdated');
assert(
  /\bsnapshot\b/.test(content) &&
  /\bconnectionStatus\b/.test(content) &&
  /\blastUpdated\b/.test(content),
  'References snapshot, connectionStatus, and lastUpdated identifiers'
);

// Same brace-matching walk used for catch — `return { ... }` may contain nested
// braces in real-world hooks, so a non-greedy regex would truncate the body.
function extractReturnObjectBodies(src) {
  const bodies = [];
  const opener = /return\s*\{/g;
  let m;
  while ((m = opener.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    if (depth === 0) {
      bodies.push(src.slice(start, i - 1));
    }
  }
  return bodies;
}
const returnBodies = extractReturnObjectBodies(content);
const foundReturnShape = returnBodies.some(
  (body) =>
    /\bsnapshot\b/.test(body) &&
    /\bconnectionStatus\b/.test(body) &&
    /\blastUpdated\b/.test(body)
);
assert(
  foundReturnShape,
  'Hook returns an object containing snapshot + connectionStatus + lastUpdated'
);

// ============================================================
// Test 14: useEffect drives the polling lifecycle
// ============================================================
console.log('\nTest 14: useEffect drives the polling lifecycle');
assert(
  /\buseEffect\s*\(/.test(content),
  'Uses `useEffect` for polling setup/cleanup'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
