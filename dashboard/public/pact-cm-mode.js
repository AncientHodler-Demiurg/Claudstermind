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

  // StoicSyntax prefix COLOUR FAMILIES — the authoritative taxonomy from
  // OuronetInformational/StoicSyntax-Prefixes.md (§4). The base classifier (pact-highlight.js, which we
  // must not edit) only knows the older single-letter bands, so wrap the global once here to (a) OVERRIDE
  // some base bands to the new families (e.g. URD/URH → HEAVY-READ amber, A/C/CC → RECIPE) and (b) add the
  // new prefixes (URH*, URU_, CT_, aux `…x`, structural GOV/P|/SECURE/UEV_IMC). Everything reading
  // window.pactClassifyWord (the editable CM + the read-only diff CM) picks the families up. Ten families:
  //   COMPUTE UC_/UCk_/UCx_ · READ UR_/URC_/URCx_/URU_ · HEAVY-READ⚠ URH_/URHx_/URHC_/URHCx_ (LOUD amber)
  //   · ENFORCE UEV_/CAP_ · CONSTRUCT UDC_/UDCx_ · CONSTANT CT_ · WRITE WI_/WU_/WW_ · RECIPE A_/C_/CC_
  //   · PROTECTED XI_/XE_/XB_ · STRUCTURAL GOV/P|/SECURE/UEV_IMC. Migration: URD*≡URH*, UCK≡UCk, *X≡*x —
  //   coloured the same. `…x` auxiliaries take their family hue, dimmed (a distinct `…x` class → CSS dims).
  (function wrapStoicFamilies() {
    var base = window.pactClassifyWord;
    if (typeof base !== "function" || base._stoicFam) return;
    // Boundaries mirror the base BANDS: segment start (^ or after | . : >), optional write-count digits,
    // then a `_ > |` trailer. TS = strict trailer (no `|`) for the single letters A/C. X = an aux marker
    // (x or X, possibly doubled — covers the old UPPERCASE spelling and stacked xx).
    var L = "(?:^|[|.:>])", T = "\\d*[_>|]", TS = "\\d*[_>]", X = "[xX]+";
    var FAM = [
      // STRUCTURAL first — boilerplate; UEV_IMC must beat UEV_ (enforce), and the module-less markers.
      ["pk-struct",   new RegExp(L + "UEV_IMC(?![A-Za-z0-9])")],
      ["pk-struct",   new RegExp(L + "SECURE(?![A-Za-z0-9])")],
      ["pk-struct",   new RegExp(L + "GOV(?![A-Za-z])")],
      ["pk-struct",   new RegExp(L + "P\\|")],
      // HEAVY-READ before READ (both start UR). Old `D` spelling ≡ new `H`. Aux (…x) first.
      ["pk-heavyx",   new RegExp(L + "UR[HD]C?" + X + T)],
      ["pk-heavy",    new RegExp(L + "UR[HD]C?" + T)],
      // READ — aux/dim (URCx, URU) first, then UR_/URC_.
      ["pk-readx",    new RegExp(L + "URC" + X + T)],
      ["pk-readx",    new RegExp(L + "URU" + T)],
      ["pk-read",     new RegExp(L + "URC?" + T)],
      // COMPUTE — aux first (UCx/UCkx), then UC_/UCk_/UCK_.
      ["pk-computex", new RegExp(L + "UC[Kk]?" + X + T)],
      ["pk-compute",  new RegExp(L + "UC[Kk]?" + T)],
      // ENFORCE
      ["pk-enforce",  new RegExp(L + "(?:UEV|CAP)" + T)],
      // CONSTRUCT — aux first
      ["pk-ctorx",    new RegExp(L + "UDC" + X + T)],
      ["pk-ctor",     new RegExp(L + "UDC" + T)],
      // CONSTANT
      ["pk-const",    new RegExp(L + "CT" + T)],
      // WRITE
      ["pk-write",    new RegExp(L + "(?:WI|WU|WW|W)" + T)],
      // RECIPE — doubled CC/AA, then single A/C (strict boundary so they don't swallow multi-letter).
      ["pk-recipe",   new RegExp(L + "(?:CC|AA)" + T)],
      ["pk-recipe",   new RegExp(L + "[AC]" + TS)],
      // PROTECTED
      ["pk-orch",     new RegExp(L + "(?:XI|XE|XB)" + T)],
    ];
    function fam(w) { for (var i = 0; i < FAM.length; i++) if (FAM[i][1].test(w)) return FAM[i][0]; return null; }
    var wrapped = function (w) {
      var r = base(w);
      // Keep literals + language defs/keywords as the base decides; the families supersede its prefix bands.
      if (r === "pk-number" || r === "pk-bool" || r === "pk-def" || r === "pk-keyword") return r;
      var f = fam(w);
      return f || r;   // a family wins; else fall back to whatever the base said (band or null)
    };
    wrapped._stoicFam = true; wrapped._ccaaWrapped = true;   // supersedes the old CC/AA + URDX wrapper
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
