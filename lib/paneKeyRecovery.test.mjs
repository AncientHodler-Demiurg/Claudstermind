// node --test lib/paneKeyRecovery.test.mjs
//
// THE DEAD END: a Core pane whose stored sessionKey names a conversation the engine has never heard
// of rendered EMPTY FOREVER — one toast you may not have been looking at, then a blank box with a
// repo selected, a working model row, and nothing to tell you what was wrong.
//
// Reproduced exactly, headless, against the live engine: a pane keyed to a removed conversation
// rendered a single line — "⚠ That conversation could not be opened." — and kept that key across
// reloads, because nothing ever revisited it. That is the reported screenshot, byte for byte.
//
// A key can outlive its conversation in several ordinary ways: a session file removed on disk, a
// layout restored against an older store, a conversation opened from history and later deleted. For
// a CORE pane the canonical key is derivable — repo + worktree + slot — so the pane can repair
// itself instead of sitting there.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
// The recovery lives in the "open failed" branch; slice it so these assertions cannot be satisfied
// by similar-looking code somewhere else in a 15k-line file.
const i = app.indexOf("// A DEAD END, MADE RECOVERABLE.");
const branch = app.slice(i, app.indexOf("\n      }", i));

test("the recovery exists, and only inside the open-failure branch", () => {
  assert.ok(i > 0, "an open that fails must attempt a repair");
  assert.ok(app.slice(0, i).includes('if (data.kind === "error" && sessionKey && st.pendingOpens.has(sessionKey))'),
    "…and it must hang off the error that actually reports it");
});

test("it re-derives the CANONICAL key rather than guessing one", () => {
  assert.match(branch, /const canonical = wsWorkspaceId\(p\.repo, p\.worktree, wsPaneSlot\(p\)\);/,
    "repo + worktree + slot is the one derivation every other call site uses; a second formula would "
    + "reattach a pane to a different conversation's history");
  assert.match(branch, /if \(!p \|\| !p\.repo \|\| p\._reKeyed\) continue;/,
    "a pane with no repo has nothing to derive from, and must be left alone");
});

test("it runs AT MOST ONCE per pane — a canonical key that also fails is a real absence", () => {
  assert.match(branch, /p\._reKeyed = true;/, "the attempt must be recorded before it is made");
  assert.ok(branch.indexOf("p._reKeyed = true;") < branch.indexOf('wsPost("control", { action: "open"'),
    "…and recorded BEFORE the reopen, or a failing reopen would loop");
  assert.match(branch, /if \(!canonical \|\| canonical === p\.sessionKey\) continue;/,
    "retrying the key that just failed is the same loop by another route");
});

test("the pane is left in a coherent state, and the change is persisted", () => {
  for (const [needle, why] of [
    ["p.sessionKey = canonical;", "the pane must actually adopt the new key"],
    ["p.transcript = []", "stale rows from the failed key must not linger under the new one"],
    ["ui._txRef = null", "…and the render cache keyed to them must go with it"],
    ["saveLayout();", "or the next reload lands on the dead key again"],
    ['wsPost("control", { action: "open"', "the repair is only real once the new key is actually opened"],
  ]) assert.ok(branch.includes(needle), why);
});

test("it SAYS what it did — a silent re-point would be its own kind of confusing", () => {
  assert.match(branch, /logActivity\(p, "↻ That conversation is gone/,
    "the reader must be told their pane was reattached, and to what");
  assert.match(branch, /if \(interactive && !recovered\) note\(/,
    "the old toast stays for the cases that could NOT be repaired, and is suppressed for the ones that were");
});
