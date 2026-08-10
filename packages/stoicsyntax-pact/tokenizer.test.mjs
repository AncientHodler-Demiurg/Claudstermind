// node --test packages/stoicsyntax-pact/tokenizer.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { tokenize, classifyWord, toHtml } from "./src/tokenizer.mjs";

test("classifyWord resolves StoicSyntax bands, including qualified + cap-arrow forms", () => {
  assert.equal(classifyWord("UC_InsertFirst"), "compute");
  assert.equal(classifyWord("UR_IgnisID"), "read");
  assert.equal(classifyWord("URC|KDA-PID_CLAD"), "read");
  assert.equal(classifyWord("IC|UDC_SmallCumulator"), "ctor");
  assert.equal(classifyWord("UEV_Guard"), "enforce");
  assert.equal(classifyWord("CAP_Owner"), "cap");
  assert.equal(classifyWord("SWP|A_UpdateLiquidBoost"), "admin");
  assert.equal(classifyWord("SWP|C>Recipe"), "client");
  assert.equal(classifyWord("SWP|XE>Move"), "orch");
  assert.equal(classifyWord("WU_Update"), "write");
  assert.equal(classifyWord("CAP_X"), "cap");     // not mis-read as client
  assert.equal(classifyWord("URC_LD"), "read");   // the C in URC must not trip client
  assert.equal(classifyWord("ref-DALOS"), "text");
  assert.equal(classifyWord("defun"), "def");
  assert.equal(classifyWord("with-capability"), "keyword");
  assert.equal(classifyWord("0.0"), "number");
});

test("tokenize is lossless — values rejoin to the input", () => {
  const src = '(defun UC_add:decimal (a b) "d" 1.0) ;; bar\n(SWP|A_Do)';
  assert.equal(tokenize(src).map((t) => t.value).join(""), src);
});

test("tokenize assigns the expected types", () => {
  const types = Object.fromEntries(tokenize('(defun UC_add:decimal (a) "s" 1 ;;c\n)').map((t) => [t.value.trim(), t.type]).filter(([v]) => v));
  assert.equal(types["defun"], "def");
  assert.equal(types["UC_add"], "compute");
  assert.equal(types[":decimal"], "type");
  assert.equal(types['"s"'], "string");
  assert.equal(types["1"], "number");
  assert.equal(types[";;c"], "section");
  assert.equal(types["("], "paren");
});

test("toHtml escapes and wraps by band; text is bare", () => {
  const html = toHtml('(enforce (< a b) W_Save)');
  assert.match(html, /<span class="pk-write">W_Save<\/span>/);
  assert.match(html, /&lt;/);
  assert.ok(!/<(?!\/?span)/.test(html.replace(/<span[^>]*>|<\/span>/g, "")), "no raw tags leak");
});
