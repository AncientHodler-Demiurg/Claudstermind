#!/usr/bin/env node
// Maps staged file paths to the bee meta-test suites that reference them.
// Consumed by pre-commit-gate.sh (bee self-gate branch).
//
// CLI contract:
//   node affected-suites.js --root <repo> <staged-path> [<staged-path> ...]
//   node affected-suites.js --root <repo> --stdin        (one staged path per line)
// Output: affected suite identifiers (repo-relative POSIX paths, the canonical form
// shared with run-meta-tests.js), one per line, deduplicated, sorted. Zero matches
// produce EMPTY output with exit 0 (the gate treats this as silent pass). Exit 2 =
// infrastructure failure (bad root) — callers MUST fail open.
//
// Selection rules:
//   1. A staged file that is itself a suite IN THE LIVE ROSTER is always its own
//      affected set member. Staged-DELETED suite paths are NOT emitted (nothing to
//      run); their basenames still participate in rule 2. Mapper output is always
//      a subset of the live roster.
//   2. A suite is affected when its source references a staged file. BASENAME
//      matching is the unconditional primary mechanism: the dominant suite idiom is
//      two-arg path.join(DIR_CONST, 'name.md'), so directory and basename are never
//      contiguous in suite source — contiguous full-path matching alone would
//      under-select. Contiguous path-suffix matching is an additional signal.
//      Over-selection is acceptable (the runner's budget absorbs it); under-selection
//      is not. Deleted staged paths participate here too — a deleted file's basename
//      is exactly what referencing suites pin.
//
// The live roster comes from run-meta-tests.js --list (single owner of discovery);
// if that fails, the mapper falls back to its own identical glob so the gate's
// fail-open behavior stays local to genuine infrastructure failures.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = { root: process.cwd(), stdin: false, staged: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') args.root = argv[++i];
    else if (a === '--stdin') args.stdin = true;
    else args.staged.push(a);
  }
  return args;
}

function discoverFallback(root) {
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
  return out.filter(s => s !== 'plugins/bee/scripts/run-meta-tests.js'
    && s !== 'plugins/bee/scripts/tests/run-meta-tests.test.js').sort();
}

function roster(root) {
  const runner = path.join(root, 'plugins/bee/scripts/run-meta-tests.js');
  if (fs.existsSync(runner)) {
    const res = spawnSync('node', [runner, '--root', root, '--list'], { encoding: 'utf8', timeout: 15000 });
    if (res.status === 0 && res.stdout.trim()) {
      return res.stdout.split('\n').map(l => l.trim()).filter(Boolean);
    }
  }
  return discoverFallback(root);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let root;
  try {
    root = fs.realpathSync(args.root);
    if (!fs.existsSync(path.join(root, 'plugins/bee/scripts'))) {
      process.stderr.write(`affected-suites: not a bee repo root: ${root}\n`);
      process.exit(2);
    }
  } catch (e) {
    process.stderr.write(`affected-suites: bad --root: ${e.message}\n`);
    process.exit(2);
  }

  let staged = args.staged;
  if (args.stdin) staged = fs.readFileSync(0, 'utf8').split('\n');
  staged = staged.map(s => s.trim()).filter(Boolean)
    .map(s => s.split(path.sep).join('/').replace(/^\.\//, ''));
  if (staged.length === 0) process.exit(0);

  const suites = roster(root);
  const affected = new Set();

  // Rule 1: staged live-roster suites select themselves.
  for (const s of staged) if (suites.includes(s)) affected.add(s);

  // Rule 2: basename-primary + contiguous-suffix matching over suite sources.
  const needles = staged.map(s => {
    const segs = s.split('/');
    return { basename: segs[segs.length - 1], suffix2: segs.slice(-2).join('/'), full: s };
  });
  for (const suite of suites) {
    if (affected.has(suite)) continue;
    let src;
    try { src = fs.readFileSync(path.join(root, suite), 'utf8'); } catch { continue; }
    for (const n of needles) {
      if (suite.endsWith('/' + n.basename)) continue; // self-name, handled by rule 1
      if (src.includes(n.basename) || src.includes(n.suffix2) || src.includes(n.full)) {
        affected.add(suite);
        break;
      }
    }
  }

  [...affected].sort().forEach(s => process.stdout.write(s + '\n'));
  process.exit(0);
}

main();
