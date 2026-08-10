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

// The full Pact 5 builtin + special-form set (indexed from kda-chain.org/docs/pact-5, 2026-08).
export const KEYWORDS = new Set([
  // special forms & statements
  "let", "let*", "lambda", "cond", "if", "bind", "do", "step", "step-with-rollback",
  "enforce", "enforce-one", "enforce-guard", "enforce-keyset", "enforce-pact-version", "enforce-verifier",
  "with-capability", "require-capability", "compose-capability", "install-capability", "emit-event",
  "namespace", "use", "implements", "bless", "continue", "resume", "yield",
  // general
  "acquire-module-admin", "at", "base64-decode", "base64-encode", "chain-data", "compose", "concat",
  "constantly", "contains", "define-namespace", "describe-namespace", "distinct", "drop", "enumerate",
  "filter", "fold", "format", "hash", "hash-keccak256", "identity", "int-to-str", "is-charset", "length",
  "list-modules", "make-list", "map", "negate", "pact-id", "pact-version", "poseidon-hash-hack-a-chain",
  "read-decimal", "read-integer", "read-keyset", "read-msg", "read-string", "remove", "reverse", "round",
  "show", "sort", "static-redeploy", "str-to-int", "str-to-list", "take", "try", "tx-hash", "typeof",
  "where", "zip",
  // database
  "create-table", "describe-keyset", "describe-module", "describe-table", "fold-db", "insert", "keys",
  "read", "select", "update", "with-default-read", "with-read", "write", "txlog", "keylog",
  // guards & keysets
  "create-capability-guard", "create-capability-pact-guard", "create-module-guard", "create-pact-guard",
  "create-principal", "create-user-guard", "is-principal", "keyset-ref-guard", "typeof-principal",
  "validate-principal", "create-principal-namespace", "define-keyset", "keys-2", "keys-all", "keys-any",
  // operators (word forms)
  "abs", "ceiling", "floor", "dec", "exp", "ln", "log", "mod", "sqrt", "and", "or", "not", "xor", "shift",
  "and?", "or?", "not?",
  // time
  "add-time", "days", "diff-time", "format-time", "hours", "minutes", "parse-time", "time",
  // REPL-only
  "begin-tx", "commit-tx", "rollback-tx", "continue-pact", "pact-state", "env-data", "env-keys",
  "env-sigs", "env-chain-data", "env-hash", "env-namespace-policy", "env-entity", "env-events",
  "env-exec-config", "env-dynref", "env-enable-repl-natives", "env-simulate-onchain", "env-gas",
  "env-gaslimit", "env-gasmodel", "env-gasprice", "env-gasrate", "env-gaslog", "env-milligas",
  "env-set-milligas", "env-set-debug-flag", "env-module-admin", "env-verifiers",
  "expect", "expect-failure", "expect-that", "print", "typecheck", "verify", "test-capability",
  "sig-keyset", "format-address", "mock-spv", "load", "with-applied-env", "bench",
  // specialized
  "hyperlane-decode-token-message", "hyperlane-encode-token-message", "hyperlane-message-id",
  "verify-spv", "pairing-check", "point-add", "scalar-mult",
  // constants
  "CHARSET_ASCII", "CHARSET_LATIN1",
]);
export const DEFS = new Set([
  "module", "interface", "defun", "defcap", "defconst", "defschema", "deftable", "defpact", "defproperty",
]);

// [tokenType, prefix-detector]. Order matters: single-letter bands use a strict [_>] boundary so they
// can't swallow multi-letter prefixes; the lead class requires a real segment start.
export const BANDS = [
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
export const BAND_LEGEND = [
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
export function classifyWord(w) {
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
export function tokenize(code) {
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
export function toHtml(code, { classPrefix = "pk-" } = {}) {
  return tokenize(code).map((t) => (t.type === "text" ? ESC(t.value) : `<span class="${classPrefix}${t.type}">${ESC(t.value)}</span>`)).join("");
}
