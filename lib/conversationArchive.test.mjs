// Tests for lib/conversationArchive.mjs — archive rolled-off head segments to disk,
// then recall them by absolute P#/R# number or by substring query.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  archiveSegment,
  readIndex,
  recallByNumber,
  recallByQuery,
  migrateLegacyRootSegments,
} from "./conversationArchive.mjs";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "convarchive-"));
}

// Two consecutive head segments of the same conversation. seg0 holds P1..P3 / R1..R3,
// seg1 continues at P4.. / R4.. (offsets chained from seg0's counts).
function seg0Rows() {
  return [
    { role: "user", text: "hello there, first prompt" },
    { role: "assistant", text: "first response about apples" },
    { role: "user", text: "second prompt mentions bananas" },
    { role: "assistant", text: "second response" },
    { role: "user", text: "third prompt" },
    { role: "assistant", text: "third response cherry" },
  ];
}
function seg1Rows() {
  return [
    { role: "user", text: "fourth prompt asks about the deploy pipeline" },
    { role: "assistant", text: "fourth response" },
    { role: "user", text: "fifth prompt" },
    { role: "assistant", text: "fifth response" },
  ];
}

test("archive two chained segments → index has correct P#/R# ranges", () => {
  const base = tmp();
  const e0 = archiveSegment(base, {
    conversationId: "conv-1", n: 0, rows: seg0Rows(), summary: "s0",
    promptOffset: 0, responseOffset: 0, at: "2026-09-05T00:00:00Z",
  });
  // seg0 had 3 prompts + 3 responses → next offsets are 3 / 3.
  const e1 = archiveSegment(base, {
    conversationId: "conv-1", n: 1, rows: seg1Rows(), summary: "s1",
    promptOffset: 3, responseOffset: 3,
  });

  assert.equal(e0.promptStart, 1);
  assert.equal(e0.promptEnd, 3);
  assert.equal(e0.responseStart, 1);
  assert.equal(e0.responseEnd, 3);
  assert.equal(e0.rows, 6);
  assert.equal(e0.at, "2026-09-05T00:00:00Z");

  assert.equal(e1.promptStart, 4);
  assert.equal(e1.promptEnd, 5);
  assert.equal(e1.responseStart, 4);
  assert.equal(e1.responseEnd, 5);
  assert.equal(Object.prototype.hasOwnProperty.call(e1, "at"), false); // omitted when absent

  const idx = readIndex(base);
  assert.equal(idx.length, 2);
  assert.equal(idx[0].segmentRef, "conv-1#seg0");
  assert.equal(idx[1].segmentRef, "conv-1#seg1");
  // JSONL file actually written.
  assert.ok(fs.existsSync(idx[0].path));
});

test("recallByNumber finds a prompt AND a response in an OLD segment by absolute number", () => {
  const base = tmp();
  archiveSegment(base, { conversationId: "conv-1", n: 0, rows: seg0Rows(), summary: "s0", promptOffset: 0, responseOffset: 0 });
  archiveSegment(base, { conversationId: "conv-1", n: 1, rows: seg1Rows(), summary: "s1", promptOffset: 3, responseOffset: 3 });

  // P2 lives in the OLD seg0.
  const p2 = recallByNumber(base, { conversationId: "conv-1", kind: "prompt", number: 2 });
  assert.ok(p2);
  assert.equal(p2.segmentRef, "conv-1#seg0");
  assert.equal(p2.kind, "prompt");
  assert.equal(p2.number, 2);
  assert.equal(p2.text, "second prompt mentions bananas");
  assert.equal(p2.row.role, "user");

  // R3 also in seg0.
  const r3 = recallByNumber(base, { conversationId: "conv-1", kind: "response", number: 3 });
  assert.ok(r3);
  assert.equal(r3.segmentRef, "conv-1#seg0");
  assert.equal(r3.text, "third response cherry");

  // P4 crosses into seg1.
  const p4 = recallByNumber(base, { conversationId: "conv-1", kind: "prompt", number: 4 });
  assert.ok(p4);
  assert.equal(p4.segmentRef, "conv-1#seg1");
  assert.equal(p4.text, "fourth prompt asks about the deploy pipeline");
});

test("recallByQuery finds a substring → snippet + correct absolute number, newest-first", () => {
  const base = tmp();
  archiveSegment(base, { conversationId: "conv-1", n: 0, rows: seg0Rows(), summary: "s0", promptOffset: 0, responseOffset: 0 });
  archiveSegment(base, { conversationId: "conv-1", n: 1, rows: seg1Rows(), summary: "s1", promptOffset: 3, responseOffset: 3 });

  const hits = recallByQuery(base, { conversationId: "conv-1", query: "BANANAS" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, "prompt");
  assert.equal(hits[0].number, 2);
  assert.equal(hits[0].segmentRef, "conv-1#seg0");
  assert.ok(hits[0].snippet.toLowerCase().includes("bananas"));

  // "prompt" appears in both segments; newest segment (n=1) must come first, and limit caps.
  const many = recallByQuery(base, { conversationId: "conv-1", query: "prompt", limit: 2 });
  assert.equal(many.length, 2);
  assert.equal(many[0].segmentRef, "conv-1#seg1");
});

test("recallByQuery snippet stays ~160 chars around the hit", () => {
  const base = tmp();
  const long = "A".repeat(500) + " NEEDLE " + "B".repeat(500);
  archiveSegment(base, {
    conversationId: "c", n: 0,
    rows: [{ role: "user", text: long }],
    summary: "", promptOffset: 0, responseOffset: 0,
  });
  const hits = recallByQuery(base, { conversationId: "c", query: "needle" });
  assert.equal(hits.length, 1);
  assert.ok(hits[0].snippet.toLowerCase().includes("needle"));
  // Snippet is bounded (~160 chars + ellipsis markers), NOT the full 1000+ char text.
  assert.ok(hits[0].snippet.length <= 170, `snippet len ${hits[0].snippet.length}`);
});

test("re-archiving a segmentRef overwrites its entry, does not duplicate", () => {
  const base = tmp();
  archiveSegment(base, { conversationId: "conv-1", n: 0, rows: seg0Rows(), summary: "first", promptOffset: 0, responseOffset: 0 });
  assert.equal(readIndex(base).length, 1);

  // Same segmentRef (conv-1#seg0), different summary + rows.
  const shorter = [{ role: "user", text: "only one prompt now" }, { role: "assistant", text: "only one response" }];
  const e = archiveSegment(base, { conversationId: "conv-1", n: 0, rows: shorter, summary: "second", promptOffset: 0, responseOffset: 0 });

  const idx = readIndex(base);
  assert.equal(idx.length, 1); // no duplicate
  assert.equal(idx[0].summary, "second");
  assert.equal(idx[0].rows, 2);
  assert.equal(e.promptEnd, 1);
});

test("missing / absent / bad input → null / []", () => {
  const base = tmp();
  // Empty archive.
  assert.deepEqual(readIndex(base), []);
  assert.deepEqual(readIndex(path.join(base, "nope")), []);
  assert.equal(recallByNumber(base, { conversationId: "x", kind: "prompt", number: 1 }), null);
  assert.deepEqual(recallByQuery(base, { conversationId: "x", query: "foo" }), []);

  archiveSegment(base, { conversationId: "conv-1", n: 0, rows: seg0Rows(), summary: "s0", promptOffset: 0, responseOffset: 0 });
  // Out-of-range number.
  assert.equal(recallByNumber(base, { conversationId: "conv-1", kind: "prompt", number: 99 }), null);
  // Wrong conversation.
  assert.equal(recallByNumber(base, { conversationId: "other", kind: "prompt", number: 1 }), null);
  // Bad kind / empty query / bad number.
  assert.equal(recallByNumber(base, { conversationId: "conv-1", kind: "bogus", number: 1 }), null);
  assert.equal(recallByNumber(base, { conversationId: "conv-1", kind: "prompt", number: 0 }), null);
  assert.deepEqual(recallByQuery(base, { conversationId: "conv-1", query: "" }), []);
  // Totally bad input never throws.
  assert.equal(archiveSegment(null, {}), null);
  assert.equal(recallByNumber(undefined, undefined), null);
  assert.deepEqual(recallByQuery(undefined, undefined), []);
});

// ---------------------------------------------------------------------------
// Image resolution + the legacy-root-archive backfill (T2.1).
//
// An archived row's image reference is `{ path: "images/<hash>.<ext>", hash, mediaType }` and that
// `path` is relative to the WORKSPACE'S OWN dir (lib/workspaceStore.saveImage) — so the archive is
// only self-sufficient if it also records WHICH workspace. Without that, a recalled turn's image is
// unresolvable: the client has a path but nothing to hang it off.
// ---------------------------------------------------------------------------

const imgRow = (text, hash) => ({
  role: "user", text,
  images: [{ path: `images/${hash}.png`, hash, mediaType: "image/png" }],
});

test("archiveSegment records workspaceId + image count; recall carries both back out", () => {
  const base = tmp();
  const entry = archiveSegment(base, {
    conversationId: "conv-img", workspaceId: "Repo@main", n: 0, summary: "s",
    rows: [imgRow("here is a screenshot of the bug", "aa11"), { role: "assistant", text: "seen" }],
  });
  assert.equal(entry.workspaceId, "Repo@main");
  assert.equal(entry.images, 1);
  assert.equal(entry.file, "conv-img_seg0.jsonl");

  const hit = recallByNumber(base, { conversationId: "conv-img", kind: "prompt", number: 1 });
  assert.equal(hit.workspaceId, "Repo@main", "a recalled turn must say which workspace its images live under");
  assert.deepEqual(hit.images, [{ path: "images/aa11.png", hash: "aa11", mediaType: "image/png" }]);

  const found = recallByQuery(base, { conversationId: "conv-img", query: "screenshot" });
  assert.equal(found[0].workspaceId, "Repo@main");
  assert.equal(found[0].images, 1);
  fs.rmSync(base, { recursive: true, force: true });
});

test("archiveSegment recovers workspaceId from the rows' own stamp when the caller omits it", () => {
  const base = tmp();
  const entry = archiveSegment(base, {
    conversationId: "conv-x", n: 0, summary: "",
    rows: [{ role: "user", text: "no stamp here" }, { role: "assistant", text: "reply", workspaceId: "Other@main" }],
  });
  assert.equal(entry.workspaceId, "Other@main");
  fs.rmSync(base, { recursive: true, force: true });
});

test("a segment still resolves after its dir is MOVED (index `path` gone stale)", () => {
  const from = tmp();
  archiveSegment(from, { conversationId: "c", workspaceId: "W@main", n: 0, summary: "", rows: seg0Rows() });
  const to = tmp();
  fs.cpSync(path.join(from, "_segments"), path.join(to, "_segments"), { recursive: true });
  fs.rmSync(from, { recursive: true, force: true });   // every recorded absolute `path` is now dead
  const hit = recallByNumber(to, { conversationId: "c", kind: "response", number: 2 });
  assert.ok(hit, "the entry's `file` must locate the JSONL relative to the index's own dir");
  assert.match(hit.text, /second response/);
  fs.rmSync(to, { recursive: true, force: true });
});

test("migrateLegacyRootSegments moves a root archive into its owning workspace dir, idempotently", () => {
  const root = tmp();
  // Simulate the legacy layout: the archive written straight to the transcript ROOT, rows stamped
  // with their real workspaceId (exactly what a live install has on disk today).
  const rows = [
    { role: "user", text: "old prompt one", workspaceId: "Repo@main" },
    { role: "assistant", text: "old response one", workspaceId: "Repo@main" },
    imgRow("old prompt two with an image", "bb22"),
  ];
  archiveSegment(root, { conversationId: "Repo@main", n: 1, rows, summary: "legacy" });
  assert.ok(fs.existsSync(path.join(root, "_segments", "Repo_main_seg1.jsonl")));

  const dirFor = (wid) => path.join(root, wid.replace(/[^A-Za-z0-9@._-]/g, "_"));
  const r = migrateLegacyRootSegments(root, dirFor);
  assert.equal(r.moved, 1);
  assert.equal(r.skipped, 0);

  // The root archive is gone (no more bogus "_segments" conversation) …
  assert.equal(fs.existsSync(path.join(root, "_segments")), false);
  // … and the segment is recallable from the workspace's own dir, WITH its workspace id.
  const base = dirFor("Repo@main");
  const hit = recallByNumber(base, { conversationId: "Repo@main", kind: "prompt", number: 2 });
  assert.equal(hit.text, "old prompt two with an image");
  assert.equal(hit.workspaceId, "Repo@main");
  assert.equal(hit.images[0].path, "images/bb22.png");

  // Idempotent: a second run finds nothing to do and changes nothing.
  const again = migrateLegacyRootSegments(root, dirFor);
  assert.deepEqual(again, { moved: 0, entries: 0, skipped: 0 });
  assert.ok(recallByNumber(base, { conversationId: "Repo@main", kind: "prompt", number: 2 }));
  fs.rmSync(root, { recursive: true, force: true });
});

test("migrateLegacyRootSegments LEAVES an entry it cannot attribute (never guesses, never deletes)", () => {
  const root = tmp();
  archiveSegment(root, { conversationId: "anon", n: 0, rows: [{ role: "user", text: "no workspace anywhere" }], summary: "" });
  const r = migrateLegacyRootSegments(root, () => path.join(root, "dest"));
  assert.equal(r.moved, 0);
  assert.equal(r.skipped, 1);
  assert.ok(fs.existsSync(path.join(root, "_segments", "anon_seg0.jsonl")), "an unattributable segment stays put");
  assert.equal(readIndex(root).length, 1, "and keeps its index entry");
  fs.rmSync(root, { recursive: true, force: true });
});
