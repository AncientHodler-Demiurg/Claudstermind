#!/usr/bin/env node
// Tests for specs-cli.js sync-global subcommand (FIX A).
// (a) sync-global copies per-spec STATE.md content into global mirror.
// (b) DATA-LOSS regression: sync-global after merge-back prevents same-spec touch from
//     overwriting the reconciled per-spec STATE.md with the stale global.
// (c) sync-global with no per-spec STATE.md exits non-zero.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { main } = require(path.join(__dirname, '..', 'specs-cli.js'));

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}

function tmpBee() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-sg-'));
  const bee = path.join(d, '.bee');
  fs.mkdirSync(bee, { recursive: true });
  return bee;
}

function captureIO(fn) {
  let stdout = '', stderr = '';
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = s => { stdout += s; return true; };
  process.stderr.write = s => { stderr += s; return true; };
  let exit;
  try { exit = fn(); } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return { exit, stdout, stderr };
}

// Helper: write a minimal per-spec STATE.md with a distinct marker.
function writePerSpec(bee, slug, marker) {
  const dir = path.join(bee, 'specs', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'STATE.md'), [
    '# Bee Project State',
    '## Current Spec',
    `- Name: ${slug}`,
    `- Path: .bee/specs/${slug}/`,
    '- Status: IN_PROGRESS',
    `<!-- ${marker} -->`,
    '',
  ].join('\n'));
}

// Helper: write a stale global STATE.md.
function writeGlobal(bee, content) {
  fs.writeFileSync(path.join(bee, 'STATE.md'), content);
}

function writeRegistry(bee, specs) {
  fs.writeFileSync(path.join(bee, 'specs.json'), JSON.stringify({ specs }, null, 2) + '\n');
}

// ============================================================
// (a) sync-global copies per-spec content into global mirror
// ============================================================
console.log('sync-global (a): copies per-spec STATE.md content into global mirror');
{
  const bee = tmpBee();
  const MARKER = 'UNIQUE_MARKER_XJ42';

  writePerSpec(bee, 'my-spec', MARKER);
  writeGlobal(bee, '# Bee Project State\n## Current Spec\n- Status: STALE_GLOBAL\n');
  writeRegistry(bee, [
    { slug: 'my-spec', title: 'My Spec', stage: 'executing', location: 'in-place', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-01T00:00:00Z' },
  ]);

  const { exit, stdout } = captureIO(() => main(['sync-global', '--bee', bee, '--slug', 'my-spec']));
  assert(exit === 0, 'sync-global exits 0 when per-spec STATE.md exists');
  assert(stdout.includes('sync-global my-spec'), 'sync-global prints confirmation to stdout');

  const globalContent = fs.readFileSync(path.join(bee, 'STATE.md'), 'utf8');
  assert(globalContent.includes(MARKER), 'global STATE.md now contains the per-spec marker after sync-global');
  assert(!globalContent.includes('STALE_GLOBAL'), 'stale global content replaced after sync-global');
}

// ============================================================
// (b) DATA-LOSS regression: touch after sync-global must not overwrite reconciled per-spec
// ============================================================
console.log('\nsync-global (b): data-loss regression — touch does not clobber reconciled per-spec after sync-global');
{
  const bee = tmpBee();
  const COMPLETED_MARKER = 'STATUS_COMPLETED_MERGED_BACK';

  // Per-spec STATE.md = reconciled, authoritative (what merge-back copied in)
  writePerSpec(bee, 'alpha', COMPLETED_MARKER);
  // Global = stale snapshot from before promotion (what the global was pinned to)
  writeGlobal(bee, [
    '# Bee Project State',
    '## Current Spec',
    '- Name: alpha',
    '- Path: .bee/specs/alpha/',
    '- Status: SPEC_CREATED',
    '<!-- STALE_PROMOTE_TIME_SNAPSHOT -->',
    '',
  ].join('\n'));

  writeRegistry(bee, [
    { slug: 'alpha', title: 'Alpha', stage: 'executing', location: 'in-place', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-01T00:00:00Z' },
  ]);

  // Step 1: run sync-global (simulates the new merge-back step 8)
  const syncResult = captureIO(() => main(['sync-global', '--bee', bee, '--slug', 'alpha']));
  assert(syncResult.exit === 0, 'sync-global succeeds (regression setup)');

  // After sync-global, global should match the reconciled per-spec
  const globalAfterSync = fs.readFileSync(path.join(bee, 'STATE.md'), 'utf8');
  assert(globalAfterSync.includes(COMPLETED_MARKER), 'global reflects reconciled per-spec after sync-global');

  // Step 2: run touch --slug alpha (simulates next /bee:resume or /bee:spec use on the same spec)
  // With FIX B in place: g === 'alpha' → snapshotToPerSpec is called (captures global into per-spec)
  // Since global now reflects the reconciled per-spec (thanks to sync-global), snapshotToPerSpec
  // will copy the correct content back — preserving the reconciled state.
  const touchResult = captureIO(() => main(['touch', '--bee', bee, '--slug', 'alpha']));
  assert(touchResult.exit === 0, 'touch alpha succeeds after sync-global');

  // The per-spec STATE.md must STILL contain the COMPLETED marker — not overwritten by stale global
  const perSpecAfterTouch = fs.readFileSync(path.join(bee, 'specs', 'alpha', 'STATE.md'), 'utf8');
  assert(perSpecAfterTouch.includes(COMPLETED_MARKER),
    'per-spec STATE.md still contains COMPLETED marker after touch (sync-global prevents data loss)');
  assert(!perSpecAfterTouch.includes('STALE_PROMOTE_TIME_SNAPSHOT'),
    'per-spec STATE.md does not contain stale promote-time snapshot content after touch');
}

// ============================================================
// (c) sync-global on spec with no per-spec STATE.md exits non-zero
// ============================================================
console.log('\nsync-global (c): exits non-zero when per-spec STATE.md does not exist');
{
  const bee = tmpBee();
  // No per-spec STATE.md for 'ghost-spec'
  writeRegistry(bee, [
    { slug: 'ghost-spec', title: 'Ghost', stage: 'planning', location: 'in-place', created: '2026-01-01T00:00:00Z', last_touched: '2026-01-01T00:00:00Z' },
  ]);

  const { exit, stderr } = captureIO(() => main(['sync-global', '--bee', bee, '--slug', 'ghost-spec']));
  assert(exit !== 0, 'sync-global exits non-zero when per-spec STATE.md is missing');
  assert(stderr.includes('ghost-spec') && (stderr.includes('no per-spec') || stderr.includes('STATE.md')),
    'sync-global prints error to stderr mentioning the spec slug');
}

// ============================================================
// (c2) sync-global without --slug exits non-zero
// ============================================================
console.log('\nsync-global (c2): exits non-zero when --slug is missing');
{
  const bee = tmpBee();
  const { exit, stderr } = captureIO(() => main(['sync-global', '--bee', bee]));
  assert(exit !== 0, 'sync-global without --slug exits non-zero');
  assert(stderr.includes('sync-global requires --slug'), 'sync-global missing --slug prints usage error');
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
