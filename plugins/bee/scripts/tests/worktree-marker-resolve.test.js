#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const SCRIPTS_DIR = path.join(__dirname, '..');
const { main } = require(path.join(SCRIPTS_DIR, 'specs-cli.js'));

let passed = 0, failed = 0;
function assert(c, n) { if (c) { passed++; console.log(`  PASS: ${n}`); } else { failed++; console.log(`  FAIL: ${n}`); } }
function cap(fn) { let o = ''; const w = process.stdout.write.bind(process.stdout); process.stdout.write = s => { o += s; return true; }; try { fn(); } finally { process.stdout.write = w; } return o; }
function tmpBee() { const t = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-wtmarker-')); const b = path.join(t, '.bee'); fs.mkdirSync(b, { recursive: true }); return { t, b }; }
function reg(b, slugs) { fs.writeFileSync(path.join(b, 'specs.json'), JSON.stringify({ specs: slugs.map((s, i) => ({ slug: s, title: s, stage: 'planning', location: 'in-place', created: '2026-01-0' + (i + 1) + 'T00:00:00Z', last_touched: '2026-01-0' + (i + 1) + 'T00:00:00Z' })) }, null, 2)); }

console.log('Group 1: marker present → directory wins even with 2+ active specs');
{
  const { t, b } = tmpBee();
  reg(b, ['2026-06-20-aaa', '2026-06-20-bbb']); // 2 active → would normally be mode=pick
  fs.writeFileSync(path.join(b, 'worktree-spec'), '2026-06-20-bbb\n');
  const out = JSON.parse(cap(() => main(['resolve', '--bee', b])));
  assert(out.mode === 'auto' && out.slug === '2026-06-20-bbb', 'marker forces mode=auto on its slug despite 2 active');
  fs.rmSync(t, { recursive: true, force: true });
}

console.log('\nGroup 2: marker absent → normal 0/1/2+ rule');
{
  const { t, b } = tmpBee();
  reg(b, ['2026-06-20-aaa', '2026-06-20-bbb']);
  const out = JSON.parse(cap(() => main(['resolve', '--bee', b])));
  assert(out.mode === 'pick', 'no marker → 2 active still yields pick');
  fs.rmSync(t, { recursive: true, force: true });
}

console.log('\nGroup 3: explicit --worktree-spec flag still wins (unchanged)');
{
  const { t, b } = tmpBee();
  reg(b, ['2026-06-20-aaa', '2026-06-20-bbb']);
  const out = JSON.parse(cap(() => main(['resolve', '--bee', b, '--worktree-spec', '2026-06-20-aaa'])));
  assert(out.mode === 'auto' && out.slug === '2026-06-20-aaa', 'explicit flag wins');
  fs.rmSync(t, { recursive: true, force: true });
}

console.log('\nGroup 4: marker also binds memory-context (no cross-spec leak in a worktree)');
{
  const { t, b } = tmpBee();
  reg(b, ['2026-06-20-aaa', '2026-06-20-bbb']);
  fs.writeFileSync(path.join(b, 'worktree-spec'), '2026-06-20-bbb\n');
  fs.mkdirSync(path.join(b, 'specs', '2026-06-20-bbb'), { recursive: true });
  fs.writeFileSync(path.join(b, 'specs', '2026-06-20-bbb', 'memory.md'), '# Spec Memory — bbb\n\n- bbb only\n');
  fs.mkdirSync(path.join(b, 'specs', '2026-06-20-aaa'), { recursive: true });
  fs.writeFileSync(path.join(b, 'specs', '2026-06-20-aaa', 'memory.md'), '# Spec Memory — aaa\n\n- aaa secret\n');
  const out = cap(() => main(['memory-context', '--bee', b]));
  assert(out.includes('bbb only') && !out.includes('aaa secret'), 'worktree injects only the bound spec memory');
  fs.rmSync(t, { recursive: true, force: true });
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
