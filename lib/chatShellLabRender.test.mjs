// node --test lib/chatShellLabRender.test.mjs
//
// WHY THIS EXISTS: grepping the lab told me controls were "wired", but it could not tell me the page
// still RUNS. A missing `S.worktrees` (a state field whose patch had silently aborted) threw inside
// build(), so the footer was never appended — the page rendered a header and a transcript and simply
// stopped, and no amount of static checking noticed.
//
// This evaluates the lab's real inline script against a minimal DOM shim and asserts the shell actually
// builds: all three regions present, the footer's controls present, no exception. It is not a browser
// and proves nothing about pixels — but "the script throws halfway through building the UI" is now
// impossible to ship.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dir, "..", "dashboard", "public", "chat-shell-lab.html"), "utf8");
const shellJs = readFileSync(join(__dir, "..", "dashboard", "public", "chat-shell.js"), "utf8");

// --- the smallest DOM that lets the lab's build()/layout() run -------------------------------------
function makeNode(tag) {
  const n = {
    tagName: String(tag || "div").toUpperCase(), children: [], attrs: {}, style: {}, dataset: {},
    className: "", textContent: "", innerHTML: "", value: "", checked: false, hidden: false, title: "",
    placeholder: "", disabled: false, parentNode: null,
    offsetHeight: 30, clientHeight: 600, scrollHeight: 34, offsetWidth: 400, clientWidth: 900,
    classList: {
      add(...c) { c.forEach((x) => { if (!n.className.split(" ").includes(x)) n.className += " " + x; }); },
      remove(...c) { n.className = n.className.split(" ").filter((x) => !c.includes(x)).join(" "); },
      toggle(c, on) { const has = n.className.split(" ").includes(c); const want = on === undefined ? !has : !!on; want ? n.classList.add(c) : n.classList.remove(c); return want; },
      contains(c) { return n.className.split(" ").includes(c); },
    },
    setAttribute(k, v) { n.attrs[k] = String(v); if (k === "id") n.id = String(v); if (k.startsWith("data-")) n.dataset[k.slice(5)] = String(v); },
    getAttribute(k) { return n.attrs[k] ?? null; },
    appendChild(c) { if (c && typeof c === "object") { c.parentNode = n; n.children.push(c); } return c; },
    replaceChildren(...k) { n.children = []; k.forEach((c) => { if (c && typeof c === "object") n.appendChild(c); }); },
    addEventListener() {}, removeEventListener() {}, scrollIntoView() {}, focus() {}, closest() { return null; },
    querySelector(sel) { return findIn(n, sel); },
    querySelectorAll(sel) { return findAllIn(n, sel); },
    remove() {},
  };
  return n;
}
const all = (n, out = []) => { out.push(n); n.children.forEach((c) => all(c, out)); return out; };
function matches(n, sel) {
  sel = sel.trim();
  if (sel.startsWith("#")) return n.id === sel.slice(1);
  if (sel.startsWith(".")) return sel.slice(1).split(".").every((c) => n.classList.contains(c));
  if (sel.startsWith("[")) { const m = sel.match(/^\[([^=\]]+)(?:=["']?([^"'\]]*)["']?)?\]$/); if (!m) return false;
    return m[2] === undefined ? n.attrs[m[1]] !== undefined : n.attrs[m[1]] === m[2]; }
  return n.tagName === sel.toUpperCase();
}
const findIn = (root, sel) => all(root).slice(1).find((n) => sel.split(/\s+/).some((s) => matches(n, s))) || null;
const findAllIn = (root, sel) => all(root).slice(1).filter((n) => matches(n, sel));

function runLab() {
  const body = makeNode("body");
  const doc = {
    body,
    createElement: makeNode,
    createTextNode: (t) => ({ tagName: "#text", textContent: String(t), children: [], classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }),
    querySelector: (s) => findIn(body, s),
    querySelectorAll: (s) => findAllIn(body, s),
    addEventListener() {},
  };
  // The page's own static markup. Ids are PARSED from the HTML rather than hardcoded, so a control
  // added to the rail is covered automatically — a hardcoded list would go stale and produce a shim
  // failure that looks exactly like a page bug (it did, once).
  const markup = html.slice(0, html.indexOf("<script"));
  for (const m of markup.matchAll(/id="([a-zA-Z0-9_-]+)"/g)) {
    const n = makeNode("div"); n.setAttribute("id", m[1]); body.appendChild(n);
  }
  // popup header spans the script rewrites
  const pophd = makeNode("div"); pophd.className = "pophd";
  pophd.appendChild(makeNode("span"));
  doc.querySelector("#wrappop").appendChild(pophd);

  const win = { document: doc, requestAnimationFrame: (f) => f(), addEventListener() {}, prompt: () => "x", innerHeight: 900, innerWidth: 1400 };
  win.window = win;
  new Function("window", shellJs)(win);          // provides window.ChatShell

  const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
  new Function("window", "document", "ChatShell", script + "\nwindow.__S = S;")(win, doc, win.ChatShell);
  return { body, doc, S: win.__S };
}

test("the lab page builds without throwing, and produces all three regions", () => {
  const { doc } = runLab();                       // throws if build()/layout() throw — the actual bug
  assert.ok(doc.querySelector(".rg-header"), "HEADER region missing");
  assert.ok(doc.querySelector(".rg-core"), "CORE region missing");
  assert.ok(doc.querySelector(".rg-footer"), "FOOTER region missing — build() threw before appending it");
});

test("the footer contains its controls — the ones that vanished when build() threw", () => {
  const { doc } = runLab();
  for (const id of ["typebox", "f-act", "f-model", "f-wt", "f-bm", "f-expand", "f-sendgrp", "f-bulb"]) {
    assert.ok(doc.querySelector("#" + id), `footer control #${id} is missing`);
  }
});

test("every state field the script reads is actually defined", () => {
  const { S } = runLab();
  for (const k of ["worktree", "worktrees", "jumpText", "maxTurns", "ctxTok", "ctxMax", "bm", "conn", "loadPct"]) {
    assert.notEqual(S[k], undefined, `S.${k} is read by the script but never defined`);
  }
  assert.ok(Array.isArray(S.worktrees) && S.worktrees.length, "S.worktrees must be a non-empty array");
});

test("the Live/Held marker exists and is anchored to the footer seam, not to scrolling Core", () => {
  // It was claimed as added in an earlier round and in fact never rendered at all — S.live and its
  // toggle existed while nothing drew it. Anchoring matters too: a child of .rg-core would scroll away
  // with the very content it describes, because .rg-core is the scroll container.
  const { doc } = runLab();
  const bulb = doc.querySelector("#f-bulb");
  assert.ok(bulb, "the Live/Held marker is missing entirely");
  assert.ok(bulb.className.includes("seambulb"), "it must use the seam styling");
  assert.equal(bulb.parentNode && bulb.parentNode.classList.contains("rg-footer"), true,
    "it must hang off the FOOTER (which is position:relative and does not scroll), not off .rg-core");
});

test("the round/turn model is coherent: turns = 2 x rounds, and nothing is stored twice", () => {
  // prompts/responses/turns used to be INDEPENDENT state, so "+6 turns" moved the transcript while the
  // counters sat still and the two disagreed permanently. They are derived now.
  assert.ok(!/S\.prompts\b/.test(html), "S.prompts must not exist — prompts are derived from rounds");
  assert.ok(!/S\.responses\b/.test(html), "S.responses must not exist — responses are derived from rounds");
  assert.ok(!/S\.turns\b/.test(html), "S.turns must not exist — turns are derived from rounds");
  assert.ok(html.includes("function nTurns() { return S.rounds * 2; }"), "a turn is one ROW; a round is a prompt + its answer");
});

test("the chosen turn ceiling reaches rollTriggers", () => {
  // It was omitted, so the chip always compared against the engine default of 400 and read "930/400"
  // whichever ceiling was selected.
  assert.ok(/rollTriggers\(\{[\s\S]*?maxTurns: S\.maxTurns/.test(html), "maxTurns must be passed through");
});

test("Live/Held is observed from the scroll position, not toggled by hand", () => {
  assert.ok(html.includes('core.addEventListener("scroll"'), "the marker must be driven by real scrolling");
  assert.ok(html.includes("core.scrollHeight - core.scrollTop - core.clientHeight"), "…measured at the bottom edge");
  assert.ok(html.includes("function paintBulb()"), "and repainted alone, never via a full rebuild");
  // A full render() on scroll would reset scrollTop and make Held unreachable.
  assert.ok(!/addEventListener\("scroll", function \(\) \{[^}]*render\(\)/.test(html),
    "a scroll handler must NOT call render() — it would reset scrollTop and pin you at the bottom");
});

test("connection states and the prompt-state bubbles actually render", () => {
  const { doc } = runLab();
  assert.ok(doc.querySelector("#f-gutter"), "the prompt line-number gutter is missing");
  assert.ok(doc.querySelector("#f-lines"), "the total-lines readout is missing");
  assert.ok(html.includes('S.conn === "lost"'), "the disconnected chip must be rendered, not just stored");
  assert.ok(html.includes('S.conn === "recon"'), "the reconnecting chip must be rendered");
  for (const cls of ["--queued", "--deep", "--dead", "--discarded"]) {
    assert.ok(html.includes(cls), `prompt state ${cls} is not rendered`);
  }
});

test("footer context is shown with full thousand separators on BOTH figures", () => {
  assert.ok(html.includes('S.ctxMax.toLocaleString() + " tok'),
    "the ceiling must be formatted like the used figure, not as '1000k' you have to convert in your head");
});

test("the image strip is present at every footer height", () => {
  // It used to collapse, so the evidence that you had attached images vanished exactly while writing
  // the long prompt those images belong to.
  assert.ok(html.includes('var im = $("#f-img"); if (im) im.classList.remove("--gone");'),
    "the image strip must be unconditionally shown");
  assert.ok(!/collapsed\.imageStrip/.test(html), "nothing may still branch on an imageStrip collapse");
});

test("bookmark and share sit beside the turn medallion and are always visible", () => {
  assert.ok(/\.msgacts\{[^}]*top:-10px/.test(html), "actions must sit on the bubble's top edge, level with the P#/R# pill");
  assert.ok(!/\.msgacts\{[^}]*opacity:0/.test(html), "they must not be hidden until hover — that hides which answers are bookmarked");
  assert.ok(html.includes(".msg.--a .msgacts{left:") && html.includes(".msg.--u .msgacts{right:"),
    "answers put them beside the R# pill on the left, prompts beside the P# pill on the right");
});

test("a bookmark can be removed from the bookmark list itself", () => {
  assert.ok(html.includes("delete S.bm[n]"), "the list must offer removal");
  assert.ok(html.includes("No bookmarks left"), "and say so when the last one goes, rather than showing an empty box");
});

test("each popup sets its OWN title, so one cannot inherit the other's", () => {
  const m = html.match(/pophd span"\)\.textContent = /g) || [];
  assert.ok(m.length >= 2, "both openBm and openWrap must set the heading");
  const bm = html.slice(html.indexOf("function openBm"), html.indexOf("function render"));
  assert.ok(!bm.includes("Wrap conversation"), "openBm must not still carry a stray wrap title");
});
