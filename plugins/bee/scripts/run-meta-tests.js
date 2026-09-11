#!/usr/bin/env node
// Aggregate runner for bee's own meta-test suites.
//
// CLI contract (consumed by pre-commit-gate.sh and the Phase-2 triage tooling):
//   node run-meta-tests.js --root <repo>                      full run
//   node run-meta-tests.js --root <repo> --subset s1 s2 ...   subset run (repo-relative or absolute)
//   node run-meta-tests.js --root <repo> --subset-stdin       subset list on stdin, one per line
//   node run-meta-tests.js --root <repo> --generate [--force] write the known-failing baseline
// Options:
//   --budget-ms <n>        overall wallclock budget for subset mode (default: none)
//   --suite-timeout-ms <n> per-suite kill timeout (default 120000)
//   --baseline <path>      baseline file (default: plugins/bee/scripts/meta-test-baseline.txt under --root)
//   --list                 print the discovered roster (repo-relative POSIX paths) and exit 0
//
// Suite discovery (dynamic, no hardcoded roster): plugins/bee/scripts/tests/*.test.js,
// plugins/bee/scripts/*.test.js, plugins/bee/scripts/tests/test-*.sh. The runner and its
// own test file are excluded from discovery. All paths are resolved from --root (or cwd),
// NEVER from __dirname: the pre-commit gate executes from the installed plugin cache and
// must run the working tree's runner over the working tree's suites.
//
// Suite identifiers are repo-relative POSIX paths everywhere: subset input, baseline
// entries, and report lines. Inputs are normalized before baseline-membership comparison.
//
// Status tokens (load-bearing; the gate's bash parses these literals — no variants):
//   PASS  suite exited 0
//   FAIL  suite exited non-zero, or was killed by its per-suite timeout with budget remaining
//   WARN  suite FAILed but is in the known-failing baseline (never blocks)
//   SKIP  suite not run: overall budget expired, or subset entry not found on disk (never blocks)
//
// Exit codes — run modes (full + subset):
//   0  every suite PASS (WARN/SKIP allowed)
//   1  at least one non-baselined FAIL
//   2  infrastructure failure, no suites executed (bad root, discovery crash)
// Exit codes — generation mode (DELIBERATELY different: failing suites are the normal
// input to generation; recording them IS success):
//   0  baseline written (regardless of how many suites failed)
//   1  ratchet-guard refusal: an existing baseline is present and the newly-failing set
//      is NOT a subset of it — would-be additions are printed, nothing written.
//      Override only with an explicit --force (re-hides regressions; use deliberately).
//   2  infrastructure failure, nothing written

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

// Suites are independent standalone processes (each uses its own tmp dirs), so they run
// in a bounded concurrency pool instead of one-at-a-time. Leave 2 cores headroom; cap at
// 8 — most suites themselves spawn node/bash children, so a higher cap oversubscribes the
// CPU and the heavy suites get SLOWER, not faster. Override with BEE_META_CONCURRENCY.
const CONCURRENCY = (() => {
  const env = parseInt(process.env.BEE_META_CONCURRENCY || '', 10);
  if (Number.isFinite(env) && env > 0) return env;
  return Math.max(1, Math.min(8, os.cpus().length - 2));
})();

// Timing-sensitive suites measure real wall-clock (e.g. validator NFR budgets) and must
// run on a quiet machine — they are excluded from the pool and run serially, alone, after
// it. Matched by filename so future perf suites opt in by name.
const isSerialSuite = (suiteRel) => /wallclock|-perf\b|\bperf-/.test(suiteRel);

const DEFAULT_BASELINE = 'plugins/bee/scripts/meta-test-baseline.txt';
const SELF = 'plugins/bee/scripts/run-meta-tests.js';
const SELF_TEST = 'plugins/bee/scripts/tests/run-meta-tests.test.js';

function parseArgs(argv) {
  const args = { subset: null, generate: false, force: false, list: false,
    budgetMs: null, suiteTimeoutMs: 120000, root: process.cwd(), baseline: null,
    subsetStdin: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') args.root = argv[++i];
    else if (a === '--subset') { args.subset = []; while (argv[i + 1] && !argv[i + 1].startsWith('--')) args.subset.push(argv[++i]); }
    else if (a === '--subset-stdin') args.subsetStdin = true;
    else if (a === '--generate') args.generate = true;
    else if (a === '--force') args.force = true;
    else if (a === '--list') args.list = true;
    else if (a === '--budget-ms') args.budgetMs = parseInt(argv[++i], 10);
    else if (a === '--suite-timeout-ms') args.suiteTimeoutMs = parseInt(argv[++i], 10);
    else if (a === '--baseline') args.baseline = argv[++i];
  }
  return args;
}

// Repo-relative POSIX path — the canonical suite identifier. Realpath the input when
// possible so symlinked tmpdirs (macOS /var -> /private/var) normalize consistently
// with the realpath'd root.
function normalize(p, root) {
  let abs = path.isAbsolute(p) ? p : path.resolve(root, p);
  try { abs = fs.realpathSync(abs); } catch { /* nonexistent (deleted/SKIP case) — use as-is */ }
  return path.relative(root, abs).split(path.sep).join('/');
}

function discover(root) {
  const out = [];
  const testsDir = path.join(root, 'plugins/bee/scripts/tests');
  const scriptsDir = path.join(root, 'plugins/bee/scripts');
  if (fs.existsSync(testsDir)) {
    for (const f of fs.readdirSync(testsDir)) {
      if (f.endsWith('.test.js') || (f.startsWith('test-') && f.endsWith('.sh'))) {
        out.push(`plugins/bee/scripts/tests/${f}`);
      }
    }
  }
  if (fs.existsSync(scriptsDir)) {
    for (const f of fs.readdirSync(scriptsDir)) {
      if (f.endsWith('.test.js')) out.push(`plugins/bee/scripts/${f}`);
    }
  }
  return out.filter(s => s !== SELF && s !== SELF_TEST).sort();
}

function readBaseline(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

// Run one suite as an async child. Resolves (never rejects) with {status, detail} — same
// shape and semantics as the former synchronous runSuite: a non-zero exit or a per-suite
// timeout kill is FAIL; a clean exit is PASS. stdio is ignored (the runner only consumes
// the exit code, exactly as before).
function runSuiteAsync(suiteRel, root, timeoutMs) {
  return new Promise((resolve) => {
    const abs = path.join(root, suiteRel);
    const cmd = suiteRel.endsWith('.sh') ? 'bash' : 'node';
    let settled = false;
    let timedOut = false;
    let hardKill = null;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (hardKill) clearTimeout(hardKill);
      resolve(r);
    };
    let child;
    try {
      child = spawn(cmd, [abs], { cwd: root, stdio: 'ignore' });
    } catch (e) {
      return resolve({ status: 'FAIL', detail: String(e) });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      hardKill = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 2000);
    }, timeoutMs);
    child.on('error', (err) => done({ status: 'FAIL', detail: String(err) }));
    child.on('close', (code, signal) => {
      if (timedOut || signal) return done({ status: 'FAIL', detail: `killed (per-suite timeout ${timeoutMs}ms)` });
      done({ status: code === 0 ? 'PASS' : 'FAIL', detail: '' });
    });
  });
}

// Bounded-concurrency map: runs worker(item, index) over all items with at most
// `concurrency` in flight, returning results in ITEM order (deterministic reporting,
// independent of completion order).
async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const lanes = [];
  for (let k = 0; k < Math.max(1, Math.min(concurrency, items.length)); k++) lanes.push(lane());
  await Promise.all(lanes);
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let root;
  try {
    root = fs.realpathSync(args.root);
    if (!fs.existsSync(path.join(root, 'plugins/bee/scripts'))) {
      process.stderr.write(`run-meta-tests: not a bee repo root: ${root}\n`);
      process.exit(2);
    }
  } catch (e) {
    process.stderr.write(`run-meta-tests: bad --root: ${e.message}\n`);
    process.exit(2);
  }

  const baselineFile = path.isAbsolute(args.baseline || '')
    ? args.baseline : path.join(root, args.baseline || DEFAULT_BASELINE);

  let roster;
  try { roster = discover(root); } catch (e) {
    process.stderr.write(`run-meta-tests: discovery failed: ${e.message}\n`);
    process.exit(2);
  }

  if (args.list) { roster.forEach(s => process.stdout.write(s + '\n')); process.exit(0); }

  // --- generation mode -------------------------------------------------------
  if (args.generate) {
    const failing = [];
    // Same split as run mode: pool for most, timing-sensitive suites serially + alone, so a
    // wallclock suite is never recorded as "failing" merely because the pool loaded the CPU.
    const genResults = new Array(roster.length);
    const genPoolIdx = [], genSerialIdx = [];
    roster.forEach((s, i) => (isSerialSuite(s) ? genSerialIdx : genPoolIdx).push(i));
    const gp = await runPool(genPoolIdx, CONCURRENCY, (i) => runSuiteAsync(roster[i], root, args.suiteTimeoutMs));
    genPoolIdx.forEach((i, k) => { genResults[i] = gp[k]; });
    for (const i of genSerialIdx) genResults[i] = await runSuiteAsync(roster[i], root, args.suiteTimeoutMs);
    for (let i = 0; i < roster.length; i++) {
      const suite = roster[i];
      const r = genResults[i];
      process.stdout.write(`${r.status === 'PASS' ? 'PASS' : 'FAIL'} ${suite}\n`);
      if (r.status !== 'PASS') failing.push(suite);
    }
    const existing = readBaseline(baselineFile);
    if (existing.length > 0 && !args.force) {
      const additions = failing.filter(s => !existing.includes(s));
      if (additions.length > 0) {
        process.stdout.write(`REFUSED: ${additions.length} would-be baseline addition(s) — a previously-green suite now fails (or post-baseline drift):\n`);
        additions.forEach(s => process.stdout.write(`  + ${s}\n`));
        process.stdout.write('Nothing written. Fix the regression or pass --force (re-hides it — deliberate use only).\n');
        process.exit(1);
      }
    }
    try {
      fs.writeFileSync(baselineFile,
        '# bee known-failing meta-test baseline — suites listed here WARN instead of BLOCK at the\n' +
        '# pre-commit self-gate. Ratchets DOWN only (run-meta-tests.js --generate refuses additions\n' +
        '# without --force). Empty file = every failure blocks.\n' +
        failing.map(s => s + '\n').join(''));
    } catch (e) {
      process.stderr.write(`run-meta-tests: cannot write baseline: ${e.message}\n`);
      process.exit(2);
    }
    process.stdout.write(`BASELINE ${failing.length} failing of ${roster.length} suites -> ${normalize(baselineFile, root)}\n`);
    process.exit(0);
  }

  // --- run modes (full / subset) ---------------------------------------------
  let toRun = roster;
  if (args.subsetStdin) {
    const stdin = fs.readFileSync(0, 'utf8');
    args.subset = stdin.split('\n').map(l => l.trim()).filter(Boolean);
  }
  if (args.subset) toRun = args.subset.map(s => normalize(s, root));

  const baseline = readBaseline(baselineFile).map(s => normalize(s, root));
  const deadline = args.budgetMs ? Date.now() + args.budgetMs : null;
  let pass = 0, fail = 0, warn = 0, skip = 0;
  const blockers = [];

  // Disposition for one suite, resolved at the moment it would launch (same order as the
  // former sequential loop: budget first, then missing) so a budget that expires mid-run
  // still SKIPs not-yet-started suites.
  const dispose = async (suite) => {
    if (deadline && Date.now() >= deadline) return { kind: 'skip-budget' };
    if (!fs.existsSync(path.join(root, suite))) return { kind: 'skip-missing' };
    const remaining = deadline ? Math.max(1, deadline - Date.now()) : args.suiteTimeoutMs;
    const perSuite = Math.min(args.suiteTimeoutMs, remaining);
    return { kind: 'ran', r: await runSuiteAsync(suite, root, perSuite) };
  };

  const outcomes = new Array(toRun.length);
  if (deadline) {
    // Budget mode (the pre-commit gate passes --budget-ms): the overall wallclock budget is
    // an inherently serial "run in order until the clock runs out, SKIP the rest" contract.
    // Run sequentially in toRun order to honour it exactly.
    for (let i = 0; i < toRun.length; i++) outcomes[i] = await dispose(toRun[i]);
  } else {
    // Full / unbudgeted run. Timing-sensitive suites (isSerialSuite) measure real wall-clock,
    // so they run FIRST — serially and alone, on the quiet machine before the pool heats it up
    // — then everything else runs in the parallel pool.
    const poolIdx = [];
    const serialIdx = [];
    toRun.forEach((suite, i) => (isSerialSuite(suite) ? serialIdx : poolIdx).push(i));
    for (const i of serialIdx) outcomes[i] = await dispose(toRun[i]);
    const poolRes = await runPool(poolIdx, CONCURRENCY, (i) => dispose(toRun[i]));
    poolIdx.forEach((i, k) => { outcomes[i] = poolRes[k]; });
  }

  // Report in toRun order — deterministic regardless of completion order.
  for (let i = 0; i < toRun.length; i++) {
    const suite = toRun[i];
    const o = outcomes[i];
    if (o.kind === 'skip-budget') {
      process.stdout.write(`SKIP ${suite} (budget expired — run the full aggregate: node ${SELF})\n`);
      skip++; continue;
    }
    if (o.kind === 'skip-missing') {
      process.stdout.write(`SKIP ${suite} (not found on disk)\n`);
      skip++; continue;
    }
    const r = o.r;
    if (r.status === 'PASS') { process.stdout.write(`PASS ${suite}\n`); pass++; }
    else if (baseline.includes(suite)) { process.stdout.write(`WARN ${suite} (baselined known-failing)\n`); warn++; }
    else {
      process.stdout.write(`FAIL ${suite}${r.detail ? ' (' + r.detail + ')' : ''}\n`);
      fail++; blockers.push(suite);
    }
  }

  process.stdout.write(`SUMMARY total=${toRun.length} pass=${pass} fail=${fail} warn=${warn} skip=${skip}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  process.stderr.write(`run-meta-tests: unexpected failure: ${e && e.stack ? e.stack : e}\n`);
  process.exit(2);
});
