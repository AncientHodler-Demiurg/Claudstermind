// node --test lib/pactSnap.test.mjs
//
// SNAP-TO-DEFAULT for the Pact workspace layout.
//
// The ask: "since on Ouronet the text viewer boxes can be modified freely, I need a button that
// snaps them to their default sizes, which are the equal sizes. There should be 2: one Master Snap
// that snaps everything including the size of the chat space, and a secondary one that snaps only
// the viewer boxes within their given space, leaving the Pact chat box as is."
//
// There are exactly two draggable things in the workspace, and "default" for both is the ABSENCE of
// a setting, never a remembered layout:
//   • the viewer boxes — each box's share of its row (`g.flex`) and each row's share of the height
//     (`PACT_ED.rowFlex`); default is 1 everywhere, i.e. equal shares.
//   • the chat column — an explicit pixel width in `cm.pact.chatw.v1`; default is none at all, so
//     the stylesheet's share applies.
// So snapping CLEARS. These pin that arithmetic; the DOM half is verified by driving the real app.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT LAYOUT SNAP — pure helpers";
const end = "// ===== end PACT LAYOUT SNAP pure helpers =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "snap helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactSnapRowFlex, pactSnapBoxesAreDefault, pactSnapAllIsDefault } =
  new Function(block + "\nreturn { pactSnapRowFlex, pactSnapBoxesAreDefault, pactSnapAllIsDefault };")();

// The real split ladder from app.js — read out of the source so this test can never drift from it.
const LADDER = (() => {
  const m = src.match(/const PACT_ED_ROWS = (\{[^}]*\});/);
  assert.ok(m, "the split ladder must be findable");
  // eslint-disable-next-line no-new-func
  return new Function("return " + m[1])();
})();

/* ---------------------------------------------------------------- equal shares ----------------- */

test("default row weights are one `1` per row, for every box count the ladder supports", () => {
  // 5 boxes split [3,2] and 7 split [4,3] — an under-filled last row still shares its row equally,
  // so the answer is per-ROW, not per-box.
  const expected = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 6: 2, 7: 2, 8: 2 };
  for (const [n, rows] of Object.entries(expected)) {
    const rf = pactSnapRowFlex(Number(n), LADDER);
    assert.equal(rf.length, rows, `${n} boxes ⇒ ${rows} row(s)`);
    assert.ok(rf.every((v) => v === 1), "…all equal");
  }
});

test("an unknown box count falls back to the ladder's widest shape rather than throwing", () => {
  assert.deepEqual(pactSnapRowFlex(99, LADDER), [1, 1]);
  assert.deepEqual(pactSnapRowFlex(0, LADDER), [1, 1]);
  assert.doesNotThrow(() => pactSnapRowFlex(3, null));
});

test("the returned array is fresh each time — snapping twice can't alias one row's weight to another", () => {
  const a1 = pactSnapRowFlex(6, LADDER), a2 = pactSnapRowFlex(6, LADDER);
  assert.notEqual(a1, a2);
  a1[0] = 5;
  assert.deepEqual(a2, [1, 1], "mutating one result must not reach the other");
});

/* ---------------------------------------------------------------- "is it default?" -------------- */

test("boxes are default only when EVERY weight, on both axes, is exactly 1", () => {
  assert.equal(pactSnapBoxesAreDefault([1, 1], [1, 1, 1, 1, 1, 1]), true);
  assert.equal(pactSnapBoxesAreDefault([1, 1], [1, 1.4, 0.6, 1, 1, 1]), false, "a dragged box counts");
  assert.equal(pactSnapBoxesAreDefault([1.2, 0.8], [1, 1]), false, "a dragged ROW counts too");
  assert.equal(pactSnapBoxesAreDefault([], []), true, "nothing laid out yet is trivially default");
});

test("a weight that is merely close to 1 is not 1 — a nudged box still offers the snap", () => {
  assert.equal(pactSnapBoxesAreDefault([1], [1, 1.0001]), false);
  assert.equal(pactSnapBoxesAreDefault([1], [1, 0.999]), false);
});

test("the master button also accounts for the chat column's explicit width", () => {
  // Same boxes, both already equal — the two buttons must still disagree when the chat column has
  // been dragged, because only one of them puts it back.
  assert.equal(pactSnapBoxesAreDefault([1], [1, 1]), true);
  assert.equal(pactSnapAllIsDefault([1], [1, 1], 0), true, "no stored width ⇒ fully default");
  assert.equal(pactSnapAllIsDefault([1], [1, 1], 950), false, "a dragged chat column is NOT default");
});

test("the master button is off-default whenever EITHER half is", () => {
  assert.equal(pactSnapAllIsDefault([1], [1, 1.5], 0), false, "boxes off, chat default");
  assert.equal(pactSnapAllIsDefault([1], [1, 1], 700), false, "boxes default, chat off");
  assert.equal(pactSnapAllIsDefault([1.3], [1, 1.5], 700), false, "both off");
});

test("a missing / zero / junk stored width reads as 'no width set', not as a width", () => {
  // pactReadChatW returns 0 when nothing is stored; anything non-positive means the stylesheet's
  // default share is in force, which IS the default state.
  for (const w of [0, null, undefined, NaN, "", "abc", -5]) {
    assert.equal(pactSnapAllIsDefault([1], [1, 1], w), true, `chatW=${String(w)} must read as default`);
  }
  assert.equal(pactSnapAllIsDefault([1], [1, 1], "820"), false, "…while a real stored string width does not");
});

/* ---------------------------------------------------------------- the wiring -------------------- */

test("the two buttons exist, do different things, and only one touches the chat column", () => {
  // The distinction IS the feature: "a secondary one that snaps only the viewer boxes … leaving the
  // Pact chat box as is". If both cleared the width there would be no reason for two buttons.
  assert.ok(src.includes("function pactSnapBoxes()"), "the boxes-only snap must exist");
  assert.ok(src.includes("function pactSnapAll(rightEl)"), "the master snap must exist");
  const boxes = src.slice(src.indexOf("function pactSnapBoxes()"), src.indexOf("function pactSnapAll(rightEl)"));
  assert.ok(!boxes.includes("PACT_CHAT_W_KEY") && !boxes.includes("pactApplyChatW"),
    "the boxes-only snap must not touch the chat column's width at all");
  const all = src.slice(src.indexOf("function pactSnapAll(rightEl)"), src.indexOf("function pactSnapRefresh()"));
  assert.ok(all.includes("localStorage.removeItem(PACT_CHAT_W_KEY)"), "the master snap must clear the stored width");
  assert.ok(all.includes("pactApplyChatW(rightEl, 0)"), "…and drop the inline width so the default share applies");
  assert.ok(all.includes("pactSnapBoxes()"), "…and do everything the boxes-only snap does, via the same function");
});

test("snapping applies the weights in place instead of rebuilding every editor", () => {
  // pactEdLayout() re-creates each box's DOM and re-renders its editor. Using it here would throw
  // away scroll position and caret in up to eight open files to change two numbers.
  assert.ok(src.includes("function pactEdApplyWeights()"), "an in-place applier must exist");
  const boxes = src.slice(src.indexOf("function pactSnapBoxes()"), src.indexOf("function pactSnapAll(rightEl)"));
  assert.ok(boxes.includes("pactEdApplyWeights()"), "the snap must use it");
  assert.ok(!boxes.includes("pactEdLayout()"), "…and must not rebuild the whole grid");
});

test("there is ONE reset, shared by the button and the box-count change", () => {
  // The count-change path used to inline its own copy of the same three assignments.
  assert.ok(src.includes("function pactEdResetWeights()"), "the shared reset must exist");
  assert.ok(src.includes("if (PACT_ED.layoutN !== n) { PACT_ED.layoutN = n; pactEdResetWeights(); }"),
    "the box-count change must go through it, not repeat it");
  assert.ok(src.includes("pactEdResetWeights();\n  pactEdApplyWeights();"), "…and so must the snap");
});

test("the buttons are refreshed everywhere the layout can go off-default", () => {
  // A stale disabled button is worse than no button: it says "already default" about a layout that
  // isn't. Every path that changes a weight or the width has to re-evaluate them.
  assert.ok(src.includes("function pactSnapRefresh()"));
  const calls = (src.match(/pactSnapRefresh\(\)/g) || []).length;
  assert.ok(calls >= 6, `expected a refresh at every mutation point, found ${calls}`);
  // the box/row drag, the chat drag, the chat grip's double-click reset, mount, and layout rebuild
  assert.ok(src.includes("pactSnapRefresh(); // …and light up the snap buttons, since the layout is now off-default"),
    "after a box/row drag");
  assert.ok(src.includes("pactSnapRefresh();   // the chat column is now off-default"), "after a chat-column drag");
  assert.ok(src.includes("pactSnapRefresh();   // a restored layout may already be off-default"), "at mount");
});
