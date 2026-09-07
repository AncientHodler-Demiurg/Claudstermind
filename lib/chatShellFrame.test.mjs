// node --test lib/chatShellFrame.test.mjs
//
// buildShellFrame is the Lab's actual header/core/footer assembly ORDER, extracted into chat-shell.js
// as one real function — parameterized by real data/content instead of the Lab's mock `S` object, so
// Core and Pact can both call it to build their real header+footer DOM. This is the piece that was
// still missing after 1.6.8: leaf widgets (stats row, gutter, wrap controls) were already shared;
// the page-construction ORDER around them was still three separate hand-written implementations.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const shellJs = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "chat-shell.js"), "utf8");

function makeNode(tag) {
  const n = {
    tagName: String(tag || "div").toUpperCase(), children: [], attrs: {}, style: {}, className: "",
    textContent: "", value: "", checked: false, disabled: false, title: "", parentNode: null,
    clientHeight: 600,
    classList: {
      add(...c) { c.forEach((x) => { if (x && !n.className.split(" ").includes(x)) n.className = (n.className + " " + x).trim(); }); },
      contains(c) { return n.className.split(" ").includes(c); },
    },
    setAttribute(k, v) { n.attrs[k] = String(v); },
    appendChild(c) { if (c && typeof c === "object") { c.parentNode = n; n.children.push(c); } return c; },
    replaceChildren(...k) { n.children.forEach((c) => { c.parentNode = null; }); n.children = []; k.forEach((c) => n.appendChild(c)); },
    addEventListener() {},
  };
  return n;
}
const textOf = (n) => (n.tagName === "#text" ? n.textContent : (n.children || []).map(textOf).join(""));

function loadChatShell() {
  const doc = {
    createElement: makeNode,
    createTextNode: (t) => ({ tagName: "#text", textContent: String(t), children: [] }),
  };
  const win = { document: doc };
  win.window = win;
  new Function("window", shellJs)(win);
  return win.ChatShell;
}

test("buildShellFrame exists and is exported on ChatShell", () => {
  const CS = loadChatShell();
  assert.equal(typeof CS.buildShellFrame, "function");
});

test("header contains row1 (identity content) then row2 (stats), matching the Lab's build() order", () => {
  const CS = loadChatShell();
  const idNode = CS.el("span", {}, ["identity"]);
  const frame = CS.buildShellFrame({
    identityContent: [idNode],
    statsData: { prompts: 10, responses: 10, bytes: 1, tokens: 1, ceiling: 100 },
  });
  assert.equal(frame.header.children.length, 2, "header must have exactly two rows");
  assert.equal(frame.header.children[0], frame.identityRow ?? frame.header.children[0]);
  assert.ok(textOf(frame.header.children[0]).includes("identity"), "row1 must carry the caller's identity content");
  assert.equal(frame.header.children[1], frame.statsRow, "row2 must be the returned statsRow");
  assert.ok(textOf(frame.statsRow).includes("turns"), "row2 must be real stats chips, not empty");
});

test("statsRow is built via the EXACT SAME buildStatsChips call a direct invocation would produce — no second implementation", () => {
  const CS = loadChatShell();
  const statsData = { prompts: 900, responses: 900, bytes: 5, tokens: 5, ceiling: 1000, compactCount: 2, wrapCount: 1 };
  const direct = CS.buildStatsChips(statsData);
  const frame = CS.buildShellFrame({ identityContent: [], statsData });
  assert.equal(frame.statsRow.children.length, direct.length, "same chip count as calling buildStatsChips directly");
  frame.statsRow.children.forEach((chip, i) => {
    assert.equal(textOf(chip), textOf(direct[i]), `chip ${i} text must match a direct buildStatsChips call exactly`);
  });
});

test("statsData omitted still creates an EMPTY row2 placeholder — production repaints a stable row on every paint (for performance on huge real transcripts) rather than rebuilding the whole shell the way the Lab's full-rebuild render() does", () => {
  const CS = loadChatShell();
  const frame = CS.buildShellFrame({ identityContent: [CS.el("span", {}, ["x"])] });
  assert.equal(frame.header.children.length, 2, "row2 must exist even with no data yet, so a caller can hold a stable reference to repaint into later");
  assert.equal(frame.statsRow.children.length, 0, "but it must be empty until real data is actually supplied");
});

test("statsRow: false omits row2 entirely — for a workspace kind that never shows one", () => {
  const CS = loadChatShell();
  const frame = CS.buildShellFrame({ identityContent: [], statsRow: false });
  assert.equal(frame.header.children.length, 1, "with statsRow explicitly false, only row1 should exist");
  assert.equal(frame.statsRow, null);
});

test("core is a real, empty mount point — buildShellFrame must never write into it", () => {
  const CS = loadChatShell();
  const frame = CS.buildShellFrame({ identityContent: [] });
  assert.equal(frame.core.children.length, 0, "core must be empty — production's own transcript renderer fills it");
});

test("existingCore: the caller's REAL, already-populated transcript container is reused by reference, not replaced by a fresh empty one", () => {
  // Found in review: buildShellFrame always allocated its own throwaway core node; production
  // callers built their real transcript container separately and never touched frame.core at all —
  // it was constructed and immediately discarded on every pane build. existingCore is the fix:
  // the caller's real node comes back out, same reference, with the shared class merged in.
  const CS = loadChatShell();
  const realTranscript = CS.el("div", { class: "ws-transcript" }, [CS.el("div", {}, ["a real turn already rendered here"])]);
  const frame = CS.buildShellFrame({ identityContent: [], existingCore: realTranscript, coreClass: "rg-core" });
  assert.equal(frame.core, realTranscript, "frame.core must be the EXACT SAME node the caller already had, not a new one");
  assert.equal(frame.core.children.length, 1, "existing real content must survive untouched — buildShellFrame must never clear it");
  assert.ok(frame.core.classList.contains("ws-transcript") && frame.core.classList.contains("rg-core"),
    "the shared class must be ADDED to the existing node, alongside its own class, not replacing it");
});

test("footer holds an action row then a model row, in that order, matching the Lab's mb assembly", () => {
  const CS = loadChatShell();
  const attachBtn = CS.el("button", {}, ["attach"]);
  const repoSel = CS.el("select", {}, ["repo"]);
  const frame = CS.buildShellFrame({
    identityContent: [],
    actionRowContent: [attachBtn],
    modelRowContent: [repoSel],
  });
  assert.equal(frame.footer.children.length, 2, "footer must have exactly action row then model row");
  assert.equal(frame.footer.children[0], frame.actionRow);
  assert.equal(frame.footer.children[1], frame.modelRow);
  assert.ok(textOf(frame.actionRow).includes("attach"));
  assert.ok(textOf(frame.modelRow).includes("repo"));
});

test("wrapControlsData appends the SAME buildWrapControls output to the end of the model row", () => {
  const CS = loadChatShell();
  const wrapControlsData = { tokens: 700000, ceiling: 1000000 };
  const direct = CS.buildWrapControls(wrapControlsData);
  const frame = CS.buildShellFrame({
    identityContent: [], modelRowContent: [CS.el("select", {}, [])], wrapControlsData,
  });
  const lastThree = frame.modelRow.children.slice(-3);
  assert.equal(textOf(lastThree[0]), textOf(direct.autoLabel), "the auto-wrap label must be appended first");
  assert.equal(textOf(lastThree[2]), textOf(direct.split), "the split control must be the model row's last child");
});

test("wrapControlsData: undefined omits the wrap controls entirely, not empty placeholders", () => {
  const CS = loadChatShell();
  const frame = CS.buildShellFrame({ identityContent: [], modelRowContent: [CS.el("span", {}, ["only"])] });
  assert.equal(frame.modelRow.children.length, 1, "with no wrapControlsData, the model row must hold only the caller's content");
});

test("caller class names apply additively to header/core/footer, matching production's 'add, don't rename' strategy", () => {
  const CS = loadChatShell();
  const frame = CS.buildShellFrame({
    identityContent: [], headerClass: "ws-pane-hd-outer rg-header", coreClass: "ws-transcript rg-core", footerClass: "ws-pane-ftr rg-footer",
  });
  assert.ok(frame.header.classList.contains("rg-header") && frame.header.classList.contains("ws-pane-hd-outer"));
  assert.ok(frame.core.classList.contains("rg-core") && frame.core.classList.contains("ws-transcript"));
  assert.ok(frame.footer.classList.contains("rg-footer") && frame.footer.classList.contains("ws-pane-ftr"));
});
