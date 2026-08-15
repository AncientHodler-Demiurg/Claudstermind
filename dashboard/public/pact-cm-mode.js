// StoicSyntax CodeMirror 5 mode for .pact / .repl — the EDITABLE editor's tokenizer.
//
// This is the streaming twin of pact-highlight.js's single-pass tokenizer: it scans the SAME token
// shapes (comments, strings with `\`-continuation, `:type`, `::`, brackets, prefix bands) and reuses
// `window.pactClassifyWord` verbatim, so the editable CodeMirror view colors identically to the
// read-only <pre> highlighter. Token style names are returned WITHOUT the `cm-` prefix (CodeMirror
// prepends it), so `"pk-write"` renders as `.cm-pk-write` — mapped to the same hex as `.pact-code
// .pk-write` in styles.css. Classic script (no import/export): loads via <script src> after
// codemirror.js + pact-highlight.js, before app.js.
(function () {
  "use strict";
  if (typeof window === "undefined" || !window.CodeMirror) return;
  var CodeMirror = window.CodeMirror;

  // Doubled prefixes CC_ / AA_ get the SAME band color as the single C_ / A_ (client / admin). The base
  // classifier (pact-highlight.js) only matches the single-letter bands, so wrap the global once here so
  // both the editable CM and anything else reading window.pactClassifyWord pick it up. Same lead/trail
  // boundary as the base BANDS (segment start `^|[|.:>]`, optional write-count `\d*`, then `_ > |`).
  (function wrapCcAa() {
    var base = window.pactClassifyWord;
    if (typeof base !== "function" || base._ccaaWrapped) return;
    var CC = /(?:^|[|.:>])CC\d*[_>|]/, AA = /(?:^|[|.:>])AA\d*[_>|]/;
    var wrapped = function (w) {
      var r = base(w);
      if (r == null) { if (CC.test(w)) return "pk-client"; if (AA.test(w)) return "pk-admin"; }
      return r;
    };
    wrapped._ccaaWrapped = true;
    window.pactClassifyWord = wrapped;
  })();

  // Same character class the highlighter uses for identifier / number / prefix words.
  var WORD = /[A-Za-z0-9_|<>.\-]/;

  function classify(word) {
    // Reuse the exact classifier (KEYWORDS, DEFS, BANDS incl. the write-count `\d*`, numbers, bools).
    return (typeof window.pactClassifyWord === "function") ? window.pactClassifyWord(word) : null;
  }

  // Consume the rest of an open string literal on this line. A `"` opens a string that runs until the
  // next unescaped `"`, spanning newlines (mirrors pact-highlight.js: a `\` escapes the next char, and
  // an unclosed string simply continues on the next line). Returns true if the string closed on this line.
  function eatString(stream) {
    var ch;
    while ((ch = stream.next()) != null) {
      if (ch === "\\") { stream.next(); continue; }   // escape: skip next char (incl. a `\"`)
      if (ch === '"') return true;                     // closed
    }
    return false;                                      // ran to EOL still open → continuation
  }

  CodeMirror.defineMode("stoicpact", function () {
    return {
      startState: function () { return { inString: false }; },
      token: function (stream, state) {
        // Mid-string continuation (a "…" that opened on an earlier line).
        if (state.inString) {
          if (eatString(stream)) state.inString = false;
          return "pk-string";
        }
        if (stream.eatSpace()) return null;
        var c = stream.peek();
        // Comment to end of line — `;;`+ is a structural section bar.
        if (c === ";") {
          var section = stream.match(/^;;/, false);
          stream.skipToEnd();
          return section ? "pk-section" : "pk-comment";
        }
        // String literal (handles \" escapes; may span lines via inString).
        if (c === '"') {
          stream.next();
          if (!eatString(stream)) state.inString = true;
          return "pk-string";
        }
        // `:type` annotation (single colon + a letter). Checked before `::`.
        if (c === ":" && stream.string.charAt(stream.pos + 1) !== ":" && /[A-Za-z]/.test(stream.string.charAt(stream.pos + 1) || "")) {
          stream.next();                               // the ':'
          while (!stream.eol() && WORD.test(stream.peek())) stream.next();
          return "pk-type";
        }
        // `::` module-ref accessor.
        if (c === ":" && stream.string.charAt(stream.pos + 1) === ":") { stream.next(); stream.next(); return "pk-op"; }
        // Brackets, colored by kind.
        if (c === "(" || c === ")") { stream.next(); return "pk-paren"; }
        if (c === "[" || c === "]") { stream.next(); return "pk-sq"; }
        if (c === "{" || c === "}") { stream.next(); return "pk-brace"; }
        // Identifier / number / prefix word.
        if (WORD.test(c)) {
          var w = "";
          while (!stream.eol() && WORD.test(stream.peek())) w += stream.next();
          return classify(w);   // pk-number | pk-bool | pk-def | pk-keyword | band | null
        }
        // Anything else (a lone ':', operators, punctuation) — passthrough.
        stream.next();
        return null;
      },
    };
  });

  CodeMirror.defineMIME("text/x-pact", "stoicpact");
})();
