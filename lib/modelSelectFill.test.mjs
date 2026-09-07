// node --test lib/modelSelectFill.test.mjs
//
// THE REPORTED BUG, in the user's words: "i cant seem to switch to opus 5.0 for this chat" — the
// model dropdown offered exactly ONE entry, the model already running, so a conversation on Sonnet
// could not be moved to Opus at all.
//
// The mechanism was subtle and is exactly why this suite executes the real function instead of
// grepping for it (which is what the two tests it replaces did, and why they passed while the
// control was a dead end): when the catalogue is empty — a cold load, or a cached catalogue holding
// only omni/* entries while OmniRoute is off — the "keep the current pick visible" branch injects
// the ACTIVE model as a lone option. A <select> with one option is not a blank <select>, so the
// existing "no options at all" fallback never fired.
//
// Sliced-and-evaluated against a tiny DOM shim, the same approach as lib/modelOptionGroups.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

function slice(begin, end, what) {
  const a = src.indexOf(begin), b = src.indexOf(end);
  assert.ok(a >= 0 && b > a, `${what} block markers must exist in app.js`);
  return src.slice(a, b + end.length);
}
const identity = slice("// ===== MODEL IDENTITY — pure helpers", "// ===== end MODEL IDENTITY pure helpers =====", "model identity");
const groups   = slice("// ===== MODEL OPTION GROUPS — pure helper", "// ===== end MODEL OPTION GROUPS pure helper =====", "model option groups");
const fill     = slice("// ===== MODEL SELECT FILL", "// ===== end MODEL SELECT FILL", "model select fill");

// --- the smallest DOM the fill path actually touches -------------------------------------------
class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this.value = "";
    this.title = "";
    this._text = "";
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  append(...kids) { for (const k of kids) { if (k === "" || k == null) continue; if (typeof k === "object") k.parentNode = this; this.childNodes.push(k); } }
  appendChild(k) { this.append(k); return k; }
  replaceChildren(...kids) { this.childNodes = []; this.append(...kids); }
  addEventListener() {}
  set textContent(v) { this._text = String(v); this.childNodes = []; }
  get textContent() { return this._text + this.childNodes.map((c) => (typeof c === "string" ? c : c.textContent)).join(""); }
  /** The ONE selector the fill path uses, and the one whose semantics the bug turned on: a <select>
   *  with a single injected option answers this truthily, which is why "no options at all" was the
   *  wrong condition to hang the fallback on. */
  querySelector(sel) { return this._options().find((o) => sel === "option" || o.attributes.value === sel.slice(sel.indexOf('"') + 1, sel.lastIndexOf('"'))) || null; }
  _options() {
    const out = [];
    const walk = (n) => { for (const c of n.childNodes) { if (typeof c === "object") { if (c.tagName === "OPTION") out.push(c); else walk(c); } } };
    walk(this);
    return out;
  }
}
const doc = { createElement: (t) => new FakeNode(t), createTextNode: (t) => t };
// eslint-disable-next-line no-new-func
const H = new Function("document", "window", `
  ${identity}
  ${groups}
  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    for (const k in (attrs || {})) { if (k === "class") n.className = attrs[k]; else if (k === "value") { n.value = attrs[k]; n.setAttribute("value", attrs[k]); } else if (k === "title") n.title = attrs[k]; else n.setAttribute(k, attrs[k]); }
    for (const c of (kids || [])) if (c != null && c !== "") n.append(c);
    return n;
  }
  function routingOmniVisible() { return false; }
  const wsPost = () => {};
  ${fill}
  return { wsFillModelSelectFrom, WS_FALLBACK_MODELS, dedupeModelRows, modelOptionGroups, modelExactId };
`)(doc, {});

const mkSel = () => new FakeNode("select");
const values = (sel) => sel._options().map((o) => o.attributes.value);
const labels = (sel) => sel._options().map((o) => o.textContent);

test("THE BUG: an empty catalogue plus a running model must still offer every model, not just the running one", () => {
  const sel = mkSel();
  let refreshes = 0;
  // Exactly the reported state: no catalogue at all, but the engine has reported it is on Sonnet.
  H.wsFillModelSelectFrom(sel, [], "claude-sonnet-4-5-20250929", () => refreshes++);

  const vals = values(sel);
  assert.ok(vals.length > 1, "a picker offering one option is a dead end, not a picker");
  assert.ok(vals.includes("opus"), "Opus must be reachable — this is the whole report");
  assert.ok(vals.includes("haiku") && vals.includes("sonnet"),
    "every subscription alias that names a real model must be offered, not just the one already running");
  assert.ok(!vals.includes("default"),
    "`default` names no model — it can only ever tell you less than the three real aliases beside it");
  assert.ok(vals.includes("claude-sonnet-4-5-20250929"),
    "…and the model actually running stays visible, so the current pick is never silently lost");
  assert.equal(sel.value, "claude-sonnet-4-5-20250929", "the selector still SHOWS what is running");
  assert.equal(refreshes, 1, "an empty catalogue must also trigger one real request for the real one");
});

test("a real Anthropic catalogue is used verbatim — the aliases are a fallback, never an addition", () => {
  const sel = mkSel();
  let refreshes = 0;
  const list = [{ value: "claude-opus-4-5-20251101", displayName: "Opus 4.5" },
                { value: "claude-sonnet-4-5-20250929", displayName: "Sonnet 4.5" }];
  H.wsFillModelSelectFrom(sel, list, "claude-opus-4-5-20251101", () => refreshes++);
  assert.deepEqual(values(sel), ["claude-opus-4-5-20251101", "claude-sonnet-4-5-20250929"],
    "no alias rows are mixed into a catalogue that already names concrete builds");
  assert.equal(refreshes, 0, "a catalogue that answered must not trigger a refresh probe");
  assert.equal(sel.value, "claude-opus-4-5-20251101");
});

test("no pick and no active model: the control still names something concrete, never a bare caret", () => {
  const sel = mkSel();
  H.wsFillModelSelectFrom(sel, [], "", () => {});
  assert.ok(sel.value, "selectedIndex -1 renders as an empty control naming no model at all");
  assert.ok(values(sel).includes(sel.value), "and the value it settles on must be one it actually offers");
});

test("a catalogue holding only omni/* entries, with OmniRoute off, is an EMPTY catalogue", () => {
  // This is the second way the reported state arises: the browser's cached catalogue is non-empty,
  // but every entry is filtered out before the fill, leaving the same dead-end single option.
  const sel = mkSel();
  let refreshes = 0;
  H.wsFillModelSelectFrom(sel, [], "claude-opus-4-5-20251101", () => refreshes++);
  assert.ok(values(sel).includes("sonnet"), "the aliases carry the picker until the real catalogue lands");
  assert.equal(refreshes, 1);
});

test("the fallback aliases are REAL accepted values, never invented labels", () => {
  assert.deepEqual(H.WS_FALLBACK_MODELS.map((m) => m.value), ["opus", "sonnet", "haiku"],
    "these are the subscription aliases the SDK accepts — anything else would be a picker that names a model the engine will reject");
  assert.ok(!H.WS_FALLBACK_MODELS.some((m) => /default/i.test(m.value) || /default/i.test(m.label)),
    "and none of them is `default`, which names no model at all");
});

test("an active model that IS one of the aliases is not duplicated", () => {
  const sel = mkSel();
  H.wsFillModelSelectFrom(sel, [], "opus", () => {});
  assert.equal(values(sel).filter((v) => v === "opus").length, 1, "one row per model");
  assert.equal(sel.value, "opus");
  assert.ok(labels(sel).some((l) => /Opus/.test(l)));
});

/* ================= ONE ENTRY PER MODEL — no `default`, no alias noise ==========================
 *
 * Reported twice in one message: "I don't want to see default in the model selector. Also no default
 * in the model selector." Both halves were real and had the same cause.
 *
 * The SDK's catalogue lists subscription ALIASES as rows of their own, and they collide with the
 * concrete rows. Measured against the live catalogue this dashboard had cached:
 *   { value: "default", resolvedModel: "claude-sonnet-5" }  and  { value: "sonnet", resolvedModel: "claude-sonnet-5" }
 * — one model, two rows. The label then appended the alias to disambiguate them, which is how the
 * picker came to read "Sonnet 5 (default)" / "Sonnet 5 (sonnet)" / "Opus 5 (opus)".
 */

const CAT = [
  { value: "default", resolvedModel: "claude-sonnet-5", displayName: "Default (recommended)" },
  { value: "sonnet",  resolvedModel: "claude-sonnet-5", displayName: "Sonnet" },
  { value: "opus",    resolvedModel: "claude-opus-5",   displayName: "Opus" },
  { value: "haiku",   resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku" },
];

test("the picker lists one entry per MODEL, and the word `default` never appears", () => {
  const sel = mkSel();
  H.wsFillModelSelectFrom(sel, CAT, "sonnet", () => {});
  assert.deepEqual(labels(sel), ["Sonnet 5", "Opus 5", "Haiku 4.5"],
    "three real models, named the way Claude Code names them — no alias in the text, no duplicate row");
  assert.ok(!labels(sel).some((l) => /default/i.test(l)), "the word `default` must not reach the picker");
  assert.ok(!values(sel).includes("default"), "…and neither must the value behind it");
});

test("dedupe keeps the BETTER spelling of a model, because the survivor's value is what gets sent", () => {
  // `default` is worst (it names no model), a family alias is next, a concrete wire id wins.
  assert.deepEqual(H.dedupeModelRows(CAT).map((m) => m.value), ["sonnet", "opus", "haiku"],
    "`sonnet` must survive over `default` — picking the survivor must never send `default`");

  const withExplicit = [{ value: "sonnet", resolvedModel: "claude-sonnet-5" },
                        { value: "claude-sonnet-5" }];
  assert.deepEqual(H.dedupeModelRows(withExplicit).map((m) => m.value), ["claude-sonnet-5"],
    "a concrete id beats an alias outright — it cannot drift when the subscription default moves");
});

test("rows whose exact model is UNKNOWN are never merged — two unknowns are not the same model", () => {
  const murky = [{ value: "opusplan" }, { value: "auto" }, { value: "recommended" }];
  assert.equal(H.dedupeModelRows(murky).length, 3, "no exact id means no key to merge on; guessing would hide a real choice");
});

test("a pane still stored as `default` selects the model it actually resolves to, never the first in the list", () => {
  // THE TRAP: `default` no longer has an option, so `sel.value = "default"` matches nothing and the
  // browser leaves selectedIndex at -1. The blank-fallback would then select the FIRST option — and
  // if the catalogue happens to list Opus first, a pane running Sonnet would claim to be on Opus.
  const sel = mkSel();
  const reordered = [CAT[2], CAT[0], CAT[1], CAT[3]];   // Opus listed first, on purpose
  H.wsFillModelSelectFrom(sel, reordered, "default", () => {});
  assert.equal(sel.value, "sonnet",
    "`default` and `sonnet` are the same wire id, so the picker must land on Sonnet — not on whatever is first");
  assert.notEqual(sel.value, "opus", "silently showing a different model than the one running is the bug this guards");
});

test("an unresolvable stored pick still shows SOMETHING rather than rendering blank", () => {
  const sel = mkSel();
  H.wsFillModelSelectFrom(sel, CAT, "some-retired-model", () => {});
  assert.ok(sel.value, "a blank selector names nothing at all, which is worse than naming the wrong thing");
});

/* ================= it must not REBUILD when nothing changed ===================================
 *
 * "I have 8 coding chat windows open in core space and typing stalls as fuck."
 *
 * This function is called from paintPane, so it runs on every event in every pane — and it processes
 * the WHOLE catalogue each time (dedupe, group, parse every id into a human name) to produce the same
 * handful of <option>s it already had. Measured in the real app against the real cached catalogue:
 * 468 models, 14 options built, 0.97 ms per call. Eight panes repainting on their agents' events is
 * ~77 ms/sec of pure waste — before anything the user types is even considered.
 */
test("a second call with the same signature does no work at all — the very nodes are untouched", () => {
  const sel = mkSel();
  H.wsFillModelSelectFrom(sel, CAT, "sonnet", () => {}, "sig-1");
  const before = sel._options();
  assert.ok(before.length, "the first call must actually build something");

  H.wsFillModelSelectFrom(sel, CAT, "sonnet", () => {}, "sig-1");
  const after = sel._options();
  assert.equal(after.length, before.length);
  after.forEach((o, i) => assert.equal(o, before[i], "the SAME option objects — not rebuilt ones that merely look alike"));
  assert.equal(sel.value, "sonnet", "and the selection still stands");
});

test("a changed signature rebuilds — the guard must never make the picker stale", () => {
  const sel = mkSel();
  H.wsFillModelSelectFrom(sel, CAT, "sonnet", () => {}, "sig-1");
  const before = sel._options();
  H.wsFillModelSelectFrom(sel, CAT, "opus", () => {}, "sig-2");
  assert.notEqual(sel._options()[0], before[0], "a new signature must genuinely rebuild");
  assert.equal(sel.value, "opus", "…and land on the new pick");
});

test("with no signature at all the guard is inert — an unmigrated caller still works", () => {
  const sel = mkSel();
  H.wsFillModelSelectFrom(sel, CAT, "sonnet", () => {});
  const before = sel._options();
  H.wsFillModelSelectFrom(sel, CAT, "sonnet", () => {});
  assert.notEqual(sel._options()[0], before[0], "no signature means no caching — correctness before speed");
});

test("a FALLBACK build is never cached, or a cold load would show three aliases forever", () => {
  // With an empty catalogue the fallback aliases render and the code asks the server for the real
  // one. Caching that answer would stop it ever asking again — the retry lives on this path.
  const sel = mkSel();
  let asked = 0;
  H.wsFillModelSelectFrom(sel, [], "", () => asked++, "sig-cold");
  assert.equal(asked, 1, "the first cold build asks for the real catalogue");
  H.wsFillModelSelectFrom(sel, [], "", () => asked++, "sig-cold");
  assert.equal(asked, 2, "…and so does the next, because a fallback build is not a cacheable answer");
});
