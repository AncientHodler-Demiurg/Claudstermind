// node --test lib/convSlotQueueIsolation.test.mjs
//
// THE REPORT: "also i had this text here, sitting as orange text [a message meant for Master] ...
// and then i switched to the other tab, exocortex, and then those orange bubbles were suddenly
// there as well, and were applied there, so this jumping between tab must also be a bug that needs
// fixing."
//
// Root cause: Core's multi-chat conv-slots already isolate a pane's TRANSCRIPT (`p._slotTx`) and
// DRAFT (`p._slotDraft`) per slot when switching tabs (wsSwitchConvSlot) — but the QUEUE
// (`p._queue`, the orange "queued — sending when this turn finishes" bubbles) was never added to
// that isolation. It stayed pane-level, so a message queued because Master was busy survived a
// switch to Exocortex sitting right there in `p._queue` — and every send site reads the PANE's
// CURRENT repo/worktree/sessionKey at drain time, so draining later fired it into whichever
// conversation happened to be active by then, not the one it was actually typed for.
//
// This file pins the fix via source-text verification — the same convention used elsewhere in this
// suite (chatShellProdWiring.test.mjs, msgCornerRow.test.mjs, pactDraftRestoreRace.test.mjs) for
// app.js logic too deeply embedded in UI closures (st, paneUI, paintPane, wsPost, localStorage, …)
// to extract and execute in isolation.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

function body(fnSignature) {
  const i = app.indexOf(fnSignature);
  assert.ok(i >= 0, `${fnSignature} must exist in app.js`);
  // Grab a generous slice — these functions are long; callers match on substrings within it.
  return app.slice(i, i + 4500);
}

test("wsSwitchConvSlot stashes the LEAVING slot's queue and restores the ARRIVING slot's — the actual fix", () => {
  const b = body("function wsSwitchConvSlot(p, slot, fresh) {");
  assert.match(b, /p\._slotQueue = p\._slotQueue \|\| \{\};/, "a per-slot stash must exist, mirroring _slotTx/_slotDraft");
  assert.match(b, /if \(Array\.isArray\(p\._queue\) && p\._queue\.length\) p\._slotQueue\[wsPaneSlot\(p\)\] = p\._queue;/,
    "the queue being LEFT must be stashed under the OLD slot number — read via wsPaneSlot(p) BEFORE p.convSlot is reassigned");
  assert.match(b, /wsQueueSet\(p, p\._slotQueue\[slot\]\);/,
    "the queue for the slot being ENTERED must be restored from the stash THROUGH wsQueueSet — the one place p._queue is ever assigned (see mobileCockpitWiring.test.mjs's own invariant) — not a second direct assignment");
  // Ordering matters: the stash-write must happen before p.convSlot is reassigned (else wsPaneSlot(p)
  // would already report the NEW slot while stashing what belongs to the OLD one).
  const stashAt = b.indexOf("p._slotQueue[wsPaneSlot(p)] = p._queue;");
  const reassignAt = b.indexOf("p.convSlot = slot;");
  assert.ok(stashAt >= 0 && reassignAt > stashAt, "the stash must read the OLD slot number before convSlot changes");
});

test("wsQueueSave persists every slot's queue, not just the currently-active one", () => {
  const b = body("function wsQueueSave() {");
  assert.match(b, /const bySlot = \{ \.\.\.\(p\._slotQueue \|\| \{\}\) \};/,
    "inactive slots' stashed queues (p._slotQueue) must be included in what gets saved, or a reload would lose them");
  assert.match(b, /if \(Array\.isArray\(p\._queue\) && p\._queue\.length\) bySlot\[wsPaneSlot\(p\)\] = p\._queue;/,
    "the ACTIVE slot's queue (p._queue, not yet folded into _slotQueue) must also be included");
});

test("wsQueueRestore reattaches a restored queue to the RIGHT slot — straight onto p._queue if active, into _slotQueue if not", () => {
  const b = body("function wsQueueRestore() {");
  assert.match(b, /if \(slot === wsPaneSlot\(p\)\) wsQueueSet\(p, \(p\._queue \|\| \[\]\)\.concat\(items\)\);/);
  assert.match(b, /else p\._slotQueue\[slot\] = \(p\._slotQueue\[slot\] \|\| \[\]\)\.concat\(items\);/);
  // Backward compatibility: a save written before this fix shipped is a bare array under the pane
  // id, not {slot: items} — must still restore (as slot 0), not be silently dropped.
  assert.match(b, /Array\.isArray\(saved\) \? \{ 0: saved \}/, "an old-shape (pre-fix) saved queue must still be read back, as slot 0");
});

test("wsQueueClearAll wipes every slot's stash — used where the pane's WHOLE identity changes, never by the ordinary per-turn drain", () => {
  const b = body("function wsQueueClearAll(p) {");
  assert.match(b, /p\._slotQueue = \{\};/);
  assert.match(b, /wsQueueSet\(p, null\);/);

  // The three true "this pane is now a different conversation entirely" sites use it...
  assert.match(app, /wsQueueClearAll\(p\); p\._gen = \(p\._gen \|\| 0\) \+ 1; assignKey\(p\); wsOpenPaneConversation\(p, "conv-switch"\)/,
    "repo-select change");
  assert.match(app, /wsQueueClearAll\(p\);   \/\/ anything queued for the OLD session — on ANY slot — must never fire into the fresh one/,
    "the × clear-pane button");
  assert.match(app, /wsQueueClearAll\(p\); p\._gen = \(p\._gen \|\| 0\) \+ 1;\s*\n\s*assignKey\(p\);/,
    "the mobile repo-picker / sidebar repo pick path");

  // ...while drainQueue — the ORDINARY per-turn clear, which fires every time ANY slot's busy turn
  // ends — must NOT use it, or every other tab's legitimately queued message would be wiped out
  // the moment any unrelated tab's turn finishes.
  const drainBody = body("function drainQueue(p) {");
  assert.match(drainBody, /wsQueueSet\(p, null\);/, "drainQueue clears only the active slot's own queue...");
  assert.ok(!/wsQueueClearAll/.test(drainBody), "...and must NEVER call wsQueueClearAll — that would cross-wipe every other tab's queue");
});

test("the worktree-change path clears only the slot actually being moved, not every tab's queue (\"no other chat in the box moves with it\")", () => {
  const i = app.indexOf('p.convSlots = wsSetSlotWorktree(p.convSlots, wsPaneSlot(p), v || "main");');
  assert.ok(i >= 0, "the worktree-change handler must exist");
  const slice = app.slice(i, i + 600);
  assert.match(slice, /if \(p\._slotQueue\) delete p\._slotQueue\[wsPaneSlot\(p\)\];/,
    "only THIS slot's stash is cleared — a full wsQueueClearAll here would wipe every other tab's queue even though only one tab's worktree changed");
  assert.ok(!/wsQueueClearAll/.test(slice), "must not use the all-slots clear for a single-slot worktree change");
});

test("closing a conv-slot tab (×) drops that slot's stashed queue too, so a REUSED slot number can never resurrect a closed tab's stale queued message", () => {
  const b = body("function wsCloseConvSlot(p, slot) {");
  assert.match(b, /if \(p\._slotTx\) delete p\._slotTx\[slot\];/, "sanity: the existing _slotTx cleanup this mirrors");
  assert.match(b, /if \(p\._slotQueue\) delete p\._slotQueue\[slot\];/);
});
