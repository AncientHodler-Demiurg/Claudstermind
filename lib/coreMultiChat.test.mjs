// node --test lib/coreMultiChat.test.mjs
// Core's multi-chat toggle — confirmed ABSENT before this (zero references in app.js). These are the
// pure conversation-slot helpers, sliced from the browser monolith (dashboard/public/app.js), same
// convention as lib/pactGutter.test.mjs. Off by default: one repository usually means one thread
// (round 33 design). Slot 0 is always "Master" and always exists — mirrors Pact's own "first tab is
// prime, can't be closed" rule.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== CORE MULTI-CHAT — pure conversation-slot helpers";
const end = "// ===== end CORE MULTI-CHAT pure helpers =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "core multi-chat helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { wsDefaultConvSlots, wsNextConvSlot, wsAddConvSlotEntry, wsWorkspaceIdForSlot, wsMergeConvSlotsFromHistory } =
  new Function(block + "\nreturn { wsDefaultConvSlots, wsNextConvSlot, wsAddConvSlotEntry, wsWorkspaceIdForSlot, wsMergeConvSlotsFromHistory };")();

test("wsDefaultConvSlots: exactly one slot, Master, numbered 0", () => {
  // `worktree` is additive (see lib/slotWorktree.test.mjs): the worktree belongs to the conversation,
  // not to the box, and the Master's is "main" by definition rather than by preference.
  assert.deepEqual(wsDefaultConvSlots(), [{ slot: 0, name: "Master", worktree: "main" }]);
});

test("wsNextConvSlot: 1 past the highest existing slot number", () => {
  assert.equal(wsNextConvSlot([{ slot: 0, name: "Master" }]), 1);
  assert.equal(wsNextConvSlot([{ slot: 0, name: "Master" }, { slot: 1, name: "Chat 2" }, { slot: 3, name: "Chat 4" }]), 4);
});

test("wsNextConvSlot: an empty/missing list is treated as just Master", () => {
  assert.equal(wsNextConvSlot([]), 1);
  assert.equal(wsNextConvSlot(null), 1);
  assert.equal(wsNextConvSlot(undefined), 1);
});

test("wsAddConvSlotEntry: appends a new slot without mutating the input array", () => {
  const before = [{ slot: 0, name: "Master" }];
  const { slots, slot } = wsAddConvSlotEntry(before, "My chat");
  assert.equal(slot, 1);
  assert.deepEqual(slots, [{ slot: 0, name: "Master" }, { slot: 1, name: "My chat", worktree: "main" }],
    "a new chat starts on main and says so — the entry it copies from is left exactly as it was");
  assert.deepEqual(before, [{ slot: 0, name: "Master" }], "the original array must not be mutated");
});

test("wsAddConvSlotEntry: default-names an unnamed slot from its position", () => {
  const { slots } = wsAddConvSlotEntry([{ slot: 0, name: "Master" }]);
  assert.equal(slots[1].name, "Chat 2");
});

test("wsWorkspaceIdForSlot: slot 0 (or falsy) is BYTE-IDENTICAL to today's id — zero risk to existing data", () => {
  assert.equal(wsWorkspaceIdForSlot("repo", "main", 0), "repo@main");
  assert.equal(wsWorkspaceIdForSlot("repo", "main", undefined), "repo@main");
  assert.equal(wsWorkspaceIdForSlot("repo", "main", null), "repo@main");
});

test("wsWorkspaceIdForSlot: a non-zero slot gets a distinct, stable suffix", () => {
  assert.equal(wsWorkspaceIdForSlot("repo", "main", 1), "repo@main#1");
  assert.equal(wsWorkspaceIdForSlot("repo", "main", 2), "repo@main#2");
  assert.notEqual(wsWorkspaceIdForSlot("repo", "main", 1), wsWorkspaceIdForSlot("repo", "main", 2));
});

test("wsWorkspaceIdForSlot: no repo is still null, exactly like today's wsWorkspaceId", () => {
  assert.equal(wsWorkspaceIdForSlot(null, "main", 1), null);
});

// Wiring presence checks — app.js can't be wholesale eval'd (it boots the DOM), so these confirm the
// toggle/tab-strip/persistence call sites exist and can't silently regress, same honesty note as
// lib/replyQuote.test.mjs: this proves presence, not rendered behavior.
test("wiring: the toggle is off by default and always collapses to slot 0 when off", () => {
  assert.ok(src.includes("multiChat: false, convSlot: 0, convSlots: wsDefaultConvSlots()"),
    "a brand-new pane must start with multi-chat off");
  assert.ok(src.includes("p.multiChat ? p.convSlot : 0"),
    "assignKey/keyForPane must ignore any stored convSlot while multi-chat is off");
});

test("wiring: multiChat/convSlot/convSlots survive a save+load round trip", () => {
  assert.ok(src.includes("multiChat: !!p.multiChat, convSlot: p.convSlot || 0, convSlots:"),
    "saveLayout must persist the multi-chat fields, or a refresh would silently reset the toggle");
  assert.ok(src.includes('multiChat: !!p.multiChat,') && src.includes("convSlots: Array.isArray(p.convSlots) && p.convSlots.length"),
    "loadLayout must restore them");
});

test("wiring: switching a slot reuses the SAME restore mechanism as boot-time reattachment", () => {
  assert.ok(src.includes('beginPendingOpen(newKey, p, "conv-switch")'),
    "a live slot switch must go through beginPendingOpen, exactly like restorePanes()'s boot-time reattach");
});

// wsMergeConvSlotsFromHistory — "multichat is on and there are 2 chats on desktop, main and
// exocortex. Why don't I see the same thing on mobile? It has to be tied to the same thing, not
// independent." p.convSlots is localStorage on ONE device. This discovers a slot ANOTHER device
// created by reading the same `history` every device already fetches — no new storage, no new API.
test("wsMergeConvSlotsFromHistory: discovers a slot conversation another device created", () => {
  const history = [{ repo: "Claudstermind", worktree: "exocortex", workspaceId: "Claudstermind@exocortex#1", firstPrompt: "Exocortex work" }];
  const merged = wsMergeConvSlotsFromHistory(wsDefaultConvSlots(), history, "Claudstermind");
  assert.deepEqual(merged, [
    { slot: 0, name: "Master", worktree: "main" },
    { slot: 1, name: "Exocortex work", worktree: "exocortex" },
  ]);
});

test("wsMergeConvSlotsFromHistory: a slot this device already knows about is left untouched, even mid-edit", () => {
  const local = [{ slot: 0, name: "Master", worktree: "main" }, { slot: 1, name: "Chat 2", worktree: "main" }];
  const history = [{ repo: "Claudstermind", worktree: "exocortex", workspaceId: "Claudstermind@exocortex#1", firstPrompt: "renamed elsewhere" }];
  const merged = wsMergeConvSlotsFromHistory(local, history, "Claudstermind");
  assert.deepEqual(merged.find((s) => s.slot === 1), { slot: 1, name: "Chat 2", worktree: "main" },
    "a merge must never overwrite a name/worktree the local device already has for that slot");
});

test("wsMergeConvSlotsFromHistory: rows from other repos, and the Master row itself, are ignored", () => {
  const history = [
    { repo: "OtherRepo", worktree: "main", workspaceId: "OtherRepo@main#1", firstPrompt: "not ours" },
    { repo: "Claudstermind", worktree: "main", workspaceId: "Claudstermind@main", firstPrompt: "the master conversation" },
  ];
  assert.deepEqual(wsMergeConvSlotsFromHistory(wsDefaultConvSlots(), history, "Claudstermind"), wsDefaultConvSlots());
});

test("wsMergeConvSlotsFromHistory: nothing to discover returns the CALLER'S OWN array (no needless re-render)", () => {
  const local = wsDefaultConvSlots();
  assert.equal(wsMergeConvSlotsFromHistory(local, [], "Claudstermind"), local);
  assert.equal(wsMergeConvSlotsFromHistory(local, null, "Claudstermind"), local);
  assert.equal(wsMergeConvSlotsFromHistory(local, [{ repo: "Claudstermind", workspaceId: "Claudstermind@main" }], "Claudstermind"), local);
});

test("wiring: every device that fetches history merges it into its own convSlots — the actual fix, not just the pure helper", () => {
  assert.ok(src.includes("wsMergeConvSlotsFromHistory(p.convSlots, st.history, p.repo)"),
    "the history handler (run on every device, mobile included) must merge discovered slots into every pane's own list");
});

test("wiring: every wsWorkspaceId(p.repo, p.worktree, …) call site is slot-aware — none silently reads Master's id for a non-Master conversation", () => {
  const bareCalls = (src.match(/wsWorkspaceId\(p\.repo, p\.worktree\)/g) || []).length
    + (src.match(/wsWorkspaceId\(data\.repo \|\| p\.repo, data\.worktree \|\| p\.worktree\)/g) || []).length;
  assert.equal(bareCalls, 0,
    "every call site that has a pane `p` in scope must pass wsPaneSlot(p) (or an equivalent slot) as a 3rd argument");
  assert.ok(src.includes("function wsPaneSlot(p)"), "the shared slot-resolution helper must exist");
});
