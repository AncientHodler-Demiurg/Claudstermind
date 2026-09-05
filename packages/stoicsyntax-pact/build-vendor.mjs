// Generate the browser build of the tokenizer for Claudstermind's no-build dashboard:
// wraps the ESM tokenizer as a classic-script IIFE exposing window.pactHighlight / window.pactBandLegend.
// The package stays the SINGLE SOURCE — dashboard/public/pact-highlight.js is generated, never hand-edited.
// Run: node packages/stoicsyntax-pact/build-vendor.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(DIR, "src/tokenizer.mjs"), "utf8");
const body = src.replace(/^export\s+/gm, "");   // strip ESM `export` → plain in-scope statements

const out = `// GENERATED — DO NOT EDIT. Browser build of the "stoicsyntax-pact" package (packages/stoicsyntax-pact).
// Regenerate after changing the tokenizer:  node packages/stoicsyntax-pact/build-vendor.mjs
// Classic script (no import/export) so index.html loads it via <script src> before app.js; sets
// window.pactHighlight(code)->html and window.pactBandLegend for the file viewer + band legend.
(function (root) {
${body}
  // Legacy shape the CodeMirror editor mode (pact-cm-mode.js) + tests expect: a per-word classifier that
  // returns a "pk-<band>" class (or "" for plain text). The package's classifyWord returns the bare band name.
  root.pactClassifyWord = (w) => { const t = classifyWord(w); return t === "text" ? null : "pk-" + t; };
  // pact-cm-mode.js WRAPS root.pactClassifyWord with the StoicSyntax colour FAMILIES
  // (OuronetInformational/StoicSyntax-Prefixes.md §4 — URH_/URCx_/CT_/UEV_IMC, A_/C_ → RECIPE, …),
  // which the package's own band table doesn't know. The static <pre> highlighter renders the DELETED
  // lines of a diff, so it must color identically to the editable CodeMirror view: render each
  // word token through the (possibly wrapped) GLOBAL classifier instead of toHtml()'s internal one.
  // Non-word tokens (comments, strings, ':type', brackets) keep the tokenizer's own type, and with no
  // wrapper installed this is exactly toHtml() — same output, one source of truth. Do not replace this
  // with a plain toHtml(code): that regression (a straight regenerate over the 1.4.55 fix) is what
  // lib/pactAuxColors.test.mjs guards.
  root.pactHighlight = (code) => tokenize(code).map((t) => {
    const cls = WORD.test(t.value[0]) ? root.pactClassifyWord(t.value) : (t.type === "text" ? null : "pk-" + t.type);
    return cls ? \`<span class="\${cls}">\${ESC(t.value)}</span>\` : ESC(t.value);
  }).join("");
  root.pactBandLegend = BAND_LEGEND;
})(typeof window !== "undefined" ? window : globalThis);
`;
const dest = resolve(DIR, "../../dashboard/public/pact-highlight.js");
writeFileSync(dest, out);
console.log("vendored → dashboard/public/pact-highlight.js  (" + out.length + " bytes)");
