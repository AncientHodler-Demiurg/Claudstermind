#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const SCRIPTS_DIR = path.join(__dirname, '..');
const { main } = require(path.join(SCRIPTS_DIR, 'specs-cli.js'));
const { specMemoryPath, initSpecMemory, renderSpecMemory } = require(path.join(SCRIPTS_DIR, 'spec-state.js'));

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}
function tmpBee() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-mem-init-'));
  const beeDir = path.join(tmp, '.bee');
  fs.mkdirSync(beeDir, { recursive: true });
  return { tmp, beeDir };
}
function silent(fn) {
  const oo = process.stdout.write.bind(process.stdout);
  const oe = process.stderr.write.bind(process.stderr);
  process.stdout.write = () => true; process.stderr.write = () => true;
  try { return fn(); } finally { process.stdout.write = oo; process.stderr.write = oe; }
}

console.log('Test Group 1: renderSpecMemory template');
{
  const t = renderSpecMemory({ name: 'My Spec' });
  assert(t.includes('# Spec Memory — My Spec'), 'template has a titled heading');
  assert(t.includes('<!--') && t.includes('-->'), 'template guidance is an HTML comment');
  assert(t.includes('injected into every bee agent'), 'template explains injection');
}

console.log('\nTest Group 2: initSpecMemory creates + is idempotent');
{
  const { tmp, beeDir } = tmpBee();
  const p = initSpecMemory(beeDir, '2026-06-20-foo', { name: 'Foo' });
  assert(p === specMemoryPath(beeDir, '2026-06-20-foo'), 'returns the spec memory path');
  assert(fs.existsSync(p), 'creates memory.md');
  assert(fs.readFileSync(p, 'utf8').includes('# Spec Memory — Foo'), 'writes the named template');

  fs.writeFileSync(p, '# Spec Memory — Foo\n\n- never edit the legacy adapter\n');
  initSpecMemory(beeDir, '2026-06-20-foo', { name: 'Foo' });
  assert(fs.readFileSync(p, 'utf8').includes('never edit the legacy adapter'), 'idempotent: does not overwrite curated content');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\nTest Group 3: register wires initSpecMemory (inside the lock)');
{
  const { tmp, beeDir } = tmpBee();
  const code = silent(() => main(['register', '--bee', beeDir, '--slug', '2026-06-20-bar', '--title', 'Bar']));
  assert(code === 0, 'register exits 0');
  const p = specMemoryPath(beeDir, '2026-06-20-bar');
  assert(fs.existsSync(p), 'register created the per-spec memory.md');
  assert(fs.readFileSync(p, 'utf8').includes('# Spec Memory — Bar'), 'memory.md uses the spec title as its name');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
