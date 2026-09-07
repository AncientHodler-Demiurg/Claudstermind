// node --test lib/exoRelocation.test.mjs
// The exocortex's REAL ctx/agents/jump chips used to render as their own second bar (.exo-bar),
// stacked directly on top of the new header stats row (lib/coreHeaderStats.test.mjs /
// lib/pactHeaderStats.test.mjs) — which is why production still didn't visually match the chat-shell
// lab even after that pass. This re-homes the SAME nodes (never recreated, never faked) into the lab's
// actual slots: agents chip → header row, ctx chip → hidden + proxied from the existing raw-number
// readout (thousand separators, an explicit earlier request), jump/recall → a real search drawer on
// the compose field. Wiring-presence checks (app.js "boots the DOM"), same convention as the rest of
// this migration's tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

test("wiring: Core relocates the real exocortex chips out of the old stacked bar", () => {
  assert.ok(src.includes('exo.root.querySelector(".exo-chip-agents")'), "must grab the REAL agents chip node, not build a new one");
  assert.ok(src.includes('exo.root.querySelector(".exo-chip-ctx")'), "must grab the REAL ctx chip node");
  assert.ok(src.includes('exo.root.querySelector(".exo-jump")'), "must grab the REAL jump/recall group");
  assert.ok(src.includes("view.els.statusSlot.appendChild(exoAgentsChip)"), "agents chip must move into the shell's header status slot");
  assert.ok(src.includes("searchDrawer.appendChild(exoJumpGroup)"), "jump/recall must move into the compose-field search drawer");
});

test("wiring: Core's ctx chip is hidden (not deleted) and proxied from the visible readout", () => {
  // "badge.style.cursor" only exists in Core's block — Pact's equivalent uses "usageEl" — so anchoring
  // on it (rather than the shared "if (exoCtxChip) {" text, which appears in BOTH workspaces) actually
  // isolates Core's copy instead of accidentally matching whichever one appears first in the file.
  const anchor = src.indexOf("badge._exoProxy = exoCtxChip;");
  assert.ok(anchor > 0, "Core's ctx-chip block must exist");
  const block = src.slice(anchor - 200, anchor + 300);
  assert.ok(block.includes("exoCtxChip.hidden = true;"), "must hide, never delete — its click is what polls the server");
  // The visible readout is the package's context button; its `on.context` callback proxies the real
  // click onto the hidden chip, so "click for the breakdown" still polls the server for a fresh read.
  assert.ok(src.includes("context: () => { const c = view.els.contextBtn._exoProxy; if (c) c.click(); },"),
    "the visible readout must proxy a real click, not a re-implementation");
});

test("wiring: Core's search drawer exists, is closed by default, and toggles on the field's own button", () => {
  // The drawer is the mounted shell's own — closed by default and toggled by the field's ⌒ button,
  // both inside the package (see lib/chatShellPackage.test.mjs, which clicks it for real).
  assert.ok(src.includes("const searchDrawer = view.els.searchDrawer;"),
    "Core must use the mounted shell's drawer, not build a second one alongside it");
  // The type box has a full-width row of its own, with the action buttons beneath it — the package's
  // own structure, asserted by mounting it in lib/chatShellPackage.test.mjs.
  assert.ok(src.includes("const promptEl = view.els.typebox;"),
    "Core's compose field must be the mounted shell's own, with its gutter and search toggle");
});

test("wiring: Pact gets the identical relocation, desktop only", () => {
  assert.ok(src.includes("if (exoMount && !mob) {"), "Pact's relocation must be gated the same way every other Pact desktop-only feature is");
  assert.ok(src.includes("headActions.insertBefore(exoAgentsChip, add)"), "Pact's agents chip must move into its head-actions row");
  assert.ok(src.includes("pactSearchDrawer.appendChild(exoJumpGroup)"), "Pact's jump/recall must move into its own search drawer");
  // The ctx wiring can only be completed AFTER the mount: the node the user sees is the PACKAGE's
  // chip, which does not exist while the relocation block runs. Wiring it there — which is what this
  // used to assert — pointed the popover's anchor at the local `usageEl` the mount then replaces,
  // and left `on.context` calling `usageEl.click()` on what had become the package's OWN button:
  // a button clicking itself, i.e. unbounded recursion instead of a breakdown.
  assert.ok(src.includes("if (exoCtxChip) exoCtxChip._visProxy = usageEl;"),
    "Pact must point the popover's anchor at the visible chip AFTER the mount has produced it");
  assert.ok(src.includes("context: () => { if (exoCtxChip) exoCtxChip.click(); },"),
    "…and proxy the click onto the hidden REAL exo chip, the same way Core's on.context does");
  assert.ok(!src.includes("context: () => usageEl.click(),"),
    "the self-referential handler must be gone, not left beside the fix");
  assert.ok(src.includes("input = pv.els.typebox;"), "Pact's desktop compose field must be the mounted shell's own");
});

test("wiring: the old .exo-bar/.exo-edges/.exo-cues no longer paint their own background/border strip", () => {
  const cssSrc = readFileSync(join(__dir, "..", "dashboard", "public", "styles.css"), "utf8");
  const barRule = cssSrc.slice(cssSrc.indexOf(".exo-bar {"), cssSrc.indexOf(".exo-bar {") + 200);
  assert.ok(!barRule.includes("background: var(--panel2)"), ".exo-bar must not paint its own background any more");
  const edgesRule = cssSrc.slice(cssSrc.indexOf(".exo-edges {"), cssSrc.indexOf(".exo-edges {") + 120);
  assert.ok(!edgesRule.includes("border-bottom"), ".exo-edges must not draw a separating border any more");
});
