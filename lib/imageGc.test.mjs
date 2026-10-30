// Tests for lib/imageGc.mjs — Wave 0.1 (4.13): reference-counted image GC. computeImageGc is
// pure (no filesystem); sweepImages is the real disk-touching driver, exercised against tmp dirs
// with archiveSegment/saveImage-shaped data so it's testing the ACTUAL on-disk contract, not a
// simplified stand-in for it.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { computeImageGc, sweepImages } from "./imageGc.mjs";
import { archiveSegment } from "./conversationArchive.mjs";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "imagegc-"));
}

const img = (hash) => ({ path: `images/${hash}.png`, hash, mediaType: "image/png" });
const row = (text, hashes = []) => ({ role: "user", text, images: hashes.map(img) });

// ---------------------------------------------------------------------------
// computeImageGc — pure
// ---------------------------------------------------------------------------

test("computeImageGc: a hash with no reference anywhere is dead", () => {
  const { dead, live } = computeImageGc({
    liveRows: [row("no images here")],
    archivedRows: [],
    existingHashes: ["aaaa1111aaaa1111aaaa1111"],
  });
  assert.deepEqual(dead, ["aaaa1111aaaa1111aaaa1111"]);
  assert.equal(live.size, 0);
});

test("computeImageGc: a hash referenced by a LIVE row survives", () => {
  const { dead, live } = computeImageGc({
    liveRows: [row("here's a screenshot", ["bbbb2222bbbb2222bbbb2222"])],
    archivedRows: [],
    existingHashes: ["bbbb2222bbbb2222bbbb2222"],
  });
  assert.deepEqual(dead, []);
  assert.ok(live.has("bbbb2222bbbb2222bbbb2222"));
});

test("computeImageGc: a hash referenced ONLY by an ARCHIVED row survives", () => {
  const { dead, live } = computeImageGc({
    liveRows: [row("unrelated live turn")],
    archivedRows: [row("an old screenshot", ["cccc3333cccc3333cccc3333"])],
    existingHashes: ["cccc3333cccc3333cccc3333"],
  });
  assert.deepEqual(dead, []);
  assert.ok(live.has("cccc3333cccc3333cccc3333"));
});

test("computeImageGc: a hash referenced by ONE of two live sessions survives", () => {
  const sessionA = [row("session A message with a pic", ["dddd4444dddd4444dddd4444"])];
  const sessionB = [row("session B has nothing")];
  const { dead } = computeImageGc({
    liveRows: [...sessionA, ...sessionB],
    archivedRows: [],
    existingHashes: ["dddd4444dddd4444dddd4444"],
  });
  assert.deepEqual(dead, []);
});

test("computeImageGc handles a mix: some dead, some live, some archived-only", () => {
  const { dead, live } = computeImageGc({
    liveRows: [row("live one", ["live-hash-aaaaaaaaaaaaaa"])],
    archivedRows: [row("archived one", ["archived-hash-bbbbbbbbbb"])],
    existingHashes: ["live-hash-aaaaaaaaaaaaaa", "archived-hash-bbbbbbbbbb", "orphan-hash-cccccccccccc"],
  });
  assert.deepEqual(dead, ["orphan-hash-cccccccccccc"]);
  assert.equal(live.size, 2);
});

test("computeImageGc never throws on malformed/missing input", () => {
  assert.deepEqual(computeImageGc({}), { dead: [], live: new Set() });
  assert.deepEqual(computeImageGc(), { dead: [], live: new Set() });
  assert.deepEqual(computeImageGc(null), { dead: [], live: new Set() });
  assert.deepEqual(
    computeImageGc({ liveRows: [null, undefined, 42, { images: "not an array" }], existingHashes: [] }),
    { dead: [], live: new Set() },
  );
  // existingHashes entries that aren't strings are ignored, not thrown on.
  assert.deepEqual(computeImageGc({ existingHashes: [null, 42, ""] }), { dead: [], live: new Set() });
});

// ---------------------------------------------------------------------------
// sweepImages — the real disk-touching driver, against the actual on-disk shapes
// ---------------------------------------------------------------------------

function writeImage(wsDir, hash, bytes = "fake-png-bytes") {
  const dir = path.join(wsDir, "images");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${hash}.png`), bytes);
}

function writeSession(wsDir, sessionFile, rows) {
  fs.mkdirSync(wsDir, { recursive: true });
  fs.writeFileSync(path.join(wsDir, sessionFile), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

test("sweepImages: an image referenced only by a since-deleted session is swept", () => {
  const wsDir = tmp();
  const hash = "deadbeefdeadbeefdeadbeef";
  writeImage(wsDir, hash);
  writeSession(wsDir, "session-a.jsonl", [row("has a pic", [hash])]);
  // Simulate "session A was deleted" — its file is simply gone before the sweep runs.
  fs.rmSync(path.join(wsDir, "session-a.jsonl"));

  const result = sweepImages(wsDir);
  assert.deepEqual(result.deleted, [hash]);
  assert.equal(result.kept, 0);
  assert.equal(fs.existsSync(path.join(wsDir, "images", `${hash}.png`)), false);
  fs.rmSync(wsDir, { recursive: true, force: true });
});

test("sweepImages: an image still referenced by an ARCHIVED segment survives", () => {
  const wsDir = tmp();
  const hash = "aaaaaaaaaaaaaaaaaaaaaaaa";
  writeImage(wsDir, hash);
  // No live session references it at all — only the archive does.
  archiveSegment(wsDir, {
    conversationId: "c1", n: 0, summary: "",
    rows: [row("archived screenshot", [hash])],
  });

  const result = sweepImages(wsDir);
  assert.deepEqual(result.deleted, []);
  assert.equal(result.kept, 1);
  assert.equal(fs.existsSync(path.join(wsDir, "images", `${hash}.png`)), true);
  fs.rmSync(wsDir, { recursive: true, force: true });
});

test("sweepImages: an image referenced by TWO live sessions sharing the same workspace dir survives deleting one of them", () => {
  const wsDir = tmp();
  const hash = "bbbbbbbbbbbbbbbbbbbbbbbb";
  writeImage(wsDir, hash);
  writeSession(wsDir, "core.jsonl", [row("core pane mentions the pic", [hash])]);
  writeSession(wsDir, "pact-tab-1.jsonl", [row("pact tab ALSO references it", [hash])]);

  // Delete ONE of the two sessions (exactly what workspaceStore.deleteSession does) — the image
  // must survive because the other session (sharing this same images/ dir) still references it.
  fs.rmSync(path.join(wsDir, "core.jsonl"));

  const result = sweepImages(wsDir);
  assert.deepEqual(result.deleted, []);
  assert.equal(result.kept, 1);
  assert.equal(fs.existsSync(path.join(wsDir, "images", `${hash}.png`)), true);
  fs.rmSync(wsDir, { recursive: true, force: true });
});

test("sweepImages handles a mix of dead/live/archived in one real pass", () => {
  const wsDir = tmp();
  // "1".repeat(23) + "a" is 24 hex-shaped chars, exactly what IMAGE_FILE_RE requires — asserted
  // explicitly since a miscounted literal here previously made every hash silently fail to match
  // the filename regex and passed the wrong (empty) `dead` list without ever touching a real file.
  const liveHash = "1".repeat(23) + "a";
  const archivedHash = "2".repeat(23) + "b";
  const deadHash = "3".repeat(23) + "c";
  assert.equal(liveHash.length, 24);
  writeImage(wsDir, liveHash);
  writeImage(wsDir, archivedHash);
  writeImage(wsDir, deadHash);
  writeSession(wsDir, "s.jsonl", [row("live", [liveHash])]);
  archiveSegment(wsDir, { conversationId: "c", n: 0, summary: "", rows: [row("archived", [archivedHash])] });

  const result = sweepImages(wsDir);
  assert.deepEqual(result.deleted, [deadHash]);
  assert.equal(result.kept, 2);
  assert.equal(fs.existsSync(path.join(wsDir, "images", `${liveHash}.png`)), true);
  assert.equal(fs.existsSync(path.join(wsDir, "images", `${archivedHash}.png`)), true);
  assert.equal(fs.existsSync(path.join(wsDir, "images", `${deadHash}.png`)), false);
  fs.rmSync(wsDir, { recursive: true, force: true });
});

test("sweepImages is a no-op (not an error) when there's no images/ dir at all", () => {
  const wsDir = tmp();
  writeSession(wsDir, "s.jsonl", [row("no attachments ever")]);
  assert.deepEqual(sweepImages(wsDir), { deleted: [], kept: 0 });
  fs.rmSync(wsDir, { recursive: true, force: true });
});

test("sweepImages never throws on missing/bad input", () => {
  assert.equal(sweepImages(null).deleted.length, 0);
  assert.equal(sweepImages(undefined).deleted.length, 0);
  assert.equal(sweepImages(path.join(os.tmpdir(), "does-not-exist-at-all")).deleted.length, 0);
});

test("sweepImages ignores non-image junk files in images/ (never mistakes them for a hash)", () => {
  const wsDir = tmp();
  fs.mkdirSync(path.join(wsDir, "images"), { recursive: true });
  fs.writeFileSync(path.join(wsDir, "images", ".DS_Store"), "junk");
  fs.writeFileSync(path.join(wsDir, "images", "not-a-valid-hash.png"), "junk");
  const result = sweepImages(wsDir);
  assert.deepEqual(result, { deleted: [], kept: 0 });
  assert.ok(fs.existsSync(path.join(wsDir, "images", ".DS_Store")), "junk files are left alone, not swept");
  fs.rmSync(wsDir, { recursive: true, force: true });
});
