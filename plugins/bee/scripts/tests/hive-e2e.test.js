#!/usr/bin/env node
// E2E smoke test for the Hive dashboard server (T4.7).
//
// This test spawns plugins/bee/scripts/hive-server.js as a real child process
// against the committed hive-dist/ SPA bundle and exercises it as a black box:
//
//   1. Preflight: pick a free port in the 3399-3410 range using net.createServer
//      and CLOSE the preflight socket BEFORE spawning the child (otherwise the
//      preflight holds the port and the child crashes with EADDRINUSE).
//   2. Spawn: `node hive-server.js` with HIVE_PORT and HIVE_STATIC_DIR pinned to
//      the committed hive-dist/ absolute path.
//   3. Wait for the structured `{"type":"server-started"}` line on stdout.
//   4. GET /                  -> assert HTML body contains `<div id="root"`.
//   5. GET /api/snapshot      -> assert JSON parses, has `timestamp` field and
//                                a `state` section.
//   6. GET first ./assets/*.js asset extracted from index.html -> assert the
//      Content-Type response header includes `application/javascript`.
//   7. Cleanup (try/finally): SIGTERM the child, then SIGKILL after 2s if it
//      hasn't exited. Verify the child is actually dead.
//
// Zero dependencies — only Node.js built-ins (child_process, http, fs, path,
// net). Hand-rolled assertions matching the rest of the plugin's test suite.

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');

// ========== Paths ==========

const HIVE_SERVER = path.resolve(__dirname, '..', 'hive-server.js');
const HIVE_DIST = path.resolve(__dirname, '..', 'hive-dist');
const INDEX_HTML = path.join(HIVE_DIST, 'index.html');

// Fixture .bee dir for the snapshot endpoint (grain rule: the suite must not
// depend on the gitignored live .bee/ workspace — HIVE_BEE_DIR pins the
// server to a synthetic tree).
const os = require('os');
const FIXTURE_BEE = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-e2e-bee-'));
fs.writeFileSync(
  path.join(FIXTURE_BEE, 'STATE.md'),
  [
    '# Bee Project State',
    '',
    '## Current Spec',
    '- Name: fixture-spec',
    '- Path: .bee/specs/2026-01-01-fixture-spec/',
    '- Status: IN_PROGRESS',
    '',
    '## Phases',
    '| # | Name | Status | Plan | Plan Review | Executed | Reviewed | Tested | Committed |',
    '|---|------|--------|------|-------------|----------|----------|--------|-----------|',
    '| 1 | Fixture Phase | EXECUTED | Yes | Yes (1) | Yes | | | |',
    '',
    '## Last Action',
    '- Command: /bee:execute-phase',
    '- Timestamp: 2026-01-01T00:00:00Z',
    '- Result: Phase 1 executed',
    '',
  ].join('\n')
);
fs.writeFileSync(
  path.join(FIXTURE_BEE, 'config.json'),
  JSON.stringify({ stacks: [{ name: 'claude-code-plugin', path: '.' }], implementation_mode: 'premium' })
);
process.on('exit', () => {
  try { fs.rmSync(FIXTURE_BEE, { recursive: true, force: true }); } catch {}
});

// ========== Hand-rolled assertion harness ==========

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}`);
  }
}

function fatal(message) {
  console.log(`\nFATAL: ${message}`);
  console.log(`\nResults: ${passed} passed, ${failed + 1} failed out of ${passed + failed + 1} assertions`);
  process.exit(1);
}

// ========== Preflight: find a free port and release it before spawn ==========

// Tries ports in [start, end] (inclusive). For each candidate port, opens a
// throwaway TCP listener via net.createServer and waits for the listen event;
// if it succeeds the port is free. We MUST close the listener and await the
// `close` event before returning, otherwise the kernel still holds the port
// and the child process will hit EADDRINUSE during its own listen() call.
function findFreePort(start, end) {
  return new Promise((resolve, reject) => {
    let port = start;

    function tryNext() {
      if (port > end) {
        reject(new Error(`No free port found in range ${start}-${end}`));
        return;
      }
      const candidate = port++;
      const server = net.createServer();
      server.unref();
      server.once('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
          tryNext();
        } else {
          reject(err);
        }
      });
      server.listen(candidate, '127.0.0.1', () => {
        // Port is free. Close the preflight listener and wait for the close
        // event before resolving so the child can bind it cleanly.
        server.close((closeErr) => {
          if (closeErr) {
            reject(closeErr);
            return;
          }
          resolve(candidate);
        });
      });
    }

    tryNext();
  });
}

// ========== Wait for the server-started line on stdout ==========

// Buffers child stdout and resolves the moment we see a line containing the
// exact JSON key `"type":"server-started"`. Anchored on the literal key so
// we don't false-positive on partial output. Rejects on timeout, child exit,
// or stderr containing a hard error.
function waitForServerStarted(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `Timed out after ${timeoutMs}ms waiting for "type":"server-started". ` +
            `stdout so far:\n${stdoutBuffer}\nstderr so far:\n${stderrBuffer}`
        )
      );
    }, timeoutMs);

    function onStdout(chunk) {
      stdoutBuffer += chunk.toString();
      // Anchor on the full JSON key — this is the structured startup line
      // emitted by hive-server.js inside server.listen()'s callback.
      if (stdoutBuffer.includes('"type":"server-started"')) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stdout: stdoutBuffer, stderr: stderrBuffer });
      }
    }

    function onStderr(chunk) {
      stderrBuffer += chunk.toString();
    }

    function onExit(code, signal) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new Error(
          `Child exited before server-started (code=${code}, signal=${signal}).\n` +
            `stdout:\n${stdoutBuffer}\nstderr:\n${stderrBuffer}`
        )
      );
    }

    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.once('exit', onExit);
  });
}

// ========== HTTP helper (Promise-wrapped GET) ==========

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error(`Request timed out: ${url}`));
    });
  });
}

// ========== Cleanup helper: SIGTERM with SIGKILL fallback ==========

function shutdownChild(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    let resolved = false;
    function done() {
      if (resolved) return;
      resolved = true;
      resolve();
    }
    child.once('exit', done);
    try {
      child.kill('SIGTERM');
    } catch (_e) {
      // child might have already exited between the guard and kill — ignore.
    }
    // 2s SIGKILL fallback if SIGTERM is ignored.
    setTimeout(() => {
      if (resolved) return;
      try {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      } catch (_e) {
        // already gone
      }
      // Give SIGKILL a brief window to land before forcing resolution so the
      // outer test can still inspect child.exitCode.
      setTimeout(done, 200);
    }, 2000);
  });
}

// ========== Main test runner ==========

async function main() {
  console.log('Test: hive-server end-to-end smoke test');

  // Fail-fast preconditions.
  if (!fs.existsSync(HIVE_SERVER)) {
    fatal(`hive-server.js not found at expected path: ${HIVE_SERVER}`);
  }
  if (!fs.existsSync(HIVE_DIST) || !fs.statSync(HIVE_DIST).isDirectory()) {
    fatal(`hive-dist/ not found or not a directory: ${HIVE_DIST}`);
  }
  if (!fs.existsSync(INDEX_HTML)) {
    fatal(`hive-dist/index.html not found: ${INDEX_HTML}`);
  }

  // Step 0: preflight — find a free port and release it before spawning.
  let port;
  try {
    port = await findFreePort(3399, 3410);
  } catch (err) {
    fatal(`Preflight port discovery failed: ${err.message}`);
  }
  console.log(`  preflight: selected free port ${port}`);

  // Step 1: spawn the child with HIVE_PORT and HIVE_STATIC_DIR pinned.
  const child = spawn(
    'node',
    [HIVE_SERVER],
    {
      env: {
        ...process.env,
        HIVE_PORT: String(port),
        HIVE_STATIC_DIR: HIVE_DIST,
        HIVE_BEE_DIR: FIXTURE_BEE,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let testError = null;

  try {
    // Step 2: wait for the structured server-started line on stdout (5s).
    let startup;
    try {
      startup = await waitForServerStarted(child, 5000);
    } catch (err) {
      assert(false, `server emits "type":"server-started" within 5s — ${err.message}`);
      throw err;
    }
    assert(true, 'server emits "type":"server-started" within 5s');
    assert(
      startup.stdout.includes(`"port":${port}`),
      `server-started log includes selected port ${port}`
    );

    // Step 3: GET / — assert HTML body contains <div id="root"
    const root = await httpGet(`http://127.0.0.1:${port}/`);
    assert(root.statusCode === 200, 'GET / returns 200');
    assert(
      typeof root.headers['content-type'] === 'string' &&
        root.headers['content-type'].includes('text/html'),
      'GET / response is text/html'
    );
    assert(
      root.body.includes('<div id="root"'),
      'GET / body contains <div id="root"'
    );

    // Step 4: GET /api/snapshot — assert JSON parses with `timestamp` and `state`
    const snapshot = await httpGet(`http://127.0.0.1:${port}/api/snapshot`);
    assert(snapshot.statusCode === 200, 'GET /api/snapshot returns 200');
    let snapshotJson = null;
    try {
      snapshotJson = JSON.parse(snapshot.body);
      assert(true, 'GET /api/snapshot body parses as JSON');
    } catch (e) {
      assert(false, `GET /api/snapshot body parses as JSON — ${e.message}`);
    }
    if (snapshotJson) {
      assert(
        Object.prototype.hasOwnProperty.call(snapshotJson, 'timestamp'),
        'snapshot JSON has timestamp field'
      );
      assert(
        Object.prototype.hasOwnProperty.call(snapshotJson, 'state') &&
          snapshotJson.state !== null &&
          typeof snapshotJson.state === 'object',
        'snapshot JSON has state section (object)'
      );
    }

    // Step 5: GET a hashed asset extracted from index.html — assert response
    // Content-Type header includes application/javascript. We MUST NOT rely
    // on body-content heuristics here; the header is the contract.
    const assetMatch = root.body.match(/\.\/assets\/([^"'\s]+\.js)/);
    assert(
      assetMatch !== null,
      'index.html contains a ./assets/*.js reference'
    );
    if (assetMatch) {
      const assetUrl = `http://127.0.0.1:${port}/assets/${assetMatch[1]}`;
      const asset = await httpGet(assetUrl);
      assert(asset.statusCode === 200, `GET ${assetUrl} returns 200`);
      const ct = asset.headers['content-type'] || '';
      assert(
        ct.includes('application/javascript'),
        `GET ${assetMatch[1]} Content-Type includes application/javascript (got "${ct}")`
      );
    }
  } catch (err) {
    testError = err;
  } finally {
    // Step 6: cleanup — SIGTERM with 2s SIGKILL fallback.
    await shutdownChild(child);
    // Step 7: verify the child is actually dead.
    assert(
      child.exitCode !== null || child.killed,
      `child process is dead (exitCode=${child.exitCode}, killed=${child.killed})`
    );
  }

  if (testError) {
    console.log(`\nUnhandled test error: ${testError.message}`);
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.log(`\nFATAL: ${err && err.stack ? err.stack : err}`);
  console.log(`\nResults: ${passed} passed, ${failed + 1} failed out of ${passed + failed + 1} assertions`);
  process.exit(1);
});
