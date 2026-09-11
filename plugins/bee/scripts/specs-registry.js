// specs-registry.js -- read/write and manipulate the .bee/specs.json multi-spec registry.
// Pure manipulation (registry object in -> out) + thin fs IO keyed by beeDir. Node core only.
const fs = require('fs');
const path = require('path');

const STAGES = ['shaping', 'discussing', 'planning', 'executing', 'reviewing', 'shipped', 'archived'];
const TERMINAL_STAGES = ['shipped', 'archived'];

function registryPath(beeDir) { return path.join(beeDir, 'specs.json'); }
function emptyRegistry() { return { specs: [] }; }

function readRegistry(beeDir) {
  const p = registryPath(beeDir);
  if (!fs.existsSync(p)) return emptyRegistry();
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch (e) { return emptyRegistry(); }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.specs)) {
      // structurally invalid -> preserve original, return empty
      try { if (!fs.existsSync(p + '.bak')) fs.writeFileSync(p + '.bak', raw); } catch (_) {}
      return emptyRegistry();
    }
    return parsed;
  } catch (e) {
    // parse error -> preserve original, return empty
    try { if (!fs.existsSync(p + '.bak')) fs.writeFileSync(p + '.bak', raw); } catch (_) {}
    return emptyRegistry();
  }
}

function writeRegistry(beeDir, reg) {
  const p = registryPath(beeDir);
  const tmp = p + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n');
  fs.renameSync(tmp, p);
  return reg;
}

const LOCK_STALE_MS = 10000;  // steal a lock held longer than this (crashed holder)
const LOCK_TIMEOUT_MS = 15000; // waiter deadline — must exceed LOCK_STALE_MS so a waiter can steal before giving up

function withRegistryLock(beeDir, fn) {
  const lock = registryPath(beeDir) + '.lock';
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd = null;
  for (;;) {
    try { fd = fs.openSync(lock, 'wx'); break; }            // O_CREAT|O_EXCL
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // steal a stale lock (held > LOCK_STALE_MS) to avoid permanent deadlock from a crashed writer
      try { const st = fs.statSync(lock); if (Date.now() - st.mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(lock); continue; } } catch (_) {}
      if (Date.now() > deadline) throw new Error('specs.json lock timeout');
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); } catch (_) {} // 20ms sync sleep
    }
  }
  try { return fn(); } finally { try { fs.closeSync(fd); } catch (_) {} try { fs.unlinkSync(lock); } catch (_) {} }
}

function getSpec(reg, slug) { return reg.specs.find(s => s.slug === slug) || null; }

function upsertSpec(reg, { slug, title, stage, location }, ts) {
  const existing = getSpec(reg, slug);
  if (existing) {
    if (title !== undefined) existing.title = title;
    if (stage !== undefined) existing.stage = stage;
    if (location !== undefined) existing.location = location;
    existing.last_touched = ts;
  } else {
    reg.specs.push({
      slug, title: title || slug, stage: stage || 'shaping',
      location: location || 'in-place', created: ts, last_touched: ts,
    });
  }
  return reg;
}

function touchSpec(reg, slug, ts) { const s = getSpec(reg, slug); if (s) s.last_touched = ts; return reg; }
function setStage(reg, slug, stage) { const s = getSpec(reg, slug); if (s) s.stage = stage; return reg; }
function setLocation(registry, slug, location) { const s = getSpec(registry, slug); if (s) s.location = location; return registry; }

function activeSpecs(reg) {
  return reg.specs
    .filter(s => !TERMINAL_STAGES.includes(s.stage))
    .sort((a, b) => String(b.last_touched || '').localeCompare(String(a.last_touched || '')));
}

module.exports = {
  STAGES, TERMINAL_STAGES, registryPath, emptyRegistry,
  readRegistry, writeRegistry, withRegistryLock, getSpec, upsertSpec, touchSpec, setStage, setLocation, activeSpecs,
};
