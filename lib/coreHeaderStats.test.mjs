// node --test lib/coreHeaderStats.test.mjs
// Core's header "stats row" (Chat Shell migration, catch-up pass) — the lab's defining second header
// row (turns/rounds/%, size, compacted/wrapped counters, "would wrap" preview) never actually reached
// production; only the wrap ENGINE + a plain-text counter did. These are wiring-presence checks (app.js
// "boots the DOM", same limitation noted in lib/manualWrapUi.test.mjs) proving the real call sites exist
// and reuse the shared, already-tested pure math (ChatShell.rollTriggers/wrapSpan, lib/chatShell.test.mjs)
// rather than a second, driftable implementation.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const appSrc = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const cssSrc = readFileSync(join(__dir, "..", "dashboard", "public", "styles.css"), "utf8");
const shellJs = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "chat-shell.js"), "utf8");
const shellUiSrc = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "chat-shell-ui.js"), "utf8");

test("wiring: the stats row exists, is appended into the pane, and is registered on paneUI", () => {
  // statsRow is now `frame.statsRow` from window.ChatShell.buildShellFrame — built through the SAME
  // function the Lab uses, not a standalone `el("div", {class:"ws-hstats"}, [])` call. `topBar`/
  // `statsRow` are kept as local aliases (`const statsRow = frame.statsRow;`) precisely so downstream
  // code (paneUI registration, wsPaintStatsRow's `ui.statsRow` lookup) didn't need to change at all.
  // The pane no longer builds a frame at all — it mounts the package, which builds the whole shell.
  assert.ok(appSrc.includes("window.ChatShellUI.mount(paneRoot, {"), "the pane must be built by the shared chat-shell package");
  assert.ok(appSrc.includes("const statsRow = view.statsRow;"), "statsRow must be the mounted shell's real stats row");
  // The pane is now EXACTLY the Lab's three regions — header, core, footer — with the conversation
  // tabs appended as a header row rather than being a fourth top-level sibling.
  // The three regions are the PACKAGE's own guarantee now, asserted by mounting it for real in
  // lib/chatShellPackage.test.mjs. What is Core's job is handing over a host element to mount into.
  assert.ok(appSrc.includes('const paneRoot = el("div", { class: "ws-pane" }, []);'),
    "Core must supply a host element for the shell to be mounted into");
  assert.ok(appSrc.includes("view.header.appendChild(convTabsRow);"), "the conversation tabs must be a header ROW, not a top-level sibling"),
  assert.ok(appSrc.includes("convTabsRow, statsRow, wrapWrap, identityLabel"), "statsRow must be registered on paneUI so paintPane can reach it");
});

test("wiring: the stats row is repainted from real transcript/usage data via the shared pure math, not a mock", () => {
  // wsPaintStatsRow now builds the row through window.ChatShell.buildStatsChips — the same function the
  // Lab and Pact call — rather than re-deriving rollTriggers/wrapSpan itself. That reuse is checked
  // against chat-shell.js directly; this only proves Core's call site actually reaches it with real data.
  assert.ok(appSrc.includes("function wsPaintStatsRow(p, ui)"), "a real paint function must exist");
  assert.ok(appSrc.includes("wsPaintStatsRow(p, ui);"), "paintPane must actually call it, not just define it");
  // Core hands the numbers to the package and the PACKAGE builds the chips — this used to assert
  // that app.js itself called buildStatsChips, which only ever passed because PACT's now-deleted
  // hand-rolled copy of this paint was in the same file. Both workspaces go through setState now.
  assert.ok(appSrc.includes("ui.view.setState({") && /stats: \{ prompts: nP, responses: nR, bytes,/.test(appSrc),
    "Core must hand real numbers to the package's own stats patch");
  assert.ok(shellUiSrc.includes("CS.buildStatsChips(s.stats)"),
    "…and the package must be the one place that turns them into chips");
  assert.ok(shellJs.includes("rollTriggers({"), "must reuse the shared ceiling math, not re-derive it");
  assert.ok(appSrc.includes("Number(usage.totalTokens)") && appSrc.includes("p.contextUsage"), "must read REAL usage, not a placeholder");
  assert.ok(appSrc.includes("p._compactCount") && appSrc.includes("p._wrapCount"), "the two counters must come from the real, already-tracked fields");
});

test("wiring: both counters render even at zero (absence must not look like 'not tracked')", () => {
  // This behavior (always render, never gate on a non-zero count) now lives in the shared
  // buildStatsChips — checked directly against chat-shell.js.
  const fn = shellJs.slice(shellJs.indexOf("function buildStatsChips"), shellJs.indexOf("function buildWrapControls"));
  assert.ok(fn.includes('"🗜 " + nComp + " compacted · this window"'), "compacted chip must always render its count");
  assert.ok(fn.includes('"⟳ " + nWraps + " wrapped · this conversation"'), "wrapped chip must always render its count");
});

test("wiring: the old plain-text wrapCounters element is gone from Core (replaced, not duplicated)", () => {
  assert.ok(!appSrc.includes('const wrapCounters = el("span", { class: "ws-wrap-counters" }, []);\n    const activityLine'),
    "Core must not still build the old standalone counters element next to activityLine");
  // Compact/Wrap are no longer built once at pane construction (const wrapSplit = ...) — they're built
  // through window.ChatShell.buildWrapControls on every paintPane() (see wsPaintWrapControls), because
  // the meter and Wrap's disabled state depend on live context usage. `wrapWrap` is the stable
  // container that output is repainted into; splitClass: "ws-split" is what keeps them visually joined.
  assert.ok(appSrc.includes("const wrapWrap = view.els.wrapWrap;"),
    "Core must address the mounted shell's own stable wrap container, not build a second one");
  // Compact/Wrap/auto-wrap ride on the same live-usage patch the stats row does — one setState, one
  // reading, no chance of the meter and the chips disagreeing about how full the window is.
  assert.ok(appSrc.includes("wrap: { autoWrap: p.autoWrap !== false"),
    "the wrap controls must be repainted from the same live usage reading as the stats");
  assert.ok(readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "chat-shell.js"), "utf8")
    .includes('var split = el("span", { class: o.splitClass || "split" }, [compactBtn, wrapBtn]);'),
    "Compact and Wrap must be joined into one split container, not left as two loose buttons");
});

test("wiring: R# addressing color is a FIXED hex, never var(--accent) — it must not drift per workspace/theme", () => {
  assert.ok(cssSrc.includes(".ws-num-r { left: 6px; background: #c77dff;"), "the R# badge must be pinned to a fixed violet, matching the documented invariant");
  assert.ok(!/\.ws-num-r\s*\{[^}]*var\(--accent\)/.test(cssSrc), "the R# rule must not reference the theme-dependent accent variable");
});

test("wiring: the user bubble is theme-tinted (derived from --accent), not the old fixed loud blue", () => {
  assert.ok(!cssSrc.includes(".ws-line.ws-user { color: #fff; background: #2f6feb;"), "the old fixed-blue rule must be gone");
  assert.ok(/\.ws-line\.ws-user\s*\{[^}]*color-mix\(in srgb, var\(--accent\)/.test(cssSrc), "must derive its color from the workspace accent so Core/Pact/light-dark all differ correctly");
});

test("wiring: .ws-split visually joins Compact and Wrap with a shared border and single divider", () => {
  assert.ok(/\.ws-split,\s*\.pact-split\s*\{[^}]*border:\s*1px solid var\(--line\)/.test(cssSrc), "the split container must have its own outer border");
  assert.ok(/\.ws-split\s*>\s*button,\s*\.pact-split\s*>\s*button\s*\{[^}]*border:\s*none/.test(cssSrc), "individual buttons inside the split must lose their own border");
});

test("wiring: the auto-wrap meter has a real visible track, not just a DOM node with no CSS behind it", () => {
  // buildWrapControls sets meterFill.style.width to a real percentage — but a percentage of an element
  // with no declared width/height/background renders as literally nothing. This is what made the
  // meter invisible in a live screenshot even though the DOM was already correct.
  assert.ok(/\.ws-wrapmeter\s*\{[^}]*height:\s*6px/.test(cssSrc), "the meter needs an explicit track height to render at all");
  assert.ok(/\.ws-wrapmeter\s*\{[^}]*background:/.test(cssSrc), "the meter's track needs its own background so an empty/near-empty fill is still visible as a track");
  assert.ok(/\.ws-wrapmeter i\s*\{[^}]*background:/.test(cssSrc), "the fill itself needs a background — a colorless div is invisible regardless of width");
  assert.ok(cssSrc.includes(".ws-autowrap {"), "the auto-wrap checkbox's label needs real layout (flex+gap), not raw inline default spacing");
});

/* ================= per-pane periodic work must not repaint the shell 4x a second ==============
 *
 * With eight panes open, typing stalled. wsAutoEnsure runs on a 250 ms timer PER PANE and called
 * setState unconditionally — and setState marks the shell's per-line group alignment dirty, which is
 * a write-then-read over every group in four rows, i.e. a forced synchronous layout. Eight panes
 * therefore paid 32 full layout passes a second, forever, to re-state a decision that is identical
 * between ticks except in the one second before an auto-send fires.
 */
test("wsAutoEnsure publishes only when its decision actually changed", () => {
  assert.match(appSrc, /const sig = \[d\.show \|\| d\.on, d\.on, d\.autoCount, d\.autoCap, title\]\.join/,
    "the signature must cover exactly what the call publishes — no more, no less");
  assert.match(appSrc, /if \(p\._autoSig !== sig\) \{/, "…and the publish must be gated on it");
  // The title rides the same gate: it was written on every tick too, on a node inside the same row.
  const fn = appSrc.slice(appSrc.indexOf("function wsAutoEnsure(p) {"), appSrc.indexOf("function wsPaintStatsRow"));
  assert.ok(fn.indexOf("p._autoSig = sig;") < fn.indexOf("ui.view.setState({ autoContinue:"),
    "the signature must be recorded before publishing, so a throw cannot wedge it permanently dirty");
  assert.ok(!/^\s*ui\.view\.setState\(\{ autoContinue:/m.test(fn.replace(/if \(p\._autoSig !== sig\) \{[\s\S]*?\n    \}/, "")),
    "there must be no ungated publish left behind");
});

test("the shell's alignment pass is gated too — typing cannot trigger it", () => {
  assert.match(shellUiSrc, /var _alignDirty = true;/, "the shell must track whether alignment is stale");
  assert.match(shellUiSrc, /relayout\(false\);/, "…and typing must ask for a layout that skips it");
  assert.match(shellUiSrc, /if \(_alignDirty\) \{/, "…and the pass itself must be gated");
});

test("repeated selector fills are guarded by one shared signature helper, not four ad-hoc ones", () => {
  // Pinned on the MECHANISM, not just the name: removing the early return left the helper in place
  // and every shape-based assertion still passed, which is the failure mode this file exists to avoid.
  assert.match(appSrc, /function wsSyncOptions\(sel, sig, build\) \{\s*\n\s*if \(sel\._optSig === sig\) return false;/,
    "one guard, shared — and it must actually short-circuit on an unchanged signature");
  // Two call sites plus the definition itself (which shares the parameter names).
  assert.equal((appSrc.match(/^\s+wsSyncOptions\(sel, /gm) || []).length, 2,
    "the effort and worktree selectors must both use it — they rebuilt their options on every paint");
  // modelInfoFor was a linear scan of the whole catalogue, called several times per paint per pane.
  assert.match(appSrc, /st\._miMap = new Map\(st\.models\.map/, "the catalogue must be indexed, not rescanned");
  assert.match(appSrc, /if \(st\._miRev !== st\.modelsRev\)/, "…and the index rebuilt only when the catalogue changes");
});
