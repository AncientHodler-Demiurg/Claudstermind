// codeGraphIndex.mjs — Ch.3.5, incremental re-index: git-diff + content hash (crg's pattern, per
// docs/work/exocortex/HANDOFF.md) — a full re-index per edit does not scale.
//
// THE IMPACTED SET (per plan.md 3.5's own test wording): a changed file PLUS its DIRECT
// IMPORTERS — not files the changed file itself imports. If `a.js` changes, anything `a.js`
// imports is unaffected by the edit (their own content didn't change); anything that imports
// `a.js` might now see different exports, so it's in scope too. This is one hop, not transitive —
// "direct importers," matching the acceptance criterion exactly; a transitive closure is a
// different, larger feature this slice does not build.
//
// LAYERING (same split as lib/workspace.mjs vs lib/worktrees.mjs elsewhere in this codebase):
// `computeImpactedSet`/`needsReExtract`/`reindexChanged` are PURE/injected-I/O and tested with
// fixture data, no real git needed. `gitDiffFiles` is the one real-I/O wrapper (a thin
// `git diff --name-only` call), tested separately against a real throwaway git repo.
//
// The index itself is deliberately a plain `{ files: Map<path, {hash, nodes, edges}> }` — no
// class — consistent with every other store in this codebase (knowledgeStore/skillStore are rows
// in a plain object shape too, not instances).
//
// ESM, node:crypto + node:child_process only.

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { FILE_ID } from "./codeGraphExtract.mjs";

/** createIndex() → a fresh, empty index. */
export function createIndex() {
  return { files: new Map() };
}

/** contentHash(source) → sha256 hex of the source text — the "did this file's bytes actually
 *  change" check (a touch with no real diff, or two branches converging on identical content,
 *  both hash-equal and skip re-extraction entirely). */
export function contentHash(source) {
  return crypto.createHash("sha256").update(String(source ?? ""), "utf8").digest("hex");
}

/** needsReExtract(index, path, newHash) → true unless `path` is already indexed with EXACTLY
 *  this hash. Never indexed (hash is null) is always true — there is nothing to compare against. */
export function needsReExtract(index, path, newHash) {
  const existing = index && index.files instanceof Map ? index.files.get(path) : null;
  return !existing || existing.hash !== newHash;
}

/** reverseImporters(index, targetPath) → every indexed file path with a stored `imports` edge
 *  pointing at `targetPath`'s file id. Scans the current index's edges fresh on every call —
 *  deliberately not a maintained reverse-index structure ("start simple," same judgment call this
 *  branch has made for every other threshold/structure that didn't need to be clever yet). */
export function reverseImporters(index, targetPath) {
  const targetId = FILE_ID(targetPath);
  const out = [];
  if (!index || !(index.files instanceof Map)) return out;
  for (const [path, entry] of index.files) {
    if (!entry || !Array.isArray(entry.edges)) continue;
    if (entry.edges.some((e) => e && e.kind === "imports" && e.target === targetId)) out.push(path);
  }
  return out;
}

/**
 * computeImpactedSet(index, changedPaths) → Set<path>
 * `changedPaths` here means ALREADY CONFIRMED CHANGED (post content-hash filtering — see
 * `reindexChanged`, which is what actually applies that filter before calling this). Each changed
 * path, plus every file that directly imports it, per the module header.
 */
export function computeImpactedSet(index, changedPaths) {
  const impacted = new Set(Array.isArray(changedPaths) ? changedPaths : []);
  for (const p of [...impacted]) {
    for (const importer of reverseImporters(index, p)) impacted.add(importer);
  }
  return impacted;
}

/**
 * reindexChanged(index, extractor, changedPaths, readSource) → Promise<{ reExtracted: string[],
 * skipped: string[] }>
 *
 * `readSource(path) -> Promise<string> | string` is injected (no real fs here — testable against
 * a plain in-memory fixture corpus). For every `changedPaths` entry: read it, hash it; if the hash
 * matches what's already indexed, SKIP it entirely (content-hash check) — it does not even count
 * as "changed" for the impacted-set expansion below, since nothing about it actually differs.
 * Everything that survives the hash check, plus its direct importers (`computeImpactedSet`), gets
 * run through `extractor.extractFile` and written into `index.files`. A file OUTSIDE the impacted
 * set is never read, never re-extracted, and its existing `index.files` entry is left as the
 * exact same object — untouched, not just "happens to still be equal."
 */
export async function reindexChanged(index, extractor, changedPaths, readSource) {
  const read = {};   // path -> { source, hash }, so an importer-only file already read once (it was itself in changedPaths) isn't read twice
  const reallyChanged = [];
  const skipped = [];
  for (const p of Array.isArray(changedPaths) ? changedPaths : []) {
    const source = await readSource(p);
    const hash = contentHash(source);
    read[p] = { source, hash };
    if (needsReExtract(index, p, hash)) reallyChanged.push(p);
    else skipped.push(p);
  }

  const impacted = computeImpactedSet(index, reallyChanged);
  const reExtracted = [];
  for (const p of impacted) {
    const cached = read[p];
    const source = cached ? cached.source : await readSource(p);
    const hash = cached ? cached.hash : contentHash(source);
    const batch = extractor.extractFile(p, source);
    index.files.set(p, { hash, nodes: batch.nodes, edges: batch.edges });
    reExtracted.push(p);
  }
  return { reExtracted, skipped };
}

/**
 * gitDiffFiles(cwd, fromRef, toRef) → string[] of repo-relative paths changed between two refs
 * (`git diff --name-only`). The one real-I/O function in this module — everything above takes
 * `changedPaths` as a plain array precisely so it never needs this to be mocked. Returns `[]` on
 * any git failure (not a repo, bad refs, git not installed) rather than throwing — a caller with
 * no git available should degrade to "nothing changed," not crash.
 */
export function gitDiffFiles(cwd, fromRef, toRef) {
  try {
    const out = execFileSync("git", ["diff", "--name-only", String(fromRef), String(toRef)], { cwd, encoding: "utf8" });
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
