// Pact / StoicSyntax syntax highlighter for the Pact IDE viewer.
//
// A single-pass tokenizer (scan left-to-right, emit escaped <span class="pk-…"> per token) — NOT
// regex-replace over HTML, which double-substitutes inside already-inserted spans. The star feature
// is StoicSyntax PREFIX coloring: in this discipline the function prefix IS the contract, so we color
// the whole identifier by its prefix band — unprotected reads/compute in cool colors, protected
// state-changers (admin/orchestration/persistence) in warm/red. Prefixes appear at a segment boundary
// (word start, or after `|` `.` `:` `>`), so `IC|UDC_…`, `URC|KDA-PID_CLAD`, and the cap-name shape
// `SWP|A_…` all resolve to the right band.
//
// Classic script (no import/export) so the browser loads it via <script src> before app.js; the Node
// test evals this source with a fake `window` and exercises window.pactHighlight.
(function (root) {
  "use strict";

  // Pact 5 builtins + special forms, SOURCED from kadena-io/pact-5 (Pact/Core/Builtin.hs) — source, not
  // docs (no `verify`/`create-user-guard`/`try`; formal verification is gone). Mirrors the canonical
  // packages/stoicsyntax-pact/src/tokenizer.mjs; see brain/OuronetPact/PACT-REFERENCE.md.
  var KEYWORDS = new Set([
    "let", "let*", "lambda", "and", "or", "enforce", "enforce-one", "with-capability", "step",
    "step-with-rollback", "use", "implements", "bless",
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
  // def-forms per the Pact 5 lexer — NB: no `defproperty` (property system removed in Pact 5).
  var DEFS = new Set([
    "module", "interface", "defun", "defcap", "defconst", "defschema", "deftable", "defpact",
  ]);

  // Prefix → band class. Order matters (specific/single-letter handled with a strict [_>] boundary so
  // they can't swallow multi-letter prefixes). The lead class `[|.:>]` requires a real segment start;
  // the trailing class allows `_`, cap-arrow `>`, or a `|` band separator (multi-letter only).
  var BANDS = [
    ["pk-write",   /(?:^|[|.:>])(?:WI|WU|WW|W)[_>]/],
    ["pk-admin",   /(?:^|[|.:>])A[_>]/],
    ["pk-client",  /(?:^|[|.:>])C[_>]/],
    ["pk-orch",    /(?:^|[|.:>])(?:XI|XE|XB)[_>]/],
    ["pk-cap",     /(?:^|[|.:>])CAP[_>|]/],
    ["pk-enforce", /(?:^|[|.:>])UEV[_>|]/],
    ["pk-ctor",    /(?:^|[|.:>])UDC[_>|]/],
    ["pk-read",    /(?:^|[|.:>])(?:URDC|URD|URC|UR)[_>|]/],
    ["pk-compute", /(?:^|[|.:>])(?:UCK|UC)[_>|]/],
  ];

  var NUM = /^-?\d+(\.\d+)?$/;
  var WORD = /[A-Za-z0-9_|<>.\-]/;

  function esc(s) {
    return s.replace(/[&<>]/g, function (c) { return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"; });
  }

  function classifyWord(w) {
    if (NUM.test(w)) return "pk-number";
    if (w === "true" || w === "false") return "pk-bool";
    if (DEFS.has(w)) return "pk-def";
    if (KEYWORDS.has(w)) return "pk-keyword";
    for (var i = 0; i < BANDS.length; i++) if (BANDS[i][1].test(w)) return BANDS[i][0];
    return null;
  }

  function pactHighlight(code) {
    var out = [];
    function push(cls, text) { out.push(cls ? '<span class="' + cls + '">' + esc(text) + "</span>" : esc(text)); }
    var n = code.length, i = 0;
    while (i < n) {
      var c = code[i];
      // comment to end of line — `;;`+ reads as a structural section bar
      if (c === ";") {
        var j = i; while (j < n && code[j] !== "\n") j++;
        var seg = code.slice(i, j);
        push(/^;;/.test(seg) ? "pk-section" : "pk-comment", seg);
        i = j; continue;
      }
      // string literal (handles \" escapes)
      if (c === '"') {
        var k = i + 1;
        while (k < n) { if (code[k] === "\\") { k += 2; continue; } if (code[k] === '"') { k++; break; } k++; }
        push("pk-string", code.slice(i, k)); i = k; continue;
      }
      // `:type` annotation (a single colon + a letter). Checked before `::`.
      if (c === ":" && code[i + 1] !== ":" && /[A-Za-z]/.test(code[i + 1] || "")) {
        var t = i + 1; while (t < n && WORD.test(code[t])) t++;
        push("pk-type", code.slice(i, t)); i = t; continue;
      }
      // `::` module-ref accessor
      if (c === ":" && code[i + 1] === ":") { push("pk-op", "::"); i += 2; continue; }
      // brackets, colored by kind
      if (c === "(" || c === ")") { push("pk-paren", c); i++; continue; }
      if (c === "[" || c === "]") { push("pk-sq", c); i++; continue; }
      if (c === "{" || c === "}") { push("pk-brace", c); i++; continue; }
      // identifier / number / prefix word
      if (WORD.test(c)) {
        var w = i; while (w < n && WORD.test(code[w])) w++;
        var word = code.slice(i, w);
        push(classifyWord(word), word); i = w; continue;
      }
      // anything else (whitespace, operators, punctuation) — passthrough, escaped
      var d = i;
      while (d < n && !WORD.test(code[d]) && code[d] !== ";" && code[d] !== '"' && code[d] !== ":" &&
             code[d] !== "(" && code[d] !== ")" && code[d] !== "[" && code[d] !== "]" && code[d] !== "{" && code[d] !== "}") d++;
      if (d === i) d = i + 1;
      push(null, code.slice(i, d)); i = d;
    }
    return out.join("");
  }

  // The band legend (class → human label + one-liner), so the UI can teach the color language.
  var LEGEND = [
    ["pk-compute", "UC_", "pure compute"],
    ["pk-read", "UR_", "reads / derives"],
    ["pk-ctor", "UDC_", "object ctors"],
    ["pk-enforce", "UEV_", "enforce / validate"],
    ["pk-cap", "CAP_", "capability"],
    ["pk-client", "C_", "client recipe"],
    ["pk-orch", "XE_", "orchestration"],
    ["pk-admin", "A_", "admin"],
    ["pk-write", "W_", "persistence write"],
  ];

  root.pactHighlight = pactHighlight;
  root.pactClassifyWord = classifyWord;
  root.pactBandLegend = LEGEND;
})(typeof window !== "undefined" ? window : this);
