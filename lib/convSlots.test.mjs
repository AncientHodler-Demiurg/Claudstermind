// node --test lib/convSlots.test.mjs
//
// Conversation slots — the ★ master plus any number of side conversations inside one Core pane.
// Three reports, all from one session of actually using it:
//   "coming back from chat 2 to main chat … the main conversation doesn't load, I need to hit refresh"
//   "the chat 2 new conversation needs an X button to close it"
//   "the first line in the first prompt must define the chat's name, same as in pact"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const css = readFileSync(join(__dir, "..", "dashboard", "public", "styles.css"), "utf8");
/** Lift a pure helper out of the browser monolith and run it for real. */
const lift = (...names) => {
  const body = names.map((n) => { const at = app.indexOf("function " + n); return app.slice(at, app.indexOf("\n}", at) + 2); }).join("\n");
  return new Function("wsDefaultConvSlots", body + "return {" + names.join(",") + "};")(() => [{ slot: 0, name: "Master" }]);
};

test("switching conversations keeps what you were reading", () => {
  // It used to clear the transcript and wait for an `open` round-trip to refill it — so the pane was
  // empty for as long as that took, and PERMANENTLY empty when the reply never landed: the
  // resolution discards a reply whose `gen` has moved on, and the 8s timeout only clears the flag.
  // Either way you were left looking at nothing, with a reload as the only way back.
  const at = app.indexOf("function wsSwitchConvSlot");
  const body = app.slice(at, app.indexOf("\n  }", at));
  assert.match(body, /p\._slotTx\[wsPaneSlot\(p\)\] = p\.transcript/,
    "the conversation you are LEAVING must be kept, or returning to it needs a network round-trip");
  assert.match(body, /p\.transcript = Array\.isArray\(p\._slotTx\[slot\]\) \? p\._slotTx\[slot\] : \[\]/,
    "…and the one you are RETURNING to must be on screen immediately");
  assert.ok(!/p\.transcript = \[\];/.test(body),
    "an unconditional wipe is what made a failed open indistinguishable from an empty conversation");
});

test("every conversation but the master can be closed", () => {
  const { wsRemoveConvSlotEntry } = lift("wsRemoveConvSlotEntry");
  const slots = [{ slot: 0, name: "Master" }, { slot: 1, name: "Chat 2" }];
  const r = wsRemoveConvSlotEntry(slots, 1);
  assert.equal(r.removed, true);
  assert.deepEqual(r.slots.map((s) => s.slot), [0]);
  assert.equal(r.slot, 0, "you land on the master — the tab you were reading is gone");

  const m = wsRemoveConvSlotEntry(slots, 0);
  assert.equal(m.removed, false,
    "the master is what every bookmark, image path and saved session keyed on before multi-chat " +
    "existed — closing it would strand all of them");
  assert.deepEqual(m.slots.map((s) => s.slot), [0, 1], "…and nothing may be removed on that path");

  assert.equal(wsRemoveConvSlotEntry(slots, 7).removed, false, "closing a slot that is not there is a no-op");
});

test("the × is on the tab, and the master has none", () => {
  const at = app.indexOf("const kids = [s.slot === 0");
  const body = app.slice(at, at + 700);
  assert.match(body, /if \(s\.slot !== 0\)/, "the master must not get a close button");
  assert.match(body, /e\.stopPropagation\(\)/,
    "closing must not also switch to the tab being closed");
  assert.match(css, /\.ws-conv-tab-x/, "and it needs to be visible enough to find, dim enough not to shout");
});

test("the first line of the first prompt names the conversation, as Pact does", () => {
  const { wsDeriveConvName } = lift("wsDeriveConvName");
  assert.equal(wsDeriveConvName("\n  Exocortex work\nmore"), "Exocortex work");
  assert.equal(wsDeriveConvName("   "), "", "nothing to derive from is not a name");
  assert.equal(wsDeriveConvName("x".repeat(60)).length, 41, "long first lines are cut, with an ellipsis");
  // …and it must only rename a slot that is still called "Chat N" and has no history: renaming a
  // conversation you already named, or one already underway, is the app deciding it knows better.
  const at = app.indexOf("THE FIRST LINE NAMES THE CONVERSATION");
  const body = app.slice(at, at + 900);
  assert.match(body, /!\(p\.transcript \|\| \[\]\)\.length/, "only before the conversation has any history");
  assert.match(body, /\/\^Chat \\d\+\$\//, "only while it still has its default name");
  assert.match(body, /\(p\.convSlot \|\| 0\) !== 0/, "never the master");
});

test("coming back from Chat 2 leaves the box TYPEABLE", () => {
  // Reproduced on the real page before this test existed: pick a repo → tick multi-chat → ＋ →
  // click ★ Master, and the type box came back `disabled:true`, placeholder "Read-only — …".
  //   "i created a new chat, i come back to main chat, the typing box i still can't type in it"
  //
  // The open reply's mode dispatch was a WHITELIST of live modes — `resume` and `restore` — with
  // read-only as the default. `conv-switch` and `recover` were added later and silently fell into
  // the default. Read-only has exactly one origin: the history column's 👁, which means "show me
  // this, don't touch it". Everything else is a pane attaching to a conversation it owns.
  const { wsOpenIsReadOnly } = lift("wsOpenIsReadOnly");
  assert.equal(wsOpenIsReadOnly("open"), true, "👁 browse is the ONLY read-only open");
  for (const mode of ["resume", "restore", "conv-switch", "recover"])
    assert.equal(wsOpenIsReadOnly(mode), false, mode + " attaches a pane to its own conversation — it must be writable");

  // …and the dispatch must ASK, not re-list the modes inline: a second copy of the list is what
  // let two later modes go missing from it.
  assert.ok(app.includes("if (!wsOpenIsReadOnly(req.mode)) {"),
    "the open-reply dispatch must ASK, not carry its own copy of the mode list");
  assert.ok(!/req\.mode === "restore"/.test(app),
    "a second list of live modes is exactly what went stale when conv-switch and recover arrived");
});

test("read-only is what disables the box — so the two must stay one decision", () => {
  assert.match(app, /ui\.promptEl\.disabled = !!p\.readonly;/,
    "the chain the bug travelled: mode → p.readonly → the textarea you cannot type in");
  assert.match(app, /if \(p\.readonly\) return;/,
    "and send refuses too, so a mobile box that still accepts keystrokes would silently swallow them");
});
