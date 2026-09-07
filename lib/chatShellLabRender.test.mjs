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
const pkgDir = join(__dir, "..", "packages", "claude-chat-shell", "src");
const shellJs = readFileSync(join(pkgDir, "chat-shell.js"), "utf8");
// The lab is a CONSUMER of the package now — it owns no chat-box markup of its own, so evaluating
// its script without the package present would just throw on the first mount() call. Loading the
// real UI file here is the point: this test now exercises the exact code production runs, not a
// lab-only reimplementation of it.
const shellUiJs = readFileSync(join(pkgDir, "chat-shell-ui.js"), "utf8");
const prodCss = readFileSync(join(__dir, "..", "dashboard", "public", "styles.css"), "utf8");
// The Lab's COMPONENT css (chips, bubbles, turn tags, the gutter, the type box, the split control)
// no longer lives in chat-shell-lab.html's own <style> block — it was moved verbatim into
// dashboard/public/chat-shell-components.css, which the Lab <link>s and production loads too, so
// there is exactly ONE copy of it instead of the Lab's and production's two. Assertions about what
// the Lab LOOKS like therefore have to read the shared file as well as the page.
// `labCss` collapses whitespace around CSS punctuation so the existing tight assertions
// (`.msgacts{top:-10px`) match the shared file's readable formatting — the rule is what is being
// asserted, never how it happens to be indented.
const componentsCss = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "components.css"), "utf8");
const frameCss = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "frame.css"), "utf8");
const labCss = (html + "\n" + componentsCss + "\n" + frameCss)
  .replace(/\s*([{}:;,])\s*/g, "$1")
  .replace(/;\}/g, "}")
  .replace(/\.cs-shell /g, "");
const sdkDts = readFileSync(join(__dir, "..", "node_modules", "@anthropic-ai", "claude-agent-sdk", "sdk.d.ts"), "utf8");

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
    getBoundingClientRect() { return { top: 0, left: 0, width: 900, height: 600, right: 900, bottom: 600 }; },
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
    if (!n.attrs) return false;   // text nodes (createTextNode) carry no attrs — not an element to match
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
    getElementById: (id) => findIn(body, "#" + id),
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
  new Function("window", shellUiJs)(win);        // …and window.ChatShellUI, the drop-in chat box

  const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
  new Function("window", "document", "ChatShell", "ChatShellUI", script
    + "\nwindow.__S = S; window.__runEvent = runEvent; window.__render = render;"
    + "\nwindow.__advanceStream = advanceStream; window.__mdRender = mdRender;")(win, doc, win.ChatShell, win.ChatShellUI);
  return {
    body, doc, S: win.__S, runEvent: win.__runEvent, render: win.__render,
    advanceStream: win.__advanceStream, mdRender: win.__mdRender,
  };
}
// Every node's text, gathered recursively — the shim does not aggregate textContent up the tree, so a
// plain node.textContent check misses anything built from nested el() calls (a round-19 lesson).
function textOf(n) {
  if (!n) return "";
  if (n.tagName === "#text") return n.textContent || "";
  return (n.textContent || "") + (n.children || []).map(textOf).join("");
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
  // The lab's chosen ceiling has to reach the shared maths, not stop at the lab's own state object.
  assert.ok(html.includes("maxTurns: S.maxTurns"), "the lab must pass its chosen ceiling into the package's stats patch");
  assert.ok(shellUiJs.includes("CS.buildStatsChips(s.stats)"), "…and the package must hand that patch straight to the shared builder");
  assert.ok(shellJs.includes("rollTriggers("), "…which is what feeds rollTriggers");
});

test("Live/Held is observed from the scroll position, not toggled by hand", () => {
  assert.ok(shellUiJs.includes('core.addEventListener("scroll"'), "the marker must be driven by real scrolling");
  assert.ok(shellUiJs.includes("core.scrollHeight - core.scrollTop - core.clientHeight"), "…measured at the bottom edge");
  assert.ok(shellUiJs.includes("function paintBulb()"), "and repainted alone, never via a full rebuild");
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
  // "93,016 / 1000k" made you convert the ceiling in your head to compare the two numbers.
  assert.ok(shellUiJs.includes('tk.toLocaleString() + " / " + cap.toLocaleString()'),
    "the ceiling must be formatted like the used figure, not shortened to 'k'");
  assert.ok(!/ceiling \/ 1000/.test(shellUiJs), "…and never divided down to a 'k' label");
});

test("the image strip is present at every footer height", () => {
  // It used to collapse, so the evidence that you had attached images vanished exactly while writing
  // the long prompt those images belong to. The package's collapse steps declare it frees nothing.
  assert.ok(shellJs.includes('COLLAPSE_STEPS'), "the collapse order must be declared in one place");
  assert.ok(!/collapsed\.imageStrip/.test(shellUiJs), "nothing may branch on an imageStrip collapse");
  assert.ok(shellUiJs.includes('{ id: "imageStrip", frees:'),
    "the strip must be measured honestly — declaring what it frees, which is nothing when it is shown");
});

test("bookmark and share sit beside the turn medallion and are always visible", () => {
  assert.ok(/\.msgacts\{[^}]*top:-10px/.test(labCss), "actions must sit on the bubble's top edge, level with the P#/R# pill");
  assert.ok(!/\.msgacts\{[^}]*opacity:0/.test(labCss), "they must not be hidden until hover — that hides which answers are bookmarked");
  assert.ok(labCss.includes(".msg.--a .msgacts{left:") && labCss.includes(".msg.--u .msgacts{right:"),
    "answers put them beside the R# pill on the left, prompts beside the P# pill on the right");
});

test("a bookmark can be removed from the bookmark list itself", () => {
  assert.ok(html.includes("delete S.bm[BM_TAB + n]"), "the list must offer removal");
  assert.ok(html.includes("bookmarked yet"), "and say so when a tab is empty, rather than showing an empty box");
  // Two tabs: answers and prompts are looked for in different moods — "what did it say" vs "what did I ask".
  assert.ok(html.includes('var BM_TAB = "R"'), "the list must be tabbed by kind");
  assert.ok(html.includes('mk("R", "\\u2605 Answers"') && html.includes('mk("P", "\\u2605 Prompts"'), "both tabs must exist");
});

test("each popup sets its OWN title, so one cannot inherit the other's", () => {
  const m = html.match(/pophd span"\)\.textContent = /g) || [];
  assert.ok(m.length >= 2, "both openBm and openWrap must set the heading");
  const bm = html.slice(html.indexOf("function openBm"), html.indexOf("function render"));
  assert.ok(!bm.includes("Wrap conversation"), "openBm must not still carry a stray wrap title");
});

test("prompt-state HUES match production; the tint strength is a deliberate proposal", () => {
  // The hues are production's and must stay in lockstep — if styles.css changes one, this goes red.
  // The TINT is deliberately stronger than production's 16%: on the darker Core surface 16% read as a
  // dark box with coloured text rather than an orange message, and a state colour that has to be read
  // instead of recognised is not doing its job. This is a proposal for production to adopt, recorded
  // here so it is a decision rather than drift.
  for (const [hex, what] of [["#f59e0b", "queued"], ["#f472b6", "queued behind deep work"], ["#3b5bbf", "interrupted"]]) {
    assert.ok(prodCss.includes(hex), `production no longer uses ${hex} for ${what} — the lab is now stale`);
    assert.ok(labCss.includes(hex), `the lab is missing the production hue ${hex} for ${what}`);
  }
  // The bubble must carry the state, not just its label.
  // The bubble must carry the state, not just its label — and must beat the generic .msg.--u styling,
  // which has equal specificity, so the winner would otherwise depend on source order.
  assert.ok(/\.msg\.--u\.--queued\{background:#4a3410;border:2px solid #f59e0b/.test(labCss),
    "queued must be a warm orange field with a solid orange border, at .msg.--u.--queued specificity");
  assert.ok(/\.msg\.--u\.--discarded\{background:#4a1214;border:2px solid #ef4444/.test(labCss),
    "discarded must be a red field with a red border");
  assert.ok(!/\.msg\.--queued\{/.test(labCss), "the weaker two-class selector must be gone");
  // KNOWN, INTENTIONAL divergence: production's discarded red (#3a0d0d/#7f1d1d) is near-black at this
  // size. The lab proposes #b91c1c/#ef4444. Listed explicitly so it cannot pass for an accident.
  assert.ok(labCss.includes("#ef4444"), "the lab's brighter discarded red is the proposed value");
  assert.ok(prodCss.includes("#7f1d1d"), "production still holds the old value — this divergence is OPEN");
});

test("a queued message shows its attached images and its status line last", () => {
  // Production builds: bold "you" label, image thumbnails, the text, then the queued tag (app.js ~11493).
  assert.ok(html.includes('el("b", { class: "who" }, ["you"])'), "the 'you' label is missing");
  assert.ok(html.includes('class: "msgimgs"'), "a queued message must carry its attached images");
  assert.ok(html.includes("queued \\u2014 sending once this turn finishes"), "production's single-queue wording");
  assert.ok(html.includes("will be merged with the other"), "…and its merge wording, since several queued messages go out as ONE prompt");
});

test("the type box can actually shrink: the gutter is out of its sizing path", () => {
  // It was a flex sibling under align-items:stretch, so the textarea was stretched to a container
  // height that was itself derived from the textarea. `height:auto` could never shrink it, and the box
  // stayed tall after the text was deleted.
  assert.ok(!/\.tawrap\{[^}]*display:flex/.test(labCss), ".tawrap must not be flex — that stretches the textarea");
  assert.ok(/\.gutter\{[^}]*position:absolute/.test(labCss), "the gutter must be absolutely positioned, outside the sizing path");
  assert.ok(!/g\.style\.height = ta\.style\.height/.test(labCss), "the gutter must not take its height from the textarea");
});

test("an empty type box is ONE line, not the browser's default two", () => {
  assert.ok(shellUiJs.includes('el("textarea", { rows: "1"'), "a <textarea> defaults to rows=2 — it must be set explicitly");
});

test("the gutter distinguishes written lines from empty slots", () => {
  // The gutter's numbering LOGIC now lives in the shared CS.paintGutter (chat-shell.js) — Core and
  // Pact call the exact same function. Only the CSS (which the Lab still owns visually, unchanged)
  // is checked against the page itself.
  assert.ok(labCss.includes(".gutter b{") && labCss.includes(".gutter b.--on{"), "two number styles must exist");
  // The numbering BEHAVIOUR is asserted by running the real function against a DOM — see
  // lib/chatShellGutter.test.mjs (which lines, which rows, which classes). What is checked here is
  // only what the Lab page itself owns: that the two number styles exist to be applied.
  assert.ok(shellJs.includes('el("b", { class: e.on ? "--on" : "" }'), "written lines get the bright class, the rest stay dim");
  assert.ok(shellJs.includes('var lines = val ? val.split("\\n") : [];'), "an empty box has typed zero lines, not one");
});

test("text and ghost both clear the gutter column", () => {
  // The ghost suggestion was rendering underneath the numbers.
  assert.ok(/\.rg-typebox,[^{]*\.cs-ghost\{padding-left:/.test(labCss),
    "both the textarea and the ghost overlay must be padded past the gutter");
  // …and the ghost must be transparent, or a host app's own `.ghost` class paints over your typing.
  assert.ok(/\.cs-ghost\{[^}]*background:transparent/.test(labCss),
    "the overlay must not be able to hide the text underneath it");
});

test("prompts are bookmarkable and shareable, not only answers", () => {
  // Only answers were, which is backwards for the common case: you far more often want to find the
  // QUESTION you asked than the reply it produced.
  assert.ok(html.includes('mkMsgActs("P"'), "prompts must get the action pair");
  assert.ok(html.includes('mkMsgActs("R"'), "answers keep theirs");
  assert.ok(html.includes("function mkMsgActs(kind, n)"), "bookmarks must be keyed by kind, not by number alone");
});

test("the gutter column widens with the number of digits", () => {
  // Same shared-function move as above — this math lives in CS.paintGutter now.
  assert.ok(shellJs.includes("var w = 14 + String(maxN).length * 7;"), "width must follow the widest number shown");
  assert.ok(shellJs.includes('gut.style.width = w + "px"'), "…and actually be applied");
  assert.ok(shellJs.includes('ta.style.paddingLeft = (w + 10)'), "…with the text kept clear of the divider");
});

test("effort levels match the SDK exactly — there is no 'default' effort", () => {
  const levels = ["low", "medium", "high", "xhigh", "max"];
  assert.ok(shellUiJs.includes('["low", "medium", "high", "xhigh", "max"]'), "the package must offer exactly those five");
  assert.ok(!/"effort: default"/.test(shellUiJs), "there is no 'default' effort LEVEL in the SDK");
  for (const lv of levels) assert.ok(sdkDts.includes(`'${lv}'`), `${lv} must be a real SDK effort level`);
});

test("ultracode is modelled as the separate flag the SDK says it is, not an effort level", () => {
  assert.ok(shellUiJs.includes('var ultraCb = el("input", { type: "checkbox"'), "ultracode must be a checkbox, not an effort option");
  assert.ok(shellUiJs.includes('effortSel.value = "xhigh"'), "…which forces xhigh, as the SDK describes");
  assert.ok(shellUiJs.includes("effortSel.disabled = ultraCb.checked"), "…and locks the level while it is on");
});

test("dictation is NOT offered — dropped by decision, and the SDK could not have provided it anyway", () => {
  // Recorded rather than silently absent: the Agent SDK exposes no audio/microphone/transcription API,
  // so this could only ever have been a browser (Web Speech) feature. Dropped on request.
  assert.ok(!html.includes("SpeechRecognition"), "the dictation button was removed");
  assert.ok(!/id: "f-mic"/.test(html), "…and so was its control");
});


test("the context readout in the FOOTER (not just its tooltip) uses thousand separators", () => {
  // An earlier fix only reached the tooltip, so it passed while the visible label still read "1000k".
  assert.ok(shellUiJs.includes('txt(ctxBtn, tk.toLocaleString() + " / " + cap.toLocaleString()'),
    "both figures must be formatted in the label itself, not only the title");
});

test("the two workspace themes actually switch", () => {
  // The Pact handler set data-theme to "pact" and then back to "core" on the same line (a double patch),
  // so Pact never rendered in its own palette.
  const pact = html.slice(html.indexOf('$("#wPact").onclick'), html.indexOf('$("#wPact").onclick') + 240);
  assert.ok(pact.includes('dataset.theme = "pact"'), "Pact must select the pact theme");
  assert.ok(!pact.includes('dataset.theme = "core"'), "…and must not immediately reset it to core");
  // Both palettes now live in chat-shell-theme.css (shared with production), not in this file's own
  // <style> block — so "both palettes exist" is proven by the lab actually linking that file, not by
  // finding the CSS blocks inline here (see lib/chatShellPaletteMatch.test.mjs for the palette itself).
  assert.ok(html.includes('<link rel="stylesheet" href="/chat-shell/chat-shell.css">'),
    "the lab must link the package's stylesheet, which is where both palettes live");
});

test("compaction is a REAL engine event and the lab models it faithfully", () => {
  // The SDK emits SDKCompactBoundaryMessage { trigger: 'manual'|'auto', pre_tokens, post_tokens } and
  // lib/claudeSession.mjs already translates it to { kind:"compacted", trigger, preTokens, postTokens }.
  // So a compaction genuinely happens when the window fills, whether or not auto-wrap is on.
  assert.ok(sdkDts.includes("subtype: 'compact_boundary'"), "the SDK still emits a compaction boundary");
  assert.ok(sdkDts.includes("trigger: 'manual' | 'auto'"), "…with the trigger the lab labels markers by");
  assert.ok(html.includes("preTokens") && html.includes("postTokens"), "the lab records before/after tokens");
});

test("compact and wrap markers are RECORDED, so they can be drawn where they happened", () => {
  // A line can only be rendered at a position if something says the event occurred there.
  assert.ok(html.includes("marks: []"), "there must be a recorded event list");
  assert.ok(html.includes("afterRound"), "each mark must pin itself to a round");
  assert.ok(html.includes("function mkMark(mk)"), "and there must be a renderer for it");
  // Different weights on purpose: routine housekeeping vs a boundary you will want to find again.
  assert.ok(/\.mark\.--compact::before\{border-top:1px dashed/.test(labCss), "compact is a thin dashed rule");
  assert.ok(/\.mark\.--wrap::before\{border-top:3px double/.test(labCss), "wrap is a heavier double rule");
});

test("the session's compaction COUNT is surfaced, with why it matters", () => {
  assert.ok(html.includes('mk.kind === "compact"'), "compactions must be counted");
  // The explanatory copy moved into the shared CS.buildStatsChips (chat-shell.js) — Core and Pact
  // show the exact same sentence now instead of three independently-worded copies.
  assert.ok(shellJs.includes("wrapping is what actually clears it"), "…and explain that compaction leaves luggage a wrap would clear");
});

test("a running compact/wrap shows progress in flow, not as a floating dialog", () => {
  assert.ok(html.includes("busyband"), "there must be a progress band");
  assert.ok(html.includes("nothing is deleted"), "…which reassures rather than just spinning");
  assert.ok(html.includes('function runEvent(kind)'), "and it must be drivable in the lab");
});

test("dialogs are scoped to the CHAT BOX, not the viewport", () => {
  // `position: fixed` centred them on the page, so in a multi-pane cockpit a pane's own dialog would
  // appear far from the pane that raised it.
  // Re-parenting them into the shell on every rebuild made their visibility depend on build order and
  // on replaceChildren not having orphaned them — a whole class of "the class is set, nothing appears".
  // They stay in the body and are pinned to the shell's bounding box instead: scoped just as tightly,
  // but impossible to detach.
  assert.ok(html.includes("function openPop(sel)"), "there must be one scoped opener");
  assert.ok(html.includes("sh.getBoundingClientRect"), "…which pins the overlay to the shell's rectangle");
  assert.ok(!html.includes('["#ctxpop", "#wrappop", "#hist"].forEach'), "dialogs must NOT be re-parented any more");
  // exactly one place may set --open: openPop itself
  assert.equal((html.match(/classList\.add\("--open"\)/g) || []).length, 1,
    "only openPop may set --open, so no caller can bypass the scoping");
  const { doc } = runLab();
  for (const id of ["ctxpop", "wrappop", "hist"]) assert.ok(doc.querySelector("#" + id), `#${id} must exist`);
});

test("the chat box takes all the width offered, and its dialogs fit a narrow pane", () => {
  // The cockpit runs four panes side by side; a fixed max-width would misrepresent the space it runs in.
  assert.ok(!/#shell\{[^}]*max-width:960px/.test(html), "the shell must not be pinned to a fixed width");
  assert.ok(html.includes('shell.style.maxWidth = S.width ? S.width'), "width must be simulatable");
  assert.ok(/\.popbox\{width:min\(460px,calc\(100% - 20px\)\)/.test(html), "a dialog must never exceed its pane");
  assert.ok(/\.histbox\{width:min\(520px/.test(html), "…including the history popup");
});

test("Compact and Wrap are ONE split control — the two answers to the same question", () => {
  assert.ok(shellUiJs.includes("CS.buildWrapControls({"), "the package must build the control through the shared function");
  assert.ok(shellJs.includes('class: o.splitClass || "split"'), "…which joins the two buttons into one control");
  assert.ok(/\.split \.splitL\{[^}]*border-right-width:0/.test(labCss), "the divider must be a shared border, not two adjacent buttons");
});

test("the wrap preview states what a wrap actually IS, since the word is ambiguous", () => {
  // workspace.mjs _maybeRoll keeps the store keyed by the SAME conversation: the display and numbering
  // are unbroken, only the engine session is respawned with a seed. It is not "close and start a new chat".
  assert.ok(html.includes("This stays ONE conversation"), "it must say the conversation is not replaced");
  assert.ok(html.includes("do NOT become a separate conversation"), "…nor does the archived head appear in history");
  assert.ok(html.includes("archived verbatim as segment #"), "…and the head is archived as a numbered segment");
});

test("a wrap cannot be triggered by a misclick", () => {
  // A preview alone is not a gate: a double-click on the bar's Wrap button lands the second click on
  // the confirm the instant the popup paints, collapsing two steps into one.
  assert.ok(html.includes("go.disabled = true"), "the confirm must start disabled");
  assert.ok(/setTimeout\(function \(\) \{ go\.disabled = false/.test(html), "…and only arm after a beat");
  assert.ok(html.includes('var cancel = el("button", {}, ["Cancel"])'), "there must be an explicit Cancel");
  assert.ok(html.includes('e.key !== "Escape"') === false || html.includes('if (e.key !== "Escape") return;'),
    "Escape must also close the dialog — a gate with no exit is a trap");
  // Every path to a wrap goes through the gate, including the rail's mock button.
  assert.ok(!/\$\("#simWrap"\)\.onclick = function \(\) \{ runEvent\("wrap"\)/.test(html),
    "the mock must not bypass the confirmation — that would test a flow that does not exist");
  // The rail button now fills the window first (a wrap is correctly refused at 9%), but it must still
  // finish by opening the CONFIRM rather than wrapping directly.
  const rail = html.slice(html.indexOf('$("#simWrap").onclick'), html.indexOf('$("#simWrap").onclick') + 600);
  assert.ok(rail.includes("openWrap();"), "the rail button must end at the confirm dialog");
  assert.ok(!rail.includes('runEvent("wrap")'), "…and must never wrap without asking");
});

test("a wrap is counted exactly once, on each of its three legitimate paths", () => {
  // Three paths can wrap: the manual confirm dialog, and the automatic countdown's two buttons
  // ("wrap now" / it running out). Each increments once; runEvent must never also count, or an
  // automatic wrap would register as two.
  assert.ok(!/if \(kind === "wrap"\) S\.wraps\+\+/.test(html), "runEvent must not count a wrap");
  const sites = (html.match(/S\.wraps\+\+/g) || []).length;
  assert.equal(sites, 3, `expected exactly three counting sites (manual confirm, auto 'wrap now', auto expiry), found ${sites}`);
  // …and every one of them must be immediately followed by the wrap actually running.
  for (const m of html.matchAll(/S\.wraps\+\+;([\s\S]{0,120})/g)) {
    assert.ok(/runEvent\("wrap"\)/.test(m[1]), "a count that does not run a wrap would inflate the tally");
  }
});

test("an automatic wrap announces itself instead of interrupting with a modal", () => {
  // A modal that stops to ask is not automatic, and cancelling one would only re-arm it moments later.
  assert.ok(html.includes("function armAutoWrap()"), "there must be an arming path");
  assert.ok(html.includes("Auto-wrap in "), "…which counts down in flow rather than opening a dialog");
  assert.ok(html.includes("if (S.autoArm || S.busy || !S.autoWrap) return;"), "arming must be idempotent — no stacked timers");
});

test("cancelling an automatic wrap also turns auto-wrap OFF", () => {
  // Otherwise it re-arms immediately and "cancel" meant nothing — the nag loop this design avoids.
  assert.ok(html.includes("S.autoArm = null; S.autoWrap = false;"), "cancelling must untick auto-wrap");
  assert.ok(html.includes("would have re-armed it immediately"), "…and say why, so the change is not a surprise");
  assert.ok(html.includes("turns auto-wrap OFF"), "the button itself must state the side effect before it is pressed");
});

test("a queued message shows BOTH its images and its referenced files", () => {
  // Otherwise a queued message is indistinguishable from one whose attachments were dropped.
  assert.ok(html.includes('class: "msgimgs"'), "images must be shown");
  assert.ok(html.includes('class: "msgfiles"'), "referenced files must be shown too");
  assert.ok(/\.mfile\{[^}]*text-overflow:ellipsis/.test(labCss), "a long path must not blow the bubble open");
});

test("the permission mode selector exists and marks the dangerous mode", () => {
  assert.ok(shellUiJs.includes('{ value: "bypassPermissions", label: "Bypass" }'), "Bypass must be selectable");
  // It paints the element that OCCUPIES the role, not the package's native select — a host may have
  // substituted its own control (Pact does), and the state belongs to the role. Painting `permSel`
  // directly is exactly why Bypass stayed grey in both workspaces while reading red here.
  assert.ok(shellUiJs.includes('var permNode = role("permission", permSel);'),
    "the danger state must be applied to whatever occupies the permission role");
  assert.ok(shellUiJs.includes('permNode.classList.toggle("--danger", v === "bypassPermissions")'),
    "…and be visibly marked as the dangerous one, so the state is read at a glance");
});

test("byte ceilings are printed as MiB, since that is what they are", () => {
  // 25 * 1024 * 1024 divided by 1e6 printed "26.2MB" — a number that appears nowhere in the code.
  assert.ok(html.includes("function fmtBytes"), "there must be a binary formatter");
  assert.ok(html.includes("MiB"), "…that says MiB");
  assert.ok(!/fmtChars\(c\.now\) \+ "\/" \+ fmtChars\(c\.max\) \+ "B"/.test(html), "the decimal formatter must not be used for bytes");
});

test("Recall models BOTH engine modes, and says it searched the ARCHIVE", () => {
  // lib/conversationArchive.mjs exposes recallByNumber (one turn, fetched in full by absolute P#/R#)
  // and recallByQuery (substring hits, newest segment first). The lab previously implied a single text
  // search, which misrepresented what the button does.
  assert.ok(html.includes('openRecall("number"'), "by-number mode must exist");
  assert.ok(html.includes('openRecall("query"'), "by-query mode must exist");
  assert.ok(html.includes("wrapped OUT of the live window"), "…and must state that it searches the archive");
  assert.ok(html.includes("Newest segment first"), "query mode must describe its ordering honestly");
  assert.ok(html.includes("not a ranked search"), "…and not imply relevance ranking it does not do");
  // Empty archive is a real state and must be said out loud rather than showing zero results.
  assert.ok(html.includes("the archive is empty"), "an empty archive must be explained, not shown as no hits");
});

test("Recall and Jump are distinguished, not interchangeable", () => {
  assert.ok(html.includes("Jump only reaches"), "the panel must contrast itself with Jump");
  // Jump refuses a non-numeric input and points at Recall; Recall accepts both forms.
  assert.ok(html.includes("is not a turn number"), "Jump must redirect text input to Recall");
});

test("a completed wrap DRAWS ITS LINE in the transcript — driven, not described", () => {
  // Earlier guards only checked that a renderer and a record both existed. Neither proves a wrap
  // actually puts a line on screen, which is the thing that was reported missing.
  //
  // runEvent() is deliberately NOT called: it starts a setInterval that keeps the test process alive
  // forever (the first version of this test hung for exactly that reason). The record → render path is
  // what matters, so the record is written exactly as runEvent writes it, then rendered.
  const { doc, S, render } = runLab();
  assert.equal(doc.querySelectorAll(".mark").length, 0, "precondition: no markers yet");

  S.marks.push({ kind: "wrap", afterRound: S.rounds, preTokens: 100000, postTokens: 12000, trigger: "auto" });
  render();

  const marks = doc.querySelectorAll(".mark");
  assert.ok(marks.length >= 1, "a wrap must leave a visible line in the transcript");
  const wrapLine = marks.find((n) => n.className.includes("--wrap"));
  assert.ok(wrapLine, "…and it must be the heavier WRAP rule, not a compaction rule");
  // The shim does not aggregate textContent up the tree, so gather it from the descendants.
  const textOf = (n) => (n.textContent || "") + (n.children || []).map(textOf).join(" ");
  assert.match(textOf(wrapLine), /WRAPPED/, "the line must say what it is");
});

test("a mark attaches to a round that is actually RENDERED", () => {
  // The transcript is windowed, so a mark pinned to a round outside the window would be recorded and
  // then never drawn — indistinguishable from the feature being broken.
  const { doc, S, render } = runLab();
  S.marks.push({ kind: "compact", afterRound: S.rounds, preTokens: 9, postTokens: 4, trigger: "auto" });
  render();
  assert.ok(doc.querySelectorAll(".mark").length >= 1, "a mark on the newest round must render");
  S.marks.push({ kind: "compact", afterRound: 1, preTokens: 9, postTokens: 4, trigger: "auto" });
  render();
  const rendered = doc.querySelectorAll(".mark").length;
  assert.ok(rendered >= 1, "and one pinned outside the window simply does not draw — it is not an error");
});

test("any turn can be replied to, and the reference lands above the type box", () => {
  assert.ok(html.includes("mkMsgActs("), "every turn must carry its own reply affordance");
  // Pending references belong above the compose field — they are part of the message being written.
  assert.ok(shellUiJs.includes("footerLeadContent: [seamBulb, attachErr, attachRow, replyRow]"),
    "pending references must render above the type box");
  assert.ok(shellUiJs.includes("CS.replyCost(refs).approxTokens"), "…carrying their token cost, because quoting is not free");
});

test("an ARCHIVED turn can be replied to straight from the recall result", () => {
  // Replying to what you just recalled is the usual reason for recalling it.
  assert.ok(html.includes('"\\u21a9 Reply to "'), "the recall panel must offer a reply action");
  assert.ok(html.includes("archived: true"), "…and mark the reference as coming from the archive");
});

test("the composed prompt can be previewed before sending", () => {
  assert.ok(shellUiJs.includes("CS.buildReplyPreamble(refs)"), "the preview must use the SHARED builder, not its own copy");
  assert.ok(shellJs.includes("function buildReplyPreamble"), "…which is what actually gets prepended to the prompt");
});

test("the header carries ONLY what you read constantly — the search moved out", () => {
  // The search was a permanent header row for a control used occasionally; it is a drawer under the
  // type box now, so header row 2 is the stats and nothing else.
  assert.ok(shellUiJs.includes('statsRowClass: "hrow hright"'), "the stats become the whole row");
  assert.ok(shellUiJs.includes("footerLeadContent:") && shellUiJs.includes("searchDrawer]"),
    "…and the search lives in the footer, under the field you would type into");
});

test("the search drawer opens under the type box, and only exists when open", () => {
  assert.ok(shellUiJs.includes('show(searchDrawer, false);'), "closed by default: the drawer must cost nothing");
  assert.ok(shellUiJs.includes("show(searchDrawer, state.searchOpen);"), "…and open on the field's own button");
  const { doc } = runLab();
  assert.ok(doc.querySelector("#f-searchrow"), "the drawer element must exist to be toggled");
});

test("the context figure appears ONCE — in the footer, not also in the header", () => {
  // The same number in two places is one number too many; the footer readout is authoritative and is
  // also the way into the breakdown.
  assert.ok(shellUiJs.includes('var ctxBtn = el("button", { class: "chip --acc"'), "the footer keeps the authoritative readout");
  assert.ok(shellUiJs.includes('ctxBtn.addEventListener("click"'), "…and it is the way into the breakdown");
  assert.ok(!/statsRow.*ctxBtn/.test(shellUiJs), "the header must not carry a second copy of the figure");
});

test("compaction count and the wrap RANGE are both on screen", () => {
  // Both were reported missing: the count only rendered when non-zero, and the range had moved out.
  assert.ok(shellJs.includes('" compacted \u00b7 this window"'), "the compaction count must always render, scoped to the window");
  assert.ok(!/if \(nComp\) out\.push/.test(shellJs), "…including when it is zero, so its absence is not ambiguous");
  assert.ok(shellJs.includes("would wrap "), "the wrap range must be shown");
  // Computed, not described — and from the WINDOW, not from turn 1. `rFrom: 1` was the bug: it
  // claimed the next wrap would archive the whole conversation back to its first turn.
  assert.ok(shellJs.includes("wrapSpan({ rFrom: rFrom"), "…computed from the window's own first turn, not from R#1");
  assert.ok(!shellJs.includes("wrapSpan({ rFrom: 1"), "the hardcoded start must not come back");
});

test("the footer still carries the context ACTIONS after the header rework", () => {
  // These went missing once already when a header edit sliced too far.
  const { doc } = runLab();
  // They now live ON the model row, in the space that was empty beside the model controls — beside the
  // context readout they act on, and one row of footer height cheaper.
  const row = doc.querySelector("#f-model");
  assert.ok(row, "the model row must exist");
  assert.equal(row.parentNode.classList.contains("rg-footer"), true, "…in the footer");
  assert.ok(!doc.querySelector("#f-ctxrow"), "the dedicated context row is gone");
  assert.ok(doc.querySelector("#f-autowrap"), "auto-wrap tick present");
  assert.ok(doc.querySelector("#f-wrapmeter"), "…and its meter with it");
});

test("the loading strip survived the header rework", () => {
  // It was removed by accident when the old rollup bar was sliced out.
  assert.ok(html.includes("loading history"), "the cold-load progress strip must still be rendered");
  assert.ok(html.includes("S.loadPct > 0 && S.loadPct < 100"), "…and stay zero-height when idle");
});

test("clicking the rail's wrap button actually OPENS the confirm dialog", () => {
  // Reported as doing nothing. Assert the click, not the wiring — "has a handler" and "the handler
  // works" are different claims, and only the second one matters here.
  const { doc } = runLab();
  const pop = doc.querySelector("#wrappop");
  assert.ok(pop && !pop.classList.contains("--open"), "precondition: dialog closed");
  const btn = doc.querySelector("#simWrap");
  assert.ok(btn && typeof btn.onclick === "function", "#simWrap must be wired");
  btn.onclick();
  assert.ok(pop.classList.contains("--open"), "clicking it must open the dialog");
  // …and it must be pinned to the shell, not left at whatever the previous dialog set.
  assert.equal(pop.style.width, "900px", "the overlay must take the shell's measured width");
});

test("the footer Wrap button explains its refusal instead of just being dead", () => {
  // At 9% of the window it is correctly refused — but a disabled control with no visible reason is
  // indistinguishable from a broken one, which is exactly how it was read.
  assert.ok(shellJs.includes("wrapBtn.disabled = !wr.canWrapManually"), "it stays gated below the threshold");
  assert.ok(shellJs.includes('"\u27f3 Wrap at " + Math.round(wr.manualAt * 100)'),
    "…and names the threshold it is waiting for, on its face");
  // Simulating a wrap must also simulate the situation, or the rail button looks inert.
  assert.ok(html.includes("Filled the window to 72%"), "the rail's wrap must make the wrap legal first");
});

test("the wrap dialog is honest about what it does NOT free", () => {
  // "Wrapped" reads like "reclaimed", and that is untrue of everything on disk.
  assert.ok(html.includes("A wrap frees CONTEXT, not disk"), "the dialog must say what a wrap does not do");
  assert.ok(html.includes("kept on disk"), "images survive a wrap");
  assert.ok(html.includes("paths only"), "referenced files were never stored in the first place");
  assert.ok(html.includes("a recalled turn still shows its pictures"), "…which is WHY images must be kept");
});

test("the agents indicator answers 'what is LIVE', not 'what has ever run'", () => {
  // The production panel showed 26 rows, 23 of them successes from nine hours ago, burying 3 errors.
  const { doc, S, render } = runLab();
  S.agentRows = [
    { id: "1", label: "local_bash", description: "live one", status: "running", elapsedMs: 3000 },
    { id: "2", label: "local_bash", description: "old success", status: "done", durationMs: 4000, finishedAt: Date.now() - 1000 },
    { id: "3", label: "local_bash", description: "a failure", status: "error", durationMs: 2000, finishedAt: Date.now() - 1000 },
  ];
  S.agentsOpen = true;
  render();
  const panel = doc.querySelector("#f-agents");
  assert.ok(panel, "the panel must render when opened");
  const rows = doc.querySelectorAll(".arow");
  assert.equal(rows.length, 3);
  assert.ok(rows[0].className.includes("--running"), "running work sorts first — it is the live question");
  assert.ok(rows[1].className.includes("--error"), "then failures, which are the only history worth reading");
  assert.ok(rows[2].className.includes("--done"), "successes last");
});

test("each row shows the clock that fits its state", () => {
  // A live agent ticks; a finished one reports how long it TOOK and never changes again.
  assert.ok(html.includes('"running " + Math.round((a.elapsedMs || 0) / 1000)'), "running rows tick");
  assert.ok(html.includes('"took " + Math.round(a.durationMs / 1000)'), "finished rows report a duration");
  assert.ok(html.includes('"duration unknown"'), "…and say so when we never learned it");
});

test("finished agents leave; errors stay until dismissed", () => {
  // This is the answer to "how does it disappear" — a success nobody read is not information, but a
  // failure that vanishes on a timer is one you never find out about.
  assert.ok(html.includes("function pruneAgents()"), "there must be a retention pass");
  assert.ok(html.includes('if (a.status === "running" || a.status === "error") return true;'),
    "running and errors are never aged out");
  assert.ok(html.includes("if (a.finishedAt == null) return true;"), "unknown age is not treated as old");
  assert.ok(html.includes("S.dismissed[a.id] = true"), "an error leaves only by being dismissed");
  assert.ok(html.includes("a failure that vanishes on"), "…and the panel explains the rule rather than hiding it");
});

test("the two counters have DIFFERENT scopes, and say which", () => {
  // Compactions belong to the current WINDOW and reset at every wrap — the ones before a wrap belong to
  // the segment that was archived. Wraps belong to the CONVERSATION and only ever go up, because each
  // one is a segment Recall can still reach.
  assert.ok(shellJs.includes("compacted \u00b7 this window"), "compactions must be labelled per-window");
  assert.ok(shellJs.includes("wrapped \u00b7 this conversation"), "wraps must be labelled per-conversation");
  assert.ok(html.includes("mk.afterRound >= lastWrapRound"), "compactions must be counted only since the last wrap");
  assert.ok(shellJs.includes("resets at every wrap"), "…and the reset must be stated, not left to be discovered");
  assert.ok(shellJs.includes("Cumulative: this only ever goes up"), "…and the wrap count's opposite behaviour too");
});

test("both counters render at zero", () => {
  // A counter that appears only when non-zero makes its own absence ambiguous: "none yet" and "not
  // tracked" would look identical.
  const { doc, S, render } = runLab();
  S.marks = []; S.wraps = 0; render();
  const chips = doc.querySelectorAll(".chip").map((c) => (c.children || []).map((k) => k.textContent).join("") + c.textContent);
  const all = chips.join(" | ");
  assert.match(all, /0 compacted/, "zero compactions must still show");
  assert.match(all, /0 wrapped/, "zero wraps must still show");
});

test("Core's multi-chat toggle is present, off by default, and reversible", () => {
  const { doc, S, render } = runLab();
  assert.equal(S.multiChat, false, "off by default — one repository usually means one thread");
  assert.ok(doc.querySelector("#h-multichat"), "the toggle must be in the header");
  assert.ok(!doc.querySelector(".tab"), "no tab strip while there can only be one conversation");
  S.multiChat = true; S.convs = [{ n: "Master", act: true }, { n: "Chat 2", act: false }];
  render();
  assert.ok(doc.querySelectorAll(".tab").length >= 2, "tabs appear once several conversations can exist");
  assert.ok(html.includes("S.convs = [S.convs[0]"), "switching it back off must collapse to one conversation");
});

test("the toggle explains that nothing is created or split", () => {
  assert.ok(shellUiJs.includes("They were always stored separately"),
    "the toggle must say the conversations were always stored apart");
  assert.ok(shellUiJs.includes("nothing is created or split"), "…and that switching it on splits nothing");
});

test("the toggle is Core-only — Pact cannot be made single-chat", () => {
  // Pact is always multi-conversation, so offering the switch there would be a lie about what it does.
  assert.ok(shellUiJs.includes('multiChat: { shown: kind === "core", checked: false }'),
    "Pact must not offer the toggle at all");
});

test("three answer-arrival modes exist, and each is honest about its trade", () => {
  // They trade the same two things: how much you can read while it arrives, against how much the page
  // moves while it does.
  assert.ok(html.includes('data-sm="raw"') && html.includes('data-sm="calm"') && html.includes('data-sm="counter"'),
    "all three must be selectable so the trade can be felt, not argued");
  assert.ok(html.includes("REFLOWS the whole bubble"), "raw mode must name the actual cause of the stutter");
  assert.ok(/you give up\s+\/\/\s+reading along/.test(html) || html.includes("a real loss, not a detail"),
    "counter mode must state its cost, not just its smoothness");
});

test("calm mode cannot reflow: the streaming block is unformatted and pre-wrapped", () => {
  // Reflow is the stutter. Markdown applied mid-stream re-lays-out everything already on screen.
  assert.ok(/\.msg\.--calm \.rawstream\{white-space:pre-wrap/.test(labCss),
    "the live block must be pre-wrap so appended characters cannot re-lay-out what is above them");
  assert.ok(componentsCss.includes("no markdown, so adding characters can never\n *             reflow"), "…and the reason recorded");
});

test("clicking simulate actually starts a stream, and clicking again is a no-op", () => {
  // Grepping said the button was wired; that proves nothing about whether it DOES anything — the same
  // gap that hid the dead worktree/context-medallion controls for three rounds. Click it for real.
  const { doc, S } = runLab();
  const btn = doc.querySelector("#simStream");
  assert.ok(btn && typeof btn.onclick === "function", "#simStream must be wired");
  assert.equal(S.stream, null, "precondition: no stream running yet");
  btn.onclick();
  assert.ok(S.stream, "clicking must actually start a stream, not just look clickable");
  assert.equal(S.stream.chars, 0, "starts at zero characters");
  const before = S.stream;
  btn.onclick();
  assert.equal(S.stream, before, "a second click while one is running must not restart it");
  clearInterval(S.stream._timer); S.stream._timer = null;   // stop the interval so the test process can exit
});

test("raw mode actually reflows mid-stream; calm mode never does until the terminal morph", () => {
  // This is the bug the user caught: raw and calm rendered through the identical branch, so there was
  // nothing to feel a difference between. Drive real ticks (not the interval — that hangs the test
  // process) and assert the DOM, not the source text.
  const { doc, S, advanceStream } = runLab();
  assert.equal(typeof advanceStream, "function", "advanceStream must be exposed for tests to drive");

  S.streamMode = "raw";
  doc.querySelector("#simStream").onclick();
  clearInterval(S.stream._timer); S.stream._timer = null;
  let guard = 0;
  while (S.stream.reflows === 0 && !S.stream.done && guard++ < 400) advanceStream();
  assert.ok(S.stream && !S.stream.done, "must reflow before the answer finishes, not only at the end");
  assert.ok(S.stream.reflows >= 1, "raw mode must actually re-render mid-stream at least once");
  const bubble = findLiveBubble(doc);
  assert.ok(bubble, "the arriving answer bubble must be findable via its --live class");
  assert.match(textOf(bubble), /reflows so far: [1-9]/, "the live reflow count must be visible in the bubble");
  assert.ok(textOf(bubble).includes("Summary") || bubble.querySelector(".mdh"),
    "a crossed checkpoint must actually render the heading as markdown, not leave it as literal text");
  S.stream = null;

  S.streamMode = "calm";
  doc.querySelector("#simStream").onclick();
  clearInterval(S.stream._timer); S.stream._timer = null;
  guard = 0;
  while (!S.stream.done && guard++ < 400) advanceStream();
  // The cleanup (S.stream = null, S.rounds++) is a real setTimeout(…, 900) fired by advanceStream, not
  // something this synchronous test drives — asserting on it here would just be timing luck. What
  // actually matters is checked before that: calm crossed zero checkpoints on the way to done.
  assert.ok(S.stream.done, "calm mode must still reach the terminal flip");
  assert.equal(S.stream.reflows, 0, "calm mode must never reflow before the single terminal morph");
});

test("a simulated answer's REAL text survives in the chat — it must not be replaced by generic filler", (t) => {
  // Reported directly: "the answer actually simulated should appear in the chat." Before this, the
  // cleanup only ever did S.rounds++ — a bare counter bump — so the next render of that round fell
  // through to the same generic "An assistant answer. ".repeat(...) template every OTHER synthetic round
  // uses, and the real streamed markdown (headings, bold, lists) was silently discarded.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { doc, S, advanceStream } = runLab();
  const newRoundIdx = S.rounds;             // 0-based index the finishing stream is about to occupy
  S.streamMode = "calm";
  doc.querySelector("#simStream").onclick();
  clearInterval(S.stream._timer); S.stream._timer = null;
  let guard = 0;
  while (!S.stream.done && guard++ < 400) advanceStream();
  assert.ok(S.stream.done, "precondition: the stream actually finished");

  t.mock.timers.tick(900);                  // fire the 900ms cleanup deterministically, not by luck
  assert.equal(S.stream, null, "cleanup ran and cleared the live stream state");
  assert.ok(S.turnOverrides[newRoundIdx], "the real text must be recorded against that round's index");

  const bubble = doc.querySelector('[data-turn="R' + (newRoundIdx + 1) + '"]');
  assert.ok(bubble, "the round the stream just finished as must be a normal, permanent transcript turn");
  assert.ok(textOf(bubble).includes("Section 1") || bubble.querySelector(".mdh"),
    "it must show the REAL simulated content (the markdown that actually streamed)");
  assert.ok(!textOf(bubble).includes("An assistant answer."),
    "…and never the generic filler every other synthetic round uses");
});

function findLiveBubble(doc) {
  return doc.querySelectorAll(".msg").find((n) => n.classList.contains("--live"));
}

test("counter mode has a FIXED height — that is the whole point", () => {
  // A bubble that does not change height cannot move the scroll, which is the other half of the
  // complaint: the scroll stutters because the content above it keeps re-laying-out.
  assert.ok(/\.msg\.--counter\{min-height:46px/.test(labCss), "the counter bubble must not grow while text arrives");
  assert.ok(componentsCss.includes("a fixed height cannot push the scroll"), "…stated as the reason");
});

test("the reveal is ONE transition at the end, not a per-character animation", () => {
  // Animating every delta would be worse than the stutter it replaces.
  assert.ok(labCss.includes(".msg.--live{transition:none}"), "no transition while characters arrive");
  // The keyframes are namespaced `cs-reveal` in the shared file — a page-global animation name from a
  // stylesheet the whole dashboard loads would be a real collision risk.
  assert.ok(labCss.includes("@keyframes cs-reveal"), "one settle at the end");
  assert.ok(html.includes('st.done = true;') && html.includes('ONE terminal flip'),
    "…driven by a single terminal flip");
});

test("the live bubble is addressable while it arrives", () => {
  // It carries its R# from the first frame, so jump/reply work on an answer that is still being written.
  assert.ok(html.includes('"data-turn": "R" + (S.rounds + 1)'), "the arriving answer must already have its number");
});

test("the transcript stays pinned to the newest turn across renders — never snaps back to the FIRST turn", () => {
  // paintCore() genuinely replaces the transcript's children on every render, and a fresh subtree
  // starts at scrollTop 0 — this is what made the bug possible, so the restore has to be explicit.
  assert.ok(html.includes("core.replaceChildren();"), "paintCore genuinely rebuilds the transcript — this is what made the bug possible");
  assert.ok(html.includes("var stickToBottom = (core.scrollTop + core.clientHeight) >= (core.scrollHeight - 4);"),
    "the position must be sampled BEFORE the rebuild");
  assert.ok(html.includes("core.scrollTop = (S.live || stickToBottom) ? core.scrollHeight"),
    "…and restored to the newest turn, never the oldest");
});
