// node --test lib/recallCue.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  RECALL_CUE_INITIAL,
  RECALL_EXCERPT_MAX_CHARS,
  RECALL_IMAGE_ROUTE,
  RECALL_MAX_HITS,
  classifyRecallError,
  dismissRecallCue,
  rankRecallHits,
  recallCueLabel,
  recallExcerpt,
  recallImageRefs,
  recallImageUrl,
  recallProvenance,
  recallRef,
  reduceRecallCue,
  shapeLookingUp,
  shapeRecallCue,
} from "./recallCue.mjs";

const AT = 1_784_801_237_800;

const numberHitEvent = (over = {}) => ({
  kind: "recall", mode: "number", kindOf: "prompt", number: 1, ok: true, error: null, at: AT,
  hit: {
    segmentRef: "Repo@main#seg1", workspaceId: "Repo@main", kind: "prompt", number: 1,
    text: "the very first question about kadena pact",
    images: [{ path: "images/bbbb.png", hash: "bbbb", mediaType: "image/png" }],
    row: { role: "user", text: "the very first question about kadena pact" },
  },
  ...over,
});

const queryHit = (over = {}) => ({
  segmentRef: "Repo@main#seg1", workspaceId: "Repo@main", kind: "prompt", number: 1,
  snippet: "…about kadena pact…", images: 1, ...over,
});

// ---------------------------------------------------------------- the ON/OFF pair

test("lookingUp turns the cue on, in both modes", () => {
  const byNumber = shapeLookingUp({ kind: "lookingUp", mode: "number", kindOf: "response", number: 1237, query: "", at: AT });
  assert.equal(byNumber.active, true);
  assert.equal(byNumber.mode, "number");
  assert.equal(byNumber.label, "Looking up R#1237…");
  assert.equal(byNumber.at, AT);

  const byQuery = shapeLookingUp({ kind: "lookingUp", mode: "query", kindOf: "prompt", number: null, query: "kadena pact", at: AT });
  assert.equal(byQuery.mode, "query");
  assert.match(byQuery.label, /kadena pact/);

  assert.equal(shapeLookingUp({ kind: "assistant" }), null);
  assert.equal(shapeLookingUp(null), null);
});

test("the pair is balanced: lookingUp → recall always ends with the cue OFF", () => {
  let s = reduceRecallCue(RECALL_CUE_INITIAL, { kind: "lookingUp", mode: "number", kindOf: "prompt", number: 1, at: AT });
  assert.equal(s.active, true);
  assert.equal(s.result, null);
  s = reduceRecallCue(s, numberHitEvent());
  assert.equal(s.active, false);
  assert.equal(s.result.status, "hit");
  assert.ok(s.request, "the request that produced the result is kept for context");
});

test("EVERY terminal path clears the cue — not-found, no-archive, internal-error, refusal", () => {
  const terminals = [
    { kind: "recall", mode: "number", kindOf: "prompt", number: 9, ok: false, hit: null, error: "No archived prompt #9 — it may still be in the active window.", at: AT },
    { kind: "recall", mode: "number", kindOf: "prompt", number: 9, ok: false, hit: null, error: "No archive for this conversation yet.", at: AT },
    { kind: "recall", mode: "number", kindOf: "prompt", number: 9, ok: false, hit: null, error: "ENOENT: no such file or directory", at: AT },
    { kind: "recall", mode: "query", query: "zzz", ok: false, hits: [], error: "Nothing archived matches that.", at: AT },
    { kind: "recall", mode: "query", query: "", ok: false, hits: [], error: "Nothing to recall — give a turn number or a search query." },
  ];
  for (const ev of terminals) {
    const on = reduceRecallCue(RECALL_CUE_INITIAL, { kind: "lookingUp", mode: ev.mode, kindOf: "prompt", number: ev.number ?? null, query: ev.query ?? "", at: AT });
    const off = reduceRecallCue(on, ev);
    assert.equal(off.active, false, `cue stuck on for ${ev.error}`);
    assert.ok(off.result, "a terminal recall must always produce a renderable result");
    assert.ok(off.result.message, "and that result must always carry a message");
  }
});

test("the refusal path has NO lookingUp — a bare recall still turns nothing on and renders", () => {
  const s = reduceRecallCue(RECALL_CUE_INITIAL, { kind: "recall", mode: "query", query: "", ok: false, hits: [], error: "Nothing to recall — give a turn number or a search query." });
  assert.equal(s.active, false);
  assert.equal(s.request, null);
  assert.equal(s.result.status, "refused");
  assert.equal(s.result.reason, "refused");
  assert.equal(s.result.at, null, "the refusal event carries no `at` (CONTRACT §5 shows one; the server omits it)");
});

test("unrelated events and junk leave the cue exactly as it was", () => {
  const on = reduceRecallCue(RECALL_CUE_INITIAL, { kind: "lookingUp", mode: "query", query: "x", at: AT });
  for (const ev of [null, undefined, 7, "recall", { kind: "assistant" }, { kind: "rolling", segment: 2 }]) {
    assert.equal(reduceRecallCue(on, ev), on);
  }
  assert.equal(reduceRecallCue(undefined, { kind: "assistant" }), RECALL_CUE_INITIAL);
});

test("dismiss clears everything and never leaves a spinner", () => {
  const on = reduceRecallCue(RECALL_CUE_INITIAL, { kind: "lookingUp", mode: "query", query: "x", at: AT });
  assert.deepEqual(dismissRecallCue(on), { active: false, request: null, result: null });
});

test("recallCueLabel prefers the live request, then the result", () => {
  const on = reduceRecallCue(RECALL_CUE_INITIAL, { kind: "lookingUp", mode: "number", kindOf: "prompt", number: 4, at: AT });
  assert.equal(recallCueLabel(on), "Looking up P#4…");
  const off = reduceRecallCue(on, numberHitEvent());
  assert.equal(recallCueLabel(off), "P#1 · Repo@main#seg1");
  assert.equal(recallCueLabel(null), "");
  assert.equal(recallCueLabel(RECALL_CUE_INITIAL), "");
});

// ---------------------------------------------------------------- number mode / provenance

test("a number hit carries full provenance and a resolvable image URL", () => {
  const r = shapeRecallCue(numberHitEvent());
  assert.equal(r.ok, true);
  assert.equal(r.status, "hit");
  assert.equal(r.mode, "number");
  assert.equal(r.hit.ref, "P#1");
  assert.equal(r.hit.segmentRef, "Repo@main#seg1");
  assert.equal(r.hit.provenance.label, "P#1 · Repo@main#seg1");
  assert.equal(r.hit.provenance.linkable, true);
  assert.equal(r.hit.excerpt.truncated, false);
  assert.equal(r.hit.text, "the very first question about kadena pact");
  assert.equal(r.hit.imageCount, 1);
  assert.equal(r.hit.imagesResolvable, true);
  assert.equal(r.hit.images[0].url, "/api/workspace/image?workspaceId=Repo%40main&path=images%2Fbbbb.png");
  assert.deepEqual(r.hit.row, { role: "user", text: "the very first question about kadena pact" });
  assert.equal(r.message, "P#1 · Repo@main#seg1");
});

test("a response hit is labelled R#, and the kind is taken from the hit when the event omits it", () => {
  const ev = numberHitEvent({ kindOf: undefined, number: undefined });
  ev.hit = { ...ev.hit, kind: "response", number: 1237 };
  const r = shapeRecallCue(ev);
  assert.equal(r.hit.ref, "R#1237");
  assert.equal(r.kindOf, "response");
  assert.equal(r.number, 1237);
});

test("a hit with NO workspaceId is not renderable as an image — the URL is null, not a broken guess", () => {
  const ev = numberHitEvent();
  ev.hit = { ...ev.hit, workspaceId: "" };
  const r = shapeRecallCue(ev);
  assert.equal(r.hit.images[0].url, null);
  assert.equal(r.hit.images[0].resolvable, false);
  assert.equal(r.hit.imagesResolvable, false);
  assert.equal(r.hit.provenance.resolvable, false);
  assert.equal(r.hit.provenance.linkable, true, "the segment link still works without a workspace");
});

test("malformed image refs are dropped rather than rendered as blanks", () => {
  const ev = numberHitEvent();
  ev.hit = { ...ev.hit, images: [null, { hash: "no-path" }, { path: "images/ok.png" }, "nope"] };
  const r = shapeRecallCue(ev);
  assert.equal(r.hit.imageCount, 1);
  assert.equal(r.hit.images[0].path, "images/ok.png");
  assert.equal(r.hit.images[0].mediaType, "");
});

test("ok:false, ok:true-with-null-hit and a missing hit all render as an honest miss", () => {
  for (const ev of [
    { kind: "recall", mode: "number", kindOf: "prompt", number: 9, ok: false, hit: null, error: "No archived prompt #9 — it may still be in the active window.", at: AT },
    { kind: "recall", mode: "number", kindOf: "prompt", number: 9, ok: true, hit: null, error: null, at: AT },
  ]) {
    const r = shapeRecallCue(ev);
    assert.equal(r.ok, false);
    assert.equal(r.hit, null);
    assert.equal(r.totalHits, 0);
    assert.ok(r.message.length > 0);
  }
  // the server's own wording is preferred verbatim — it explains WHY better than we could
  assert.match(shapeRecallCue({ kind: "recall", mode: "number", kindOf: "prompt", number: 9, ok: false, hit: null, error: "No archived prompt #9 — it may still be in the active window." }).message, /still be in the active window/);
  // ...and with no message at all we still say something specific
  assert.match(shapeRecallCue({ kind: "recall", mode: "number", kindOf: "response", number: 9, ok: true, hit: null }).message, /No archived response R#9/);
});

test("an internal error is reported AS an error, not as 'nothing matched'", () => {
  const r = shapeRecallCue({ kind: "recall", mode: "number", kindOf: "prompt", number: 1, ok: false, hit: null, error: "EACCES: permission denied, open '_index.json'", at: AT });
  assert.equal(r.status, "error");
  assert.equal(r.reason, "internal-error");
  assert.match(r.message, /^Recall failed: EACCES/);
});

test("no-archive is its own reason, distinct from not-found", () => {
  const r = shapeRecallCue({ kind: "recall", mode: "query", query: "x", ok: false, hits: [], error: "No archive for this conversation yet.", at: AT });
  assert.equal(r.reason, "no-archive");
  assert.equal(r.status, "empty");
});

// ---------------------------------------------------------------- query mode

test("multiple query hits: server order by default, capped, with totals reported", () => {
  const hits = Array.from({ length: 14 }, (_, i) => queryHit({ number: 100 - i, segmentRef: `Repo@main#seg${14 - i}`, snippet: `hit ${i} kadena` }));
  const r = shapeRecallCue({ kind: "recall", mode: "query", query: "kadena", ok: true, hits, error: null, at: AT });
  assert.equal(r.status, "hits");
  assert.equal(r.totalHits, 14);
  assert.equal(r.shownHits, RECALL_MAX_HITS);
  assert.equal(r.capped, true);
  assert.deepEqual(r.hits.map((h) => h.number), hits.slice(0, 10).map((h) => h.number), "default order is the server's newest-first scan");
  assert.match(r.message, /14 archived turns match/);
  assert.match(r.message, /showing 10/);
});

test("a custom limit caps further and marks it", () => {
  const hits = [queryHit({ number: 1 }), queryHit({ number: 2 }), queryHit({ number: 3 })];
  const r = shapeRecallCue({ kind: "recall", mode: "query", query: "k", ok: true, hits, at: AT }, { limit: 2 });
  assert.equal(r.shownHits, 2);
  assert.equal(r.totalHits, 3);
  assert.equal(r.capped, true);
});

test("duplicate hits (same segment+kind+number) are collapsed once, before the cap", () => {
  const dup = queryHit({ number: 5 });
  const r = shapeRecallCue({ kind: "recall", mode: "query", query: "k", ok: true, hits: [dup, { ...dup }, queryHit({ number: 6 })], at: AT });
  assert.equal(r.totalHits, 2);
  assert.equal(r.capped, false);
});

test("relevance ordering is opt-in, deterministic, and totally ordered", () => {
  const hits = [
    queryHit({ number: 10, segmentRef: "s#seg3", snippet: "a pact here" }),                 // 1 occurrence, pos 2
    queryHit({ number: 20, segmentRef: "s#seg2", snippet: "pact and pact and pact" }),      // 3 occurrences
    queryHit({ number: 30, segmentRef: "s#seg1", snippet: "pact first" }),                  // 1 occurrence, pos 0
    queryHit({ number: 40, segmentRef: "s#seg0", snippet: "PACT first" }),                  // 1 occurrence, pos 0, higher number
  ];
  const ranked = rankRecallHits(hits, "pact");
  assert.deepEqual(ranked.map((h) => h.number), [20, 40, 30, 10]);
  // same input, same output, every time
  assert.deepEqual(rankRecallHits(hits, "pact").map((h) => h.number), ranked.map((h) => h.number));
  // and via the shaper
  const r = shapeRecallCue({ kind: "recall", mode: "query", query: "pact", ok: true, hits, at: AT }, { order: "relevance" });
  assert.deepEqual(r.hits.map((h) => h.number), [20, 40, 30, 10]);
  // default stays the server's order
  assert.deepEqual(shapeRecallCue({ kind: "recall", mode: "query", query: "pact", ok: true, hits, at: AT }).hits.map((h) => h.number), [10, 20, 30, 40]);
});

test("rankRecallHits survives an empty query, junk rows and a bad limit", () => {
  assert.deepEqual(rankRecallHits(null, "x"), []);
  assert.deepEqual(rankRecallHits([null, 5, "x"], "x"), []);
  const hits = [queryHit({ number: 1 }), queryHit({ number: 2 })];
  assert.equal(rankRecallHits(hits, "").length, 2, "no needle → original order, nothing dropped");
  assert.equal(rankRecallHits(hits, "k", { limit: 0 }).length, 2, "a bogus limit falls back to the default cap");
});

test("zero hits is an honest 'nothing matched', never a silent no-op", () => {
  const r = shapeRecallCue({ kind: "recall", mode: "query", query: "zzz", ok: false, hits: [], error: "Nothing archived matches that.", at: AT });
  assert.equal(r.status, "empty");
  assert.equal(r.reason, "not-found");
  assert.deepEqual(r.hits, []);
  assert.equal(r.totalHits, 0);
  assert.equal(r.capped, false);
  assert.equal(r.message, "Nothing archived matches that.");
});

test("ok:true with an empty hits array is still treated as a miss", () => {
  const r = shapeRecallCue({ kind: "recall", mode: "query", query: "zzz", ok: true, hits: [], at: AT });
  assert.equal(r.ok, false);
  assert.equal(r.status, "empty");
});

test("a query hit exposes an image COUNT, never fake refs", () => {
  const r = shapeRecallCue({ kind: "recall", mode: "query", query: "k", ok: true, hits: [queryHit({ images: 3 })], at: AT });
  assert.equal(r.hits[0].imageCount, 3);
  assert.deepEqual(r.hits[0].images, [], "the query payload has no paths to render");
  assert.equal(r.hits[0].provenance.label, "P#1 · Repo@main#seg1");
});

// ---------------------------------------------------------------- excerpt / truncation

test("an oversized excerpt is cut WITH a visible marker and the omitted count", () => {
  const text = "x".repeat(RECALL_EXCERPT_MAX_CHARS + 350);
  const e = recallExcerpt(text);
  assert.equal(e.truncated, true);
  assert.equal(e.text.length, RECALL_EXCERPT_MAX_CHARS);
  assert.equal(e.omittedChars, 350);
  assert.equal(e.fullLength, RECALL_EXCERPT_MAX_CHARS + 350);
  assert.match(e.marker, /truncated — 350 more characters of 2350/);
  assert.ok(e.display.endsWith(e.marker), "the marker is part of the rendered text, so nothing vanishes silently");
});

test("excerpt boundaries: exactly at the cap is not truncated; one over is", () => {
  assert.equal(recallExcerpt("y".repeat(10), 10).truncated, false);
  const over = recallExcerpt("y".repeat(11), 10);
  assert.equal(over.truncated, true);
  assert.equal(over.omittedChars, 1);
  assert.match(over.marker, /1 more character of 11\]/, "singular, not '1 characters'");
});

test("excerpt handles empty/non-string text and a bogus cap", () => {
  assert.deepEqual(recallExcerpt(""), { text: "", display: "", marker: "", truncated: false, omittedChars: 0, fullLength: 0 });
  assert.equal(recallExcerpt(null).text, "");
  assert.equal(recallExcerpt(undefined).truncated, false);
  assert.equal(recallExcerpt("abc", 0).truncated, false, "a bogus cap falls back to the default, which is larger");
  assert.equal(recallExcerpt("abc", -1).text, "abc");
});

test("a huge recalled turn is truncated through the shaper, and the row stays available in full", () => {
  const ev = numberHitEvent();
  ev.hit = { ...ev.hit, text: "z".repeat(5000), row: { role: "user", text: "z".repeat(5000) } };
  const r = shapeRecallCue(ev);
  assert.equal(r.hit.excerpt.truncated, true);
  assert.equal(r.hit.excerpt.text.length, RECALL_EXCERPT_MAX_CHARS);
  assert.equal(r.hit.row.text.length, 5000, "the verbatim archived row is still there to expand into");
  // and the cap is overridable per call
  assert.equal(shapeRecallCue(ev, { maxChars: 50 }).hit.excerpt.text.length, 50);
});

// ---------------------------------------------------------------- helpers / edge cases

test("recallImageUrl refuses to build a URL it cannot resolve, and encodes both params", () => {
  assert.equal(recallImageUrl("", "images/a.png"), null);
  assert.equal(recallImageUrl("W", ""), null);
  assert.equal(recallImageUrl(null, null), null);
  assert.equal(recallImageUrl("Repo@main", "images/a b&c.png"), `${RECALL_IMAGE_ROUTE}?workspaceId=Repo%40main&path=images%2Fa%20b%26c.png`);
  assert.match(recallImageUrl("W", "p", "/relay/image"), /^\/relay\/image\?/);
});

test("recallImageRefs ignores a query hit's numeric `images` field", () => {
  assert.deepEqual(recallImageRefs({ workspaceId: "W", images: 3 }), []);
  assert.deepEqual(recallImageRefs(null), []);
  assert.equal(recallImageRefs({ workspaceId: "W", images: [{ path: "p" }] }).length, 1);
});

test("recallRef and recallProvenance degrade honestly on missing data", () => {
  assert.equal(recallRef("prompt", 12), "P#12");
  assert.equal(recallRef("response", 12), "R#12");
  assert.equal(recallRef("weird", 12), "P#12", "an unknown kind is treated as a prompt, matching the server default");
  assert.equal(recallRef("prompt", 0), "P#?");
  assert.equal(recallRef("prompt", null), "P#?");

  const p = recallProvenance({});
  assert.equal(p.label, "P#?");
  assert.equal(p.linkable, false);
  assert.equal(p.resolvable, false);
  assert.equal(recallProvenance(null).ref, "P#?");
});

test("classifyRecallError covers every message the server can emit, and fails safe", () => {
  assert.equal(classifyRecallError("Nothing to recall — give a turn number or a search query."), "refused");
  assert.equal(classifyRecallError("No archive for this conversation yet."), "no-archive");
  assert.equal(classifyRecallError("No archived prompt #7 — it may still be in the active window."), "not-found");
  assert.equal(classifyRecallError("No archived response #7 — it may still be in the active window."), "not-found");
  assert.equal(classifyRecallError("Nothing archived matches that."), "not-found");
  assert.equal(classifyRecallError("EACCES"), "internal-error");
  assert.equal(classifyRecallError(""), "internal-error");
  assert.equal(classifyRecallError(null), "internal-error");
  assert.equal(classifyRecallError(42), "internal-error");
});

test("mode is inferred when an event omits it (forward/backward compatibility)", () => {
  const inferredNumber = shapeRecallCue({ kind: "recall", ok: true, number: 3, hit: { segmentRef: "s#seg0", workspaceId: "W", kind: "prompt", number: 3, text: "t" }, at: AT });
  assert.equal(inferredNumber.mode, "number");
  assert.equal(inferredNumber.status, "hit");

  const inferredQuery = shapeRecallCue({ kind: "recall", ok: true, query: "q", hits: [queryHit()], at: AT });
  assert.equal(inferredQuery.mode, "query");
  assert.equal(inferredQuery.status, "hits");

  const bogusMode = shapeRecallCue({ kind: "recall", mode: "telepathy", ok: false, hits: [], error: "Nothing archived matches that." });
  assert.equal(bogusMode.mode, "query");
});

test("shapeRecallCue rejects anything that is not a recall event", () => {
  assert.equal(shapeRecallCue({ kind: "lookingUp" }), null);
  assert.equal(shapeRecallCue(null), null);
  assert.equal(shapeRecallCue("recall"), null);
});

test("`at` falls back to the caller's clock only when the event omits it", () => {
  assert.equal(shapeRecallCue({ kind: "recall", mode: "query", query: "", ok: false, hits: [] }, { now: 99 }).at, 99);
  assert.equal(shapeRecallCue({ kind: "recall", mode: "query", query: "", ok: false, hits: [], at: AT }, { now: 99 }).at, AT);
});

test("two recalls in a row never leave the cue on and always replace the result", () => {
  let s = reduceRecallCue(RECALL_CUE_INITIAL, numberHitEvent());
  assert.equal(s.active, false);
  s = reduceRecallCue(s, { kind: "recall", mode: "query", query: "zzz", ok: false, hits: [], error: "Nothing archived matches that." });
  assert.equal(s.active, false);
  assert.equal(s.result.status, "empty");
});

test("a second lookingUp clears the previous result so a stale excerpt is not shown as new", () => {
  let s = reduceRecallCue(RECALL_CUE_INITIAL, numberHitEvent());
  assert.ok(s.result);
  s = reduceRecallCue(s, { kind: "lookingUp", mode: "query", query: "next", at: AT });
  assert.equal(s.active, true);
  assert.equal(s.result, null);
});

test("a miss with NO error message reads as 'nothing matched', not as a crash", () => {
  const r = shapeRecallCue({ kind: "recall", mode: "query", query: "zzz", ok: false, hits: [] });
  assert.equal(r.reason, "not-found");
  assert.equal(r.status, "empty");
  assert.equal(r.message, "Nothing archived matches that.");
  // ...while the standalone classifier still fails safe on a message it cannot place
  assert.equal(classifyRecallError(""), "internal-error");
});
