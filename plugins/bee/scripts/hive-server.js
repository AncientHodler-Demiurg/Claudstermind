#!/usr/bin/env node
// Hive Server — zero-dependency HTTP server core for the Bee Hive dashboard.
//
// Responsibilities:
//   1. Serve the static SPA bundle from HIVE_STATIC_DIR (defaults to `./hive-dist`
//      relative to this file, NOT the caller's cwd).
//   2. Fall through to `index.html` for any non-API route that does not match a
//      real static file, so the SPA router can take over (SPA fallback).
//   3. Return 404 for static-asset-looking requests that miss (anything with a
//      file extension under the static prefix).
//   4. Stub `GET /api/snapshot` with `{ timestamp: <ISO string> }` so T1.7 can
//      import this module and override the handler with the real snapshot
//      builder without having to restart or rewire the server.
//
// Zero external runtime dependencies: only Node.js built-ins (http, fs, path)
// plus the neutral-leaf sibling `hive-http-utils.js` (imported at top-level
// for sendJsonError) and `hive-snapshot.js` (imported lazily inside the
// `require.main === module` entry-point guard for the real handler factories).
//
// This module exports `createServer()` and `handleRequest(req, res)` so T1.7 can:
//   const hive = require('./hive-server');
//   hive.setSnapshotHandler((req, res) => { ... real logic ... });
//   const server = hive.createServer();
//   server.listen(port, host);
//
// The server is only started automatically when this file is invoked directly
// (`node hive-server.js`). Requiring it from another module must NOT listen.

const http = require('http');
const fs = require('fs');
const path = require('path');

const { sendJsonError } = require('./hive-http-utils');

// ========== Configuration ==========

const DEFAULT_PORT = 3333;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_STATIC_DIR = path.join(__dirname, 'hive-dist');

function getPort() {
  const raw = process.env.HIVE_PORT;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

function getHost() {
  return DEFAULT_HOST;
}

function getStaticDir() {
  return process.env.HIVE_STATIC_DIR || DEFAULT_STATIC_DIR;
}

// ========== MIME types (kept minimal — expand in REFACTOR if needed) ==========

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

// ========== Snapshot handler (stubbed — T1.7 overrides via setSnapshotHandler) ==========

let snapshotHandler = function defaultSnapshotHandler(req, res) {
  const body = JSON.stringify({ timestamp: new Date().toISOString() });
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
};

function setSnapshotHandler(fn) {
  if (typeof fn !== 'function') {
    throw new TypeError('setSnapshotHandler expects a function');
  }
  snapshotHandler = fn;
}

// ========== Config handler (POST /api/config) ==========

let configHandler = function defaultConfigHandler(req, res) {
  res.writeHead(501, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Config handler not wired' }));
};

function setConfigHandler(fn) {
  if (typeof fn !== 'function') {
    throw new TypeError('setConfigHandler expects a function');
  }
  configHandler = fn;
}

// ========== File handler stub (GET /api/file?path=<relative>) ==========
//
// The real factory (createFileHandler) and its constants (FILE_MAX_BYTES,
// FILE_ALLOWED_EXTENSIONS) live in hive-snapshot.js alongside the other
// handler factories (createSnapshotHandler, createConfigHandler,
// createEventsHandler). This file only keeps the stub + setter so the
// server can boot standalone and tests can swap in a mock without touching
// the filesystem. The entry-point guard below wires in the real factory
// via setFileHandler(createFileHandler(beeDir)).

let fileHandler = function defaultFileHandler(req, res) {
  res.writeHead(501, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'File handler not wired' }));
};

function setFileHandler(fn) {
  if (typeof fn !== 'function') {
    throw new TypeError('setFileHandler expects a function');
  }
  fileHandler = fn;
}

// ========== Events handler (GET /api/events) ==========
//
// Mirrors the snapshotHandler / configHandler / fileHandler stub-with-setter
// pattern. The real implementation lives in hive-snapshot.js as
// `createEventsHandler(beeDir)` and is wired into the server at startup via
// the entry-point guard below. Keeping the stub here means the server can
// boot standalone (without .bee/ discovery) and tests can require this
// module without dragging in the snapshot aggregator.

let eventsHandler = function defaultEventsHandler(req, res) {
  res.writeHead(501, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Events handler not wired' }));
};

function setEventsHandler(fn) {
  if (typeof fn !== 'function') {
    throw new TypeError('setEventsHandler expects a function');
  }
  eventsHandler = fn;
}

// ========== Static file serving ==========

function safeResolve(staticDir, urlPath) {
  // Strip query string & hash, decode, normalise, and confine to staticDir.
  const clean = urlPath.split('?')[0].split('#')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(clean);
  } catch (e) {
    return null;
  }
  const joined = path.join(staticDir, decoded);
  const resolved = path.resolve(joined);
  const rootResolved = path.resolve(staticDir);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    return null; // path traversal
  }
  return resolved;
}

function serveFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentTypeFor(filePath),
      'Content-Length': data.length,
    });
    res.end(data);
  });
}

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

// ========== Main request handler ==========

function handleRequest(req, res) {
  const url = req.url || '/';

  // API routes first — /api/snapshot is the only stub; T1.7 will mount more.
  if (url === '/api/snapshot' || url.startsWith('/api/snapshot?')) {
    if (req.method !== 'GET') {
      return sendJsonError(res, 405, 'Method Not Allowed', { Allow: 'GET' });
    }
    try {
      snapshotHandler(req, res);
    } catch (err) {
      // Guard against double-write: if handler already started streaming
      // (headers sent), we cannot write a 500 on top. Just end the response.
      if (!res.headersSent) {
        return sendJsonError(res, 500, err.message || 'Internal Server Error');
      } else if (!res.writableEnded) {
        res.end();
      }
    }
    return;
  }

  // POST /api/config — write config changes to .bee/config.json
  if (url === '/api/config' || url.startsWith('/api/config?')) {
    if (req.method !== 'POST' && req.method !== 'PUT') {
      return sendJsonError(res, 405, 'Method Not Allowed', { Allow: 'POST, PUT' });
    }
    try {
      configHandler(req, res);
    } catch (err) {
      if (!res.headersSent) {
        return sendJsonError(res, 500, err.message || 'Internal Server Error');
      }
    }
    return;
  }

  // GET /api/file?path=<relative> — read a single text file from .bee/
  if (url === '/api/file' || url.startsWith('/api/file?')) {
    if (req.method !== 'GET') {
      return sendJsonError(res, 405, 'Method Not Allowed', { Allow: 'GET' });
    }
    try {
      fileHandler(req, res);
    } catch (err) {
      if (!res.headersSent) {
        return sendJsonError(res, 500, err.message || 'Internal Server Error');
      } else if (!res.writableEnded) {
        res.end();
      }
    }
    return;
  }

  // GET /api/events?since=<iso>&limit=<n> — tail the hook event log.
  // The handler is synchronous (fs.readFileSync) so we only need the
  // outer try/catch shape, matching the snapshot route. Method gate
  // enforces GET with Allow: GET on 405.
  if (url === '/api/events' || url.startsWith('/api/events?')) {
    if (req.method !== 'GET') {
      return sendJsonError(res, 405, 'Method Not Allowed', { Allow: 'GET' });
    }
    try {
      eventsHandler(req, res);
    } catch (err) {
      if (!res.headersSent) {
        return sendJsonError(res, 500, err.message || 'Internal Server Error');
      } else if (!res.writableEnded) {
        res.end();
      }
    }
    return;
  }

  // Any other /api/* route is explicitly 404 — never fall through to the SPA
  // (SPA fallback would hide real API bugs behind the HTML shell).
  if (url.startsWith('/api/')) {
    send404(res);
    return;
  }

  // Static file serving with SPA fallback.
  const staticDir = getStaticDir();
  const resolved = safeResolve(staticDir, url === '/' ? '/index.html' : url);
  if (!resolved) {
    send404(res);
    return;
  }

  fs.stat(resolved, (err, stat) => {
    if (!err && stat.isFile()) {
      serveFile(resolved, res);
      return;
    }

    // File not found. Decide: SPA fallback vs 404.
    // Requests that look like explicit asset paths (have a file extension) get
    // a real 404 — those should exist. Extensionless routes are SPA routes and
    // fall through to index.html.
    const hasExtension = path.extname(url.split('?')[0]) !== '';
    if (hasExtension) {
      send404(res);
      return;
    }

    const indexPath = path.join(staticDir, 'index.html');
    fs.stat(indexPath, (indexErr, indexStat) => {
      if (indexErr || !indexStat.isFile()) {
        send404(res);
        return;
      }
      serveFile(indexPath, res);
    });
  });
}

// ========== Server factory ==========

function createServer() {
  return http.createServer(handleRequest);
}

// ========== Lifecycle management (T2.3) ==========
//
// When hive-server is spawned by a parent process (the `/bee:hive` command),
// that parent sets HIVE_OWNER_PID to its own PID. We poll the owner every 30s
// and gracefully shut down if the owner dies — this prevents orphan servers
// lingering after the Claude Code session that spawned them exits.
//
// Safety rails:
//   - EPERM from process.kill(pid, 0) means "you don't have permission to
//     signal that process" which implies the process DOES exist (in a
//     different user namespace or container). Treat as alive.
//   - If the owner PID is already dead at startup (WSL / SSH / cross-user
//     PID resolution glitches), we disable monitoring entirely. No idle
//     timeout fallback — the brainstorm pattern used one but T2.3 explicitly
//     removes it so the server stays up across long idle dashboards.
//   - lifecycleCheck.unref() so the interval never blocks natural process
//     exit (e.g. during tests that require this module).
//
// Lifecycle wiring is ONLY invoked from inside the `require.main === module`
// guard. Requiring this file from tests or T1.7's snapshot wiring must NOT
// register signal handlers or spawn the polling interval.

// Parse HIVE_OWNER_PID: if unset or not a finite positive integer, owner
// monitoring is disabled entirely (ownerPid stays null). Malformed values
// (e.g. HIVE_OWNER_PID="abc") yield NaN → coerced to null so downstream
// ownerAlive() / setupLifecycle() skip all PID work.
let ownerPid = process.env.HIVE_OWNER_PID ? Number(process.env.HIVE_OWNER_PID) : null;
if (ownerPid !== null && (!Number.isInteger(ownerPid) || ownerPid <= 0)) {
  ownerPid = null;
}
let lifecycleCheck = null;

function ownerAlive() {
  if (!ownerPid) return true;
  try {
    process.kill(ownerPid, 0);
    return true;
  } catch (e) {
    // EPERM → process exists but we can't signal it (cross-user/container).
    // Any other error (ESRCH in particular) → process is gone.
    return e.code === 'EPERM';
  }
}

function shutdown(server, reason) {
  console.log(JSON.stringify({ type: 'server-stopped', reason }));
  if (lifecycleCheck) {
    clearInterval(lifecycleCheck);
    lifecycleCheck = null;
  }
  server.close(() => process.exit(0));
}

function setupLifecycle(server) {
  // Startup validation: if the owner PID is already dead, disable monitoring
  // and log a warning. We do NOT fall back to an idle timeout — T2.3 removes
  // the brainstorm-pattern idle timeout intentionally.
  if (ownerPid !== null && !ownerAlive()) {
    console.log(
      JSON.stringify({ type: 'owner-pid-invalid', pid: ownerPid, reason: 'dead at startup' })
    );
    ownerPid = null;
    if (lifecycleCheck) {
      clearInterval(lifecycleCheck);
      lifecycleCheck = null;
    }
  } else {
    // Periodic liveness check every 30 seconds.
    lifecycleCheck = setInterval(() => {
      if (!ownerAlive()) shutdown(server, 'owner process exited');
    }, 30 * 1000);
    lifecycleCheck.unref();
  }

  // Signal handlers — graceful close on SIGTERM / SIGINT.
  process.on('SIGTERM', () => shutdown(server, 'sigterm received'));
  process.on('SIGINT', () => shutdown(server, 'sigint received'));
}

// ========== Startup ==========

function startServer(onReady) {
  const port = getPort();
  const host = getHost();
  const server = createServer();
  server.listen(port, host, () => {
    const info = {
      type: 'server-started',
      port,
      host,
      url: `http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`,
    };
    console.log(JSON.stringify(info));
    // Invoke the post-listen hook so the caller can attach lifecycle
    // management (signal handlers, PID monitoring) to an already-bound
    // server. Running this inside the listen callback is what lets us
    // perform an immediate liveness check on a live server — it catches
    // the owner-died-during-startup race window (parent crashed between
    // spawning us and us binding the port).
    if (typeof onReady === 'function') onReady(server);
  });
  return server;
}

// ========== Bee directory discovery (entry point only) ==========
//
// When invoked directly (`node hive-server.js`), we need to know which project
// to serve. Priority:
//   1. HIVE_BEE_DIR environment variable (absolute path to a .bee/ directory)
//   2. Walk up from __dirname looking for a `.bee/` sibling directory. This
//      lets the script be invoked from anywhere inside a bee-managed repo
//      without requiring the user to pass flags.
//
// Returns null if no .bee/ directory is found — the caller should handle the
// missing case gracefully (buildSnapshot tolerates a nonexistent path).
function resolveBeeDir() {
  if (process.env.HIVE_BEE_DIR) {
    return process.env.HIVE_BEE_DIR;
  }
  let dir = __dirname;
  // Walk up the filesystem tree, checking each ancestor for a .bee/ directory.
  // Stop at the filesystem root to avoid an infinite loop on symlinked setups.
  for (let i = 0; i < 50; i++) {
    const candidate = path.join(dir, '.bee');
    try {
      const stat = fs.statSync(candidate);
      if (stat.isDirectory()) return candidate;
    } catch (_e) {
      // not found at this level
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }
  return null;
}

// Only auto-start when invoked directly via `node hive-server.js`.
// Requiring this module from another file (e.g. T1.7's snapshot wiring or this
// file's test harness) must not bind a port OR register lifecycle handlers.
if (require.main === module) {
  // Wire the real snapshot handler from hive-snapshot.js (T1.7). We only
  // require it inside the entry-point guard so unit tests that `require` this
  // module don't trigger snapshot-aggregator side effects.
  const {
    createSnapshotHandler,
    createConfigHandler,
    createEventsHandler,
    createFileHandler,
  } = require('./hive-snapshot');
  const beeDir = resolveBeeDir();
  if (beeDir) {
    setSnapshotHandler(createSnapshotHandler(beeDir));
    setConfigHandler(createConfigHandler(beeDir));
    setFileHandler(createFileHandler(beeDir));
    setEventsHandler(createEventsHandler(beeDir));
  }
  // If no .bee/ directory was discovered, the stub snapshot handler remains
  // mounted and /api/snapshot will return `{ timestamp }` only — still valid
  // JSON, still a 200 response, so the dashboard can boot and show an empty
  // state.
  //
  // Start the server and, once bound, wire lifecycle management (T2.3):
  // owner PID monitoring, SIGTERM/SIGINT handlers, graceful shutdown. The
  // onReady hook runs inside server.listen()'s callback so we attach to an
  // already-bound server and can perform an immediate liveness check to
  // catch the owner-died-during-startup race window.
  startServer((server) => {
    setupLifecycle(server);
    if (ownerPid !== null && !ownerAlive()) {
      // Owner died between setupLifecycle's startup validation and now.
      // Gracefully shut down.
      shutdown(server, 'owner process exited');
    }
  });
}

module.exports = {
  createServer,
  handleRequest,
  setSnapshotHandler,
  setConfigHandler,
  setFileHandler,
  setEventsHandler,
  // sendJsonError is a re-export from hive-http-utils.js so downstream callers
  // (and hive-api-events.test.js's module.exports assertion) can reach it
  // without knowing the leaf module exists. See hive-http-utils.js header for
  // the DAG topology that eliminates D-001's circular-require risk.
  sendJsonError,
  MIME_TYPES,
  // Exposed for tests and T1.7 diagnostics:
  _internal: {
    getPort,
    getHost,
    getStaticDir,
    safeResolve,
    contentTypeFor,
  },
};
