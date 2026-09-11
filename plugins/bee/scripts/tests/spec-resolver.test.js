#!/usr/bin/env node
const R = require('../specs-registry');
const { resolveTarget } = require('../spec-resolver');

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}`); }
}
function regWith(stages) {
  const reg = R.emptyRegistry();
  let t = 0;
  for (const [slug, stage] of stages) R.upsertSpec(reg, { slug, stage }, new Date(Date.UTC(2026, 5, 19, 10, 0, t++)).toISOString());
  return reg;
}

// 0 active -> create
assert(resolveTarget({ registry: regWith([['c', 'shipped']]) }).mode === 'create', '0 active -> create');

// 0 active BUT a legacy STATE.md spec -> auto that spec (backward compat)
let lg = resolveTarget({ registry: regWith([['c', 'shipped']]), legacySpec: 'old-spec' });
assert(lg.mode === 'auto' && lg.slug === 'old-spec', '0 active + legacySpec -> auto');
assert(lg.legacy === true, 'legacy fallback sets legacy:true');

// 1 active -> auto that spec (silent, today's UX)
let r = resolveTarget({ registry: regWith([['a', 'planning']]) });
assert(r.mode === 'auto' && r.slug === 'a', '1 active -> auto');

// 2+ active -> pick, last-touched first
r = resolveTarget({ registry: regWith([['a', 'planning'], ['b', 'shaping']]) });
assert(r.mode === 'pick', '2 active -> pick');
assert(r.candidates[0].slug === 'b', 'pick lists last-touched first');
assert(r.candidates.length === 2, 'pick lists all active');

// worktree wins regardless of count
r = resolveTarget({ registry: regWith([['a', 'planning'], ['b', 'shaping']]), worktreeSpec: 'a' });
assert(r.mode === 'auto' && r.slug === 'a', 'worktree spec overrides to auto');

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
