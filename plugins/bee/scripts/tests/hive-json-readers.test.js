#!/usr/bin/env node
// Tests for hive-json-readers.js
// Validates readConfig, readHealthHistory, readPhaseMetrics, readWorkspaces
// against real .bee/ files and synthetic temp fixtures.

const fs = require('fs');
const path = require('path');
const os = require('os');

const MODULE_PATH = path.join(__dirname, '..', 'hive-json-readers.js');
const REAL_BEE_DIR = path.join(__dirname, '..', '..', '..', '..', '.bee');

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
// Fixture helpers
// ============================================================

function makeTempBeeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-json-readers-'));
  return dir;
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ============================================================
// Module loads
// ============================================================

console.log('Testing hive-json-readers.js\n');

console.log('Test Group 1: Module loads and exports');
let mod;
try {
  mod = require(MODULE_PATH);
  assert(true, 'Module loads without throwing');
} catch (e) {
  assert(false, `Module loads without throwing (error: ${e.message})`);
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

assert(typeof mod.readConfig === 'function', 'Exports readConfig function');
assert(typeof mod.readHealthHistory === 'function', 'Exports readHealthHistory function');
assert(typeof mod.readPhaseMetrics === 'function', 'Exports readPhaseMetrics function');
assert(typeof mod.readWorkspaces === 'function', 'Exports readWorkspaces function');

// ============================================================
// readConfig — real .bee/config.json
// ============================================================

console.log('\nTest Group 2: readConfig — fixture .bee/');
// Re-aimed from the live .bee/ tree to a synthetic fixture (grain rule: suites
// must not depend on gitignored user workspace state).
{
  const tmp = makeTempBeeDir();
  try {
    fs.writeFileSync(
      path.join(tmp, 'config.json'),
      JSON.stringify({
        stacks: [{ name: 'claude-code-plugin', path: '.' }],
        implementation_mode: 'premium',
        review: { loop: false },
        ship: { max_review_iterations: 3 },
        quick: { default_mode: 'tdd' },
      }),
      'utf8'
    );
    const cfg = mod.readConfig(tmp);
    assert(cfg !== null, 'readConfig returns non-null for a populated .bee/');
    assert(typeof cfg === 'object', 'readConfig returns object');
    assert(Array.isArray(cfg.stacks), 'Config has stacks array');
    assert(cfg.stacks.length > 0, 'Config stacks has at least one entry');
    assert(cfg.stacks[0].name === 'claude-code-plugin', 'First stack is claude-code-plugin');
    assert(typeof cfg.implementation_mode === 'string', 'Config has implementation_mode string');
    assert(typeof cfg.review === 'object' && cfg.review !== null, 'Config has review object');
    assert(typeof cfg.ship === 'object' && cfg.ship !== null, 'Config has ship object');
    assert(typeof cfg.quick === 'object' && cfg.quick !== null, 'Config has quick object');
  } finally {
    cleanup(tmp);
  }
}

// ============================================================
// readConfig — missing file returns null
// ============================================================

console.log('\nTest Group 3: readConfig — missing file');
{
  const tmp = makeTempBeeDir();
  try {
    const cfg = mod.readConfig(tmp);
    assert(cfg === null, 'readConfig returns null when config.json missing');
  } finally {
    cleanup(tmp);
  }
}

// ============================================================
// readConfig — invalid JSON returns null (never throws)
// ============================================================

console.log('\nTest Group 4: readConfig — invalid JSON');
{
  const tmp = makeTempBeeDir();
  fs.writeFileSync(path.join(tmp, 'config.json'), '{ not valid json', 'utf8');
  try {
    let threw = false;
    let result;
    try {
      result = mod.readConfig(tmp);
    } catch {
      threw = true;
    }
    assert(!threw, 'readConfig does not throw on invalid JSON');
    assert(result === null, 'readConfig returns null on invalid JSON');
  } finally {
    cleanup(tmp);
  }
}

// ============================================================
// readHealthHistory — real file
// ============================================================

console.log('\nTest Group 5: readHealthHistory — fixture .bee/');
// Re-aimed from the live .bee/ tree to a synthetic fixture (grain rule).
{
  const tmp = makeTempBeeDir();
  try {
    fs.mkdirSync(path.join(tmp, 'metrics'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'metrics', 'health-history.json'),
      JSON.stringify([
        { timestamp: '2026-06-01T10:00:00Z', overall_status: 'HEALTHY', summary: { passed: 14, warnings: 0, failures: 0 } },
      ]),
      'utf8'
    );
    const hist = mod.readHealthHistory(tmp);
    assert(hist !== null, 'readHealthHistory returns non-null for a populated .bee/');
    assert(Array.isArray(hist), 'readHealthHistory returns array');
    assert(hist.length > 0, 'Health history has at least one entry');
    assert(typeof hist[0].timestamp === 'string', 'Entry has timestamp string');
    assert(typeof hist[0].overall_status === 'string', 'Entry has overall_status string');
  } finally {
    cleanup(tmp);
  }
}

// ============================================================
// readHealthHistory — missing file returns null
// ============================================================

console.log('\nTest Group 6: readHealthHistory — missing file');
{
  const tmp = makeTempBeeDir();
  try {
    const hist = mod.readHealthHistory(tmp);
    assert(hist === null, 'readHealthHistory returns null when file missing');
  } finally {
    cleanup(tmp);
  }
}

// ============================================================
// readHealthHistory — invalid JSON returns null
// ============================================================

console.log('\nTest Group 7: readHealthHistory — invalid JSON');
{
  const tmp = makeTempBeeDir();
  fs.mkdirSync(path.join(tmp, 'metrics'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'metrics', 'health-history.json'), 'broken{', 'utf8');
  try {
    let threw = false;
    let result;
    try {
      result = mod.readHealthHistory(tmp);
    } catch {
      threw = true;
    }
    assert(!threw, 'readHealthHistory does not throw on invalid JSON');
    assert(result === null, 'readHealthHistory returns null on invalid JSON');
  } finally {
    cleanup(tmp);
  }
}

// ============================================================
// readPhaseMetrics — no metrics directory
// ============================================================

console.log('\nTest Group 8: readPhaseMetrics — empty/missing');
{
  const tmp = makeTempBeeDir();
  try {
    const metrics = mod.readPhaseMetrics(tmp);
    assert(Array.isArray(metrics), 'readPhaseMetrics returns array when metrics/ missing');
    assert(metrics.length === 0, 'readPhaseMetrics returns empty array when metrics/ missing');
  } finally {
    cleanup(tmp);
  }
}

// ============================================================
// readPhaseMetrics — scans subdirectories, groups by spec folder
// ============================================================

console.log('\nTest Group 9: readPhaseMetrics — subdirectory scan');
{
  const tmp = makeTempBeeDir();
  const metricsDir = path.join(tmp, 'metrics');
  const specA = path.join(metricsDir, '2026-04-10-spec-a');
  const specB = path.join(metricsDir, '2026-04-10-spec-b');
  fs.mkdirSync(specA, { recursive: true });
  fs.mkdirSync(specB, { recursive: true });

  // Write health-history.json in metrics/ (should be ignored — not a subdir, not phase-*.json)
  fs.writeFileSync(path.join(metricsDir, 'health-history.json'), '[]', 'utf8');

  fs.writeFileSync(
    path.join(specA, 'phase-1.json'),
    JSON.stringify({ phase: 1, name: 'Server', execution: { duration_seconds: 120 } }),
    'utf8',
  );
  fs.writeFileSync(
    path.join(specA, 'phase-2.json'),
    JSON.stringify({ phase: 2, name: 'Lifecycle' }),
    'utf8',
  );
  fs.writeFileSync(
    path.join(specB, 'phase-1.json'),
    JSON.stringify({ phase: 1, name: 'SpecB Phase 1' }),
    'utf8',
  );
  // A non phase-*.json file should be ignored
  fs.writeFileSync(path.join(specA, 'notes.md'), 'ignore me', 'utf8');

  try {
    const metrics = mod.readPhaseMetrics(tmp);
    assert(Array.isArray(metrics), 'readPhaseMetrics returns array');
    assert(metrics.length === 2, 'readPhaseMetrics groups by spec folder (2 specs)');

    const bySpec = {};
    for (const group of metrics) {
      bySpec[group.spec] = group;
    }

    assert('2026-04-10-spec-a' in bySpec, 'Group for spec-a present');
    assert('2026-04-10-spec-b' in bySpec, 'Group for spec-b present');
    assert(Array.isArray(bySpec['2026-04-10-spec-a'].phases), 'spec-a has phases array');
    assert(bySpec['2026-04-10-spec-a'].phases.length === 2, 'spec-a has 2 phase files');
    assert(bySpec['2026-04-10-spec-b'].phases.length === 1, 'spec-b has 1 phase file');

    // Ensure phase data parsed
    const specAPhase1 = bySpec['2026-04-10-spec-a'].phases.find(p => p.phase === 1);
    assert(specAPhase1 !== undefined, 'spec-a phase-1 parsed');
    assert(specAPhase1.execution.duration_seconds === 120, 'spec-a phase-1 has parsed execution data');
  } finally {
    cleanup(tmp);
  }
}

// ============================================================
// readPhaseMetrics — skips invalid JSON files gracefully
// ============================================================

console.log('\nTest Group 10: readPhaseMetrics — invalid JSON skipped');
{
  const tmp = makeTempBeeDir();
  const specDir = path.join(tmp, 'metrics', 'spec-x');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'phase-1.json'), 'not json', 'utf8');
  fs.writeFileSync(
    path.join(specDir, 'phase-2.json'),
    JSON.stringify({ phase: 2 }),
    'utf8',
  );

  try {
    let threw = false;
    let metrics;
    try {
      metrics = mod.readPhaseMetrics(tmp);
    } catch {
      threw = true;
    }
    assert(!threw, 'readPhaseMetrics does not throw on invalid JSON in phase file');
    assert(Array.isArray(metrics), 'Still returns an array');
    assert(metrics.length === 1, 'spec-x group present');
    assert(metrics[0].phases.length === 1, 'Only valid phase file included');
    assert(metrics[0].phases[0].phase === 2, 'phase-2 is the valid entry');
  } finally {
    cleanup(tmp);
  }
}

// ============================================================
// readWorkspaces — missing file returns null
// ============================================================

console.log('\nTest Group 11: readWorkspaces — missing file');
{
  const tmp = makeTempBeeDir();
  try {
    const ws = mod.readWorkspaces(tmp);
    assert(ws === null, 'readWorkspaces returns null when workspaces.json missing');
  } finally {
    cleanup(tmp);
  }
}

// ============================================================
// readWorkspaces — valid file returns parsed object
// ============================================================

console.log('\nTest Group 12: readWorkspaces — valid file');
{
  const tmp = makeTempBeeDir();
  const payload = {
    workspaces: [
      { name: 'alpha', path: '/tmp/alpha' },
      { name: 'beta', path: '/tmp/beta' },
    ],
  };
  fs.writeFileSync(path.join(tmp, 'workspaces.json'), JSON.stringify(payload), 'utf8');
  try {
    const ws = mod.readWorkspaces(tmp);
    assert(ws !== null, 'readWorkspaces returns non-null');
    assert(typeof ws === 'object', 'readWorkspaces returns object');
    assert(Array.isArray(ws.workspaces), 'Parsed workspaces array');
    assert(ws.workspaces.length === 2, 'Two workspaces parsed');
    assert(ws.workspaces[0].name === 'alpha', 'First workspace is alpha');
  } finally {
    cleanup(tmp);
  }
}

// ============================================================
// readWorkspaces — invalid JSON returns null
// ============================================================

console.log('\nTest Group 13: readWorkspaces — invalid JSON');
{
  const tmp = makeTempBeeDir();
  fs.writeFileSync(path.join(tmp, 'workspaces.json'), '{{{bad', 'utf8');
  try {
    let threw = false;
    let result;
    try {
      result = mod.readWorkspaces(tmp);
    } catch {
      threw = true;
    }
    assert(!threw, 'readWorkspaces does not throw on invalid JSON');
    assert(result === null, 'readWorkspaces returns null on invalid JSON');
  } finally {
    cleanup(tmp);
  }
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
