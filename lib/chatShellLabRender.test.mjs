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
  // The page's own static markup that the script reaches for by id.
  for (const id of ["rail", "stage", "shell", "hist", "histRepo", "hOpen", "hRet", "histList", "histX",
                    "ctxpop", "ctxbody", "wrappop", "wrapbody", "jumpmsg", "metrics", "wNote",
                    "wCore", "wPact", "expandBtn", "bounds", "shellH", "fit", "addConv", "addTurns",
                    "clearTurns", "agents", "recon", "cue", "imgs", "histBtn", "liveBtn", "ctxr",
                    "cOk", "cLost", "cRecon", "loadr", "loadSim", "nearTurns"]) {
    const n = makeNode("div"); n.setAttribute("id", id); body.appendChild(n);
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
