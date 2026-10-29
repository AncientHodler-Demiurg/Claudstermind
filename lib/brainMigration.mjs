// brainMigration.mjs — Ch.1.4: move the distillation feature's output (`brain/`) from its old,
// wrong-zone location (inside the repo — 1.2a's audit finding, 1.3a's structural diagnosis) to
// its correct one (`resolve(MASTER_ROOT, "brain")`, the same anchor `transcriptDir`/`secretsDir`
// already use, per dashboard/server.mjs's `BRAIN_DIR`, fixed in this same slice).
//
// COPY-ONLY. NEVER DELETES THE OLD LOCATION. This is deliberate, not an oversight: the old
// location is INSIDE THE GIT REPO — deleting those files from disk would be a step toward
// untracking/removing them from git, which is exactly the still-open decision in
// docs/work/exocortex/plan.md 1.2b (three escalating remediation tiers, explicitly left to the
// repo owner). This module only ever ADDS files at the new location; it never touches the old
// one. Whatever happens to the old `brain/` afterward is 1.2b's call, made separately, by a human.
//
// Same spirit as conversationArchive.mjs's migrateLegacyRootSegments: idempotent, non-destructive,
// never guesses past a genuine conflict — a destination file that already exists with DIFFERENT
// content is left exactly as it is and reported, not overwritten either direction.
//
// ESM, node builtins only. Every function guards against bad input and never throws.

import fs from "node:fs";
import path from "node:path";

// Every regular file under `dir`, recursively, as paths RELATIVE to `dir` (posix-style separators
// so the result is stable across platforms). Never throws; a missing/unreadable dir yields [].
function walkFiles(dir) {
  const out = [];
  function walk(rel) {
    const abs = path.join(dir, rel);
    let entries = [];
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const relChild = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(relChild);
      else if (ent.isFile()) out.push(relChild);
    }
  }
  walk("");
  return out;
}

// Byte-for-byte comparison — these are small text files (a few KB each), so reading both fully is
// cheap and exact; no reason to reach for a hash for content this size.
function filesIdentical(a, b) {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

/**
 * planBrainMigration(oldDir, newDir) → { oldExists, copied, alreadyPresent, conflicts }
 *
 * READ-ONLY — never writes anything. Enumerates every file under `oldDir` and classifies it:
 *   - `copied`         — doesn't exist at `newDir` yet; migrateBrain would copy it.
 *   - `alreadyPresent` — exists at `newDir` with IDENTICAL content; nothing to do.
 *   - `conflicts`      — exists at `newDir` with DIFFERENT content; migrateBrain will refuse to
 *                        touch either side. A human has to look at these directly.
 * This is what a `--dry-run` mode is: call this, print the result, write nothing.
 */
export function planBrainMigration(oldDir, newDir) {
  const oldExists = !!oldDir && fs.existsSync(oldDir);
  if (!oldExists) return { oldExists: false, copied: [], alreadyPresent: [], conflicts: [] };

  const copied = [];
  const alreadyPresent = [];
  const conflicts = [];
  for (const rel of walkFiles(oldDir)) {
    const src = path.join(oldDir, rel);
    const dst = path.join(String(newDir), rel);
    if (!fs.existsSync(dst)) {
      copied.push(rel);
    } else if (filesIdentical(src, dst)) {
      alreadyPresent.push(rel);
    } else {
      conflicts.push(rel);
    }
  }
  return { oldExists, copied, alreadyPresent, conflicts };
}

/**
 * migrateBrain(oldDir, newDir, { execute = false }) → the same shape as planBrainMigration,
 * PLUS `applied: boolean` (true iff `execute` was true AND at least one file needed copying).
 *
 * `execute: false` (the default) is a pure dry run — identical to calling planBrainMigration
 * directly, provided for a single call site that can toggle the one flag. `execute: true` actually
 * creates destination directories and copies every file in `copied` from old to new. NEVER
 * deletes anything at `oldDir` — see the module header for why. NEVER overwrites a `conflicts`
 * entry in either direction. Idempotent: a second call (dry-run or executed) against the same
 * two directories finds nothing left in `copied` (everything from the first run is now
 * `alreadyPresent`), so it's a clean no-op — mirrors `migrateLegacyRootSegments`'s own idempotency
 * test shape (`assert.deepEqual(again, { moved: 0, ... })`).
 */
export function migrateBrain(oldDir, newDir, opts = {}) {
  const execute = !!(opts && opts.execute);
  const plan = planBrainMigration(oldDir, newDir);
  if (!execute || !plan.oldExists || !plan.copied.length) {
    return { ...plan, applied: false };
  }
  let anyCopied = false;
  for (const rel of plan.copied) {
    const src = path.join(oldDir, rel);
    const dst = path.join(String(newDir), rel);
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      anyCopied = true;
    } catch {
      // Best-effort per file — one failure must not abort the rest, and must not silently claim
      // success either: it stays in `copied` (the caller can tell what plan.copied said would
      // happen vs. what's actually readable at `newDir` afterward — re-running the plan is the
      // way to confirm, exactly like re-running a dry run after a real one).
    }
  }
  return { ...plan, applied: anyCopied };
}
