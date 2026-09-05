import { test } from "node:test";
import assert from "node:assert/strict";
import {
  windowTail,
  windowAround,
  indexOfPrompt,
  indexOfResponse,
  countOffsets,
} from "./conversationWindow.mjs";

// Synthetic transcript: alternating user/assistant with two "system" rows interleaved
// so we can verify offsets count ONLY user/assistant. 12 rows total.
//  idx: 0 u1 | 1 a1 | 2 sys | 3 u2 | 4 a2 | 5 u3 | 6 a3 | 7 sys | 8 u4 | 9 a4 | 10 u5 | 11 a5
const T = [
  { role: "user", t: "u1" },
  { role: "assistant", t: "a1" },
  { role: "system", t: "s1" },
  { role: "user", t: "u2" },
  { role: "assistant", t: "a2" },
  { role: "user", t: "u3" },
  { role: "assistant", t: "a3" },
  { role: "system", t: "s2" },
  { role: "user", t: "u4" },
  { role: "assistant", t: "a4" },
  { role: "user", t: "u5" },
  { role: "assistant", t: "a5" },
];

test("windowTail: short array (limit >= length) returns all, no truncation", () => {
  const r = windowTail(T, 100);
  assert.equal(r.transcript.length, 12);
  assert.equal(r.start, 0);
  assert.equal(r.truncatedBefore, false);
  assert.equal(r.total, 12);
  assert.equal(r.promptOffset, 0);
  assert.equal(r.responseOffset, 0);
});

test("windowTail: long array (limit < length) truncates with correct offsets", () => {
  const r = windowTail(T, 4); // last 4 rows: idx 8..11
  assert.equal(r.start, 8);
  assert.equal(r.truncatedBefore, true);
  assert.equal(r.total, 12);
  assert.deepEqual(r.transcript.map((x) => x.t), ["u4", "a4", "u5", "a5"]);
  // before idx 8: u1,u2,u3 = 3 prompts; a1,a2,a3 = 3 responses (2 system ignored)
  assert.equal(r.promptOffset, 3);
  assert.equal(r.responseOffset, 3);
});

test("windowTail: missing/omitted limit returns all", () => {
  const r = windowTail(T);
  assert.equal(r.transcript.length, 12);
  assert.equal(r.truncatedBefore, false);
});

test("windowTail: non-array / empty → sane empty", () => {
  for (const bad of [null, undefined, {}, [], 5]) {
    const r = windowTail(bad, 3);
    assert.deepEqual(r, { transcript: [], start: 0, truncatedBefore: false, total: 0, promptOffset: 0, responseOffset: 0 });
  }
});

test("windowAround: middle band clamps and sets both truncated flags", () => {
  const r = windowAround(T, 6, { before: 2, after: 2 }); // idx 4..8
  assert.equal(r.start, 4);
  assert.equal(r.end, 9);
  assert.equal(r.truncatedBefore, true);
  assert.equal(r.truncatedAfter, true);
  assert.equal(r.total, 12);
  assert.deepEqual(r.transcript.map((x) => x.t), ["a2", "u3", "a3", "s2", "u4"]);
  // before idx 4: u1,u2 = 2 prompts; a1 = 1 response
  assert.equal(r.promptOffset, 2);
  assert.equal(r.responseOffset, 1);
});

test("windowAround: at start clamps before, no truncatedBefore", () => {
  const r = windowAround(T, 0, { before: 5, after: 2 }); // idx 0..2
  assert.equal(r.start, 0);
  assert.equal(r.end, 3);
  assert.equal(r.truncatedBefore, false);
  assert.equal(r.truncatedAfter, true);
  assert.equal(r.promptOffset, 0);
  assert.equal(r.responseOffset, 0);
});

test("windowAround: at end clamps after, no truncatedAfter", () => {
  const r = windowAround(T, 11, { before: 2, after: 5 }); // idx 9..11
  assert.equal(r.start, 9);
  assert.equal(r.end, 12);
  assert.equal(r.truncatedBefore, true);
  assert.equal(r.truncatedAfter, false);
  // before idx 9: u1,u2,u3,u4 = 4 prompts; a1,a2,a3 = 3 responses
  assert.equal(r.promptOffset, 4);
  assert.equal(r.responseOffset, 3);
});

test("windowAround: center out of range is clamped to bounds", () => {
  const r = windowAround(T, 999, { before: 1, after: 1 }); // clamps center to 11 → idx 10..11
  assert.equal(r.start, 10);
  assert.equal(r.end, 12);
  assert.equal(r.truncatedAfter, false);
});

test("windowAround: default band (60/60) covers small array fully", () => {
  const r = windowAround(T, 5);
  assert.equal(r.start, 0);
  assert.equal(r.end, 12);
  assert.equal(r.truncatedBefore, false);
  assert.equal(r.truncatedAfter, false);
});

test("windowAround: non-array / empty → sane empty", () => {
  const r = windowAround(null, 3);
  assert.deepEqual(r, { transcript: [], start: 0, end: 0, truncatedBefore: false, truncatedAfter: false, total: 0, promptOffset: 0, responseOffset: 0 });
});

test("indexOfPrompt: maps 1-based prompt number to array index", () => {
  assert.equal(indexOfPrompt(T, 1), 0);  // u1
  assert.equal(indexOfPrompt(T, 2), 3);  // u2 (skips a1 + system)
  assert.equal(indexOfPrompt(T, 4), 8);  // u4
  assert.equal(indexOfPrompt(T, 5), 10); // u5
});

test("indexOfResponse: maps 1-based response number to array index", () => {
  assert.equal(indexOfResponse(T, 1), 1);  // a1
  assert.equal(indexOfResponse(T, 3), 6);  // a3
  assert.equal(indexOfResponse(T, 5), 11); // a5
});

test("indexOfPrompt/Response: missing or invalid → -1", () => {
  assert.equal(indexOfPrompt(T, 6), -1);   // only 5 prompts
  assert.equal(indexOfResponse(T, 6), -1); // only 5 responses
  assert.equal(indexOfPrompt(T, 0), -1);
  assert.equal(indexOfPrompt(T, -1), -1);
  assert.equal(indexOfResponse(null, 1), -1);
  assert.equal(indexOfPrompt([], 1), -1);
});

test("indexOf round-trips through windowAround for jump-to-#N", () => {
  const idx = indexOfPrompt(T, 4); // 8
  const r = windowAround(T, idx, { before: 1, after: 1 }); // idx 7..9
  assert.deepEqual(r.transcript.map((x) => x.t), ["s2", "u4", "a4"]);
  // absolute P# of first shown user row = promptOffset + 1
  assert.equal(r.promptOffset, 3); // u1,u2,u3 before idx 7
});

test("countOffsets: counts only user/assistant, clamps start", () => {
  assert.deepEqual(countOffsets(T, 8), { promptOffset: 3, responseOffset: 3 });
  assert.deepEqual(countOffsets(T, 0), { promptOffset: 0, responseOffset: 0 });
  assert.deepEqual(countOffsets(T, 999), { promptOffset: 5, responseOffset: 5 });
  assert.deepEqual(countOffsets(null, 5), { promptOffset: 0, responseOffset: 0 });
});
