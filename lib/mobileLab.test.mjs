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

test("the left panel is this chat's repository controls, in two levels", () => {
  const { page, win } = runPage();
  findIn(page, ".m-rail.--l").fire("click");
  const panel = findIn(findIn(page, ".mob"), ".m-panel.--l");
  const text = panel.textContent;
  // LEVEL 1: which repository this chat box points at. LEVEL 2: which of that repository's
  // conversations is open, and the workspace that conversation runs in.
  assert.ok(text.includes("1 · Repository"), "level one is the repository");
  assert.ok(text.includes("2 · Conversations"), "level two is that repository's conversations");
  assert.ok(text.includes("Workspace for this conversation"), "…each of which has its own workspace");
  assert.ok(text.includes("multi-chat"), "…and multi-chat is what allows more than one at once");
  assert.ok(text.includes("★"), "the ★ marks the repository's main conversation");
  // The numbers moved OUT of here: this pane sets things, the right one reports them.
  assert.ok(!findIn(panel, ".cs-shell.m-chips"), "the stats chips belong to the right pane now");
});

test("choosing a repository opens that repository's ★ main conversation", () => {
  const { page, win } = runPage();
  findIn(page, ".m-rail.--l").fire("click");
  const rows = findAllIn(findIn(findIn(page, ".mob"), ".m-panel.--l"), ".m-row");
  const other = rows.find((r) => r.textContent.includes("Khronoton"));
  assert.ok(other, "every repository must be reachable from here");
  other.fire("click");
  assert.equal(win.__S.repo, "AncientPantheon/constructors/Khronoton");
  assert.ok(win.__S.convo.star, "a repository means its main conversation until you pick another");
  assert.ok(findIn(findIn(page, ".mob"), ".m-head").textContent.includes("Khronoton"), "…and the head bar says so");
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

test("the right panel is what this conversation has cost: stats, context, and the agents", () => {
  const { page, win } = runPage();
  findIn(page, ".m-rail.--r").fire("click");
  const panel = findIn(findIn(page, ".mob"), ".m-panel.--r");
  const text = panel.textContent;
  // The chips that used to sit in the header, built by the package's own function.
  const chips = findIn(panel, ".cs-shell.m-chips");
  assert.ok(chips && chips.textContent.includes("turns"), "the stats chips move here, from ChatShell.buildStatsChips");
  assert.ok(text.includes("Agents"), "…beside the agents running underneath the conversation");
  const agents = findAllIn(panel, ".m-agent");
  assert.equal(agents.length, win.__S.agentList.length, "each agent is its own tab, not a count in a sentence");
  assert.ok(agents.some((a) => a.classList.contains("--run")), "a running one is distinguishable from a finished one");
  // Nothing you SET lives here any more — that all moved to the model sheet.
  assert.equal(findAllIn(panel, ".m-wheel").length, 0, "the selectors belong to the model sheet");
});

test("the model sheet holds the four zones, and nothing that is not addressed to the agent", () => {
  const { page, win } = runPage();
  findIn(findIn(page, ".mob"), ".m-running").fire("click");
  assert.equal(win.__S.sheet, "model");
  const sheet = findIn(findIn(page, ".mob"), ".m-sheet");
  assert.ok(sheet, "the middle strip pulls up a sheet");
  const wheels = findAllIn(sheet, ".m-wheel");
  assert.equal(wheels.length, 3, "model + effort in one zone, permission in its own");
  for (const w of wheels) {
    assert.ok(findIn(w, ".m-view"), "a wheel scrolls");
    assert.ok(findIn(w, ".m-band"), "…under a fixed selection band, which is what makes it a wheel and not a list");
  }
  const text = sheet.textContent;
  for (const must of ["ultracode", "auto-wrap", "Context", "Compact", "Wrap"])
    assert.ok(text.includes(must), `the model sheet must carry "${must}"`);
  // "no auto-continue toggle (not its place here)" — and no pane furniture either.
  for (const never of ["auto-continue", "Full", "Star", "History"])
    assert.ok(!text.includes(never), `"${never}" is not addressed to the agent and must not be in this sheet`);
});

test("Conversations and Marks are the two selectors, and they open their own sheets", () => {
  const { page, win } = runPage();
  const risers = findAllIn(findIn(page, ".mob"), ".m-riser");
  assert.equal(risers.length, 2, "one on each side of the model strip");
  risers[0].fire("click");
  assert.equal(win.__S.sheet, "convos", "the left one selects between whole chats");
  let sheet = findIn(findIn(page, ".mob"), ".m-sheet");
  assert.ok(sheet.textContent.includes("Claudstermind · Main"), "…listing the open chats");
  assert.ok(sheet.textContent.includes("New chat"), "…and offering another");
  findAllIn(findIn(page, ".mob"), ".m-riser")[1].fire("click");
  assert.equal(win.__S.sheet, "marks", "the right one selects between marks");
  sheet = findIn(findIn(page, ".mob"), ".m-sheet");
  assert.ok(/R#\d+|P#\d+/.test(sheet.textContent), "…and a mark is an address on a turn");
});

test("the context medallion opens the breakdown over the whole page", () => {
  const { page, win } = runPage();
  const chip = findIn(findIn(page, ".mob"), ".m-ctx");
  assert.ok(chip.textContent.includes("%"), "the header carries the one number");
  chip.fire("click");
  assert.equal(win.__S.overlay, "context");
  const over = findIn(findIn(page, ".mob"), ".m-over");
  assert.ok(over, "…and tapping it takes the whole page, not a popover on a phone");
  assert.ok(findAllIn(over, ".m-ctxrow").length >= win.__S.ctxParts.length, "every part of the window is named");
  assert.ok(findIn(over, ".m-ctxbar"), "…and shown as shares of one bar");
  assert.ok(over.textContent.includes("Conversation") && over.textContent.includes("Free"),
    "a breakdown must account for the free space too, or it does not add up");
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
  // The expansion button is gone — the box grows with what you type, so it duplicated itself.
  assert.equal(findAllIn(row, ".m-ico.--retract").length, 0, "no expansion button");
  assert.ok(findIn(findIn(row, ".m-mid"), ".m-med"), "what is centred beneath the type box is the Live bulb");
  assert.ok(findIn(row, ".m-snd") && findIn(row, ".m-stp"), "Send and Stop go right");
  assert.ok(findIn(row, ".m-auto"), "…beside the auto-continue ticker");
  // the Live/Held medallion straddles the row's top edge, above the retractor
  const med = findIn(row, ".m-med");
  assert.ok(med, "the Live/Held medallion is the one thing in the middle of that row");
  // It is the SCROLL stick, not the turn state — the header already carries the turn state, and the
  // two were briefly the same word on the same screen.
  assert.ok(med.textContent.includes("Live"), "pinned to the bottom reads Live");
  med.fire("click");
  assert.equal(win.__S.stick, true, "tapping it returns to the bottom and re-arms Live");
  // 1. the strip glued to the nav
  const risers = findIn(mob, ".m-risers");
  assert.ok(risers, "the riser strip is glued to the navigation below it");
  assert.equal(findAllIn(risers, ".m-riser").length, 2, "Conversations left, Marks right");
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>")).replace(/\s+/g, " ");
  assert.match(css, /\.m-riser\{flex:0 0 104px/, "both sides get the SAME width, so the model strip is genuinely centred");
  assert.ok(findIn(risers, ".m-running"), "…and the running-model readout in the middle");
});

test("the middle strip is a READOUT of what is running, and opens the pane that can change it", () => {
  const { page, win } = runPage();
  const running = findIn(findIn(page, ".mob"), ".m-running");
  assert.equal(findAllIn(running, "select").length, 0, "it must not be a selector — that is the right pane's job");
  assert.ok(running.textContent.includes(win.__S.runningModel), "it names the model actually running");
  assert.ok(running.textContent.includes(win.__S.perm), "…with the effort and the permission it is running under");
  running.fire("click");
  assert.equal(win.__S.sheet, "model", "pulling it up opens the model settings");
});

test("the type box grows on its own, and the core is what yields — it is never covered", () => {
  const { page } = runPage();
  // The core is the only flexing region; every other strip is flex:0 0 auto. That is what makes a
  // taller box PUSH the transcript up instead of sitting on top of it.
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>")).replace(/\s+/g, " ");
  assert.match(css, /\.m-core\{flex:1 1 auto;min-height:0/, "the core must be the only flexing region");
  for (const strip of [".m-compose", ".m-btnrow", ".m-risers", ".m-nav", ".m-head"])
    assert.ok(new RegExp("\\" + strip + "\\{flex:0 0 auto").test(css), `${strip} must not flex, or it would fight the core`);
  const mob = findIn(page, ".mob");
  assert.equal(findAllIn(mob, ".m-ico.--retract").length, 0, "and no button exists to do what typing already does");
});

test("every scrolling surface uses the package's scrollbar, not the browser's", () => {
  const { page } = runPage();
  const mob = findIn(page, ".mob");
  // frame.css styles `.rg-core, .rg-typebox` — thin, rounded, inset, transparent track. Carrying the
  // package's class is how this page gets that treatment without restating the values.
  assert.ok(findIn(mob, ".m-core").classList.contains("rg-core"), "the transcript");
  assert.ok(findIn(mob, ".m-box").classList.contains("rg-typebox"), "the type box");
  findIn(page, ".m-rail.--l").fire("click");
  assert.ok(findIn(findIn(page, ".mob"), ".m-pbody").classList.contains("rg-core"), "the panels");
  const frame = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "frame.css"), "utf8");
  assert.match(frame, /\.rg-core, \.rg-typebox \{ scrollbar-width: thin/, "…and that rule is the package's, not a copy here");
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  assert.ok(!/scrollbar-color/.test(css), "no second scrollbar design may be declared on this page");
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
