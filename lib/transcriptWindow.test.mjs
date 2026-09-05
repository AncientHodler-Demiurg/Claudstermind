import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_BAND, EXTEND_OVERLAP, MAX_JUMP_ATTEMPTS,
  rowRole, countRoles, normalizeBand, bandTurnRange, turnAt, indexOfTurn, containsTurn,
  mergeBands, emptyView, applyBand, bandSpanOf, viewAffordances, estimateIndexOfTurn,
  planJump, planExtend, viewAnchors, turnBracket, MAX_ANCHORS,
} from './transcriptWindow.mjs';

// The SERVER's own slicer. Every payload in this suite is produced by the real
// lib/conversationWindow.mjs rather than hand-written, so if the two modules ever drift apart
// on what start/end/promptOffset mean, these tests fail rather than the user's scrollbar.
import { windowAround, windowTail, countOffsets } from './conversationWindow.mjs';

// ── fixtures ────────────────────────────────────────────────────────────────────────────────

// Deterministic PRNG (mulberry32) so the property-style tests are reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A synthetic conversation: user → (0..k tool rows) → assistant, repeated. Tool rows are
 *  CLUSTERED (heavier in the middle) so a naive uniform-density estimator is actually
 *  challenged rather than flattered. */
function makeConversation(turns, seed = 7) {
  const rand = rng(seed);
  const rows = [];
  for (let t = 0; t < turns; t++) {
    rows.push({ role: 'user', text: `prompt ${t + 1}` });
    const middle = 1 - Math.abs(t / turns - 0.5) * 2; // 0 at the ends, 1 in the middle
    const tools = Math.floor(rand() * 4 * middle);
    for (let j = 0; j < tools; j++) rows.push({ role: 'tool_result', text: `tool ${t}.${j}` });
    rows.push({ role: 'assistant', text: `response ${t + 1}` });
  }
  return rows;
}

/** A stand-in for the server: takes the control `args` from CONTRACT §4 and produces the
 *  transcript-frame payload, using the real windowing functions. */
function serve(all, args = {}) {
  if (args.full) {
    return {
      transcript: all.slice(), transcriptTotal: all.length, transcriptTruncated: false,
      promptOffset: 0, responseOffset: 0,
    };
  }
  if (typeof args.around === 'number') {
    const w = windowAround(all, args.around, { before: DEFAULT_BAND.before, after: DEFAULT_BAND.after });
    return {
      transcript: w.transcript, transcriptTotal: w.total,
      transcriptTruncated: w.truncatedBefore || w.truncatedAfter,
      promptOffset: w.promptOffset, responseOffset: w.responseOffset,
      windowStart: w.start, windowEnd: w.end,
    };
  }
  const w = windowTail(all, typeof args.limit === 'number' ? args.limit : 250);
  return {
    transcript: w.transcript, transcriptTotal: w.total, transcriptTruncated: w.truncatedBefore,
    promptOffset: w.promptOffset, responseOffset: w.responseOffset,
  };
}

/** Absolute P#/R# of every turn row in a full conversation — the ground truth every
 *  index-vs-absolute assertion is checked against. */
function groundTruth(all) {
  const byIndex = new Map();
  const byTurn = new Map();
  let p = 0, r = 0;
  all.forEach((row, i) => {
    if (row.role === 'user') { p++; byIndex.set(i, { kind: 'prompt', number: p }); byTurn.set(`prompt:${p}`, i); }
    else if (row.role === 'assistant') { r++; byIndex.set(i, { kind: 'response', number: r }); byTurn.set(`response:${r}`, i); }
  });
  return { byIndex, byTurn, prompts: p, responses: r };
}

const BIG = makeConversation(600);           // ~1900 rows, 600 prompts, 600 responses
const BIG_TRUTH = groundTruth(BIG);
const SMALL = makeConversation(5, 3);        // shorter than one window

// ── rowRole / countRoles ────────────────────────────────────────────────────────────────────

test('rowRole: role wins, kind is the fallback, anything else is not a turn', () => {
  assert.equal(rowRole({ role: 'user' }), 'user');
  assert.equal(rowRole({ role: 'assistant' }), 'assistant');
  assert.equal(rowRole({ kind: 'user' }), 'user');
  // role is what the SERVER counted, so it must win when both are present.
  assert.equal(rowRole({ role: 'assistant', kind: 'user' }), 'assistant');
  assert.equal(rowRole({ role: 'tool_result' }), null);
  assert.equal(rowRole(null), null);
  assert.equal(rowRole('user'), null);
});

test('countRoles matches the server countOffsets over the same prefix', () => {
  for (const upto of [0, 1, 17, 250, BIG.length, BIG.length + 99]) {
    const mine = countRoles(BIG, upto);
    const theirs = countOffsets(BIG, upto);
    assert.equal(mine.prompts, theirs.promptOffset, `prompts @${upto}`);
    assert.equal(mine.responses, theirs.responseOffset, `responses @${upto}`);
  }
  assert.deepEqual(countRoles(null, 5), { prompts: 0, responses: 0 });
  assert.deepEqual(countRoles(BIG, -10), { prompts: 0, responses: 0 });
});

// ── normalizeBand ───────────────────────────────────────────────────────────────────────────

test('normalizeBand: an `around` payload keeps absolute bounds and offsets', () => {
  const payload = serve(BIG, { around: 800 });
  const band = normalizeBand(payload);
  assert.equal(band.isBand, true);
  assert.equal(band.start, payload.windowStart);
  assert.equal(band.end, payload.windowStart + payload.transcript.length);
  assert.equal(band.end, payload.windowEnd, 'windowEnd is exclusive in the observed server');
  assert.equal(band.windowEndStyle, 'exclusive');
  assert.equal(band.total, BIG.length);
  assert.equal(band.promptOffset, countOffsets(BIG, band.start).promptOffset);
  assert.equal(band.responseOffset, countOffsets(BIG, band.start).responseOffset);
  assert.equal(band.truncatedBefore, true);
  assert.equal(band.truncatedAfter, true);
  assert.equal(band.truncated, true);
  assert.deepEqual(band.rows, BIG.slice(band.start, band.end));
});

test('normalizeBand: a TAIL payload has no window fields — start is derived from the total', () => {
  const payload = serve(BIG, { limit: 250 });
  assert.equal(payload.windowStart, undefined);
  const band = normalizeBand(payload);
  assert.equal(band.isBand, false);
  assert.equal(band.start, BIG.length - 250);
  assert.equal(band.end, BIG.length);
  assert.equal(band.truncatedBefore, true);
  assert.equal(band.truncatedAfter, false);
  assert.equal(band.promptOffset, countOffsets(BIG, BIG.length - 250).promptOffset);
  assert.deepEqual(band.rows, BIG.slice(BIG.length - 250));
});

test('normalizeBand: a FULL payload is the whole conversation, nothing truncated', () => {
  const band = normalizeBand(serve(BIG, { full: true }));
  assert.equal(band.start, 0);
  assert.equal(band.end, BIG.length);
  assert.equal(band.truncated, false);
  assert.equal(band.truncatedBefore, false);
  assert.equal(band.truncatedAfter, false);
});

test('normalizeBand: transcriptTruncated true/false are both honoured', () => {
  const truncated = normalizeBand({ transcript: [{ role: 'user' }], transcriptTotal: 10, transcriptTruncated: true, windowStart: 4, windowEnd: 5 });
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.truncatedBefore, true);
  assert.equal(truncated.truncatedAfter, true);
  const whole = normalizeBand({ transcript: [{ role: 'user' }], transcriptTotal: 1, transcriptTruncated: false });
  assert.equal(whole.truncated, false);
  // A server that says "truncated" while shipping a complete range is still believed about
  // there being more — the OR keeps the affordance honest.
  const odd = normalizeBand({ transcript: [{ role: 'user' }], transcriptTotal: 1, transcriptTruncated: true });
  assert.equal(odd.truncated, true);
});

test('normalizeBand: tolerates an INCLUSIVE windowEnd without shifting a single row', () => {
  const p = serve(BIG, { around: 800 });
  const inclusive = { ...p, windowEnd: p.windowEnd - 1 };
  const a = normalizeBand(p);
  const b = normalizeBand(inclusive);
  assert.equal(b.start, a.start);
  assert.equal(b.end, a.end, 'end comes from rows.length, never from windowEnd');
  assert.equal(b.windowEndStyle, 'inclusive');
  assert.equal(a.windowEndStyle, 'exclusive');
  const nonsense = normalizeBand({ ...p, windowEnd: 3 });
  assert.equal(nonsense.windowEndStyle, 'inconsistent');
  assert.equal(nonsense.end, a.end);
});

test('normalizeBand: junk in, sane empty shape out', () => {
  assert.equal(normalizeBand(null), null);
  assert.equal(normalizeBand({}), null);
  assert.equal(normalizeBand({ transcript: 'nope' }), null);
  const empty = normalizeBand({ transcript: [], transcriptTotal: 0 });
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.start, 0);
  assert.equal(empty.end, 0);
  assert.equal(empty.total, 0);
});

// ── the index-vs-absolute guard ─────────────────────────────────────────────────────────────

test('turnAt takes an ABSOLUTE row index and returns an ABSOLUTE turn number', () => {
  const band = normalizeBand(serve(BIG, { around: 900 }));
  for (let i = band.start; i < band.end; i++) {
    const expected = BIG_TRUTH.byIndex.get(i) || null;
    assert.deepEqual(turnAt(band, i), expected, `row ${i}`);
  }
  // Local index 0 is NOT absolute index 0.
  assert.equal(turnAt(band, 0), null, 'index 0 is outside a band that starts at ' + band.start);
  assert.equal(turnAt(band, band.end), null);
  assert.equal(turnAt(band, -1), null);
});

test('indexOfTurn: a turn OUTSIDE the band is -1, never a local index', () => {
  const band = normalizeBand(serve(BIG, { around: 900 }));
  const range = bandTurnRange(band);
  // The classic bug: asking for P#1 and getting back band.start because the loop counted from 0.
  assert.equal(indexOfTurn(band, 'prompt', 1), -1);
  assert.equal(indexOfTurn(band, 'response', 1), -1);
  assert.equal(indexOfTurn(band, 'prompt', range.promptEnd + 1), -1);
  assert.equal(indexOfTurn(band, 'prompt', 0), -1);
  assert.equal(indexOfTurn(band, 'prompt', -3), -1);
  assert.equal(indexOfTurn(band, 'prompt', 'four'), -1);
  assert.equal(indexOfTurn(null, 'prompt', 4), -1);
});

test('indexOfTurn ↔ turnAt round-trip against ground truth, over every turn in a band', () => {
  const band = normalizeBand(serve(BIG, { around: 900 }));
  const range = bandTurnRange(band);
  for (let n = range.promptStart; n <= range.promptEnd; n++) {
    const idx = indexOfTurn(band, 'prompt', n);
    assert.equal(idx, BIG_TRUTH.byTurn.get(`prompt:${n}`), `P#${n}`);
    assert.deepEqual(turnAt(band, idx), { kind: 'prompt', number: n });
    assert.equal(containsTurn(band, 'prompt', n), true);
  }
  for (let n = range.responseStart; n <= range.responseEnd; n++) {
    const idx = indexOfTurn(band, 'response', n);
    assert.equal(idx, BIG_TRUTH.byTurn.get(`response:${n}`), `R#${n}`);
    assert.deepEqual(turnAt(band, idx), { kind: 'response', number: n });
  }
});

test('bandTurnRange names its bounds like a conversationArchive index entry', () => {
  const band = normalizeBand(serve(BIG, { around: 900 }));
  const range = bandTurnRange(band);
  assert.equal(range.promptStart, band.promptOffset + 1);
  assert.equal(range.promptEnd, band.promptOffset + range.prompts);
  assert.equal(range.responseStart, band.responseOffset + 1);
  assert.equal(range.responseEnd, band.responseOffset + range.responses);
  // A band with no turn rows at all reports zeros, not NaN or 1.
  const barren = bandTurnRange({ rows: [{ role: 'tool_result' }], promptOffset: 9, responseOffset: 9 });
  assert.deepEqual(barren, { promptStart: 0, promptEnd: 0, responseStart: 0, responseEnd: 0, prompts: 0, responses: 0 });
  assert.deepEqual(bandTurnRange(null).prompts, 0);
});

// ── mergeBands ──────────────────────────────────────────────────────────────────────────────

test('mergeBands: two OVERLAPPING windows merge without duplicating a single turn', () => {
  const a = normalizeBand(serve(BIG, { around: 600 }));
  const b = normalizeBand(serve(BIG, { around: 900 }));
  assert.ok(b.start < a.end, 'fixture must actually overlap');
  const m = mergeBands(a, b);
  assert.equal(m.ok, true);
  assert.equal(m.reason, 'merged');
  assert.equal(m.band.start, a.start);
  assert.equal(m.band.end, b.end);
  assert.equal(m.band.rows.length, b.end - a.start);
  assert.deepEqual(m.band.rows, BIG.slice(a.start, b.end));
  assert.equal(m.band.promptOffset, countOffsets(BIG, a.start).promptOffset);
  assert.equal(m.band.responseOffset, countOffsets(BIG, a.start).responseOffset);
  // Every turn number in the merged band still resolves to its true row index.
  const range = bandTurnRange(m.band);
  for (let n = range.promptStart; n <= range.promptEnd; n++) {
    assert.equal(indexOfTurn(m.band, 'prompt', n), BIG_TRUTH.byTurn.get(`prompt:${n}`), `P#${n}`);
  }
});

test('mergeBands: order does not matter (b before a merges identically)', () => {
  const a = normalizeBand(serve(BIG, { around: 600 }));
  const b = normalizeBand(serve(BIG, { around: 900 }));
  const forward = mergeBands(a, b).band;
  const backward = mergeBands(b, a).band;
  assert.equal(backward.start, forward.start);
  assert.equal(backward.end, forward.end);
  assert.deepEqual(backward.rows, forward.rows);
});

test('mergeBands: TOUCHING bands merge; a GAP is refused', () => {
  const all = BIG;
  const left = { rows: all.slice(100, 200), start: 100, end: 200, total: all.length, ...countOffsetsAs(all, 100) };
  const touching = { rows: all.slice(200, 300), start: 200, end: 300, total: all.length, ...countOffsetsAs(all, 200) };
  const gapped = { rows: all.slice(210, 300), start: 210, end: 300, total: all.length, ...countOffsetsAs(all, 210) };
  const ok = mergeBands(left, touching);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.band.rows, all.slice(100, 300));
  const bad = mergeBands(left, gapped);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'gap');
  assert.equal(bad.band, null);
  assert.equal(bad.conflict, false);
});

test('mergeBands: a band wholly CONTAINED in another keeps the outer bounds and the newer rows', () => {
  const outer = { rows: BIG.slice(100, 400), start: 100, end: 400, total: BIG.length, ...countOffsetsAs(BIG, 100) };
  const inner = { rows: BIG.slice(200, 250).map((r) => ({ ...r, fresh: true })), start: 200, end: 250, total: BIG.length, ...countOffsetsAs(BIG, 200) };
  const m = mergeBands(outer, inner);
  assert.equal(m.ok, true);
  assert.equal(m.band.start, 100);
  assert.equal(m.band.end, 400);
  assert.equal(m.band.rows.length, 300);
  assert.equal(m.band.rows[100].fresh, true, 'the overlap takes the NEWER copy');
  assert.equal(m.band.rows[149].fresh, true);
  assert.equal(m.band.rows[150].fresh, undefined, 'and the tail after it is the older band');
  assert.equal(m.band.rows[99].fresh, undefined);
});

test('mergeBands: OFFSET CONFLICT is refused rather than silently corrupting every P#', () => {
  const a = normalizeBand(serve(BIG, { around: 600 }));
  const liar = normalizeBand(serve(BIG, { around: 900 }));
  liar.promptOffset += 3; // as if the two bands came from different segment numbering
  const m = mergeBands(a, liar);
  assert.equal(m.ok, false);
  assert.equal(m.conflict, true);
  assert.equal(m.reason, 'offset-conflict');
  assert.equal(m.band, null);
});

test('mergeBands: empty / missing inputs degrade instead of throwing', () => {
  const a = normalizeBand(serve(BIG, { around: 600 }));
  assert.deepEqual(mergeBands(null, null), { ok: false, band: null, reason: 'empty', conflict: false });
  assert.equal(mergeBands(null, a).band, a);
  assert.equal(mergeBands(a, null).band, a);
  assert.equal(mergeBands({ rows: [], start: 0, end: 0 }, a).band, a);
  assert.equal(mergeBands(a, { rows: [], start: 0, end: 0 }).band, a);
});

function countOffsetsAs(all, start) {
  const o = countOffsets(all, start);
  return { promptOffset: o.promptOffset, responseOffset: o.responseOffset };
}

test('PROPERTY: merging any two overlapping/touching bands equals the plain slice of the source', () => {
  const rand = rng(1234);
  for (let trial = 0; trial < 300; trial++) {
    const aStart = Math.floor(rand() * (BIG.length - 20));
    const aLen = 1 + Math.floor(rand() * 400);
    const aEnd = Math.min(BIG.length, aStart + aLen);
    // Pick b so it touches or overlaps a (never a gap).
    const bStart = Math.max(0, Math.min(BIG.length - 1, aStart + Math.floor(rand() * (aEnd - aStart + 1))));
    const bLen = 1 + Math.floor(rand() * 400);
    const bEnd = Math.min(BIG.length, bStart + bLen);
    const a = { rows: BIG.slice(aStart, aEnd), start: aStart, end: aEnd, total: BIG.length, ...countOffsetsAs(BIG, aStart) };
    const b = { rows: BIG.slice(bStart, bEnd), start: bStart, end: bEnd, total: BIG.length, ...countOffsetsAs(BIG, bStart) };
    const m = mergeBands(a, b);
    assert.equal(m.ok, true, `trial ${trial}: a=[${aStart},${aEnd}) b=[${bStart},${bEnd})`);
    const lo = Math.min(aStart, bStart);
    const hi = Math.max(aEnd, bEnd);
    assert.equal(m.band.start, lo);
    assert.equal(m.band.end, hi);
    assert.equal(m.band.rows.length, hi - lo, 'no duplicated and no dropped rows');
    assert.deepEqual(m.band.rows, BIG.slice(lo, hi));
    assert.equal(m.band.promptOffset, countOffsets(BIG, lo).promptOffset);
    assert.equal(m.band.responseOffset, countOffsets(BIG, lo).responseOffset);
    // And the absolute numbering survives: spot-check the first and last prompt.
    const range = bandTurnRange(m.band);
    if (range.prompts > 0) {
      assert.equal(indexOfTurn(m.band, 'prompt', range.promptStart), BIG_TRUTH.byTurn.get(`prompt:${range.promptStart}`));
      assert.equal(indexOfTurn(m.band, 'prompt', range.promptEnd), BIG_TRUTH.byTurn.get(`prompt:${range.promptEnd}`));
    }
  }
});

test('PROPERTY: bands separated by a real gap are ALWAYS refused', () => {
  const rand = rng(99);
  for (let trial = 0; trial < 100; trial++) {
    const aStart = Math.floor(rand() * 800);
    const aEnd = aStart + 1 + Math.floor(rand() * 200);
    const bStart = aEnd + 1 + Math.floor(rand() * 100);
    if (bStart >= BIG.length) continue;
    const a = { rows: BIG.slice(aStart, aEnd), start: aStart, end: aEnd, total: BIG.length, ...countOffsetsAs(BIG, aStart) };
    const b = { rows: BIG.slice(bStart, bStart + 50), start: bStart, end: bStart + 50, total: BIG.length, ...countOffsetsAs(BIG, bStart) };
    assert.equal(mergeBands(a, b).ok, false);
    assert.equal(mergeBands(b, a).ok, false);
  }
});

// ── applyBand: extend vs jump ───────────────────────────────────────────────────────────────

test('applyBand: EXTEND merges and keeps the generation; JUMP replaces and bumps it', () => {
  let view = emptyView();
  const first = applyBand(view, normalizeBand(serve(BIG, { around: 900 })), { center: 900 });
  assert.equal(first.action, 'replaced');
  assert.equal(first.view.generation, 1);
  view = first.view;

  const extended = applyBand(view, normalizeBand(serve(BIG, { around: 700 })), { mode: 'extend', center: 700 });
  assert.equal(extended.action, 'extended');
  assert.equal(extended.view.generation, 1, 'extending must NOT invalidate mounted rows');
  assert.ok(extended.view.rows.length > view.rows.length);
  assert.deepEqual(extended.view.rows, BIG.slice(extended.view.start, extended.view.end));

  const jumped = applyBand(extended.view, normalizeBand(serve(BIG, { around: 50 })), { mode: 'replace', center: 50 });
  assert.equal(jumped.action, 'replaced');
  assert.equal(jumped.view.generation, 2);
  assert.equal(jumped.view.start, 0);
  assert.deepEqual(jumped.view.rows, BIG.slice(0, jumped.view.end));
});

test('applyBand: AUTO extends when mergeable and replaces across a gap', () => {
  const view = applyBand(emptyView(), normalizeBand(serve(BIG, { around: 900 })), { center: 900 }).view;
  const near = applyBand(view, normalizeBand(serve(BIG, { around: 1000 })), { center: 1000 });
  assert.equal(near.action, 'extended');
  const far = applyBand(view, normalizeBand(serve(BIG, { around: 10 })), { center: 10 });
  assert.equal(far.action, 'replaced');
  assert.equal(far.reason, 'gap');
  assert.equal(far.conflict, false);
  assert.equal(far.view.generation, view.generation + 1);
});

test('applyBand: an offset conflict replaces and REPORTS itself', () => {
  const view = applyBand(emptyView(), normalizeBand(serve(BIG, { around: 600 })), { center: 600 }).view;
  const liar = normalizeBand(serve(BIG, { around: 700 }));
  liar.responseOffset += 5;
  const out = applyBand(view, liar, { mode: 'extend' });
  assert.equal(out.action, 'replaced');
  assert.equal(out.conflict, true);
  assert.equal(out.reason, 'offset-conflict');
  assert.equal(out.view.start, liar.start, 'the fresher band wins outright');
});

test('applyBand: the band span is LEARNED from an unclamped reply, never from a clamped one', () => {
  const fresh = emptyView();
  assert.deepEqual(bandSpanOf(fresh), { before: DEFAULT_BAND.before, after: DEFAULT_BAND.after, learned: false });

  const clamped = applyBand(fresh, normalizeBand(serve(BIG, { around: 5 })), { center: 5 }).view;
  assert.equal(bandSpanOf(clamped).learned, false, 'a band clamped at row 0 is narrower than the real span');

  const middle = applyBand(fresh, normalizeBand(serve(BIG, { around: 900 })), { center: 900 }).view;
  const span = bandSpanOf(middle);
  assert.deepEqual(span, { before: DEFAULT_BAND.before, after: DEFAULT_BAND.after, learned: true });

  // A server with a different cap is learned rather than assumed.
  const narrow = windowAround(BIG, 900, { before: 30, after: 30 });
  const learned = applyBand(fresh, normalizeBand({
    transcript: narrow.transcript, transcriptTotal: narrow.total, transcriptTruncated: true,
    promptOffset: narrow.promptOffset, responseOffset: narrow.responseOffset,
    windowStart: narrow.start, windowEnd: narrow.end,
  }), { center: 900 }).view;
  assert.deepEqual(bandSpanOf(learned), { before: 30, after: 30, learned: true });
});

test('applyBand: a missing band is ignored, not applied', () => {
  const view = applyBand(emptyView(), normalizeBand(serve(BIG, { around: 900 })), { center: 900 }).view;
  const out = applyBand(view, null);
  assert.equal(out.action, 'ignored');
  assert.equal(out.view, view);
});

// ── affordances ─────────────────────────────────────────────────────────────────────────────

test('viewAffordances: honest counts above, and NO invented count below', () => {
  const view = applyBand(emptyView(), normalizeBand(serve(BIG, { around: 900 })), { center: 900 }).view;
  const aff = viewAffordances(view);
  assert.equal(aff.hasAbove, true);
  assert.equal(aff.hasBelow, true);
  assert.equal(aff.atStart, false);
  assert.equal(aff.atEnd, false);
  assert.equal(aff.rowsAbove, view.start);
  assert.equal(aff.rowsBelow, BIG.length - view.end);
  // turnsAbove is EXACT — the server counted it.
  const truth = countOffsets(BIG, view.start);
  assert.equal(aff.turnsAbove, truth.promptOffset + truth.responseOffset);
  assert.equal(aff.promptsAbove, truth.promptOffset);
  assert.equal(aff.responsesAbove, truth.responseOffset);
  // turnsBelow is UNKNOWABLE from row counts, so it is null, not a guess.
  assert.equal(aff.turnsBelow, null);
  assert.equal(aff.totalRows, BIG.length);
  assert.equal(aff.loadedRows, view.rows.length);
  assert.ok(aff.coverage > 0 && aff.coverage < 1);
  const range = bandTurnRange(view);
  assert.equal(aff.firstPrompt, range.promptStart);
  assert.equal(aff.lastPrompt, range.promptEnd);
});

test('viewAffordances: at the very start / very end / whole conversation', () => {
  const atStart = applyBand(emptyView(), normalizeBand(serve(BIG, { around: 0 })), { center: 0 }).view;
  const a = viewAffordances(atStart);
  assert.equal(a.atStart, true);
  assert.equal(a.hasAbove, false);
  assert.equal(a.turnsAbove, 0);
  assert.equal(a.hasBelow, true);
  assert.equal(a.turnsBelow, null);

  const atEnd = applyBand(emptyView(), normalizeBand(serve(BIG, { around: BIG.length - 1 })), { center: BIG.length - 1 }).view;
  const b = viewAffordances(atEnd);
  assert.equal(b.atEnd, true);
  assert.equal(b.hasBelow, false);
  assert.equal(b.turnsBelow, 0, 'at the end, zero below is a fact, not a guess');

  const whole = applyBand(emptyView(), normalizeBand(serve(SMALL, { full: true })), {}).view;
  const c = viewAffordances(whole);
  assert.equal(c.atStart, true);
  assert.equal(c.atEnd, true);
  assert.equal(c.coverage, 1);
  assert.equal(c.turnsBelow, 0);

  const none = viewAffordances(emptyView());
  assert.equal(none.loadedRows, 0);
  assert.equal(none.coverage, 0);
  assert.equal(none.atEnd, true);
});

// ── estimation + jump ───────────────────────────────────────────────────────────────────────

test('estimateIndexOfTurn: exact inside the window, bounded guesses outside it', () => {
  const view = applyBand(emptyView(), normalizeBand(serve(BIG, { around: 900 })), { center: 900 }).view;
  const range = bandTurnRange(view);

  const inside = estimateIndexOfTurn(view, 'prompt', range.promptStart + 5);
  assert.equal(inside.exact, true);
  assert.equal(inside.confidence, 'exact');
  assert.equal(inside.index, BIG_TRUTH.byTurn.get(`prompt:${range.promptStart + 5}`));

  // Above the window: bracketed by the origin anchor and the band's own start anchor.
  const above = estimateIndexOfTurn(view, 'prompt', 3);
  assert.equal(above.exact, false);
  assert.equal(above.confidence, 'interpolated');
  assert.equal(above.reason, 'bracketed');
  assert.ok(above.index >= 0 && above.index < view.start);
  assert.equal(above.bracket.bounded, true);
  assert.equal(above.bracket.hi, view.start);

  // Below the window: past every anchor, so it is an EXTRAPOLATION and says so.
  const below = estimateIndexOfTurn(view, 'response', BIG_TRUTH.responses - 1);
  assert.equal(below.exact, false);
  assert.equal(below.confidence, 'extrapolated');
  assert.equal(below.bracket.bounded, false);
  assert.ok(below.index >= view.end && below.index <= BIG.length - 1);

  // Bisection stays inside the same bracket — it is a different probe, not a different answer.
  const bisected = estimateIndexOfTurn(view, 'prompt', 3, { strategy: 'bisect' });
  assert.equal(bisected.confidence, 'bisected');
  assert.equal(bisected.index, Math.floor(view.start / 2));

  // Beyond the end of the conversation is clamped, never out of range.
  const beyond = estimateIndexOfTurn(view, 'prompt', 999999);
  assert.equal(beyond.index, BIG.length - 1);
  assert.equal(beyond.exact, false);

  // Degenerate inputs.
  assert.deepEqual(estimateIndexOfTurn(emptyView(), 'prompt', 5), { index: 0, exact: false, confidence: 'guess', reason: 'empty', bracket: null });
  assert.equal(estimateIndexOfTurn(view, 'prompt', 0).reason, 'bad-number');
  assert.equal(estimateIndexOfTurn(view, 'prompt', 'x').reason, 'bad-number');
});

test('planJump: already-loaded turns need no request at all', () => {
  const view = applyBand(emptyView(), normalizeBand(serve(BIG, { around: 900 })), { center: 900 }).view;
  const range = bandTurnRange(view);
  const plan = planJump(view, 'prompt', range.promptStart + 2, { sessionKey: 'Repo@main' });
  assert.equal(plan.satisfied, true);
  assert.equal(plan.exact, true);
  assert.equal(plan.around, BIG_TRUTH.byTurn.get(`prompt:${range.promptStart + 2}`));
  assert.deepEqual(plan.args, { around: plan.around, sessionKey: 'Repo@main' });
});

test('planJump: `around` is clamped client-side so the cache key matches the served band', () => {
  const view = applyBand(emptyView(), normalizeBand(serve(BIG, { around: 900 })), { center: 900 }).view;
  const plan = planJump(view, 'prompt', 10 ** 9, { scoped: true });
  assert.equal(plan.around, BIG.length - 1);
  assert.deepEqual(plan.args, { around: BIG.length - 1, scoped: true });
  const fromNothing = planJump(emptyView(), 'prompt', 500);
  assert.equal(fromNothing.around, 0);
  assert.equal(fromNothing.exact, false);
});

test('planJump: the exhausted flag trips only after MAX_JUMP_ATTEMPTS on a still-inexact guess', () => {
  const view = applyBand(emptyView(), normalizeBand(serve(BIG, { around: 900 })), { center: 900 }).view;
  assert.equal(planJump(view, 'prompt', 3, { attempt: 1 }).exhausted, false);
  assert.equal(planJump(view, 'prompt', 3, { attempt: MAX_JUMP_ATTEMPTS }).exhausted, true);
  const range = bandTurnRange(view);
  assert.equal(planJump(view, 'prompt', range.promptStart, { attempt: MAX_JUMP_ATTEMPTS }).exhausted, false, 'an exact hit is never exhausted');
});

// Drive the whole loop: plan → serve → normalize → apply, repeating while the target is not in
// the band. This is the actual user gesture ("take me to turn #N") end to end.
function jumpTo(all, startView, kind, number) {
  let view = startView;
  let requests = 0;
  for (let attempt = 1; attempt <= MAX_JUMP_ATTEMPTS; attempt++) {
    const plan = planJump(view, kind, number, { attempt });
    if (plan.satisfied) return { view, requests, plan };
    requests++;
    const band = normalizeBand(serve(all, plan.args));
    view = applyBand(view, band, { mode: 'replace', center: plan.around }).view;
    if (containsTurn(view, kind, number)) return { view, requests, plan };
  }
  return { view, requests, plan: planJump(view, kind, number, { attempt: MAX_JUMP_ATTEMPTS }) };
}

test('JUMP-TO-#N: every prompt in a 600-turn conversation is reachable within MAX_JUMP_ATTEMPTS', () => {
  const tail = applyBand(emptyView(), normalizeBand(serve(BIG, { limit: 250 })), {}).view;
  let worst = 0;
  for (let n = 1; n <= BIG_TRUTH.prompts; n++) {
    const { view, requests } = jumpTo(BIG, tail, 'prompt', n);
    assert.equal(containsTurn(view, 'prompt', n), true, `P#${n} not reached in ${requests} requests`);
    assert.equal(indexOfTurn(view, 'prompt', n), BIG_TRUTH.byTurn.get(`prompt:${n}`), `P#${n} landed on the wrong row`);
    assert.deepEqual(turnAt(view, indexOfTurn(view, 'prompt', n)), { kind: 'prompt', number: n });
    worst = Math.max(worst, requests);
  }
  assert.ok(worst <= MAX_JUMP_ATTEMPTS, `worst case ${worst} requests`);
});

test('JUMP-TO-#N: responses too, and from a cold view with nothing loaded', () => {
  for (const n of [1, 2, 137, 299, 300, 458, BIG_TRUTH.responses]) {
    const { view } = jumpTo(BIG, emptyView(), 'response', n);
    assert.equal(containsTurn(view, 'response', n), true, `R#${n}`);
    assert.equal(indexOfTurn(view, 'response', n), BIG_TRUTH.byTurn.get(`response:${n}`));
  }
});

test('JUMP-TO-#N: a target BEYOND the end lands on the clamped last band and says it is inexact', () => {
  const tail = applyBand(emptyView(), normalizeBand(serve(BIG, { limit: 250 })), {}).view;
  const { view, plan } = jumpTo(BIG, tail, 'prompt', BIG_TRUTH.prompts + 500);
  assert.equal(containsTurn(view, 'prompt', BIG_TRUTH.prompts + 500), false);
  assert.equal(plan.exact, false);
  assert.equal(view.end, BIG.length, 'we are parked at the live end, which is the closest we can get');
});

test('a conversation SHORTER than one window: one band, no truncation, jumps are instant', () => {
  const band = normalizeBand(serve(SMALL, { around: 3 }));
  assert.equal(band.start, 0);
  assert.equal(band.end, SMALL.length);
  assert.equal(band.truncated, false);
  const view = applyBand(emptyView(), band, { center: 3 }).view;
  const aff = viewAffordances(view);
  assert.equal(aff.atStart, true);
  assert.equal(aff.atEnd, true);
  assert.equal(aff.hasAbove, false);
  assert.equal(aff.hasBelow, false);
  assert.equal(planExtend(view, 'up'), null);
  assert.equal(planExtend(view, 'down'), null);
  for (let n = 1; n <= 5; n++) {
    const plan = planJump(view, 'prompt', n);
    assert.equal(plan.satisfied, true, `P#${n}`);
  }
});

// ── extension (scrolling past an edge) ──────────────────────────────────────────────────────

test('planExtend: returns null at each edge and overlaps by EXTEND_OVERLAP otherwise', () => {
  const middle = applyBand(emptyView(), normalizeBand(serve(BIG, { around: 900 })), { center: 900 }).view;
  const up = planExtend(middle, 'up');
  const down = planExtend(middle, 'down');
  assert.equal(up.direction, 'up');
  assert.equal(up.predicted.end, middle.start + EXTEND_OVERLAP);
  assert.equal(down.direction, 'down');
  assert.equal(down.predicted.start, middle.end - EXTEND_OVERLAP);

  const top = applyBand(emptyView(), normalizeBand(serve(BIG, { around: 0 })), { center: 0 }).view;
  assert.equal(planExtend(top, 'up'), null);
  assert.ok(planExtend(top, 'down'));

  const bottom = applyBand(emptyView(), normalizeBand(serve(BIG, { limit: 250 })), {}).view;
  assert.equal(planExtend(bottom, 'down'), null);
  assert.ok(planExtend(bottom, 'up'));

  assert.equal(planExtend(emptyView(), 'up'), null);
});

test('SCROLL BACK: repeated extends walk to row 0 with no duplicates and no gaps', () => {
  let view = applyBand(emptyView(), normalizeBand(serve(BIG, { limit: 250 })), {}).view;
  let steps = 0;
  while (view.start > 0) {
    const plan = planExtend(view, 'up', { sessionKey: 'Repo@main' });
    assert.ok(plan, 'planExtend must offer a step while rows remain above');
    assert.equal(plan.args.sessionKey, 'Repo@main');
    const out = applyBand(view, normalizeBand(serve(BIG, plan.args)), { mode: 'extend', center: plan.around });
    assert.equal(out.action, 'extended', `step ${steps} fell back to a replace`);
    assert.ok(out.view.start < view.start, 'each step must make progress');
    view = out.view;
    assert.deepEqual(view.rows, BIG.slice(view.start, view.end), `step ${steps}: rows drifted from the source`);
    assert.equal(view.generation, 1, 'scrolling must never invalidate the mounted rows');
    if (++steps > 50) throw new Error('extend loop did not terminate');
  }
  assert.equal(view.start, 0);
  assert.equal(view.end, BIG.length);
  assert.deepEqual(view.rows, BIG);
  assert.equal(view.promptOffset, 0);
  const aff = viewAffordances(view);
  assert.equal(aff.atStart, true);
  assert.equal(aff.atEnd, true);
  // And every absolute number in the fully-walked view is still correct.
  for (const n of [1, 2, 300, BIG_TRUTH.prompts]) {
    assert.equal(indexOfTurn(view, 'prompt', n), BIG_TRUTH.byTurn.get(`prompt:${n}`), `P#${n}`);
  }
});

test('SCROLL FORWARD: extending down from the top reaches the live end intact', () => {
  let view = applyBand(emptyView(), normalizeBand(serve(BIG, { around: 0 })), { center: 0 }).view;
  let steps = 0;
  while (view.end < BIG.length) {
    const plan = planExtend(view, 'down');
    assert.ok(plan);
    const out = applyBand(view, normalizeBand(serve(BIG, plan.args)), { mode: 'extend', center: plan.around });
    assert.equal(out.action, 'extended');
    assert.ok(out.view.end > view.end);
    view = out.view;
    assert.deepEqual(view.rows, BIG.slice(view.start, view.end));
    if (++steps > 50) throw new Error('extend loop did not terminate');
  }
  assert.deepEqual(view.rows, BIG);
});

// ── anchors + bracketed search ──────────────────────────────────────────────────────────────

test('every applied band leaves two anchors behind, and they are FACTS about the source', () => {
  const first = applyBand(emptyView(), normalizeBand(serve(BIG, { around: 900 })), { center: 900 }).view;
  const anchors = viewAnchors(first);
  assert.deepEqual(anchors[0], { index: 0, prompts: 0, responses: 0 }, 'the origin anchor is free and always there');
  for (const a of anchors) {
    const truth = countOffsets(BIG, a.index);
    assert.equal(a.prompts, truth.promptOffset, `anchor @${a.index} prompts`);
    assert.equal(a.responses, truth.responseOffset, `anchor @${a.index} responses`);
  }
  assert.ok(anchors.some((a) => a.index === first.start));
  assert.ok(anchors.some((a) => a.index === first.end));

  // A REPLACE keeps everything it learned; anchors outlive the rows they came from.
  const second = applyBand(first, normalizeBand(serve(BIG, { around: 100 })), { mode: 'replace', center: 100 }).view;
  const after = viewAnchors(second);
  assert.ok(after.some((a) => a.index === first.start), 'the discarded band is still an anchor');
  assert.ok(after.length > anchors.length);
  for (const a of after) assert.equal(a.prompts, countOffsets(BIG, a.index).promptOffset);
});

test('anchors stay index-ascending and count-monotone, thinned at MAX_ANCHORS', () => {
  let view = emptyView();
  const rand = rng(2024);
  for (let i = 0; i < 120; i++) {
    const center = Math.floor(rand() * BIG.length);
    view = applyBand(view, normalizeBand(serve(BIG, { around: center })), { mode: 'replace', center }).view;
    const anchors = viewAnchors(view);
    assert.ok(anchors.length <= MAX_ANCHORS, `anchor list grew to ${anchors.length}`);
    for (let k = 1; k < anchors.length; k++) {
      assert.ok(anchors[k].index > anchors[k - 1].index, 'indices strictly ascending');
      assert.ok(anchors[k].prompts >= anchors[k - 1].prompts, 'prompt counts monotone');
      assert.ok(anchors[k].responses >= anchors[k - 1].responses, 'response counts monotone');
    }
  }
  // Thinning must not corrupt the survivors.
  for (const a of viewAnchors(view)) assert.equal(a.prompts, countOffsets(BIG, a.index).promptOffset);
});

test('a band that CONTRADICTS an existing anchor evicts it — the renumber/roll case', () => {
  const view = applyBand(emptyView(), normalizeBand(serve(BIG, { around: 900 })), { center: 900 }).view;
  const stale = view.start;
  // The same rows, now claiming far fewer prompts precede them (as after an archive renumber).
  const renumbered = normalizeBand(serve(BIG, { around: 900 }));
  renumbered.promptOffset = 1;
  renumbered.responseOffset = 1;
  const out = applyBand(view, renumbered, { mode: 'replace', center: 900 }).view;
  const anchors = viewAnchors(out);
  const at = anchors.find((a) => a.index === stale);
  assert.equal(at.prompts, 1, 'the NEWER claim wins at a contested index');
  for (let k = 1; k < anchors.length; k++) {
    assert.ok(anchors[k].prompts >= anchors[k - 1].prompts, 'and monotonicity is restored');
  }
});

test('turnBracket: bounded between two anchors, unbounded past all of them', () => {
  const view = applyBand(emptyView(), normalizeBand(serve(BIG, { around: 900 })), { center: 900 }).view;
  const range = bandTurnRange(view);

  const early = turnBracket(view, 'prompt', 2);
  assert.equal(early.bounded, true);
  assert.equal(early.lo, 0);
  assert.equal(early.hi, view.start);
  assert.equal(early.hiCount, view.promptOffset);
  assert.equal(early.width, view.start);
  // The true row really is inside the bracket it claims.
  const trueIndex = BIG_TRUTH.byTurn.get('prompt:2');
  assert.ok(trueIndex >= early.lo && trueIndex < early.hi);

  const late = turnBracket(view, 'prompt', range.promptEnd + 20);
  assert.equal(late.bounded, false);
  assert.equal(late.hi, null);
  assert.equal(late.lo, view.end);

  assert.equal(turnBracket(emptyView(), 'prompt', 5).bounded, false);
});

// A conversation with a brutally uneven row distribution: a sparse head, 100 turns each buried
// under 100 tool rows, then a sparse tail. Uniform-density interpolation is hopeless here —
// this is the fixture that justifies the bisection fallback.
function makePathological() {
  const rows = [];
  for (let t = 0; t < 10; t++) { rows.push({ role: 'user' }); rows.push({ role: 'assistant' }); }
  for (let t = 0; t < 100; t++) {
    rows.push({ role: 'user' });
    for (let j = 0; j < 100; j++) rows.push({ role: 'tool_result' });
    rows.push({ role: 'assistant' });
  }
  for (let t = 0; t < 200; t++) { rows.push({ role: 'user' }); rows.push({ role: 'assistant' }); }
  return rows;
}

test('JUMP-TO-#N converges on a pathologically clustered transcript (bisection fallback)', () => {
  const all = makePathological();
  const truth = groundTruth(all);
  assert.equal(all.length, 10620);
  const tail = applyBand(emptyView(), normalizeBand(serve(all, { limit: 250 })), {}).view;
  let worst = 0;
  for (let n = 1; n <= truth.prompts; n++) {
    const { view, requests } = jumpTo(all, tail, 'prompt', n);
    assert.equal(containsTurn(view, 'prompt', n), true, `P#${n} unreachable`);
    assert.equal(indexOfTurn(view, 'prompt', n), truth.byTurn.get(`prompt:${n}`), `P#${n} wrong row`);
    worst = Math.max(worst, requests);
  }
  // 1 interpolation probe + ceil(log2(10620/501)) bisections = 6.
  assert.ok(worst <= MAX_JUMP_ATTEMPTS, `worst case ${worst}`);
  assert.ok(worst <= 1 + Math.ceil(Math.log2(all.length / 501)), `worst case ${worst} exceeds the documented bound`);
});

test('a WARM view (anchors from earlier jumps) reaches later targets in fewer requests', () => {
  const all = makePathological();
  const truth = groundTruth(all);
  const targets = [];
  for (let n = 5; n <= truth.prompts; n += 7) targets.push(n);

  let cold = 0;
  const tail = applyBand(emptyView(), normalizeBand(serve(all, { limit: 250 })), {}).view;
  for (const n of targets) cold += jumpTo(all, tail, 'prompt', n).requests;

  // Warm: carry the view (and therefore the anchors) forward across the whole session.
  let warm = 0;
  let view = tail;
  for (const n of targets) {
    const r = jumpTo(all, view, 'prompt', n);
    assert.equal(containsTurn(r.view, 'prompt', n), true);
    view = r.view;
    warm += r.requests;
  }
  assert.ok(warm < cold, `warm ${warm} should beat cold ${cold}`);
});
