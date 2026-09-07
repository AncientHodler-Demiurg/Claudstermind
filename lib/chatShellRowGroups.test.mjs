// node --test lib/chatShellRowGroups.test.mjs
//
// ROW GROUPS — per-LINE left/right alignment for the chat shell's header and footer rows.
//
// The ask, in the user's words: "not each declaring which side, but capturing what side is next, due
// to width settings. because it may be that 2 groups align left the next right, and the last group
// would be alone on the last line, and if it's alone right is favoured."
//
// So the side is a RESULT of the layout, never an input to it:
//
//   THE RULE — on each line, the LAST group goes right; the ones before it on that line pack left.
//   A group alone on a line is also the last on it, so "alone ⇒ right" needs no special case.
//
// A declared side genuinely cannot express this: the same group is the left-hand one at one width
// (sharing a line, with another group after it) and the right-hand one at another (pushed onto a
// line of its own). Only the measured layout knows which.
//
// Why not a flex spacer at all: `.spacer { flex: 1 }` only redistributes space among the items
// sharing ITS OWN line, so it can right-align exactly one group, on exactly the line it lands on —
// every other wrapped line falls back to packing left, and the row reads ragged. And there is no CSS
// selector for "did this item wrap", so the decision has to be made after layout.
//
// The plan is PURE (rowAlignPlan) so every ordering can be checked exhaustively; the measuring half
// (alignRowGroups) is exercised against a DOM with real, controllable line offsets.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const shellJs = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "chat-shell.js"), "utf8");

/* ---- the smallest DOM these two functions need ------------------------------------------------ */
function makeNode(tag) {
  const n = {
    tagName: String(tag || "div").toUpperCase(), children: [], attrs: {}, style: {},
    className: "", hidden: false, offsetTop: 0, offsetHeight: 24, parentNode: null,
    classList: {
      add(...c) { c.forEach((x) => { if (x && !n.className.split(" ").includes(x)) n.className = (n.className + " " + x).trim(); }); },
      remove(...c) { n.className = n.className.split(" ").filter((x) => x && !c.includes(x)).join(" "); },
      toggle(c, on) { const has = n.className.split(" ").includes(c); const want = on === undefined ? !has : !!on; want ? n.classList.add(c) : n.classList.remove(c); return want; },
      contains(c) { return n.className.split(" ").includes(c); },
    },
    setAttribute(k, v) { n.attrs[k] = String(v); if (k === "class") n.className = String(v); },
    getAttribute(k) { return n.attrs[k] ?? null; },
    appendChild(c) { if (c && typeof c === "object") { c.parentNode = n; n.children.push(c); } return c; },
  };
  return n;
}
function loadCS() {
  const win = { document: { createElement: makeNode, createTextNode: (t) => ({ tagName: "#text", textContent: String(t), children: [] }) } };
  new Function("window", shellJs)(win);
  return win.ChatShell;
}
/** A row of groups at the given line bands, each with one member (hidden if asked). */
function rowOf(CS, spec) {
  const row = makeNode("div");
  spec.forEach((s) => {
    const kid = makeNode("span");
    if (s.hiddenKid) kid.hidden = true;
    const g = CS.grp(s.empty ? [] : [kid]);
    g.offsetTop = s.top;
    g.offsetHeight = (s.bottom ?? s.top + 24) - s.top;
    row.appendChild(g);
  });
  return row;
}
const marginsOf = (row) => row.children.map((g) => g.style.marginLeft || "");
const alignsOf = (row) => row.children.map((g) => g.getAttribute("data-align"));
/** Shorthand: groups at the given line numbers, one band per line. */
const lines = (...lineNos) => lineNos.map((n) => ({ top: n * 30, bottom: n * 30 + 24 }));

/* ============================ 1. the plan, pure ============================================== */

test("two groups on a line: the first packs left, the LAST goes right", () => {
  const CS = loadCS();
  assert.deepEqual(CS.rowAlignPlan(lines(0, 0)), [1]);
});

test("three groups on a line: two align left, the next right", () => {
  const CS = loadCS();
  // Verbatim from the ask — this is the case a per-group declared side gets wrong, because the
  // middle group is a left-hand group here and would be the right-hand one if the width changed.
  assert.deepEqual(CS.rowAlignPlan(lines(0, 0, 0)), [2]);
});

test("a group ALONE on a line favours right", () => {
  const CS = loadCS();
  assert.deepEqual(CS.rowAlignPlan(lines(0)), [0]);
  // …including when it is the last group, pushed onto a line of its own by a narrow pane:
  assert.deepEqual(CS.rowAlignPlan(lines(0, 0, 0, 1)), [2, 3],
    "line 1: two left + one right; line 2: the last group alone, so right");
});

test("every line gets its own decision — the case a single spacer cannot express", () => {
  const CS = loadCS();
  assert.deepEqual(CS.rowAlignPlan(lines(0, 0, 1, 1)), [1, 3],
    "the last group of EACH line goes right, not just the first line's");
  assert.deepEqual(CS.rowAlignPlan(lines(0, 1, 2)), [0, 1, 2],
    "three lines of one group each: each is the last on its line, so each favours right");
});

test("the SAME group takes a different side at a different width", () => {
  const CS = loadCS();
  // The whole reason the side cannot be declared: group #1 here is left at one width…
  assert.deepEqual(CS.rowAlignPlan(lines(0, 0, 0)), [2]);
  // …and right at another, purely because the width pushed the group after it onto the next line.
  assert.deepEqual(CS.rowAlignPlan(lines(0, 0, 1)), [1, 2]);
});

test("groups on ONE line with different heights are one line, not two (align-items: center)", () => {
  const CS = loadCS();
  // Found by measuring the running app while every unit test passed: rows are `align-items: center`,
  // so a 20px chip sharing a line with a 30px select is centred against it and starts 5px LOWER.
  // Bucketing on exact `top` split those into two "lines" and mis-assigned the sides outright.
  assert.deepEqual(CS.rowAlignPlan([
    { top: 130, bottom: 160 },   // a 30px select
    { top: 135, bottom: 155 },   // a 20px chip, same line, centred → different top
    { top: 133, bottom: 157 },   // and a third, also same line
  ]), [2], "one line ⇒ exactly one push, on its last group");
});

test("a genuinely NEXT line still reads as a next line, row-gap and all", () => {
  const CS = loadCS();
  assert.deepEqual(CS.rowAlignPlan([
    { top: 0, bottom: 30 }, { top: 2, bottom: 28 },
    { top: 35, bottom: 65 }, { top: 39, bottom: 61 },   // +5px row-gap
  ]), [1, 3], "overlap decides the line — a real break is still a real break");
});

test("degenerate input never throws and never invents a push", () => {
  const CS = loadCS();
  assert.deepEqual(CS.rowAlignPlan(), []);
  assert.deepEqual(CS.rowAlignPlan([]), []);
  assert.deepEqual(CS.rowAlignPlan([{ top: 0 }, { top: 0 }]), [1],
    "groups with no measured height are one line — one push, on the last of them");
});

/* ============================ 2. the measuring half =========================================== */

test("alignRowGroups applies the plan, and records the side it captured", () => {
  const CS = loadCS();
  const row = rowOf(CS, lines(0, 0, 1, 1));
  assert.deepEqual(CS.alignRowGroups(row), [1, 3]);
  assert.deepEqual(marginsOf(row), ["", "auto", "", "auto"]);
  assert.deepEqual(alignsOf(row), ["start", "end", "start", "end"],
    "the captured side is written back onto the node — it exists nowhere else");
});

test("re-running it after a reflow RE-CAPTURES the sides instead of accumulating them", () => {
  const CS = loadCS();
  // Widening the pane can put everything back on one line. A group that was right on the old line 2
  // must become left again, or it right-aligns in the middle of a row that no longer wraps.
  const row = rowOf(CS, lines(0, 0, 1, 1));
  CS.alignRowGroups(row);
  row.children.forEach((g) => { g.offsetTop = 0; });      // everything now fits on one line
  assert.deepEqual(CS.alignRowGroups(row), [3]);
  assert.deepEqual(marginsOf(row), ["", "", "", "auto"]);
  assert.deepEqual(alignsOf(row), ["start", "start", "start", "end"],
    "the group that WAS right must give both its margin and its side back");
});

test("a group whose every member is hidden is retired, not left spending the row's gaps", () => {
  const CS = loadCS();
  const row = rowOf(CS, [{ top: 0, hiddenKid: true }, { top: 0 }, { top: 0 }]);
  CS.alignRowGroups(row);
  assert.ok(row.children[0].classList.contains("--gone"), "an all-hidden group must be taken out of flow");
  assert.ok(!row.children[1].classList.contains("--gone"), "a group with a visible member must stay");
  assert.deepEqual(marginsOf(row), ["", "", "auto"]);
});

test("an emptied group comes BACK when its member is shown again", () => {
  const CS = loadCS();
  const row = rowOf(CS, [{ top: 0, hiddenKid: true }, { top: 0 }]);
  CS.alignRowGroups(row);
  assert.ok(row.children[0].classList.contains("--gone"));
  row.children[0].children[0].hidden = false;
  CS.alignRowGroups(row);
  assert.ok(!row.children[0].classList.contains("--gone"),
    "retiring a group must be a per-pass decision, never a one-way door");
});

test("the --gone class counts as hidden too, not just the `hidden` property", () => {
  const CS = loadCS();
  // The package hides controls both ways (show() toggles --gone; some hosts set .hidden), so a
  // group checking only one of them would keep an invisible group in flow half the time.
  const row = rowOf(CS, lines(0, 0));
  row.children[0].children[0].classList.add("--gone");
  CS.alignRowGroups(row);
  assert.ok(row.children[0].classList.contains("--gone"));
});

test("a retired group does not count as the last one on its line", () => {
  const CS = loadCS();
  // If it did, the line's REAL last group would be skipped and the line would end ragged, with the
  // push spent on something invisible.
  const row = rowOf(CS, [{ top: 0 }, { top: 0 }, { top: 0, hiddenKid: true }]);
  CS.alignRowGroups(row);
  assert.equal(row.children[1].style.marginLeft, "auto", "the last VISIBLE group must be pushed");
  assert.equal(row.children[2].style.marginLeft, "", "the retired one must not be");
});

test("non-group children are ignored — a row may still hold a bare node", () => {
  const CS = loadCS();
  const row = rowOf(CS, lines(0, 0));
  const stray = makeNode("span");
  row.appendChild(stray);
  CS.alignRowGroups(row);
  assert.ok(!stray.style.marginLeft, "a non-group must be left untouched");
  assert.equal(stray.getAttribute("data-align"), null, "…and given no captured side");
});

test("a row with nothing in it is a no-op, not a crash", () => {
  const CS = loadCS();
  assert.deepEqual(CS.alignRowGroups(makeNode("div")), []);
  assert.deepEqual(CS.alignRowGroups(null), []);
});

test("grp() takes only children — a side cannot be declared even by accident", () => {
  const CS = loadCS();
  const kid = makeNode("span");
  const g = CS.grp([kid]);
  assert.ok(g.classList.contains("cs-grp"));
  assert.equal(g.getAttribute("data-side"), null, "there is no such thing as an authored side any more");
  assert.equal(g.getAttribute("data-align"), null, "…and the captured one only exists after a pass");
  assert.deepEqual(g.children, [kid]);
});

/* ============================ 3. the shell actually uses it =================================== */

test("a host's own identity bits go INTO the identity group, never against the row", () => {
  // The crash this pins, found by loading the real page (every test was green): Core did
  // `identityRow.insertBefore(identityLabel, els.identitySlot)`. Once rows are made of groups,
  // identitySlot is a child of the GROUP, not the row — so the row has no such child and the DOM
  // throws "the node before which the new node is to be inserted is not a child of this node",
  // taking out the whole pane render. The package therefore hands hosts the group itself.
  const ui = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "chat-shell-ui.js"), "utf8");
  const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
  assert.ok(/identityGroup: identityGroup/.test(ui),
    "the package must expose the identity group, so a host never has to walk parentNode to find it");
  assert.ok(!/identityRow\.insertBefore/.test(app),
    "no host may insert against the ROW — that is the throwing call this replaced");
  assert.ok(app.includes("identityGroup.insertBefore(identityLabel, view.els.identitySlot);"),
    "Core's repo label must land inside the identity group, beside the slot it belongs with");
});

test("layoutNow aligns every grouped row, so the sides are re-captured at every width", () => {
  const ui = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "chat-shell-ui.js"), "utf8");
  assert.ok(/\[frame\.identityRow, frame\.statsRow, frame\.actionRow, frame\.modelRow\]\.forEach/.test(ui),
    "all four rows must be aligned — a row left out silently keeps the old ragged behaviour");
  assert.ok(ui.includes("CS.alignRowGroups(r2)"), "…by the shared function, not a local copy");
  const layout = ui.slice(ui.indexOf("function layoutNow()"));
  assert.ok(layout.indexOf("CS.alignRowGroups") < layout.indexOf("call(\"layout\", r)"),
    "it must run inside the post-layout pass, where the line breaks are already known");
});
