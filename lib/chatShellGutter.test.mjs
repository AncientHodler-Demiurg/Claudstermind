// node --test lib/chatShellGutter.test.mjs
//
// THE LINE-NUMBER GUTTER, when the compose box WRAPS.
//
// Reported: "line numbering also doesn't seem to be detected properly" — a box holding two typed
// lines that wrapped onto four visual rows showed the numbers 1, 2, 3, 4 straight down, while the
// counter chip beside it correctly said "2 lines". The chip was right: the gutter was numbering
// VISUAL ROWS, so from the first wrap onwards every number named the wrong line.
//
// The rule, the same one every editor uses with wrapping on: one number per LOGICAL line, on the row
// where that line starts; its continuation rows carry no number; rows below the text keep counting,
// because they are the lines you would type next.
//
// `gutterEntries` is pure — given how many visual rows each line occupies, it decides what the
// column shows — so the wrapping cases can be checked exactly, without a layout engine.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const shellJs = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "chat-shell.js"), "utf8");

function makeNode(tag) {
  const n = {
    tagName: String(tag || "div").toUpperCase(), children: [], attrs: {}, style: {},
    className: "", textContent: "", value: "", parentNode: null,
    clientHeight: 600, clientWidth: 0, scrollTop: 0, offsetHeight: 0,
    classList: {
      add(...c) { c.forEach((x) => { if (x && !n.className.split(" ").includes(x)) n.className = (n.className + " " + x).trim(); }); },
      contains(c) { return n.className.split(" ").includes(c); },
    },
    setAttribute(k, v) { n.attrs[k] = String(v); if (k === "class") n.className = String(v); },
    getAttribute(k) { return n.attrs[k] ?? null; },
    appendChild(c) { if (c && typeof c === "object") { c.parentNode = n; n.children.push(c); } return c; },
    replaceChildren(...k) { n.children = []; k.forEach((c) => n.appendChild(c)); },
    addEventListener() {},
  };
  return n;
}
function loadCS() {
  const win = { document: { createElement: makeNode, createTextNode: (t) => ({ tagName: "#text", textContent: String(t), children: [] }), body: makeNode("body") } };
  new Function("window", shellJs)(win);
  return win.ChatShell;
}
/** The rendered column, as you would read it down the gutter: a number, or "" for a blank row. */
const column = (gut) => gut.children.map((b) => (b.className.includes("--cont") ? "" : b.children[0].textContent));
const brightness = (gut) => gut.children.map((b) => (b.classList.contains("--on") ? "on" : b.className.includes("--cont") ? "cont" : "dim"));

/* ---------------------------------------------------------------- the rule -------------------- */

test("no wrapping: one number per line, exactly as before", () => {
  const CS = loadCS();
  assert.deepEqual(CS.gutterEntries([1, 1, 1], 3).map((e) => e.n), [1, 2, 3]);
});

test("THE BUG: a line that wraps does not push the next line's number onto its own tail", () => {
  const CS = loadCS();
  // Two typed lines, the first wrapping onto two rows. The old code numbered the rows 1,2,3 — so "2"
  // sat against the CONTINUATION of line 1, and line 2 was called 3.
  assert.deepEqual(CS.gutterEntries([2, 1], 3).map((e) => e.n), [1, null, 2],
    "the second row belongs to line 1, so it carries no number; line 2 is numbered 2, on its own row");
});

test("the reported shape: 2 typed lines over 4 visual rows", () => {
  const CS = loadCS();
  // Exactly the screenshot: the chip said "2 lines" and the gutter said 1,2,3,4.
  const entries = CS.gutterEntries([2, 2], 4);
  assert.deepEqual(entries.map((e) => e.n), [1, null, 2, null]);
  assert.equal(entries.filter((e) => e.n != null).length, 2, "two numbers for two lines — the chip and the gutter agree");
});

test("a long line wrapping many times still owns every one of its rows", () => {
  const CS = loadCS();
  assert.deepEqual(CS.gutterEntries([5], 5).map((e) => e.n), [1, null, null, null, null]);
});

test("rows below the text keep counting — they are the lines you would type next", () => {
  const CS = loadCS();
  const entries = CS.gutterEntries([2, 1], 6);
  assert.deepEqual(entries.map((e) => e.n), [1, null, 2, 3, 4, 5]);
  assert.deepEqual(entries.map((e) => e.on), [true, true, true, false, false, false],
    "typed lines are bright; the empty rows below are dim");
});

test("an empty box shows dim slots and no typed lines", () => {
  const CS = loadCS();
  const entries = CS.gutterEntries([], 3);
  assert.deepEqual(entries.map((e) => e.n), [1, 2, 3]);
  assert.ok(entries.every((e) => !e.on), "nothing has been typed, so nothing is bright");
});

test("the box never renders an empty column, even with no room", () => {
  const CS = loadCS();
  assert.equal(CS.gutterEntries([], 0).length, 1);
  assert.equal(CS.gutterEntries([], -5).length, 1);
});

test("text taller than the box is not truncated to the visible slots", () => {
  const CS = loadCS();
  // The box scrolls; the numbers have to keep going or they stop matching the text you scroll to.
  assert.deepEqual(CS.gutterEntries([1, 1, 1, 1, 1], 2).map((e) => e.n), [1, 2, 3, 4, 5]);
});

test("degenerate row counts never produce a zero-height row or a NaN number", () => {
  const CS = loadCS();
  for (const bad of [[0], [null], [undefined], [NaN], [-3]]) {
    const entries = CS.gutterEntries(bad, 1);
    assert.equal(entries.length, 1, "a line always occupies at least one row");
    assert.equal(entries[0].n, 1);
  }
  assert.deepEqual(CS.gutterEntries(null, 2).map((e) => e.n), [1, 2]);
  assert.deepEqual(CS.gutterEntries(undefined, 1).map((e) => e.n), [1]);
});

/* ---------------------------------------------------------------- what gets painted ------------ */

test("paintGutter renders numbers, blanks and dim slots as the rule says", () => {
  const CS = loadCS();
  const gut = makeNode("div"), ta = makeNode("textarea");
  ta.value = "one\ntwo";
  ta.style.height = "70px";                       // (70-14)/18 → 3 slots
  const written = CS.paintGutter(ta, gut);
  assert.equal(written, 2, "it reports LINES TYPED — the same number the chip shows");
  // No layout engine here, so nothing wraps: 2 numbered rows + 1 dim slot.
  assert.deepEqual(column(gut), ["1", "2", "3"]);
  assert.deepEqual(brightness(gut), ["on", "on", "dim"]);
});

test("a continuation row is blank, and still holds its height", () => {
  const CS = loadCS();
  const gut = makeNode("div");
  // Drive the painter through the pure half, which is what decides the column.
  const entries = CS.gutterEntries([2, 1], 3);
  assert.equal(entries[1].n, null, "blank, because the line above owns this row");
  // The rendered blank uses a non-breaking space: an empty <b> would collapse to zero height and
  // slide every number below it up by a row — the same off-by-a-row this whole fix is about.
  assert.ok(shellJs.includes('el("b", { class: "--cont" }, ["\\u00a0"])'),
    "the blank row must carry a non-breaking space, not nothing");
  assert.ok(readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "components.css"), "utf8")
    .includes(".cs-shell .gutter b.--cont"), "…and have a style of its own");
});

test("the column widens with the widest number actually shown, not the line count", () => {
  const CS = loadCS();
  const gut = makeNode("div"), ta = makeNode("textarea");
  ta.value = "x";
  ta.style.height = "200px";                      // (200-14)/18 → 10 slots ⇒ a 2-digit number appears
  CS.paintGutter(ta, gut);
  assert.equal(gut.style.width, 14 + 2 * 7 + "px", "two glyphs of space once '10' is on screen");
  assert.equal(ta.style.paddingLeft, 14 + 2 * 7 + 10 + "px", "…and the text keeps clear of the divider");
});

test("measurement is optional: with no layout engine every line is one row", () => {
  const CS = loadCS();
  const gut = makeNode("div"), ta = makeNode("textarea");
  ta.value = "a\nb\nc";
  assert.doesNotThrow(() => CS.paintGutter(ta, gut));
  assert.deepEqual(column(gut).slice(0, 3), ["1", "2", "3"],
    "the shim has no getComputedStyle, so the painter must degrade to the unwrapped case, not throw");
});
