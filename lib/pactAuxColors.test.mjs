// node --test lib/pactAuxColors.test.mjs
// The editable Pact editor's tokenizer (dashboard/public/pact-cm-mode.js) wraps the base classifier
// (pact-highlight.js) to color the doubled/auxiliary prefixes — CC_/AA_, and the URD/URC auxiliaries
// URDX/URDXX and URCX/URCXX. We eval BOTH browser classic-scripts with a fake `window` (+ a minimal
// CodeMirror stub, since the mode file no-ops without one) and exercise the real wrapped classifier.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const pub = join(__dir, "..", "dashboard", "public");
const win = { CodeMirror: { defineMode() {}, defineMIME() {} } };
// eslint-disable-next-line no-new-func
new Function("window", readFileSync(join(pub, "pact-highlight.js"), "utf8"))(win);   // sets base classifier
// eslint-disable-next-line no-new-func
new Function("window", readFileSync(join(pub, "pact-cm-mode.js"), "utf8"))(win);     // wraps it
const cls = win.pactClassifyWord;

test("URDX / URDXX auxiliaries take URD's color (pk-readd)", () => {
  assert.equal(cls("URDX_LiveBalance"), "pk-readd");
  assert.equal(cls("URDXX_LiveBalanceHelper"), "pk-readd");
  assert.equal(cls("SWP|URDX_Foo"), "pk-readd", "after a module band segment");
  assert.equal(cls("URDX>Cap"), "pk-readd", "cap-arrow shape");
  assert.equal(cls("URDX2_Foo"), "pk-readd", "with a write-count digit");
});

test("URCX / URCXX auxiliaries take URC's color (pk-read)", () => {
  assert.equal(cls("URCX_Ignis"), "pk-read");
  assert.equal(cls("URCXX_IgnisHelper"), "pk-read");
  assert.equal(cls("SWP|URCX_Foo"), "pk-read");
});

test("the parents and other bands are unchanged", () => {
  assert.equal(cls("URD_Balance"), "pk-readd");
  assert.equal(cls("URC_LD"), "pk-read");
  assert.equal(cls("UR_IgnisID"), "pk-read");
  assert.equal(cls("CC_Recipe"), "pk-client");   // the earlier doubled-prefix wrap still works
  assert.equal(cls("AA_Admin"), "pk-admin");
  assert.equal(cls("UC_InsertFirst"), "pk-compute");
});

test("plain words / non-matches stay null", () => {
  assert.equal(cls("someLocalVar"), null);
  assert.equal(cls("URDINGTON_NotAnAux"), null, "URD not followed by an X-aux boundary must not match");
});
