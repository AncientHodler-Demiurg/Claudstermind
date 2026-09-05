// StoicSyntax medallion engine (production) — ONE classifier, TWO renderers:
//   • window.pactMedallionHtml(code)  → full read-only medallion HTML (angled caps, padded medallions,
//                                        per-type, foreign-black) for the <pre> viewer. No caret constraints.
//   • CodeMirror mode "stoicmedallion" → the EDITABLE, caret-safe twin (pills via background + inset
//                                        box-shadow + radius; caps angled via ::before/::after pseudo layers).
// The two share the taxonomy below (a port of pact-dalos-preview.gen.mjs), so the view and the editor agree.
// Classic script: loads after codemirror.js, before app.js. See pact-medallion-INTEGRATION.md.
(function (root) {
  var esc = function (s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
  function mix(a, b, t) {
    var pa = a.replace("#", "").match(/../g).map(function (h) { return parseInt(h, 16); });
    var pb = b.replace("#", "").match(/../g).map(function (h) { return parseInt(h, 16); });
    var to = function (x) { return Math.round(x).toString(16).padStart(2, "0"); };
    return "#" + pa.map(function (v, i) { return to(v + (pb[i] - v) * t); }).join("");
  }

  // ---- taxonomy ----
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
    ["CT_", "ctor"],   // CT_ = UDCc — first sub-block of the Construct (UDC) family; same colour as UDC_ (canonized 2026-09-02)
  ].sort(function (a, b) { return b[0].length - a[0].length; });
  var DEFKW = new Set(["defun", "defcap", "defschema", "defconst", "deftable", "defpact", "definterface", "defmodule", "module", "interface", "implements", "bless", "use", "step", "step-with-rollback"]);
  var BUILTINS = new Set(["let", "let*", "if", "cond", "lambda", "at", "read", "insert", "update", "write", "with-read", "with-default-read", "with-capability", "require-capability", "compose-capability", "install-capability", "create-capability-guard", "emit-event", "select", "keys", "fold", "map", "filter", "zip", "enforce", "enforce-one", "enforce-guard", "enforce-keyset", "keyset-ref-guard", "read-msg", "read-integer", "read-decimal", "read-string", "format", "concat", "take", "drop", "length", "reverse", "sort", "distinct", "contains", "and", "or", "not", "floor", "ceiling", "abs", "make-list", "hash", "tx-hash", "chain-data", "bind", "resume", "yield", "typeof", "where", "time", "add-time", "diff-time", "days", "hours", "minutes", "+", "-", "*", "/", "=", "!=", "<", ">", "<=", ">=", "^", "and?", "or?", "not?", "identity", "constantly", "str-to-int", "int-to-str", "is-charset", "base64-encode", "base64-decode", "describe-namespace", "define-namespace", "namespace"]);
  var FORMS = new Set(["module", "interface", "create-table"]);
  var TYPE_COL = { integer: "#3181e9", decimal: "#4d90e8", string: "#ec8013", bool: "#be274a", time: "#1d9a4d", guard: "#a045d5", keyset: "#b577da", object: "#f3c81b", list: "#3fbfae", table: "#a36633", module: "#8fa3bd", value: "#9298a4" };
  var BARE_TYPE = new Set(["string", "integer", "decimal", "bool", "guard", "keyset"]);

  function segMatch(name, p) { if (name.indexOf(p) === 0) return true; var bar = name.indexOf("|"); return bar >= 0 && name.slice(bar + 1).indexOf(p) === 0; }
  function prefixClass(name) {
    var cands = [name];
    if (name.indexOf("::") >= 0) cands.push(name.split("::").pop());
    if (name.indexOf(".") >= 0) cands.push(name.split(".").pop());
    for (var ci = 0; ci < cands.length; ci++) {
      var cand = cands[ci], bar = cand.indexOf("|");
      var segs = bar >= 0 ? [cand, cand.slice(bar + 1)] : [cand];
      // A KNOWN PREFIX wins FIRST — including one AFTER a `|` scope, so `P|UR_IMP` / `DALOS|C_Create` follow
      // their real prefix's colour (UR_/C_), not the grey policy/scope.
      for (var si = 0; si < segs.length; si++) {
        var s = segs[si];
        if (s === "UEV_IMC") return "val";
        // Match the full prefix (`UR_Name`) OR a BARE prefix — the class stem with NO `_Name` after it
        // (`UR`, `P|A`, `UEV`): a name that IS just the prefix, `p` minus its trailing `_`.
        for (var pi = 0; pi < PREFIX.length; pi++) { var p = PREFIX[pi][0]; if (s.indexOf(p) === 0 || s === p.slice(0, -1)) return PREFIX[pi][1]; }
      }
      // Only when NO known prefix appears → structural scaffolding (GOV / bare P| / SECURE) → grey.
      for (var sj = 0; sj < segs.length; sj++) { var s2 = segs[sj]; if (/^GOV(\b|\||$)/.test(s2) || /^P\|/.test(cand) || s2 === "SECURE") return "struct"; }
    }
    return null;
  }
  // Whole-doc pre-pass: metallic cap bands (bronze/silver/gold) + governance constants, from ;;{Cx}/{Gx} markers.
  // The executable body of a `(defcap …)` with the defcap wrapper, name, arg list, @metadata (@doc/@model/
  // @managed/@event) and string literals stripped — so `(defcap X (a) @doc "…" true)` reduces to just `true`.
  function capCore(body) {
    return body
      .replace(/^\(defcap\b/, "(")
      .replace(/"(?:[^"\\]|\\.)*"/g, "")            // blank out strings (e.g. @doc text)
      .replace(/@\w+\s*(?:\[[^\]]*\])?/g, "")       // drop @doc / @event / @managed / @model [...]
      .replace(/^\(\s*\S+\s*/, "")                  // drop "(" + cap NAME
      .replace(/^\([^()]*\)\s*/, "")                // drop the arg list "(...)"
      .replace(/\)\s*$/, "")                        // drop the closing defcap ")"
      .trim();
  }
  function computeCaps(code) {
    var capBand = {}, govConst = {};
    var markers = [], mm, re = /;;\s*(\{[A-Za-z]*\d+\})/g;
    while ((mm = re.exec(code))) markers.push({ i: mm.index, m: mm[1] });
    function markerBefore(pos) { var r = null; for (var k = 0; k < markers.length; k++) { if (markers[k].i < pos) r = markers[k].m; else break; } return r; }
    var recs = [], dc, re2 = /\(defcap\s+([A-Za-z0-9_|:>\-]+)/g;
    while ((dc = re2.exec(code))) {
      var nm = dc[1].split(":")[0], isPrefix = false;
      for (var pi = 0; pi < PREFIX.length; pi++) if (segMatch(nm, PREFIX[pi][0])) { isPrefix = true; break; }
      if (isPrefix) continue;
      var i = dc.index, depth = 0, body = "", started = false;
      for (; i < code.length; i++) { var c = code[i]; if (c === "(") { depth++; started = true; } else if (c === ")") depth--; if (started) body += c; if (started && depth === 0) break; }
      var core = capCore(body), composed = [], cc, ccre = /\(compose-capability\s+\(([A-Za-z0-9_|:>\-]+)/g;
      while ((cc = ccre.exec(core))) composed.push(cc[1].split(":")[0]);
      // "only composes" = the body is nothing but compose-capability(...) calls (and maybe a trailing true)
      var onlyComposes = composed.length > 0 && core.replace(/\(compose-capability\s+\([^()]*\)\)/g, "").replace(/\btrue\b/g, "").trim() === "";
      recs.push({ nm: nm, marker: markerBefore(dc.index), trivial: core === "true", composed: composed, onlyComposes: onlyComposes });
    }
    // C1 BRONZE: a literal-`true` body. Then FIXPOINT — a cap that ONLY composes bronze caps is itself bronze
    // (composing only simple/true caps is still simple). Bronze is assigned FIRST and is FINAL.
    for (var r = 0; r < recs.length; r++) if (recs[r].trivial) capBand[recs[r].nm] = "B";
    var changed = true;
    while (changed) { changed = false;
      for (var q = 0; q < recs.length; q++) { var rec = recs[q];
        if (capBand[rec.nm] === "B") continue;
        if (rec.onlyComposes && rec.composed.every(function (x) { return capBand[x] === "B"; })) { capBand[rec.nm] = "B"; changed = true; }
      }
    }
    // BRONZE WINS over the gold marker: a simple/true cap stays bronze even inside the governance / {C4} block.
    // Only non-bronze caps take gold (under {C4}/{G2}) or silver (everything else).
    // GOLD (for non-bronze caps): the `{C4}` authority sub-block, OR a GOV-named cap inside the GOVERNANCE
    // region (any `{Gx}` marker) — a non-trivial governance capability IS authority. Everything else → SILVER.
    for (var s = 0; s < recs.length; s++) {
      var rc = recs[s]; if (capBand[rc.nm] === "B") continue;
      var gold = rc.marker === "{C4}" || (/^GOV(\b|\||$)/.test(rc.nm) && /^\{G/.test(rc.marker || ""));
      capBand[rc.nm] = gold ? "G" : "S";
    }
    var gc, re3 = /\(defconst\s+([A-Za-z0-9_|:>\-]+)/g;
    while ((gc = re3.exec(code))) { if (markerBefore(gc.index) === "{G1}") govConst[gc[1].split(":")[0]] = true; }
    return { capBand: capBand, govConst: govConst };
  }

  // ===================== READ-ONLY renderer (full medallions) =====================
  var typeMedD = function (name, key) { var h = TYPE_COL[key || name] || "#c2c8d2"; return '<span style="display:inline-block;margin:0 3px;padding:0 5px;line-height:1.05;font-weight:700;border:2px solid ' + h + ";background:" + mix(h, "#0b1020", 0.80) + ";color:" + mix(h, "#ffffff", 0.35) + '">' + esc(name) + "</span>"; };
  // display:inline + box-decoration-break:clone (NOT inline-block) so a long value/string wraps in read-only
  // view mode — the pill background clones onto each wrapped fragment instead of overflowing horizontally.
  var valMedD = function (txt, h) { return '<span style="display:inline;-webkit-box-decoration-break:clone;box-decoration-break:clone;margin:0 3px;padding:0 6px;line-height:1.05;font-weight:700;border-radius:6px;background:' + mix(h, "#0b1020", 0.80) + ";color:" + mix(h, "#ffffff", 0.35) + '">' + esc(txt) + "</span>"; };
  var foreignMed = function (name) { var letters = name.replace(/[^A-Za-z]/g, ""); var isCap = letters.length > 0 && letters === letters.toUpperCase(); return isCap ? '<span class="capmed capKo"><span class="capmedi capKi">' + esc(name) + "</span></span>" : "<span class=fnK>" + esc(name) + "</span>"; };
  function emitAtom(a, caps) {
    if (/^-?\d[\d.]*$/.test(a)) return valMedD(a, a.indexOf(".") >= 0 ? "#4d90e8" : "#3181e9");
    if (a === "true" || a === "false") return valMedD(a, "#be274a");
    if (/^@/.test(a)) return "<span class=" + (/^@(event|managed)/.test(a) ? "tagO" : "tag") + ">" + esc(a) + "</span>";
    if (FORMS.has(a)) return "<span class=form>" + esc(a) + "</span>";
    if (BARE_TYPE.has(a)) return typeMedD(a);
    var name = a, type = null;
    for (var k = 1; k < a.length; k++) { if (a[k] === ":" && a[k - 1] !== ":" && a[k + 1] !== ":") { name = a.slice(0, k); type = a.slice(k + 1); break; } }
    var thtml = type != null ? ":" + (TYPE_COL[type] ? typeMedD(type) : "<span class=ty>" + esc(type) + "</span>") : "";   // the ':' stays DEFAULT — only the type name is coloured
    if (name.indexOf("::") >= 0) {
      var dc = name.indexOf("::"), q = name.slice(0, dc), member = name.slice(dc + 2);
      var qhtml = /^ref-/.test(q) ? valMedD(q, "#8fa3bd") : esc(q);
      var mcls = prefixClass(member), mhtml;
      if (mcls) mhtml = "<span class=" + mcls + ">" + esc(member) + "</span>";
      else if (BUILTINS.has(member)) mhtml = "<span class=bi>" + esc(member) + "</span>";
      else mhtml = foreignMed(member);
      return qhtml + "::" + mhtml + thtml;
    }
    if (/^ref-/.test(name)) return valMedD(name, "#8fa3bd") + thtml;
    var nm0 = name.split(":")[0];
    if (caps.govConst[nm0]) return "<span class=structb>" + esc(name) + "</span>" + thtml;
    if (caps.capBand[nm0]) { var b = caps.capBand[nm0]; return '<span class="capmed cap' + b + 'o"><span class="capmedi cap' + b + 'i">' + esc(name) + "</span></span>" + thtml; }
    if (DEFKW.has(name)) return "<span class=bib>" + esc(name) + "</span>" + thtml;
    var cls = prefixClass(name);
    if (cls) return "<span class=" + cls + ">" + esc(name) + "</span>" + thtml;
    if (BUILTINS.has(name)) return "<span class=bi>" + esc(name) + "</span>" + thtml;
    return esc(name) + thtml;
  }
  function emitString(raw) {
    if (raw.indexOf("\n") < 0) return valMedD(raw, "#ec8013");
    return raw.split("\n").map(function (ln) { var m = ln.match(/^([ \t]*)([\s\S]*)$/); return esc(m[1]) + (m[2] ? "<span class=strBlk>" + esc(m[2]) + "</span>" : ""); }).join("\n");
  }
  root.pactMedallionHtml = function (code) {
    code = String(code); var caps = computeCaps(code), toks = [], i = 0;
    while (i < code.length) {
      var c = code[i];
      if (c === ";") { var j = i; while (j < code.length && code[j] !== "\n") j++; toks.push(["cmt", code.slice(i, j)]); i = j; continue; }
      if (c === '"') { var j2 = i + 1; while (j2 < code.length) { if (code[j2] === "\\") { j2 += 2; continue; } if (code[j2] === '"') { j2++; break; } j2++; } toks.push(["str", code.slice(i, j2)]); i = j2; continue; }
      if (/\s/.test(c)) { var j3 = i; while (j3 < code.length && /\s/.test(code[j3])) j3++; toks.push(["ws", code.slice(i, j3)]); i = j3; continue; }
      if ("()[]{}".indexOf(c) >= 0) { toks.push(["punct", c]); i++; continue; }
      var j4 = i; while (j4 < code.length && !/[\s()[\]{};"]/.test(code[j4])) j4++; toks.push(["atom", code.slice(i, j4)]); i = j4;
    }
    var BK = ["bk0", "bk1", "bk2"], html = "", depth = 0;
    for (var ti = 0; ti < toks.length; ti++) {
      var t = toks[ti][0], v = toks[ti][1];
      if (t === "ws") html += esc(v);
      else if (t === "cmt") html += "<span class=cmt>" + esc(v) + "</span>";
      else if (t === "str") html += emitString(v);
      else if (t === "punct") {
        if (v === "{") {
          var jj = ti + 1; while (jj < toks.length && toks[jj][0] === "ws") jj++;
          var kk = (jj < toks.length && toks[jj][0] === "atom") ? jj + 1 : -1;
          while (kk > 0 && kk < toks.length && toks[kk][0] === "ws") kk++;
          if (kk > 0 && kk < toks.length && toks[kk][0] === "punct" && toks[kk][1] === "}") { html += valMedD("{" + toks[jj][1] + "}", "#f3c81b"); ti = kk; continue; }
        }
        var d; if ("([{".indexOf(v) >= 0) { d = depth % 3; depth++; } else { depth = Math.max(0, depth - 1); d = depth % 3; }
        html += "<span class=" + BK[d] + ">" + esc(v) + "</span>";
      } else html += emitAtom(v, caps);
    }
    return html;
  };

  // ===================== EDITABLE CodeMirror mode (caret-safe) =====================
  var CM_CAPS = { capBand: {}, govConst: {} };
  root.pactMedallionComputeCaps = function (code) { CM_CAPS = computeCaps(code); };
  function classifyWord(w) {
    if (/^-?\d[\d.]*$/.test(w)) return w.indexOf(".") >= 0 ? "md-num-dec" : "md-num-int";
    if (w === "true" || w === "false") return "md-bool";
    if (w.charAt(0) === "@") return /^@(event|managed)/.test(w) ? "md-tagO" : "md-tag";
    if (FORMS.has(w)) return "md-form";
    if (BARE_TYPE.has(w)) return "md-ty-" + w;
    if (/^ref-/.test(w)) return "md-ref";
    if (CM_CAPS.govConst[w]) return "md-structb";
    if (CM_CAPS.capBand[w]) return CM_CAPS.capBand[w] === "B" ? "md-capB" : CM_CAPS.capBand[w] === "S" ? "md-capS" : "md-capG";
    if (DEFKW.has(w)) return "md-bib";
    var cls = prefixClass(w); if (cls) return "md-" + cls;
    if (BUILTINS.has(w)) return "md-bi";
    return null;
  }
  function classifyMember(w) {
    var cls = prefixClass(w); if (cls) return "md-" + cls;
    if (BUILTINS.has(w)) return "md-bi";
    var letters = w.replace(/[^A-Za-z]/g, "");
    return (letters.length > 0 && letters === letters.toUpperCase()) ? "md-capK" : "md-fnK";
  }
  var WORDCH = /[^\s()\[\]{};":]/;
  var SCHEMA = /^\{\s*[^\s(){}\[\]";']+\s*\}/;
  function eatStr(stream) { var ch; while ((ch = stream.next()) != null) { if (ch === "\\") { stream.next(); continue; } if (ch === '"') return true; } return false; }
  if (root.CodeMirror) {
    root.CodeMirror.defineMode("stoicmedallion", function () {
      return {
        startState: function () { return { inString: false, depth: 0, afterColonColon: false, pendingType: false }; },
        copyState: function (s) { return { inString: s.inString, depth: s.depth, afterColonColon: s.afterColonColon, pendingType: s.pendingType }; },
        token: function (stream, state) {
          if (state.inString) { if (eatStr(stream)) state.inString = false; return "md-strblk"; }
          // The type name AFTER a single ':' (the ':' itself was left default on the previous token).
          if (state.pendingType) {
            state.pendingType = false;
            if (stream.peek() === "{") { if (stream.match(SCHEMA)) return "md-schema"; }
            else { var ty0 = ""; while (!stream.eol() && /[A-Za-z0-9_|<>.\-]/.test(stream.peek())) ty0 += stream.next(); if (ty0) return TYPE_COL[ty0] ? "md-ty-" + ty0 : "md-ty"; }
          }
          if (stream.eatSpace()) return null;
          var c = stream.peek();
          if (c === ";") { var sec = stream.match(/^;;/, false); stream.skipToEnd(); return sec ? "md-section" : "md-cmt"; }
          if (c === '"') { stream.next(); if (!eatStr(stream)) { state.inString = true; return "md-strblk"; } return "md-strv"; }
          if (c === ":") {
            var nx = stream.string.charAt(stream.pos + 1) || "";
            if (nx === ":") { stream.next(); stream.next(); state.afterColonColon = true; return "md-op"; }
            stream.next();                                   // leave the ':' DEFAULT (uncoloured); type follows next
            if (/[A-Za-z{]/.test(nx)) state.pendingType = true;
            return null;
          }
          if (c === "{") { if (stream.match(SCHEMA, false)) { stream.match(SCHEMA); return "md-schema"; } }
          if (c === "(" || c === "[" || c === "{") { stream.next(); var d = state.depth % 3; state.depth++; return "md-bk" + d; }
          if (c === ")" || c === "]" || c === "}") { stream.next(); state.depth = Math.max(0, state.depth - 1); return "md-bk" + (state.depth % 3); }
          if (WORDCH.test(c)) { var w = ""; while (!stream.eol() && WORDCH.test(stream.peek())) w += stream.next(); if (state.afterColonColon) { state.afterColonColon = false; return classifyMember(w); } return classifyWord(w); }
          stream.next(); return null;
        },
      };
    });
    root.CodeMirror.defineMIME("text/x-stoicmedallion", "stoicmedallion");
  }
})(typeof window !== "undefined" ? window : globalThis);
