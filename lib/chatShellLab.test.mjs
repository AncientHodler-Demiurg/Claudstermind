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
  const required = [
    ["jgo.onclick", "the Go button — this is the one that was dead"],
    ["jin.onkeydown", "Enter in the jump input"],
    ["rec.onclick", "the Recall button"],
    ["wsel.onchange", "the worktree picker"],
    ["bmBtn.onclick", "the bookmark button"],
    ["msel.onchange", "the model selector"],
    ["autoCb.onchange", "the auto-continue tick"],
    ["awCb.onchange", "the auto-wrap tick"],
    ["ctxBtn.onclick", "the context medallion"],
    ["wbtn.onclick", "the Wrap now button"],
  ];
  const missing = required.filter(([k]) => !src.includes(k));
  assert.deepEqual(missing, [], "unwired controls: " + missing.map(([k, why]) => `${k} (${why})`).join(", "));
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
