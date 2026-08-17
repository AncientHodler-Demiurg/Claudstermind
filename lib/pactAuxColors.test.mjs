// node --test lib/pactAuxColors.test.mjs
// The editable Pact editor's tokenizer (dashboard/public/pact-cm-mode.js) wraps the base classifier
// (pact-highlight.js) with the StoicSyntax COLOUR FAMILIES (OuronetInformational/StoicSyntax-Prefixes.md
// §4). We eval BOTH browser classic-scripts with a fake `window` (+ a minimal CodeMirror stub, since the
// mode file no-ops without one) and exercise the real wrapped classifier for every family.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const pub = join(__dir, "..", "dashboard", "public");
const win = { CodeMirror: { defineMode() {}, defineMIME() {} } };
// eslint-disable-next-line no-new-func
new Function("window", readFileSync(join(pub, "pact-highlight.js"), "utf8"))(win);
// eslint-disable-next-line no-new-func
new Function("window", readFileSync(join(pub, "pact-cm-mode.js"), "utf8"))(win);
const cls = win.pactClassifyWord;

test("COMPUTE family: UC_ / UCk_ / UCK_ → pk-compute; UCx_ / UCX_ → dimmed pk-computex", () => {
  assert.equal(cls("UC_Add"), "pk-compute");
  assert.equal(cls("UCk_MakeKey"), "pk-compute");
  assert.equal(cls("UCK_MakeKey"), "pk-compute");       // migration UCK ≡ UCk
  assert.equal(cls("UCx_Helper"), "pk-computex");
  assert.equal(cls("UCX_Helper"), "pk-computex");       // migration UCX ≡ UCx
});

test("READ family: UR_ / URC_ → pk-read; URCx_ / URCX_ / URU_ → dimmed pk-readx", () => {
  assert.equal(cls("UR_IgnisID"), "pk-read");
  assert.equal(cls("URC_LD"), "pk-read");
  assert.equal(cls("UR_SCR|ScoreOwnerKonto"), "pk-read", "scoped read colors the class token");
  assert.equal(cls("URCx_Derive"), "pk-readx");
  assert.equal(cls("URCX_Derive"), "pk-readx");         // migration
  assert.equal(cls("URU_Upgrade"), "pk-readx");
});

test("HEAVY-READ family (LOUD): URH_/URD_ + URHC_/URDC_ → pk-heavy; …x → pk-heavyx; D≡H migration", () => {
  assert.equal(cls("URH_ScanAll"), "pk-heavy");
  assert.equal(cls("URD_ScanAll"), "pk-heavy");         // migration URD ≡ URH
  assert.equal(cls("URHC_ScanDerive"), "pk-heavy");
  assert.equal(cls("URDC_ScanDerive"), "pk-heavy");     // migration URDC ≡ URHC
  assert.equal(cls("URHx_Aux"), "pk-heavyx");
  assert.equal(cls("URDX_Aux"), "pk-heavyx");           // migration URDX ≡ URHx
  assert.equal(cls("URHCx_Aux"), "pk-heavyx");
  assert.equal(cls("URDCX_Aux"), "pk-heavyx");          // migration URDCX ≡ URHCx
});

test("ENFORCE: UEV_ / CAP_ → pk-enforce", () => {
  assert.equal(cls("UEV_Guard"), "pk-enforce");
  assert.equal(cls("CAP_Owner"), "pk-enforce");
});

test("CONSTRUCT: UDC_ → pk-ctor; UDCx_/UDCX_ → pk-ctorx", () => {
  assert.equal(cls("UDC_Build"), "pk-ctor");
  assert.equal(cls("UDCx_BuildAux"), "pk-ctorx");
  assert.equal(cls("UDCX_BuildAux"), "pk-ctorx");
});

test("CONSTANT: CT_ → pk-const (and it is NOT read as the single-letter C recipe band)", () => {
  assert.equal(cls("CT_MaxBoost"), "pk-const");
});

test("WRITE: WI_ / WU_ / WU2_ / WW_ → pk-write", () => {
  assert.equal(cls("WI_Insert"), "pk-write");
  assert.equal(cls("WU_Update"), "pk-write");
  assert.equal(cls("WU2_UpdateTwo"), "pk-write");
  assert.equal(cls("WW_Upsert"), "pk-write");
});

test("RECIPE: A_ / C_ / CC_ / AA_ share ONE hue (pk-recipe)", () => {
  assert.equal(cls("A_UpdateBoost"), "pk-recipe");
  assert.equal(cls("C_Recipe"), "pk-recipe");
  assert.equal(cls("CC_SingleTx"), "pk-recipe");
  assert.equal(cls("AA_Admin"), "pk-recipe");
  assert.equal(cls("SWP|C_Create"), "pk-recipe", "scoped client entrypoint");
  assert.equal(cls("DPNF|C_Create"), "pk-recipe", "Talos wrapper stem");
  assert.equal(cls("SWP|A>UpdateBoost"), "pk-recipe", "cap-arrow shape");
});

test("PROTECTED: XI_ / XE_ / XB_ → pk-orch", () => {
  assert.equal(cls("XI_Move"), "pk-orch");
  assert.equal(cls("XE_Forward"), "pk-orch");
  assert.equal(cls("XB_Both"), "pk-orch");
});

test("STRUCTURAL: GOV / GOV| / P| / SECURE / UEV_IMC → pk-struct (UEV_IMC beats plain UEV)", () => {
  assert.equal(cls("GOV"), "pk-struct");
  assert.equal(cls("GOV|KEYSET"), "pk-struct");
  assert.equal(cls("P|IMCGuard"), "pk-struct");
  assert.equal(cls("SECURE"), "pk-struct");
  assert.equal(cls("UEV_IMC"), "pk-struct", "the IMC gate is structural, not a normal enforce");
});

test("literals / language keywords are untouched, and module/table scope names are not classified", () => {
  assert.equal(cls("42"), "pk-number");
  assert.equal(cls("true"), "pk-bool");
  assert.equal(cls("someLocalVar"), null);
  assert.equal(cls("DPTF"), null, "a bare module name is not a class");
  assert.equal(cls("SWP"), null);
});
