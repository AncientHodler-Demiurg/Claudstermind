// node --test lib/mobileCockpit.test.mjs
//
// WHY THIS EXISTS. dashboard/public/mobile-cockpit.js is the phone layout that
// dashboard/public/mobile-lab.html argued for over eight review rounds, moved into production — and
// the move is exactly where such a thing dies. The lab reads one local `S` object and re-renders the
// world; the cockpit must know nothing about Core, so every number arrives through `setState` and
// every action leaves through `opts.on.*`. A leaking boundary is invisible on screen: the page still
// looks right while a control silently does nothing, or while app.js quietly grows a second
// implementation of a surface that then drifts from this one. So this file executes the real module
// against a DOM shim (copied from lib/mobileLab.test.mjs, which pins the lab the same way — app.js
// and these pages cannot simply be imported, they boot the DOM) and asserts the decisions the design
// settled plus the ones a port loses first: the footer is three strips and the type box has its row
// to itself, Stop keeps its slot, the middle riser is a readout and never a selector, the bulb sits
// on the seam, every surface opens from the affordance the design gives it, and each per-bubble
// action leaves through its callback carrying that turn's address. Every assertion is a claim about
// the CONTRACT, not about pixels.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "mobile-cockpit.js"), "utf8");

/* ---- the smallest DOM that can build this module ---------------------------------------------- */
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
    getAttribute(k) { return k in n.attrs ? n.attrs[k] : null; },
    appendChild(c) { if (c && typeof c === "object") { if (c.parentNode) c.remove(); c.parentNode = n; n.children.push(c); } return c; },
    append(...k) { k.forEach((c) => n.appendChild(c)); },
    replaceChildren(...k) { n.children.forEach((c) => { c.parentNode = null; }); n.children = []; k.forEach((c) => n.appendChild(c)); },
    replaceWith(o) { const p = n.parentNode; if (!p) return; p.children[p.children.indexOf(n)] = o; o.parentNode = p; },
    remove() { const p = n.parentNode; if (p) p.children.splice(p.children.indexOf(n), 1); n.parentNode = null; },
    addEventListener(ev, fn) { (n._listeners[ev] = n._listeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) { n._listeners[ev] = (n._listeners[ev] || []).filter((f) => f !== fn); },
    fire(ev, arg) { (n._listeners[ev] || []).forEach((fn) => fn.call(n, Object.assign({ touches: [], changedTouches: [], target: n, preventDefault() {}, stopPropagation() {} }, arg || {}))); },
    getBoundingClientRect() { return { top: 0, left: 0, width: 412, height: 200 }; },
    scrollTo() {},
    querySelector(sel) { return findIn(n, sel); },
    querySelectorAll(sel) { return findAllIn(n, sel); },
    get textContent() { return n._text + n.children.map((c) => c.textContent).join(""); },
    set textContent(v) { n._text = String(v); n.children = []; },
    set innerHTML(v) { n._text = String(v).replace(/<[^>]*>/g, ""); },
    get innerHTML() { return n._text; },
    get childNodes() { return n.children; },
    get id() { return n.attrs.id || ""; },
    set id(v) { n.attrs.id = String(v); },
    // Width follows the LABEL, because that is the fact fitRisers exists to measure: two risers
    // carrying different counts have different natural widths, and a fit that did nothing would
    // leave them that way.
    get offsetWidth() { return 24 + n.textContent.length * 7; },
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
const has = (node, s) => node.textContent.includes(s);

/* Every callback the module is allowed to reach for. Named here rather than spied by Proxy so this
   list is itself the contract app.js must satisfy (T3 asserts the other half of it). */
const CALLBACKS = ["send", "stop", "autoContinue", "attach", "input", "model", "effort", "permission",
  "ultracode", "autoWrap", "compact", "wrap", "pickRepo", "pickConversation", "newConversation",
  "makeMain", "multiChat", "pickWorktree", "openHistory", "resumeConversation", "openConversation",
  "copyTurn", "replyTurn", "shareTurn", "starTurn", "jumpBottom",
  // Chats are the BOXES; conversations are the threads inside one of them. Separate lists, separate
  // callbacks — collapsing the two is what made the tab read "Chats 1" with two boxes open.
  "pickChat", "newChat", "pickMark"];

/* A conversation-shaped state, in the shape a real adapter would push. Content is invented. */
const DEMO = {
  title: "Claudstermind · Main", star: true,
  connection: { text: "Live", tone: "ok" },
  running: {
    model: { value: "opus-5", label: "Opus 5", options: [{ value: "sonnet-4.5", label: "Sonnet 4.5" }, { value: "opus-5", label: "Opus 5" }] },
    effort: { value: "", label: "Default effort", options: [{ value: "", label: "Default effort" }, { value: "high", label: "high" }] },
    permission: { value: "bypassPermissions", label: "Bypass", options: [{ value: "default", label: "Manual" }, { value: "bypassPermissions", label: "Bypass" }] },
    ultracode: false, autoWrap: true,
  },
  // The parts must SUM to `tokens` — a breakdown that does not add up to the number in the header is
  // the bug this surface exists to make visible, not a shape a fixture may quietly have.
  context: {
    tokens: 205590, ceiling: 1000000,
    parts: [{ name: "Conversation", tokens: 148200, colour: "#c77dff" },
            { name: "Tool results", tokens: 38400, colour: "#4ecdc4" },
            { name: "File attachments", tokens: 12600, colour: "#6ea8ff" },
            { name: "System prompt + tools", tokens: 5100, colour: "#f5b544" },
            { name: "Memory (CLAUDE.md)", tokens: 1290, colour: "#7ee787" }],
  },
  agents: [{ name: "review:correctness", state: "run", meta: "2m 14s" },
           { name: "review:tests", state: "done", meta: "1m 02s" }],
  /* TWO LISTS, TWO MEANINGS — the distinction this fixture used to blur, which is how "Chats 1"
     appeared while two chat boxes were open.
       chats         = the chat BOXES, one per repository, several open at once
       conversations = the threads INSIDE the one repository this box points at */
  chats: [
    { id: "p1", name: "Claudstermind · Main", sub: "live", active: true, star: true },
    { id: "p2", name: "OuronetUI · dev", sub: "2h ago", star: true },
  ],
  conversations: [
    { id: "c1", name: "Claudstermind · Main", repo: "Claudstermind", worktree: "main", sub: "live", active: true, star: true },
    { id: "c2", name: "Claudstermind · mobile rework", repo: "Claudstermind", worktree: "wt/mobile", sub: "20m ago" },
  ],
  repos: [
    { name: "Claudstermind", path: "Claudstermind", kind: "orchestrator", org: "AncientHodler-Demiurg", colour: "#9aa6c7" },
    { name: "Khronoton", path: "AncientPantheon/constructors/Khronoton", kind: "constructor", org: "AncientPantheon", scope: "@ancientpantheon", colour: "#c084fc" },
    { name: "Pythia", path: "AncientPantheon/constructors/Pythia", kind: "constructor", org: "AncientPantheon", scope: "@ancientpantheon", colour: "#c084fc" },
    { name: "OuronetUI", path: "OuroborosNetwork/daimons/OuronetUI", kind: "daimon", org: "OuroborosNetwork", scope: "@ouronet", colour: "#34d399" },
  ],
  history: [
    { id: "h1", name: "Claudstermind · Main", repo: "Claudstermind", when: "live", first: "the mobile view is broken…" },
    { id: "h2", name: "Claudstermind · wrap audit", repo: "Claudstermind", when: "2d", first: "why would wrap show 127 answers…", gone: true },
    { id: "h3", name: "Khronoton · Main", repo: "AncientPantheon/constructors/Khronoton", when: "1d", first: "publish 0.9.0 end to end" },
  ],
  /* `at` is an OPAQUE handle the host hands back through `pickMark` (in production a timestamp, which
     is meaningless to read) — `note` is the address you recognise and `text` the line you remember. A
     row showing the handle is what "marked · 1787188479777" looked like on a phone. */
  marks: [{ at: 1787188479777, note: "R#6992", text: "the wheel decision" },
          { at: 1787188400000, note: "P#729", text: "left/right reveal brief" }],
  busy: false, stick: true, multiChat: false, worktree: "main",
};

function boot(opts = {}) {
  const doc = makeNode("document");
  doc.createElement = (t) => makeNode(t);
  doc.createTextNode = (t) => { const n = makeNode("#text"); n._text = String(t); return n; };
  doc.body = makeNode("body"); doc.appendChild(doc.body);
  // rAF runs inline (there is no frame here) and timers never fire — the cockpit must be complete on
  // the synchronous path, which is also what a phone sees on the first paint.
  const timers = [];
  const win = { document: doc, innerHeight: 915, addEventListener() {}, removeEventListener() {},
                requestAnimationFrame(fn) { fn(); return 1; },
                setTimeout(fn) { timers.push(fn); return timers.length; },
                clearTimeout(id) { if (id) timers[id - 1] = null; } };
  win.window = win;
  new Function("window", "document", src)(win, doc);

  const host = makeNode("div"); doc.body.appendChild(host);
  const calls = [];
  const on = {};
  CALLBACKS.forEach((name) => { on[name] = (...args) => { calls.push([name, ...args]); }; });
  const view = win.MobileCockpit.mount(host, Object.assign({ on }, opts));
  const fired = (name) => calls.filter((c) => c[0] === name);
  const runTimers = () => { const due = timers.splice(0); due.forEach((fn) => { if (fn) fn(); }); };
  return { win, doc, host, view, calls, fired, on, runTimers };
}
function mounted(state = DEMO, opts = {}) {
  const b = boot(opts);
  b.view.setState(state);
  return b;
}

/* ---- the frame: one head row and a three-strip footer ----------------------------------------- */
test("mount builds one head row carrying the name, its ★, the connection and the context medallion", () => {
  const { host, view } = mounted();
  assert.equal(findAllIn(host, ".mc-head").length, 1,
    "a second head row is a second band of screen — the whole argument of this layout is that there is one");
  const head = findIn(host, ".mc-head");
  assert.ok(has(head, "Claudstermind · Main"), "the conversation you are in must be named without opening anything");
  assert.ok(has(head, "★"), "the ★ is how you tell this is the repository's main conversation rather than a side chat");
  assert.ok(has(head, "Live"), "connection is the one state that must always be legible; hiding it behind a reveal makes it undecidable");
  assert.ok(has(findIn(head, ".mc-ctx"), "21%"),
    "without the context number in the header you only discover the window is full when a turn fails");
  view.setState({ title: "Claudstermind · relay deploy", star: false });
  assert.ok(has(findIn(host, ".mc-head"), "relay deploy"), "the head must track setState, or it names last week's conversation");
  assert.ok(!has(findIn(host, ".mc-head"), "★"), "a stale ★ claims a side chat is the repository's main one");
});

test("a box that could not be measured is sized by the next paint, not the next keystroke", () => {
  // Two faults compounded here. Growth hung off the `input` event, so text the HOST wrote — a restored
  // draft, a queued prompt put back — landed in a box still one line tall (measured: height 40px
  // against a scrollHeight of 151). And when the box could not be measured at all, the attempt was
  // simply lost: nothing retried until you typed. That is the "sometimes" in "sometimes it's stuck at
  // a single line" — it depended on whether the box happened to be laid out at the instant the text
  // arrived. Sizing is now retried by the paint path, which runs constantly.
  const { host, view } = mounted();
  const box = findIn(host, ".mc-box");
  box.scrollHeight = 0;                                   // not laid out when the text arrives
  view.setState({ draft: "a draft long enough to need a second line" });
  assert.equal(box.value, "a draft long enough to need a second line", "the draft must reach the box regardless");
  assert.ok(box.style.height !== "0px", "an unmeasurable box must never be collapsed to nothing");

  box.scrollHeight = 48;                                  // laid out now — an ordinary, unrelated paint
  view.setState({ busy: true });
  assert.equal(box.style.height, "48px",
    "the box stayed one line tall while holding several lines of text, and only a keystroke would " +
    "have revealed them — the paint that could measure it must finish the job");
});

test("the box is never given a height that could not be measured", () => {
  // An element that is not laid out — host hidden behind a pane, a paint before first layout —
  // reports scrollHeight 0, and `Math.min(0, cap)` COLLAPSED the box to nothing instead of leaving it
  // alone. Measured: 0 while the host is display:none, 151 the moment it is shown again.
  const { host, view } = mounted();
  const box = findIn(host, ".mc-box");
  box.scrollHeight = 48;
  view.setState({ draft: "sized while visible" });
  assert.equal(box.style.height, "48px");
  box.scrollHeight = 0;                                   // now it cannot be measured
  view.setState({ draft: "written while the host is not laid out" });
  assert.equal(box.style.height, "48px",
    "an unmeasurable box must keep the height it had; writing 0 makes the field vanish, and nothing " +
    "recomputes it until the next keystroke");
});

test("the wrap button shows its threshold, dims when it cannot fire, and still answers", () => {
  // Core substitutes its own control into this slot — one that has always read "⟳ Wrap at 60%" and
  // dimmed itself. Pact renders this fallback, which said a flat "↺ Wrap" whatever the state, so a
  // button about to refuse looked identical to one about to work. Dimmed but PRESSABLE is deliberate:
  // a phone has no tooltip to hover, so the tap is how the reason reaches you.
  const { host, view, fired } = mounted();
  view.setState({ wrap: { can: false, label: "⟳ Wrap at 60%", note: "Too light to wrap (26% of 60%)." } });
  findIn(host, ".mc-running").fire("click");        // the Window section lives in the model sheet
  const wrapBtn = findAllIn(host, ".mc-btn").filter((b) => /Wrap/.test(b.textContent))[0];
  assert.ok(wrapBtn, "the wrap button must exist in the Window section");
  assert.equal(wrapBtn.textContent, "⟳ Wrap at 60%",
    "the threshold is the whole difference between 'not yet' and 'broken'");
  assert.match(wrapBtn.className, /--off/, "a button that will refuse must not look like one that will act");
  assert.ok(!wrapBtn.disabled,
    "disabling it would dim it and explain nothing — the tap is the only way a phone can ask why");
  wrapBtn.fire("click");
  assert.equal(fired("wrap").length, 1, "…so the tap must still reach the host, which answers with the reason");

  view.setState({ wrap: { can: true, label: "⟳ Wrap at 60%", note: "" } });
  findIn(host, ".mc-running").fire("click");
  const on = findAllIn(host, ".mc-btn").filter((b) => /Wrap/.test(b.textContent))[0];
  assert.ok(!/--off/.test(on.className), "the dimming must clear, or a usable action looks unavailable forever");
});

test("the auto switch carries its round number and the countdown to the next send", () => {
  // "We also need to show tied to the auto button the round number, and the timer to send the
  // recommended input. That's missing." The desktop package has had both on its send group since
  // auto-continue existed; the phone got the switch without them, so the loop counted down with
  // nothing on screen saying how many rounds it had spent or how long you had to stop it. A switch
  // you cannot audit is one you turn off.
  const { host, view } = mounted();
  const n = () => findIn(host, ".mc-auto-n");
  assert.ok(n(), "the counter must exist as its own node — text merged into the label cannot be styled while armed");

  view.setState({ running: { auto: { on: true, n: 3, max: 10, in: 7 } } });
  assert.equal(n().textContent, "3/10 · 7s",
    "armed, both numbers are the whole point: which round this is, and how long you have to stop it");
  assert.match(n().className, /--arm/,
    "a running countdown must read differently from a resting count, or the last second looks like the first");

  view.setState({ running: { auto: { on: true, n: 3, max: 10, in: null } } });
  assert.equal(n().textContent, "3/10",
    "not armed means there is no deadline to show — a stale '1s' claims a send is about to happen");
  assert.ok(!/--arm/.test(n().className), "the armed styling must clear, or every later state looks armed");

  view.setState({ running: { auto: { on: false, n: 3, max: 10, in: null } } });
  assert.equal(n().textContent, "",
    "switched off, the loop is not counting anything; a leftover 3/10 says it is still going");
});

test("the auto counter reads the running feed, and survives a state write that omits it", () => {
  // setState is a PATCH everywhere else in this module. If the counter only existed when a caller
  // happened to include `auto`, every unrelated write — a busy flag, a title — would blank it.
  const { host, view } = mounted();
  view.setState({ running: { auto: { on: true, n: 2, max: 10, in: 4 } } });
  assert.equal(findIn(host, ".mc-auto-n").textContent, "2/10 · 4s");
  view.setState({ busy: true });
  assert.equal(findIn(host, ".mc-auto-n").textContent, "2/10 · 4s",
    "an unrelated write erased the countdown — the number would flicker away on any repaint");
});

test("the compose row gives the type box the whole width, and nothing else sits in flow beside it", () => {
  const { host } = mounted();
  const compose = findIn(host, ".mc-compose");
  assert.ok(compose, "the type box needs its own strip; sharing one is what made the field narrow");
  const inFlow = compose.children.filter((c) => !c.classList.contains("mc-med"));   // the seam bulb is absolute
  assert.equal(inFlow.length, 1, "anything beside the field takes width from the thing you type into");
  assert.equal(inFlow[0].tagName, "TEXTAREA", "the one thing on that row must be the field itself");
  assert.ok(inFlow[0].classList.contains("rg-typebox"),
    "the type box must carry the package's scrollbar class, or the phone shows a second scrollbar design");
});

test("Stop keeps its slot beside Send and is disabled while nothing is running", () => {
  const { host, view, fired } = mounted();
  const row = findIn(host, ".mc-btnrow");
  const stop = findIn(row, ".mc-stp");
  assert.ok(stop, "a Stop that appears and vanishes moves Send sideways under a thumb mid-turn");
  assert.equal(stop.attrs["aria-disabled"], "true", "an armed-looking Stop with no turn to stop teaches you the button is broken");
  stop.fire("click");
  assert.equal(fired("stop").length, 0, "a disabled Stop that still fires interrupts a turn that was never running");
  view.setState({ busy: true });
  assert.equal(findIn(host, ".mc-stp").attrs["aria-disabled"], "false", "once a turn runs, Stop has to arm without the row reflowing");
  findIn(host, ".mc-stp").fire("click");
  assert.equal(fired("stop").length, 1, "Stop must reach the host — the cockpit cannot end a turn itself");
});

test("the button row is attach + auto + Stop + Send, and carries no ☰", () => {
  const { host, fired } = mounted();
  const row = findIn(host, ".mc-btnrow");
  assert.ok(!has(row, "☰"), "☰ opened the tree column, which on a phone IS the repository chooser the left pane already reaches");
  assert.ok(findIn(row, ".mc-snd") && findIn(row, ".mc-auto"), "Send and auto-continue belong together at the thumb end of the row");
  const attach = findIn(row, ".mc-ico");
  attach.fire("click");
  assert.equal(fired("attach").length, 1, "attach has nowhere else to be, and the host owns the file input");
  findIn(row, ".mc-auto").fire("click");
  assert.deepEqual(fired("autoContinue")[0], ["autoContinue", true], "the auto toggle must report the value it moved TO, not that it was pressed");
});

test("Send hands the host the text and clears the box only when the host does not veto", () => {
  const { host, view, fired } = mounted();
  const box = findIn(host, ".mc-box");
  box.value = "rework the mobile view";
  box.fire("input");
  assert.deepEqual(fired("input")[0], ["input", "rework the mobile view"], "the host cannot count lines or draft-save what it is never told");
  findIn(host, ".mc-snd").fire("click");
  assert.deepEqual(fired("send")[0], ["send", "rework the mobile view"], "the cockpit has no session to send to; the text must leave through the host");
  assert.equal(box.value, "", "a box that keeps the sent text sends it twice on the next press");
  view.setState({ busy: false });
});

test("a vetoed send keeps the prompt in the box", () => {
  // The host refuses when there is no session yet or the socket is down. Clearing the box anyway
  // destroys what was typed, with nothing sent and nothing said.
  const b = boot();
  b.on.send = () => false;
  b.view.setState(DEMO);
  const box = findIn(b.host, ".mc-box");
  box.value = "this must survive";
  findIn(b.host, ".mc-snd").fire("click");
  assert.equal(box.value, "this must survive", "a refused send that empties the box loses the prompt with no way to get it back");
});

test("the riser strip is two equal tabs around a readout that names model, effort and permission", () => {
  const { host } = mounted();
  const risers = findIn(host, ".mc-risers");
  const tabs = findAllIn(risers, ".mc-riser");
  assert.equal(tabs.length, 2, "Chats and Marks are the same control in two directions — a third tab is a different design");
  const widest = Math.max(tabs[0].offsetWidth, tabs[1].offsetWidth) + "px";
  assert.equal(tabs[0].style.width, widest, "unequal tabs read as a hierarchy that is not there — Chats and Marks are one control in two directions");
  assert.equal(tabs[1].style.width, widest,
    "…and the shared width must be the WIDER of the two, measured after the labels rendered: anything smaller clips a count, anything rounder wastes the readout's space");
  const readout = findIn(risers, ".mc-running");
  assert.equal(findAllIn(readout, "select").length, 0,
    "a strip saying Opus 5 beside a dropdown saying Opus 5 makes the difference between running and selected invisible");
  for (const part of ["Opus 5", "Default", "Bypass"])
    assert.ok(has(readout, part), `the readout must say ${part} — it is the only place what is RUNNING is stated`);
});

test("the seam bulb is a child of the compose row, not the button row, and jumps the transcript back to the bottom", () => {
  const { host, view, fired } = mounted();
  const compose = findIn(host, ".mc-compose");
  const bulb = findIn(compose, ".mc-med");
  assert.ok(bulb, "the bulb reports on the boundary between transcript and footer, so it belongs on that boundary");
  assert.equal(findAllIn(findIn(host, ".mc-btnrow"), ".mc-med").length, 0,
    "in the button row the bulb costs the row its middle, which is the width Stop and Send need");
  assert.ok(has(bulb, "Live"), "pinned to the bottom must read Live, or you cannot tell whether new turns will appear");
  bulb.fire("click");
  assert.equal(fired("jumpBottom").length, 1, "the host owns the transcript's scroll state; the bulb has to ask it");
  view.setState({ stick: false });
  assert.ok(has(findIn(host, ".mc-med"), "Held"), "a bulb that says Live while you are scrolled up is lying about where new turns go");
});

/* ---- the two reveals -------------------------------------------------------------------------- */
test("each rail opens its own pane, the other rail switches between them, and the scrim closes it", () => {
  const { host } = mounted();
  const low = findIn(host, ".mc-low");
  assert.equal(findAllIn(low, ".mc-rail").length, 2,
    "the rails hang off the seam at the INPUT level; over the transcript they cover a bubble and have to be paid for with a gutter");
  assert.equal(findAllIn(findIn(host, ".mc-core"), ".mc-rail").length, 0,
    "a rail inside the transcript is a rail drawn on top of what you are reading");
  findIn(host, ".mc-rail.--l").fire("click");
  assert.ok(findIn(host, ".mc-panel.--l").classList.contains("open"), "the left rail must actually reveal the chat's panel");
  findIn(host, ".mc-rail.--r").fire("click");
  assert.ok(findIn(host, ".mc-panel.--r").classList.contains("open"), "the right rail must reveal the conversation's panel");
  assert.ok(!findIn(host, ".mc-panel.--l").classList.contains("open"),
    "two open panels leave the transcript covered from both sides with no way to read it");
  findIn(host, ".mc-scrim").fire("click");
  assert.ok(!findIn(host, ".mc-panel.--r").classList.contains("open"),
    "tapping the dimmed area is the first dismissal everyone tries; without it the panel feels stuck");
});

test("the left pane names one repository and offers one way to change it", () => {
  const { host, view } = mounted();
  findIn(host, ".mc-rail.--l").fire("click");
  const panel = findIn(host, ".mc-panel.--l");
  assert.ok(has(panel, "Claudstermind"), "the pane must say which repository this chat box points at, or the conversations below it mean nothing");
  const btn = findAllIn(panel, ".mc-btn").find((b) => has(b, "Change repository"));
  assert.ok(btn, "thirty repositories is not a section of a panel — one button opens the page that lists them");
  btn.fire("click");
  assert.ok(findIn(host, ".mc-over"), "changing repository must open the chooser, not silently do nothing");
  view.setState({});
});

test("the left pane shows the ★ main alone until multi-chat is on, and the list scrolls on its own", () => {
  const { host, view, fired } = mounted();
  findIn(host, ".mc-rail.--l").fire("click");
  let panel = findIn(host, ".mc-panel.--l");
  const list = findIn(panel, ".mc-list");
  assert.ok(list, "a conversation list that grows the panel instead of scrolling pushes the History and Workspace sections off the screen");
  assert.ok(list.classList.contains("rg-core"), "…and it must carry the package's scrollbar, like every other scrolling surface here");
  assert.equal(findAllIn(list, ".mc-row").length, 1,
    "showing every conversation under a multi-chat toggle that is OFF invites the question what they are for");
  assert.ok(!has(panel, "Add conversation"), "nothing may offer to add to a list you have not opened");
  const tog = findAllIn(panel, ".mc-tog").find((t) => has(t, "multi-chat"));
  tog.fire("click");
  assert.deepEqual(fired("multiChat")[0], ["multiChat", true], "multi-chat is the host's setting; the cockpit cannot open a second session itself");
  view.setState({ multiChat: true });
  panel = findIn(host, ".mc-panel.--l");
  assert.equal(findAllIn(findIn(panel, ".mc-list"), ".mc-row").length, 2,
    "multi-chat is what reveals the repository's other conversations — if it reveals nothing the switch does nothing");
  assert.ok(has(panel, "Add conversation"), "…and what makes adding one meaningful");
  findAllIn(findIn(host, ".mc-panel.--l"), ".mc-row").find((r) => has(r, "mobile rework")).fire("click");
  assert.deepEqual(fired("pickConversation")[0], ["pickConversation", "c2"],
    "picking a conversation must name WHICH one — a callback with no address cannot open anything");
});

test("the left pane reaches History, and asks the host to load it", () => {
  const { host, fired } = mounted();
  findIn(host, ".mc-rail.--l").fire("click");
  const row = findAllIn(findIn(host, ".mc-panel.--l"), ".mc-row").find((r) => has(r, "All conversations"));
  assert.ok(row, "History is about this chat box, so the chat box's own panel is where you reach it");
  row.fire("click");
  assert.equal(fired("openHistory").length, 1,
    "the cockpit holds no archive; opening the page without asking the host for it shows an empty list forever");
  assert.ok(findIn(host, ".mc-over"), "…and the page itself must open, not wait for data that may already be there");
});

test("the left pane carries the workspace for the chosen conversation", () => {
  const { host, fired } = mounted();
  findIn(host, ".mc-rail.--l").fire("click");
  const panel = findIn(host, ".mc-panel.--l");
  assert.ok(has(panel, "main"), "a conversation whose worktree is not stated is a conversation you cannot tell apart from its sibling");
  findAllIn(panel, ".mc-btn").find((b) => has(b, "worktree")).fire("click");
  assert.equal(fired("pickWorktree").length, 1, "the worktree list is the host's — the cockpit cannot enumerate the disk");
});

test("the right pane is what this conversation has cost: the host's own chips, the context, the agents", () => {
  const b = boot();
  const chip = b.doc.createElement("span");
  chip.className = "chip"; chip.textContent = "731 / 1,000 turns";
  b.view.setState(Object.assign({}, DEMO, { stats: [chip] }));
  findIn(b.host, ".mc-rail.--r").fire("click");
  const panel = findIn(b.host, ".mc-panel.--r");
  assert.equal(findIn(panel, ".mc-chips").children[0], chip,
    "the chips must be the host's OWN nodes, re-homed — a second implementation of the stats row is a second thing to keep in step");
  assert.ok(has(panel, "Agents"), "the agents running underneath this conversation belong beside what it has cost");
  const agents = findAllIn(panel, ".mc-agent");
  assert.equal(agents.length, 2, "each agent is its own row, not a count in a sentence you cannot act on");
  assert.ok(agents.some((a) => a.classList.contains("--run")) && agents.some((a) => a.classList.contains("--done")),
    "a running agent that looks like a finished one is the one fact this pane exists to report");
  assert.equal(findAllIn(panel, ".mc-wheel").length, 0,
    "nothing you SET lives here — the readouts and the selectors were deliberately separated");
});

test("the running-agent count rides the rail that opens the pane listing them", () => {
  const { host, view } = mounted();
  const rail = findIn(host, ".mc-rail.--r");
  assert.equal(findIn(rail, ".mc-rail-n").textContent, "1",
    "the number AND the reason to press it, in the pixels the grip was using — and it is the RUNNING count, not the total");
  assert.ok(rail.classList.contains("--busy"), "…which also colours the rail, so 'is it working' is answerable without opening anything");
  view.setState({ agents: [] });
  assert.equal(findAllIn(findIn(host, ".mc-rail.--r"), ".mc-rail-n").length, 0,
    "a count that stays at 0 forever is furniture; it goes back to being a grip");
});

/* ---- the model sheet -------------------------------------------------------------------------- */
test("the middle riser pulls up a sheet of exactly three wheels, each under its own selection band", () => {
  const { host } = mounted();
  findIn(host, ".mc-running").fire("click");
  const sheet = findIn(host, ".mc-sheet");
  assert.ok(sheet, "the readout has to lead somewhere, or it is a label you learn to stop pressing");
  const wheels = findAllIn(sheet, ".mc-wheel");
  assert.equal(wheels.length, 3, "model + effort decide the answer and permission decides what it may do — a fourth wheel is a different design");
  for (const w of wheels) {
    assert.ok(findIn(w, ".mc-view"), "a wheel that does not scroll is a list, and a list of models on a phone is a 12px hit target");
    assert.ok(findIn(w, ".mc-band"), "without the fixed band nothing says which row is the value");
  }
  for (const must of ["ultracode", "auto-wrap", "Context", "Compact", "Wrap"])
    assert.ok(has(sheet, must), `"${must}" belongs to the window the agent runs in; leaving it out sends you back to the desktop for it`);
  for (const never of ["auto-continue", "Full", "Star", "History"])
    assert.ok(!has(sheet, never), `"${never}" is pane furniture, not an instruction to the agent — in this sheet it teaches the wrong grouping`);
});

test("a wheel settles on the option's VALUE, never on the label it shows", () => {
  // "Bypass" is what a phone reads; "bypassPermissions" is what the engine takes. The lab's wheel
  // reported textContent, which would hand the host the one word the engine does not know.
  const { host, fired } = mounted();
  findIn(host, ".mc-running").fire("click");
  const wheels = findAllIn(findIn(host, ".mc-sheet"), ".mc-wheel");
  const opt = findAllIn(wheels[0], ".mc-opt").find((o) => has(o, "Sonnet 4.5"));
  opt.fire("click");
  assert.deepEqual(fired("model")[0], ["model", "sonnet-4.5"], "a model change that sends the label changes nothing and reports success");
  findAllIn(wheels[2], ".mc-opt").find((o) => has(o, "Manual")).fire("click");
  assert.deepEqual(fired("permission")[0], ["permission", "default"], "the same for the permission mode, where the label and the value never match");
});

test("the sheet's switches and window buttons all leave through the host", () => {
  const { host, fired } = mounted();
  findIn(host, ".mc-running").fire("click");
  const sheet = findIn(host, ".mc-sheet");
  findAllIn(sheet, ".mc-tog").find((t) => has(t, "ultracode")).fire("click");
  assert.deepEqual(fired("ultracode")[0], ["ultracode", true], "ultracode forces effort to xhigh in the host; a cockpit-local flag would just be a lie on a screen");
  findAllIn(sheet, ".mc-tog").find((t) => has(t, "auto-wrap")).fire("click");
  assert.deepEqual(fired("autoWrap")[0], ["autoWrap", false], "auto-wrap must report the value it moved TO — DEMO has it on");
  findAllIn(sheet, ".mc-btn").find((b) => has(b, "Compact")).fire("click");
  assert.equal(fired("compact").length, 1, "Compact rewrites the window server-side; the cockpit cannot do it");
  findAllIn(sheet, ".mc-btn").find((b) => has(b, "Wrap")).fire("click");
  assert.equal(fired("wrap").length, 1, "…and neither can it wrap");
});

test("the two side risers are the two selectors: which CHAT BOX, and which mark inside it", () => {
  const { host, fired } = mounted();
  const tabs = findAllIn(findIn(host, ".mc-risers"), ".mc-riser");
  // "the chats on mobile shows 1, but there were 2 Main chat boxes opened" — it was counting the
  // threads of one repository and calling them chats.
  assert.ok(has(tabs[0], "Chats 2"), "the tab counts CHAT BOXES, not the conversations inside one of them");
  tabs[0].fire("click");
  let sheet = findIn(host, ".mc-sheet");
  assert.ok(has(sheet, "Claudstermind · Main") && has(sheet, "OuronetUI · dev"),
    "…and lists them across repositories, which is what makes it a different list from the left pane's");
  assert.ok(!has(sheet, "mobile rework"), "a thread of one repository is not a chat box and must not appear here");
  findAllIn(sheet, ".mc-row").find((r) => has(r, "OuronetUI")).fire("click");
  assert.deepEqual(fired("pickChat").map((c) => c[1]), ["p2"], "picking one switches to that box");
  tabs[0].fire("click");
  findAllIn(findIn(host, ".mc-sheet"), ".mc-btn").find((b) => has(b, "New chat")).fire("click");
  assert.equal(fired("newChat").length, 1, "offering a new chat that starts nothing is worse than not offering one");
  tabs[1].fire("click");
  sheet = findIn(host, ".mc-sheet");
  assert.ok(/R#6992|P#729/.test(sheet.textContent), "a mark is an ADDRESS on a turn — that is what makes it a mark and not a bookmark");
  assert.ok(has(sheet, "the wheel decision"), "…with the line you remember beside it");
  assert.ok(!/1787188479777/.test(sheet.textContent), "and never the opaque handle, which is what a raw timestamp read as");
  // A mark whose point is to take you back must actually take you back.
  findAllIn(sheet, ".mc-row").find((r) => has(r, "R#6992")).fire("click");
  assert.deepEqual(fired("pickMark").map((c) => c[1]), [1787188479777],
    "tapping a mark must hand the host the handle it can scroll to");
});

/* ---- the full-page surfaces ------------------------------------------------------------------- */
test("the context overlay names every part it is given, plus the free space", () => {
  const { host } = mounted();
  findIn(host, ".mc-ctx").fire("click");
  const over = findIn(host, ".mc-over");
  assert.ok(over, "'21%' says there is a problem and nothing about what is causing it — the breakdown is the answer, so it takes the page");
  assert.ok(findIn(over, ".mc-ctxbar"), "shares of one bar is how three numbers become a proportion you can read at a glance");
  const rows = findAllIn(over, ".mc-ctxrow");
  assert.equal(rows.length, 6, "five parts and the free space: a breakdown that omits what is left does not add up to the window");
  for (const part of ["Conversation", "Tool results", "File attachments", "System prompt + tools", "Memory (CLAUDE.md)", "Free"])
    assert.ok(has(over, part), `"${part}" must be named — an unnamed slice is a colour you cannot act on`);
  assert.ok(has(over, "14.8%"), "each slice must carry its own real share, or the bar is a drawing");
  assert.ok(has(over, "20.6%"), "…and the parts must total the figure the header medallion shows, or one of the two is lying");
});

test("the repository chooser groups by organisation and filters in place, saying how many of how many", () => {
  const { host, fired } = mounted();
  findIn(host, ".mc-rail.--l").fire("click");
  findAllIn(findIn(host, ".mc-panel.--l"), ".mc-btn").find((b) => has(b, "Change repository")).fire("click");
  let over = findIn(host, ".mc-over");
  assert.equal(findAllIn(over, ".mc-org").length, 3,
    "the Overview groups by organisation and a phone has no room to invent a second way of organising the same workspace");
  assert.ok(has(over, "@ancientpantheon"), "the scope is part of how an organisation is named everywhere else");
  assert.equal(findAllIn(over, ".mc-kind").length, 4, "every repository keeps its role badge — that is how a daimon is told from a seer");
  const find = findIn(over, ".mc-find");
  assert.ok(has(find, "4 of 4"), "without the count a filter can hide a repository and look like the list simply ended");
  const input = findIn(find, "input");
  input.value = "khron"; input.fire("input");
  over = findIn(host, ".mc-over");
  assert.equal(findAllIn(over, ".mc-org").length, 1, "an organisation with no match must disappear rather than show an empty card");
  assert.ok(has(findIn(over, ".mc-find"), "1 of 4"), "the count must follow the filter, or it is decoration");
  findIn(over, ".mc-repo").fire("click");
  assert.deepEqual(fired("pickRepo")[0], ["pickRepo", "AncientPantheon/constructors/Khronoton"],
    "the host moves the chat box; it needs the PATH, which is what makes two repositories of the same name distinguishable");
  assert.equal(findAllIn(host, ".mc-over").length, 0, "…and the chooser closes behind you, or you pick twice");
});

test("History carries both scopes, both of Open and Resume, and warns before you pick a gone worktree", () => {
  const { host, fired } = mounted();
  findIn(host, ".mc-rail.--l").fire("click");
  findAllIn(findIn(host, ".mc-panel.--l"), ".mc-row").find((r) => has(r, "All conversations")).fire("click");
  let over = findIn(host, ".mc-over");
  assert.ok(findIn(findIn(over, ".mc-find"), "input"), "history IS search — an archive you can only scroll is a list of things you already knew about");
  assert.ok(has(over, "This repository") && has(over, "All repositories"),
    "the sidebar column carried the scope toggle; a history page without it is a downgrade dressed as a rewrite");
  assert.equal(findAllIn(over, ".mc-hist").length, 2, "this repository's conversations by default, which is what you almost always want");
  assert.ok(has(over, "worktree removed"), "a conversation whose worktree is gone has to say so BEFORE you pick it, not after it fails to open");
  findAllIn(over, ".mc-btn").find((b) => has(b, "All repositories")).fire("click");
  over = findIn(host, ".mc-over");
  assert.equal(findAllIn(over, ".mc-hist").length, 3, "all repositories must be a WIDER list, not the same list relabelled");
  findAllIn(over, ".mc-hist")[0].querySelectorAll(".mc-btn")[0].fire("click");
  assert.deepEqual(fired("openConversation")[0], ["openConversation", "h1"], "Open must name the conversation it opens");
  assert.equal(findAllIn(host, ".mc-over").length, 0, "…and the page dismisses behind the choice, or you pick a second time");
  // Re-opened, it must still be on the scope you left it on: a page that silently resets to "this
  // repository" hides the conversation you were half-way through finding.
  findIn(host, ".mc-rail.--l").fire("click");
  findAllIn(findIn(host, ".mc-panel.--l"), ".mc-row").find((r) => has(r, "All conversations")).fire("click");
  over = findIn(host, ".mc-over");
  assert.equal(findAllIn(over, ".mc-hist").length, 3, "the scope you chose must survive re-opening the page");
  findAllIn(over, ".mc-hist").find((h) => has(h, "worktree removed")).querySelectorAll(".mc-btn")[1].fire("click");
  assert.deepEqual(fired("resumeConversation")[0], ["resumeConversation", "h2"],
    "Resume is not the same action as Open — it recreates the worktree, and the host is the only one that can");
});

/* ---- the turn actions ------------------------------------------------------------------------- */
/* The transcript is the HOST's element and the host's nodes — Core renders it, caches turn nodes in
   it and keys a fast path on their identity. So the cockpit is given the region and a way to ask
   "which turn is this, and what is its address", and nothing more. */
function withTranscript(state = DEMO) {
  const b = boot();
  b.view.setState(state);
  const core = findIn(b.host, ".mc-core");
  b.turn = (address) => {
    const n = b.doc.createElement("div");
    n.className = "ws-turn";
    n.setAttribute("data-mc-turn", address);
    core.appendChild(n);
    return n;
  };
  b.tap = (node) => core.fire("click", { target: node });
  return b;
}

test("tapping a bubble opens its own action row, and only ever one at a time", () => {
  const b = withTranscript();
  const first = b.turn("R6991"), second = b.turn("P729");
  assert.equal(findAllIn(b.host, ".mc-acts").length, 0,
    "four buttons on every bubble is ~30px times every turn on a phone — they have to start hidden");
  b.tap(first);
  assert.equal(findAllIn(b.host, ".mc-acts").length, 1, "a bubble that answers a tap with nothing teaches you the actions do not exist");
  assert.equal(findAllIn(first, ".mc-act").length, 4, "copy, reply, share, star — the four things you do to somebody else's turn");
  b.tap(second);
  assert.equal(findAllIn(first, ".mc-acts").length, 0, "a row left open on a turn you scrolled past is a row you will press by accident");
  assert.equal(findAllIn(second, ".mc-acts").length, 1, "…and the tapped turn is the one that opens");
  b.tap(second);
  assert.equal(findAllIn(b.host, ".mc-acts").length, 0, "tapping the same bubble again must put it away, or there is no way to close it");
});

test("each action leaves through its own callback, carrying that turn's address", () => {
  const b = withTranscript();
  const turn = b.turn("R6991");
  b.tap(turn);
  const acts = findAllIn(turn, ".mc-act");
  ["copyTurn", "replyTurn", "shareTurn", "starTurn"].forEach((name, i) => {
    acts[i].fire("click");
    assert.deepEqual(b.fired(name)[0], [name, "R6991"],
      `${name} must name the turn it acts on — the clipboard, the reply quote and the mark all belong to the host, and none of them can find a turn it was not told about`);
  });
});

test("the star shows what the host says is marked, not what was last pressed", () => {
  // Starring writes a mark server-side; a locally toggled star claims a mark that may never have
  // been written, and the right-hand riser then selects between marks the star disagrees with.
  const b = withTranscript();
  const turn = b.turn("R6992");
  b.tap(turn);
  assert.ok(findAllIn(turn, ".mc-act")[3].classList.contains("--on"),
    "DEMO already carries a mark on R6992 — an unlit star there offers to make a mark that exists");
  b.view.setState({ marks: [] });
  assert.ok(!findAllIn(turn, ".mc-act")[3].classList.contains("--on"),
    "when the host drops the mark the star must go out, or it is reporting its own memory");
});

test("a tap that lands on no turn opens nothing", () => {
  const b = withTranscript();
  b.turn("R6991");
  b.tap(findIn(b.host, ".mc-core"));
  assert.equal(findAllIn(b.host, ".mc-acts").length, 0,
    "scrolling the transcript ends in a tap on the gap between bubbles; opening a row there is the tap-vs-scroll bug wearing a different hat");
});

/* ---- the boundary itself ---------------------------------------------------------------------- */
test("a host that has wired nothing yet gets an inert cockpit, not a broken one", () => {
  // The switch this ships behind is flipped surface by surface, so every callback is optional by
  // construction — an unwired button must do nothing rather than throw and take the pane with it.
  const doc = makeNode("document");
  doc.createElement = (t) => makeNode(t);
  doc.createTextNode = (t) => { const n = makeNode("#text"); n._text = String(t); return n; };
  doc.body = makeNode("body"); doc.appendChild(doc.body);
  const win = { document: doc, addEventListener() {}, removeEventListener() {},
                requestAnimationFrame(fn) { fn(); return 1; }, setTimeout() { return 0; }, clearTimeout() {} };
  win.window = win;
  new Function("window", "document", src)(win, doc);
  const host = makeNode("div"); doc.body.appendChild(host);
  const view = win.MobileCockpit.mount(host, {});
  view.setState(DEMO);
  for (const sel of [".mc-snd", ".mc-stp", ".mc-ico", ".mc-auto", ".mc-med", ".mc-rail.--l", ".mc-rail.--r"])
    findIn(host, sel).fire("click");
  assert.ok(findIn(host, ".mc-head"), "the cockpit must still be standing after every control has been pressed with no host behind it");
});

test("destroy hands the transcript back rather than leaving with it", () => {
  const b = boot();
  const transcript = b.doc.createElement("div");
  b.host.appendChild(transcript);
  const view2 = b.win.MobileCockpit.mount(b.host, { transcript, on: b.on });
  assert.ok(transcript.classList.contains("mc-core"), "the adopted transcript is the cockpit's core — it is not rebuilt, it is moved");
  view2.destroy();
  assert.equal(transcript.parentNode, b.host,
    "a destroy that takes the host's transcript with it leaves the conversation off the screen and the host holding a detached node");
  assert.ok(!transcript.classList.contains("mc-core"), "…and it must be handed back as it was found, or the next mount inherits this one's classes");
});

test("a reconnection is an EVENT: it says so in words beside the connection, then clears itself", () => {
  // A permanent ↻ was read as a reload button, and a thing that has FINISHED happening does not
  // deserve a chip forever — it says so for a few seconds and then gets out of the 40px row.
  const b = mounted();
  b.view.setState({ connection: { text: "Live", tone: "ok", note: "↻ caught up" } });
  assert.ok(has(findIn(b.host, ".mc-head"), "caught up"),
    "a reconnection that is never announced leaves you wondering whether what you are reading is current");
  b.runTimers();
  assert.ok(!has(findIn(b.host, ".mc-head"), "caught up"),
    "…and one that stays becomes furniture: the head row is 40px and the connection is what it is for");
  assert.ok(has(findIn(b.host, ".mc-head"), "Live"), "clearing the event must not take the connection medallion with it");
});

test("a tap on a control INSIDE a bubble belongs to that control, not to the action row", () => {
  // Core renders its own buttons inside a turn — the ⧉ copy, the ★ bookmark, tool-call disclosures —
  // and this row's four live in there too. One delegated listener over the whole transcript would
  // swallow every one of them, and on touch it is worse than swallowed: the preventDefault that
  // suppresses the synthetic click also suppresses theirs.
  const b = withTranscript();
  const turn = b.turn("R6991");
  const inner = b.doc.createElement("button");
  turn.appendChild(inner);
  b.tap(inner);
  assert.equal(findAllIn(b.host, ".mc-acts").length, 0,
    "opening the action row on top of the button you actually pressed makes the host's own in-bubble controls unreachable");
  b.tap(turn);
  assert.equal(findAllIn(turn, ".mc-acts").length, 1, "…while a tap on the bubble itself must still open it");
});

/* ---- role substitution: what lets the host re-home the package's OWN controls ------------------ */
test("a host's own control for a role is mounted AT that role, and the native one is never built", () => {
  // A7: every control that leaves the header or footer is the package's own node, re-homed — with
  // every listener already on it — not a lookalike this module builds. The alternative that was
  // tried and can be seen going wrong is mounting both and hiding one: two implementations of the
  // same setting on one screen, drifting from the first change to either.
  const hostSel = makeNode("select");
  hostSel.className = "sel"; hostSel.textContent = "Opus 5";
  const b = boot({ slots: { model: hostSel } });
  b.view.setState(DEMO);
  findIn(b.host, ".mc-running").fire("click");
  const sheet = findIn(b.host, ".mc-sheet");
  assert.equal(findAllIn(sheet, ".mc-wheel").length, 2,
    "a substituted role must REPLACE the cockpit's wheel, not sit next to it — two model pickers in one sheet is the bug this avoids");
  assert.ok(findAllIn(sheet, "select").includes(hostSel),
    "…and the host's node must actually be in the sheet, or the setting it carries is unreachable on a phone");
  assert.equal(findIn(sheet, ".mc-wheels").children[0], hostSel, "…at the model's own position, first, where the eye already goes");
});

test("the compose slot is the only thing allowed beside the type box, and only when a host asks", () => {
  // The reply cue belongs above the field, because a reply is part of the message you are composing —
  // but the chat-shell package already owns reply chips, so this is a slot for THAT node rather than
  // a second reply implementation.
  const cue = makeNode("div");
  const b = boot({ slots: { composeExtra: [cue] } });
  b.view.setState(DEMO);
  const compose = findIn(b.host, ".mc-compose");
  const inFlow = compose.children.filter((c) => !c.classList.contains("mc-med"));
  assert.deepEqual(inFlow, [cue, findIn(b.host, ".mc-box")],
    "a reply cue below the field reads as an ordinary message; it has to sit above the box, and the box stays last");
});

test("the host may name the turns itself, because Core's transcript nodes are not this module's", () => {
  // Core renders `.ws-turn` containers and stamps each message with its own absolute P#/R# number.
  // Requiring it to also write a `data-mc-turn` attribute onto nodes it caches and reuses would put
  // this module's vocabulary inside the host's renderer; a resolver keeps the knowledge where it is.
  const turn = makeNode("div");
  turn.className = "ws-turn";   // Core's own class, carrying no attribute this module invented
  const b = boot({ turnAt: (node) => (node === turn ? { node: turn, address: "R949" } : null) });
  b.view.setState(DEMO);
  findIn(b.host, ".mc-core").appendChild(turn);
  findIn(b.host, ".mc-core").fire("click", { target: turn });
  assert.equal(findAllIn(turn, ".mc-acts").length, 1, "a host resolver that is ignored means no turn is ever actionable in production");
  findAllIn(turn, ".mc-act")[0].fire("click");
  assert.deepEqual(b.fired("copyTurn")[0], ["copyTurn", "R949"],
    "…and the address must be the host's own, or `recall` is handed a reference that resolves to nothing");
});

test("every surface dismisses by its ✕ and by Escape, not only by the scrim", () => {
  // A8. On a phone Escape is the back gesture, and a surface that only closes by a scrim you cannot
  // see the edge of is a surface people force-reload out of.
  const { host, doc } = mounted();
  findIn(host, ".mc-running").fire("click");
  findIn(findIn(host, ".mc-sheet"), ".mc-px").fire("click");
  assert.equal(findAllIn(host, ".mc-sheet").length, 0, "the ✕ on a sheet is the dismissal that is actually visible");
  findIn(host, ".mc-ctx").fire("click");
  doc.fire("keydown", { key: "Escape" });
  assert.equal(findAllIn(host, ".mc-over").length, 0, "Escape — the phone's back gesture — must close the page it opened");
  findIn(host, ".mc-rail.--l").fire("click");
  doc.fire("keydown", { key: "Escape" });
  assert.ok(!findIn(host, ".mc-panel.--l").classList.contains("open"), "…and the pane underneath it, once the page is gone");
});

test("the riser widths follow a changed count, not only the first paint", () => {
  // "Chats 8" is wider than "Chats 3", and the pair is only equal-and-minimal if the measurement is
  // redone when a label changes. Fitting once at mount leaves the wider label clipped for the rest
  // of the session.
  const { host, view } = mounted();
  const before = findAllIn(findIn(host, ".mc-risers"), ".mc-riser")[0].style.width;
  view.setState({ marks: new Array(1234).fill(0).map((_, i) => ({ at: "R" + i, note: "n" })) });
  const tabs = findAllIn(findIn(host, ".mc-risers"), ".mc-riser");
  const widest = Math.max(tabs[0].offsetWidth, tabs[1].offsetWidth) + "px";
  assert.ok(parseInt(tabs[1].style.width, 10) > parseInt(before, 10),
    "a count that outgrew its tab must re-measure, or the tab clips its own number for the rest of the session");
  assert.equal(tabs[0].style.width, widest, "…and both tabs stay at the wider of the two");
  assert.equal(tabs[1].style.width, widest, "…so they never read as a hierarchy");
});

test("the auto-continue toggle shows the loop's real state and can switch it back OFF", () => {
  // It is the one control in the button row with a state, and it sits next to Send: if it cannot
  // report "off" you can arm an unattended loop of ten rounds and have no way to stop arming it.
  const { host, view, fired } = mounted();
  view.setState({ running: { autoContinue: true } });
  const auto = findIn(host, ".mc-auto");
  assert.ok(auto.classList.contains("on"), "an armed loop that looks idle is the one state in this row you must not have to guess");
  auto.fire("click");
  assert.deepEqual(fired("autoContinue")[0], ["autoContinue", false], "pressing an ON toggle must ask for OFF, or the loop cannot be stopped from here");
  view.setState({ running: { autoContinue: false } });
  assert.ok(!findIn(host, ".mc-auto").classList.contains("on"), "…and the host's answer is what the button then shows");
});

test("a surface closes when its own button has fired", () => {
  // "when clicking compact it should also close that pane that has the compact button." Compact acts
  // immediately and its result is the transcript behind you; Wrap opens a confirmation that would
  // otherwise appear UNDER the sheet that launched it. Either way the surface has done its job.
  const { host, view, fired } = mounted();
  findIn(host, ".mc-running").fire("click");
  assert.ok(findIn(host, ".mc-sheet"), "the model sheet is open");
  findAllIn(findIn(host, ".mc-sheet"), ".mc-btn").find((b) => has(b, "Compact")).fire("click");
  assert.equal(fired("compact").length, 1, "the host is still told to compact");
  assert.ok(!findIn(host, ".mc-sheet"), "…and the sheet that asked for it is gone");
  // Same on the context page, whose buttons change the very thing it is describing.
  findIn(host, ".mc-ctx").fire("click");
  assert.ok(findIn(host, ".mc-over"), "the breakdown is open");
  findAllIn(findIn(host, ".mc-over"), ".mc-btn").find((b) => has(b, "Wrap")).fire("click");
  assert.equal(fired("wrap").length, 1);
  assert.ok(!findIn(host, ".mc-over"), "…and it closes rather than describing a window it just changed");
});

test("a host whose own control was re-homed into a sheet can dismiss it", () => {
  // Core's Compact/Wrap are the chat-shell package's real split control, moved into the model sheet.
  // The cockpit never sees that node's clicks — they belong to the host — so it cannot know the
  // surface is finished, and needs to be told.
  const { view } = mounted();
  assert.equal(typeof view.closeSheet, "function", "…which is what this exists for");
  assert.equal(typeof view.closeOverlay, "function");
});

test("opening a reveal dismisses the keyboard, and closing one does not steal focus back", () => {
  // "if the cursor is in the type space, and I open panes, mobile keyboard also opens … opening the
  // pane with the keyboard open makes the pane lose size and I don't see anything." The browser
  // would normally drop focus when you tap elsewhere — `onTap` calls preventDefault() on the touch
  // (the ghost-tap guard), which is precisely what suppresses that.
  const { host, doc, view } = mounted();
  const box = findIn(host, ".mc-box");
  let blurred = 0;
  box.blur = () => { blurred++; doc.activeElement = doc.body; };
  const focusBox = () => { doc.activeElement = box; };

  focusBox();
  findIn(host, ".mc-rail.--l").fire("click");
  assert.equal(blurred, 1, "opening a pane must take the focus, or it renders into half a screen");

  focusBox();
  findIn(host, ".mc-running").fire("click");
  assert.equal(blurred, 2, "…and so must a sheet");

  focusBox();
  findIn(host, ".mc-ctx").fire("click");
  assert.equal(blurred, 3, "…and a full-page overlay");

  // Closing is the host's business: blurring there would fight a caller that wants the caret back,
  // and refocusing is never this component's decision.
  focusBox();
  const before = blurred;
  view.closeSheet();
  assert.equal(blurred, before, "closing must not touch focus at all");
});
