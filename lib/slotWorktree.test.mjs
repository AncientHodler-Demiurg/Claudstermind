// node --test lib/slotWorktree.test.mjs
//
// THE WORKTREE BELONGS TO THE CONVERSATION, NOT TO THE BOX.
//
//   "Went to the Chat 2 page, wrote Exocortex on the first line, then wanted to move to the Master
//    chat. Exocortex was still selected in the workspace. Master chat must be tied always and
//    directly to the main workspace … I selected it, but the text bubbles of the main workspace
//    didn't appear, I had to force a reload of the page."
//
// Two defects in one flow.
//
//  1. Core kept `worktree` on the PANE. Conversation slots were added later and share that pane, so
//     putting Chat 2 on `exocortex` moved every other conversation in the box — including ★ Master —
//     onto `exocortex` too. Pact has never had this problem: its worktree has always been per-tab
//     (`t.worktree`). This brings Core to Pact's model, which is the one the user describes.
//
//  2. Changing the worktree re-keyed the pane and repainted it, and NEVER FETCHED the conversation
//     that key names. The pane simply showed whatever it had. The only thing that loads a
//     conversation for a repointed pane was a page reload, which is exactly what had to be done.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const lift = (...names) => {
  const body = names.map((n) => { const at = app.indexOf("function " + n); return app.slice(at, app.indexOf("\n}", at) + 2); }).join("\n");
  return new Function(body + "return {" + names.join(",") + "};")();
};

test("★ Master is tied to main, and nothing can move it", () => {
  const { wsSlotWorktree, wsSetSlotWorktree, wsDefaultConvSlots } =
    lift("wsSlotWorktree", "wsSetSlotWorktree", "wsDefaultConvSlots");
  const slots = wsDefaultConvSlots();
  assert.equal(wsSlotWorktree(slots, 0), "main", "the master's worktree is not a preference");
  const moved = wsSetSlotWorktree(slots, 0, "exocortex");
  assert.equal(wsSlotWorktree(moved, 0), "main", "…and an attempt to move it is a no-op, not a silent write");
});

test("every other conversation carries its own worktree", () => {
  const { wsSlotWorktree, wsSetSlotWorktree, wsAddConvSlotEntry, wsDefaultConvSlots, wsNextConvSlot } =
    lift("wsSlotWorktree", "wsSetSlotWorktree", "wsAddConvSlotEntry", "wsDefaultConvSlots", "wsNextConvSlot");
  let { slots, slot } = wsAddConvSlotEntry(wsDefaultConvSlots());
  assert.equal(wsSlotWorktree(slots, slot), "main", "a new chat starts where you are — on main");
  slots = wsSetSlotWorktree(slots, slot, "exocortex");
  assert.equal(wsSlotWorktree(slots, slot), "exocortex", "…and remembers where you put it");
  assert.equal(wsSlotWorktree(slots, 0), "main",
    "…WITHOUT dragging the master along, which is the whole bug: one worktree on a shared pane");
  const r2 = wsAddConvSlotEntry(slots);
  assert.equal(wsSlotWorktree(r2.slots, r2.slot), "main", "a third chat is unaffected by the second's move");
  assert.equal(wsSlotWorktree(slots, 99), "main", "a slot that isn't there resolves to main, never undefined");
});

test("switching conversations takes its worktree with it", () => {
  const at = app.indexOf("function wsSwitchConvSlot");
  const body = app.slice(at, app.indexOf("\n  }", at));
  assert.match(body, /const wt = wsSlotWorktree\(p\.convSlots, slot\);/,
    "the slot decides the worktree, before the key is derived from it");
  assert.match(body, /wsWorkspaceId\(p\.repo, wt, slot\)/,
    "…or the key would be built from the worktree you are LEAVING");
  assert.match(body, /p\.worktree = wt;/, "…and the picker must show where you actually are");
});

test("repointing a pane FETCHES the conversation that key names", () => {
  assert.match(app, /function wsOpenPaneConversation\(p, mode\)/,
    "one place that repoints a pane and then actually asks for its conversation");
  const at = app.indexOf("function wsOpenPaneConversation(p, mode)");
  const fn = app.slice(at, app.indexOf("\n  }", at));
  assert.match(fn, /p\._loadedOnce = false;/,
    "…and says 'loading', not 'empty' — the two are different claims and only one is true here");
  assert.match(fn, /beginPendingOpen\(p\.sessionKey, p, mode\)/);
  assert.match(fn, /action: "open"/, "the request itself — its absence is why a reload was the only cure");
  // Both selectors: a repo change had the identical hole.
  assert.equal((app.match(/wsOpenPaneConversation\(p, "conv-switch"\)/g) || []).length, 2,
    "the worktree picker AND the repo picker — both repoint the pane, both must load what they point at");
});

test("the Master's picker says it is tied, instead of silently refusing", () => {
  const at = app.indexOf("function fillWorktreeSelect");
  const body = app.slice(at, app.indexOf("\n  }", at));
  assert.match(body, /const pinned = !!p\.multiChat && !wsPaneSlot\(p\);/,
    "only a MULTI-CHAT box has a Master to tie — a single-chat pane picks freely, as it always has");
  assert.match(body, /sel\.disabled = pinned;/);
  assert.match(body, /★ Master always runs on main/,
    "a control that refuses without saying why is a control that lies");
});

test("a layout saved before this keeps the worktree it had", () => {
  // The worktree used to live on the pane. Snapping every upgraded layout to main would be a silent
  // loss of the one choice that was actually made, so the pane's value is adopted INTO its slot once.
  const at = app.indexOf("MIGRATION: a layout saved before the worktree became per-conversation");
  assert.ok(at > -1, "the upgrade path must be explicit, not assumed");
  const body = app.slice(at, at + 900);
  assert.match(body, /p\.convSlots = wsSetSlotWorktree\(p\.convSlots, wsPaneSlot\(p\), p\.worktree\)/);
  assert.match(body, /p\.worktree = p\.multiChat \? wsSlotWorktree\(p\.convSlots, wsPaneSlot\(p\)\)/,
    "…and afterwards the slot is the source of truth");
});
