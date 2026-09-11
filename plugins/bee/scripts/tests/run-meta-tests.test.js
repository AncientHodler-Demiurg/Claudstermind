#!/usr/bin/env node
// Behavioral tests for run-meta-tests.js and affected-suites.js (fixture-rooted —
// never executes the real 179-suite roster). Pins the cross-file contracts the
// pre-commit self-gate depends on: discovery, exit codes (run 0/1/2 vs generation
// 0/1/2), the four status tokens, canonical repo-relative identifiers, baseline
// warn-vs-block + ratchet-down guard, budget/timeout dispositions, and the
// mapper's three selection rules.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RUNNER = path.join(__dirname, '..', 'run-meta-tests.js');
const MAPPER = path.join(__dirname, '..', 'affected-suites.js');

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}

// Fixture repo: a fake bee-shaped tree with tiny suites. The runner resolves from
// --root, so the fixture's suites — not this repo's — are what runs (pins the
// cache-vs-working-tree contract: __dirname-relative resolution would gate stale code).
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-rmt-'));
  fs.mkdirSync(path.join(root, 'plugins/bee/scripts/tests'), { recursive: true });
  return root;
}
function addSuite(root, rel, body) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}
const PASS_JS = '#!/usr/bin/env node\nprocess.exit(0);\n';
const FAIL_JS = '#!/usr/bin/env node\nprocess.exit(1);\n';
const HANG_JS = '#!/usr/bin/env node\nsetTimeout(()=>{}, 60000);\n';
const PASS_SH = '#!/bin/bash\nexit 0\n';

function run(args, opts = {}) {
  return spawnSync('node', [RUNNER, ...args], { encoding: 'utf8', timeout: 60000, ...opts });
}
function map(args, opts = {}) {
  return spawnSync('node', [MAPPER, ...args], { encoding: 'utf8', timeout: 60000, ...opts });
}

console.log('run-meta-tests.js + affected-suites.js — behavioral contracts\n');

// 1. Discovery: both locations + bash suites; runner excludes itself
{
  const root = makeRepo();
  addSuite(root, 'plugins/bee/scripts/tests/a.test.js', PASS_JS);
  addSuite(root, 'plugins/bee/scripts/b.test.js', PASS_JS);
  addSuite(root, 'plugins/bee/scripts/tests/test-c.sh', PASS_SH);
  addSuite(root, 'plugins/bee/scripts/run-meta-tests.js', FAIL_JS); // fixture's own runner copy
  const r = run(['--root', root, '--list']);
  const lines = r.stdout.trim().split('\n');
  assert(r.status === 0, 'list mode exits 0');
  assert(lines.includes('plugins/bee/scripts/tests/a.test.js'), 'discovers tests/*.test.js');
  assert(lines.includes('plugins/bee/scripts/b.test.js'), 'discovers root-level scripts/*.test.js');
  assert(lines.includes('plugins/bee/scripts/tests/test-c.sh'), 'discovers bash test-*.sh suites');
  assert(!lines.includes('plugins/bee/scripts/run-meta-tests.js'), 'runner excludes itself from discovery');
  assert(lines.every(l => !path.isAbsolute(l)), 'identifiers are repo-relative');
  fs.rmSync(root, { recursive: true, force: true });
}

// 2. Full-run exit codes + PASS/FAIL tokens + summary
{
  const root = makeRepo();
  addSuite(root, 'plugins/bee/scripts/tests/ok.test.js', PASS_JS);
  addSuite(root, 'plugins/bee/scripts/tests/bad.test.js', FAIL_JS);
  const r = run(['--root', root]);
  assert(r.status === 1, 'full run exits 1 when a suite fails');
  assert(/^PASS plugins\/bee\/scripts\/tests\/ok\.test\.js$/m.test(r.stdout), 'PASS token + identifier line');
  assert(/^FAIL plugins\/bee\/scripts\/tests\/bad\.test\.js/m.test(r.stdout), 'FAIL token + identifier line');
  assert(/^SUMMARY total=2 pass=1 fail=1 warn=0 skip=0$/m.test(r.stdout), 'summary line with counts');
  fs.writeFileSync(path.join(root, 'plugins/bee/scripts/tests/bad.test.js'), PASS_JS);
  assert(run(['--root', root]).status === 0, 'full run exits 0 when all pass');
  fs.rmSync(root, { recursive: true, force: true });
}

// 3. Infra failure: bad root => exit 2, nothing executed
{
  const r = run(['--root', '/nonexistent-bee-root-xyz']);
  assert(r.status === 2, 'bad --root exits 2 (infra, distinct from suite failure)');
}

// 4. Baseline: WARN never blocks, non-baselined FAIL blocks, empty baseline blocks all
{
  const root = makeRepo();
  addSuite(root, 'plugins/bee/scripts/tests/known.test.js', FAIL_JS);
  addSuite(root, 'plugins/bee/scripts/tests/fresh.test.js', FAIL_JS);
  const bl = path.join(root, 'plugins/bee/scripts/meta-test-baseline.txt');
  fs.writeFileSync(bl, 'plugins/bee/scripts/tests/known.test.js\n');
  const r = run(['--root', root]);
  assert(/^WARN plugins\/bee\/scripts\/tests\/known\.test\.js/m.test(r.stdout), 'baselined failure reports WARN');
  assert(/^FAIL plugins\/bee\/scripts\/tests\/fresh\.test\.js/m.test(r.stdout), 'non-baselined failure reports FAIL');
  assert(r.status === 1, 'non-baselined FAIL blocks (exit 1)');
  // remove the fresh failure: only the baselined one remains -> allow
  fs.writeFileSync(path.join(root, 'plugins/bee/scripts/tests/fresh.test.js'), PASS_JS);
  assert(run(['--root', root]).status === 0, 'WARN-only run exits 0 (baselined never blocks)');
  // ratchet: remove from baseline -> blocks again right away
  fs.writeFileSync(bl, '');
  assert(run(['--root', root]).status === 1, 'emptied baseline: previously-baselined failure blocks');
  fs.rmSync(root, { recursive: true, force: true });
}

// 5. Generation mode: exit 0 with failures recorded; ratchet-down guard refuses additions
{
  const root = makeRepo();
  addSuite(root, 'plugins/bee/scripts/tests/red1.test.js', FAIL_JS);
  addSuite(root, 'plugins/bee/scripts/tests/green.test.js', PASS_JS);
  const bl = path.join(root, 'plugins/bee/scripts/meta-test-baseline.txt');
  const g1 = run(['--root', root, '--generate']);
  assert(g1.status === 0, 'generation exits 0 even with failing suites (recording them IS success)');
  const entries = fs.readFileSync(bl, 'utf8').split('\n').filter(l => l && !l.startsWith('#'));
  assert(entries.length === 1 && entries[0] === 'plugins/bee/scripts/tests/red1.test.js',
    'baseline contains exactly the failing suite, repo-relative');
  // a new regression appears: guard must refuse (exit 1), baseline untouched
  addSuite(root, 'plugins/bee/scripts/tests/red2.test.js', FAIL_JS);
  const g2 = run(['--root', root, '--generate']);
  assert(g2.status === 1, 'ratchet-down guard refuses additions (exit 1, distinct from infra 2)');
  assert(g2.stdout.includes('red2.test.js'), 'refusal prints the would-be addition');
  const after = fs.readFileSync(bl, 'utf8');
  assert(!after.includes('red2.test.js'), 'refusal writes nothing');
  // --force overrides deliberately
  assert(run(['--root', root, '--generate', '--force']).status === 0, '--force overrides the guard');
  assert(fs.readFileSync(bl, 'utf8').includes('red2.test.js'), '--force writes the addition');
  // shrink-only regeneration passes the guard
  fs.writeFileSync(path.join(root, 'plugins/bee/scripts/tests/red1.test.js'), PASS_JS);
  assert(run(['--root', root, '--generate']).status === 0, 'subset (removal-only) regeneration passes the guard');
  fs.rmSync(root, { recursive: true, force: true });
}

// 6. Subset mode + budget + timeout dispositions + nonexistent entries
{
  const root = makeRepo();
  addSuite(root, 'plugins/bee/scripts/tests/ok.test.js', PASS_JS);
  addSuite(root, 'plugins/bee/scripts/tests/hang.test.js', HANG_JS);
  // (a) per-suite timeout kill with budget remaining => FAIL (a hang regression must block)
  const r1 = run(['--root', root, '--subset', 'plugins/bee/scripts/tests/hang.test.js', '--suite-timeout-ms', '500', '--budget-ms', '30000']);
  assert(/^FAIL plugins\/bee\/scripts\/tests\/hang\.test\.js/m.test(r1.stdout), 'per-suite-timeout kill with budget remaining => FAIL');
  assert(r1.status === 1, 'hang-kill FAIL blocks');
  // (b) overall budget expiry => SKIP, never blocks
  const r2 = run(['--root', root, '--subset',
    'plugins/bee/scripts/tests/hang.test.js', 'plugins/bee/scripts/tests/ok.test.js',
    '--suite-timeout-ms', '60000', '--budget-ms', '400']);
  assert(/^SKIP plugins\/bee\/scripts\/tests\/ok\.test\.js \(budget expired/m.test(r2.stdout), 'budget expiry => SKIP with full-run recommendation');
  assert(!/^FAIL plugins\/bee\/scripts\/tests\/ok\.test\.js/m.test(r2.stdout), 'budget-skipped suite is not FAILed');
  // (c) nonexistent subset entry => SKIP, never spawned, never blocks
  const r3 = run(['--root', root, '--subset', 'plugins/bee/scripts/tests/gone.test.js']);
  assert(/^SKIP plugins\/bee\/scripts\/tests\/gone\.test\.js \(not found/m.test(r3.stdout), 'nonexistent subset entry => SKIP');
  assert(r3.status === 0, 'SKIP-only subset run exits 0');
  // (d) identifier normalization: absolute input matches the relative baseline entry
  fs.writeFileSync(path.join(root, 'plugins/bee/scripts/tests/ok.test.js'), FAIL_JS);
  fs.writeFileSync(path.join(root, 'plugins/bee/scripts/meta-test-baseline.txt'), 'plugins/bee/scripts/tests/ok.test.js\n');
  const r4 = run(['--root', root, '--subset', path.join(root, 'plugins/bee/scripts/tests/ok.test.js')]);
  assert(/^WARN /m.test(r4.stdout) && r4.status === 0, 'absolute subset input normalizes and matches baseline (WARN, allow)');
  fs.rmSync(root, { recursive: true, force: true });
}

// 7. Mapper: live-roster self-selection, basename-primary (two-arg join idiom),
//    deleted suites excluded from output but their basenames still match, zero-match empty
{
  const root = makeRepo();
  // fixture runner copy so the mapper's roster call uses the fixture tree
  fs.copyFileSync(RUNNER, path.join(root, 'plugins/bee/scripts/run-meta-tests.js'));
  // suite referencing its target via the dominant two-arg join idiom (never contiguous)
  addSuite(root, 'plugins/bee/scripts/tests/pins-review.test.js',
    "const path = require('path');\nconst CMD_DIR = path.join(__dirname, '..', '..', 'commands');\nconst target = path.join(CMD_DIR, 'review.md');\nprocess.exit(0);\n");
  addSuite(root, 'plugins/bee/scripts/tests/pins-nothing.test.js', PASS_JS);
  addSuite(root, 'plugins/bee/scripts/tests/test-bash.sh', PASS_SH);
  // basename-primary: contiguous 'commands/review.md' never appears in pins-review source
  const m1 = map(['--root', root, 'plugins/bee/commands/review.md']);
  const out1 = m1.stdout.trim().split('\n').filter(Boolean);
  assert(out1.includes('plugins/bee/scripts/tests/pins-review.test.js'), 'basename match selects two-arg-join suite');
  assert(!out1.includes('plugins/bee/scripts/tests/pins-nothing.test.js'), 'non-referencing suite not selected');
  // rule 1: a staged live suite is its own affected set (incl. bash suites)
  const m2 = map(['--root', root, 'plugins/bee/scripts/tests/test-bash.sh']);
  assert(m2.stdout.trim() === 'plugins/bee/scripts/tests/test-bash.sh', 'staged live suite selects itself (bash suite in roster)');
  // staged DELETED suite: not emitted (nothing to run), basename still a matching input
  addSuite(root, 'plugins/bee/scripts/tests/refs-gone.test.js',
    "// references gone-suite.test.js by basename\nprocess.exit(0);\n");
  const m3 = map(['--root', root, 'plugins/bee/scripts/tests/gone-suite.test.js']);
  const out3 = m3.stdout.trim().split('\n').filter(Boolean);
  assert(!out3.includes('plugins/bee/scripts/tests/gone-suite.test.js'), 'deleted suite path not emitted as runnable');
  assert(out3.includes('plugins/bee/scripts/tests/refs-gone.test.js'), "deleted suite's basename still selects referencing suites");
  // zero matches: empty output, exit 0
  const m4 = map(['--root', root, 'docs/unrelated.md']);
  assert(m4.status === 0 && m4.stdout.trim() === '', 'zero matches => empty output, exit 0');
  // infra: bad root => exit 2
  assert(map(['--root', '/nonexistent-bee-root-xyz', 'x.md']).status === 2, 'mapper bad --root exits 2 (fail-open signal)');
  // roster equivalence: mapper's roster == runner's --list on the same fixture tree
  const rl = run(['--root', root, '--list']).stdout.trim().split('\n').sort().join('|');
  const m5 = map(['--root', root,
    'plugins/bee/scripts/tests/pins-review.test.js', 'plugins/bee/scripts/tests/pins-nothing.test.js',
    'plugins/bee/scripts/tests/test-bash.sh', 'plugins/bee/scripts/tests/refs-gone.test.js']);
  assert(m5.stdout.trim().split('\n').sort().join('|') === rl, 'mapper roster equals runner --list roster (single discovery owner)');
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
