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

export const KEYWORDS = new Set([
  "let", "let*", "if", "cond", "lambda", "and", "or", "not", "bind", "at", "step", "step-with-rollback",
  "enforce", "enforce-one", "enforce-guard", "enforce-keyset", "keyset-ref-guard", "create-user-guard",
  "with-capability", "require-capability", "compose-capability", "install-capability", "emit-event",
  "with-read", "with-default-read", "read", "write", "insert", "update", "select", "keys", "read-msg",
  "map", "fold", "filter", "zip", "reverse", "sort", "distinct", "where", "identity", "constantly",
  "format", "length", "take", "drop", "make-list", "enumerate", "contains", "yield", "resume",
  "namespace", "use", "implements", "create-table", "describe-table", "chain-data", "read-keyset",
  "true", "false",
  "begin-tx", "commit-tx", "rollback-tx", "env-data", "env-keys", "env-sigs", "env-chain-data",
  "env-gas", "env-gasmodel", "env-gaslimit", "env-namespace-policy", "load", "expect", "expect-failure",
  "expect-that", "print", "typecheck", "verify", "continue-pact", "pact-state", "sig-keyset",
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
