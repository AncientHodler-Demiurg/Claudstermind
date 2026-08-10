// node --test lib/pactHighlight.test.mjs
// The highlighter is a browser classic-script (dashboard/public/pact-highlight.js). We eval its
// source with a fake `window` and exercise the real functions — no duplication, no bundler.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "pact-highlight.js"), "utf8");
const win = {};
// eslint-disable-next-line no-new-func
new Function("window", src)(win);
const { pactHighlight, pactClassifyWord: cls } = win;

test("StoicSyntax prefixes classify to the right band, at start or after a | segment", () => {
  assert.equal(cls("UC_InsertFirst"), "pk-compute");
  assert.equal(cls("UCK_MakeKey"), "pk-compute");
  assert.equal(cls("UR_IgnisID"), "pk-read");
  assert.equal(cls("URC_LD"), "pk-read");
  assert.equal(cls("URC|KDA-PID_CLAD"), "pk-read");     // band segment after the prefix
  assert.equal(cls("UDC_BulkTransferCumulator"), "pk-ctor");
  assert.equal(cls("IC|UDC_SmallCumulator"), "pk-ctor"); // prefix after a module band
  assert.equal(cls("UEV_Guard"), "pk-enforce");
  assert.equal(cls("CAP_Owner"), "pk-cap");
  assert.equal(cls("A_UpdateLiquidBoost"), "pk-admin");
  assert.equal(cls("SWP|A_UpdateLiquidBoost"), "pk-admin");
  assert.equal(cls("C_Recipe"), "pk-client");
  assert.equal(cls("XE_Orchestrate"), "pk-orch");
  assert.equal(cls("W_Persist"), "pk-write");
  assert.equal(cls("WU_Update"), "pk-write");
});

test("cap-name arrow shapes color by band", () => {
  assert.equal(cls("SWP|A>UpdateBoost"), "pk-admin");
  assert.equal(cls("SWP|C>Recipe"), "pk-client");
  assert.equal(cls("SWP|XE>Move"), "pk-orch");
});

test("CAP_ is not mis-read as the single-letter C_ band, and reads aren't mis-read as client", () => {
  assert.equal(cls("CAP_Something"), "pk-cap");     // not pk-client
  assert.equal(cls("URC_LD"), "pk-read");           // the C in URC must not trip pk-client
});

test("non-prefixed identifiers, keywords, numbers, bools classify correctly", () => {
  assert.equal(cls("ref-DALOS"), null);
  assert.equal(cls("account"), null);
  assert.equal(cls("U|LST"), null);
  assert.equal(cls("defun"), "pk-def");
  assert.equal(cls("with-capability"), "pk-keyword");
  assert.equal(cls("0.0"), "pk-number");
  assert.equal(cls("-42"), "pk-number");
  assert.equal(cls("true"), "pk-bool");
});

test("full-line highlight escapes HTML and wraps tokens in pk- spans", () => {
  const html = pactHighlight('(defun UC_add:decimal (a b) "doc" 1.0) ;; a bar');
  assert.match(html, /<span class="pk-def">defun<\/span>/);
  assert.match(html, /<span class="pk-compute">UC_add<\/span>/);
  assert.match(html, /<span class="pk-type">:decimal<\/span>/);
  assert.match(html, /<span class="pk-string">&quot;doc&quot;|<span class="pk-string">"doc"/);
  assert.match(html, /<span class="pk-number">1\.0<\/span>/);
  assert.match(html, /<span class="pk-section">;; a bar<\/span>/);
  assert.match(html, /<span class="pk-paren">\(<\/span>/);
});

test("angle brackets / ampersands in source are escaped, never injected as HTML", () => {
  const html = pactHighlight('(enforce (< a b) "x&y")');
  assert.ok(!/<(?!\/?span)/.test(html.replace(/<span[^>]*>|<\/span>/g, "")), "no raw tags leak through");
  assert.match(html, /&lt;/);
  assert.match(html, /&amp;/);
});
