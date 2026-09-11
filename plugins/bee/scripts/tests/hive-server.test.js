#!/usr/bin/env node
// Test: hive-server.js — STRUCTURAL tests only.
// These tests read the source file as text and assert expected patterns via regex.
// They MUST NOT spawn the server. The conductor's real runtime verification lives
// elsewhere; this file exists to enforce the acceptance criteria of T1.1 at the
// source level so T1.7 can import and override /api/snapshot safely.

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

// Read the file under test
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
// Test 1: File exists and is a Node.js script
// ============================================================
console.log('Test 1: File exists and is a Node.js script');
assert(
  fs.existsSync(SRC_PATH),
  'hive-server.js exists at plugins/bee/scripts/hive-server.js'
);
assert(
  /^#!\/usr\/bin\/env node/.test(content),
  'File starts with node shebang'
);

// ============================================================
// Test 2: Zero runtime dependencies (only built-ins)
// ============================================================
console.log('\nTest 2: Zero runtime dependencies');
const requireCalls = [...content.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
const BUILTINS = new Set(['http', 'fs', 'path']);
const nonBuiltins = requireCalls.filter(r => !BUILTINS.has(r) && !r.startsWith('.') && !r.startsWith('/'));
assert(
  nonBuiltins.length === 0,
  `Only requires Node.js built-in modules (found non-builtin: ${nonBuiltins.join(', ') || 'none'})`
);
assert(
  requireCalls.includes('http'),
  'Requires the http built-in'
);
assert(
  requireCalls.includes('fs'),
  'Requires the fs built-in'
);
assert(
  requireCalls.includes('path'),
  'Requires the path built-in'
);

// ============================================================
// Test 3: Configurable port (default 3333, HIVE_PORT override)
// ============================================================
console.log('\nTest 3: Configurable port');
assert(
  /process\.env\.HIVE_PORT/.test(content),
  'Reads HIVE_PORT environment variable'
);
assert(
  /3333/.test(content),
  'References default port 3333'
);
// Default must be applied when HIVE_PORT is absent. We verify this structurally
// by requiring (a) a DEFAULT_PORT = 3333 declaration and (b) HIVE_PORT usage in
// the same file — the fallback can be expressed via ?? / || / conditional.
assert(
  /DEFAULT_PORT\s*=\s*3333/.test(content),
  'Declares DEFAULT_PORT = 3333 as the fallback constant'
);
assert(
  /DEFAULT_PORT/.test(content) && /HIVE_PORT/.test(content),
  'DEFAULT_PORT fallback is present alongside HIVE_PORT override'
);

// ============================================================
// Test 4: Localhost-only binding (127.0.0.1)
// ============================================================
console.log('\nTest 4: Localhost-only binding');
assert(
  /['"]127\.0\.0\.1['"]/.test(content),
  'Binds to 127.0.0.1 (localhost only)'
);
// Should NOT bind to 0.0.0.0 (public interfaces)
assert(
  !/['"]0\.0\.0\.0['"]/.test(content),
  'Does NOT bind to 0.0.0.0 (public interfaces)'
);

// ============================================================
// Test 5: Configurable static dir (HIVE_STATIC_DIR, default hive-dist relative to __dirname)
// ============================================================
console.log('\nTest 5: Static directory configuration');
assert(
  /process\.env\.HIVE_STATIC_DIR/.test(content),
  'Reads HIVE_STATIC_DIR environment variable'
);
assert(
  /hive-dist/.test(content),
  'References default static directory hive-dist'
);
assert(
  /path\.join\(\s*__dirname\s*,\s*['"]hive-dist['"]/.test(content),
  'Default static dir resolved relative to __dirname (not cwd)'
);

// ============================================================
// Test 6: MIME_TYPES table covers required extensions
// ============================================================
console.log('\nTest 6: MIME_TYPES table');
assert(
  /const\s+MIME_TYPES\s*=/.test(content),
  'Defines MIME_TYPES constant'
);
const mimeBlockMatch = content.match(/MIME_TYPES\s*=\s*\{[\s\S]*?\}/);
const mimeBlock = mimeBlockMatch ? mimeBlockMatch[0] : '';
assert(
  /['"]\.html['"]\s*:\s*['"]text\/html['"]/.test(mimeBlock),
  'MIME_TYPES maps .html to text/html'
);
assert(
  /['"]\.css['"]\s*:\s*['"]text\/css['"]/.test(mimeBlock),
  'MIME_TYPES maps .css to text/css'
);
assert(
  /['"]\.js['"]\s*:\s*['"]application\/javascript['"]/.test(mimeBlock),
  'MIME_TYPES maps .js to application/javascript'
);
assert(
  /['"]\.json['"]\s*:\s*['"]application\/json['"]/.test(mimeBlock),
  'MIME_TYPES maps .json to application/json'
);
assert(
  /['"]\.png['"]\s*:\s*['"]image\/png['"]/.test(mimeBlock),
  'MIME_TYPES maps .png to image/png'
);
assert(
  /['"]\.jpg['"]\s*:\s*['"]image\/jpeg['"]/.test(mimeBlock),
  'MIME_TYPES maps .jpg to image/jpeg'
);
assert(
  /['"]\.jpeg['"]\s*:\s*['"]image\/jpeg['"]/.test(mimeBlock),
  'MIME_TYPES maps .jpeg to image/jpeg'
);
assert(
  /['"]\.gif['"]\s*:\s*['"]image\/gif['"]/.test(mimeBlock),
  'MIME_TYPES maps .gif to image/gif'
);
assert(
  /['"]\.svg['"]\s*:\s*['"]image\/svg\+xml['"]/.test(mimeBlock),
  'MIME_TYPES maps .svg to image/svg+xml'
);

// ============================================================
// Test 7: /api/snapshot stub
// ============================================================
console.log('\nTest 7: /api/snapshot stub');
assert(
  /\/api\/snapshot/.test(content),
  'Defines /api/snapshot route'
);
assert(
  /new Date\(\)\.toISOString\(\)/.test(content),
  'Snapshot stub returns current ISO timestamp'
);
assert(
  /application\/json/.test(content),
  'Snapshot stub uses application/json Content-Type'
);
assert(
  /timestamp/.test(content),
  'Snapshot stub response body includes timestamp field'
);

// ============================================================
// Test 8: SPA fallback for non-API routes
// ============================================================
console.log('\nTest 8: SPA fallback');
assert(
  /index\.html/.test(content),
  'References index.html for SPA fallback'
);
// SPA fallback must live on the non-API request path
assert(
  /\/api\//.test(content),
  'Distinguishes /api/ routes from static/SPA routes'
);

// ============================================================
// Test 9: Startup log as JSON line { type: 'server-started', ... }
// ============================================================
console.log('\nTest 9: Startup log JSON line');
assert(
  /server-started/.test(content),
  'Startup log uses type: server-started'
);
assert(
  /JSON\.stringify/.test(content),
  'Startup log is emitted via JSON.stringify'
);
assert(
  /console\.log/.test(content),
  'Startup log uses console.log (stdout)'
);
// The log payload should include port, host, url fields
const startupBlockMatch = content.match(/server-started[\s\S]{0,400}/);
const startupBlock = startupBlockMatch ? startupBlockMatch[0] : '';
assert(
  /port/.test(startupBlock) && /host/.test(startupBlock) && /url/.test(startupBlock),
  'Startup log payload includes port, host, and url fields'
);

// ============================================================
// Test 10: Exports createServer and/or handleRequest for T1.7 wiring
// ============================================================
console.log('\nTest 10: Module exports for T1.7 override hook');
assert(
  /module\.exports/.test(content),
  'Uses module.exports'
);
assert(
  /module\.exports[\s\S]{0,300}(createServer|handleRequest)/.test(content),
  'Exports createServer and/or handleRequest'
);
// Both are preferred so T1.7 can either replace the snapshot handler or mount
// a new handler on an existing server instance.
assert(
  /createServer/.test(content),
  'Defines a createServer function'
);
assert(
  /handleRequest/.test(content),
  'Defines a handleRequest function'
);

// ============================================================
// Test 11: Does not auto-start when require'd
// ============================================================
console.log('\nTest 11: No auto-start on require');
assert(
  /require\.main\s*===\s*module/.test(content),
  'Guards server startup with require.main === module'
);
const listenMatches = [...content.matchAll(/\.listen\s*\(/g)];
assert(
  listenMatches.length >= 1,
  'Calls .listen at least once'
);
// Structural check: every .listen( callsite must be inside a function body so
// it can only run when that function is invoked — never at module top level.
// We verify this by confirming that for each .listen( there is a `function`
// keyword earlier in the file without a matching closing `}` at module scope.
// Simpler proxy: the startup function exists and is called only from inside
// the require.main guard block.
assert(
  /function\s+startServer\s*\(/.test(content) || /const\s+startServer\s*=/.test(content),
  'Defines a startServer function that wraps .listen'
);
// Confirm startServer() is invoked inside the require.main guard.
const guardBlockMatch = content.match(/if\s*\(\s*require\.main\s*===\s*module\s*\)\s*\{([\s\S]*?)\n\}/);
assert(
  guardBlockMatch !== null,
  'require.main guard is a well-formed block'
);
assert(
  guardBlockMatch !== null && /startServer\s*\(/.test(guardBlockMatch[1]),
  'startServer() is invoked inside the require.main guard'
);
// And .listen is NEVER called at module top level (i.e. outside any function).
// We approximate this by ensuring no .listen( appears before the first function
// definition, and no .listen( appears at column 0 without a preceding function.
const topLevelListen = /^\.listen\s*\(/m.test(content) ||
                        /^\s*server\.listen\s*\(/m.test(content.split(/function\s+\w+\s*\(/)[0] || '');
assert(
  !topLevelListen,
  '.listen is not invoked at module top level'
);

// ============================================================
// Test 12: 404 for missing static files (explicit handling)
// ============================================================
console.log('\nTest 12: 404 handling for missing static files');
assert(
  /404/.test(content),
  'References 404 status code for missing files'
);

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
