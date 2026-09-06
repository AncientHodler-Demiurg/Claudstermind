// node --test lib/paneDialog.test.mjs
// The pane-scoped dialog primitive (dashboard/public/app.js) — round-6-lab lesson applied to
// production: a dialog belongs to the PANE that raised it (the 4-pane cockpit means a viewport-fixed
// dialog opens nowhere near the pane that raised it, and dims the other three while it does). The
// lab's own history also warns that a confirm button armed with no delay is a misclick trap — this
// tests that arming logic in isolation, sliced from app.js same as lib/pactGutter.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PANE DIALOG — pure arm-delay helper";
const end = "// ===== end PANE DIALOG pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "pane-dialog helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { wsDialogArmed } = new Function(block + "\nreturn { wsDialogArmed };")();

test("wsDialogArmed: false before the delay elapses — a misclick cannot fire the confirm instantly", () => {
  assert.equal(wsDialogArmed(0, 400), false);
  assert.equal(wsDialogArmed(399, 400), false);
});

test("wsDialogArmed: true once the delay has elapsed", () => {
  assert.equal(wsDialogArmed(400, 400), true);
  assert.equal(wsDialogArmed(1000, 400), true);
});

test("wsDialogArmed: a dialog with no delay (0 or falsy) is armed immediately", () => {
  assert.equal(wsDialogArmed(0, 0), true);
  assert.equal(wsDialogArmed(0, undefined), true);
});

test("wsDialogArmed: negative elapsed (clock skew) never arms early", () => {
  assert.equal(wsDialogArmed(-5, 400), false);
});

test("wiring: the dialog is appended to the PANE element passed in, never document.body", () => {
  const fnStart = src.indexOf("function wsOpenPaneDialog(");
  assert.ok(fnStart >= 0, "wsOpenPaneDialog must exist");
  const fnBody = src.slice(fnStart, src.indexOf("\n}", fnStart));
  assert.ok(fnBody.includes("paneEl.appendChild(overlay)"),
    "the overlay must be appended to paneEl — appending to document.body reopens the viewport-fixed bug this exists to fix");
  assert.ok(!fnBody.includes("document.body.appendChild"),
    "wsOpenPaneDialog itself must never fall back to document.body (other, unrelated features in this file legitimately do)");
});

test("wiring: Escape and click-outside both close the dialog", () => {
  assert.ok(src.includes('e.key === "Escape"'), "Escape must close a pane dialog");
  assert.ok(src.includes("e.target === overlay"), "clicking the dimmed backdrop (outside the box) must close it");
});
