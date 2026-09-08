// node --test lib/mobileLab.test.mjs
//
// WHY THIS EXISTS. "mobile view is broken, doesn't work" — twice in two days, and neither failure was
// reachable from the desk: one was a relay that never served the chat-box package, the other a `const`
// declared inside the branch that desktop takes. dashboard/public/mobile-lab.html is the proposal for
// the phone LAYOUT, and it is the first page in this repo built to be judged on a phone. A mock that
// silently throws teaches nothing, and a mock whose numbers are decoration is worse than no mock — the
// entire argument it makes is a measurement.
//
// So this file does two things:
//   1. Executes the page's single inline script against a DOM shim and asserts it BUILDS — both
//      layouts, the two panels, the rails, the wheels — the way lib/chatShellLabRender.test.mjs does
//      for the Chat Shell Lab (app.js and these pages cannot simply be imported: they boot the DOM).
//   2. Holds the page to the Lab's conventions, because they are what make it testable at all: one
//      inline script, last in the file; shared CSS by root-absolute URL, never a copy.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dir, "..", "dashboard", "public", "mobile-lab.html"), "utf8");
const shellJs = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "chat-shell.js"), "utf8");

/* ---- the smallest DOM that can build this page ------------------------------------------------ */
function makeNode(tag) {
  const n = {
    tagName: String(tag || "div").toUpperCase(), children: [], attrs: {}, style: {}, dataset: {},
    className: "", _text: "", value: "", parentNode: null, _listeners: {},
    offsetTop: 0, offsetHeight: 44, clientHeight: 132, scrollTop: 0, scrollHeight: 400,
    classList: {
      add(...c) { c.forEach((x) => { if (x && !n.className.split(" ").includes(x)) n.className = (n.className + " " + x).trim(); }); },
      remove(c) { n.className = n.className.split(" ").filter((x) => x !== c).join(" "); },
      contains(c) { return n.className.split(" ").includes(c); },
      toggle(c, on) { const has = n.classList.contains(c); const want = on === undefined ? !has : !!on; if (want) n.classList.add(c); else n.classList.remove(c); return want; },
    },
    setAttribute(k, v) { n.attrs[k] = String(v); if (k === "class") n.className = String(v); },
    getAttribute(k) { return n.attrs[k]; },
    appendChild(c) { if (c && typeof c === "object") { c.parentNode = n; n.children.push(c); } return c; },
    append(...k) { k.forEach((c) => n.appendChild(c)); },
    replaceChildren(...k) { n.children = []; k.forEach((c) => n.appendChild(c)); },
    replaceWith(o) { const p = n.parentNode; if (!p) return; p.children[p.children.indexOf(n)] = o; o.parentNode = p; },
    remove() { const p = n.parentNode; if (p) p.children.splice(p.children.indexOf(n), 1); },
    addEventListener(ev, fn) { (n._listeners[ev] = n._listeners[ev] || []).push(fn); },
    fire(ev, arg) { (n._listeners[ev] || []).forEach((fn) => fn.call(n, arg || { touches: [], changedTouches: [], preventDefault() {} })); },
    getBoundingClientRect() { return { top: 0, left: 0, width: 412, height: n === DEVICE ? 915 : 200 }; },
    scrollTo() {},
    querySelector(sel) { return findIn(n, sel); },
    querySelectorAll(sel) { return findAllIn(n, sel); },
    get textContent() { return n._text + n.children.map((c) => c.textContent).join(""); },
    set textContent(v) { n._text = String(v); n.children = []; },
    set innerHTML(v) { n._text = String(v).replace(/<[^>]*>/g, ""); },
    get innerHTML() { return n._text; },
    get childNodes() { return n.children; },
    // `el.id = "mob"` must set the ATTRIBUTE, the way a browser does — the page re-renders by
    // replacing #mob with a freshly built node that claims the same id.
    get id() { return n.attrs.id || ""; },
    set id(v) { n.attrs.id = String(v); },
    get offsetWidth() { return 120; },
    get clientWidth() { return 412; },
  };
  return n;
}
const matches = (n, sel) => sel.split(",").map((s) => s.trim()).some((s) => {
  const m = /^([a-z]+)?((?:[.#][\w-]+)*)(\[[^\]]+\])?$/.exec(s);
  if (!m) return false;
  if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
  for (const part of (m[2] || "").match(/[.#][\w-]+/g) || []) {
    if (part[0] === "." && !n.classList.contains(part.slice(1))) return false;
    if (part[0] === "#" && n.attrs.id !== part.slice(1)) return false;
  }
  if (m[3]) { const a = /\[([\w-]+)=([^\]]+)\]/.exec(m[3]); if (a && String(n.attrs[a[1]]) !== a[2].replace(/["']/g, "")) return false; }
  return true;
});
function findAllIn(root, sel) {
  const out = [];
  (function walk(n) { n.children.forEach((c) => { if (matches(c, sel)) out.push(c); walk(c); }); })(root);
  return out;
}
const findIn = (root, sel) => findAllIn(root, sel)[0] || null;

let DEVICE = null;
function runPage() {
  const doc = makeNode("document");
  doc.createElement = (t) => makeNode(t);
  doc.createTextNode = (t) => { const n = makeNode("#text"); n._text = String(t); return n; };
  doc.body = makeNode("body"); doc.appendChild(doc.body);
  doc.addEventListener = () => {};
  const win = { document: doc, innerHeight: 915, addEventListener() {},
                requestAnimationFrame(fn) { fn(); }, setTimeout() { return 0; }, clearTimeout() {},
                fetch: () => ({ then: () => ({ then: () => ({ catch() {} }) }) }) };
  win.window = win;
  new Function("window", "document", shellJs)(win, doc);

  // The page's static markup, built into the shim the same way the browser would: only the nodes the
  // script actually reaches by id/class matter, so they are declared here rather than parsed.
  const mk = (cls, id) => { const n = makeNode("div"); n.className = cls; if (id) n.attrs.id = id; return n; };
  const page = mk("page"); doc.body.appendChild(page);
  page.appendChild(mk("", "laberr"));
  const sw = mk("sw", "sw");
  ["today", "proposed"].forEach((v) => { const b = makeNode("button"); b.dataset.v = v; b.attrs.v = v; b.className = v === "proposed" ? "on" : ""; sw.appendChild(b); });
  page.appendChild(sw);
  page.appendChild(mk("", "readout"));
  const stamp = makeNode("b"); stamp.attrs.id = "stamp"; page.appendChild(stamp);
  DEVICE = mk("device"); page.appendChild(DEVICE);
  DEVICE.appendChild(mk("mob", "mob"));

  const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
  // The browser hands a page these as bare globals; `new Function` does not, so they are passed in
  // explicitly. rAF runs inline (there is no frame here) and timers never fire — the page must build
  // fully on the synchronous path, which is also what a phone sees on the first paint.
  new Function("window", "document", "ChatShell", "requestAnimationFrame", "setTimeout", "clearTimeout", "fetch",
    script + "\nwindow.__S = S; window.__render = render; window.__setPanel = setPanel;")(
    win, doc, win.ChatShell, (fn) => fn(), () => 0, () => {}, () => ({ then: () => ({ then: () => ({ catch() {} }) }) }));
  return { doc, win, page };
}

test("the page builds, and the proposed layout is a head row, a core, a compose row and the nav", () => {
  const { page, win } = runPage();
  assert.equal(findIn(page, "#laberr").textContent, "", "the page's own error banner must be empty — it catches what a test's assertions would not");
  const mob = findIn(page, ".mob");
  assert.ok(mob, "the mock must have replaced the placeholder");
  for (const sel of [".m-app", ".m-head", ".m-core", ".m-compose", ".m-nav"])
    assert.ok(findIn(mob, sel), `the proposed layout is missing ${sel}`);
  // The claim of the whole page: ONE header row and ONE compose row, not a stack of them.
  assert.equal(findAllIn(mob, ".m-head").length, 1, "one head row");
  assert.equal(findAllIn(mob, ".m-compose").length, 1, "one compose row");
  assert.ok(win.__S.turns.length >= 4, "there is a conversation to look at");
});

test("both reveals exist, open from their own rail, and close again", () => {
  const { page, win } = runPage();
  const railL = findIn(page, ".m-rail.--l"), railR = findIn(page, ".m-rail.--r");
  assert.ok(railL && railR, "a rail on each edge — they are the whole reveal affordance");
  railL.fire("click");
  assert.equal(win.__S.panel, "left");
  assert.ok(findIn(findIn(page, ".mob"), ".m-panel.--l").classList.contains("open"), "the left panel must actually be open");
  findIn(page, ".m-rail.--r").fire("click");
  assert.equal(win.__S.panel, "right", "the other rail switches panels rather than stacking them");
  findIn(page, ".m-scrim").fire("click");
  assert.equal(win.__S.panel, null, "the scrim closes it — the gesture everyone tries first");
});

test("state medallions stay in the HEADER — a reveal must not hide what tells you to open it", () => {
  const { page } = runPage();
  const head = findIn(findIn(page, ".mob"), ".m-head");
  const text = head.textContent;
  assert.ok(text.includes("Live"), "connected/working must be readable without opening anything");
  // COMPACT ON PURPOSE. Three full-text medallions squeezed the conversation name to "★ Claudstermi…"
  // and pushed the reconnect one off the edge at 412px, which defeats the point of showing them. The
  // header carries the SIGNAL (a count, an arrow); the sentence is one tap away in the left pane.
  assert.ok(/◉\s*\d/.test(text), "background work shows as a count");
  assert.ok(text.includes("↻"), "a reconnection shows as its own mark — the one you must not miss");
  assert.ok(findAllIn(head, ".m-hmed").length >= 3, "each state is its own medallion, not a sentence");
  assert.ok(head.textContent.includes("Claudstermind"), "…and the name still fits beside them");
});

test("the left panel is the conversation and its siblings in the same repository", () => {
  const { page, win } = runPage();
  findIn(page, ".m-rail.--l").fire("click");
  const panel = findIn(findIn(page, ".mob"), ".m-panel.--l");
  const text = panel.textContent;
  for (const must of ["Session", "Claudstermind · Main", "Workspace", "multi-chat", "Recall"])
    assert.ok(text.includes(must), `the left panel must carry "${must}"`);
  assert.ok(text.includes("★"), "the ★ marks the repository's MAIN conversation");
  assert.equal(findAllIn(panel, ".m-row").length >= win.__S.convos.length, true,
    "every conversation of this repository must be reachable from here");
  // Built by the package's own function, not redrawn: this is the same row production renders.
  const chips = findIn(panel, ".cs-shell.m-chips");
  assert.ok(chips && chips.children.length >= 3, "the stats chips must come from ChatShell.buildStatsChips");
  assert.ok(chips.textContent.includes("turns"), "…and say what they say in production");
});

test("picking a sibling conversation renames the head bar — the list is wired, not decoration", () => {
  const { page, win } = runPage();
  findIn(page, ".m-rail.--l").fire("click");
  const rows = findAllIn(findIn(findIn(page, ".mob"), ".m-panel.--l"), ".m-row");
  const other = rows.find((r) => r.textContent.includes("mobile rework"));
  assert.ok(other, "a second conversation of the same repository must be listed");
  other.fire("click");
  assert.ok(win.__S.convo.name.includes("mobile rework"), "the choice must reach the state");
  assert.ok(findIn(findIn(page, ".mob"), ".m-head").textContent.includes("mobile rework"), "…and the head bar");
});

test("what the footer used to say is in the right panel, and the pickers are wheels", () => {
  const { page } = runPage();
  findIn(page, ".m-rail.--r").fire("click");
  const panel = findIn(findIn(page, ".mob"), ".m-panel.--r");
  const wheels = findAllIn(panel, ".m-wheel");
  assert.equal(wheels.length, 3, "model, effort and permission are the three values worth a wheel");
  for (const w of wheels) {
    assert.ok(findIn(w, ".m-view"), "a wheel scrolls");
    assert.ok(findIn(w, ".m-band"), "…under a fixed selection band, which is what makes it a wheel and not a list");
    assert.ok(findAllIn(w, ".m-opt").length >= 3, "…over real options");
  }
  const text = panel.textContent;
  for (const must of ["ultracode", "auto-wrap", "Compact", "Wrap", "Full"])
    assert.ok(text.includes(must), `the right panel must carry "${must}" — it is what the footer rows said`);
});

test("the footer is three strips: full-width type box, button row, and the riser strip", () => {
  const { page, win } = runPage();
  const mob = findIn(page, ".mob");
  // 3. THE TYPE BOX OWNS THE WIDTH. An attach button beside it is exactly what made it narrow —
  // "the upload and send button makes the chat not use the whole width".
  const compose = findIn(mob, ".m-compose");
  assert.equal(compose.children.length, 1, "nothing may sit beside the type box");
  assert.equal(compose.children[0].tagName, "TEXTAREA", "…and the one thing there is the field itself");
  // 2. the button row
  const row = findIn(mob, ".m-btnrow");
  assert.ok(row, "the buttons move to their own row");
  assert.ok(findIn(row, ".m-ico.--retract"), "the retractor sits in the middle");
  assert.ok(findIn(row, ".m-snd") && findIn(row, ".m-stp"), "Send and Stop go right");
  assert.ok(findIn(row, ".m-auto"), "…beside the auto-continue ticker");
  // the Live/Held medallion straddles the row's top edge, above the retractor
  const med = findIn(row, ".m-med");
  assert.ok(med, "the Live/Held medallion belongs above the retractor, not in a row of its own");
  // It is the SCROLL stick, not the turn state — the header already carries the turn state, and the
  // two were briefly the same word on the same screen.
  assert.ok(med.textContent.includes("Live"), "pinned to the bottom reads Live");
  med.fire("click");
  assert.equal(win.__S.stick, true, "tapping it returns to the bottom and re-arms Live");
  // 1. the strip glued to the nav
  const risers = findIn(mob, ".m-risers");
  assert.ok(risers, "the riser strip is glued to the navigation below it");
  assert.equal(findAllIn(risers, ".m-riser").length, 2, "Conversations left, Marks right");
  assert.ok(findIn(risers, ".m-running"), "…and the running-model readout in the middle");
});

test("the middle strip is a READOUT of what is running, and opens the pane that can change it", () => {
  const { page, win } = runPage();
  const running = findIn(findIn(page, ".mob"), ".m-running");
  assert.equal(findAllIn(running, "select").length, 0, "it must not be a selector — that is the right pane's job");
  assert.ok(running.textContent.includes(win.__S.runningModel), "it names the model actually running");
  running.fire("click");
  assert.equal(win.__S.panel, "right", "pulling it up opens the model settings");
});

test("the retractor grows the type box, and the core is what yields — it is never covered", () => {
  const { page, win } = runPage();
  const mob = findIn(page, ".mob");
  // The core is the only flexing region; every other strip is flex:0 0 auto. That is what makes a
  // taller box PUSH the transcript up instead of sitting on top of it.
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>")).replace(/\s+/g, " ");
  assert.match(css, /\.m-core\{flex:1 1 auto;min-height:0/, "the core must be the only flexing region");
  for (const strip of [".m-compose", ".m-btnrow", ".m-risers", ".m-nav", ".m-head"])
    assert.ok(new RegExp("\\" + strip + "\\{flex:0 0 auto").test(css), `${strip} must not flex, or it would fight the core`);
  findIn(mob, ".m-ico.--retract").fire("click");
  assert.equal(win.__S.big, true, "the retractor is wired");
  assert.ok(findIn(findIn(page, ".mob"), ".m-ico.--retract").textContent.includes("⌄"), "…and its arrow flips to say what it will do next");
});

test("the rail is a choice, and whichever is chosen the core keeps a gutter so no bubble sits under it", () => {
  const { page, win } = runPage();
  assert.ok(findIn(findIn(page, ".mob"), ".m-core").classList.contains("--gutter"),
    "with a rail on screen the transcript must be inset, or the rail covers a bubble");
  win.__S.rail = "none"; win.__render();
  const mob = findIn(page, ".mob");
  assert.equal(findAllIn(mob, ".m-rail").length, 0, "'none' is a real option — the footer buttons already open both panes");
  assert.ok(!findIn(mob, ".m-core").classList.contains("--gutter"), "…and then the bubbles get the full width back");
});

test("the switch really swaps layouts, and 'Today' rebuilds the stacked rows it is compared against", () => {
  const { page, win } = runPage();
  win.__S.view = "today"; win.__render();
  const mob = findIn(page, ".mob");
  assert.ok(findIn(mob, ".t-hd") && findIn(mob, ".t-ft"), "Today must show the header/footer rows production ships");
  assert.equal(findAllIn(mob, ".t-row").length, 5, "2 header rows + 3 footer rows — the shape measured on the live page");
  assert.ok(findIn(mob, ".t-mcbar"), "…plus the mobile action bar");
  assert.ok(findIn(mob, ".t-risers"), "…plus the riser tabs, which is the third control strip");
  assert.equal(findAllIn(mob, ".m-rail").length, 0, "and no rails: they are the proposal, not the status quo");
});

/* ---- conventions that keep the page testable and honest --------------------------------------- */
test("conventions: one inline script, last in the file, and shared CSS by URL rather than copied", () => {
  assert.equal((html.match(/<script>/g) || []).length, 1, "exactly one inline script — the render test slices it out by position");
  assert.ok(html.lastIndexOf("</script>") > html.lastIndexOf("<div"), "the inline script must be the last thing in the file");
  assert.ok(html.includes('<link rel="stylesheet" href="/chat-shell/chat-shell.css">'),
    "the package's stylesheet by root-absolute URL — a copy is a second version that drifts");
  assert.ok(html.includes('src="/chat-shell/chat-shell.js"'), "and its real maths, so the chips are the production ones");
});

test("conventions: it says on its face that it is a mockup, and it is public after a deploy", () => {
  assert.match(html, /Mockup only — production untouched/, "the page must say what it is where you can see it, not only in a comment");
  assert.ok(html.includes("PUBLIC AFTER A DEPLOY"), "the comment must record that dashboard/public is served without login");
  assert.ok(!/ancientholdings|kjrkentolopon/i.test(html), "no account or domain detail on a page the internet can read");
});

test("conventions: no unclosed CSS comment can eat the rule after it", () => {
  // A literal `*/` inside a CSS comment closed it early once and silently deleted the next rule —
  // lib/chatShellRoleSlots.test.mjs exists for that exact bug on the Chat Shell Lab.
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  const opens = (css.match(/\/\*/g) || []).length, closes = (css.match(/\*\//g) || []).length;
  assert.equal(opens, closes, "every CSS comment must close exactly once");
});
