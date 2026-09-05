import { test } from "node:test";
import assert from "node:assert/strict";
import {
  windowTail,
  windowAround,
  indexOfPrompt,
  indexOfResponse,
  countOffsets,
  countTurns,
  normalizeTurnKind,
  resolveTurnIndex,
  windowAroundTurn,
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
  assert.deepEqual(r, { transcript: [], start: 0, end: 0, truncatedBefore: false, truncatedAfter: false, total: 0, promptOffset: 0, responseOffset: 0, center: 0, clamped: false });
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

// ---------------------------------------------------------------------------
// aroundTurn — the TURN NUMBER → ROW INDEX resolution the client cannot do itself.
// ---------------------------------------------------------------------------

test("countTurns: prompts/responses over the WHOLE array (rows include tool output)", () => {
  assert.deepEqual(countTurns(T), { promptOffset: 5, responseOffset: 5 });
  assert.deepEqual(countTurns(null), { promptOffset: 0, responseOffset: 0 });
  assert.deepEqual(countTurns([]), { promptOffset: 0, responseOffset: 0 });
});

test("normalizeTurnKind accepts BOTH vocabularies (row roles and recall kinds)", () => {
  assert.equal(normalizeTurnKind("assistant"), "response");
  assert.equal(normalizeTurnKind("response"), "response");
  assert.equal(normalizeTurnKind("user"), "prompt");
  assert.equal(normalizeTurnKind("prompt"), "prompt");
  assert.equal(normalizeTurnKind(undefined), "prompt");
});

test("resolveTurnIndex: an in-range turn resolves EXACTLY, and agrees with indexOf*", () => {
  const p = resolveTurnIndex(T, "user", 4);
  assert.equal(p.index, indexOfPrompt(T, 4));
  assert.equal(p.resolved, 4);
  assert.equal(p.clamped, false);
  assert.equal(p.reason, "exact");
  assert.equal(p.count, 5);

  const r = resolveTurnIndex(T, "response", 2);
  assert.equal(r.index, indexOfResponse(T, 2));
  assert.equal(r.kind, "response");
  assert.equal(r.clamped, false);
});

test("resolveTurnIndex: out of range CLAMPS and SAYS it clamped (never an error)", () => {
  const high = resolveTurnIndex(T, "prompt", 9999);
  assert.equal(high.resolved, 5, "clamped to the last prompt");
  assert.equal(high.index, indexOfPrompt(T, 5));
  assert.equal(high.clamped, true);
  assert.equal(high.reason, "above-range");

  const low = resolveTurnIndex(T, "prompt", 0);
  assert.equal(low.resolved, 1);
  assert.equal(low.clamped, true);
  assert.equal(low.reason, "below-range");

  const junk = resolveTurnIndex(T, "prompt", "not-a-number");
  assert.equal(junk.resolved, 1, "a NaN number degrades to #1 rather than throwing");
  assert.equal(junk.clamped, false, "1 is what was asked for once NaN degraded");
});

test("resolveTurnIndex: no turns of that kind, and an empty transcript", () => {
  const none = resolveTurnIndex([{ role: "user", text: "a" }], "response", 3);
  assert.equal(none.count, 0);
  assert.equal(none.clamped, true);
  assert.equal(none.reason, "no-turns");
  assert.equal(none.index, 0, "lands on the tail rather than inventing a position");

  const empty = resolveTurnIndex([], "prompt", 3);
  assert.equal(empty.reason, "empty");
  assert.equal(empty.clamped, true);
  assert.equal(empty.index, 0);
});

test("windowAroundTurn: same band shape as windowAround, centred on the TURN", () => {
  const byTurn = windowAroundTurn(T, { kind: "prompt", number: 4 }, { before: 2, after: 2 });
  const byIndex = windowAround(T, indexOfPrompt(T, 4), { before: 2, after: 2 });
  assert.deepEqual(byTurn.transcript, byIndex.transcript);
  assert.equal(byTurn.start, byIndex.start);
  assert.equal(byTurn.end, byIndex.end);
  assert.equal(byTurn.promptOffset, byIndex.promptOffset);
  assert.equal(byTurn.responseOffset, byIndex.responseOffset);
  assert.equal(byTurn.clamped, false);
  assert.equal(byTurn.turn.resolved, 4);
});

test("windowAroundTurn: clamped when EITHER the turn number or the centre was out of range", () => {
  const w = windowAroundTurn(T, { kind: "prompt", number: 500 }, { before: 2, after: 2 });
  assert.equal(w.clamped, true);
  assert.equal(w.turn.resolved, 5);
  assert.equal(w.truncatedAfter, false, "the band still runs to the end of the array");
});

test("windowAroundTurn: ONE exact hop on a large transcript, no client-side search", () => {
  // 4000 rows: user, assistant, then 2 tool rows — deliberately UNEVEN so an interpolating
  // client estimator would miss and have to bisect. The server never estimates.
  const big = [];
  for (let i = 0; i < 1000; i++) {
    big.push({ role: "user", text: "p" + (i + 1) });
    big.push({ role: "assistant", text: "r" + (i + 1) });
    if (i % 3 === 0) big.push({ kind: "tool_use", tools: [] }, { kind: "tool_use", tools: [] });
  }
  const w = windowAroundTurn(big, { kind: "prompt", number: 137 }, { before: 250, after: 250 });
  assert.equal(w.clamped, false);
  assert.equal(w.turn.resolved, 137);
  // The centre row IS prompt #137, and its absolute P# is derivable from promptOffset alone.
  assert.equal(big[w.turn.index].text, "p137");
  const posInBand = w.turn.index - w.start;
  assert.equal(w.transcript[posInBand].text, "p137");
  assert.equal(countOffsets(w.transcript, posInBand + 1).promptOffset + w.promptOffset, 137);

  const last = windowAroundTurn(big, { kind: "response", number: 1000 }, { before: 250, after: 250 });
  assert.equal(last.turn.resolved, 1000);
  assert.equal(last.clamped, false);
  assert.equal(last.end, big.length, "the last turn's band runs to the end");
});
