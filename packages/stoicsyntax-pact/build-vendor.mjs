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
  root.pactHighlight = (code) => toHtml(code);
  // Legacy shape the CodeMirror editor mode (pact-cm-mode.js) + tests expect: a per-word classifier that
  // returns a "pk-<band>" class (or "" for plain text). The package's classifyWord returns the bare band name.
  root.pactClassifyWord = (w) => { const t = classifyWord(w); return t === "text" ? null : "pk-" + t; };
  root.pactBandLegend = BAND_LEGEND;
})(typeof window !== "undefined" ? window : globalThis);
`;
const dest = resolve(DIR, "../../dashboard/public/pact-highlight.js");
writeFileSync(dest, out);
console.log("vendored → dashboard/public/pact-highlight.js  (" + out.length + " bytes)");
