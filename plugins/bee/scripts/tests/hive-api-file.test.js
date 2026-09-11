#!/usr/bin/env node
// Test: /api/file endpoint — STRUCTURAL tests across hive-server.js and
// hive-snapshot.js.
//
// These tests read the source files as text and assert expected patterns via
// regex. They MUST NOT spawn the server or touch the filesystem beyond reading
// the sources under test. End-to-end verification is done by the conductor via
// curl against a live server after restart.
//
// Post-S-003 topology: the `createFileHandler` factory, its constants, and all
// handler-internal defences (path traversal, allowlist, size, stat branches,
// response shape) now live in hive-snapshot.js alongside the other handler
// factories. hive-server.js still owns the fileHandler STUB, the setFileHandler
// setter, the /api/file routing block, and the entry-point wiring that calls
// setFileHandler(createFileHandler(beeDir)). Assertions are split accordingly:
//
//   - serverContent  — stub + setter, routing, method gate, module.exports
//                      (setFileHandler), entry-point wiring.
//   - snapshotContent — constants, factory, path traversal, absolute rejection,
//                       size limit, allowlist, 404/ENOENT/isFile, response
//                       shape, response headers, module.exports (createFileHandler).
//
// Assertion count is preserved (39 total) — zero behavior change.
//
// Covers Quick 002 acceptance criteria (still accurate after the refactor):
//   - fileHandler stub + setFileHandler setter follow the existing pattern
//   - createFileHandler(beeDir) factory exists and returns a request handler
//   - GET /api/file routing in handleRequest
//   - 405 method gate for non-GET methods
//   - Path traversal guard (literal `..` rejection + path.resolve containment)
//   - Size limit constant (1 MB / 1048576 bytes)
//   - Extension allowlist includes .md, .markdown, .txt, .json, .yml, .yaml
//   - Content-Type: application/json and Cache-Control: no-store headers
//   - setFileHandler exported from hive-server.js, createFileHandler exported
//     from hive-snapshot.js
//   - Wired in the entry-point guard via setFileHandler(createFileHandler(beeDir))

const fs = require('fs');
const path = require('path');

const SERVER_SRC = path.join(__dirname, '..', 'hive-server.js');
const SNAPSHOT_SRC = path.join(__dirname, '..', 'hive-snapshot.js');

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

let serverContent;
let snapshotContent;
try {
  serverContent = fs.readFileSync(SERVER_SRC, 'utf8');
  snapshotContent = fs.readFileSync(SNAPSHOT_SRC, 'utf8');
} catch (e) {
  console.log('FAIL: could not load source files');
  console.log(`  Expected server:   ${SERVER_SRC}`);
  console.log(`  Expected snapshot: ${SNAPSHOT_SRC}`);
  console.log(`  Error: ${e.message}`);
  console.log('\nResults: 0 passed, 1 failed out of 1 assertions');
  process.exit(1);
}

// ============================================================
// Test 1: File handler stub and setter follow the existing pattern (server)
// ============================================================
console.log('Test 1: File handler stub + setter (hive-server.js)');
assert(
  /let\s+fileHandler\s*=\s*function\s+defaultFileHandler/.test(serverContent),
  'defines `let fileHandler = function defaultFileHandler`'
);
assert(
  /function\s+setFileHandler\s*\(\s*fn\s*\)/.test(serverContent),
  'defines `function setFileHandler(fn)` setter'
);
assert(
  /setFileHandler[\s\S]*?typeof\s+fn\s*!==\s*['"]function['"]/.test(serverContent),
  'setFileHandler validates argument with `typeof fn !== "function"`'
);
assert(
  /setFileHandler[\s\S]*?TypeError/.test(serverContent),
  'setFileHandler throws TypeError on invalid input'
);

// ============================================================
// Test 2: Constants for size limit and extension allowlist (snapshot)
// ============================================================
console.log('\nTest 2: Size limit + extension allowlist constants (hive-snapshot.js)');
assert(
  /const\s+FILE_MAX_BYTES\s*=\s*1024\s*\*\s*1024/.test(snapshotContent) ||
    /const\s+FILE_MAX_BYTES\s*=\s*1048576/.test(snapshotContent),
  'FILE_MAX_BYTES constant is 1 MB (1024*1024 or 1048576)'
);
assert(
  /const\s+FILE_ALLOWED_EXTENSIONS\s*=\s*new\s+Set/.test(snapshotContent),
  'FILE_ALLOWED_EXTENSIONS is a Set'
);
assert(
  /['"]\.md['"]/.test(snapshotContent) &&
    /['"]\.markdown['"]/.test(snapshotContent) &&
    /['"]\.txt['"]/.test(snapshotContent) &&
    /['"]\.json['"]/.test(snapshotContent) &&
    /['"]\.yml['"]/.test(snapshotContent) &&
    /['"]\.yaml['"]/.test(snapshotContent),
  'allowlist contains .md, .markdown, .txt, .json, .yml, .yaml'
);

// ============================================================
// Test 3: createFileHandler factory (snapshot)
// ============================================================
console.log('\nTest 3: createFileHandler factory (hive-snapshot.js)');
assert(
  /function\s+createFileHandler\s*\(\s*beeDir\s*\)/.test(snapshotContent),
  'defines `function createFileHandler(beeDir)`'
);
assert(
  /createFileHandler[\s\S]*?path\.resolve\s*\(\s*beeDir\s*\)/.test(snapshotContent),
  'createFileHandler resolves beeDir via path.resolve()'
);

// ============================================================
// Test 4: Routing for /api/file in handleRequest (server)
// ============================================================
console.log('\nTest 4: /api/file routing in handleRequest (hive-server.js)');
assert(
  /url\s*===\s*['"]\/api\/file['"]/.test(serverContent) ||
    /\/api\/file['"]/.test(serverContent),
  'routes exact match `/api/file`'
);
assert(
  /url\.startsWith\s*\(\s*['"]\/api\/file\?['"]\s*\)/.test(serverContent),
  'routes querystring form `/api/file?...`'
);
assert(
  /fileHandler\s*\(\s*req\s*,\s*res\s*\)/.test(serverContent),
  'delegates to fileHandler(req, res) inside the route'
);

// ============================================================
// Test 5: 405 Method Not Allowed gate for non-GET (server)
// ============================================================
console.log('\nTest 5: 405 method gate (hive-server.js)');
// Look for a 405 response with Allow: GET inside the /api/file routing block.
// Use a slice around the /api/file routing to avoid catching the snapshot 405.
const fileRouteIndex = serverContent.indexOf("url === '/api/file'");
assert(
  fileRouteIndex !== -1,
  'found /api/file route anchor for slice-based checks'
);
const fileRouteSlice = fileRouteIndex !== -1
  ? serverContent.slice(fileRouteIndex, fileRouteIndex + 1200)
  : '';
assert(
  /req\.method\s*!==\s*['"]GET['"]/.test(fileRouteSlice),
  'checks `req.method !== "GET"` inside the /api/file route'
);
assert(
  /writeHead\s*\(\s*405/.test(fileRouteSlice) ||
    /sendJsonError\s*\(\s*res\s*,\s*405\b/.test(fileRouteSlice),
  'responds 405 for non-GET methods (via writeHead or sendJsonError)'
);
assert(
  /Allow['"]?\s*:\s*['"]GET['"]/.test(fileRouteSlice),
  'sets Allow: GET header on 405 response'
);

// ============================================================
// Test 6: Path traversal guard (snapshot)
// ============================================================
console.log('\nTest 6: Path traversal guard (hive-snapshot.js)');
assert(
  /\.\.['"]?\s*\)|seg\s*===\s*['"]\.\.['"]/.test(snapshotContent),
  'rejects literal `..` path segments'
);
// In hive-snapshot.js the containment check appears twice — once for the
// lexical resolve (`lexicalResolved !== rootResolved`) and once for the
// symlink-resolved path (`realPath !== rootResolved`). Match either flavour
// so the assertion stays accurate without coupling to the specific variable
// name createFileHandler uses internally.
assert(
  /(?:lexicalResolved|realPath|resolved)\s*!==\s*rootResolved[\s\S]{0,150}startsWith\s*\(\s*rootResolved\s*\+\s*path\.sep/.test(
    snapshotContent
  ),
  'uses containment check `<resolved> === rootResolved || startsWith(rootResolved + path.sep)`'
);
assert(
  /403/.test(snapshotContent),
  'uses 403 for path traversal rejection'
);

// ============================================================
// Test 7: Absolute-path rejection (snapshot)
// ============================================================
console.log('\nTest 7: Absolute path rejection (hive-snapshot.js)');
assert(
  /requestedPath\.startsWith\s*\(\s*['"]\/['"]\s*\)/.test(snapshotContent),
  'rejects absolute paths starting with /'
);

// ============================================================
// Test 8: Size limit check before read (snapshot)
// ============================================================
console.log('\nTest 8: Size limit check (hive-snapshot.js)');
assert(
  /stat\.size\s*>\s*FILE_MAX_BYTES/.test(snapshotContent),
  'checks `stat.size > FILE_MAX_BYTES` (stat before read)'
);
assert(
  /writeHead\s*\(\s*413/.test(snapshotContent) ||
    /sendJsonError\s*\(\s*res\s*,\s*413\b/.test(snapshotContent),
  'responds 413 for oversized files (via writeHead or sendJsonError)'
);

// ============================================================
// Test 9: Extension allowlist enforcement (snapshot)
// ============================================================
console.log('\nTest 9: Extension allowlist enforcement (hive-snapshot.js)');
assert(
  /FILE_ALLOWED_EXTENSIONS\.has\s*\(\s*ext\s*\)/.test(snapshotContent),
  'checks FILE_ALLOWED_EXTENSIONS.has(ext) for allowlist enforcement'
);
assert(
  /writeHead\s*\(\s*415/.test(snapshotContent) ||
    /sendJsonError\s*\(\s*res\s*,\s*415\b/.test(snapshotContent),
  'responds 415 for disallowed extensions (via writeHead or sendJsonError)'
);
assert(
  /path\.extname\s*\(\s*requestedPath\s*\)/.test(snapshotContent),
  'extracts extension via path.extname(requestedPath)'
);

// ============================================================
// Test 10: 404 for missing / not-a-file (snapshot)
// ============================================================
console.log('\nTest 10: 404 for missing or non-regular files (hive-snapshot.js)');
assert(
  /ENOENT/.test(snapshotContent),
  'handles ENOENT (missing file)'
);
assert(
  /writeHead\s*\(\s*404/.test(snapshotContent) ||
    /sendJsonError\s*\(\s*res\s*,\s*404\b/.test(snapshotContent),
  'responds 404 for missing files (via writeHead or sendJsonError)'
);
assert(
  /stat\.isFile\s*\(\s*\)/.test(snapshotContent),
  'checks stat.isFile() before reading'
);

// ============================================================
// Test 11: Success response shape (snapshot)
// ============================================================
console.log('\nTest 11: Success response shape (hive-snapshot.js)');
assert(
  /path:\s*requestedPath/.test(snapshotContent),
  'success response includes path field'
);
assert(
  /content,/.test(snapshotContent) && /readFile/.test(snapshotContent),
  'success response includes content from fs.readFile'
);
assert(
  /mtime:\s*stat\.mtime\.toISOString\s*\(\s*\)/.test(snapshotContent),
  'success response includes mtime as ISO string'
);
assert(
  /size:\s*stat\.size/.test(snapshotContent),
  'success response includes size field'
);
assert(
  /fs\.readFile\s*\([^,]+,\s*['"]utf8['"]/.test(snapshotContent),
  'reads file as UTF-8'
);

// ============================================================
// Test 12: Response headers — Content-Type + Cache-Control (snapshot)
// ============================================================
console.log('\nTest 12: Response headers (hive-snapshot.js)');
assert(
  /['"]Content-Type['"]\s*:\s*['"]application\/json['"]/.test(snapshotContent),
  'sets Content-Type: application/json'
);
assert(
  /['"]Cache-Control['"]\s*:\s*['"]no-store['"]/.test(snapshotContent),
  'sets Cache-Control: no-store'
);

// ============================================================
// Test 13: Module exports — setFileHandler (server) + createFileHandler (snapshot)
// ============================================================
console.log('\nTest 13: module.exports');
// Server exports the stub setter (setFileHandler) because the stub lives here.
const serverExportsStart = serverContent.indexOf('module.exports');
assert(
  serverExportsStart !== -1,
  'hive-server.js module.exports block exists'
);
const serverExportsSlice =
  serverExportsStart !== -1 ? serverContent.slice(serverExportsStart) : '';
assert(
  /setFileHandler/.test(serverExportsSlice),
  'hive-server.js module.exports includes setFileHandler'
);
// Snapshot exports the real factory (createFileHandler) so the entry-point
// guard in hive-server.js can destructure it from require('./hive-snapshot').
const snapshotExportsStart = snapshotContent.indexOf('module.exports');
assert(
  snapshotExportsStart !== -1,
  'hive-snapshot.js module.exports block exists'
);
const snapshotExportsSlice =
  snapshotExportsStart !== -1 ? snapshotContent.slice(snapshotExportsStart) : '';
assert(
  /createFileHandler/.test(snapshotExportsSlice),
  'hive-snapshot.js module.exports includes createFileHandler'
);

// ============================================================
// Test 14: Entry-point wiring (server)
// ============================================================
console.log('\nTest 14: Entry-point wiring (hive-server.js)');
assert(
  /setFileHandler\s*\(\s*createFileHandler\s*\(\s*beeDir\s*\)\s*\)/.test(
    serverContent
  ),
  'entry-point wires setFileHandler(createFileHandler(beeDir))'
);

// ============================================================
// Summary
// ============================================================
const total = passed + failed;
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${total} assertions`);
process.exit(failed > 0 ? 1 : 0);
