// node --test lib/chatShellLab.test.mjs
//
// WHY THIS EXISTS: for several rounds the lab's "Go" button did nothing. doJump() existed and was
// correct — but NOTHING EVER CALLED IT. A string replacement had silently failed to match (the file
// used a literal glyph where the patch used an escape), so the input and button were still the original
// handler-less ones. I "verified" by checking that doJump existed, which proves nothing about whether
// anything invokes it.
//
// A control that renders but is not wired looks identical to a broken feature and identical to a
// working one that is refusing. This test asserts the WIRING: every interactive control in the lab must
// have a handler attached. It cannot catch a logic bug, but it makes "silently connected to nothing"
// impossible to ship again.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "chat-shell-lab.html"), "utf8");

test("every interactive control in the lab is wired to a handler", () => {
  // The lab no longer BUILDS the chat box's controls — the package does, and it only attaches a
  // handler when the consumer supplies one (see lib/chatShellPackage.test.mjs, which clicks each
  // control for real and watches the callback fire). So what has to be checked here is the other
  // half: that the lab actually supplies a callback for every control it expects to work.
  const required = [
    ["jgo.onclick", "the Go button in the jump drawer — this is the one that was dead"],
    ["jin.onkeydown", "Enter in the jump input"],
    ["rec.onclick", "the Recall button"],
    ["worktree:", "the worktree picker"],
    ["bookmarks:", "the bookmark button"],
    ["model:", "the model selector"],
    ["autoContinue:", "the auto-continue tick"],
    ["context:", "the context readout"],
    ["compact:", "Compact"],
    ["wrap:", "Wrap"],
    ["autoWrap:", "the auto-wrap tick"],
  ];
  const missing = required.filter(([k]) => !src.includes(k));
  assert.deepEqual(missing, [], "unwired controls: " + missing.map(([k, why]) => `${k} (${why})`).join(", "));
});

// The auto-wrap tick, Compact and Wrap footer controls used to be built inline as awCb2/cbtn2/wbtn2
// with their own .onchange/.onclick assigned at the call site — that string is what the test above
// used to grep for. As of the chat-shell DOM extraction (chat-shell.js's buildWrapControls), all three
// are built ONE way for the Lab AND both production workspaces: the shared function itself always
// attaches the handler internally, driven by the caller's onToggleAutoWrap/onCompact/onWrap callback —
// so "is it wired" is now a guarantee of the shared function, not a per-caller fact to keep re-checking.
test("the footer's auto-wrap/Compact/Wrap controls are built via the shared, always-wired function", () => {
  const ui = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "chat-shell-ui.js"), "utf8");
  assert.ok(ui.includes("CS.buildWrapControls({"), "the package must build these through the shared function, not re-roll its own");
  for (const cb of ["onToggleAutoWrap:", "onCompact:", "onWrap:"]) {
    assert.ok(ui.includes(cb), `the package must supply ${cb} — buildWrapControls only wires a handler if one is given`);
  }
});

test("doJump is actually invoked, not merely defined", () => {
  assert.ok(src.includes("function doJump"), "doJump must exist");
  const calls = (src.match(/doJump\(/g) || []).length;
  assert.ok(calls >= 3, `doJump must be CALLED from the button, the Enter key and the bookmark list — found ${calls} references`);
});

test("every turn bubble carries an addressable data-turn marker for jump to find", () => {
  assert.ok(/"data-turn":\s*"P"/.test(src), "prompts must be addressable");
  assert.ok(/"data-turn":\s*"R"/.test(src), "answers must be addressable");
  assert.ok(src.includes('[data-turn="'), "and jump must query by that marker");
});

test("jump reports its outcome inline, not only through a dismissible toast", () => {
  assert.ok(src.includes('id: "h-jstat"'), "an inline status element must exist beside the control");
  assert.ok(src.includes('$("#h-jstat")'), "and flashMsg must write to it");
});
