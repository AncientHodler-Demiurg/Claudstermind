// node --test lib/pactCopyAll.test.mjs
//
// THE REQUEST: the Pact working agent generates deploy-pipeline .pact files with many modules/interfaces/
// tables that must be copied WHOLE and deployed. The read-only viewer had per-module copy (click a line
// number) but no "copy the entire file" button — forcing a thousand-row manual scroll+select. This adds a
// ⧉ button to each box's control row (beside the 🖨 PDF export) that copies the full file in one click.
// DOM-bound (per-box footer), so this is a presence/wiring check, same convention as coreMultiChat's.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

test("a copy-all button is wired into the per-box control row for .pact/.repl/.md files", () => {
  // must live inside the same gate as the PDF export (which is .pact/.repl/.md only)
  assert.ok(app.includes('const copyAll = el("button"'), "the copyAll button must exist");
  assert.ok(app.includes("right.unshift(copyAll)"), "it must be placed into the box's control row");
  // same gate as the PDF export button — .pact/.repl/.md only
  const gate = 'if (active && (an.endsWith(".pact") || an.endsWith(".repl") || an.endsWith(".md")))';
  const gi = app.indexOf(gate);
  assert.ok(gi >= 0 && app.indexOf('const copyAll = el("button"') > gi
    && app.indexOf('const copyAll = el("button"') < gi + 1400,
    "copyAll must be inside the .pact/.repl/.md gate, alongside the PDF export");
});

test("copy-all copies the WHOLE file (active.content), not a selection or a visible slice", () => {
  const i = app.indexOf('const copyAll = el("button"');
  const block = app.slice(i, i + 700);
  assert.match(block, /const text = String\(active\.content \|\| ""\)/,
    "it must read the entire file content — the same source the PDF export uses — so scroll position is irrelevant");
  assert.match(block, /navigator\.clipboard\.writeText\(text\)/, "writes the full text to the clipboard");
  assert.match(block, /wsCopyFallback\(text, done\)/, "falls back to the execCommand path when the async clipboard API is unavailable");
});
