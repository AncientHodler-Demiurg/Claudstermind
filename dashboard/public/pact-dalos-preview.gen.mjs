// Deterministic Pact colouring engine — prototype of the StoicSyntax highlighter. Reads a real module and
// emits coloured HTML per the palette + medallion rules. Colour-in-place (no reorder yet; that's the agent pass).
import { readFileSync, writeFileSync } from "node:fs";
const SRC = "/home/ancientbox/ClaudeWS/OuroborosNetwork/_onchain/Ouronet/1_SOVEREIGN/STAGE_01/2_Core/01_DALOS.pact";
const code = readFileSync(SRC, "utf8");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- prefixes (longest-first) → text-colour class (the 37, + structural) ----
const PREFIX = [
  ["URHCx_","heavy"],["URHC_","heavy"],["URHx_","heavy"],["URH_","heavy"],
  ["URCx_","rx"],["URCv_","rl"],["URCi_","cost"],["URC_","rl"],["URU_","rl"],["UR_","rl"],
  ["UCkx_","cx"],["UCk_","ck"],["UCx_","cx"],["UCv_","ck"],["UC_","compute"],
  ["UEV_","val"],["CAP_","cap"],
  ["UDCx_","ctorx"],["UDC_","ctor"],
  ["WW_","ww"],["WU4_","wu"],["WU3_","wu"],["WU2_","wu"],["WU_","wu"],["WI_","wi"],
  ["XI_","xi"],["XE_","xe"],["XB_","xb"],
  ["AAp_","adm"],["AA_","adm"],["Ap_","adm"],["AU_","adm"],["A_","adm"],
  ["CCp_","cli"],["CC_","cli"],["Cp_","cli"],["C_","cli"],
  ["CT_","ctor"],   // CT_ = UDCc — Construct (UDC) family, same colour as UDC_ (canonized 2026-09-02)
].sort((a, b) => b[0].length - a[0].length);
const AUX = new Set(["heavy","rx","cx","ctorx"]);   // (already encoded per-entry; kept for reference)

const DEFKW = new Set(["defun","defcap","defschema","defconst","deftable","defpact","definterface","defmodule","module","interface","implements","bless","use","step","step-with-rollback"]);
const BUILTINS = new Set(["let","let*","if","cond","lambda","at","read","insert","update","write","with-read","with-default-read","with-capability","require-capability","compose-capability","install-capability","create-capability-guard","emit-event","select","keys","fold","map","filter","zip","enforce","enforce-one","enforce-guard","enforce-keyset","keyset-ref-guard","read-msg","read-integer","read-decimal","read-string","format","concat","take","drop","length","reverse","sort","distinct","contains","and","or","not","floor","ceiling","abs","make-list","hash","tx-hash","chain-data","bind","resume","yield","typeof","where","bind","time","add-time","diff-time","days","hours","minutes","+","-","*","/","=","!=","<",">","<=",">=","^","and?","or?","not?","identity","constantly","str-to-int","int-to-str","is-charset","base64-encode","base64-decode","describe-namespace","define-namespace","namespace"]);
const TYPES = new Set(["string","integer","decimal","bool","time","guard","keyset","list","object","module","value","unit"]);
// The "main 3" top-level structural forms (outside the constructor family) → rounded YELLOW medallion.
const FORMS = new Set(["module","interface","create-table"]);
// Per-type colour. TYPE NAME → straight+border (typeMedD); VALUE → rounded no-border (valMedD, string-block build).
function mix(a,b,t){const pa=a.replace('#','').match(/../g).map(h=>parseInt(h,16)),pb=b.replace('#','').match(/../g).map(h=>parseInt(h,16)),to=x=>Math.round(x).toString(16).padStart(2,'0');return '#'+pa.map((v,i)=>to(v+(pb[i]-v)*t)).join('');}
const TYPE_COL={integer:"#3181e9",decimal:"#4d90e8",string:"#ec8013",bool:"#be274a",time:"#1d9a4d",guard:"#a045d5",keyset:"#b577da",object:"#f3c81b",list:"#3fbfae",table:"#a36633",module:"#8fa3bd",value:"#9298a4"};
// bare type names safe to medallion wherever they appear (the list-element case `[string]`); excludes `time`
// (also a builtin fn) and object/module/list/table/value (ambiguous or handled elsewhere).
const BARE_TYPE=new Set(["string","integer","decimal","bool","guard","keyset"]);
// Shorter medallions (line-height 1.05) and UNIFORM height: every medallion carries a 2px border — coloured for
// type names, TRANSPARENT for the borderless value pills — so bordered and border-less ones are the same height.
const typeMedD=(name,key)=>{const h=TYPE_COL[key||name]||"#c2c8d2";return `<span style="display:inline-block;margin:0 3px;padding:0 5px;line-height:1.05;font-weight:700;border:2px solid ${h};background:${mix(h,'#0b1020',0.80)};color:${mix(h,'#ffffff',0.35)}">${esc(name)}</span>`;};
const valMedD=(txt,h)=>`<span style="display:inline;-webkit-box-decoration-break:clone;box-decoration-break:clone;margin:0 3px;padding:0 6px;line-height:1.05;font-weight:700;border-radius:6px;background:${mix(h,'#0b1020',0.80)};color:${mix(h,'#ffffff',0.35)}">${esc(txt)}</span>`;
// Foreign / uncategorisable member from another module (state unknown). ALL-CAPS name (Pact convention) = a
// CAPABILITY → black ANGLED medallion; anything else = a plain FUNCTION → black rounded medallion. Neutral black
// because we can't know its band/nature from outside this module.
const foreignMed=(name)=>{const letters=name.replace(/[^A-Za-z]/g,"");const isCap=letters.length>0&&letters===letters.toUpperCase();
  return isCap ? `<span class="capmed capKo"><span class="capmedi capKi">${esc(name)}</span></span>` : `<span class=fnK>${esc(name)}</span>`;};

// ---- pass 1: capability bands + governance constants — driven by the ;;{Cx}/;;{Gx} MARKERS, not body heuristics.
// You can't tell C1/C2/C3/C4 from a cap's body; the block markers ARE the source of truth. A cap's band = the
// marker block it sits under: {C1}→bronze, {C2}/{C3}→silver, {C4}/{G2}→gold. PRIORITY EXCEPTION: a trivial `true`
// cap is always BRONZE regardless of its block (a simple cap). Governance constants (defconst under {G1}) → grey+BOLD.
const capBand = {}, govConst = {};
{
  // Only GOLD needs a marker: a cap under `;;{C4}` OR a governance cap (`;;{G2}`). Bronze = a literal `true` body.
  // Everything else (any non-true cap, with or without compose-capability) = silver. So C1/C2/C3 are INFERRED
  // (true→bronze, else→silver); the C1/C2/C3 markers only organise the file, they don't drive the colour.
  const markers = [...code.matchAll(/;;\s*(\{[A-Za-z]*\d+\})/g)].map((mm) => ({ i: mm.index, m: mm[1] }));
  const markerBefore = (pos) => { let r = null; for (const k of markers) { if (k.i < pos) r = k.m; else break; } return r; };
  // caps. NOTE the `>` in the name class — DALOS caps like `DALOS|S>SET-OURO-PRICE` contain it; the old regex
  // stopped at `>` and silently missed those caps.
  // The executable cap body with the defcap wrapper, name, args, @metadata (@doc/@model/@managed/@event) and
  // strings stripped — so `(defcap X (a) @doc "…" true)` reduces to `true` (the @doc no longer hides the true).
  const capCore = (body) => body.replace(/^\(defcap\b/, "(").replace(/"(?:[^"\\]|\\.)*"/g, "").replace(/@\w+\s*(?:\[[^\]]*\])?/g, "").replace(/^\(\s*\S+\s*/, "").replace(/^\([^()]*\)\s*/, "").replace(/\)\s*$/, "").trim();
  const recs = [];
  for (const m of code.matchAll(/\(defcap\s+([A-Za-z0-9_|:>\-]+)/g)) {
    const nm = m[1].split(":")[0];
    if (PREFIX.some(([p]) => segMatch(nm, p))) continue;   // CAP_/UEV_ are function prefixes, not region-4 caps
    let i = m.index, depth = 0, body = "", started = false;
    for (; i < code.length; i++) { const c = code[i]; if (c === "(") { depth++; started = true; } else if (c === ")") depth--; if (started) body += c; if (started && depth === 0) break; }
    const core = capCore(body), composed = [...core.matchAll(/\(compose-capability\s+\(([A-Za-z0-9_|:>\-]+)/g)].map((x) => x[1].split(":")[0]);
    const onlyComposes = composed.length > 0 && core.replace(/\(compose-capability\s+\([^()]*\)\)/g, "").replace(/\btrue\b/g, "").trim() === "";
    recs.push({ nm, marker: markerBefore(m.index), trivial: core === "true", composed, onlyComposes });
  }
  // C1 BRONZE = a literal-`true` body; then FIXPOINT — a cap that only composes bronze caps is bronze too.
  // BRONZE WINS over the gold marker (a simple/true cap stays bronze even inside the governance / {C4} block).
  for (const rec of recs) if (rec.trivial) capBand[rec.nm] = "B";
  let changed = true;
  while (changed) { changed = false; for (const rec of recs) { if (capBand[rec.nm] === "B") continue; if (rec.onlyComposes && rec.composed.every((x) => capBand[x] === "B")) { capBand[rec.nm] = "B"; changed = true; } } }
  // GOLD (non-bronze caps): `{C4}` authority sub-block, OR a GOV-named cap in the GOVERNANCE region (`{Gx}`).
  for (const rec of recs) {
    if (capBand[rec.nm] === "B") continue;
    const gold = rec.marker === "{C4}" || (/^GOV(\b|\||$)/.test(rec.nm) && /^\{G/.test(rec.marker || ""));
    capBand[rec.nm] = gold ? "G" : "S";
  }
  // governance CONSTANTS: a defconst under the {G1} marker → grey + bold (grey stays, bold added).
  for (const m of code.matchAll(/\(defconst\s+([A-Za-z0-9_|:>\-]+)/g)) {
    if (markerBefore(m.index) === "{G1}") govConst[m[1].split(":")[0]] = true;
  }
}
function segMatch(name, p) {   // does a class segment of `name` start with prefix p ?
  if (name.startsWith(p)) return true;
  const bar = name.indexOf("|"); if (bar >= 0 && name.slice(bar + 1).startsWith(p)) return true;
  return false;
}

// ---- tokenizer ----
const toks = [];
for (let i = 0; i < code.length;) {
  const c = code[i];
  if (c === ";") { let j = i; while (j < code.length && code[j] !== "\n") j++; toks.push(["cmt", code.slice(i, j)]); i = j; continue; }
  if (c === '"') { let j = i + 1; while (j < code.length) { if (code[j] === "\\") { j += 2; continue; } if (code[j] === '"') { j++; break; } j++; } toks.push(["str", code.slice(i, j)]); i = j; continue; }
  if (/\s/.test(c)) { let j = i; while (j < code.length && /\s/.test(code[j])) j++; toks.push(["ws", code.slice(i, j)]); i = j; continue; }
  if ("()[]{}".includes(c)) { toks.push(["punct", c]); i++; continue; }
  let j = i; while (j < code.length && !/[\s()[\]{};"]/.test(code[j])) j++;
  toks.push(["atom", code.slice(i, j)]); i = j;
}

// ---- classify + emit ----
function prefixClass(name) {
  const cands = [name];
  if (name.includes("::")) cands.push(name.split("::").pop());
  if (name.includes(".")) cands.push(name.split(".").pop());
  for (const cand of cands) {
    const bar = cand.indexOf("|");
    const segs = bar >= 0 ? [cand, cand.slice(bar + 1)] : [cand];
    // A KNOWN PREFIX wins FIRST — including one AFTER a `|` scope, so `P|UR_IMP` / `DALOS|C_Create` follow
    // their real prefix's colour (UR_/C_), not the grey policy/scope.
    for (const s of segs) {
      if (s === "UEV_IMC") return "val";
      // full prefix (`UR_Name`) OR a BARE prefix — the class stem with no `_Name` after (`UR`, `P|A`, `UEV`).
      for (const [p, cls] of PREFIX) if (s.startsWith(p) || s === p.slice(0, -1)) return cls;
    }
    // Only when NO known prefix appears → structural scaffolding (GOV / bare P| / SECURE) → grey.
    for (const s of segs) if (/^GOV(\b|\||$)/.test(s) || /^P\|/.test(cand) || s === "SECURE") return "struct";
  }
  return null;
}
function emitAtom(a, prev) {
  // number / boolean literals → flat medallions
  if (/^-?\d[\d.]*$/.test(a)) return valMedD(a, a.includes(".") ? "#4d90e8" : "#3181e9");   // decimal / integer VALUE (rounded, no border)
  if (a === "true" || a === "false") return valMedD(a, "#be274a");                          // bool VALUE
  if (/^@/.test(a)) return `<span class=${/^@(event|managed)/.test(a) ? "tagO" : "tag"}>${esc(a)}</span>`;   // event/managed orange · doc/model pink
  if (FORMS.has(a)) return `<span class=form>${esc(a)}</span>`;                     // (module …) (interface …) (create-table …) — rounded yellow medallion
  if (BARE_TYPE.has(a)) return typeMedD(a);                                          // e.g. the `string` inside a list type [string]
  // split a trailing type annotation  name:type  (not the module-ref  ::)
  let name = a, type = null;
  for (let k = 1; k < a.length; k++) { if (a[k] === ":" && a[k - 1] !== ":" && a[k + 1] !== ":") { name = a.slice(0, k); type = a.slice(k + 1); break; } }
  const thtml = type != null ? ":" + (TYPE_COL[type] ? typeMedD(type) : `<span class=ty>${esc(type)}</span>`) : "";   // the `:` stays DEFAULT — only the TYPE NAME is medallioned
  // module-reference: `ref-X` holds a module VALUE → steel ROUNDED medallion (module colour). And a `qualifier::member`
  // splits: the qualifier keeps its own look, the `::` is left DEFAULT, and the member is classified on its OWN
  // (so `ref-DALOS::CAP_…` reads as steel-ref · default `::` · red CAP_, not one big red blob).
  if (name.includes("::")) {
    const dc = name.indexOf("::"), q = name.slice(0, dc), member = name.slice(dc + 2);
    const qhtml = /^ref-/.test(q) ? valMedD(q, "#8fa3bd") : esc(q);
    const mcls = prefixClass(member);
    let mhtml;
    if (mcls) mhtml = `<span class=${mcls}>${esc(member)}</span>`;
    else if (BUILTINS.has(member)) mhtml = `<span class=bi>${esc(member)}</span>`;
    else mhtml = foreignMed(member);   // a member from another module that doesn't follow StoicSyntax → black
    return qhtml + "::" + mhtml + thtml;
  }
  if (/^ref-/.test(name)) return valMedD(name, "#8fa3bd") + thtml;   // bare `ref-X` (e.g. a let-binding of type module)
  const nm0 = name.split(":")[0];
  if (govConst[nm0]) return `<span class=structb>${esc(name)}</span>` + thtml;   // governance constant ({G1}) → grey + BOLD
  // capability name (region 4) → metallic medallion
  if (capBand[nm0]) { const b = capBand[nm0]; return `<span class="capmed cap${b}o"><span class="capmedi cap${b}i">${esc(name)}</span></span>` + thtml; }
  if (DEFKW.has(name)) return `<span class=bib>${esc(name)}</span>` + thtml;
  const cls = prefixClass(name);
  if (cls) return `<span class=${cls}>${esc(name)}</span>` + thtml;
  if (BUILTINS.has(name)) return `<span class=bi>${esc(name)}</span>` + thtml;
  if (type != null && TYPES.has(type.replace(/[[\]{}]/g, "").split(/[|.]/)[0])) return esc(name) + thtml;
  return esc(name) + thtml;
}
// A (possibly multi-line) string: colour ONLY the text on each line, leaving each continuation line's LEADING
// indentation (tabs/spaces) UNcoloured — so the block never paints the empty indent gutter. Line fill still
// connects vertically (clone + padding), rounded corners.
function emitString(raw) {
  if (!raw.includes("\n")) return valMedD(raw, "#ec8013");   // single-line string → orange VALUE pill (uniform pill height)
  // multi-line string → the filled block (per-line, leading indentation left uncoloured, gaps clone-filled)
  return raw.split("\n").map((ln) => {
    const m = ln.match(/^([ \t]*)([\s\S]*)$/);
    const lead = m[1], rest = m[2];
    return esc(lead) + (rest ? `<span class=strBlk>${esc(rest)}</span>` : "");
  }).join("\n");
}
// Bracket-pair colourisation (all three: () [] {}). One shared depth counter cycles red→yellow→blue, and a
// matching close takes the SAME colour as its open — so a missed/extra bracket jumps out as a colour that
// doesn't pair up. Strings/comments are their own tokens, so brackets inside them are never counted.
const BK = ["bk0", "bk1", "bk2"];
let html = "", prev = "", depth = 0;
for (let ti = 0; ti < toks.length; ti++) {
  const [t, v] = toks[ti];
  if (t === "ws") html += esc(v);
  else if (t === "cmt") html += `<span class=cmt>${esc(v)}</span>`;
  else if (t === "str") html += emitString(v);
  else if (t === "punct") {
    // {Schema} / {Module|Schema} object-reference → ONE yellow rounded value medallion (NOT bracket-coloured).
    // Only when it's `{ <single atom> }` — an object LITERAL `{ 'k: v … }` has more tokens and falls through.
    if (v === "{") {
      let j = ti + 1; while (j < toks.length && toks[j][0] === "ws") j++;
      let k = (j < toks.length && toks[j][0] === "atom") ? j + 1 : -1;
      while (k > 0 && k < toks.length && toks[k][0] === "ws") k++;
      if (k > 0 && k < toks.length && toks[k][0] === "punct" && toks[k][1] === "}") {
        html += valMedD("{" + toks[j][1] + "}", "#f3c81b");    // object/schema → yellow, rounded, no border
        ti = k; continue;
      }
    }
    let d;
    if ("([{".includes(v)) { d = depth % 3; depth++; }        // open: colour by current depth, then descend
    else { depth = Math.max(0, depth - 1); d = depth % 3; }    // close: ascend first, so it matches its open
    html += `<span class=${BK[d]}>${esc(v)}</span>`;
  }
  else { html += emitAtom(v, prev); prev = v; }
}

const capCount = Object.keys(capBand).length;
const nums = (code.match(/(?<![\w.])-?\d[\d.]*/g) || []).length;
const strs = (code.match(/"(?:[^"\\]|\\.)*"/g) || []).length;
const PAGE_CSS = `body{margin:0;background:#0b1020;color:#c8d0e6;font:12.5px/2.05 ui-monospace,Consolas,monospace}
.wrap{padding:18px 22px}h1{font:600 15px/1.4 -apple-system,Segoe UI,sans-serif;margin:0 0 2px}
.sub{font:12px/1.5 -apple-system,Segoe UI,sans-serif;color:#9aa6c7;margin:0 0 14px}`;
// Token CSS only (no page chrome) so the palette page can embed this as a tab, scoped under a selector.
const TOKEN_CSS = `
pre{background:#0d1226;border:1px solid #1b2440;border-radius:8px;padding:16px 18px;overflow:auto;margin:0;white-space:pre-wrap;word-break:break-word;font:12.5px/2.05 ui-monospace,Consolas,monospace}
.pn{color:#8892ad}.cmt{color:#647085;font-style:italic}.bi{color:#66cfc1}.bib{color:#66cfc1;font-weight:700}.ty{color:#c2c8d2}.struct{color:#737b8c}.structb{color:#737b8c;font-weight:700}
/* bracket-pair colours by nesting depth (red → yellow → blue), lightly distinct from validate/construct/compute */
.bk0{color:#e5616e}.bk1{color:#e0b64a}.bk2{color:#5aa8f0}
/* the "main 3" structural forms — rounded YELLOW medallion (module · interface · create-table) */
.form{display:inline-block;margin:0 3px;padding:0 8px;line-height:1.05;font-weight:700;border-radius:8px;background:#332a0e;border:2px solid #f3c81b;color:#f6d24a}
.ctor{color:#f3c81b;font-weight:700}.ctorx{color:#e4c136;font-style:italic}
.compute{color:#3181e9;font-weight:700}.ck{color:#4d90e8}.cx{color:#9dbeea;font-style:italic}
.rl{color:#e8b683}.rx{color:#e8b683;font-style:italic}.heavy{color:#ec8013;font-weight:700}.cost{color:#a36633}
.val{color:#be274a;font-weight:700}.cap{color:#be274a}
.ww{color:#e61990;font-weight:700}.wu{color:#e46db2}.wi{color:#e89fca}
.xi{color:#a045d5;font-weight:700}.xe{color:#ab5fd7}.xb{color:#b577da}
.adm{color:#1d9a4d;font-weight:700}.cli{color:#9adfb1}.const{color:#9298a4}
/* literals as medallions (bloat test) */
/* all medallions: DARK bg · LIGHT hue text · strong hue border (same recipe as the string block) */
.num{display:inline-block;padding:0 4px;line-height:1.05;font-weight:700;background:#14243f;border:2px solid #3181e9;color:#7db0f2}
.bool{display:inline-block;padding:0 5px;line-height:1.05;font-weight:700;background:#2c1220;border:2px solid #be274a;color:#e58ba0}
.strBlk{background:#33291a;color:#e8b06a;-webkit-box-decoration-break:clone;box-decoration-break:clone;padding:0.42em 6px;border-radius:6px}
.tag{display:inline-block;margin:0 3px;padding:0 7px;line-height:1.05;font-weight:700;border-radius:8px;background:#33132a;border:2px solid #e61990;color:#f28cc4}
.tagO{display:inline-block;margin:0 3px;padding:0 7px;line-height:1.05;font-weight:700;border-radius:8px;background:#33220e;border:2px solid #ec8013;color:#f0b06a}
/* capabilities: angled metallic medallions — TWO layers so the border wraps the diagonals (outer=border, inner=dark fill) */
.capmed{display:inline-block;margin:0 3px;padding:2px;line-height:1;clip-path:polygon(7px 0,calc(100% - 7px) 0,100% 50%,calc(100% - 7px) 100%,7px 100%,0 50%)}
.capmedi{display:inline-block;padding:0 9px;line-height:1.05;font-weight:700;clip-path:polygon(7px 0,calc(100% - 7px) 0,100% 50%,calc(100% - 7px) 100%,7px 100%,0 50%)}
.capBo{background:#c9925e}.capBi{background:#241a10;color:#e6b985}
.capSo{background:#b7c0cf}.capSi{background:#181c24;color:#d8dee8}
.capGo{background:#dcb64d}.capGi{background:#23200e;color:#ecca63}
/* FOREIGN / uncategorisable (from another module, state unknown) → neutral BLACK. Cap = angled (capK*), plain
   function = rounded (fnK). "Black" = a charcoal medallion with LIGHT text, so it's clearly visible. */
.capKo{background:#565b66}.capKi{background:#191b22;color:#cbd0da}
.fnK{display:inline-block;margin:0 3px;padding:0 6px;line-height:1.05;font-weight:700;border:2px solid #565b66;border-radius:6px;background:#191b22;color:#cbd0da}`;

// Prefix every selector in a CSS block with `sel ` so the embedded DALOS tab can't collide with palette classes.
export function scopeCss(css, sel) {
  return css.replace(/(^|\})\s*([^{}@]+)\{/g, (m, br, sels) => br + "\n" + sels.split(",").map((s) => sel + " " + s.trim()).join(",") + "{");
}
export const dalosStats = { capCount, strs, nums };
// The DALOS tab's content: a <pre> of the coloured module + its token CSS scoped under `scope`.
export function renderDalos(scope = "#dalos") {
  return { pre: `<div id="${scope.replace(/^#/, "")}"><pre>${html}</pre></div>`, css: scopeCss(TOKEN_CSS, scope), stats: dalosStats };
}

// Standalone page when run directly (node pact-dalos-preview.gen.mjs).
if (import.meta.url === `file://${process.argv[1]}`) {
  const out = `<!doctype html><meta charset=utf8><title>DALOS — coloured</title><style>${PAGE_CSS}${TOKEN_CSS}</style>
<div class=wrap><h1>DALOS — StoicSyntax colouring engine (real module, colour-in-place)</h1>
<p class=sub>1593 lines · ${capCount} capabilities (metallic medallions) · ~${strs} strings (blocks) · ~${nums} number literals (flat medallions) · booleans (red flat). Bloat test: the BUSY version — every literal medallioned. Reorder pass is separate.</p>
<pre>${html}</pre></div>`;
  writeFileSync("/home/ancientbox/ClaudeWS/Claudstermind/dashboard/public/pact-dalos-preview.html", out);
  console.log("DALOS standalone written:", capCount, "caps,", strs, "strings,", nums, "numbers");
}
