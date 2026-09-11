#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const SCRIPTS_DIR = path.join(__dirname, '..');
const { main } = require(path.join(SCRIPTS_DIR, 'specs-cli.js'));
const { specMemoryPath } = require(path.join(SCRIPTS_DIR, 'spec-state.js'));

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}
function capture(fn) {
  let out = '';
  const oo = process.stdout.write.bind(process.stdout);
  const oe = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = () => true;
  let code;
  try { code = fn(); } finally { process.stdout.write = oo; process.stderr.write = oe; }
  return { out, code };
}
function tmpBee() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-inject-'));
  const beeDir = path.join(tmp, '.bee');
  fs.mkdirSync(beeDir, { recursive: true });
  return { tmp, beeDir };
}
function registerSilently(beeDir, slug, title) {
  const oo = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try { main(['register', '--bee', beeDir, '--slug', slug, '--title', title]); }
  finally { process.stdout.write = oo; }
}

console.log('Test Group 1: memory-context — single active spec with curated content');
{
  const { tmp, beeDir } = tmpBee();
  registerSilently(beeDir, '2026-06-20-alpha', 'Alpha');
  fs.writeFileSync(specMemoryPath(beeDir, '2026-06-20-alpha'),
    '# Spec Memory — Alpha\n\n- always use the repository pattern here\n');
  const { out, code } = capture(() => main(['memory-context', '--bee', beeDir]));
  assert(code === 0, 'exits 0');
  assert(out.includes('## Spec Memory (2026-06-20-alpha)'), 'emits the spec memory header with slug');
  assert(out.includes('always use the repository pattern here'), 'emits the curated content');
  assert(!out.includes('injected into every bee agent'), 'strips the template guidance comment');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\nTest Group 2: memory-context — template-only memory is treated as empty');
{
  const { tmp, beeDir } = tmpBee();
  registerSilently(beeDir, '2026-06-20-beta', 'Beta'); // leaves the untouched template
  const { out } = capture(() => main(['memory-context', '--bee', beeDir]));
  assert(out.trim() === '', 'no injection when only the template is present');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\nTest Group 3: memory-context — suppressed when 2+ specs are active');
{
  const { tmp, beeDir } = tmpBee();
  registerSilently(beeDir, '2026-06-20-one', 'One');
  registerSilently(beeDir, '2026-06-20-two', 'Two');
  fs.writeFileSync(specMemoryPath(beeDir, '2026-06-20-one'), '# Spec Memory — One\n\n- secret one\n');
  fs.writeFileSync(specMemoryPath(beeDir, '2026-06-20-two'), '# Spec Memory — Two\n\n- secret two\n');
  const { out } = capture(() => main(['memory-context', '--bee', beeDir]));
  assert(out.trim() === '', 'no injection with 2+ active specs (no per-chat binding)');
  assert(!out.includes('secret one') && !out.includes('secret two'), 'never leaks a spec memory when ambiguous');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\nTest Group 4: memory-context — nothing to inject when zero active specs');
{
  const { tmp, beeDir } = tmpBee();
  fs.writeFileSync(path.join(beeDir, 'specs.json'), JSON.stringify({ specs: [] }, null, 2) + '\n');
  const { out } = capture(() => main(['memory-context', '--bee', beeDir]));
  assert(out.trim() === '', 'no injection when there are no active specs');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\nTest Group 5: inject-memory.sh — wires the subcommand and injects both layers');
{
  const { tmp, beeDir } = tmpBee();
  registerSilently(beeDir, '2026-06-20-gamma', 'Gamma');
  fs.writeFileSync(specMemoryPath(beeDir, '2026-06-20-gamma'), '# Spec Memory — Gamma\n\n- gamma constraint\n');
  fs.writeFileSync(path.join(beeDir, 'user.md'), '- prefer small PRs\n');

  const script = path.join(SCRIPTS_DIR, 'inject-memory.sh');
  let out = '';
  try {
    out = execFileSync('bash', [script], {
      input: JSON.stringify({ agent_type: 'implementer' }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
      encoding: 'utf8',
    });
  } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  let ctx = '';
  try { ctx = JSON.parse(out).hookSpecificOutput.additionalContext; } catch (_) { ctx = out; }
  assert(ctx.includes('prefer small PRs'), 'inject-memory.sh still injects global user.md');
  assert(ctx.includes('## Spec Memory (2026-06-20-gamma)'), 'inject-memory.sh appends per-spec memory when one spec is active');
  assert(ctx.includes('gamma constraint'), 'per-spec curated content reaches the agent context');

  // Static wiring assertion (robust even where bash/jq differ)
  const shipSrc = fs.readFileSync(script, 'utf8');
  assert(shipSrc.includes('memory-context'), 'inject-memory.sh calls specs-cli.js memory-context');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\nTest Group 6: inject-memory.sh — 2+ active injects only user.md');
{
  const { tmp, beeDir } = tmpBee();
  registerSilently(beeDir, '2026-06-20-d1', 'D1');
  registerSilently(beeDir, '2026-06-20-d2', 'D2');
  fs.writeFileSync(specMemoryPath(beeDir, '2026-06-20-d1'), '# Spec Memory — D1\n\n- d1 secret\n');
  fs.writeFileSync(path.join(beeDir, 'user.md'), '- prefer small PRs\n');
  const script = path.join(SCRIPTS_DIR, 'inject-memory.sh');
  let out = '';
  try {
    out = execFileSync('bash', [script], {
      input: JSON.stringify({ agent_type: 'implementer' }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
      encoding: 'utf8',
    });
  } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  let ctx = '';
  try { ctx = JSON.parse(out).hookSpecificOutput.additionalContext; } catch (_) { ctx = out; }
  assert(ctx.includes('prefer small PRs'), 'user.md still injected with 2+ active specs');
  assert(!ctx.includes('Spec Memory') && !ctx.includes('d1 secret'), 'no per-spec memory injected with 2+ active specs');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\nTest Group 7: memory-context — legacy repo (no specs.json) falls back to global STATE.md');
{
  // Legacy setup: no specs.json, only a global .bee/STATE.md naming an active spec
  const { tmp, beeDir } = tmpBee();
  const slug = '2026-06-20-legacy-slug';
  // Write global STATE.md naming the active spec (legacy format — path uses .bee/specs/ prefix)
  const stateContent = [
    '# Bee Project State', '',
    '## Current Spec',
    `- Name: Legacy Feature`,
    `- Path: .bee/specs/${slug}/`,
    `- Status: IN_PROGRESS`, '',
    '## Phases',
    '| # | Name | Status | Plan | Plan Review | Executed | Reviewed | Tested | Committed |',
    '|---|------|--------|------|-------------|----------|----------|--------|-----------|', '',
  ].join('\n');
  fs.writeFileSync(path.join(beeDir, 'STATE.md'), stateContent);
  // No specs.json — legacy repo
  // Create the spec's memory.md with curated content (no registry, but file exists)
  const specDir = path.join(beeDir, 'specs', slug);
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'memory.md'),
    '# Spec Memory — Legacy Feature\n\n- always validate inputs on entry\n');
  const { out, code } = capture(() => main(['memory-context', '--bee', beeDir]));
  assert(code === 0, 'legacy: exits 0');
  assert(out.includes('## Spec Memory'), 'legacy: emits spec memory header');
  assert(out.includes('always validate inputs on entry'), 'legacy: curated content from legacy spec is injected');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\nTest Group 8: stripMemoryTemplate — user HTML comments survive injection');
{
  const { tmp, beeDir } = tmpBee();
  registerSilently(beeDir, '2026-06-20-comment-test', 'Comment Test');
  // Write memory with a user-authored HTML comment embedded in real content
  fs.writeFileSync(specMemoryPath(beeDir, '2026-06-20-comment-test'),
    '# Spec Memory — Comment Test\n\n- use pattern from <!-- https://example.com/docs -->\n');
  const { out, code } = capture(() => main(['memory-context', '--bee', beeDir]));
  assert(code === 0, 'user-comment: exits 0');
  assert(out.includes('https://example.com/docs'), 'user-comment: user HTML comment content survives injection');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\nTest Group 9: stripMemoryTemplate — template-only still suppressed after fix');
{
  // Regression: the fix must not break template suppression
  const { tmp, beeDir } = tmpBee();
  registerSilently(beeDir, '2026-06-20-template-only', 'Template Only'); // leaves untouched template
  const { out } = capture(() => main(['memory-context', '--bee', beeDir]));
  assert(out.trim() === '', 'template-only: no injection after fix (regression guard)');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
