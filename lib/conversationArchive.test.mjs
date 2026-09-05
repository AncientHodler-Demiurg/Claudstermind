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
