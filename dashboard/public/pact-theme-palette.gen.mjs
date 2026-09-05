import { writeFileSync } from "node:fs";
import { renderDalos } from "./pact-dalos-preview.gen.mjs";   // embeds the real DALOS module as a second tab
function hsl(h,s,l){s/=100;l/=100;const k=n=>(n+h/30)%12;const a=s*Math.min(l,1-l);const f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));const to=x=>Math.round(255*x).toString(16).padStart(2,"0");return "#"+to(f(0))+to(f(8))+to(f(4));}
function lin(c){c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
function L(hx){const m=hx.replace("#","").match(/../g).map(h=>parseInt(h,16));return 0.2126*lin(m[0])+0.7152*lin(m[1])+0.0722*lin(m[2]);}
const BG="#0b1020",cr=a=>((Math.max(L(a),L(BG))+0.05)/(Math.min(L(a),L(BG))+0.05)).toFixed(1);
const UDC=hsl(48,90,53), BROWN=hsl(27,52,42), CHERRY="#be274a", A=hsl(143,68,36), C=hsl(140,52,74);
console.log("UDC_",UDC,"| brown",BROWN,"| A_",A,cr(A),"| C_",C,cr(C));
// EVERY prefix, in the CANONICAL ORDER (the 7 classes in build order; within each, strongest→lightest:
// bold lead ▸ normal shades ▸ aux italic ▸ cost accent). Globally numbered 1..37 = the canon sweep order.
const O="#ec8013", OL="#e8b683", BL="#3181e9", BLK="#4d90e8", BLX="#9dbeea", V="#a045d5";
const CATS=[
 ["1 · CONSTRUCT — yellow",UDC,[["UDC_",UDC,false,true],["UDCx_","#e4c136",true]]],
 ["2 · COMPUTE — blue",BL,[["UC_",BL,false,true],["UCk_",BLK],["UCv_",BLK],["UCx_",BLX,true],["UCkx_",BLX,true]]],
 ["3 · READ — orange · heavy▸light▸cost",O,[["URH_",O,false,true],["URHC_",O,false,true],["URHx_",O,true,true],["URHCx_",O,true,true],["UR_",OL],["URC_",OL],["URU_",OL],["URCv_",OL],["URCx_",OL,true],["URCi_",BROWN]]],
 ["4 · VALIDATE — cherry red",CHERRY,[["UEV_",CHERRY,false,true],["CAP_",CHERRY]]],
 ["5 · WRITE — magenta/pink",  "#e61990",[["WW_","#e61990",false,true],["WU_","#e46db2"],["WU2_","#e46db2"],["WU3_","#e46db2"],["WU4_","#e46db2"],["WI_","#e89fca"]]],
 ["6 · AUX / PROTECTED — violet",V,[["XI_",V,false,true],["XE_","#ab5fd7"],["XB_","#b577da"]]],
 ["7 · USER — green · admin bold▸client light",A,[["AU_",A,false,true],["A_",A,false,true],["AA_",A,false,true],["Ap_",A,false,true],["AAp_",A,false,true],["C_",C],["CC_",C],["Cp_",C],["CCp_",C]]],
];
const SUP=[
 ["PACT-BUILTIN — teal","#66cfc1",[["def* — defun defcap defschema defconst defpact deftable definterface defmodule","#66cfc1",false,true],["builtins — read insert update write select keys fold map at where enforce enforce-guard concat","#66cfc1"]]],
 ["CONSTANT — grey","#9298a4",[["CT_","#9298a4"]]],
 ["STRUCTURAL — dim (UEV_IMC now colours as UEV_/red)","#737b8c",[["GOV","#737b8c"],["GOV|","#737b8c"],["P|","#737b8c"],["SECURE","#737b8c"]]],
 ["NON-PREFIX SYNTAX","#c2c8d2",[["{ object literal }",UDC],["type: decimal integer string time guard keyset bool","#c2c8d2"],[`"string literal"  'symbol`,"#ce9178"],["@doc @event @managed @model (tags)","#4aa3b8"],["; comment",  "#647085",true]]],
 ["MIGRATION ALIASES — colour SAME until rename lands","#8a93ad",[["URD_→URH_","#8a93ad"],["URDC_→URHC_","#8a93ad"],["URDX_→URHx_","#8a93ad"],["URDCX_→URHCx_","#8a93ad"],["UCK_→UCk_","#8a93ad"],["UCX_→UCx_","#8a93ad"],["URCX_→URCx_","#8a93ad"],["UDCX_→UDCx_","#8a93ad"]]],
];
// Real metallic = a gradient clipped to the glyphs (brushed-metal sheen), NOT a flat hex. Works on any span.
const METAL={bronze:"linear-gradient(175deg,#e7be8f,#c9925e 45%,#9c6636)",silver:"linear-gradient(175deg,#eef2f8,#cbd3df 45%,#9aa6ba)",gold:"linear-gradient(175deg,#f6dd82,#dcb64d 45%,#b78e28)"};
const metal=(txt,m)=>`<span style="background:${METAL[m]};-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:700">${txt}</span>`;
const CAPS=[["C1 · true / simple","bronze"],["C2 · custom, non-composing","silver"],["C3 · custom, composing","silver"],["C4 · ownership / governance","gold"]];
const capsBlk=`<div class=cat><div class=ct style="color:#cbd3df">CAPABILITIES · region 4 — metallic TEXT (order C1→C4)</div><div class=pxs>${CAPS.map(([t,m])=>metal(t.replace(/</g,'&lt;'),m)).join("&nbsp;&nbsp;&nbsp;")}</div></div>`;
// MEDALLION = a token in its OWN pill, a new axis beyond hue. Refinements: ALWAYS bold · thicker (1.7px) border
// · smaller radius · SHORTER than the code line (line-height 1.25 in a taller row → vertical breathing room so
// stacked medallions aren't flush). THREE end shapes, all pure CSS (border-radius / clip-path) — NO literal
// <>/|| characters, so ZERO extra monospace glyph cells; only the same few px of padding any pill costs.
function mix(a,b,t){const pa=a.replace('#','').match(/../g).map(h=>parseInt(h,16)),pb=b.replace('#','').match(/../g).map(h=>parseInt(h,16)),to=x=>Math.round(x).toString(16).padStart(2,'0');return '#'+pa.map((v,i)=>to(v+(pb[i]-v)*t)).join('');}
const HEX = "polygon(7px 0,calc(100% - 7px) 0,100% 50%,calc(100% - 7px) 100%,7px 100%,0 50%)";
const pad = (s) => (s === "angle" ? 11 : 7);
// One medallion recipe for all shapes: DARK bg · LIGHT text · strong-hue BORDER. Round gets a bigger radius now.
// ANGLED is TWO layers (outer = border colour clipped, inner = dark fill clipped) so the border wraps the
// diagonals too — a single clipped box loses its border on the angled ends, which is what looked "broken".
function medBox(txt, bg, tx, bd, s) {
  if (s === "angle") return `<span style="display:inline-block;margin:0 3px;padding:2px;clip-path:${HEX};background:${bd};line-height:1"><span style="display:inline-block;padding:0 9px;line-height:1.05;font-weight:700;clip-path:${HEX};background:${bg};color:${tx}">${txt}</span></span>`;
  const rad = s === "flat" ? "0" : "8px";
  return `<span style="display:inline-block;margin:0 3px;padding:0 ${pad(s)}px;line-height:1.05;font-weight:700;border-radius:${rad};border:2px solid ${bd};background:${bg};color:${tx}">${txt}</span>`;
}
const med = (txt, b, s = "round") => medBox(txt.replace(/</g, "&lt;"), mix(b, "#0b1020", 0.80), mix(b, "#ffffff", 0.35), b, s);
// metallic caps, same dark recipe: [dark BG, light metallic TEXT, bright metallic BORDER]
const MG = { bronze: ["#241a10","#e6b985","#c9925e"], silver: ["#181c24","#d8dee8","#b7c0cf"], gold: ["#23200e","#ecca63","#dcb64d"] };
const metalMed = (txt, m, s = "angle") => { const [bg, tx, bd] = MG[m]; return medBox(txt, bg, tx, bd, s); };
// @event / @managed → orange · @doc / @model → pink (left as is)
const tagMed = (txt) => med(txt, /@(event|managed)/.test(txt) ? "#ec8013" : "#e61990", "round");
// VALUE medallion: rounded, NO border, dark bg + light text — the string-block build, coloured by its type.
const valMed = (txt, b) => `<span style="display:inline-block;margin:0 3px;padding:0 7px;line-height:1.05;font-weight:700;border:2px solid transparent;border-radius:8px;background:${mix(b,'#0b1020',0.80)};color:${mix(b,'#ffffff',0.35)}">${txt.replace(/</g,'&lt;')}</span>`;
// All Pact types → colour + a sample value. Type NAME = flat+border (med '…flat'); VALUE = rounded no-border (valMed).
const TYPES_PAL=[["integer","#3181e9","42"],["decimal","#4d90e8","0.05"],["string","#ec8013",'"txt"'],["bool","#be274a","true"],["time","#1d9a4d","(time)"],["guard","#a045d5","g"],["keyset","#b577da","ks"],["object","#f3c81b","{obj}"],["list","#3fbfae","[1 2]"],["table","#a36633","tbl"],["module","#8fa3bd","ref"],["value","#9298a4","any"]];
const MEDS=[["Construct UDC_",UDC],["Compute UC_","#3181e9"],["Read URH_","#ec8013"],["Validate UEV_",CHERRY],["Write WW_","#e61990"],["Aux/Prot XI_","#a045d5"],["User A_",A],["Cyan (free)","#17b6cf"],["Teal","#3fbfae"]];
const medGallery=`<div class=cat><div class=ct style="color:#cbd3df">MEDALLION (rounded) — each family as a pill; pops off the editor bg (a new axis beyond hue)</div><div class=pxs style="line-height:2.8">${MEDS.map(([l,b])=>med(l,b,'round')).join(' &nbsp; ')}</div></div>`;
const shapeGallery=`<div class=cat><div class=ct style="color:#cbd3df">END SHAPES — pure CSS, no extra glyph cells (pick per token type)</div><div class=pxs style="line-height:3">${med('rounded → tags','#e61990','round')} &nbsp;&nbsp; ${med('angled → capabilities','#a045d5','angle')} &nbsp;&nbsp; ${med('flat → variables?','#3fbfae','flat')}</div></div>`;
const capMedGallery=`<div class=cat><div class=ct style="color:#cbd3df">CAPABILITY metallic + ANGLED medallions, bold — C1 bronze · C2/C3 silver · C4 gold</div><div class=pxs style="line-height:3">${metalMed('C1 · GOV','bronze')} &nbsp;&nbsp; ${metalMed('C2 · TRANSFER','silver')} &nbsp;&nbsp; ${metalMed('C3 · COMPOSE','silver')} &nbsp;&nbsp; ${metalMed('C4 · OWNER','gold')}</div></div>`;
const tagMedGallery=`<div class=cat><div class=ct style="color:#cbd3df">@TAG rounded medallions — pink (doc/model) · orange (event/managed)</div><div class=pxs style="line-height:3">${tagMed('@doc')} &nbsp;&nbsp; ${tagMed('@event')} &nbsp;&nbsp; ${tagMed('@managed')} &nbsp;&nbsp; ${tagMed('@model')}</div></div>`;
const typeNameGallery=`<div class=cat><div class=ct style="color:#cbd3df">TYPE NAMES — straight corners + border (the ':type' designation), one colour per type</div><div class=pxs style="line-height:3">${TYPES_PAL.map(([n,c])=>med(n,c,'flat')).join(' &nbsp; ')}</div></div>`;
const valueGallery=`<div class=cat><div class=ct style="color:#cbd3df">VALUES — rounded, NO border (same build as the string block), coloured by their type</div><div class=pxs style="line-height:3">${TYPES_PAL.map(([n,c,ex])=>valMed(ex,c)).join(' &nbsp; ')}</div></div>`;
const formBracketGallery=`<div class=cat><div class=ct style="color:#cbd3df">STRUCTURAL FORMS (rounded yellow medallion) + BRACKET-pair depth colours</div><div class=pxs style="line-height:3">${med('module','#f3c81b','round')} ${med('interface','#f3c81b','round')} ${med('create-table','#f3c81b','round')} &nbsp;&nbsp;&nbsp; brackets by depth: <span style="color:#e5616e;font-weight:700">( [ {</span> <span style="color:#e0b64a;font-weight:700">( [ {</span> <span style="color:#5aa8f0;font-weight:700">( [ {</span> <span class=ord>red·yellow·blue, cycling — matched pairs share a colour</span></div></div>`;
let ORD=0;
const blk=(t,th,ms,num)=>`<div class=cat><div class=ct style="color:${th}">${t}</div><div class=pxs>${ms.map(([p,h,it,bd])=>{const n=num?`<span class=ord>${++ORD}.</span>`:"";return `<span style="color:${h}${it?';font-style:italic':''}${bd?';font-weight:700':''}">${n}${p.replace(/</g,'&lt;')}</span>`;}).join("&nbsp;&nbsp;&nbsp;")}</div></div>`;
// styles for the code sample
const CSS=`.bi{color:#66cfc1}.bib{color:#66cfc1;font-weight:700}.ty{color:#c2c8d2}.n{color:#b5cea8}.cmt{color:#647085;font-style:italic}.struct{color:#737b8c}
.ctor{color:${UDC};font-weight:700}.ctorl{color:${UDC}}.ctorx{color:#e4c136;font-style:italic}
.compute{color:#3181e9;font-weight:700}.ck{color:#4d90e8}.cx{color:#9dbeea;font-style:italic}
.rl{color:#e8b683}.rx{color:#e8b683;font-style:italic}.heavy{color:#ec8013;font-weight:700}.cost{color:${BROWN}}
.val{color:${CHERRY};font-weight:700}.cap{color:${CHERRY}}
.ww{color:#e61990;font-weight:700}.wu{color:#e46db2}.wi{color:#e89fca}
.xi{color:#a045d5;font-weight:700}.xe{color:#ab5fd7}
.adm{color:${A};font-weight:700}.cli{color:${C}}
.str{color:#ce9178}.tag{color:#4aa3b8}
.strBlk{background:#33291a;color:#e8b06a;-webkit-box-decoration-break:clone;box-decoration-break:clone;padding:0.42em 6px;border-radius:6px}
.mB{background:${METAL.bronze};-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:700}.mS{background:${METAL.silver};-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:700}.mG{background:${METAL.gold};-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:700}`;
const CODE=`<span class=struct>;; ---- SWP module — canonical order, final palette ----</span>
<span class=cmt>; comment block — recedes into the bg, still legible when read.</span>

<span class=cmt>; region 4 — capabilities (metallic: bronze true ▸ silver custom ▸ gold ownership)</span>
(<span class=bib>defcap</span> ${metalMed('GOV','bronze')} () <span class=bi>true</span>)
(<span class=bib>defcap</span> ${metalMed('TRANSFER','silver')} (from to amt:<span class=ty>decimal</span>) (<span class=bi>enforce</span> (&gt; amt <span class=n>0.0</span>) <span class=str>"amount must be positive"</span>))
(<span class=bib>defcap</span> ${metalMed('OWNER','gold')} (acct) ${tagMed('@managed')} (<span class=bi>enforce-guard</span> (<span class=bi>at</span> 'g (<span class=bi>read</span> accts acct))))

<span class=cmt>; region 5 — functions ▸ 1 CONSTRUCT</span>
(<span class=bib>defun</span> <span class=ctor>UDC_Score</span> (v:<span class=ty>decimal</span> g:<span class=ty>guard</span> t:<span class=ty>time</span>)\n  <span class=ctorl>{ 'value:</span> v<span class=ctorl>, 'guard:</span> g<span class=ctorl>, 'at:</span> t <span class=ctorl>}</span>)
(<span class=bib>defun</span> <span class=ctorx>UDCx_Row</span> (r) { 'k: r })
<span class=cmt>; 2 COMPUTE</span>
(<span class=bib>defun</span> <span class=compute>UC_BalanceOf</span> (xs:<span class=ty>[decimal]</span>) (<span class=bi>fold</span> (+) <span class=n>0.0</span> xs))
(<span class=bib>defun</span> <span class=ck>UCk_Key</span> (o k) (<span class=bi>concat</span> [o <span class=struct>BAR</span> k]))
(<span class=bib>defun</span> <span class=cx>UCx_Clamp</span> (n) (<span class=bi>if</span> (&lt; n <span class=n>0.0</span>) <span class=n>0.0</span> n))
<span class=cmt>; 3 READ</span>
(<span class=bib>defun</span> <span class=rl>UR_Score</span> (key) @<span class=tag>doc</span> <span class=strBlk>"A docstring that runs across
several lines yet stays ONE
continuous encapsulated block"</span> (<span class=bi>read</span> scores key))
(<span class=bib>defun</span> <span class=cost>URCi_Cost</span> (op) (IGNIS.<span class=ctor>UDC_Cumulator</span> op))
(<span class=bib>defun</span> <span class=heavy>URHC_ScanDirty</span> (cut) (<span class=bi>select</span> scores (<span class=bi>where</span> 'ts (&gt; cut))))
(<span class=bib>defun</span> <span class=heavy>URHCx_Keys</span> (p) (<span class=bi>keys</span> scores))
<span class=cmt>; 4 VALIDATE</span>
(<span class=bib>defun</span> <span class=val>UEV_OwnerOnly</span> (o) (<span class=bi>enforce-guard</span> (<span class=bi>at</span> 'guard (<span class=bi>read</span> accts o))))
(<span class=bib>defcap</span> <span class=cap>CAP_Owner</span> (o) (<span class=bi>enforce-guard</span> ...))
<span class=cmt>; 5 WRITE</span>
(<span class=bib>defun</span> <span class=ww>WW_Score</span> (key v) (<span class=bi>write</span> scores key v))
(<span class=bib>defun</span> <span class=wu>WU2_Score</span> (key a b) (<span class=bi>update</span> scores key { 'a: a }))
(<span class=bib>defun</span> <span class=wi>WI_Score</span> (key v) (<span class=bi>insert</span> scores key v))
<span class=cmt>; 6 AUX / PROTECTED</span>
(<span class=bib>defun</span> <span class=xi>XI_Settle</span> (b) (<span class=bi>map</span> (<span class=wu>WU2_Score</span>) b))
(<span class=bib>defun</span> <span class=xe>XE_Deposit</span> (s amt) ...)
<span class=cmt>; 7 USER</span>
(<span class=bib>defun</span> <span class=adm>SWP|A_Migrate</span> (rows) ...)     <span class=cmt>; admin — dark green, bold</span>
(<span class=bib>defun</span> <span class=cli>SWP|C_Deposit</span> (s amt) ${tagMed('@doc')} <span class=str>"Deposit amt into s"</span> ...)  <span class=cmt>; client — light green</span>`;
const dalos = renderDalos("#dalos");
const html=`<!doctype html><meta charset=utf8><link rel="stylesheet" href="/vendor/codemirror/lib/codemirror.css"><style>:root{--bg:#0b1020}body{margin:0;background:var(--bg);color:#e7ecff;font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;padding:0}h1{font-size:16px;margin:0 0 2px}.sub{color:#9aa6c7;font-size:12px;margin:0 0 16px}.cat{margin:9px 0;padding:8px 12px;border:1px solid #1b2440;border-radius:8px;background:#0d1226}.ct{font-weight:700;font-size:12.5px;margin-bottom:5px}.pxs{font:13.5px ui-monospace,Consolas,monospace;line-height:2.1}.ord{color:#5b678a;font-weight:400;font-size:10.5px;margin-right:1px}h2{font-size:13px;color:#9aa6c7;margin:18px 0 6px}pre{background:#0d1226;border:1px solid #1b2440;border-radius:8px;padding:16px 18px;font:12.5px/2.05 ui-monospace,Consolas,monospace;overflow:auto;margin:0}
.tabwrap{padding:0 24px 16px}
/* sticky tab bar — stays pinned to the top while you scroll the page */
.tabbar{position:sticky;top:0;z-index:20;display:flex;gap:6px;margin:0 -24px 14px;padding:10px 24px 0;border-bottom:1px solid #1b2440;background:#0b1020}
.tabbtn{padding:7px 16px;font:600 13px/1 -apple-system,Segoe UI,sans-serif;color:#9aa6c7;cursor:pointer;text-decoration:none;border:1px solid transparent;border-bottom:none;border-radius:7px 7px 0 0;user-select:none}
.tabbtn.active{color:#e7ecff;background:#0d1226;border-color:#1b2440}
.pane{display:none}.pane.active{display:block}
${CSS}
${dalos.css}
/* ===== Editable (live typing) tab: CodeMirror + caret-safe medallion pills ===== */
.edtoolbar{display:flex;align-items:center;gap:10px;margin:0 0 10px}.edseg{display:inline-flex;border:1px solid #1b2440;border-radius:8px;overflow:hidden}.edseg button{background:#0d1226;color:#e7ecff;border:0;padding:6px 13px;font-weight:700;font-size:12px;cursor:pointer}.edseg button.on{background:#2b6cff;color:#fff}.edseg button+button{border-left:1px solid #1b2440}.edcaret{color:#9aa6c7;font:12px ui-monospace,monospace}
.CodeMirror{height:560px;background:transparent;color:#d2d3d4;font:13px/1.7 ui-monospace,Consolas,monospace;border:1px solid #1b2440;border-radius:8px}.CodeMirror-gutters{background:#0d1226;border-right:1px solid #1b2440}.CodeMirror-linenumber{color:#5a6675}.CodeMirror-cursor{border-left:1px solid #e6edf3}.CodeMirror-selected{background:rgba(120,160,255,.22)}
/* base text colours (both Flat + Medallion modes) — the DALOS palette, ported class-for-class */
.cm-md-cmt{color:#647085;font-style:italic}.cm-md-section{color:#8a93a8;font-weight:600}.cm-md-op{color:#8892ad}.cm-md-bi{color:#66cfc1}.cm-md-bib{color:#66cfc1;font-weight:700}.cm-md-ty{color:#c2c8d2}.cm-md-struct{color:#737b8c}.cm-md-structb{color:#737b8c;font-weight:700}
.cm-md-bk0{color:#e5616e}.cm-md-bk1{color:#e0b64a}.cm-md-bk2{color:#5aa8f0}
.cm-md-ctor{color:#f3c81b;font-weight:700}.cm-md-ctorx{color:#e4c136;font-style:italic}.cm-md-compute{color:#3181e9;font-weight:700}.cm-md-ck{color:#4d90e8}.cm-md-cx{color:#9dbeea;font-style:italic}.cm-md-rl{color:#e8b683}.cm-md-rx{color:#e8b683;font-style:italic}.cm-md-heavy{color:#ec8013;font-weight:700}.cm-md-cost{color:#a36633}.cm-md-val{color:#be274a;font-weight:700}.cm-md-cap{color:#be274a}.cm-md-ww{color:#e61990;font-weight:700}.cm-md-wu{color:#e46db2}.cm-md-wi{color:#e89fca}.cm-md-xi{color:#a045d5;font-weight:700}.cm-md-xe{color:#ab5fd7}.cm-md-xb{color:#b577da}.cm-md-adm{color:#1d9a4d;font-weight:700}.cm-md-cli{color:#9adfb1}.cm-md-const{color:#9298a4}
.cm-md-num-int{color:#7db0f2}.cm-md-num-dec{color:#8ab6f0}.cm-md-bool{color:#e58ba0}.cm-md-strv{color:#e8b06a}.cm-md-strblk{color:#e8b06a}.cm-md-ref{color:#aeb9c9}.cm-md-schema{color:#f6d24a}.cm-md-form{color:#f6d24a;font-weight:700}.cm-md-tag{color:#f28cc4;font-weight:700}.cm-md-tagO{color:#f0b06a;font-weight:700}.cm-md-capB{color:#e6b985;font-weight:700}.cm-md-capS{color:#d8dee8;font-weight:700}.cm-md-capG{color:#ecca63;font-weight:700}.cm-md-capK{color:#cbd0da;font-weight:700}.cm-md-fnK{color:#cbd0da;font-weight:700}
.cm-md-ty-integer{color:#3181e9}.cm-md-ty-decimal{color:#4d90e8}.cm-md-ty-string{color:#ec8013}.cm-md-ty-bool{color:#be274a}.cm-md-ty-time{color:#1d9a4d}.cm-md-ty-guard{color:#a045d5}.cm-md-ty-keyset{color:#b577da}.cm-md-ty-object{color:#f3c81b}.cm-md-ty-list{color:#3fbfae}.cm-md-ty-table{color:#a36633}.cm-md-ty-module{color:#8fa3bd}.cm-md-ty-value{color:#9298a4}
/* MEDALLION mode (.mdl) — caret-safe pills: background + inset box-shadow (border) + radius, NO padding/border/inline-block */
.CodeMirror.mdl .cm-md-num-int{background:color-mix(in srgb,#3181e9 20%,#0b1020);color:color-mix(in srgb,#3181e9 62%,#fff);border-radius:6px;font-weight:700}
.CodeMirror.mdl .cm-md-num-dec{background:color-mix(in srgb,#4d90e8 20%,#0b1020);color:color-mix(in srgb,#4d90e8 62%,#fff);border-radius:6px;font-weight:700}
.CodeMirror.mdl .cm-md-bool{background:color-mix(in srgb,#be274a 26%,#0b1020);color:color-mix(in srgb,#be274a 58%,#fff);border-radius:6px;font-weight:700}
.CodeMirror.mdl .cm-md-strv{background:#33291a;color:#e8b06a;border-radius:6px}
.CodeMirror.mdl .cm-md-strblk{background:#33291a;color:#e8b06a}
.CodeMirror.mdl .cm-md-ref{background:color-mix(in srgb,#8fa3bd 22%,#0b1020);color:color-mix(in srgb,#8fa3bd 60%,#fff);border-radius:6px;font-weight:700}
.CodeMirror.mdl .cm-md-schema{background:color-mix(in srgb,#f3c81b 18%,#0b1020);color:#f6d24a;border-radius:6px;font-weight:700}
.CodeMirror.mdl .cm-md-form{background:#332a0e;box-shadow:inset 0 0 0 2px #f3c81b;color:#f6d24a;border-radius:6px;font-weight:700}
.CodeMirror.mdl .cm-md-tag{background:#33132a;box-shadow:inset 0 0 0 2px #e61990;color:#f28cc4;border-radius:7px;font-weight:700}
.CodeMirror.mdl .cm-md-tagO{background:#33220e;box-shadow:inset 0 0 0 2px #ec8013;color:#f0b06a;border-radius:7px;font-weight:700}
/* ANGLED metallic caps — caret-safe. The hexagon is drawn on two absolutely-positioned pseudo layers
   BEHIND the text (::before = outer metal border, ::after = dark inner fill). The token span only gets
   position:relative + z-index:0 (a local stacking context) — NO padding/border/inline-block — so the
   character advance width is unchanged and the caret stays glued. */
.CodeMirror.mdl .cm-md-capB,.CodeMirror.mdl .cm-md-capS,.CodeMirror.mdl .cm-md-capG,.CodeMirror.mdl .cm-md-capK{position:relative;z-index:0;font-weight:800;background:transparent;box-shadow:none;border-radius:0}
.CodeMirror.mdl .cm-md-capB::before,.CodeMirror.mdl .cm-md-capS::before,.CodeMirror.mdl .cm-md-capG::before,.CodeMirror.mdl .cm-md-capK::before{content:"";position:absolute;inset:0;z-index:-2;clip-path:polygon(5px 0,calc(100% - 5px) 0,100% 50%,calc(100% - 5px) 100%,5px 100%,0 50%)}
.CodeMirror.mdl .cm-md-capB::after,.CodeMirror.mdl .cm-md-capS::after,.CodeMirror.mdl .cm-md-capG::after,.CodeMirror.mdl .cm-md-capK::after{content:"";position:absolute;inset:1.5px;z-index:-1;clip-path:polygon(4px 0,calc(100% - 4px) 0,100% 50%,calc(100% - 4px) 100%,4px 100%,0 50%)}
.CodeMirror.mdl .cm-md-capB{color:#e6b985}.CodeMirror.mdl .cm-md-capB::before{background:#c9925e}.CodeMirror.mdl .cm-md-capB::after{background:#241a10}
.CodeMirror.mdl .cm-md-capS{color:#d8dee8}.CodeMirror.mdl .cm-md-capS::before{background:#b7c0cf}.CodeMirror.mdl .cm-md-capS::after{background:#181c24}
.CodeMirror.mdl .cm-md-capG{color:#ecca63}.CodeMirror.mdl .cm-md-capG::before{background:#dcb64d}.CodeMirror.mdl .cm-md-capG::after{background:#23200e}
.CodeMirror.mdl .cm-md-capK{color:#cbd0da}.CodeMirror.mdl .cm-md-capK::before{background:#565b66}.CodeMirror.mdl .cm-md-capK::after{background:#191b22}
.CodeMirror.mdl .cm-md-fnK{background:#191b22;box-shadow:inset 0 0 0 2px #565b66;color:#cbd0da;border-radius:6px;font-weight:700}
/* type NAME medallions — STRAIGHT corners (border-radius:0), hue border via inset shadow */
.CodeMirror.mdl .cm-md-ty-integer{background:color-mix(in srgb,#3181e9 20%,#0b1020);box-shadow:inset 0 0 0 2px #3181e9;color:color-mix(in srgb,#3181e9 60%,#fff);font-weight:700}
.CodeMirror.mdl .cm-md-ty-decimal{background:color-mix(in srgb,#4d90e8 20%,#0b1020);box-shadow:inset 0 0 0 2px #4d90e8;color:color-mix(in srgb,#4d90e8 60%,#fff);font-weight:700}
.CodeMirror.mdl .cm-md-ty-string{background:color-mix(in srgb,#ec8013 18%,#0b1020);box-shadow:inset 0 0 0 2px #ec8013;color:color-mix(in srgb,#ec8013 62%,#fff);font-weight:700}
.CodeMirror.mdl .cm-md-ty-bool{background:color-mix(in srgb,#be274a 22%,#0b1020);box-shadow:inset 0 0 0 2px #be274a;color:color-mix(in srgb,#be274a 60%,#fff);font-weight:700}
.CodeMirror.mdl .cm-md-ty-time{background:color-mix(in srgb,#1d9a4d 20%,#0b1020);box-shadow:inset 0 0 0 2px #1d9a4d;color:color-mix(in srgb,#1d9a4d 62%,#fff);font-weight:700}
.CodeMirror.mdl .cm-md-ty-guard{background:color-mix(in srgb,#a045d5 20%,#0b1020);box-shadow:inset 0 0 0 2px #a045d5;color:color-mix(in srgb,#a045d5 62%,#fff);font-weight:700}
.CodeMirror.mdl .cm-md-ty-keyset{background:color-mix(in srgb,#b577da 20%,#0b1020);box-shadow:inset 0 0 0 2px #b577da;color:color-mix(in srgb,#b577da 62%,#fff);font-weight:700}
.CodeMirror.mdl .cm-md-ty-object{background:color-mix(in srgb,#f3c81b 18%,#0b1020);box-shadow:inset 0 0 0 2px #f3c81b;color:#f6d24a;font-weight:700}
.CodeMirror.mdl .cm-md-ty-list{background:color-mix(in srgb,#3fbfae 18%,#0b1020);box-shadow:inset 0 0 0 2px #3fbfae;color:color-mix(in srgb,#3fbfae 62%,#fff);font-weight:700}
.CodeMirror.mdl .cm-md-ty-table{background:color-mix(in srgb,#a36633 24%,#0b1020);box-shadow:inset 0 0 0 2px #a36633;color:color-mix(in srgb,#a36633 64%,#fff);font-weight:700}
.CodeMirror.mdl .cm-md-ty-module{background:color-mix(in srgb,#8fa3bd 20%,#0b1020);box-shadow:inset 0 0 0 2px #8fa3bd;color:color-mix(in srgb,#8fa3bd 62%,#fff);font-weight:700}
.CodeMirror.mdl .cm-md-ty-value{background:color-mix(in srgb,#9298a4 20%,#0b1020);box-shadow:inset 0 0 0 2px #9298a4;color:color-mix(in srgb,#9298a4 62%,#fff);font-weight:700}</style>
<div class=tabwrap>
<div class=tabbar><a class=tabbtn href="#palette" data-p=panePalette>Palette &amp; medallions</a><a class=tabbtn href="#dalos" data-p=paneDalos>DALOS module (real)</a><a class=tabbtn href="#editable" data-p=paneEditable>Editable (live typing)</a></div>
<div class=pane id=panePalette>
<h1>StoicSyntax palette — canonical prefix order (1–37) + capabilities + live code sample</h1><p class=sub>Functions (region 5): the 7 classes in build order; within each, <b>strongest→lightest</b>. Capabilities (region 4): <b>metallic</b> — bronze/silver/gold. Plus strings + @tags. The 1–37 numbering is the proposed <b>canon sweep order</b>.</p>
<h2 style="margin-top:4px">Medallion exploration — do these pop enough vs plain text?</h2>${medGallery}${shapeGallery}${capMedGallery}${tagMedGallery}${typeNameGallery}${valueGallery}${formBracketGallery}
<div style="display:flex;gap:22px;flex-wrap:wrap"><div style="flex:1 1 460px;min-width:420px">${capsBlk}${CATS.map(c=>blk(c[0],c[1],c[2],true)).join("")}<h2>Supporting (outside the 7-class strength ladder)</h2>${SUP.map(c=>blk(c[0],c[1],c[2],false)).join("")}</div>
<div style="flex:1 1 460px;min-width:420px"><h2 style="margin-top:0">Code sample</h2><pre>${CODE}</pre></div></div>
</div>
<div class=pane id=paneDalos>
<h1>DALOS — StoicSyntax colouring engine (real module, colour-in-place)</h1><p class=sub>1593 lines · ${dalos.stats.capCount} capabilities (metallic medallions) · ~${dalos.stats.strs} strings (blocks) · ~${dalos.stats.nums} number literals (flat medallions). Bloat test — the BUSY version; reorder pass is separate.</p>
${dalos.pre}
</div>
<div class=pane id=paneEditable>
<h1>Editable text view — caret-safe medallions (live typing)</h1><p class=sub>Real editor — click, select, type; the caret stays glued. Pills use <b>background + inset box-shadow + radius only</b> (no padding / border), so character widths never change. Angled caps + side padding stay in the read-only DALOS tab — that one's for the explorer / viewer.</p>
<div class=edtoolbar><span class=edseg id=edseg><button data-mode=flat>Flat bands (today)</button><button data-mode=mdl class=on>Medallions</button></span><span class=edcaret id=edcaret>1:1</span></div>
<div id=edhost></div>
<textarea id=edsrc style=display:none>
;; DALOS — StoicSyntax medallion preview (editable). ;;{C4} governance-gated.
(module DALOS GOV

  (defschema client-state
    account:string
    balance:decimal
    frozen:bool)

  (deftable clients:{client-state})

  (defcap GOV () (enforce-guard (ref-DALOS::GOV|Demiurgoi)))

  (defcap CAP_TRANSFER:bool (from:string to:string amount:decimal)
    (enforce (> amount 0.0) "amount must be positive")
    (compose-capability (CAP_DEBIT from)))

  (defun UC_Fee:decimal (amount:decimal rate:decimal)
    (* amount rate))

  (defun UR_Balance:decimal (account:string)
    (at 'balance (read clients account)))

  (defun URC_Frozen:bool (account:string)
    (at 'frozen (read clients account)))

  (defun UDC_Client:object{client-state} (acct:string bal:decimal)
    { 'account: acct, 'balance: bal, 'frozen: false })

  (defun UEV_Positive:bool (amount:decimal)
    (enforce (> amount 0.0) "must be positive"))

  (defun W_SetBalance (account:string bal:decimal)
    (update clients account { 'balance: bal }))

  (defun WI_Insert (account:string)
    (insert clients account (UDC_Client account 0.0)))

  (defun XE_Transfer (from:string to:string amount:decimal)
    (with-capability (CAP_TRANSFER from to amount)
      (W_SetBalance from (- (UR_Balance from) amount))
      (W_SetBalance to   (+ (UR_Balance to) amount))))

  (defun A_Freeze (account:string)
    (with-capability (GOV)
      (update clients account { 'frozen: true })))

  (defun C_SmartSwap (token:string amount:decimal)
    (SWP|C>OWNER)
    (XE_Transfer token "pool" amount))
)
</textarea>
</div>
</div>
<script src="/vendor/codemirror/lib/codemirror.js"></script>
<script src="/pact-highlight.js"></script>
<script src="/pact-medallion-embed.js"></script>
<script>
// Hash-routed tabs — each tab is its own link (…preview.html#palette / #dalos), shareable + back-button friendly.
function showTab(){var h=(location.hash||'#palette').slice(1);if(h!=='dalos'&&h!=='editable')h='palette';var pane=h==='dalos'?'paneDalos':(h==='editable'?'paneEditable':'panePalette');
document.querySelectorAll('.pane').forEach(function(p){p.classList.toggle('active',p.id===pane);});
document.querySelectorAll('.tabbtn').forEach(function(a){a.classList.toggle('active',a.getAttribute('href')==='#'+h);});
if(h==='editable'&&window.pactEdPreviewInit)window.pactEdPreviewInit();}
addEventListener('hashchange',showTab);showTab();
</script>`;
writeFileSync("/home/ancientbox/ClaudeWS/Claudstermind/dashboard/public/pact-theme-preview.html",html);
console.log("regenerated: palette + DALOS tabs on one page");
