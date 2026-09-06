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
const { wsDefaultConvSlots, wsNextConvSlot, wsAddConvSlotEntry, wsWorkspaceIdForSlot } =
  new Function(block + "\nreturn { wsDefaultConvSlots, wsNextConvSlot, wsAddConvSlotEntry, wsWorkspaceIdForSlot };")();

test("wsDefaultConvSlots: exactly one slot, Master, numbered 0", () => {
  assert.deepEqual(wsDefaultConvSlots(), [{ slot: 0, name: "Master" }]);
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
  assert.deepEqual(slots, [{ slot: 0, name: "Master" }, { slot: 1, name: "My chat" }]);
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

test("wiring: every wsWorkspaceId(p.repo, p.worktree, …) call site is slot-aware — none silently reads Master's id for a non-Master conversation", () => {
  const bareCalls = (src.match(/wsWorkspaceId\(p\.repo, p\.worktree\)/g) || []).length
    + (src.match(/wsWorkspaceId\(data\.repo \|\| p\.repo, data\.worktree \|\| p\.worktree\)/g) || []).length;
  assert.equal(bareCalls, 0,
    "every call site that has a pane `p` in scope must pass wsPaneSlot(p) (or an equivalent slot) as a 3rd argument");
  assert.ok(src.includes("function wsPaneSlot(p)"), "the shared slot-resolution helper must exist");
});
