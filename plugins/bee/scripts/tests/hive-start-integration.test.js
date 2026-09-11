#!/usr/bin/env node
// Test: hive-start.sh forwards HIVE_BEE_DIR to the spawned Node server.
//
// This is a RUNTIME integration test that exercises the shell -> node
// env-forwarding boundary. It exists because the bug it covers (only
// HIVE_OWNER_PID was being forwarded, not HIVE_BEE_DIR) went undetected
// by the structural-only suite in hive-start.test.js: the original line
// was syntactically valid bash and a unit test that `require()`s
// hive-server.js can set process.env.HIVE_BEE_DIR directly, bypassing
// the shell launcher entirely.
//
// What this test proves:
//   1. Spawning hive-start.sh against a temp .bee/ directory succeeds.
//   2. The spawned hive-server.js wires the REAL snapshot handler — the
//      response body of /api/snapshot contains a `state` object, not
//      just `{timestamp}` (which is what the stub handler returns when
//      resolveBeeDir() returns null because it cannot walk up to a
//      .bee/ ancestor from the plugin cache directory).
//
// Pre-fix failure mode (RED):
//   - hive-start.sh:99 only forwards HIVE_OWNER_PID.
//   - hive-server.js __dirname is the plugin cache path; walk-up finds
//     no .bee/ ancestor; resolveBeeDir() returns null; the snapshot
//     handler stays on the {timestamp}-only stub.
//   - The assertion `JSON.parse(body).state !== undefined` fails.
//
// Post-fix (GREEN):
//   - hive-start.sh:99 also forwards HIVE_BEE_DIR="$BEE_DIR".
//   - resolveBeeDir() returns the temp dir; createSnapshotHandler is
//     wired; /api/snapshot returns a fully populated snapshot.

const { spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

// ========== Paths ==========

const HIVE_START_SH = path.resolve(__dirname, '..', 'hive-start.sh');
const HIVE_STOP_SH = path.resolve(__dirname, '..', 'hive-stop.sh');

// ========== Hand-rolled assertion harness ==========

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

// ========== findFreePort: pick an unused port and release it before spawn ==========
//
// Copied from hive-e2e.test.js. We MUST close the preflight listener and
// await the `close` event before returning, otherwise the kernel still
// holds the port and the spawned hive-server will hit EADDRINUSE.

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

// ========== httpGet: Promise-wrapped GET (built-ins only) ==========

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

// ========== rmrf: best-effort recursive cleanup ==========
//
// Used in finally{} so it must never throw — we want the test to surface
// its real failure, not a cleanup error.

function rmrf(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_e) {
    // ignore
  }
}

// ========== Main test runner ==========

async function main() {
  console.log('Test: hive-start.sh forwards HIVE_BEE_DIR to hive-server.js');

  // Fail-fast preconditions.
  if (!fs.existsSync(HIVE_START_SH)) {
    console.log(`FATAL: hive-start.sh not found at ${HIVE_START_SH}`);
    console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
    process.exit(1);
  }
  if (!fs.existsSync(HIVE_STOP_SH)) {
    console.log(`FATAL: hive-stop.sh not found at ${HIVE_STOP_SH}`);
    console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
    process.exit(1);
  }

  // Step 1: create a temp project root with a .bee/ inside that contains
  // a STATE.md with a UNIQUE spec name. The unique name is the load-bearing
  // assertion: if hive-server.js falls back to walk-up-from-__dirname (the
  // pre-fix behavior in dev), it will discover this repo's own .bee/STATE.md
  // — NOT our temp one — and the snapshot's state.currentSpec.name will be
  // something else. The unique sentinel proves HIVE_BEE_DIR was honored.
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-fwd-bee-dir-'));
  const tmpBeeDir = path.join(tmpRoot, '.bee');
  fs.mkdirSync(tmpBeeDir);
  const sentinelSpecName = `bee-dir-fwd-sentinel-${process.pid}-${Date.now()}`;
  fs.writeFileSync(
    path.join(tmpBeeDir, 'STATE.md'),
    `# State\n\n## Current Spec\n\n- Name: ${sentinelSpecName}\n- Path: .bee/specs/${sentinelSpecName}/\n- Status: PLANNED\n`
  );

  // Step 2: pick a free port outside the default 3333 range so we don't
  // collide with a developer's already-running dashboard.
  let port;
  try {
    port = await findFreePort(3399, 3410);
  } catch (err) {
    rmrf(tmpRoot);
    console.log(`FATAL: free-port discovery failed: ${err.message}`);
    console.log(`\nResults: 0 passed, 1 failed out of 1 assertions`);
    process.exit(1);
  }
  console.log(`  preflight: selected free port ${port}`);
  console.log(`  preflight: temp .bee at ${tmpBeeDir}`);

  let testError = null;

  try {
    // Step 3: spawn hive-start.sh as a real subprocess. spawnSync blocks
    // until the script exits — and hive-start.sh only exits 0 once it has
    // observed the server-started marker on disk and verified the PID is
    // alive via kill -0. After this returns, the server is guaranteed up.
    const startResult = spawnSync(
      'bash',
      [HIVE_START_SH, '--bee-dir', tmpBeeDir],
      {
        env: { ...process.env, HIVE_PORT: String(port) },
        encoding: 'utf8',
        timeout: 10000,
      }
    );

    assert(
      startResult.status === 0,
      `hive-start.sh exits 0 (got status=${startResult.status}, signal=${startResult.signal}, stderr=${startResult.stderr || '<empty>'})`
    );
    assert(
      typeof startResult.stdout === 'string' &&
        startResult.stdout.includes('"type":"server-started"'),
      `hive-start.sh stdout includes "type":"server-started" marker`
    );

    // Step 4: hit /api/snapshot — the real handler returns a fully
    // populated snapshot including a `state` object. The stub handler
    // (left mounted when resolveBeeDir() returns null) returns ONLY
    // {timestamp}, which is what we see today before the fix.
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
      // Primary assertion 1: the bug-defining check. The stub handler
      // returns only {timestamp}; the real handler always returns
      // `state` (object) regardless of how empty .bee/ is.
      assert(
        Object.prototype.hasOwnProperty.call(snapshotJson, 'state') &&
          snapshotJson.state !== null &&
          typeof snapshotJson.state === 'object',
        'snapshot JSON has `state` object (proves real handler is wired, not stub)'
      );

      // Primary assertion 2: catches the stub-handler regression
      // specifically. Stub body is exactly {timestamp}; real body has
      // many more keys.
      assert(
        Object.keys(snapshotJson).length > 1,
        `snapshot JSON has more than 1 key (got ${Object.keys(snapshotJson).length}; stub returns 1, real returns ~20)`
      );

      // Primary assertion 3: load-bearing. Proves HIVE_BEE_DIR was
      // actually forwarded (and honored) — not just that resolveBeeDir()
      // happened to walk up from __dirname into SOME .bee/ ancestor on
      // the developer's machine. The sentinel spec name only exists in
      // our temp STATE.md; if the snapshot reflects a different name,
      // hive-server.js read the wrong .bee/ directory.
      const actualSpecName =
        snapshotJson.state &&
        snapshotJson.state.currentSpec &&
        snapshotJson.state.currentSpec.name;
      assert(
        actualSpecName === sentinelSpecName,
        `snapshot state.currentSpec.name === sentinel "${sentinelSpecName}" (got "${actualSpecName}") — proves HIVE_BEE_DIR was honored, not walk-up fallback`
      );
    }
  } catch (err) {
    testError = err;
  } finally {
    // Step 5: cleanup. Use hive-stop.sh against the same --bee-dir so we
    // hit the same PID file the start script wrote. Suppress its
    // exceptions — we want the underlying assertion failure (if any) to
    // surface, not a teardown error.
    try {
      spawnSync('bash', [HIVE_STOP_SH, '--bee-dir', tmpBeeDir], {
        encoding: 'utf8',
        timeout: 5000,
      });
    } catch (_e) {
      // ignore
    }
    rmrf(tmpRoot);
  }

  if (testError) {
    console.log(`\nUnhandled test error: ${testError.message}`);
  }

  console.log(
    `\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.log(`\nFATAL: ${err && err.stack ? err.stack : err}`);
  console.log(
    `\nResults: ${passed} passed, ${failed + 1} failed out of ${passed + failed + 1} assertions`
  );
  process.exit(1);
});
