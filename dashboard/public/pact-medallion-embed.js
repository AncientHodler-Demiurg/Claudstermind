// Editable StoicSyntax medallions for CodeMirror — a faithful port of the read-only DALOS engine
// (pact-dalos-preview.gen.mjs) into a streaming CM mode. SAME classification (prefix bands, per-type
// palette, marker-driven cap bands bronze/silver/gold, foreign-black, ref-/schema/form/tag medallions,
// bracket-depth colours) — but every medallion is redrawn CARET-SAFE: background + inset box-shadow
// (fake border) + border-radius only. No padding / border / margin / inline-block / clip-path, so a
// token's advance width never changes and CodeMirror's caret stays aligned while you type.
//
// Two intentional differences from the read-only tab (forced by caret-safety):
//   1. caps are ROUNDED, not angled (the clip-path slant needs horizontal width).
//   2. pills HUG the text — no side padding (padding moves the caret).
// Everything else — hues, which token gets which medallion, the cap metals, foreign-black — matches.
//
// Loaded as a classic script AFTER codemirror.js. window.pactClassifyWord (pact-highlight.js) is NOT
// used here; this file carries the full DALOS taxonomy itself so the two tabs agree.
(function () {
  if (typeof window === "undefined" || !window.CodeMirror) return;
  var CM = window.CodeMirror;

  // ---- taxonomy (mirrors pact-dalos-preview.gen.mjs) ----
  var PREFIX = [
    ["URHCx_", "heavy"], ["URHC_", "heavy"], ["URHx_", "heavy"], ["URH_", "heavy"],
    ["URCx_", "rx"], ["URCv_", "rl"], ["URCi_", "cost"], ["URC_", "rl"], ["URU_", "rl"], ["UR_", "rl"],
    ["UCkx_", "cx"], ["UCk_", "ck"], ["UCx_", "cx"], ["UCv_", "ck"], ["UC_", "compute"],
    ["UEV_", "val"], ["CAP_", "cap"],
    ["UDCx_", "ctorx"], ["UDC_", "ctor"],
    ["WW_", "ww"], ["WU4_", "wu"], ["WU3_", "wu"], ["WU2_", "wu"], ["WU_", "wu"], ["WI_", "wi"],
    ["XI_", "xi"], ["XE_", "xe"], ["XB_", "xb"],
    ["AAp_", "adm"], ["AA_", "adm"], ["Ap_", "adm"], ["AU_", "adm"], ["A_", "adm"],
    ["CCp_", "cli"], ["CC_", "cli"], ["Cp_", "cli"], ["C_", "cli"],
    ["CT_", "ctor"],   // CT_ = UDCc — Construct (UDC) family, same colour as UDC_ (canonized 2026-09-02)
  ].sort(function (a, b) { return b[0].length - a[0].length; });
  var DEFKW = new Set(["defun", "defcap", "defschema", "defconst", "deftable", "defpact", "definterface", "defmodule", "module", "interface", "implements", "bless", "use", "step", "step-with-rollback"]);
  var BUILTINS = new Set(["let", "let*", "if", "cond", "lambda", "at", "read", "insert", "update", "write", "with-read", "with-default-read", "with-capability", "require-capability", "compose-capability", "install-capability", "create-capability-guard", "emit-event", "select", "keys", "fold", "map", "filter", "zip", "enforce", "enforce-one", "enforce-guard", "enforce-keyset", "keyset-ref-guard", "read-msg", "read-integer", "read-decimal", "read-string", "format", "concat", "take", "drop", "length", "reverse", "sort", "distinct", "contains", "and", "or", "not", "floor", "ceiling", "abs", "make-list", "hash", "tx-hash", "chain-data", "bind", "resume", "yield", "typeof", "where", "time", "add-time", "diff-time", "days", "hours", "minutes", "+", "-", "*", "/", "=", "!=", "<", ">", "<=", ">=", "^", "and?", "or?", "not?", "identity", "constantly", "str-to-int", "int-to-str", "is-charset", "base64-encode", "base64-decode", "describe-namespace", "define-namespace", "namespace"]);
  var TYPE_COL = { integer: 1, decimal: 1, string: 1, bool: 1, time: 1, guard: 1, keyset: 1, object: 1, list: 1, table: 1, module: 1, value: 1 }; // keys only — colours live in CSS (.cm-md-ty-<t>)
  var BARE_TYPE = new Set(["string", "integer", "decimal", "bool", "guard", "keyset"]);
  var FORMS = new Set(["module", "interface", "create-table"]);

  function segMatch(name, p) {
    if (name.indexOf(p) === 0) return true;
    var bar = name.indexOf("|"); return bar >= 0 && name.slice(bar + 1).indexOf(p) === 0;
  }
  function prefixClass(name) {
    var cands = [name];
    if (name.indexOf("::") >= 0) cands.push(name.split("::").pop());
    if (name.indexOf(".") >= 0) cands.push(name.split(".").pop());
    for (var ci = 0; ci < cands.length; ci++) {
      var cand = cands[ci], bar = cand.indexOf("|");
      var segs = bar >= 0 ? [cand, cand.slice(bar + 1)] : [cand];
      // A KNOWN PREFIX wins FIRST — including one AFTER a `|` scope, so `P|UR_IMP` follows its real prefix.
      for (var si = 0; si < segs.length; si++) {
        var s = segs[si];
        if (s === "UEV_IMC") return "val";
        // full prefix (`UR_Name`) OR a BARE prefix — the class stem with no `_Name` (`UR`, `P|A`, `UEV`).
        for (var pi = 0; pi < PREFIX.length; pi++) { var p = PREFIX[pi][0]; if (s.indexOf(p) === 0 || s === p.slice(0, -1)) return PREFIX[pi][1]; }
      }
      for (var sj = 0; sj < segs.length; sj++) { var s2 = segs[sj]; if (/^GOV(\b|\||$)/.test(s2) || /^P\|/.test(cand) || s2 === "SECURE") return "struct"; }
    }
    return null;
  }

  // ---- whole-doc pre-pass: metallic cap bands + governance constants, from the ;;{Cx}/{Gx} markers ----
  var CAPBAND = {}, GOVCONST = {};
  function computeCaps(code) {
    CAPBAND = {}; GOVCONST = {};
    var markers = [], mm, re = /;;\s*(\{[A-Za-z]*\d+\})/g;
    while ((mm = re.exec(code))) markers.push({ i: mm.index, m: mm[1] });
    function markerBefore(pos) { var r = null; for (var k = 0; k < markers.length; k++) { if (markers[k].i < pos) r = markers[k].m; else break; } return r; }
    var capCore = function (body) { return body.replace(/^\(defcap\b/, "(").replace(/"(?:[^"\\]|\\.)*"/g, "").replace(/@\w+\s*(?:\[[^\]]*\])?/g, "").replace(/^\(\s*\S+\s*/, "").replace(/^\([^()]*\)\s*/, "").replace(/\)\s*$/, "").trim(); };
    var recs = [], dc, re2 = /\(defcap\s+([A-Za-z0-9_|:>\-]+)/g;
    while ((dc = re2.exec(code))) {
      var nm = dc[1].split(":")[0];
      var isPrefix = false; for (var pi = 0; pi < PREFIX.length; pi++) if (segMatch(nm, PREFIX[pi][0])) { isPrefix = true; break; }
      if (isPrefix) continue;
      var i = dc.index, depth = 0, body = "", started = false;
      for (; i < code.length; i++) { var c = code[i]; if (c === "(") { depth++; started = true; } else if (c === ")") depth--; if (started) body += c; if (started && depth === 0) break; }
      var core = capCore(body), composed = [], cc, ccre = /\(compose-capability\s+\(([A-Za-z0-9_|:>\-]+)/g;
      while ((cc = ccre.exec(core))) composed.push(cc[1].split(":")[0]);
      var onlyComposes = composed.length > 0 && core.replace(/\(compose-capability\s+\([^()]*\)\)/g, "").replace(/\btrue\b/g, "").trim() === "";
      recs.push({ nm: nm, marker: markerBefore(dc.index), trivial: core === "true", composed: composed, onlyComposes: onlyComposes });
    }
    for (var r = 0; r < recs.length; r++) if (recs[r].trivial) CAPBAND[recs[r].nm] = "B";
    var changed = true;
    while (changed) { changed = false; for (var q = 0; q < recs.length; q++) { var rec = recs[q]; if (CAPBAND[rec.nm] === "B") continue; if (rec.onlyComposes && rec.composed.every(function (x) { return CAPBAND[x] === "B"; })) { CAPBAND[rec.nm] = "B"; changed = true; } } }
    // GOLD (non-bronze caps): `{C4}` authority sub-block, OR a GOV-named cap in the GOVERNANCE region (`{Gx}`).
    for (var s = 0; s < recs.length; s++) {
      var rc = recs[s]; if (CAPBAND[rc.nm] === "B") continue;
      var gold = rc.marker === "{C4}" || (/^GOV(\b|\||$)/.test(rc.nm) && /^\{G/.test(rc.marker || ""));
      CAPBAND[rc.nm] = gold ? "G" : "S";
    }
    var gc, re3 = /\(defconst\s+([A-Za-z0-9_|:>\-]+)/g;
    while ((gc = re3.exec(code))) { if (markerBefore(gc.index) === "{G1}") GOVCONST[gc[1].split(":")[0]] = true; }
  }

  // ---- classify one bare atom (no trailing :type — the mode peels that off; no '::' — split by the mode) ----
  function classifyWord(w) {
    if (/^-?\d[\d.]*$/.test(w)) return w.indexOf(".") >= 0 ? "md-num-dec" : "md-num-int";
    if (w === "true" || w === "false") return "md-bool";
    if (w.charAt(0) === "@") return /^@(event|managed)/.test(w) ? "md-tagO" : "md-tag";
    if (FORMS.has(w)) return "md-form";
    if (BARE_TYPE.has(w)) return "md-ty-" + w;
    if (/^ref-/.test(w)) return "md-ref";
    if (GOVCONST[w]) return "md-structb";
    if (CAPBAND[w]) return CAPBAND[w] === "B" ? "md-capB" : CAPBAND[w] === "S" ? "md-capS" : "md-capG";
    if (DEFKW.has(w)) return "md-bib";
    var cls = prefixClass(w);
    if (cls) return "md-" + cls;
    if (BUILTINS.has(w)) return "md-bi";
    return null;
  }
  // classify a member AFTER '::' — band, builtin, or FOREIGN (all-caps → cap-black, else fn-black)
  function classifyMember(w) {
    var cls = prefixClass(w); if (cls) return "md-" + cls;
    if (BUILTINS.has(w)) return "md-bi";
    var letters = w.replace(/[^A-Za-z]/g, "");
    return (letters.length > 0 && letters === letters.toUpperCase()) ? "md-capK" : "md-fnK";
  }

  var WORDCH = /[^\s()\[\]{};":]/;
  var SCHEMA = /^\{\s*[^\s(){}\[\]";']+\s*\}/;
  function eatStr(stream) { var ch; while ((ch = stream.next()) != null) { if (ch === "\\") { stream.next(); continue; } if (ch === '"') return true; } return false; }

  CM.defineMode("stoicpreview", function () {
    return {
      startState: function () { return { inString: false, depth: 0, afterColonColon: false, pendingType: false }; },
      copyState: function (s) { return { inString: s.inString, depth: s.depth, afterColonColon: s.afterColonColon, pendingType: s.pendingType }; },
      token: function (stream, state) {
        if (state.inString) { if (eatStr(stream)) state.inString = false; return "md-strblk"; }
        // The type name AFTER a single ':' (the ':' itself was left default on the previous token).
        if (state.pendingType) {
          state.pendingType = false;
          if (stream.peek() === "{") { if (stream.match(SCHEMA)) return "md-schema"; }
          else { var ty0 = ""; while (!stream.eol() && /[A-Za-z0-9_|<>.\-]/.test(stream.peek())) ty0 += stream.next(); if (ty0) return TYPE_COL[ty0] ? ("md-ty-" + ty0) : "md-ty"; }
        }
        if (stream.eatSpace()) return null;
        var c = stream.peek();
        // comment / section bar
        if (c === ";") { var sec = stream.match(/^;;/, false); stream.skipToEnd(); return sec ? "md-section" : "md-cmt"; }
        // string: single-line → pill, multi-line → block (mirrors DALOS)
        if (c === '"') { stream.next(); var closed = eatStr(stream); if (!closed) { state.inString = true; return "md-strblk"; } return "md-strv"; }
        // ':' — '::' module-ref op; else the ':' stays DEFAULT and the type that follows is coloured next
        if (c === ":") {
          var nx = stream.string.charAt(stream.pos + 1) || "";
          if (nx === ":") { stream.next(); stream.next(); state.afterColonColon = true; return "md-op"; }
          stream.next();
          if (/[A-Za-z{]/.test(nx)) state.pendingType = true;
          return null;
        }
        // standalone {Schema} object-reference → one yellow pill (else a normal brace, depth-coloured)
        if (c === "{") { if (stream.match(SCHEMA, false)) { stream.match(SCHEMA); return "md-schema"; } }
        // bracket-pair depth colouring — matched pairs share a colour
        if (c === "(" || c === "[" || c === "{") { stream.next(); var d = state.depth % 3; state.depth++; return "md-bk" + d; }
        if (c === ")" || c === "]" || c === "}") { stream.next(); state.depth = Math.max(0, state.depth - 1); return "md-bk" + (state.depth % 3); }
        // an atom (word). After a '::' the atom is a foreign/qualified MEMBER.
        if (WORDCH.test(c)) {
          var w = ""; while (!stream.eol() && WORDCH.test(stream.peek())) w += stream.next();
          if (state.afterColonColon) { state.afterColonColon = false; return classifyMember(w); }
          return classifyWord(w);
        }
        stream.next(); return null;
      },
    };
  });

  var ed = null;
  window.pactEdPreviewInit = function () {
    if (ed) { ed.refresh(); return ed; }
    var host = document.getElementById("edhost"); if (!host) return null;
    var srcEl = document.getElementById("edsrc");
    var src = srcEl ? srcEl.value : "";
    computeCaps(src);
    ed = CM(host, { value: src, mode: "stoicpreview", lineNumbers: true, lineWrapping: false, tabSize: 2, indentUnit: 2, matchBrackets: false, styleActiveLine: true });
    ed.getWrapperElement().classList.add("mdl");
    // Recompute the metallic cap bands from the FULL doc as you edit, then repaint (debounced).
    var t = null;
    ed.on("change", function () { clearTimeout(t); t = setTimeout(function () { computeCaps(ed.getValue()); ed.setOption("mode", "stoicpreview"); }, 200); });
    var caret = document.getElementById("edcaret");
    ed.on("cursorActivity", function (cm) { var p = cm.getCursor(); if (caret) caret.textContent = (p.line + 1) + ":" + (p.ch + 1); });
    var seg = document.getElementById("edseg");
    if (seg) seg.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var bs = this.querySelectorAll("button"); for (var i = 0; i < bs.length; i++) bs[i].classList.toggle("on", bs[i] === b);
      ed.getWrapperElement().classList.toggle("mdl", b.getAttribute("data-mode") === "mdl"); ed.refresh(); ed.focus();
    });
    setTimeout(function () { ed.refresh(); }, 0);
    return ed;
  };
})();
