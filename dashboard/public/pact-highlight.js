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

  // The full Pact 5 builtin + special-form set (indexed from kda-chain.org/docs/pact-5, 2026-08).
  // Kept in sync with packages/stoicsyntax-pact/src/tokenizer.mjs (the canonical source).
  var KEYWORDS = new Set([
    "let", "let*", "lambda", "cond", "if", "bind", "do", "step", "step-with-rollback",
    "enforce", "enforce-one", "enforce-guard", "enforce-keyset", "enforce-pact-version", "enforce-verifier",
    "with-capability", "require-capability", "compose-capability", "install-capability", "emit-event",
    "namespace", "use", "implements", "bless", "continue", "resume", "yield",
    "acquire-module-admin", "at", "base64-decode", "base64-encode", "chain-data", "compose", "concat",
    "constantly", "contains", "define-namespace", "describe-namespace", "distinct", "drop", "enumerate",
    "filter", "fold", "format", "hash", "hash-keccak256", "identity", "int-to-str", "is-charset", "length",
    "list-modules", "make-list", "map", "negate", "pact-id", "pact-version", "poseidon-hash-hack-a-chain",
    "read-decimal", "read-integer", "read-keyset", "read-msg", "read-string", "remove", "reverse", "round",
    "show", "sort", "static-redeploy", "str-to-int", "str-to-list", "take", "try", "tx-hash", "typeof",
    "where", "zip",
    "create-table", "describe-keyset", "describe-module", "describe-table", "fold-db", "insert", "keys",
    "read", "select", "update", "with-default-read", "with-read", "write", "txlog", "keylog",
    "create-capability-guard", "create-capability-pact-guard", "create-module-guard", "create-pact-guard",
    "create-principal", "create-user-guard", "is-principal", "keyset-ref-guard", "typeof-principal",
    "validate-principal", "create-principal-namespace", "define-keyset", "keys-2", "keys-all", "keys-any",
    "abs", "ceiling", "floor", "dec", "exp", "ln", "log", "mod", "sqrt", "and", "or", "not", "xor", "shift",
    "and?", "or?", "not?",
    "add-time", "days", "diff-time", "format-time", "hours", "minutes", "parse-time", "time",
    "begin-tx", "commit-tx", "rollback-tx", "continue-pact", "pact-state", "env-data", "env-keys",
    "env-sigs", "env-chain-data", "env-hash", "env-namespace-policy", "env-entity", "env-events",
    "env-exec-config", "env-dynref", "env-enable-repl-natives", "env-simulate-onchain", "env-gas",
    "env-gaslimit", "env-gasmodel", "env-gasprice", "env-gasrate", "env-gaslog", "env-milligas",
    "env-set-milligas", "env-set-debug-flag", "env-module-admin", "env-verifiers",
    "expect", "expect-failure", "expect-that", "print", "typecheck", "verify", "test-capability",
    "sig-keyset", "format-address", "mock-spv", "load", "with-applied-env", "bench",
    "hyperlane-decode-token-message", "hyperlane-encode-token-message", "hyperlane-message-id",
    "verify-spv", "pairing-check", "point-add", "scalar-mult",
    "CHARSET_ASCII", "CHARSET_LATIN1",
  ]);
  // def-forms — same hue as keywords but bold, so declarations stand out.
  var DEFS = new Set([
    "module", "interface", "defun", "defcap", "defconst", "defschema", "deftable", "defpact", "defproperty",
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
