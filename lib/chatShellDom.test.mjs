// node --test lib/chatShellDom.test.mjs
//
// WHY THIS EXISTS: chat-shell.js used to be pure math with a header comment saying so on purpose
// ("no DOM here"). The Chat Shell Lab, Core's app.js, and Pact's app.js each hand-rolled their OWN copy
// of the header stats chips, the line-number gutter, and the Compact│Wrap split control — three
// implementations that happened to agree and drifted the moment any one of them changed (this is the
// exact complaint that triggered this file: "why isn't it the same code"). el()/paintGutter()/
// buildStatsChips()/buildWrapControls() are now that one implementation.
//
// This file tests the functions THEMSELVES — real DOM built via a minimal shim, real clicks/changes
// fired, real assertions on the result — not "does the string exist in some file", which is what let
// three copies drift apart unnoticed in the first place.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const shellJs = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "chat-shell.js"), "utf8");

// --- the smallest DOM that lets el()/paintGutter()/buildStatsChips()/buildWrapControls() run ---------
function makeNode(tag) {
  const n = {
    tagName: String(tag || "div").toUpperCase(), children: [], attrs: {}, style: {}, dataset: {},
    className: "", textContent: "", value: "", checked: false, disabled: false, title: "",
    parentNode: null, clientHeight: 600, scrollTop: 0, scrollHeight: 900,
    _listeners: {},
    classList: {
      add(...c) { c.forEach((x) => { if (x && !n.className.split(" ").includes(x)) n.className = (n.className + " " + x).trim(); }); },
      contains(c) { return n.className.split(" ").includes(c); },
    },
    setAttribute(k, v) { n.attrs[k] = String(v); },
    appendChild(c) { if (c && typeof c === "object") { c.parentNode = n; n.children.push(c); } return c; },
    replaceChildren(...k) { n.children.forEach((c) => { c.parentNode = null; }); n.children = []; k.forEach((c) => n.appendChild(c)); },
    addEventListener(ev, fn) { (n._listeners[ev] = n._listeners[ev] || []).push(fn); },
    fire(ev) { (n._listeners[ev] || []).forEach((fn) => fn.call(n)); },
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

// ---------------------------------------------------------------------------------------------- el()

test("el(): builds a real element, sets class/attrs, appends string and node children", () => {
  const CS = loadChatShell();
  const child = CS.el("b", { class: "--on" }, ["3"]);
  const node = CS.el("div", { class: "wrap", title: "hi" }, ["text ", child]);
  assert.equal(node.tagName, "DIV");
  assert.equal(node.className, "wrap");
  assert.equal(node.attrs.title, "hi");
  assert.equal(node.children.length, 2);
  assert.equal(node.children[0].tagName, "#text");
  assert.equal(node.children[1], child);
  assert.equal(textOf(node), "text 3");
});

// --------------------------------------------------------------------------------------- paintGutter

test("paintGutter(): line count follows the real textarea value, not a fixed slot count", () => {
  const CS = loadChatShell();
  const gut = makeNode("div");
  const ta = makeNode("textarea");
  ta.value = "one\ntwo\nthree";
  const written = CS.paintGutter(ta, gut);
  assert.equal(written, 3, "must return the real written-line count");
  const on = gut.children.filter((c) => c.classList.contains("--on"));
  assert.equal(on.length, 3, "exactly the written lines get the bright class");
});

test("paintGutter(): an empty textarea has typed ZERO lines, not one", () => {
  const CS = loadChatShell();
  const gut = makeNode("div"); const ta = makeNode("textarea"); ta.value = "";
  assert.equal(CS.paintGutter(ta, gut), 0);
});

test("paintGutter(): column width follows the widest digit count actually shown", () => {
  const CS = loadChatShell();
  const gut = makeNode("div"); const ta = makeNode("textarea");
  ta.value = Array.from({ length: 12 }, (_, i) => "line " + i).join("\n");   // 12 lines → 2 digits
  CS.paintGutter(ta, gut);
  const w = parseInt(gut.style.width, 10);
  assert.equal(w, 14 + 2 * 7, "two-digit line count must widen the column past the one-digit default");
});

test("paintGutter(): scroll stays in lockstep, and the listener is bound exactly once across repeated paints", () => {
  const CS = loadChatShell();
  const gut = makeNode("div"); const ta = makeNode("textarea"); ta.value = "a\nb";
  CS.paintGutter(ta, gut);
  CS.paintGutter(ta, gut);   // second paint on the SAME textarea must not double-bind
  assert.equal((ta._listeners.scroll || []).length, 1, "the scroll listener must be bound exactly once");
  ta.scrollTop = 42;
  ta.fire("scroll");
  assert.equal(gut.scrollTop, 42, "the gutter must track the textarea's scroll position");
});

// ---------------------------------------------------------------------------------- buildStatsChips

// buildStatsChips returns GROUPS now, not a flat chip run (each declaring the side of the row it
// belongs on — see lib/chatShellRowGroups.test.mjs), so a test that wants a chip has to descend into
// them. This helper is what "the chips" means from here on.
const chipsIn = (groups) => groups.flatMap((g) => g.children || []);

test("buildStatsChips(): the nearest ceiling is highlighted, the others are muted, using the caller's class names", () => {
  const CS = loadChatShell();
  const chips = chipsIn(CS.buildStatsChips({
    prompts: 900, responses: 900, bytes: 100, tokens: 100, ceiling: 1000000, maxTurns: 1000,
    chipClass: "exo-chip", warnClass: "--warn", mutedClass: "--muted",
  }));
  const turnsChip = chips.find((c) => textOf(c).includes("turns"));
  assert.ok(turnsChip, "a turns chip must exist");
  assert.ok(turnsChip.classList.contains("--warn"), "the ceiling closest to firing must carry the caller's warn class");
});

test("buildStatsChips(): the chips arrive as GROUPS, so a wrapped row can align each line", () => {
  // Three groups, in this order, and NO declared side on any of them: which side each takes is
  // captured from where the current width put it (lib/chatShellRowGroups.test.mjs). At the reported
  // 950px pane that produces exactly "turn+MB left, compacted/wrapped right; would-wrap left,
  // context right" — the context readout being the shell's own live control, re-appended after these.
  const CS = loadChatShell();
  const groups = CS.buildStatsChips({ prompts: 40, responses: 40, bytes: 10, tokens: 10, ceiling: 100 });
  assert.equal(groups.length, 3);
  assert.ok(groups.every((g) => g.classList.contains("cs-grp")), "every one must be a real group node");
  assert.ok(groups.every((g) => g.attrs["data-side"] === undefined),
    "a group must not declare a side — the same group is the left-hand one at one width and the "
    + "right-hand one at another, which is exactly what a declared side cannot express");
  assert.ok(textOf(groups[0]).includes("turns"), "group 1 is the size pair");
  assert.ok(textOf(groups[1]).includes("compacted") && textOf(groups[1]).includes("wrapped"),
    "group 2 keeps the two counters together — they are one idea and must never split across a line");
  assert.ok(textOf(groups[2]).includes("would wrap"), "group 3 is the wrap preview");
});

test("buildStatsChips(): compacted/wrapped counters ALWAYS render, including at zero — absence must not read as 'not tracked'", () => {
  const CS = loadChatShell();
  const chips = CS.buildStatsChips({ prompts: 1, responses: 1, bytes: 1, tokens: 1, ceiling: 100, compactCount: 0, wrapCount: 0 });
  assert.ok(chips.some((c) => textOf(c).includes("0 compacted")), "the compacted chip must render even at zero");
  assert.ok(chips.some((c) => textOf(c).includes("0 wrapped")), "the wrapped chip must render even at zero");
});

test("buildStatsChips(): an active compaction/wrap count carries a real inline color, not just a class name", () => {
  // "same colours" was an explicit, repeated ask — a class NAME matching across two stylesheets is a
  // weaker guarantee than the same literal hex landing in the DOM. These two are hardcoded on purpose.
  const CS = loadChatShell();
  const chips = chipsIn(CS.buildStatsChips({ prompts: 1, responses: 1, bytes: 1, tokens: 1, ceiling: 100, compactCount: 2, wrapCount: 3 }));
  const comp = chips.find((c) => textOf(c).includes("compacted"));
  const wrap = chips.find((c) => textOf(c).includes("wrapped"));
  assert.match(comp.attrs.style, /#8fc3ff/, "an active compaction count must carry the fixed blue");
  assert.match(wrap.attrs.style, /var\(--acc\)/, "an active wrap count must carry the shared accent");
});

test("buildStatsChips(): the 'would wrap' preview is computed via the shared wrapSpan, not invented", () => {
  const CS = loadChatShell();
  const chips = CS.buildStatsChips({ prompts: 100, responses: 100, bytes: 1, tokens: 1, ceiling: 100, tailTurns: 40 });
  const preview = chips[chips.length - 1];
  assert.ok(textOf(preview).includes("would wrap"), "the last chip must be the wrap-range preview");
  const expected = CS.wrapSpan({ rFrom: 1, rTo: 100 - 20, pFrom: 1, pTo: 100 - 20 });
  assert.ok(textOf(preview).includes("R#1–R#" + expected.r.to), "must match the shared wrapSpan's real numbers, not a guess");
});

// --------------------------------------------------------------------------------- buildWrapControls

test("buildWrapControls(): the checkbox reflects autoWrap and its onchange ALWAYS fires the caller's callback", () => {
  const CS = loadChatShell();
  let seen = null;
  const wc = CS.buildWrapControls({ autoWrap: true, tokens: 100, ceiling: 1000, onToggleAutoWrap: (on) => { seen = on; } });
  assert.equal(wc.checkbox.checked, true);
  wc.checkbox.checked = false;
  wc.checkbox.onchange();
  assert.equal(seen, false, "toggling the checkbox must reach the caller's callback, not silently do nothing");
});

test("buildWrapControls(): Compact is never gated; Wrap is disabled below the manual threshold and explains why", () => {
  const CS = loadChatShell();
  const wc = CS.buildWrapControls({ tokens: 50, ceiling: 1000000 });   // far below the 60% manual threshold
  assert.equal(wc.compactBtn.disabled, false, "compaction is cheap and always valid — never gated");
  assert.equal(wc.wrapBtn.disabled, true, "wrapping a nearly-empty window must be refused");
  assert.match(wc.wrapBtn.title, /Too light to wrap/i, "a disabled control with no visible reason is indistinguishable from a broken one");
  assert.match(textOf(wc.wrapBtn), /Wrap at \d+%/, "the button must name the threshold it's waiting for, on its face");
});

test("buildWrapControls(): past the manual threshold, Wrap is enabled and clicking it fires the caller's callback", () => {
  const CS = loadChatShell();
  let clicked = false;
  const wc = CS.buildWrapControls({ tokens: 700000, ceiling: 1000000, onWrap: () => { clicked = true; } });
  assert.equal(wc.wrapBtn.disabled, false);
  wc.wrapBtn.onclick();
  assert.equal(clicked, true, "a real click must reach the caller's onWrap, not a no-op");
});

test("buildWrapControls(): clicking Compact ALWAYS reaches the caller's callback, regardless of context usage", () => {
  const CS = loadChatShell();
  let clicked = false;
  const wc = CS.buildWrapControls({ tokens: 1, ceiling: 1000000, onCompact: () => { clicked = true; } });
  wc.compactBtn.onclick();
  assert.equal(clicked, true);
});

test("buildWrapControls(): the meter fill tracks the real percentage, capped at 100", () => {
  const CS = loadChatShell();
  const low = CS.buildWrapControls({ tokens: 100, ceiling: 1000 });    // 10%
  const over = CS.buildWrapControls({ tokens: 5000, ceiling: 1000 });  // 500% — must clamp visually
  assert.equal(low.meterFill.style.width, "10%");
  assert.equal(over.meterFill.style.width, "100%", "the fill must never exceed the bar it's drawn in");
});

test("buildWrapControls(): every call builds Compact and Wrap joined into ONE split container, using the caller's class", () => {
  const CS = loadChatShell();
  const wc = CS.buildWrapControls({ tokens: 1, ceiling: 100, splitClass: "ws-split" });
  assert.equal(wc.split.className, "ws-split");
  assert.deepEqual(wc.split.children, [wc.compactBtn, wc.wrapBtn], "Compact must be the left half, Wrap the right — same order everywhere");
});

/* ================= the header counts the WINDOW, not the whole conversation ====================
 *
 * "the would wrap still shows that it wraps everything, that's why I'm asking."
 *
 * Reported against a header reading `7,668/1,000 turns · 3,834 rounds · 766.8%` beside
 * `would wrap R#1–R#6,841 [6,841]` and `0 wrapped · this conversation`. Every one of those is wrong
 * in the same way: the ceilings here are per-WINDOW (the engine measures turns and bytes since the
 * last wrap — workspace.mjs `_rollFrom`), but the chips were fed the whole conversation. A wrap does
 * not splice the transcript, so "everything the client holds" and "the current window" diverge
 * permanently after the first wrap.
 */
test("buildStatsChips measures the WINDOW: pFrom/rFrom move the turn count, the %, and the wrap span", () => {
  const CS = loadChatShell();
  const common = { prompts: 700, responses: 6900, bytes: 20000, maxTurns: 1000, maxBytes: 25 * 1024 * 1024,
                   tailTurns: 200, fmtNum: (n) => String(n) };

  // No wrap yet: the window IS the conversation, and pFrom/rFrom default to 1.
  const chipText = (chips) => chips.map(textOf).join(" | ");
  const whole = chipText(CS.buildStatsChips({ ...common }));
  assert.match(whole, /7600\/1000 turns/, "with no wrap, the window is the whole conversation");

  // After a wrap at R#6800/P#690, only what came after it is in the window.
  const win = chipText(CS.buildStatsChips({ ...common, pFrom: 691, rFrom: 6801 }));
  assert.match(win, /110\/1000 turns/, "10 prompts + 100 responses since the wrap — not 7,600");
  assert.ok(!/766|760%/.test(win), "and no percentage above its own ceiling");
});

test("the wrap span starts where the LAST wrap ended, never at R#1", () => {
  const CS = loadChatShell();
  const chips = CS.buildStatsChips({ prompts: 800, responses: 7000, bytes: 1000, maxTurns: 1000,
                                     maxBytes: 25 * 1024 * 1024, tailTurns: 200, pFrom: 691, rFrom: 6301,
                                     fmtNum: (n) => String(n) });
  const t = chips.map(textOf).join(" | ");
  assert.match(t, /R#6301–R#6900/, "the next wrap covers the window's own turns: R#6301 up to 7000 minus the 100-round tail");
  assert.ok(!/R#1–/.test(t), "claiming it would archive back to the first turn was the whole report");
});

test("a window still inside the kept tail says so in words, not as a backwards range", () => {
  const CS = loadChatShell();
  // 78 turns since the wrap, against a tail of 200 — a wrap could archive nothing at all.
  const chips = CS.buildStatsChips({ prompts: 724, responses: 6934, bytes: 21900, maxTurns: 1000,
                                     maxBytes: 25 * 1024 * 1024, tailTurns: 200, pFrom: 724, rFrom: 6896,
                                     fmtNum: (n) => String(n) });
  const t = chips.map(textOf).join(" | ");
  assert.match(t, /would wrap nothing yet/, "an empty span must read as 'not yet', in words");
  assert.ok(!/R#6896–R#6895/.test(t), "printed as a range it came out backwards, which reads as a broken number");
});

/* ================= Send/Stop presentation: ONE decision for both workspaces ====================
 *
 * "I don't think the Pact workspace colours the send button properly, like the Core workspace does."
 *
 * Measured side by side, and it was right — three divergences, each one Pact telling you LESS than
 * Core, because the two workspaces each had their own chain of ternaries:
 *
 *   1. BACKGROUND WORK — an agent-spawned task still running while the chat itself reads idle. Core
 *      pulsed the ring for it; Pact did not, so the one state a host cannot signal any other way was
 *      invisible there.
 *   2. A PRESSED STOP — the turn runs until the interrupt lands, so the button must hold its working
 *      colour. Pact dropped to the resting accent immediately, which reads as "finished".
 *   3. THE LABEL while stopping — Core kept saying "Working…"; "Stopping…" is what you want to read.
 *
 * Both now read from CS.sendPresentation, so they cannot drift again.
 */
test("sendPresentation: the four resting/working states", () => {
  const CS = loadChatShell();
  const p = (o) => CS.sendPresentation(o);
  assert.deepEqual([p({}).state, p({}).sendLabel, p({}).pulse], [null, "Send", false], "idle says nothing and does nothing");
  assert.deepEqual([p({ busy: true }).state, p({ busy: true }).sendLabel], ["busy", "Working…"]);
  assert.deepEqual([p({ busy: true, deep: true }).state, p({ busy: true, deep: true }).sendLabel], ["deep", "Deep Work…"]);
  assert.equal(p({ busy: true }).pulse, true, "a running turn pulses");
});

test("a pressed Stop keeps the WORKING colour — the turn is not over until the interrupt lands", () => {
  const CS = loadChatShell();
  const s = CS.sendPresentation({ busy: true, stopping: true });
  assert.equal(s.state, "busy", "dropping to the resting colour here reads as 'finished' while it is still going");
  assert.equal(s.sendLabel, "Stopping…", "…and the label answers the button you just pressed");
  assert.equal(s.stopDisabled, true, "Stop cannot be pressed twice");
  assert.equal(s.stopPending, true);
  assert.equal(s.stopLabel, "■ Stopping…");
  const d = CS.sendPresentation({ busy: true, deep: true, stopping: true });
  assert.equal(d.state, "deep", "deep work keeps ITS colour too");
});

test("background work pulses while the chat itself stays free — the state nothing else can show", () => {
  const CS = loadChatShell();
  const s = CS.sendPresentation({ busy: false, background: true });
  assert.equal(s.pulse, true, "something IS running, and the ring is the only way to say so");
  assert.equal(s.state, null, "…but the chat is genuinely free");
  assert.equal(s.sendLabel, "Send", "…so the button must not pretend a turn is running");
  assert.equal(s.stopDisabled, true, "there is no turn to stop");
});

test("the caller's suffix rides only on a running turn, never on Send or Stopping", () => {
  const CS = loadChatShell();
  assert.equal(CS.sendPresentation({ busy: true, suffix: " 0:12" }).sendLabel, "Working… 0:12", "Core's live clock");
  assert.equal(CS.sendPresentation({ suffix: " 0:12" }).sendLabel, "Send", "an idle button has no elapsed time");
  assert.equal(CS.sendPresentation({ busy: true, stopping: true, suffix: " 0:12" }).sendLabel, "Stopping…",
    "counting up while stopping is noise");
});

test("BOTH workspaces go through it — that is the entire point", () => {
  const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
  // Two callers, three surfaces: Core, Pact desktop, and Pact MOBILE — which does not mount the
  // shell and so applies the same `pres` by hand, inside the desktop call's own scope.
  assert.equal((app.match(/window\.ChatShell\.sendPresentation\(/g) || []).length, 2,
    "Core and Pact must each compute the shared decision — no third chain of ternaries anywhere");
  for (const use of ["send.textContent = pres.sendLabel;", "ui.sendBtn.textContent = _pres.sendLabel;"])
    assert.ok(app.includes(use), `every surface must render the shared label: ${use}`);
  assert.ok(!/deep \? "Deep Work…" : busy \? "Working…" : "Send"/.test(app),
    "no hand-rolled label chain may survive, or the two can drift apart again");
});

test("one side empty while the other is not prints 'none yet', not a backwards range", () => {
  const CS = loadChatShell();
  // The normal case, and it was on screen: the kept tail is counted in TURNS, so a window with 145
  // archivable responses can easily have zero archivable prompts — prompts are far rarer. Rendered
  // as a range it came out backwards ("P#15–P#14 [0]"), which reads as a broken number.
  const t = CS.buildStatsChips({ prompts: 114, responses: 946, bytes: 1, maxTurns: 1000,
    maxBytes: 25 * 1024 * 1024, tailTurns: 200, pFrom: 15, rFrom: 702, fmtNum: (n) => String(n) })
    .map(textOf).join(" | ");
  assert.match(t, /R#702–R#846 \[145\]/, "the side that HAS content still reports its exact range");
  assert.match(t, /P# none yet/, "…and the empty side says so in words");
  assert.ok(!/P#15–P#14/.test(t), "a backwards range must never render");
});
