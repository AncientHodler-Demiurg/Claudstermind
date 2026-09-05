import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CACHE_DEFAULTS, createScrollCache, rangeKey, approximateBandBytes, windowSignature,
  put, get, findCovering, findContaining, has, invalidateRange, invalidateFrom, clear,
  setSignature, noteTotal, stats, ranges,
} from './scrollCache.mjs';

import { normalizeBand } from './transcriptWindow.mjs';
import { windowAround, windowTail } from './conversationWindow.mjs';

// ── fixtures ────────────────────────────────────────────────────────────────────────────────

function makeRows(n, textLen = 10, from = 0) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({ role: i % 2 === 0 ? 'user' : 'assistant', text: 'x'.repeat(textLen), at: from + i });
  }
  return rows;
}

/** A band in the transcriptWindow sense. */
function band(start, end, { textLen = 10, total = 100000 } = {}) {
  return {
    rows: makeRows(end - start, textLen, start),
    start, end, total,
    promptOffset: Math.ceil(start / 2), responseOffset: Math.floor(start / 2),
  };
}

// Size every band as exactly its row count, so eviction arithmetic in the tests is obvious.
function rowSizer() {
  return (b) => (b && Array.isArray(b.rows) ? b.rows.length : 0);
}

// ── keys + sizing ───────────────────────────────────────────────────────────────────────────

test('rangeKey is the absolute row range, end exclusive', () => {
  assert.equal(rangeKey(350, 851), '350:851');
  assert.equal(rangeKey(0, 0), '0:0');
  assert.equal(rangeKey(-5, 3), '0:3');
  assert.equal(rangeKey(undefined, undefined), '0:0');
  assert.equal(rangeKey(1.9, 4.2), '1:4');
});

test('approximateBandBytes tracks text size, not just row count', () => {
  const roles = 50 * 'user'.length + 50 * 'assistant'.length; // every string field counts
  const small = approximateBandBytes(band(0, 100, { textLen: 10 }), 0);
  const large = approximateBandBytes(band(0, 100, { textLen: 10000 }), 0);
  assert.equal(small, 100 * 10 + roles);
  assert.equal(large, 100 * 10000 + roles);
  assert.ok(large > small * 100, 'a fat band must cost far more than a thin one of the same length');
  // Per-row overhead is added on top and is what stops a band of 500 empty rows costing 0.
  assert.equal(approximateBandBytes({ rows: [{}, {}] }, 128), 256);
  // Nested strings (image refs, tool payload lists) count too; junk never throws.
  assert.equal(approximateBandBytes({ rows: [{ images: [{ path: 'abc' }], parts: ['de'] }] }, 0), 5);
  assert.equal(approximateBandBytes(null), 0);
  assert.equal(approximateBandBytes({ rows: [null, 7, 'x'] }, 1), 3);
});

test('THE BOUNDING CHOICE: an entry cap does not bound memory, a byte budget does', () => {
  // Same number of entries, 1000× the memory. This is why maxBytes is the real bound.
  const byCount = createScrollCache({ maxEntries: 4, maxBytes: Infinity });
  const byBytes = createScrollCache({ maxEntries: 4, maxBytes: 40_000 });
  for (let i = 0; i < 4; i++) {
    const fat = band(i * 500, i * 500 + 500, { textLen: 1000 });
    put(byCount, fat);
    put(byBytes, fat);
  }
  assert.equal(stats(byCount).entries, 4);
  assert.ok(stats(byCount).bytes > 2_000_000, 'four "entries" is two megabytes here');
  assert.ok(stats(byBytes).bytes <= 40_000, 'the byte budget is actually respected');
  assert.ok(stats(byBytes).entries < 4);
});

// ── put / get / range lookup ────────────────────────────────────────────────────────────────

test('put then get by exact range, with hit/miss accounting', () => {
  const c = createScrollCache({ sizeOf: rowSizer() });
  const b = band(350, 851);
  const res = put(c, b);
  assert.equal(res.stored, true);
  assert.equal(res.key, '350:851');
  assert.equal(res.reason, 'ok');

  assert.equal(get(c, 350, 851), b);
  assert.equal(get(c, 350, 852), null);
  const s = stats(c);
  assert.equal(s.hits, 1);
  assert.equal(s.misses, 1);
  assert.equal(s.puts, 1);
  assert.equal(s.entries, 1);
  assert.equal(s.rows, 501);
  assert.equal(s.bytes, 501);
  assert.equal(s.hitRate, 0.5);
});

test('hitRate is null until something has actually been asked', () => {
  const c = createScrollCache();
  assert.equal(stats(c).hitRate, null, '0% would be a lie about a cache nobody queried');
  put(c, band(0, 10));
  assert.equal(stats(c).hitRate, null);
  get(c, 0, 10);
  assert.equal(stats(c).hitRate, 1);
});

test('findCovering returns the SMALLEST band that covers the request', () => {
  const c = createScrollCache({ sizeOf: rowSizer() });
  const wide = band(0, 1000);
  const tight = band(400, 600);
  put(c, wide);
  put(c, tight);
  assert.equal(findCovering(c, 450, 550), tight, 'the cheapest band that answers wins');
  assert.equal(findCovering(c, 100, 200), wide);
  assert.equal(findCovering(c, 900, 1100), null, 'partial coverage is a MISS, not a partial answer');
  assert.equal(findCovering(c, 1200, 1300), null);
});

test('findContaining is the jump-to-#N lookup: one row index in, the band holding it out', () => {
  const c = createScrollCache({ sizeOf: rowSizer() });
  const b = band(350, 851);
  put(c, b);
  assert.equal(findContaining(c, 350), b);
  assert.equal(findContaining(c, 850), b);
  assert.equal(findContaining(c, 851), null, 'end is EXCLUSIVE');
  assert.equal(findContaining(c, 349), null);
});

test('has() answers without disturbing recency or the counters', () => {
  const c = createScrollCache({ sizeOf: rowSizer() });
  put(c, band(0, 100));
  put(c, band(100, 200));
  assert.equal(has(c, 10, 20), true);
  assert.equal(has(c, 90, 110), false, 'no entry spans the seam');
  assert.deepEqual([stats(c).hits, stats(c).misses], [0, 0]);
  // The LRU order is untouched, so a subsequent eviction still drops [0,100).
  const tight = createScrollCache({ maxEntries: 2, sizeOf: rowSizer() });
  put(tight, band(0, 100));
  put(tight, band(100, 200));
  has(tight, 0, 100);
  put(tight, band(200, 300));
  assert.equal(has(tight, 0, 100), false, 'has() must not have rescued the LRU entry');
});

test('re-putting the same range REPLACES it and does not double-count bytes', () => {
  const c = createScrollCache({ sizeOf: rowSizer() });
  put(c, band(0, 100));
  assert.equal(stats(c).bytes, 100);
  const fresher = band(0, 100);
  put(c, fresher);
  assert.equal(stats(c).entries, 1);
  assert.equal(stats(c).bytes, 100);
  assert.equal(get(c, 0, 100), fresher, 'the newer copy wins — the server is authoritative');
});

test('put rejects garbage and empty ranges instead of poisoning the cache', () => {
  const c = createScrollCache();
  assert.equal(put(c, null).reason, 'no-band');
  assert.equal(put(c, { rows: 'nope' }).reason, 'no-band');
  assert.equal(put(c, { rows: [], start: 5, end: 5 }).reason, 'empty');
  assert.equal(put(null, band(0, 10)).reason, 'no-cache');
  assert.equal(stats(c).entries, 0);
});

// ── LRU eviction ────────────────────────────────────────────────────────────────────────────

test('LRU: eviction takes the least recently USED, not the least recently added', () => {
  const c = createScrollCache({ maxBytes: 300, sizeOf: rowSizer() });
  put(c, band(0, 100));     // A
  put(c, band(100, 200));   // B
  put(c, band(200, 300));   // C — at budget
  assert.equal(stats(c).entries, 3);

  get(c, 0, 100);           // A becomes most-recent
  put(c, band(300, 400));   // D — must evict B, the true LRU

  assert.deepEqual(ranges(c).map((r) => r.start), [200, 0, 300], 'LRU order, oldest first');
  assert.equal(has(c, 0, 100), true);
  assert.equal(has(c, 100, 200), false, 'B was the least recently used');
  assert.equal(stats(c).evictions, 1);
  assert.equal(stats(c).bytes, 300);
});

test('LRU: a range lookup also refreshes recency', () => {
  const c = createScrollCache({ maxBytes: 200, sizeOf: rowSizer() });
  put(c, band(0, 100));
  put(c, band(100, 200));
  findContaining(c, 50);            // touches [0,100)
  put(c, band(200, 300));
  assert.equal(has(c, 0, 100), true);
  assert.equal(has(c, 100, 200), false);
});

test('the byte budget evicts as many entries as it takes, in LRU order', () => {
  const c = createScrollCache({ maxBytes: 1000, sizeOf: rowSizer() });
  for (let i = 0; i < 10; i++) put(c, band(i * 100, i * 100 + 100));
  assert.equal(stats(c).entries, 10);
  assert.equal(stats(c).bytes, 1000);
  const res = put(c, band(1000, 1600)); // 600 rows: needs 6 evictions
  assert.equal(res.stored, true);
  assert.equal(res.evicted, 6);
  assert.equal(stats(c).bytes, 1000);
  assert.deepEqual(ranges(c).map((r) => r.start), [600, 700, 800, 900, 1000]);
});

test('maxEntries is a secondary guard and still bites when bands are tiny', () => {
  const c = createScrollCache({ maxBytes: 10 ** 9, maxEntries: 3, sizeOf: rowSizer() });
  for (let i = 0; i < 8; i++) put(c, band(i * 10, i * 10 + 10));
  assert.equal(stats(c).entries, 3);
  assert.deepEqual(ranges(c).map((r) => r.start), [50, 60, 70]);
  assert.equal(stats(c).evictions, 5);
});

test('a single band bigger than the whole budget is REFUSED, not admitted over budget', () => {
  const c = createScrollCache({ maxBytes: 100, sizeOf: rowSizer() });
  put(c, band(0, 50));
  const res = put(c, band(1000, 1500)); // 500 rows > 100 budget
  assert.equal(res.stored, false);
  assert.equal(res.reason, 'oversize');
  assert.equal(stats(c).rejections, 1);
  assert.equal(stats(c).bytes, 50, 'the budget held');
  assert.equal(has(c, 0, 50), true, 'and the refusal did not evict anything');
  assert.equal(findContaining(c, 1200), null);
});

test('bytes never drift below zero across put/evict/invalidate churn', () => {
  const c = createScrollCache({ maxBytes: 500, sizeOf: rowSizer() });
  for (let i = 0; i < 40; i++) {
    put(c, band(i * 37, i * 37 + 50 + (i % 7) * 10));
    if (i % 5 === 0) invalidateRange(c, i * 37, i * 37 + 20);
    if (i % 11 === 0) get(c, 0, 50);
    const s = stats(c);
    assert.ok(s.bytes >= 0);
    assert.ok(s.bytes <= 500, `bytes ${s.bytes} over budget at step ${i}`);
    let sum = 0;
    for (const r of ranges(c)) sum += r.bytes;
    assert.equal(s.bytes, sum, `accounting drifted at step ${i}`);
  }
});

// ── invalidation ────────────────────────────────────────────────────────────────────────────

test('invalidateRange drops every OVERLAPPING band, including partial overlaps', () => {
  const c = createScrollCache({ sizeOf: rowSizer() });
  put(c, band(0, 100));
  put(c, band(100, 200));
  put(c, band(150, 250));
  put(c, band(300, 400));
  const n = invalidateRange(c, 120, 160);
  assert.equal(n, 2, '[100,200) and [150,250) both touch the changed rows');
  assert.equal(has(c, 0, 100), true);
  assert.equal(has(c, 300, 400), true);
  assert.equal(stats(c).invalidations, 2);
  assert.equal(stats(c).bytes, 200);
  assert.equal(invalidateRange(c, 1000, 2000), 0);
  assert.equal(invalidateRange(null, 0, 1), 0);
});

test('invalidateFrom drops the tail and keeps the history below it', () => {
  const c = createScrollCache({ sizeOf: rowSizer() });
  put(c, band(0, 100));
  put(c, band(100, 200));
  put(c, band(200, 300));
  assert.equal(invalidateFrom(c, 150), 2);
  assert.equal(has(c, 0, 100), true);
  assert.equal(stats(c).entries, 1);
});

test('clear empties everything and resets the accounting', () => {
  const c = createScrollCache({ sizeOf: rowSizer() });
  put(c, band(0, 100));
  put(c, band(100, 200));
  assert.equal(clear(c), 2);
  assert.equal(stats(c).entries, 0);
  assert.equal(stats(c).bytes, 0);
  assert.equal(stats(c).total, null);
  assert.equal(clear(c), 0);
});

test('SIGNATURE: switching conversation drops everything — never serve another chat\'s turns', () => {
  const a = windowSignature({ sessionKey: 'Repo@main', sessionId: 'sess-1' });
  const b = windowSignature({ sessionKey: 'Other@main', sessionId: 'sess-9' });
  assert.notEqual(a, b);

  const c = createScrollCache({ signature: a, sizeOf: rowSizer() });
  put(c, band(0, 100));
  assert.equal(setSignature(c, a), false, 'the same signature is a no-op');
  assert.equal(has(c, 0, 100), true);
  assert.equal(setSignature(c, b), true);
  assert.equal(stats(c).entries, 0);
  assert.equal(stats(c).signature, b);
});

test('SIGNATURE: a ROLL changes it, because the archive renumbers what a row index means', () => {
  const before = windowSignature({ sessionKey: 'Repo@main', sessionId: 's1', workspaceId: 'Repo@main', sourceRef: 'Repo@main#seg1' });
  const after = windowSignature({ sessionKey: 'Repo@main', sessionId: 's2', workspaceId: 'Repo@main', sourceRef: 'Repo@main#seg2' });
  assert.notEqual(before, after);
  const c = createScrollCache({ signature: before, sizeOf: rowSizer() });
  put(c, band(0, 500));
  assert.equal(setSignature(c, after), true);
  assert.equal(findContaining(c, 100), null, 'a post-roll read must never hit a pre-roll band');
});

test('SIGNATURE: a new TURN must not change it — appending does not renumber history', () => {
  const sig = windowSignature({ sessionKey: 'Repo@main', sessionId: 's1' });
  assert.equal(sig, windowSignature({ sessionKey: 'Repo@main', sessionId: 's1' }), 'stable across calls');
  // Deliberately excludes the row total: otherwise every single turn would nuke the cache.
  const withTotal = windowSignature({ sessionKey: 'Repo@main', sessionId: 's1', total: 1200 });
  assert.equal(withTotal, sig);
  assert.equal(windowSignature(), '|||');
  assert.equal(windowSignature(null), '|||');
});

test('put honours an inline signature switch before storing', () => {
  const c = createScrollCache({ signature: 'A', sizeOf: rowSizer() });
  put(c, band(0, 100));
  put(c, band(500, 600), { signature: 'B' });
  assert.equal(stats(c).entries, 1);
  assert.equal(has(c, 0, 100), false, 'the old conversation was dropped first');
  assert.equal(has(c, 500, 600), true);
});

test('noteTotal: GROWTH drops only the stale tail; history below it stays cached', () => {
  const c = createScrollCache({ sizeOf: rowSizer() });
  noteTotal(c, 1000);
  put(c, band(0, 200, { total: 1000 }));
  put(c, band(500, 700, { total: 1000 }));
  put(c, band(800, 1000, { total: 1000 }));   // the tail band
  const res = noteTotal(c, 1010);             // one more turn arrived
  assert.equal(res.changed, true);
  assert.equal(res.cleared, false);
  assert.equal(res.dropped, 1, 'only the band that ended at the old total is now incomplete');
  assert.equal(has(c, 0, 200), true);
  assert.equal(has(c, 500, 700), true);
  assert.equal(has(c, 800, 1000), false);
});

test('noteTotal: SHRINKAGE clears everything — a roll renumbers every index', () => {
  const c = createScrollCache({ sizeOf: rowSizer() });
  noteTotal(c, 5000);
  put(c, band(0, 200, { total: 5000 }));
  put(c, band(4000, 4500, { total: 5000 }));
  const res = noteTotal(c, 400);
  assert.equal(res.cleared, true);
  assert.equal(res.dropped, 2);
  assert.equal(stats(c).entries, 0);
  assert.equal(stats(c).total, 400);
  assert.equal(findContaining(c, 100), null, 'even row 100 is a different turn now');
});

test('noteTotal: first sighting records without dropping; junk is ignored', () => {
  const c = createScrollCache({ sizeOf: rowSizer() });
  put(c, band(0, 100, { total: 100 }));
  assert.equal(stats(c).total, 100, 'put learns the total from the band it stores');
  assert.deepEqual(noteTotal(c, 100), { changed: false, dropped: 0, cleared: false });
  assert.deepEqual(noteTotal(c, 'x'), { changed: false, dropped: 0, cleared: false });
  assert.deepEqual(noteTotal(c, -1), { changed: false, dropped: 0, cleared: false });
  assert.equal(has(c, 0, 100), true);
});

test('put of a GROWN tail band does not evict the band it is replacing knowledge of', () => {
  // put() passes grew:"keep" — the band being stored IS the fresh tail, so dropping entries
  // that touched the old end would throw away the very thing being written.
  const c = createScrollCache({ sizeOf: rowSizer() });
  put(c, band(0, 200, { total: 1000 }));
  put(c, band(900, 1000, { total: 1000 }));
  put(c, band(900, 1010, { total: 1010 }));
  assert.equal(has(c, 0, 200), true);
  assert.equal(has(c, 900, 1010), true);
  assert.equal(stats(c).total, 1010);
});

test('a stale band can never be READ back after a shrink, even without a signature change', () => {
  const c = createScrollCache({ sizeOf: rowSizer() });
  put(c, band(600, 900, { total: 1200 }));
  assert.ok(findContaining(c, 700));
  // The conversation rolled: same session, far fewer rows, everything renumbered.
  put(c, band(0, 40, { total: 40 }));
  assert.equal(findContaining(c, 700), null);
  assert.equal(stats(c).entries, 1);
});

// ── composition with transcriptWindow / conversationWindow ──────────────────────────────────

test('END TO END: real server bands round-trip through normalizeBand into the cache', () => {
  const all = [];
  for (let i = 0; i < 3000; i++) all.push({ role: i % 3 === 2 ? 'assistant' : i % 3 === 0 ? 'user' : 'tool_result', text: `row ${i}` });

  const serveAround = (center) => {
    const w = windowAround(all, center, { before: 250, after: 250 });
    return normalizeBand({
      transcript: w.transcript, transcriptTotal: w.total,
      transcriptTruncated: w.truncatedBefore || w.truncatedAfter,
      promptOffset: w.promptOffset, responseOffset: w.responseOffset,
      windowStart: w.start, windowEnd: w.end,
    });
  };
  const w = windowTail(all, 250);
  const tail = normalizeBand({
    transcript: w.transcript, transcriptTotal: w.total, transcriptTruncated: w.truncatedBefore,
    promptOffset: w.promptOffset, responseOffset: w.responseOffset,
  });

  const c = createScrollCache({ maxBytes: 10 ** 7, signature: windowSignature({ sessionKey: 'Repo@main', sessionId: 's1' }) });
  put(c, tail);
  for (const center of [300, 1500, 2500]) put(c, serveAround(center));

  // Every cached band still describes exactly the rows it claims.
  for (const r of ranges(c)) {
    const hit = get(c, r.start, r.end);
    assert.deepEqual(hit.rows, all.slice(r.start, r.end), `band [${r.start},${r.end})`);
    assert.equal(hit.promptOffset, all.slice(0, r.start).filter((x) => x.role === 'user').length);
  }
  // And a scroll-back into an already-fetched region is a HIT, not another fetch.
  const before = stats(c).hits;
  assert.ok(findContaining(c, 1400));
  assert.ok(findContaining(c, 2600));
  assert.equal(stats(c).hits, before + 2);
  assert.equal(findContaining(c, 900), null, 'a region never fetched is honestly a miss');
});

test('a long browsing session stays inside its byte budget with real-sized rows', () => {
  const budget = 1_000_000;
  const c = createScrollCache({ maxBytes: budget });
  // 200 jumps around a huge conversation, bands of wildly different weight.
  for (let i = 0; i < 200; i++) {
    const start = (i * 379) % 50000;
    const textLen = i % 17 === 0 ? 20000 : 40; // occasional giant tool output
    put(c, band(start, start + 501, { textLen, total: 50501 }));
    assert.ok(stats(c).bytes <= budget, `over budget at jump ${i}`);
    assert.ok(stats(c).entries <= CACHE_DEFAULTS.maxEntries);
  }
  const s = stats(c);
  assert.ok(s.evictions + s.rejections > 0, 'the budget must actually have bitten');
  assert.ok(s.fill <= 1);
});
