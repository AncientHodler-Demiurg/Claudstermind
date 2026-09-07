// node --test lib/chatShellStackedGroups.test.mjs
//
// THE ASK: "make logical groups in the footer — model select up, the running-model medallion down;
// effort selector plus Bypass below; ultracode ticker plus fast ticker; auto-wrap ticker and its bar
// above, Compact/Wrap below. Then they behave like the groups in the header."
//
// So a stacked group is an ordinary group — it wraps and takes its side by the same captured-side
// rule every other row uses (lib/chatShellRowGroups.test.mjs) — that happens to be two rows tall.
//
// WHAT THESE TESTS ARE FOR. The pairing is the point: each bottom row CAPTIONS the control above it
// (the model you picked over the one actually running; effort over the permission mode it runs
// under). Two things can silently destroy that, and both actually happened while building it:
//
//   1. A host replacing the group's children directly. All three wrap-control painters did
//      `replaceChildren(autoLabel, meter, split)` straight onto the group, which is correct for a
//      flat span and turns a stack into a three-row column. Measured in Pact exactly that way: a
//      58px column where the stack is 47px in two rows.
//   2. An empty bottom row. Core shows no `fast` toggle, so that pair has nothing underneath — and
//      an empty row that still costs a row's height makes the whole shelf taller for nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const shellJs = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "chat-shell.js"), "utf8");
const components = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "components.css"), "utf8");
const shellUi = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "chat-shell-ui.js"), "utf8");
const CS_ = CS;
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

/* A DOM shim just rich enough for grp/stack/alignRowGroups: classList, children, offset geometry. */
function node(tag) {
  const n = {
    tagName: String(tag).toUpperCase(), children: [], style: {}, hidden: false, _cls: new Set(),
    offsetTop: 0, offsetHeight: 0, _attrs: {},
    appendChild(c) { n.children.push(c); c.parentNode = n; return c; },
    replaceChildren(...k) { n.children = k; k.forEach((c) => { c.parentNode = n; }); },
    setAttribute(k, v) { n._attrs[k] = v; }, getAttribute(k) { return n._attrs[k] ?? null; },
    addEventListener() {},
  };
  // el() assigns `className`, so the shim has to keep that and classList in step — otherwise every
  // class the package sets at construction is invisible to classList.contains().
  Object.defineProperty(n, "className", {
    get: () => [...n._cls].join(" "),
    set: (v) => { n._cls = new Set(String(v || "").split(/\s+/).filter(Boolean)); },
  });
  n.classList = {
    add: (...c) => c.forEach((x) => n._cls.add(x)), remove: (...c) => c.forEach((x) => n._cls.delete(x)),
    contains: (c) => n._cls.has(c), toggle: (c, on) => { const v = on === undefined ? !n._cls.has(c) : !!on; v ? n._cls.add(c) : n._cls.delete(c); return v; },
  };
  return n;
}
function CS() {
  const win = { document: { createElement: node, createTextNode: (t) => ({ tagName: "#text", textContent: String(t), children: [], classList: { add() {}, contains: () => false, toggle() {}, remove() {} } }) },
                requestAnimationFrame: (f) => f(), addEventListener() {} };
  win.window = win;
  new Function("window", shellJs)(win);
  return win.ChatShell;
}
/** Lay a row out: every live group on one line unless `wrapAt` says otherwise. */
function place(row, heights, tops) {
  const g = row.children.filter((c) => c.classList.contains("cs-grp"));
  g.forEach((x, i) => { x.offsetHeight = heights[i] ?? 20; x.offsetTop = tops ? tops[i] : 0; });
}

test("stack() builds ONE group of exactly two rows — it is a group, so it aligns like every other", () => {
  const cs = CS();
  const a = cs.el("span", {}, []), b = cs.el("span", {}, []);
  const g = cs.stack([a], [b]);
  assert.ok(g.classList.contains("cs-grp"), "a stack IS a group — that is what makes it wrap and align like the header's");
  assert.ok(g.classList.contains("--stack"), "…marked so the CSS can lay it out as a column");
  assert.equal(g.children.length, 2, "exactly two rows");
  assert.ok(g.children.every((r) => r.classList.contains("cs-grow")), "each row is addressable");
  assert.equal(g.children[0].children[0], a, "the control goes on top");
  assert.equal(g.children[1].children[0], b, "its caption goes underneath");
});

test("a stack with an empty bottom row COLLAPSES to one row — Core has no `fast` toggle", () => {
  const cs = CS();
  const row = node("div");
  const ultra = cs.el("label", {}, []), fast = cs.el("label", {}, []);
  const g = cs.stack([ultra], [fast]);
  row.appendChild(g);

  place(row, [40]);
  cs.alignRowGroups(row);
  assert.ok(!g.children[1].classList.contains("--gone"), "both rows live while both have visible members");

  fast.hidden = true;                       // the host hides `fast` for a model that has no fast mode
  cs.alignRowGroups(row);
  assert.ok(g.children[1].classList.contains("--gone"), "the empty row is retired — it must not cost a row's height");
  assert.ok(!g.classList.contains("--gone"), "…but the group itself survives, because the top row still has something");
});

test("a stack with BOTH rows empty is retired outright, like any other empty group", () => {
  const cs = CS();
  const row = node("div");
  const a = cs.el("label", {}, []), b = cs.el("label", {}, []);
  const g = cs.stack([a], [b]);
  row.appendChild(g);
  a.hidden = true; b.hidden = true;
  place(row, [0]);
  cs.alignRowGroups(row);
  assert.ok(g.classList.contains("--gone"), "no visible member anywhere — the group goes, gap and all");
});

test("stacked groups take their side from where the width put them, exactly like flat ones", () => {
  const cs = CS();
  const row = node("div");
  const gs = [0, 1, 2, 3].map((i) => { const g = cs.stack([cs.el("span", {}, [])], [cs.el("span", {}, [])]); row.appendChild(g); return g; });
  // Three on line 1, the fourth pushed onto line 2 — the shape a narrow Pact pane produces.
  place(row, [50, 50, 50, 50], [0, 0, 0, 55]);
  cs.alignRowGroups(row);
  assert.deepEqual(gs.map((g) => g.getAttribute("data-align")), ["start", "start", "end", "end"],
    "last on each line goes right; a group alone on its line is also last on it");
});

test("fillWrapGroup puts the pieces in the two rows — the thing three separate painters got wrong", () => {
  const cs = CS();
  const g = cs.stack([], []);
  const wc = { autoLabel: cs.el("label", {}, []), meter: cs.el("span", {}, []), split: cs.el("span", {}, []) };
  cs.fillWrapGroup(g, wc);
  assert.deepEqual(g.children[0].children, [wc.autoLabel, wc.meter], "top: what the window is doing on its own");
  assert.deepEqual(g.children[1].children, [wc.split], "bottom: what you can do about it");
  assert.equal(g.children.length, 2, "and the stack is still two rows — not three loose children");
});

test("fillWrapGroup still works on a NON-stacked container, so an older host degrades rather than breaks", () => {
  const cs = CS();
  const flat = cs.grp([]);
  const wc = { autoLabel: cs.el("label", {}, []), meter: cs.el("span", {}, []), split: cs.el("span", {}, []) };
  cs.fillWrapGroup(flat, wc);
  assert.deepEqual(flat.children, [wc.autoLabel, wc.meter, wc.split], "flat, in the same order, rather than nothing");
});

test("no host paints the wrap controls into the group itself any more — one owner for where they land", () => {
  assert.ok(!/replaceChildren\(wc\.autoLabel/.test(app),
    "a host doing its own replaceChildren on the group is what flattened the stack; it must go through fillWrapGroup");
  assert.match(app, /window\.ChatShell\.fillWrapGroup\(wrap, wc\)/, "Pact must use the shared filler");
});

test("the CSS lays a stack out as a column that cannot itself wrap", () => {
  const m = /\.cs-shell \.cs-grp\.--stack \{([^}]*)\}/.exec(components);
  assert.ok(m, "the stack must have its own rule");
  assert.match(m[1], /flex-direction:\s*column/, "two rows means a column");
  assert.match(m[1], /flex-wrap:\s*nowrap/,
    "the two rows ARE the stack — letting them wrap puts the caption back beside its control at exactly the widths this fixes");
  assert.match(components, /\.cs-shell \.cs-grp\.--stack > \.cs-grow\.--gone \{ display: none/, "a retired row must cost no height");
  assert.match(components, /\.cs-shell \.cs-grp\.--stack\[data-align="end"\] > \.cs-grow \{ justify-content: flex-end/,
    "a right-hand stack packs BOTH rows right, or the shorter row floats away from the row's edge");
});

/* ================= stack only when the width actually needs it =================================
 *
 * "We should also allow, in case the width is big enough to fit everything into one row — as it is
 * now with the model selectors, effort, ultracode, bypass, a lot of place is free and another row is
 * used non-optimally."
 *
 * So the pairing is the RIGHT answer when the row is tight and the WRONG one when it is not. The
 * whole difficulty is deciding without flip-flopping: unstacking makes a row wider, which can make it
 * not fit, which restacks it, which makes it fit… The escape is to measure the CONTROLS, whose widths
 * are identical stacked or flat, rather than the containers, whose widths are a result of the current
 * choice. flatRowWidth is that measurement, and it is pure.
 */
test("flatRowWidth: what one flat line would need, gaps included", () => {
  const CS = CS_();
  // two groups: [100, 50] and [80] — items gapped inside a group, groups gapped between
  assert.equal(CS.flatRowWidth([{ items: [100, 50] }, { items: [80] }], 6), 100 + 6 + 50 + 6 + 80);
  assert.equal(CS.flatRowWidth([{ items: [100] }], 6), 100, "one group, one item: no gaps at all");
  assert.equal(CS.flatRowWidth([], 6), 0, "nothing needs nothing");
});

test("an EMPTY group contributes nothing — not even a gap", () => {
  const CS = CS_();
  // A pair whose members are all hidden (Core hides `fast`) must not reserve width it will not use.
  assert.equal(CS.flatRowWidth([{ items: [100] }, { items: [] }, { items: [80] }], 6), 100 + 6 + 80,
    "a retired group must not be charged a gap, or the row stacks earlier than it needs to");
});

test("THE OSCILLATION GUARD: the answer cannot depend on the current layout", () => {
  const CS = CS_();
  // The same controls, measured while stacked and while flat, are the same widths — that is the
  // property the whole mechanism rests on. Same input ⇒ same answer ⇒ no feedback loop.
  const groups = [{ items: [142, 138] }, { items: [116, 142] }, { items: [66] }, { items: [160, 150] }];
  const need = CS.flatRowWidth(groups, 6);
  for (let i = 0; i < 5; i++) assert.equal(CS.flatRowWidth(groups, 6), need, "the measurement must be stable");
  // And it is a strict comparison against the available width, so the two states are decided by one
  // number rather than by "did it wrap this time".
  assert.ok(need > 800 && need < 1100, `sanity: a real Core model row needs ~950px flat, got ${need}`);
});

test("fitStackedRow marks the ROW, so one class decides every pair in it", () => {
  const CS = CS_();
  const row = node("div");
  row.clientWidth = 2000;
  const g = CS.stack([CS.el("span", {}, [])], [CS.el("span", {}, [])]);
  row.appendChild(g);
  // The shim reports zero-width children, so anything fits: the row must come back flat.
  assert.equal(CS.fitStackedRow(row), true, "with room to spare the row goes flat");
  assert.ok(row.classList.contains("--flat"), "…and says so on the row itself");

  row.clientWidth = 0;   // no room at all
  assert.equal(CS.fitStackedRow(row), false, "a row with no measurable width must not claim to fit");
  assert.ok(!row.classList.contains("--flat"));
});

test("the CSS unstacks only inside a row that fits, and keeps each pair one group", () => {
  assert.match(components, /\.cs-shell \.frow\.--flat \.cs-grp\.--stack \{[^}]*flex-direction: row/,
    "the flat row must lay its pairs out inline");
  assert.match(components, /\.cs-shell \.frow\.--flat \.cs-grp\.--stack > \.cs-grow \{[^}]*flex: 0 0 auto/,
    "…with the pair's halves sitting side by side rather than stretching");
  assert.match(shellUi, /if \(CS\.fitStackedRow\(frame\.modelRow\) !== wasFlat\) _alignDirty = true;/,
    "a flip changes which groups share a line, so the alignment pass must re-run");
  assert.match(shellUi, /mw !== state\._modelRowW \|\| _alignDirty/,
    "it must re-evaluate on a WIDTH change too — a resize carries no state patch");
});
