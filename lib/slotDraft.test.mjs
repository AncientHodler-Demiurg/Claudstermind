// node --test lib/slotDraft.test.mjs
//
// "Moving between chats of the same repository preserves the text I typed in the master chat, when
//  in fact the exocortex chat should have its own chat typing text save capabilities."
//
// Pact has had this since it had tabs: every tab carries its own `t.draft`, saved on every keystroke
// and restored when you return to it. Core kept ONE `p.draft` on the pane, and conversation slots
// were added afterwards and share that pane — so a half-written message followed you from Master into
// Chat 2 and back, and whichever conversation you sent from consumed it.
//
// This is the same defect as the worktree one fixed in 1.20.8, in a second place: state that belongs
// to the CONVERSATION stored on the BOX. The transcript was already kept per slot (`_slotTx`); the
// draft simply never was.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

test("switching conversations parks the draft you were writing and hands back the other one", () => {
  const at = app.indexOf("function wsSwitchConvSlot");
  const body = app.slice(at, app.indexOf("\n  }", at));
  assert.match(body, /p\._slotDraft\[wsPaneSlot\(p\)\] = /,
    "the message you are half-way through must be parked against the conversation you are LEAVING");
  assert.match(body, /p\.draft = typeof p\._slotDraft\[slot\] === "string" \? p\._slotDraft\[slot\] : "";/,
    "…and the one you are returning to handed back, empty if it has none");
  // Parking it in state is not enough — the BOX has to show it, and the box is a real textarea whose
  // value nothing else rewrites (paintPane deliberately never does: it would clobber your typing).
  assert.match(body, /ui\.promptEl\.value = p\.draft;/, "the desktop box");
  assert.match(body, /wsAutoResizePrompt\(ui\.promptEl\)/, "…sized to what it now holds, not to what it held");
});

test("the draft is read from the BOX, not from the last keystroke handler", () => {
  // `p.draft` lags: it is written by an `input` listener and by a debounced save. Parking the stale
  // copy would lose whatever was typed since. The live value is the element's.
  const at = app.indexOf("function wsSwitchConvSlot");
  const body = app.slice(at, app.indexOf("\n  }", at));
  assert.match(body, /_ui && _ui\.promptEl \? _ui\.promptEl\.value : \(p\.draft \|\| ""\)/,
    "read the element; fall back to the mirror only when there is no element");
});

test("drafts survive a reload, one per conversation", () => {
  assert.match(app, /slotDrafts: p\._slotDraft \|\| \{\}/, "saved with the layout, like every other per-slot thing");
  assert.match(app, /_slotDraft: \(p\.slotDrafts && typeof p\.slotDrafts === "object" && !Array\.isArray\(p\.slotDrafts\)\) \? p\.slotDrafts : \{\}/,
    "…and restored defensively: a hand-edited or older layout must not crash the boot");
});

test("sending clears only the conversation you sent from", () => {
  const at = app.indexOf('p.draft = ""; p._slotDraft = p._slotDraft || {};');
  assert.ok(at > -1, "the send path must clear the draft it just consumed");
  const line = app.slice(at, at + 200);
  assert.match(line, /p\._slotDraft\[wsPaneSlot\(p\)\] = ""/,
    "or the sent text stays parked against this conversation and comes back the next time you open it");
});
