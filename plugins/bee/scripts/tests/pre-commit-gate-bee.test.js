#!/usr/bin/env node
// Behavioral tests for pre-commit-gate.sh's bee self-gate branch, via spawnSync
// with fixture stdin JSON and temp-dir git-repo fixtures. Pins behaviors only:
// exit codes, block-JSON vs warning-JSON vs silent output by scenario, baseline
// warn-vs-block, deletion mapping, fail-open on infra failure, and byte-for-byte
// non-bee behavior (fast path intact).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const GATE = path.join(__dirname, '..', 'pre-commit-gate.sh');
const RUNNER_SRC = path.join(__dirname, '..', 'run-meta-tests.js');
const MAPPER_SRC = path.join(__dirname, '..', 'affected-suites.js');

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}

const STDIN = JSON.stringify({ tool_input: { command: 'git commit -m "x"' } });

function gate(root) {
  return spawnSync('bash', [GATE], {
    input: STDIN, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
}

// Bee-shaped fixture: git repo + .bee/config.json (claude-code-plugin stack) +
// plugins/bee/scripts with WORKING-TREE copies of the runner and mapper (the
// gate must execute the fixture repo's scripts, not any co-located copy).
function makeBeeRepo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bee-gate-')));
  execSync('git init -q', { cwd: root });
  execSync('git config user.email t@t && git config user.name t', { cwd: root });
  fs.mkdirSync(path.join(root, '.bee'), { recursive: true });
  fs.writeFileSync(path.join(root, '.bee/config.json'),
    JSON.stringify({ stacks: [{ name: 'claude-code-plugin', path: '.', linter: 'none', testRunner: 'none' }] }));
  fs.mkdirSync(path.join(root, 'plugins/bee/scripts/tests'), { recursive: true });
  fs.copyFileSync(RUNNER_SRC, path.join(root, 'plugins/bee/scripts/run-meta-tests.js'));
  fs.copyFileSync(MAPPER_SRC, path.join(root, 'plugins/bee/scripts/affected-suites.js'));
  return root;
}
function write(root, rel, body) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}
function stage(root, ...rels) { execSync(`git add ${rels.map(r => `'${r}'`).join(' ')}`, { cwd: root }); }
function commitAll(root) { execSync('git add -A && git commit -qm base', { cwd: root }); }

console.log('pre-commit-gate.sh — bee self-gate behaviors\n');

// 1. Non-bee project: markdown-only commit passes silently (fast path byte-for-byte)
{
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bee-gate-nb-')));
  execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: root });
  fs.mkdirSync(path.join(root, '.bee'), { recursive: true });
  fs.writeFileSync(path.join(root, '.bee/config.json'),
    JSON.stringify({ stacks: [{ name: 'laravel-inertia-vue', path: '.', linter: 'none', testRunner: 'none' }] }));
  write(root, 'README.md', 'hello');
  stage(root, 'README.md');
  const r = gate(root);
  assert(r.status === 0 && r.stdout.trim() === '', 'non-bee markdown-only commit: silent allow (fast path intact)');
  fs.rmSync(root, { recursive: true, force: true });
}

// 2. Bee repo: staged md referenced by a FAILING non-baselined suite => block JSON
{
  const root = makeBeeRepo();
  write(root, 'plugins/bee/commands/review.md', '# review');
  write(root, 'plugins/bee/scripts/tests/pins-review.test.js',
    "const path = require('path');\nconst f = path.join(__dirname, '..', '..', 'commands', 'review.md');\nprocess.exit(1);\n");
  commitAll(root);
  write(root, 'plugins/bee/commands/review.md', '# review v2');
  stage(root, 'plugins/bee/commands/review.md');
  const r = gate(root);
  assert(r.status === 0, 'gate always exits 0 (block is via JSON, not exit code)');
  let json = null; try { json = JSON.parse(r.stdout); } catch {}
  assert(json && json.decision === 'block', 'non-baselined failing affected suite => block JSON');
  assert(json && /pins-review\.test\.js/.test(json.reason), 'block reason names the failing suite');

  // 3. Same scenario, suite baselined => warning JSON (systemMessage, no decision), allow
  write(root, 'plugins/bee/scripts/meta-test-baseline.txt', 'plugins/bee/scripts/tests/pins-review.test.js\n');
  const r2 = gate(root);
  let j2 = null; try { j2 = JSON.parse(r2.stdout); } catch {}
  assert(j2 && j2.systemMessage && !j2.decision, 'baselined failure => warning JSON without decision key (allow)');
  assert(j2 && /WARN .*pins-review\.test\.js/.test(j2.systemMessage), 'warning carries the WARN line');

  // 4. Suite fixed => silent allow
  fs.writeFileSync(path.join(root, 'plugins/bee/scripts/meta-test-baseline.txt'), '');
  write(root, 'plugins/bee/scripts/tests/pins-review.test.js',
    "const path = require('path');\nconst f = path.join(__dirname, '..', '..', 'commands', 'review.md');\nprocess.exit(0);\n");
  const r3 = gate(root);
  assert(r3.status === 0 && r3.stdout.trim() === '', 'green affected suites => silent allow');

  // 5. Staged DELETION of a suite-referenced file => referencing suite still runs (and blocks if red)
  write(root, 'plugins/bee/scripts/tests/pins-review.test.js',
    "// pins review.md by basename: 'review.md'\nprocess.exit(1);\n");
  commitAll(root);
  execSync('git rm -q plugins/bee/commands/review.md', { cwd: root });
  const r4 = gate(root);
  let j4 = null; try { j4 = JSON.parse(r4.stdout); } catch {}
  assert(j4 && j4.decision === 'block' && /pins-review/.test(j4.reason),
    'staged deletion of a referenced file => referencing suite runs and blocks');

  // 6. Staged deletion of a SUITE itself => no block (deleted suite not runnable)
  execSync('git checkout -q . && git reset -q', { cwd: root });
  execSync('git rm -q plugins/bee/scripts/tests/pins-review.test.js', { cwd: root });
  const r5 = gate(root);
  let j5 = null; try { j5 = JSON.parse(r5.stdout); } catch {}
  assert(!(j5 && j5.decision === 'block'), 'staged deletion of a suite itself does not block');
  fs.rmSync(root, { recursive: true, force: true });
}

// 7. Zero affected suites => silent pass; infra failure => fail-open warning
{
  const root = makeBeeRepo();
  write(root, 'docs/note.md', 'x');
  commitAll(root);
  write(root, 'docs/note.md', 'y');
  stage(root, 'docs/note.md');
  const r = gate(root);
  assert(r.status === 0 && r.stdout.trim() === '', 'zero affected suites => silent pass');

  // infra: corrupt the fixture's runner so subset mode crashes hard (exit 2 path
  // is exercised via a runner that always exits 2)
  fs.writeFileSync(path.join(root, 'plugins/bee/scripts/run-meta-tests.js'),
    'process.argv.includes("--list") ? (console.log("plugins/bee/scripts/tests/x.test.js"), process.exit(0)) : process.exit(2);\n');
  write(root, 'plugins/bee/scripts/tests/x.test.js', "// references note.md\nprocess.exit(0);\n");
  const r2 = gate(root);
  let j2 = null; try { j2 = JSON.parse(r2.stdout); } catch {}
  assert(j2 && j2.systemMessage && /fail-open/.test(j2.systemMessage) && !j2.decision,
    'runner infra failure (exit 2) => allow with fail-open warning, never block');
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
