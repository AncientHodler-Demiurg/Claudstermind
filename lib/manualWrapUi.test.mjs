// node --test lib/manualWrapUi.test.mjs
// Manual wrap, client side (Chat Shell migration, topic 7) — production had NO way to trigger a wrap
// before this; only the automatic threshold in lib/workspace.mjs. These are wiring-presence checks
// (app.js "boots the DOM", same limitation as every other DOM-heavy feature in this codebase) proving
// the real call sites exist and use the shared, already-tested pure math (ChatShell.wrapReadiness/
// wrapSpan, lib/chatShell.test.mjs) rather than a second, driftable implementation. The engine side
// (manualRoll/wrapPreview/_performRoll) has full behavioral coverage in lib/workspace.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

test("wiring: both workspaces gate opening the dialog on ChatShell.wrapReadiness, not a re-derived check", () => {
  const hits = (src.match(/window\.ChatShell\.wrapReadiness\(/g) || []).length;
  assert.equal(hits, 2, "Core's wsOpenWrapDialog and Pact's pactOpenWrapDialog must each call the shared readiness check");
  assert.ok(src.includes("if (!readiness.canWrapManually)"), "a conversation below the manual threshold must be refused, not silently allowed");
});

test("wiring: both workspaces build the preview display from ChatShell.wrapSpan, not their own arithmetic", () => {
  const hits = (src.match(/window\.ChatShell\.wrapSpan\(/g) || []).length;
  assert.equal(hits, 2, "wsFillWrapPreview and pactFillWrapPreview must each reuse the shared span math");
});

test("wiring: the confirm button starts disabled and only the arm-delay timer enables it", () => {
  const disabledHits = (src.match(/confirmBtn\.disabled = true;/g) || []).length;
  assert.ok(disabledHits >= 2, "both dialogs must start the confirm button disabled");
  assert.ok(src.includes("wsDialogArmed(Date.now() - openedAt,"), "arming must go through the shared, tested timing check");
});

test("wiring: a roll is counted exactly once per event, on 'rolling' — never a second time on 'wrapResult'", () => {
  // This is the invariant that matters: 'rolling' fires for BOTH automatic and manual rolls;
  // 'wrapResult' only for manual ones. Counting on both would double-count every manual wrap.
  const coreWrapCountIncrements = (src.match(/p\._wrapCount = \(p\._wrapCount \|\| 0\) \+ 1/g) || []).length;
  const pactWrapCountIncrements = (src.match(/t\._wrapCount = \(t\._wrapCount \|\| 0\) \+ 1/g) || []).length;
  assert.equal(coreWrapCountIncrements, 1, "Core must increment _wrapCount in exactly one place");
  assert.equal(pactWrapCountIncrements, 1, "Pact must increment _wrapCount in exactly one place");
  // And that one place must be reached from the "rolling" branch, not from wrapResult's handler.
  const rollingBlock = src.slice(src.indexOf('if (data.kind === "rolling"'), src.indexOf('if (data.kind === "wrapPreview"'));
  assert.ok(rollingBlock.includes("_wrapCount"), "Core's rolling branch must be where the counter lives");
  const wrapResultBlock = src.slice(src.indexOf('if (data.kind === "wrapResult"'), src.indexOf('if (data.kind === "wrapResult"') + 400);
  assert.ok(!wrapResultBlock.includes("_wrapCount ="), "Core's wrapResult branch must NOT also increment it");
});

test("wiring: compactions reset to zero on a roll, so the per-window count cannot survive into the fresh window", () => {
  assert.ok(src.includes("p._compactCount = 0"), "Core must reset the compaction counter on 'rolling'");
  assert.ok(src.includes("t._compactCount = 0"), "Pact must reset the compaction counter on 'rolling'");
});

test("wiring: wrapPreview/wrapResult events are both routed to real handlers in both workspaces", () => {
  assert.ok(src.includes('if (data.kind === "wrapPreview")'), "Core must handle the wrapPreview event");
  assert.ok(src.includes('if (data.kind === "wrapResult")'), "Core must handle the wrapResult event");
  assert.ok(src.includes('case "wrapPreview":'), "Pact must handle the wrapPreview event");
  assert.ok(src.includes('case "wrapResult":'), "Pact must handle the wrapResult event");
});

test("wiring: the split Compact|Wrap control exists in both workspaces' real controls bar", () => {
  assert.ok(src.includes('el("button", { class: "ws-ico ws-wrap"'), "Core's controls bar must have a real Wrap button");
  assert.ok(src.includes('el("button", { class: "pact-ed-ico pact-wrap"'), "Pact's controls bar must have a real Wrap button");
});

test("wiring: the dialog is opened via the pane-scoped primitive (Topic 5), never a viewport-fixed one", () => {
  assert.ok(src.includes("wsOpenPaneDialog(ui.root,"), "Core's wrap dialog must be scoped to the pane");
  assert.ok(src.includes('wsOpenPaneDialog(paneEl, { title: "⟳ Wrap'), "Pact's wrap dialog must be scoped to its pane (.pact-right)");
});

test("wiring: 'wrapNow'/'wrapPreview' are in the allowed control-action set (lib/protocol.mjs)", () => {
  const proto = readFileSync(join(__dir, "..", "lib", "protocol.mjs"), "utf8");
  assert.ok(proto.includes('"wrapPreview"') && proto.includes('"wrapNow"'), "both new control actions must be allowlisted");
});
