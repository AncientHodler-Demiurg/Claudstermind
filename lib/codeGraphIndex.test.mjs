// Tests for lib/codeGraphIndex.mjs — Ch.3.5's incremental re-index: content-hash skip + the
// one-hop "changed file + its direct importers" impacted set.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  createIndex, contentHash, needsReExtract, reverseImporters, computeImpactedSet,
  reindexChanged, gitDiffFiles,
} from "./codeGraphIndex.mjs";
import { createExtractor, FILE_ID } from "./codeGraphExtract.mjs";

test("contentHash: deterministic, and distinguishes different content", () => {
  assert.equal(contentHash("same"), contentHash("same"));
  assert.notEqual(contentHash("a"), contentHash("b"));
  assert.equal(contentHash(""), contentHash(""));
});

test("needsReExtract: true when never indexed, true on a hash mismatch, false on an exact match", () => {
  const idx = createIndex();
  assert.equal(needsReExtract(idx, "a.js", "h1"), true, "never indexed");
  idx.files.set("a.js", { hash: "h1", nodes: [], edges: [] });
  assert.equal(needsReExtract(idx, "a.js", "h1"), false, "exact hash match");
  assert.equal(needsReExtract(idx, "a.js", "h2"), true, "hash differs — a real change");
});

test("reverseImporters: finds every file with a DIRECT imports edge to the target, and only those", () => {
  const idx = createIndex();
  idx.files.set("b.js", { hash: "h", nodes: [], edges: [{ source: FILE_ID("b.js"), target: FILE_ID("a.js"), kind: "imports", confidence: "EXTRACTED" }] });
  idx.files.set("c.js", { hash: "h", nodes: [], edges: [{ source: FILE_ID("c.js"), target: FILE_ID("b.js"), kind: "imports", confidence: "EXTRACTED" }] });
  idx.files.set("d.js", { hash: "h", nodes: [], edges: [] });
  assert.deepEqual(new Set(reverseImporters(idx, "a.js")), new Set(["b.js"]), "only b directly imports a — c imports b, not a");
  assert.deepEqual(new Set(reverseImporters(idx, "b.js")), new Set(["c.js"]));
  assert.deepEqual(reverseImporters(idx, "nonexistent.js"), []);
  assert.deepEqual(reverseImporters(null, "a.js"), []);
});

test("computeImpactedSet: one hop only — a changed file's importer's OWN importer is NOT included (no transitive closure)", () => {
  const idx = createIndex();
  idx.files.set("b.js", { hash: "h", nodes: [], edges: [{ source: FILE_ID("b.js"), target: FILE_ID("a.js"), kind: "imports", confidence: "EXTRACTED" }] });
  idx.files.set("c.js", { hash: "h", nodes: [], edges: [{ source: FILE_ID("c.js"), target: FILE_ID("b.js"), kind: "imports", confidence: "EXTRACTED" }] });
  const impacted = computeImpactedSet(idx, ["a.js"]);
  assert.deepEqual(impacted, new Set(["a.js", "b.js"]), "c.js imports b.js, not a.js directly — must NOT be pulled in");
});

test("computeImpactedSet: a file with no importers impacts only itself", () => {
  const idx = createIndex();
  idx.files.set("lonely.js", { hash: "h", nodes: [], edges: [] });
  assert.deepEqual(computeImpactedSet(idx, ["lonely.js"]), new Set(["lonely.js"]));
});

// ---------------------------------------------------------------------------
// reindexChanged — the real end-to-end test, using the REAL tree-sitter extractor
// ---------------------------------------------------------------------------

function corpus() {
  return {
    "a.mjs": "export function helperA() { return 1; }\n",
    "b.mjs": 'import { helperA } from "./a.mjs";\nexport function useA() { return helperA(); }\n',
    "c.mjs": 'import { useA } from "./b.mjs";\nexport function useB() { return useA(); }\n',
    "d.mjs": "export function unrelated() { return 0; }\n",
  };
}

let extractor;
test.before(async () => { extractor = await createExtractor(); });

async function buildFullIndex(files) {
  const idx = createIndex();
  await reindexChanged(idx, extractor, Object.keys(files), (p) => files[p]);
  return idx;
}

test("reindexChanged: a single-file edit re-extracts that file and its DIRECT importers only — everything else is untouched", async () => {
  const files = corpus();
  const idx = await buildFullIndex(files);
  const cEntryBefore = idx.files.get("c.mjs");
  const dEntryBefore = idx.files.get("d.mjs");

  // Edit a.mjs — a real content change (new function added).
  files["a.mjs"] = "export function helperA() { return 2; }\nexport function helperA2() { return 3; }\n";
  const result = await reindexChanged(idx, extractor, ["a.mjs"], (p) => files[p]);

  assert.deepEqual(new Set(result.reExtracted), new Set(["a.mjs", "b.mjs"]), "a.mjs changed, b.mjs directly imports it — c.mjs (transitive) and d.mjs (unrelated) must NOT be re-extracted");
  assert.deepEqual(result.skipped, []);

  // c.mjs and d.mjs are the EXACT SAME object — never touched, not just equal.
  assert.equal(idx.files.get("c.mjs"), cEntryBefore, "identity-equal — c.mjs's entry object was never replaced");
  assert.equal(idx.files.get("d.mjs"), dEntryBefore, "identity-equal — d.mjs's entry object was never replaced");

  // a.mjs's own re-extraction reflects the NEW content.
  const aEntry = idx.files.get("a.mjs");
  assert.ok(aEntry.nodes.some((n) => n.id === "function:a.mjs#helperA2"), "the newly added function must appear");
  assert.equal(aEntry.hash, contentHash(files["a.mjs"]));
});

test("reindexChanged: content-hash check skips a 'changed' path whose bytes are byte-identical to what's indexed — and it does NOT expand to importers", async () => {
  const files = corpus();
  const idx = await buildFullIndex(files);
  const bEntryBefore = idx.files.get("b.mjs"); // would be a's importer IF this counted as a real change

  // "Changed" per git, but the content is IDENTICAL (e.g. a touch, or two branches converging).
  const result = await reindexChanged(idx, extractor, ["a.mjs"], (p) => files[p]);

  assert.deepEqual(result.reExtracted, []);
  assert.deepEqual(result.skipped, ["a.mjs"]);
  assert.equal(idx.files.get("b.mjs"), bEntryBefore, "no real change -> no impacted-set expansion at all");
});

test("reindexChanged: a brand-new file (never indexed) is always re-extracted, never skipped", async () => {
  const files = corpus();
  const idx = await buildFullIndex(files);
  files["e.mjs"] = "export function brandNew() { return 42; }\n";
  const result = await reindexChanged(idx, extractor, ["e.mjs"], (p) => files[p]);
  assert.deepEqual(result.reExtracted, ["e.mjs"]);
  assert.ok(idx.files.get("e.mjs").nodes.some((n) => n.id === "function:e.mjs#brandNew"));
});

test("reindexChanged: multiple simultaneously changed files union their impacted sets correctly", async () => {
  const files = corpus();
  const idx = await buildFullIndex(files);
  files["a.mjs"] = "export function helperA() { return 99; }\n";       // importer: b.mjs
  files["d.mjs"] = "export function unrelated() { return 99; }\n";     // importer: none
  const result = await reindexChanged(idx, extractor, ["a.mjs", "d.mjs"], (p) => files[p]);
  assert.deepEqual(new Set(result.reExtracted), new Set(["a.mjs", "b.mjs", "d.mjs"]));
});

// ---------------------------------------------------------------------------
// gitDiffFiles — the one real-git wrapper
// ---------------------------------------------------------------------------

function realGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-git-"));
  const g = (...a) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  if (spawnSync("git", ["--version"]).status !== 0) return null; // git-less CI — caller skips
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  return { dir, g };
}

test("gitDiffFiles: reports exactly the files that changed between two real commits", () => {
  const repo = realGitRepo();
  if (!repo) return; // git-less CI
  const { dir, g } = repo;
  fs.writeFileSync(path.join(dir, "a.mjs"), "1\n");
  fs.writeFileSync(path.join(dir, "b.mjs"), "1\n");
  g("add", "-A"); g("commit", "-qm", "c1");
  const c1 = g("rev-parse", "HEAD").stdout.trim();
  fs.writeFileSync(path.join(dir, "a.mjs"), "2\n"); // b.mjs untouched
  g("add", "-A"); g("commit", "-qm", "c2");
  const c2 = g("rev-parse", "HEAD").stdout.trim();
  assert.deepEqual(gitDiffFiles(dir, c1, c2), ["a.mjs"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("gitDiffFiles: never throws — a non-repo or bad refs degrades to an empty array", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-notgit-"));
  assert.deepEqual(gitDiffFiles(scratch, "HEAD~1", "HEAD"), []);
  assert.deepEqual(gitDiffFiles("/definitely/does/not/exist", "a", "b"), []);
  fs.rmSync(scratch, { recursive: true, force: true });
});
