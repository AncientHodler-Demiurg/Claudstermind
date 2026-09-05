// node --test lib/coreBookmarks.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCoreBookmarks, setCoreBookmarks, sanitizeBookmarkMap, CORE_BOOKMARKS_FILE } from "./coreBookmarks.mjs";

test("sanitizeBookmarkMap keeps string→number[] entries, dedupes, drops junk and empties", () => {
  assert.deepEqual(sanitizeBookmarkMap({ "a@main": [3, 1, 3, 2], "b@x": [], "c": "nope", "": [1] }),
    { "a@main": [3, 1, 2] });
  assert.deepEqual(sanitizeBookmarkMap(null), {});
  assert.deepEqual(sanitizeBookmarkMap([1, 2]), {});
});

test("read returns {} on a fresh dir; set persists one workspace and read gets it back", () => {
  const dir = mkdtempSync(join(tmpdir(), "cbm-"));
  try {
    assert.deepEqual(readCoreBookmarks(dir), {});
    const r = setCoreBookmarks(dir, "repo@main", [1712, 99, 1712]);
    assert.equal(r.ok, true);
    assert.deepEqual(readCoreBookmarks(dir), { "repo@main": [1712, 99] });
    // A second workspace coexists; setting one never touches the other.
    setCoreBookmarks(dir, "repo@wt", [5]);
    assert.deepEqual(readCoreBookmarks(dir), { "repo@main": [1712, 99], "repo@wt": [5] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("setting an empty list deletes that workspace's key", () => {
  const dir = mkdtempSync(join(tmpdir(), "cbm-"));
  try {
    setCoreBookmarks(dir, "repo@main", [1, 2]);
    setCoreBookmarks(dir, "repo@main", []);
    assert.deepEqual(readCoreBookmarks(dir), {});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("read is graceful on a corrupt file; set rejects a bad workspaceId", () => {
  const dir = mkdtempSync(join(tmpdir(), "cbm-"));
  try {
    writeFileSync(join(dir, CORE_BOOKMARKS_FILE), "{not json");
    assert.deepEqual(readCoreBookmarks(dir), {});
    assert.equal(setCoreBookmarks(dir, "", [1]).ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("setCoreBookmarks REFUSES to write when the existing store is corrupt — preserves other workspaces", () => {
  // Regression: a corrupt (present-but-unparseable) base used to read as {} → a single-workspace update dropped
  // every OTHER workspace's bookmarks. Now it must refuse and back the corrupt file up, losing nothing.
  const dir = mkdtempSync(join(tmpdir(), "cbm-corrupt-"));
  try {
    writeFileSync(join(dir, CORE_BOOKMARKS_FILE), "{ this is not json", "utf8");
    const r = setCoreBookmarks(dir, "repo@main", [1, 2, 3]);
    assert.equal(r.ok, false);
    assert.equal(r.corrupt, true);
    // the corrupt file was NOT overwritten with a single-key map (other workspaces safe), and a backup exists
    assert.equal(readFileSync(join(dir, CORE_BOOKMARKS_FILE), "utf8"), "{ this is not json");
    assert.ok(existsSync(join(dir, CORE_BOOKMARKS_FILE + ".corrupt.bak")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
})
