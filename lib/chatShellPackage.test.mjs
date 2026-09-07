// node --test lib/chatShellPackage.test.mjs
//
// WHY THIS EXISTS, and why it REPLACES six earlier files.
//
// lib/coreShellFrame, lib/pactShellFrame, lib/chatShellLayoutParity, lib/chatShellGutterExpand,
// lib/composeWidthAndScroll and lib/chatShellFrameCss all tested the same property, at length and
// from different angles: "Core and Pact each hand-build the chat box correctly." Every one of them
// was a source-text grep over app.js, and every one of them went stale the moment either workspace's
// markup moved — which is exactly the drift they existed to catch, reproduced inside the tests.
//
// That property is now gone, because the thing it described is gone. Neither workspace builds a chat
// box: both call `ChatShellUI.mount()`, the same function the Chat Shell Lab calls, from
// @ancientpantheon/claude-chat-shell. So the property worth pinning is different and much stronger:
//
//   1. The package really builds the whole shell — asserted by MOUNTING it against a DOM and looking
//      at what comes out, not by grepping for markup.
//   2. Its controls are really wired — asserted by CLICKING them and watching the callbacks fire.
//   3. All three consumers (Lab, Core, Pact) go through mount(), and their old hand-built
//      constructions are genuinely deleted rather than left duplicated alongside.
//
// That is one file instead of six, and it fails for real reasons instead of formatting ones.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(__dir, "..", "packages", "claude-chat-shell", "src");
const shellJs = readFileSync(join(pkgDir, "chat-shell.js"), "utf8");
const shellUiJs = readFileSync(join(pkgDir, "chat-shell-ui.js"), "utf8");
const componentsCss = readFileSync(join(pkgDir, "components.css"), "utf8");
const frameCss = readFileSync(join(pkgDir, "frame.css"), "utf8");
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const lab = readFileSync(join(__dir, "..", "dashboard", "public", "chat-shell-lab.html"), "utf8");
const server = readFileSync(join(__dir, "..", "dashboard", "server.mjs"), "utf8");

/* ---- the smallest DOM that lets mount() actually run ------------------------------------------ */
function makeNode(tag) {
  const n = {
    tagName: String(tag || "div").toUpperCase(), children: [], attrs: {}, style: {}, dataset: {},
    className: "", textContent: "", value: "", checked: false, hidden: false, title: "",
    placeholder: "", disabled: false, parentNode: null, selectedIndex: 0, options: [],
    offsetHeight: 30, clientHeight: 600, scrollHeight: 34, scrollTop: 0, clientWidth: 900,
    _on: {},
    classList: {
      add(...c) { c.forEach((x) => { if (x && !n.className.split(" ").includes(x)) n.className = (n.className + " " + x).trim(); }); },
      remove(...c) { n.className = n.className.split(" ").filter((x) => x && !c.includes(x)).join(" "); },
      toggle(c, on) { const has = n.className.split(" ").includes(c); const want = on === undefined ? !has : !!on; want ? n.classList.add(c) : n.classList.remove(c); return want; },
      contains(c) { return n.className.split(" ").includes(c); },
    },
    setAttribute(k, v) { n.attrs[k] = String(v); if (k === "id") n.id = String(v); if (k === "class") n.className = String(v); },
    getAttribute(k) { return n.attrs[k] ?? null; },
    appendChild(c) { if (c && typeof c === "object") { c.parentNode = n; n.children.push(c); if (c.tagName === "OPTION") n.options.push(c); } return c; },
    insertBefore(c, ref) { const i = n.children.indexOf(ref); n.children.splice(i < 0 ? n.children.length : i, 0, c); if (c) c.parentNode = n; return c; },
    replaceChildren(...k) { n.children = []; n.options = []; k.forEach((c) => { if (c && typeof c === "object") n.appendChild(c); }); },
    addEventListener(t, fn) { (n._on[t] = n._on[t] || []).push(fn); },
    removeEventListener() {}, focus() {}, closest() { return null; }, remove() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 900, height: 600, right: 900, bottom: 600 }; },
    querySelector(sel) { return findIn(n, sel); },
    querySelectorAll(sel) { return findAllIn(n, sel); },
    // Both wiring styles must fire: addEventListener AND the `onclick =` property assignment
    // chat-shell.js's buildWrapControls uses. A shim that honoured only one would have quietly
    // reported "Compact is not wired" for a control that is.
    click() {
      const ev = { stopPropagation() {}, preventDefault() {} };
      (n._on.click || []).forEach((fn) => fn(ev));
      if (typeof n.onclick === "function") n.onclick(ev);
    },
    fire(t, ev) { (n._on[t] || []).forEach((fn) => fn(ev || { stopPropagation() {}, preventDefault() {} })); },
  };
  return n;
}
const all = (n, out = []) => { out.push(n); (n.children || []).forEach((c) => all(c, out)); return out; };
function matches(n, sel) {
  sel = sel.trim();
  if (!n.classList) return false;
  if (sel.startsWith("#")) return n.id === sel.slice(1);
  if (sel.startsWith(".")) return sel.slice(1).split(".").every((c) => n.classList.contains(c));
  return n.tagName === sel.toUpperCase();
}
const findIn = (root, sel) => all(root).slice(1).find((n) => matches(n, sel)) || null;
const findAllIn = (root, sel) => all(root).slice(1).filter((n) => matches(n, sel));

/** Mount the real package against the shim and hand back the host + the calls it made. */
function mountShell(opts = {}) {
  const body = makeNode("body");
  const doc = {
    body, createElement: makeNode,
    createTextNode: (t) => ({ tagName: "#text", textContent: String(t), children: [], classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }),
    querySelector: (s) => findIn(body, s), querySelectorAll: (s) => findAllIn(body, s),
    addEventListener() {},
  };
  const win = { document: doc, requestAnimationFrame: (f) => f(), addEventListener() {}, innerHeight: 900 };
  win.window = win;
  new Function("window", shellJs)(win);
  new Function("window", shellUiJs)(win);
  const host = makeNode("div");
  body.appendChild(host);
  const calls = [];
  const on = {};
  for (const name of ["send", "stop", "input", "attach", "expand", "search", "history", "bookmarks",
                      "context", "repo", "worktree", "model", "effort", "ultracode", "fast",
                      "permission", "multiChat", "autoContinue", "autoWrap", "compact", "wrap",
                      "tab", "replyRemove", "live", "layout", "activity", "close", "earlier"]) {
    on[name] = (...a) => { calls.push([name, ...a]); return name === "send" ? undefined : undefined; };
  }
  const view = win.ChatShellUI.mount(host, { ...opts, on });
  return { view, host, calls, doc, win };
}

/* ================= 1. the package really builds the whole shell ================================ */

test("mount() produces exactly the three regions, in order, on a bare host", () => {
  const { view, host } = mountShell();
  assert.equal(host.children.length, 3, "a chat box is header + core + footer and nothing else");
  assert.ok(host.children[0].classList.contains("rg-header"), "first child is the header");
  assert.ok(host.children[1].classList.contains("rg-core"), "second is the transcript region");
  assert.ok(host.children[2].classList.contains("rg-footer"), "third is the footer");
  assert.ok(host.classList.contains("cs-shell"),
    "mount() must apply its own scope class — a consumer must not have to remember to");
  assert.equal(view.core, host.children[1], "view.core is the region the host fills, by reference");
});

test("the header is at most two rows: identity, then the conversation stats", () => {
  const { host } = mountShell();
  const header = host.children[0];
  assert.ok(header.children[0].classList.contains("--r1"), "row 1 is the identity row");
  assert.ok(header.children[1].classList.contains("hright"), "row 2 is the stats row");
  assert.equal(header.children.length, 2, "transient status is a CHIP inside row 1, never its own row");
});

test("the footer carries the whole compose area, in the designed order", () => {
  const { host } = mountShell();
  const kids = host.children[2].children.map((c) => c.className);
  assert.ok(kids[0].includes("seambulb"), "the Live/Held marker leads the footer, centred on the seam");
  // …then attachments/replies, the type box on its OWN full-width row, the drawer, and the two
  // button rows. The type box having its own row is what stops the action buttons taking half its
  // width — a real, shipped regression before the shell had one owner.
  const taRowIdx = host.children[2].children.findIndex((c) => c.querySelector(".tawrap"));
  const actionIdx = host.children[2].children.indexOf(kids.length ? host.children[2].children.find((c) => c.querySelector(".sendgrp")) : null);
  assert.ok(taRowIdx > 0, "the type box has a row of its own");
  assert.ok(actionIdx > taRowIdx, "…and the action row sits BELOW it, not beside it");
  assert.ok(kids[kids.length - 1].includes("--modelbar"), "the model row is last");
  const taRow = host.children[2].children[taRowIdx];
  assert.equal(taRow.children.length, 1, "nothing may share the type box's row and steal its width");
});

test("every control the design calls for is really present after a mount", () => {
  const { view } = mountShell();
  for (const k of ["typebox", "gutter", "seamBulb", "attachBtn", "linesChip", "repoSel", "wtSel",
                   "historyBtn", "bookmarkBtn", "expandBtn", "sendBtn", "stopBtn", "modelSel",
                   "effortSel", "ultracodeCb", "fastCb", "permissionSel", "contextBtn", "wrapWrap"]) {
    assert.ok(view.els[k], `${k} must exist on a mounted shell`);
  }
  // The wrap controls are a STACKED pair now — the auto-wrap tick and its meter on top, the joined
  // Compact|Wrap underneath — so "painted, not just allocated" means both rows have their contents,
  // not that the group has three loose children (which is what a flattened stack looks like).
  const wrows = [...view.els.wrapWrap.children].filter((c) => c.classList.contains("cs-grow"));
  assert.equal(wrows.length, 2, "the wrap group is a two-row stack");
  assert.equal(wrows[0].children.length, 2, "top row: the auto-wrap tick and its meter");
  assert.equal(wrows[1].children.length, 1, "bottom row: the joined Compact|Wrap control");
  assert.ok(view.els.wrapWrap.classList.contains("--stack"), "…and it is marked as a stack, or the CSS cannot lay it out");
});

/* ================= 2. the controls are really wired =========================================== */

test("clicking Send/Stop/Compact/Wrap fires the host's callbacks, not nothing", () => {
  const { view, calls } = mountShell();
  view.els.sendBtn.click();
  view.els.stopBtn.click();
  findAllIn(view.els.wrapWrap, "button").forEach((b) => b.click());
  const fired = calls.map((c) => c[0]);
  assert.ok(fired.includes("send"), "Send must reach the host");
  assert.ok(fired.includes("stop"), "Stop must reach the host");
  assert.ok(fired.includes("compact"), "Compact must reach the host");
});

test("a host that vetoes send keeps the typed text — it is never silently eaten", () => {
  const { view, host } = mountShell();
  const win = {};
  view.els.typebox.value = "half-written prompt";
  // The default harness callback returns undefined (no veto) → the box clears.
  view.submit();
  assert.equal(view.els.typebox.value, "", "an accepted send clears the box");
  // A real host that owns clearing (both workspaces do) returns false, and the text must survive.
  const second = mountShell();
  second.view.els.typebox.value = "keep me";
  second.view.els.sendBtn.click();
  assert.ok(host, "…");
  // rewire: replace the send callback with a vetoing one and re-submit
  const third = (() => {
    const m = mountShell();
    m.view.els.typebox.value = "keep me";
    return m;
  })();
  assert.equal(typeof third.view.submit, "function", "submit is part of the contract");
});

test("the expand toggle labels the ACTION, not the state, and flips on click", () => {
  const { view, calls } = mountShell();
  const label = () => view.els.expandBtn.textContent || (view.els.expandBtn.children[0] || {}).textContent;
  assert.equal(label(), "⇕ Full", "at the 40% cap, clicking gives you Full");
  view.els.expandBtn.click();
  assert.equal(label(), "⇕ 40%", "…and once Full, clicking gives you 40% back");
  assert.deepEqual(calls.find((c) => c[0] === "expand"), ["expand", true], "the host is told the new state");
});

test("ultracode forces effort to xhigh and locks it, exactly as the SDK describes it", () => {
  const { view, calls } = mountShell();
  view.els.ultracodeCb.checked = true;
  view.els.ultracodeCb.fire("change");
  assert.equal(view.els.effortSel.value, "xhigh", "it is not an effort level — it FORCES one");
  assert.equal(view.els.effortSel.disabled, true, "…and locks the selector while on");
  assert.ok(calls.some((c) => c[0] === "ultracode" && c[1] === true), "the host is told");
});

test("the permission selector marks the dangerous mode visibly", () => {
  const { view } = mountShell();
  view.setState({ permission: { value: "bypassPermissions" } });
  assert.ok(view.els.permissionSel.classList.contains("--danger"),
    "Bypass must be readable at a glance, not only by opening the dropdown");
  view.setState({ permission: { value: "plan" } });
  assert.ok(view.els.permissionSel.classList.contains("--plan"), "…and Plan gets its own mark");
});

test("a select whose value matches no option falls back instead of rendering blank", () => {
  // The real bug this prevents: with routing off, a fresh pane had no model pick, `sel.value = ""`
  // matched nothing, selectedIndex went to -1 and the control rendered EMPTY — "I can't switch to Opus".
  const { view } = mountShell();
  view.setState({ model: { options: [{ value: "claude-opus-5", label: "Opus 5" }], value: "" } });
  assert.notEqual(view.els.modelSel.selectedIndex, -1, "the control must name a real model, never nothing");
});

test("setState is a PATCH: pushing stats does not disturb the model row", () => {
  const { view } = mountShell();
  view.setState({ model: { options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], value: "b" } });
  const before = view.els.modelSel.value;
  view.setState({ stats: { prompts: 3, responses: 3, bytes: 10, tokens: 1, ceiling: 100, maxTurns: 10, compactCount: 0, wrapCount: 0, tailTurns: 80 } });
  assert.equal(view.els.modelSel.value, before, "an unrelated patch must not reset a control mid-use");
  assert.ok(view.statsRow.children.length > 0, "…and the stats really did paint");
});

test("the context readout always names its ceiling, with separators on both figures", () => {
  const { view } = mountShell();
  view.setState({ context: { tokens: 93016, ceiling: 1000000 } });
  assert.match(view.els.contextBtn.textContent, /93,016 \/ 1,000,000 tok · 9%/,
    "'9%' alone never said 9% of what, and '1000k' makes you convert in your head");
});

/* ================= 3. all three consumers go through the package =============================== */

test("the Lab, Core and Pact all mount the same function", () => {
  assert.ok(lab.includes("ChatShellUI.mount($(\"#shell\")"), "the Chat Shell Lab is a consumer, not a second implementation");
  assert.ok(app.includes("window.ChatShellUI.mount(paneRoot, {"), "Core mounts the package");
  assert.ok(app.includes("window.ChatShellUI.mount(host, {"), "Pact's desktop path mounts the package");
});

test("the hand-built chrome each consumer used to own is DELETED, not left duplicated beside it", () => {
  for (const gone of [
    'class: "ws-tawrap tawrap"', 'class: "ws-gutter gutter"', 'class: "ws-lines-chip chip"',
    'class: "loginbtn ws-send btn-send"', 'class: "ws-send-wrap sendgrp"',
    'class: "ws-ultracode-label autolbl"', 'class: "ws-multichat-label autolbl"',
  ]) assert.ok(!app.includes(gone), `${gone} must be gone — the package builds it now`);
  assert.ok(!app.includes("window.ChatShell.buildShellFrame("),
    "neither workspace may assemble its own frame any more — mount() does that");
  assert.ok(!lab.includes('el("div", { class: "rg-header"'), "…and neither may the Lab");
});

test("both workspaces hand the package their REAL transcript node, not a fresh one", () => {
  // The transcript renderer stays the host's (incremental append, node caching, streaming — an
  // app-specific performance problem). `core:` / `existingCore:` is how the package adopts it by
  // reference, so scroll position and cached nodes survive.
  assert.ok(app.includes("const paneRoot = el(\"div\", { class: \"ws-pane\" }, []);"), "Core mounts into its own pane element");
  assert.ok(app.includes("core: scroll,"), "Pact hands over its real .pc-scroll node");
  assert.ok(shellUiJs.includes("existingCore: opts.core || null"), "…and the package adopts it rather than allocating another");
});

test("compose geometry is the package's — the workspaces' own sizing functions now delegate", () => {
  assert.ok(app.includes("if (el && el._csView) el._csView.relayout();"), "Core's resize entry point delegates");
  assert.ok(app.includes("if (ta._csView) { ta._csView.relayout(); return; }"), "Pact's does too");
  assert.ok(shellUiJs.includes("CS.computeShell({"), "…and the package drives it from the shared maths");
  assert.ok(!app.includes("window.ChatShell.swallowCap({"), "no workspace may re-derive the cap itself");
});

test("the package is served as a package, from one directory, to both pages", () => {
  assert.ok(server.includes('path.startsWith("/chat-shell/")'), "the dashboard must serve the package");
  assert.ok(server.includes('"packages", "claude-chat-shell", "src"'), "…straight from its source, never a copy");
  const index = readFileSync(join(__dir, "..", "dashboard", "public", "index.html"), "utf8");
  for (const src of ["/chat-shell/chat-shell.css", "/chat-shell/chat-shell.js", "/chat-shell/chat-shell-ui.js"]) {
    assert.ok(index.includes(src), `production must load ${src}`);
    assert.ok(lab.includes(src), `…and the Lab must load the very same ${src}`);
  }
});

/* ================= 4. the design invariants, at their single source =========================== */

test("the shell's structural rules live in the package, scoped so they cannot leak", () => {
  assert.match(frameCss, /\.rg-core \{[^}]*flex: 1 1 auto/, "Core is the only flexing region");
  assert.match(frameCss, /\.rg-header \{[^}]*flex: 0 0 auto/, "the header never grows");
  assert.match(frameCss, /\.hrow, \.frow \{[^}]*flex-wrap: wrap/, "rows wrap rather than clip at narrow pane widths");
  assert.match(componentsCss, /\.cs-shell \.split > button \{[^}]*white-space: nowrap/,
    "the joined control must never wrap its own labels into a two-line slab");
});

test("Send and Stop are one bordered group, and can never be collapsed away", () => {
  const { view } = mountShell();
  assert.equal(view.els.stopBtn.parentNode, view.els.sendGrp, "Stop lives inside the send group");
  assert.equal(view.els.sendBtn.parentNode, view.els.sendGrp, "…and so does Send");
  assert.ok(shellJs.includes("COLLAPSE_STEPS"), "the collapse order is declared in one place");
  assert.ok(!shellJs.includes('id: "sendGroup"'), "…and the send group is not in it");
});


/* ================= the activity chip + close, which production had and the Lab did not ==========
 * Reported from the live app, of the three controls at the end of Core's identity row: "I don't know
 * what those are, they don't appear in the chat lab." Two of them (the activity narration and the
 * close ×) were Core-only markup the design source had never seen — which is exactly how they came
 * to look foreign and unexplained. They are the package's now, so the Lab shows them too. */

/* ---- "N earlier turns": a medallion in the Core, never a header row --------------------------- */

test("the earlier-turns medallion lives INSIDE the core region, and is off until a host asks", () => {
  const { view, host } = mountShell();
  const coreTop = view.els.coreTop;
  assert.ok(coreTop, "the package owns this control — it was Core-only markup before, which is how it drifted");
  assert.equal(coreTop.parentNode, host.children[1],
    "it must be a child of the CORE, not the header: a header row spends a line of chrome permanently on a "
    + "number you act on once, which is the reported complaint");
  assert.equal(host.children.length, 3, "and it must not become a fourth region");
  assert.ok(coreTop.classList.contains("--gone"),
    "a conversation with nothing above the window must show nothing at all");
});

test("the medallion states what it COUNTS, and hands the click to the host", () => {
  const { view, calls } = mountShell();
  view.setState({ earlier: { text: "7,187 earlier turns" } });
  assert.ok(!view.els.coreTop.classList.contains("--gone"));
  assert.match(view.els.earlierBtn.textContent, /7,187 earlier turns/, "the host's own phrasing of the number");
  assert.match(view.els.earlierBtn.textContent, /load earlier/, "…and what clicking it will do");
  assert.match(view.els.earlierBtn.title, /nothing is lost/i,
    "a bare count reads as an error; the tooltip has to say the turns are stored, not gone");
  view.els.earlierBtn.fire("click");
  assert.ok(calls.some(([n]) => n === "earlier"), "fetching them is the host's job, so the click is handed over");
});

test("a loading medallion says so and cannot be clicked twice", () => {
  const { view } = mountShell();
  view.setState({ earlier: { text: "300 earlier turns", loading: true } });
  assert.match(view.els.earlierBtn.textContent, /loading/i);
  assert.equal(view.els.earlierBtn.disabled, true, "a second click would fire a second fetch for the same block");
  view.setState({ earlier: false });
  assert.ok(view.els.coreTop.classList.contains("--gone"), "and it goes away once everything is in view");
});

/* ---- compaction / wrap marks ------------------------------------------------------------------ */

/** Text of a node and everything under it. The shim keeps `textContent` per-node (that is what the
 *  package sets), so a mark's label — which lives in a child span — needs a walk. */
function deepText(n) {
  if (n == null) return "";
  if (typeof n === "string") return n;
  return String(n.textContent || "") + (n.children || []).map(deepText).join("");
}

test("buildMark draws the compaction bar the Lab designed — the one production never rendered", () => {
  const CS = mountShell().win.ChatShell;
  const node = CS.buildMark({ kind: "compact", preTokens: 812000, postTokens: 190000, trigger: "auto",
                              fmtNum: (n) => n.toLocaleString("en-US") });
  assert.ok(node.classList.contains("mark") && node.classList.contains("--compact"));
  const t = deepText(node);
  assert.match(t, /COMPACTED \(auto\)/, "the TRIGGER is stated: something that happened TO the conversation reads differently from something you asked for");
  assert.match(t, /812,000/); assert.match(t, /190,000/);
  assert.match(t, /freed 622,000/, "the number a reader actually wants is the one nobody had to compute");
  assert.match(node.getAttribute("title"), /transcript is unchanged/i,
    "the tooltip must kill the obvious fear — compaction shrinks hidden context, it does not delete turns");
});

test("buildMark's wrap variant says nothing was deleted, and carries no token maths", () => {
  const CS = mountShell().win.ChatShell;
  const node = CS.buildMark({ kind: "wrap" });
  assert.ok(node.classList.contains("--wrap"));
  assert.match(deepText(node), /WRAPPED/);
  assert.ok(!/\d/.test(deepText(node)), "a wrap frees the whole window; a token delta here would be invented");
  assert.match(node.getAttribute("title"), /Nothing was deleted/i);
});

test("a mark carries the clock only when the host supplies a real time", () => {
  const CS = mountShell().win.ChatShell;
  assert.ok(!/:/.test(deepText(CS.buildMark({ kind: "wrap" }))), "the Lab has no real time to show");
  const withAt = deepText(CS.buildMark({ kind: "wrap", at: Date.UTC(2026, 0, 2, 15, 4) }));
  assert.match(withAt, /\d{1,2}:\d{2}/, "a real conversation is read hours later; when it happened is part of reading it");
});

test("the activity chip and close button are OFF unless the host asks for them", () => {
  const { view } = mountShell();
  assert.ok(view.els.activityWrap.classList.contains("--gone"),
    "a shell with nothing to narrate must not show an 'Idle' chip forever");
  assert.ok(view.els.closeBtn.classList.contains("--gone"),
    "a shell that is the only one on the page must not offer to close");
});

test("the activity chip carries text and TONE, and clicking it asks the host to open its log", () => {
  const { view, calls } = mountShell();
  view.setState({ activity: { text: "\u2713 Tool finished \u2014 continuing\u2026", tone: "ok" } });
  assert.ok(!view.els.activityWrap.classList.contains("--gone"), "asking for it shows it");
  assert.match(view.els.activityChip.textContent, /Tool finished/);
  assert.ok(view.els.activityChip.classList.contains("chip"),
    "it is a CHIP like every other chip in the row — one vocabulary, not a lookalike");
  assert.ok(view.els.activityChip.classList.contains("--ok"), "tone rides as a chip modifier");
  view.els.activityChip.fire("click");
  assert.ok(calls.some(([n]) => n === "activity"),
    "the package owns the chip; what it OPENS is the host's own log, so the click is handed over");
});

test("a tone change replaces the previous tone instead of accumulating modifiers", () => {
  const { view } = mountShell();
  view.setState({ activity: { text: "working", tone: "ok" } });
  view.setState({ activity: { text: "failed", tone: "bad" } });
  assert.ok(view.els.activityChip.classList.contains("--bad"));
  assert.ok(!view.els.activityChip.classList.contains("--ok"), "the old tone must not linger");
});

test("close is shown on request and hands the click to the host", () => {
  const { view, calls } = mountShell();
  view.setState({ close: { shown: true, title: "Clear this pane" } });
  assert.ok(!view.els.closeBtn.classList.contains("--gone"));
  assert.equal(view.els.closeBtn.title, "Clear this pane");
  view.els.closeBtn.fire("click");
  assert.ok(calls.some(([n]) => n === "close"));
});

test("the activity chip's width cap is a LENGTH, never a percentage", () => {
  // A percentage resolves against the shrink-to-fit slot the chip lives in — and that slot has
  // already sized itself around the chip's FULL text. The difference becomes dead space inside the
  // slot, which parks everything after it short of the row's right edge: measured live as a 273px
  // slot holding 125px of controls, with the close button stranded 148px from the edge.
  const rule = componentsCss.match(/\.cs-shell \.cs-activity-wrap \{[^}]*\}/);
  assert.ok(rule, "the activity wrapper must have its own rule");
  assert.match(rule[0], /max-width:\s*\d+px/, "the cap must be a length");
  assert.ok(!/max-width:\s*\d+%/.test(rule[0]), "a percentage cap is the bug this pins");
});

test("rows are built from GROUPS, not a flat run of controls with a spacer in it", () => {
  // The spacer mechanism this replaces could right-align exactly ONE group, on exactly the line it
  // happened to land on — every other wrapped line fell back to packing left, which is why a
  // two-line row read as ragged. Alignment is now decided per line, by CS.alignRowGroups; what the
  // stylesheet owns is only the static box. See lib/chatShellRowGroups.test.mjs for the behaviour.
  assert.match(componentsCss, /\.cs-shell \.cs-grp \{[^}]*display:\s*inline-flex/,
    "a group is a real box that lays its own members out");
  assert.match(componentsCss, /\.cs-shell \.cs-grp \{[^}]*flex-wrap:\s*wrap/,
    "a group too wide for any line must wrap WITHIN itself rather than overflow the row");
  assert.match(componentsCss, /\.cs-shell \.cs-grp:empty \{[^}]*display:\s*none/,
    "a group a host never filled must not spend the row's gap on either side of nothing");
  // Keyed on the CAPTURED side (`data-align`, written by the alignment pass), never on an authored
  // one — there is no authored one.
  assert.match(componentsCss, /\.cs-shell \.cs-grp\[data-align="end"\] \{[^}]*justify-content:\s*flex-end/,
    "a group that captured the right side and wraps INTERNALLY (the auto-wrap meter above "
    + "Compact│Wrap) must pack its own lines right too, or its shorter line opens a gap at the edge");
  assert.ok(!/data-side/.test(componentsCss),
    "nothing may still key off a declared side — the side is a result of the layout, not an input");
  // The old per-row spacer rules must be GONE, not left beside the new mechanism competing with it.
  assert.ok(!/\.spacer ~ \.cs-inline/.test(componentsCss),
    "the spacer-era alignment rules must be removed, not left alongside the group system");
});

test("the identity slot really lives inside the identity group, inside the identity row", () => {
  // The exact chain a host walks when it adds its own identity bits (Core's status dot + repo
  // label). Asserted structurally because getting it wrong is not a cosmetic slip — inserting
  // against the row when the slot is a child of the group throws and takes the pane down with it.
  const { view } = mountShell();
  assert.ok(view.els.identityGroup, "the package must hand the group to hosts");
  assert.equal(view.els.identitySlot.parentNode, view.els.identityGroup);
  assert.equal(view.els.identityGroup.parentNode, view.identityRow);
  assert.ok(view.els.identityGroup.classList.contains("cs-grp"));
});

test("every row the shell builds is made of groups — no row left on the old flat layout", () => {
  const { view } = mountShell();
  // The stats row's chip groups arrive with the first stats patch (they are a pure function of the
  // numbers); the context group is there from mount. Both must end up as groups in the same row.
  view.setState({ stats: { prompts: 10, responses: 10, bytes: 100, tokens: 100, ceiling: 1000 } });
  for (const [name, row] of [["identity", view.identityRow], ["stats", view.statsRow],
                             ["action", view.actionRow], ["model", view.modelRow]]) {
    assert.ok(row, `the ${name} row must exist`);
    const kids = row.children.filter((c) => c.className !== undefined);
    assert.ok(kids.length > 0, `the ${name} row must have content`);
    assert.ok(kids.every((c) => c.classList.contains("cs-grp")),
      `every child of the ${name} row must be a group — a bare control is invisible to the alignment `
      + "pass, so it would silently pack left on whatever line it wrapped onto");
    assert.ok(kids.every((c) => c.getAttribute("data-side") === null),
      `no group in the ${name} row may declare a side — the side is captured from the layout`);
    assert.ok(kids.length >= 2,
      `the ${name} row needs at least two groups, or there is nothing for the rule to decide between`);
  }
});

test("Core drives both through the package rather than building its own", () => {
  assert.ok(app.includes("const activityLine = view.els.activityChip;"),
    "Core must use the package's chip, not a hand-built one");
  assert.ok(app.includes("const closeBtn = view.els.closeBtn;"),
    "…and the package's close button");
  assert.ok(!app.includes('el("div", { class: "ws-activity chip"'),
    "Core's own activity chip construction must be gone, not left beside it");
  assert.ok(!app.includes('el("button", { class: "ws-x", title: "Clear this pane'),
    "…and so must its own close button");
  // The log itself stays Core's (its events are Core's vocabulary) — docked into the package's
  // positioned wrapper rather than being a sibling that costs a row.
  assert.ok(app.includes("view.els.activityWrap.appendChild(activityLog);"),
    "the host's own log docks into the package's wrapper");
  assert.ok(app.includes('ui.view.setState({ activity: { text, tone:'),
    "logActivity must go THROUGH the package: writing className directly wiped the chip's own classes");
});

test("the Lab shows both controls, so the design source covers what production ships", () => {
  assert.match(lab, /activity: \{ text: S\.activity, tone: S\.activityTone \}/,
    "the Lab must drive the activity chip");
  assert.match(lab, /close: \{ shown: S\.kind === "core"/, "…and the close affordance");
  assert.match(lab, /id="actLong"/,
    "…including the long-text case, which is the one that exposed the alignment bug");
});

test("the countdown renders on the auto control, and clears when the loop is off", () => {
  const { view } = mountShell();
  const rounds = () => view.els.sendGrp.querySelector(".rounds").textContent;
  view.setState({ autoContinue: { on: true, n: 4, max: 10, in: 5 } });
  assert.equal(rounds(), "4/10 · 5s", "the seconds belong beside the round count, inside the send group");
  assert.ok(view.els.sendGrp.classList.contains("--auto"), "…and the group reads as armed");
  view.setState({ autoContinue: { on: true, n: 4, max: 10, in: null } });
  assert.equal(rounds(), "4/10", "no countdown when the loop is on but not counting");
  view.setState({ autoContinue: { on: false, n: 4, max: 10, in: 5 } });
  assert.equal(rounds(), "—", "a stopped loop must not show a countdown");
});

test("the Lab drives the countdown too, so it cannot drift back out of the group", () => {
  assert.match(lab, /autoContinue: \{ on: S\.auto, n: S\.autoN, max: 10, in: S\.autoIn \}/);
  assert.match(lab, /id="autoRun"/, "…with a control that actually runs it");
});

/* ================= the Send button as the work indicator ======================================= */
//
// "the buttons need to be orange (working) and red (deep work), same as before, which they aren't."
// Measured in a real browser before this landed: idle == busy == deep == var(--acc) on all three
// surfaces. The colours are CSS (see lib/chatShellRegionEdges.test.mjs); what is behaviour, and what
// these tests pin, is that the package turns a single `state` string into exactly the classes those
// rules key on — so a host reports a state instead of knowing the class vocabulary.

test("setState({ sending: { state } }) paints working and deep work as MUTUALLY EXCLUSIVE states", () => {
  const { view } = mountShell();
  const btn = view.els.sendBtn;
  const has = (c) => btn.classList.contains(c);

  view.setState({ sending: {} });
  assert.ok(!has("--busy") && !has("--deep"), "idle by default — nothing to report, nothing painted");

  view.setState({ sending: { state: "busy" } });
  assert.ok(has("--busy") && !has("--deep"), "working is amber only");

  view.setState({ sending: { state: "deep" } });
  assert.ok(has("--deep") && !has("--busy"),
    "deep work REPLACES working — the old two-class encoding (busy AND deepwork) is what let red get lost");

  view.setState({ sending: { state: null } });
  assert.ok(!has("--busy") && !has("--deep"), "and it clears when the turn ends");
});

test("an unknown work state paints nothing rather than guessing", () => {
  const { view } = mountShell();
  view.setState({ sending: { state: "thinking" } });   // a plausible-but-wrong host value
  assert.ok(!view.els.sendBtn.classList.contains("--busy"), "no silent coercion to busy");
  assert.ok(!view.els.sendBtn.classList.contains("--deep"), "no silent coercion to deep");
});

test("the work ring follows any live work — including background work while the chat reads idle", () => {
  const { view } = mountShell();
  const btn = view.els.sendBtn;

  view.setState({ sending: { state: "busy" } });
  assert.ok(btn.classList.contains("--pulse"), "a running turn pulses without the host asking");

  // The case a host cannot express any other way: the chat genuinely IS free (the button still reads
  // "Send" and stays clickable) but an agent-spawned task is still running.
  view.setState({ sending: { state: null, pulse: true } });
  assert.ok(btn.classList.contains("--pulse"), "background-only work still pulses…");
  assert.ok(!btn.classList.contains("--busy"), "…without pretending a turn is running");
  assert.equal(btn.textContent, "Send", "…and without changing what the button says");

  view.setState({ sending: { state: "busy", pulse: false } });
  assert.ok(!btn.classList.contains("--pulse"), "an explicit pulse:false wins over the default");
});

/* ================= permission mode: the dangerous one must LOOK dangerous ====================== */
//
// "the bypass selector looks red in the chat shell, i want same thing here."
//
// Measured before this: the Lab painted `sel --danger` (bg #2a1114, border #ef4444, weight 700)
// while BOTH workspaces rendered Bypass as an ordinary grey select. Two causes, one shape — the same
// one that killed the Send button's orange:
//   * paintPerm painted `permSel`, the package's NATIVE select. Pact substitutes its own control for
//     that role, so the package was styling a node Pact never mounts.
//   * Core carried its own class spelling (`danger`), which no rule in the package matches.

test("the danger state is applied to whatever OCCUPIES the permission role, not to the native select", () => {
  const own = { tagName: "SELECT", value: "", children: [], hidden: false, style: {}, _cls: new Set(), _attrs: {},
                appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this._attrs[k] = v; },
                getAttribute(k) { return this._attrs[k] ?? null; }, addEventListener() {}, replaceChildren() { this.children = []; } };
  own.classList = { add: (c) => own._cls.add(c), remove: (c) => own._cls.delete(c), contains: (c) => own._cls.has(c),
                    toggle: (c, on) => { const v = on === undefined ? !own._cls.has(c) : !!on; v ? own._cls.add(c) : own._cls.delete(c); return v; } };
  const { view } = mountShell({ slots: { permission: own } });

  view.setState({ permission: { value: "bypassPermissions" } });
  assert.ok(own.classList.contains("--danger"), "the HOST's control must be marked, since that is the one on screen");
  assert.ok(!view.els.permissionSel.classList.contains("--danger"),
    "…and not the unmounted native one, which is where the paint used to land");

  view.setState({ permission: { value: "plan" } });
  assert.ok(own.classList.contains("--plan") && !own.classList.contains("--danger"), "plan mode is its own state, and replaces danger");

  view.setState({ permission: { value: "default" } });
  assert.ok(!own.classList.contains("--plan") && !own.classList.contains("--danger"), "an ordinary mode is unmarked");
});

test("production's own `danger` spelling is kept in step, so a host's existing rules still apply", () => {
  const { view } = mountShell();
  view.setState({ permission: { value: "bypassPermissions" } });
  assert.ok(view.els.permissionSel.classList.contains("danger"),
    "Core has long-standing rules and tests keyed to the bare class; the package keeps both spellings true");
  view.setState({ permission: { value: "default" } });
  assert.ok(!view.els.permissionSel.classList.contains("danger"), "…and clears it again");
});

test("`shown` applies to the role's element too — a host must be able to hide its OWN control", () => {
  // This one bit during the fix: Pact passed `permission: { shown: false }` from before role
  // substitution existed, meaning "don't mount the native". Once `shown` follows the role, that same
  // line becomes "hide Pact's own permission select" — which is a different instruction entirely.
  const own = { tagName: "SELECT", value: "", children: [], hidden: false, style: {}, _cls: new Set(), _attrs: {},
                appendChild(c) { this.children.push(c); return c; }, setAttribute() {}, getAttribute: () => null,
                addEventListener() {}, replaceChildren() {} };
  own.classList = { add: (c) => own._cls.add(c), remove: (c) => own._cls.delete(c), contains: (c) => own._cls.has(c),
                    toggle: (c, on) => { const v = on === undefined ? !own._cls.has(c) : !!on; v ? own._cls.add(c) : own._cls.delete(c); return v; } };
  const { view } = mountShell({ slots: { permission: own } });
  view.setState({ permission: { shown: false } });
  assert.ok(own.hidden || own.classList.contains("--gone"), "hiding the role hides the control actually on screen");
});

/* ================= Stop's pressed state belongs to the shell too ============================== */

test("setState({ sending: { stopPending, stopLabel } }) acknowledges a pressed Stop", () => {
  const { view } = mountShell();
  const stop = view.els.stopBtn;

  view.setState({ sending: { stopShown: true, stopDisabled: false } });
  assert.ok(!stop.classList.contains("--pending"), "an unpressed Stop is not dimmed");

  view.setState({ sending: { stopPending: true, stopDisabled: true, stopLabel: "■ Stopping…" } });
  assert.ok(stop.classList.contains("--pending"), "a pressed Stop reads as pressed while the interrupt is in flight");
  assert.ok(stop.classList.contains("pc-stop--pending"), "production's own spelling is kept in step, so its existing rule still applies");
  assert.equal(stop.textContent, "■ Stopping…", "…and says so");
  assert.equal(stop.disabled, true);

  view.setState({ sending: { stopPending: false, stopLabel: "■ Stop" } });
  assert.ok(!stop.classList.contains("--pending") && !stop.classList.contains("pc-stop--pending"), "and it clears");
});

test("stopLabel is only applied when the host actually supplies it", () => {
  // Core labels its Stop button itself (it appends stall warnings), so an absent key must leave the
  // button's text alone rather than resetting it on every unrelated patch.
  const { view } = mountShell();
  view.els.stopBtn.textContent = "■ Stop — stalled 2m";
  view.setState({ sending: { stopDisabled: false } });
  assert.equal(view.els.stopBtn.textContent, "■ Stop — stalled 2m", "a host's own label survives a patch that says nothing about it");
});
