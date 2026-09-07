// node --test lib/pactHeaderStats.test.mjs
// Pact's header stats row — the second half of the catch-up pass started in lib/coreHeaderStats.test.mjs.
// Same shape as Core's, adapted to Pact's real fields (t.msgs, not p.transcript; PACT_CHAT.host queried
// by selector rather than a held element ref, matching the existing wrapCountersEl lookup pattern this
// replaces). Desktop only — the mobile pass is explicitly deferred, same as every other Pact desktop-only
// feature in this migration (see the `mob` comment above headKids in app.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const appSrc = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const shellJs = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "chat-shell.js"), "utf8");
const shellUiSrc = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "chat-shell-ui.js"), "utf8");

test("wiring: Pact's stats row exists and is inserted into the desktop DOM, right after the head", () => {
  // pactStatsRow is now window.ChatShell.buildShellFrame's row2, built INSIDE `head` (the shared
  // function's header contains both rows) — not a separate top-level element built by hand.
  // pactPaintStatsRow still finds it by its .ws-hstats class regardless of which function built it.
  assert.ok(appSrc.includes("window.ChatShellUI.mount(host, {"), "the desktop shell must be built by the shared chat-shell package");
  assert.ok(appSrc.includes('pv.statsRow.classList.add("ws-hstats");'), "the mounted shell's stats row must keep the class pactPaintStatsRow queries for");
  assert.ok(appSrc.includes("head = pv.header;"), "head must be the mounted shell's header (identity row + stats row together)");
  assert.ok(appSrc.includes("host.replaceChildren(head, exoNode, scroll,"), "must be inserted right after head, before the exocortex bar — same position as Core's");
});

test("wiring: Pact's stats row is repainted from real per-tab data via the shared pure math, not a mock", () => {
  // pactPaintStatsRow now builds the row through window.ChatShell.buildStatsChips — the same function
  // the Lab and Core call — rather than re-deriving rollTriggers/wrapSpan itself.
  assert.ok(appSrc.includes("function pactPaintStatsRow(t)"), "a real paint function must exist");
  assert.ok(appSrc.includes("pactPaintStatsRow(t);") && appSrc.includes("pactPaintStatsRow(pactChatActive() || {});"), "must be called both from the per-tab paint path and right after a rebuild");
  const fn = appSrc.slice(appSrc.indexOf("function pactPaintStatsRow"), appSrc.indexOf("function pactChatPaint(t)"));
  // Through the package's own patch, exactly like Core — NOT a second hand-rolled
  // `buildStatsChips(...) + row.replaceChildren(...)`, which is what this used to be and assert.
  // That mattered as soon as the context readout moved into this row: it is a stable node the
  // package re-appends across repaints, and a caller clearing the row would drop it.
  assert.ok(fn.includes("PACT_CHAT._view.setState({"), "must hand its numbers to the package's stats patch");
  assert.ok(!fn.includes("row.replaceChildren()"), "must not clear the row itself — that drops the context readout");
  assert.ok(shellUiSrc.includes("CS.buildStatsChips(s.stats).concat([ctxGroup])"),
    "…and the package must rebuild the chips while preserving the live context group");
  assert.ok(shellJs.includes("rollTriggers({") && shellJs.includes("wrapSpan({"), "the shared function must reuse the shared ceiling/span math");
  assert.ok(fn.includes("t._compactCount") && fn.includes("t._wrapCount"), "counters must come from the real, already-tracked per-tab fields");
  assert.ok(fn.includes("Array.isArray(t.msgs)"), "must read Pact's real render-form transcript, not Core's field name");
});

test("wiring: the old plain-text wrapCountersEl lookup is gone from pactChatPaint", () => {
  assert.ok(!appSrc.includes('const wrapCountersEl = PACT_CHAT.host.querySelector(".ws-wrap-counters");'), "the old per-paint textContent update must be removed, not left dangling alongside the new row");
});

test("wiring: Pact's Compact and Wrap are joined into one split control, matching Core", () => {
  // Built through the shared window.ChatShell.buildWrapControls now (see pactPaintWrapControls) — the
  // desktop model bar holds a stable `wrapWrap` container that's repainted with fresh split-button
  // markup on every pactChatPaint(), the same pattern Core uses (lib/coreHeaderStats.test.mjs).
  assert.ok(appSrc.includes('const wrapWrap = el("span", { class: "pact-wrapwrap" }, []);'), "Pact must build a stable wrapWrap container for the shared function to repaint into");
  assert.ok(appSrc.includes("function pactPaintWrapControls(t)") && appSrc.includes("pactPaintWrapControls(t);"),
    "the repaint function must exist and actually be called from pactChatPaint");
  assert.ok(appSrc.includes('splitClass: "pact-split split"'), "Pact must wrap its two buttons the same way Core does");
  assert.ok(appSrc.includes('pv.els.wrapWrap.classList.add("pact-wrapwrap");'),
    "…and Pact must repaint into the mounted shell's own wrap container, not a second one");
});
