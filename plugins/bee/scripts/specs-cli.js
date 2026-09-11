#!/usr/bin/env node
// specs-cli.js -- CLI seam so markdown commands drive the multi-spec registry without
// inlining JSON logic in prose. Subcommands: register, list, resolve, touch, set-stage, memory-context, set-location, sync-global, guard.
const fs = require('fs');
const path = require('path');
const reg = require('./specs-registry');
const { resolveTarget } = require('./spec-resolver');
const { initSpecState, mirrorToGlobal, specStatePath, snapshotToPerSpec, globalStatePath, restoreToGlobal, initSpecMemory, specMemoryPath } = require('./spec-state');
const { parseStateMd } = require('./hive-state-parser');

function nowIso() { return new Date().toISOString(); }

function currentGlobalSlug(beeDir) {
  const g = globalStatePath(beeDir);
  if (!fs.existsSync(g)) return null;
  const cs = parseStateMd(g).currentSpec;
  return (cs && cs.path && cs.status && cs.status !== 'NO_SPEC') ? cs.path : null;
}

// Shared resolver entry: registry + legacy-STATE fallback (when the registry has no specs at
// all). Used by both `resolve` and `memory-context` so the 0/1/2+ rule lives in one place.
function doResolve(beeDir, f) {
  let worktreeSpec = f['worktree-spec'] || null;
  // Directory wins: inside a promoted spec's worktree a `.bee/worktree-spec` marker names the
  // bound spec. It overrides the registry's 0/1/2+ count so the worktree never shows a picker
  // and never injects another spec's memory, even though the copied specs.json lists others.
  if (!worktreeSpec) {
    try {
      const marker = path.join(beeDir, 'worktree-spec');
      if (fs.existsSync(marker)) {
        const m = fs.readFileSync(marker, 'utf8').trim();
        if (m) worktreeSpec = m;
      }
    } catch (_) { /* ignore — fall through to registry resolution */ }
  }
  const r = reg.readRegistry(beeDir);
  let legacySpec = null;
  if (r.specs.length === 0) {
    const st = parseStateMd(path.join(beeDir, 'STATE.md'));
    if (st.currentSpec && st.currentSpec.path && st.currentSpec.status && st.currentSpec.status !== 'NO_SPEC') {
      legacySpec = st.currentSpec.path;
    }
  }
  return resolveTarget({ registry: r, worktreeSpec, legacySpec });
}

// Curated content of a per-spec memory.md = the file minus its template title heading and the
// template guidance comment. Empty string means "only the template / nothing to inject".
function stripMemoryTemplate(s) {
  let t = String(s).replace(/<!--\s*bee-spec-memory-template[\s\S]*?-->/g, '');
  t = t.replace(/^\s*#\s+Spec Memory\b.*$/m, '');
  return t.trim();
}

function backfillLegacySpec(beeDir) {
  const r = reg.readRegistry(beeDir);
  if (reg.activeSpecs(r).length > 0) return;            // already have registered active specs
  const globalState = path.join(beeDir, 'STATE.md');
  if (!fs.existsSync(globalState)) return;
  const cs = parseStateMd(globalState).currentSpec;
  if (!cs || !cs.path || !cs.status || cs.status === 'NO_SPEC') return;
  if (reg.getSpec(r, cs.path)) return;                  // already registered
  // Preserve A's state: seed its per-spec STATE.md from the current global mirror (which holds A's state)
  const perSpec = specStatePath(beeDir, cs.path);
  if (!fs.existsSync(perSpec)) {
    fs.mkdirSync(path.dirname(perSpec), { recursive: true });
    fs.writeFileSync(perSpec, fs.readFileSync(globalState, 'utf8'));
  }
  // Register A as an active spec so it stays visible/recoverable
  const stage = cs.status === 'IN_PROGRESS' ? 'executing' : 'planning';
  reg.upsertSpec(r, { slug: cs.path, title: cs.name || cs.path, stage, location: 'in-place' }, nowIso());
  reg.writeRegistry(beeDir, r);
  initSpecMemory(beeDir, cs.path, { name: cs.name || cs.path });
}

function parseFlags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) f[key] = true;
    else { f[key] = next; i++; }
  }
  return f;
}

function main(argv) {
  const sub = argv[0];
  const f = parseFlags(argv.slice(1));
  const beeDir = f.bee || '.bee';

  if (sub === 'register') {
    if (typeof f.slug !== 'string' || !f.slug) { process.stderr.write('register requires --slug\n'); return 1; }
    fs.mkdirSync(beeDir, { recursive: true });
    // FIX 1: ALL STATE.md sync (snapshot/restore/init) must run INSIDE the same
    // withRegistryLock as the registry read+write so register+touch races cannot
    // interleave STATE.md file writes and corrupt the global.
    reg.withRegistryLock(beeDir, () => {
      // Back-fill legacy spec while holding the lock so a concurrent register
      // cannot produce duplicate entries from the same legacy slug.
      backfillLegacySpec(beeDir);
      const outgoing = currentGlobalSlug(beeDir);
      if (outgoing && outgoing !== f.slug) snapshotToPerSpec(beeDir, outgoing);
      const r = reg.readRegistry(beeDir);
      const existing = reg.getSpec(r, f.slug);
      let stage = f.stage || 'shaping';
      // --force-stage bypasses the no-regress guard (used only by Overwrite in new-spec)
      if (!f['force-stage'] && existing && reg.STAGES.indexOf(stage) < reg.STAGES.indexOf(existing.stage)) stage = existing.stage;
      reg.upsertSpec(r, { slug: f.slug, title: f.title, stage, location: 'in-place' }, nowIso());
      reg.writeRegistry(beeDir, r);
      // STATE.md sync inside the lock: init per-spec file, then mirror/restore.
      // Track whether initSpecState created a genuinely new file (Overwrite deleted it)
      // so we can distinguish "re-register live spec" from "Overwrite reset".
      const perSpecExistedBefore = fs.existsSync(specStatePath(beeDir, f.slug));
      initSpecState(beeDir, f.slug, { name: f.title || f.slug, status: 'SPEC_CREATED' });
      // Per-spec memory file (idempotent): created alongside STATE.md so it exists from
      // registration. If an Overwrite cleared the spec folder, this re-seeds the template;
      // a normal re-register preserves any curated content.
      initSpecMemory(beeDir, f.slug, { name: f.title || f.slug });
      const freshlyCreated = !perSpecExistedBefore;
      if (!freshlyCreated && currentGlobalSlug(beeDir) === f.slug) {
        // Re-registering the spec already reflected in global (not an Overwrite reset):
        // capture the live global into its per-spec snapshot instead of clobbering it.
        snapshotToPerSpec(beeDir, f.slug);
      } else {
        // New spec, Overwrite reset, or incoming spec switch:
        // restore the (fresh or incoming) per-spec snapshot into the global.
        restoreToGlobal(beeDir, f.slug);
      }
    });
    process.stdout.write(`registered ${f.slug}\n`);
    return 0;
  }
  if (sub === 'list') {
    const r = reg.readRegistry(beeDir);
    const specs = f.active ? reg.activeSpecs(r) : r.specs;
    if (f.json) { process.stdout.write(JSON.stringify(specs, null, 2) + '\n'); return 0; }
    if (specs.length === 0) { process.stdout.write('No specs.\n'); return 0; }
    for (const s of specs) process.stdout.write(`${s.slug}\t${s.stage}\t${s.location}\t${s.title}\n`);
    return 0;
  }
  if (sub === 'resolve') {
    let result = doResolve(beeDir, f);
    if (result.mode === 'pick' && result.candidates.length > 3) {
      const total = result.candidates.length;
      result = { ...result, candidates: result.candidates.slice(0, 3), more: total - 3 };
    }
    process.stdout.write(JSON.stringify(result) + '\n');
    return 0;
  }
  if (sub === 'memory-context') {
    // Inject a spec's curated memory ONLY when exactly one spec is active (mode=auto). At 0 or
    // 2+ active, suppress — a non-interactive hook cannot pick, and there is no per-chat binding.
    const result = doResolve(beeDir, f);
    if (result.mode !== 'auto' || !result.slug) return 0;
    const memPath = specMemoryPath(beeDir, result.slug);
    if (!fs.existsSync(memPath)) return 0;
    const curated = stripMemoryTemplate(fs.readFileSync(memPath, 'utf8'));
    if (!curated) return 0;
    process.stdout.write(`## Spec Memory (${result.slug})\n\n${curated}\n`);
    return 0;
  }
  if (sub === 'touch') {
    let touchErr = null;
    // FIX 1: ALL STATE.md sync (snapshotToPerSpec/restoreToGlobal) must run INSIDE
    // the same withRegistryLock as the registry read+write.  A touch racing a
    // cross-spec register previously could interleave STATE.md file writes and
    // produce a global STATE.md contaminated with the wrong spec's content.
    reg.withRegistryLock(beeDir, () => {
      const r = reg.readRegistry(beeDir);
      let sp = reg.getSpec(r, f.slug);
      if (!sp) {
        // Self-heal: check whether this is the legacy global spec that was never registered
        const globalState = path.join(beeDir, 'STATE.md');
        if (fs.existsSync(globalState)) {
          const cs = parseStateMd(globalState).currentSpec;
          if (cs && cs.path === f.slug && cs.status && cs.status !== 'NO_SPEC') {
            // Back-register the legacy spec
            const perSpec = specStatePath(beeDir, f.slug);
            if (!fs.existsSync(perSpec)) {
              fs.mkdirSync(path.dirname(perSpec), { recursive: true });
              fs.writeFileSync(perSpec, fs.readFileSync(globalState, 'utf8'));
            }
            const stage = cs.status === 'IN_PROGRESS' ? 'executing' : 'planning';
            reg.upsertSpec(r, { slug: f.slug, title: cs.name || f.slug, stage, location: 'in-place' }, nowIso());
            reg.writeRegistry(beeDir, r);
            initSpecMemory(beeDir, f.slug, { name: cs.name || f.slug });
            sp = reg.getSpec(r, f.slug);
          }
        }
        if (!sp) { touchErr = 'touch: unknown spec ' + f.slug + '\n'; return; }
      }
      if (reg.TERMINAL_STAGES.includes(sp.stage)) { touchErr = 'touch: spec ' + f.slug + ' is ' + sp.stage + ' (completed/archived)\n'; return; }
      // STATE.md sync BEFORE registry mutation: if the sync fails we must NOT bump last_touched.
      const g = currentGlobalSlug(beeDir);
      if (g === f.slug) {
        snapshotToPerSpec(beeDir, f.slug); // same spec in global: capture latest edits into the snapshot
      } else {
        if (g) snapshotToPerSpec(beeDir, g); // a DIFFERENT real spec is in global: save it before switching
        const ok = restoreToGlobal(beeDir, f.slug); // load target's snapshot into global (also the NO_SPEC case)
        if (!ok) { touchErr = 'touch: spec ' + f.slug + ' has no per-spec STATE.md snapshot; cannot switch\n'; return; }
      }
      // Only bump recency and persist AFTER the STATE-sync succeeded.
      reg.touchSpec(r, f.slug, nowIso());
      reg.writeRegistry(beeDir, r);
    });
    if (touchErr) { process.stderr.write(touchErr); return 1; }
    process.stdout.write(`touched ${f.slug}\n`);
    return 0;
  }
  if (sub === 'set-stage') {
    return reg.withRegistryLock(beeDir, () => {
      const r = reg.readRegistry(beeDir);
      if (!reg.getSpec(r, f.slug)) { process.stderr.write('set-stage: unknown spec ' + f.slug + '\n'); return 1; }
      if (!reg.STAGES.includes(f.stage)) { process.stderr.write('set-stage: invalid stage ' + f.stage + '\n'); return 1; }
      reg.setStage(r, f.slug, f.stage);
      reg.writeRegistry(beeDir, r);
      process.stdout.write('set-stage ' + f.slug + ' -> ' + f.stage + '\n');
      return 0;
    });
  }
  if (sub === 'set-location') {
    return reg.withRegistryLock(beeDir, () => {
      const r = reg.readRegistry(beeDir);
      if (!reg.getSpec(r, f.slug)) { process.stderr.write('set-location: unknown spec ' + f.slug + '\n'); return 1; }
      if (!f.location) { process.stderr.write('set-location requires --location\n'); return 1; }
      reg.setLocation(r, f.slug, f.location);
      reg.writeRegistry(beeDir, r);
      process.stdout.write('set-location ' + f.slug + ' -> ' + f.location + '\n');
      return 0;
    });
  }
  if (sub === 'sync-global') {
    // Load a spec's authoritative per-spec STATE.md into the global mirror (preserving the live
    // global's project-global sections). Used by merge-back so global reflects the reconciled spec.
    if (typeof f.slug !== 'string' || !f.slug) { process.stderr.write('sync-global requires --slug\n'); return 1; }
    return reg.withRegistryLock(beeDir, () => {
      const ok = restoreToGlobal(beeDir, f.slug);
      if (!ok) { process.stderr.write('sync-global: spec ' + f.slug + ' has no per-spec STATE.md snapshot\n'); return 1; }
      process.stdout.write('sync-global ' + f.slug + '\n');
      return 0;
    });
  }
  if (sub === 'guard') {
    // Atomic check-and-CLAIM. Inside one registry lock: if a DIFFERENT active spec is executing
    // in-place, report conflict (do NOT claim). Otherwise atomically advance the target to
    // 'executing' (the claim) so a concurrent execute-phase sees it and cannot also proceed.
    // Inside a promoted worktree (marker present) the spec is already isolated — never a conflict.
    return reg.withRegistryLock(beeDir, () => {
      const inWorktree = fs.existsSync(path.join(beeDir, 'worktree-spec'));
      const r = reg.readRegistry(beeDir);
      const target = reg.getSpec(r, f.slug);
      const targetInPlace = !inWorktree && !!target && (!target.location || target.location === 'in-place');
      let other = null;
      if (targetInPlace) {
        other = reg.activeSpecs(r).find(s =>
          s.slug !== f.slug && s.stage === 'executing' && (!s.location || s.location === 'in-place')) || null;
      }
      let claimed = false;
      if (!other && target && !reg.TERMINAL_STAGES.includes(target.stage)
          && reg.STAGES.indexOf(target.stage) < reg.STAGES.indexOf('executing')) {
        reg.setStage(r, f.slug, 'executing');
        reg.writeRegistry(beeDir, r);
        claimed = true;
      }
      process.stdout.write(JSON.stringify({ conflict: !!other, other: other ? other.slug : null, claimed }) + '\n');
      return 0;
    });
  }
  process.stderr.write(`unknown subcommand: ${sub}\n`);
  return 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { main, parseFlags };
