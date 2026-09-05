// GENERATED — DO NOT EDIT. Browser build of the "stoicsyntax-pact" package (packages/stoicsyntax-pact).
// Regenerate after changing the tokenizer:  node packages/stoicsyntax-pact/build-vendor.mjs
// Classic script (no import/export) so index.html loads it via <script src> before app.js; sets
// window.pactHighlight(code)->html and window.pactBandLegend for the file viewer + band legend.
(function (root) {
// StoicSyntax-Pact tokenizer — framework-agnostic.
//
// The canonical implementation of the StoicSyntax coloring rule: in this discipline the function
// PREFIX is the contract, so an identifier is classified by its prefix band. `tokenize()` returns a
// flat token stream any renderer can style (CodeMirror, a web IDE, a terminal, tests); `toHtml()` is
// a convenience for web viewers. Single pass, so it never double-processes. Pure — no DOM, no deps.
//
// Bands: compute/read/ctor/enforce/cap are UNPROTECTED (cool); client/orch/admin/write are PROTECTED
// (warm/red). A prefix is recognized at a segment boundary — string start, or after `| . : >` — so it
// resolves inside qualified names (`IC|UDC_…`, `URC|KDA-PID_CLAD`) and cap-name shapes (`SWP|A_…`,
// `SWP|C>…`).

// The Pact 5 builtin + special-form set, SOURCED from kadena-io/pact-5 (pact/Pact/Core/Builtin.hs) plus
// parser-level special forms. Source is authoritative over the docs: `verify`, `create-user-guard`,
// `try`, `keys-all`/`keys-any`/`keys-2` and the formal-verification system are NOT in Pact 5 — see
// brain/OuronetPact/PACT-REFERENCE.md. Precision/field/rollback variants below are real Pact 5 natives.
const KEYWORDS = new Set([
  // parser-level special forms (not in the builtin registry, but valid Pact)
  "let", "let*", "lambda", "and", "or", "enforce", "enforce-one", "with-capability", "step",
  "step-with-rollback", "use", "implements", "bless",
  // natives from Builtin.hs
  "abs", "acquire-module-admin", "add-time", "and?", "at", "base64-decode", "base64-encode",
  "begin-named-tx", "begin-tx", "bind", "ceiling", "ceiling-prec", "chain-data", "commit-tx", "compose",
  "compose-capability", "concat", "cond", "contains", "continue", "continue-pact",
  "continue-pact-rollback-yield", "continue-pact-rollback-yield-object", "continue-pact-with-rollback",
  "create-capability-guard", "create-capability-pact-guard", "create-module-guard", "create-pact-guard",
  "create-principal", "create-table", "days", "dec", "define-keyset", "define-namespace",
  "define-read-keyset", "describe-keyset", "describe-module", "describe-namespace", "describe-table",
  "diff-time", "distinct", "drop", "emit-event", "enforce-guard", "enforce-keyset", "enforce-pact-version",
  "enforce-pact-version-range", "enforce-verifier", "enumerate", "enumerate-step", "env-ask-gasmodel",
  "env-chain-data", "env-data", "env-enable-repl-natives", "env-events", "env-exec-config", "env-gas",
  "env-gaslimit", "env-gaslog", "env-gasmodel", "env-hash", "env-keys", "env-milligas", "env-module-admin",
  "env-namespace-policy", "env-set-debug-flag", "env-set-gas", "env-set-milligas", "env-sigs",
  "env-stackframe", "env-verifiers", "exp", "expect", "expect-failure", "expect-failure-match",
  "expect-that", "filter", "floor", "floor-prec", "fold", "fold-db", "format", "format-time", "hash",
  "hash-keccak256", "hash-poseidon", "hours", "hyperlane-decode-token-message",
  "hyperlane-encode-token-message", "hyperlane-message-id", "identity", "if", "insert",
  "install-capability", "int-to-str", "is-charset", "is-principal", "keys", "keyset-ref-guard", "length",
  "list-modules", "ln", "load", "load-with-env", "log", "make-list", "map", "minutes", "mod", "namespace",
  "negate", "not", "or?", "pact-id", "pact-state", "pact-version", "pairing-check", "parse-time",
  "point-add", "poseidon-hash-hack-a-chain", "print", "read", "read-decimal", "read-integer",
  "read-keyset", "read-msg", "read-msg-default", "read-string", "read-with-fields", "remove",
  "require-capability", "reset-pact-state", "resume", "reverse", "rollback-tx", "round", "round-prec",
  "scalar-mult", "select", "select-with-fields", "shift", "show", "sig-keyset", "sort", "sort-object",
  "sqrt", "static-redeploy", "str-to-int", "str-to-int-base", "str-to-list", "take", "test-capability",
  "time", "tx-hash", "typecheck", "typeof", "typeof-principal", "update", "validate-principal",
  "verify-spv", "where", "with-default-read", "with-read", "write", "xor", "yield", "yield-to-chain",
  "zip",
]);
// Def-forms per the Pact 5 lexer (LexUtils.hs). NB: `defproperty` is GONE in Pact 5 (property system removed).
const DEFS = new Set([
  "module", "interface", "defun", "defcap", "defconst", "defschema", "deftable", "defpact",
]);

// [tokenType, prefix-detector]. Order matters: single-letter bands use a strict [_>] boundary so they
// can't swallow multi-letter prefixes; the lead class requires a real segment start.
const BANDS = [
  ["write", /(?:^|[|.:>])(?:WI|WU|WW|W)[_>]/],
  ["admin", /(?:^|[|.:>])A[_>]/],
  ["client", /(?:^|[|.:>])C[_>]/],
  ["orch", /(?:^|[|.:>])(?:XI|XE|XB)[_>]/],
  ["cap", /(?:^|[|.:>])CAP[_>|]/],
  ["enforce", /(?:^|[|.:>])UEV[_>|]/],
  ["ctor", /(?:^|[|.:>])UDC[_>|]/],
  ["read", /(?:^|[|.:>])(?:URDC|URD|URC|UR)[_>|]/],
  ["compute", /(?:^|[|.:>])(?:UCK|UC)[_>|]/],
];

// One-line human description of each band — for legends / docs.
const BAND_LEGEND = [
  ["compute", "UC_", "pure compute"],
  ["read", "UR_", "reads / derives"],
  ["ctor", "UDC_", "object constructors"],
  ["enforce", "UEV_", "enforce / validate"],
  ["cap", "CAP_", "capability"],
  ["client", "C_", "client recipe"],
  ["orch", "XE_", "orchestration write"],
  ["admin", "A_", "admin"],
  ["write", "W_", "persistence write"],
];

const NUM = /^-?\d+(\.\d+)?$/;
const WORD = /[A-Za-z0-9_|<>.\-]/;

/** Classify a bare identifier → a token type, or "text" if it carries no special meaning. */
function classifyWord(w) {
  if (NUM.test(w)) return "number";
  if (w === "true" || w === "false") return "bool";
  if (DEFS.has(w)) return "def";
  if (KEYWORDS.has(w)) return "keyword";
  for (const [type, re] of BANDS) if (re.test(w)) return type;
  return "text";
}

/**
 * Tokenize Pact source into a flat [{ type, value }] stream. Token types:
 *   comment · section (`;;` bars) · string · number · bool · keyword · def · type (`:Type`) ·
 *   op (`::`) · paren · sq · brace · compute/read/ctor/enforce/cap/client/orch/admin/write · text.
 * Whitespace/other punctuation is emitted as `text` so `tokens.map(t=>t.value).join("")` === input.
 */
function tokenize(code) {
  const out = [];
  const push = (type, value) => { if (value) out.push({ type, value }); };
  const n = code.length;
  let i = 0;
  while (i < n) {
    const c = code[i];
    if (c === ";") {
      let j = i; while (j < n && code[j] !== "\n") j++;
      const seg = code.slice(i, j);
      push(/^;;/.test(seg) ? "section" : "comment", seg);
      i = j; continue;
    }
    if (c === '"') {
      let k = i + 1;
      while (k < n) { if (code[k] === "\\") { k += 2; continue; } if (code[k] === '"') { k++; break; } k++; }
      push("string", code.slice(i, k)); i = k; continue;
    }
    if (c === ":" && code[i + 1] !== ":" && /[A-Za-z]/.test(code[i + 1] || "")) {
      let t = i + 1; while (t < n && WORD.test(code[t])) t++;
      push("type", code.slice(i, t)); i = t; continue;
    }
    if (c === ":" && code[i + 1] === ":") { push("op", "::"); i += 2; continue; }
    if (c === "(" || c === ")") { push("paren", c); i++; continue; }
    if (c === "[" || c === "]") { push("sq", c); i++; continue; }
    if (c === "{" || c === "}") { push("brace", c); i++; continue; }
    if (WORD.test(c)) {
      let w = i; while (w < n && WORD.test(code[w])) w++;
      const word = code.slice(i, w);
      push(classifyWord(word), word); i = w; continue;
    }
    let d = i;
    while (d < n && !WORD.test(code[d]) && code[d] !== ";" && code[d] !== '"' && code[d] !== ":" &&
           code[d] !== "(" && code[d] !== ")" && code[d] !== "[" && code[d] !== "]" && code[d] !== "{" && code[d] !== "}") d++;
    if (d === i) d = i + 1;
    push("text", code.slice(i, d)); i = d;
  }
  return out;
}

const ESC = (s) => s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

/** Render to HTML `<span class="{prefix}{type}">…</span>` (type `text` emits bare escaped text). */
function toHtml(code, { classPrefix = "pk-" } = {}) {
  return tokenize(code).map((t) => (t.type === "text" ? ESC(t.value) : `<span class="${classPrefix}${t.type}">${ESC(t.value)}</span>`)).join("");
}

  root.pactHighlight = (code) => toHtml(code);
  // Legacy shape the CodeMirror editor mode (pact-cm-mode.js) + tests expect: a per-word classifier that
  // returns a "pk-<band>" class (or "" for plain text). The package's classifyWord returns the bare band name.
  root.pactClassifyWord = (w) => { const t = classifyWord(w); return t === "text" ? null : "pk-" + t; };
  root.pactBandLegend = BAND_LEGEND;
})(typeof window !== "undefined" ? window : globalThis);
