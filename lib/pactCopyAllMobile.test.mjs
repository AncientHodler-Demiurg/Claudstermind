// node --test lib/pactCopyAllMobile.test.mjs
//
// THE REPORT: "When visualizing a pact file on mobile, I can open it and see it, but I do not have
// exposed a copy all code button. I want for example to open it and copy all the code to bring in
// execute console for a deploy. I'm missing that button, that copies all the text in clipboard of
// the whole opened file. Very important. Can you add it. It exists in desktop view but not on mobile
// view." — confirmed: the desktop box footer (see lib/pactCopyAll.test.mjs) has a ⧉ "copy whole file"
// button, but the phone re-layout's box view (viewPactMobile's boxStage) only ever rendered the body
// + the "▲ Files (N)" riser — no footer, no copy button, nowhere to reach it short of opening the
// hamburger menu (which doesn't offer it either). This pins the fix: a matching ⧉ button docked
// beside the files riser, gated the SAME way the desktop one is (.pact/.repl/.md only), reading the
// same `active.content` and using the same clipboard-write + fallback mechanism.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

function mobileBoxStageSlice() {
  const i = app.indexOf('function boxStage(g) {');
  assert.ok(i >= 0, "viewPactMobile's boxStage must exist");
  const end = app.indexOf("\n  // ---- M2:", i);
  assert.ok(end > i, "boxStage must be followed by the M2 full-screen sheet section");
  return app.slice(i, end);
}

test("the mobile box view has a copy-whole-file button docked beside the files riser", () => {
  const block = mobileBoxStageSlice();
  assert.match(block, /const filebar = el\("div", \{ class: "pactm-filebar" \}, \[riser\]\);/,
    "the riser must be wrapped in a row that can also hold the copy button");
  assert.match(block, /const copyAll = el\("button", \{ class: "pactm-handle-copy"/,
    "a dedicated mobile copy-all button must exist");
  assert.match(block, /filebar\.appendChild\(copyAll\);/, "it must be docked into the filebar row");
  assert.match(block, /return el\("div", \{ class: "pactm-boxwrap" \}, \[body, filebar\]\);/,
    "the box wrap must render the filebar (riser + copy button), not the bare riser");
});

test("the mobile copy-all button is gated the SAME way the desktop one is: .pact/.repl/.md only", () => {
  const block = mobileBoxStageSlice();
  const gate = 'if (active && (an.endsWith(".pact") || an.endsWith(".repl") || an.endsWith(".md")))';
  const gi = block.indexOf(gate);
  const ci = block.indexOf('const copyAll = el("button", { class: "pactm-handle-copy"');
  assert.ok(gi >= 0 && ci > gi && ci < gi + 400, "the mobile copyAll button must be declared inside the same file-type gate the desktop button uses");
});

test("the mobile copy-all button copies the WHOLE file (active.content) via the same clipboard path as desktop", () => {
  const block = mobileBoxStageSlice();
  const i = block.indexOf('const copyAll = el("button", { class: "pactm-handle-copy"');
  const btn = block.slice(i, i + 900);
  assert.match(btn, /const text = String\(active\.content \|\| ""\)/,
    "it must read the entire file content, the same source the desktop button and the PDF export both use");
  assert.match(btn, /navigator\.clipboard\.writeText\(text\)/, "writes the full text to the clipboard");
  assert.match(btn, /wsCopyFallback\(text, done\)/, "falls back to the execCommand path when the async clipboard API is unavailable");
  assert.match(btn, /setTimeout\(\(\) => \{ copyAll\.textContent = "⧉"; copyAll\.classList\.remove\("--on"\); \}, 1200\)/,
    "uses the same ✓/✗ flash-feedback-for-1200ms UX as the desktop button and every other copy button in this file");
});
