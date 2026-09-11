// spec-resolver.js -- decide which spec a command targets. Pure logic over the registry.
const { activeSpecs } = require('./specs-registry');

function resolveTarget({ registry, worktreeSpec, legacySpec }) {
  // worktreeSpec is wired for Step 3 (worktree promotion); no command passes it in Step 1 yet.
  if (worktreeSpec) return { mode: 'auto', slug: worktreeSpec };
  const active = activeSpecs(registry);
  if (active.length === 0) {
    if (legacySpec) return { mode: 'auto', slug: legacySpec, legacy: true };
    return { mode: 'create' };
  }
  if (active.length === 1) return { mode: 'auto', slug: active[0].slug };
  return { mode: 'pick', candidates: active.map(s => ({ slug: s.slug, title: s.title, stage: s.stage })) };
}

module.exports = { resolveTarget };
