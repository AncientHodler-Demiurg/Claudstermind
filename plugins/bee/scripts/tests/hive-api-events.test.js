#!/usr/bin/env node
// Test: hive-server.js + hive-snapshot.js GET /api/events endpoint.
//
// Two-pronged strategy:
//   1) STRUCTURAL — regex over source text for the wiring contract
//      (handler stub + setter, routing block, exports, entry-point wiring).
//      Mirrors hive-api-file.test.js; no filesystem side effects.
//   2) BEHAVIORAL — direct invocation of createEventsHandler(beeDir) with a
//      temp fixture directory + mock req/res shims. Exercises every query-
//      parameter branch (defaults, limit clamp, since filter, yesterday
//      boundary, malformed inputs), missing-file tolerance, malformed-line
//      skipping, and the response envelope shape.
//
// No server spawn, no port management, no external deps — just Node built-ins
// (fs, path, os, events).
//
// Quick 011 acceptance coverage:
//   AC1 — GET /api/events (no query) returns 200 with {events, latest_ts, count, has_more}
//   AC2 — since=<future> returns empty
//   AC3 — limit=10 truncates, has_more=true when more exist
//   AC4 — limit=999999 clamps to EVENTS_MAX_LIMIT (no crash)
//   AC5 — since=not-a-timestamp returns 400
//   AC6 — limit=abc returns 400
//   AC7 — POST /api/events returns 405 with Allow: GET (structural route check)
//   AC8 — missing today's jsonl returns 200 empty
//   AC9 — malformed lines are skipped, valid lines still returned
//   AC10 — since before today's midnight reads yesterday's file too
//   AC11 — createEventsHandler/setEventsHandler wired in module.exports + entry-point
//   AC12 — response headers include Content-Type + Cache-Control

const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const SRC_SERVER = path.join(__dirname, '..', 'hive-server.js');
const SRC_SNAPSHOT = path.join(__dirname, '..', 'hive-snapshot.js');

let passed = 0;
let failed = 0;

// Centralized temp-dir tracking — mirrors hooks-emit-event.test.js:48-74.
// Every temp dir created during the test must go through makeTmpRoot so that
// cleanupTmpDirs() at the end can remove all of them, not just the first one.
const tmpDirs = [];

function makeTmpRoot(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function cleanupTmpDirs() {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_e) {
      // best-effort — leaked dirs will be swept on next reboot
    }
  }
  tmpDirs.length = 0;
}

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
// Load source text for structural checks
// ============================================================
let serverSrc;
let snapshotSrc;
try {
  serverSrc = fs.readFileSync(SRC_SERVER, 'utf8');
  snapshotSrc = fs.readFileSync(SRC_SNAPSHOT, 'utf8');
} catch (e) {
  console.log('FAIL: could not load source files for structural tests');
  console.log(`  Expected server: ${SRC_SERVER}`);
  console.log(`  Expected snapshot: ${SRC_SNAPSHOT}`);
  console.log(`  Error: ${e.message}`);
  console.log('\nResults: 0 passed, 1 failed out of 1 assertions');
  process.exit(1);
}

// ============================================================
// Test 1: Events handler stub + setter in hive-server.js
// ============================================================
console.log('Test 1: Events handler stub + setter (hive-server.js)');
assert(
  /let\s+eventsHandler\s*=\s*function\s+defaultEventsHandler/.test(serverSrc),
  'defines `let eventsHandler = function defaultEventsHandler`'
);
assert(
  /function\s+setEventsHandler\s*\(\s*fn\s*\)/.test(serverSrc),
  'defines `function setEventsHandler(fn)` setter'
);
assert(
  /setEventsHandler[\s\S]{0,200}?typeof\s+fn\s*!==\s*['"]function['"]/.test(
    serverSrc
  ),
  'setEventsHandler validates argument with `typeof fn !== "function"`'
);
assert(
  /setEventsHandler[\s\S]{0,200}?TypeError/.test(serverSrc),
  'setEventsHandler throws TypeError on invalid input'
);

// ============================================================
// Test 2: /api/events routing in handleRequest
// ============================================================
console.log('\nTest 2: /api/events routing in handleRequest');
assert(
  /url\s*===\s*['"]\/api\/events['"]/.test(serverSrc),
  'routes exact match `/api/events`'
);
assert(
  /url\.startsWith\s*\(\s*['"]\/api\/events\?['"]\s*\)/.test(serverSrc),
  'routes querystring form `/api/events?...`'
);
const eventsRouteIndex = serverSrc.indexOf("url === '/api/events'");
assert(
  eventsRouteIndex !== -1,
  'found /api/events route anchor for slice-based checks'
);
const eventsRouteSlice =
  eventsRouteIndex !== -1
    ? serverSrc.slice(eventsRouteIndex, eventsRouteIndex + 1200)
    : '';
assert(
  /req\.method\s*!==\s*['"]GET['"]/.test(eventsRouteSlice),
  'checks `req.method !== "GET"` inside the /api/events route'
);
assert(
  /405/.test(eventsRouteSlice),
  'responds 405 for non-GET methods'
);
assert(
  /Allow['"]?\s*:\s*['"]GET['"]/.test(eventsRouteSlice),
  'sets Allow: GET header on 405 response'
);
assert(
  /eventsHandler\s*\(\s*req\s*,\s*res\s*\)/.test(eventsRouteSlice),
  'delegates to eventsHandler(req, res) inside the route'
);

// The route must come BEFORE the generic /api/ 404 catch-all, else a POST
// to /api/events would 404 instead of 405.
const apiCatchAllIndex = serverSrc.indexOf("if (url.startsWith('/api/'))");
assert(
  apiCatchAllIndex !== -1 && eventsRouteIndex < apiCatchAllIndex,
  '/api/events route is registered BEFORE the generic /api/ 404 catch-all'
);

// ============================================================
// Test 3: module.exports include setEventsHandler + sendJsonError
// ============================================================
console.log('\nTest 3: hive-server.js module.exports');
const serverExportsStart = serverSrc.indexOf('module.exports');
assert(
  serverExportsStart !== -1,
  'hive-server.js has a module.exports block'
);
const serverExportsSlice =
  serverExportsStart !== -1 ? serverSrc.slice(serverExportsStart) : '';
assert(
  /setEventsHandler/.test(serverExportsSlice),
  'hive-server.js module.exports includes setEventsHandler'
);
// sendJsonError lives in the neutral-leaf hive-http-utils.js (post-S-003
// architectural refactor — see hive-http-utils.js header for the DAG topology).
// hive-server.js imports it at the top and re-exports it here so downstream
// callers can reach the helper without knowing the leaf module exists.
assert(
  /sendJsonError/.test(serverExportsSlice),
  'hive-server.js module.exports includes sendJsonError (re-exported from hive-http-utils)'
);

// ============================================================
// Test 4: Entry-point wiring for createEventsHandler
// ============================================================
console.log('\nTest 4: Entry-point wiring');
assert(
  /createEventsHandler/.test(serverSrc),
  'hive-server.js references createEventsHandler'
);
assert(
  /setEventsHandler\s*\(\s*createEventsHandler\s*\(\s*beeDir\s*\)\s*\)/.test(
    serverSrc
  ),
  'entry-point wires setEventsHandler(createEventsHandler(beeDir))'
);

// ============================================================
// Test 5: createEventsHandler factory in hive-snapshot.js
// ============================================================
console.log('\nTest 5: createEventsHandler factory (hive-snapshot.js)');
assert(
  /function\s+createEventsHandler\s*\(\s*beeDir\s*\)/.test(snapshotSrc),
  'defines `function createEventsHandler(beeDir)`'
);
assert(
  /const\s+EVENTS_DEFAULT_LIMIT\s*=\s*500/.test(snapshotSrc),
  'EVENTS_DEFAULT_LIMIT constant is 500'
);
assert(
  /const\s+EVENTS_MAX_LIMIT\s*=\s*5000/.test(snapshotSrc),
  'EVENTS_MAX_LIMIT constant is 5000'
);
const snapshotExportsStart = snapshotSrc.indexOf('module.exports');
const snapshotExportsSlice =
  snapshotExportsStart !== -1 ? snapshotSrc.slice(snapshotExportsStart) : '';
assert(
  /createEventsHandler/.test(snapshotExportsSlice),
  'hive-snapshot.js module.exports includes createEventsHandler'
);
assert(
  /EVENTS_DEFAULT_LIMIT/.test(snapshotExportsSlice),
  'hive-snapshot.js module.exports includes EVENTS_DEFAULT_LIMIT'
);
assert(
  /EVENTS_MAX_LIMIT/.test(snapshotExportsSlice),
  'hive-snapshot.js module.exports includes EVENTS_MAX_LIMIT'
);

// ============================================================
// Test 6: Response headers (structural check)
// ============================================================
console.log('\nTest 6: Response headers (Content-Type + Cache-Control)');
// The factory MUST set both headers on the 200 response.
const factoryIndex = snapshotSrc.indexOf('function createEventsHandler');
const factorySlice =
  factoryIndex !== -1 ? snapshotSrc.slice(factoryIndex, factoryIndex + 6000) : '';
assert(
  /['"]Content-Type['"]\s*:\s*['"]application\/json['"]/.test(factorySlice),
  'factory sets Content-Type: application/json'
);
assert(
  /['"]Cache-Control['"]\s*:\s*['"]no-store['"]/.test(factorySlice),
  'factory sets Cache-Control: no-store'
);

// ============================================================
// Behavioral setup: temp beeDir with fixture jsonl files
// ============================================================
console.log('\nBehavioral setup: temp bee directory with fixture events');

const tmpBase = makeTmpRoot('bee-api-events-');
const tmpBeeDir = path.join(tmpBase, '.bee');
const tmpEventsDir = path.join(tmpBeeDir, 'events');
fs.mkdirSync(tmpEventsDir, { recursive: true });

const todayUtc = new Date().toISOString().slice(0, 10);
const yesterdayUtc = new Date(Date.parse(todayUtc + 'T00:00:00.000Z') - 86400000)
  .toISOString()
  .slice(0, 10);

function event(ts, kind, tool, filePath) {
  return {
    ts,
    session: 'test-sess',
    kind,
    tool: tool || null,
    agent: null,
    filePath: filePath || null,
    command: null,
    durationMs: null,
    success: null,
    cwd: '/tmp/test',
  };
}

// Seed today's file with 3 valid events, 1 empty line, 1 malformed line.
const todayLines = [
  JSON.stringify(event(todayUtc + 'T10:00:00.000Z', 'pre_tool_use', 'Read', 'a.ts')),
  JSON.stringify(event(todayUtc + 'T10:00:01.000Z', 'post_tool_use', 'Read', 'a.ts')),
  '', // empty line — must be skipped
  '{this is not valid json', // malformed line — must be skipped
  JSON.stringify(event(todayUtc + 'T10:00:02.000Z', 'pre_tool_use', 'Edit', 'b.ts')),
];
fs.writeFileSync(
  path.join(tmpEventsDir, todayUtc + '.jsonl'),
  todayLines.join('\n') + '\n',
  'utf8'
);

// Seed yesterday's file with 2 events at 23:59 UTC.
const yesterdayLines = [
  JSON.stringify(event(yesterdayUtc + 'T23:59:00.000Z', 'pre_tool_use', 'Bash', null)),
  JSON.stringify(event(yesterdayUtc + 'T23:59:30.000Z', 'post_tool_use', 'Bash', null)),
];
fs.writeFileSync(
  path.join(tmpEventsDir, yesterdayUtc + '.jsonl'),
  yesterdayLines.join('\n') + '\n',
  'utf8'
);

// ============================================================
// Mock req / res shims
// ============================================================
//
// The factory calls `new URL(req.url, 'http://localhost')` and then writes to
// res via `res.writeHead(status, headers)` + `res.end(body)`. It does NOT
// read a request body (GET only) and does NOT wait on req events. That lets
// us use a tiny synchronous shim that captures status/headers/body.

function makeReq(rawUrl) {
  const req = new EventEmitter();
  req.method = 'GET';
  req.url = rawUrl;
  return req;
}

function makeRes() {
  const res = new EventEmitter();
  res.status = null;
  res.headers = null;
  res.body = '';
  res.ended = false;
  res.headersSent = false;
  res.writableEnded = false;
  res.writeHead = (status, headers) => {
    res.status = status;
    res.headers = headers || {};
    res.headersSent = true;
  };
  res.write = (chunk) => {
    res.body += String(chunk);
  };
  res.end = (chunk) => {
    if (chunk !== undefined) {
      res.body += String(chunk);
    }
    res.ended = true;
    res.writableEnded = true;
  };
  return res;
}

// ============================================================
// Require the factory
// ============================================================
let createEventsHandler;
let EVENTS_MAX_LIMIT_RT;
try {
  const snapshotMod = require('../hive-snapshot');
  createEventsHandler = snapshotMod.createEventsHandler;
  EVENTS_MAX_LIMIT_RT = snapshotMod.EVENTS_MAX_LIMIT;
} catch (e) {
  console.log(`FAIL: could not require hive-snapshot: ${e.message}`);
  failed++;
}

// ============================================================
// Test 7: GET /api/events (no query) returns today's events
// ============================================================
console.log('\nTest 7: AC1 — default query returns today events since midnight');
if (typeof createEventsHandler === 'function') {
  const handler = createEventsHandler(tmpBeeDir);
  const req = makeReq('/api/events');
  const res = makeRes();
  handler(req, res);
  assert(res.status === 200, 'response status is 200');
  assert(
    res.headers && res.headers['Content-Type'] === 'application/json',
    'Content-Type: application/json'
  );
  assert(
    res.headers && res.headers['Cache-Control'] === 'no-store',
    'Cache-Control: no-store'
  );
  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch (_e) {
    parsed = null;
  }
  assert(parsed !== null, 'response body parses as JSON');
  if (parsed) {
    assert(Array.isArray(parsed.events), 'events is an array');
    assert(typeof parsed.count === 'number', 'count is a number');
    assert(typeof parsed.has_more === 'boolean', 'has_more is a boolean');
    assert(typeof parsed.latest_ts === 'string', 'latest_ts is a string');
    // 3 valid events today (malformed + empty lines skipped).
    assert(parsed.events.length === 3, 'returns 3 valid today events');
    assert(parsed.count === 3, 'count matches events length');
    assert(parsed.has_more === false, 'has_more is false below limit');
    assert(
      parsed.events[0].ts.localeCompare(parsed.events[1].ts) <= 0,
      'events are sorted chronologically (oldest first)'
    );
    assert(
      parsed.events[parsed.events.length - 1].ts === parsed.latest_ts,
      'latest_ts matches last event ts'
    );
    // Default since = todayUtc + 'T00:00:00.000Z' → yesterday's events excluded.
    const hasYesterdayEvent = parsed.events.some((ev) =>
      ev.ts.startsWith(yesterdayUtc)
    );
    assert(
      !hasYesterdayEvent,
      'default since excludes yesterdays events'
    );
  }
}

// ============================================================
// Test 8: since=<future> returns empty events
// ============================================================
console.log('\nTest 8: AC2 — since=<future> returns empty events');
if (typeof createEventsHandler === 'function') {
  const handler = createEventsHandler(tmpBeeDir);
  const req = makeReq('/api/events?since=2099-12-31T23:59:59.999Z');
  const res = makeRes();
  handler(req, res);
  assert(res.status === 200, 'status 200 (not 404) for future since');
  const parsed = JSON.parse(res.body);
  assert(parsed.events.length === 0, 'events array is empty');
  assert(parsed.count === 0, 'count is 0');
  assert(parsed.has_more === false, 'has_more is false');
  assert(
    parsed.latest_ts === '2099-12-31T23:59:59.999Z',
    'latest_ts falls back to since when empty'
  );
}

// ============================================================
// Test 9: limit=2 truncates to most recent, sets has_more
// ============================================================
console.log('\nTest 9: AC3 — limit=2 truncates to most recent, has_more=true');
if (typeof createEventsHandler === 'function') {
  const handler = createEventsHandler(tmpBeeDir);
  const req = makeReq('/api/events?limit=2');
  const res = makeRes();
  handler(req, res);
  assert(res.status === 200, 'status 200');
  const parsed = JSON.parse(res.body);
  assert(parsed.events.length === 2, 'returns exactly 2 events');
  assert(parsed.count === 2, 'count is 2');
  assert(parsed.has_more === true, 'has_more is true');
  // Most recent 2 events — the tail of a 3-event today file.
  assert(
    parsed.events[0].ts === todayUtc + 'T10:00:01.000Z',
    'first returned event is the 2nd-most-recent (middle)'
  );
  assert(
    parsed.events[1].ts === todayUtc + 'T10:00:02.000Z',
    'last returned event is the most recent'
  );
}

// ============================================================
// Test 10: limit=999999 clamps to EVENTS_MAX_LIMIT (no crash)
// ============================================================
console.log('\nTest 10: AC4 — limit=999999 clamps to EVENTS_MAX_LIMIT');
if (typeof createEventsHandler === 'function') {
  const handler = createEventsHandler(tmpBeeDir);
  const req = makeReq('/api/events?limit=999999');
  const res = makeRes();
  let threw = false;
  try {
    handler(req, res);
  } catch (_e) {
    threw = true;
  }
  assert(!threw, 'handler does not throw on huge limit');
  assert(res.status === 200, 'status 200 (clamped, not rejected)');
  const parsed = JSON.parse(res.body);
  // We have only 3 today events, far below the clamped 5000.
  assert(parsed.events.length === 3, 'returns all available events');
  assert(parsed.has_more === false, 'has_more false when below clamped limit');
  assert(
    typeof EVENTS_MAX_LIMIT_RT === 'number' && EVENTS_MAX_LIMIT_RT === 5000,
    'EVENTS_MAX_LIMIT exported as 5000'
  );
}

// ============================================================
// Test 11: since=not-a-timestamp → 400
// ============================================================
console.log('\nTest 11: AC5 — since=not-a-timestamp returns 400');
if (typeof createEventsHandler === 'function') {
  const handler = createEventsHandler(tmpBeeDir);
  const req = makeReq('/api/events?since=not-a-timestamp');
  const res = makeRes();
  handler(req, res);
  assert(res.status === 400, 'status 400 for malformed since');
  const parsed = JSON.parse(res.body);
  assert(typeof parsed.error === 'string', 'error field is a string');
  assert(/since/i.test(parsed.error), 'error message mentions since');
}

// ============================================================
// Test 12: limit=abc → 400
// ============================================================
console.log('\nTest 12: AC6 — limit=abc returns 400');
if (typeof createEventsHandler === 'function') {
  const handler = createEventsHandler(tmpBeeDir);
  const req = makeReq('/api/events?limit=abc');
  const res = makeRes();
  handler(req, res);
  assert(res.status === 400, 'status 400 for malformed limit');
  const parsed = JSON.parse(res.body);
  assert(typeof parsed.error === 'string', 'error field is a string');
  assert(/limit/i.test(parsed.error), 'error message mentions limit');
}

// ============================================================
// Test 13: missing today jsonl → 200 empty
// ============================================================
console.log('\nTest 13: AC8 — missing today jsonl returns 200 empty');
if (typeof createEventsHandler === 'function') {
  // Create a second tmp beeDir WITHOUT any jsonl files.
  const emptyBase = makeTmpRoot('bee-api-events-empty-');
  const emptyBeeDir = path.join(emptyBase, '.bee');
  fs.mkdirSync(path.join(emptyBeeDir, 'events'), { recursive: true });

  const handler = createEventsHandler(emptyBeeDir);
  const req = makeReq('/api/events');
  const res = makeRes();
  let threw = false;
  try {
    handler(req, res);
  } catch (_e) {
    threw = true;
  }
  assert(!threw, 'handler does not throw when today file is missing');
  assert(res.status === 200, 'status 200 (not 404) for missing file');
  const parsed = JSON.parse(res.body);
  assert(parsed.events.length === 0, 'events array is empty');
  assert(parsed.count === 0, 'count is 0');
  assert(parsed.has_more === false, 'has_more is false');
}

// ============================================================
// Test 14: malformed lines skipped, valid lines still returned
// ============================================================
console.log(
  '\nTest 14: AC9 — malformed lines are skipped, valid lines still returned'
);
if (typeof createEventsHandler === 'function') {
  // Already seeded in today's file: 3 valid + 1 empty + 1 malformed.
  const handler = createEventsHandler(tmpBeeDir);
  const req = makeReq('/api/events');
  const res = makeRes();
  handler(req, res);
  const parsed = JSON.parse(res.body);
  // If malformed lines weren't silently skipped, parse would fail the handler
  // or we'd get fewer than 3 valid events.
  assert(
    parsed.events.length === 3,
    'returns 3 valid events despite empty + malformed lines'
  );
  // Every returned event has the full 10-field shape.
  for (const ev of parsed.events) {
    if (!ev) continue;
    assert(
      typeof ev.ts === 'string' && typeof ev.kind === 'string',
      `event has required ts + kind (ts=${ev.ts})`
    );
  }
}

// ============================================================
// Test 15: since before today's midnight reads yesterday too
// ============================================================
console.log(
  "\nTest 15: AC10 — since before today's midnight reads yesterdays file too"
);
if (typeof createEventsHandler === 'function') {
  const handler = createEventsHandler(tmpBeeDir);
  const req = makeReq(
    '/api/events?since=' + yesterdayUtc + 'T00:00:00.000Z'
  );
  const res = makeRes();
  handler(req, res);
  assert(res.status === 200, 'status 200');
  const parsed = JSON.parse(res.body);
  // 2 yesterday events + 3 today events = 5 total.
  assert(
    parsed.events.length === 5,
    'returns yesterday + today events (5 total)'
  );
  // Must be sorted oldest-first.
  let sortedOk = true;
  for (let i = 1; i < parsed.events.length; i++) {
    if (parsed.events[i - 1].ts.localeCompare(parsed.events[i].ts) > 0) {
      sortedOk = false;
      break;
    }
  }
  assert(sortedOk, 'events are sorted oldest-first across both files');
  // First event should be from yesterday.
  assert(
    parsed.events[0].ts.startsWith(yesterdayUtc),
    'first event is from yesterday'
  );
  // Last event should be from today.
  assert(
    parsed.events[parsed.events.length - 1].ts.startsWith(todayUtc),
    'last event is from today'
  );
}

// ============================================================
// Test 16: since on boundary (inclusive >= filter — E2E-001 fix)
// ============================================================
console.log('\nTest 16: since filter is inclusive (>=) at the boundary');
if (typeof createEventsHandler === 'function') {
  const handler = createEventsHandler(tmpBeeDir);
  // Set since to the exact ts of the first today event. Per E2E-001 audit
  // fix, the filter is now `ev.ts >= since`, so boundary events must be
  // INCLUDED. Client-side dedup (composite key) handles the steady-state
  // duplicate that `>=` produces when the baseline repeats across polls.
  const req = makeReq(
    '/api/events?since=' + encodeURIComponent(todayUtc + 'T10:00:00.000Z')
  );
  const res = makeRes();
  handler(req, res);
  const parsed = JSON.parse(res.body);
  const hasBoundary = parsed.events.some(
    (ev) => ev.ts === todayUtc + 'T10:00:00.000Z'
  );
  assert(hasBoundary, 'events with ts equal to since are INCLUDED (>= filter)');
  assert(
    parsed.events.length === 3,
    'returns 3 events (the boundary event + the two strictly after)'
  );
}

// ============================================================
// Test 17: events dir missing entirely (graceful degradation)
// ============================================================
console.log('\nTest 17: events directory missing entirely → 200 empty');
if (typeof createEventsHandler === 'function') {
  const noEventsBase = makeTmpRoot('bee-api-events-noeventsdir-');
  const noEventsBeeDir = path.join(noEventsBase, '.bee');
  fs.mkdirSync(noEventsBeeDir, { recursive: true });
  // Deliberately do NOT create the events subdir.

  const handler = createEventsHandler(noEventsBeeDir);
  const req = makeReq('/api/events');
  const res = makeRes();
  let threw = false;
  try {
    handler(req, res);
  } catch (_e) {
    threw = true;
  }
  assert(!threw, 'handler does not throw when events dir is missing');
  assert(res.status === 200, 'status 200');
  const parsed = JSON.parse(res.body);
  assert(parsed.events.length === 0, 'events empty');
}

// ============================================================
// Cleanup temp directories (all tracked via tmpDirs[])
// ============================================================
cleanupTmpDirs();

// ============================================================
// Summary
// ============================================================
const total = passed + failed;
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${total} assertions`);
process.exit(failed > 0 ? 1 : 0);
