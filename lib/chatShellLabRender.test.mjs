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
const prodCss = readFileSync(join(__dir, "..", "dashboard", "public", "styles.css"), "utf8");
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
    assert.ok(html.includes(hex), `the lab is missing the production hue ${hex} for ${what}`);
  }
  // The bubble must carry the state, not just its label.
  // The bubble must carry the state, not just its label — and must beat the generic .msg.--u styling,
  // which has equal specificity, so the winner would otherwise depend on source order.
  assert.ok(/\.msg\.--u\.--queued\{background:#4a3410;border:2px solid #f59e0b/.test(html),
    "queued must be a warm orange field with a solid orange border, at .msg.--u.--queued specificity");
  assert.ok(/\.msg\.--u\.--discarded\{background:#4a1214;border:2px solid #ef4444/.test(html),
    "discarded must be a red field with a red border");
  assert.ok(!/\.msg\.--queued\{/.test(html), "the weaker two-class selector must be gone");
  // KNOWN, INTENTIONAL divergence: production's discarded red (#3a0d0d/#7f1d1d) is near-black at this
  // size. The lab proposes #b91c1c/#ef4444. Listed explicitly so it cannot pass for an accident.
  assert.ok(html.includes("#ef4444"), "the lab's brighter discarded red is the proposed value");
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
  assert.ok(!/\.tawrap\{[^}]*display:flex/.test(html), ".tawrap must not be flex — that stretches the textarea");
  assert.ok(/\.gutter\{[^}]*position:absolute/.test(html), "the gutter must be absolutely positioned, outside the sizing path");
  assert.ok(!/g\.style\.height = ta\.style\.height/.test(html), "the gutter must not take its height from the textarea");
});

test("an empty type box is ONE line, not the browser's default two", () => {
  assert.ok(/id: "typebox", rows: "1"/.test(html), "a <textarea> defaults to rows=2 — it must be set explicitly");
});

test("the gutter distinguishes written lines from empty slots", () => {
  assert.ok(html.includes(".gutter b{") && html.includes(".gutter b.--on{"), "two number styles must exist");
  assert.ok(html.includes('i <= written ? "--on" : ""'), "written lines get the bright class, the rest stay dim");
  assert.ok(html.includes("if (!ta.value) written = 0;"), "an empty box has typed zero lines, not one");
});

test("text and ghost both clear the gutter column", () => {
  // The ghost suggestion was rendering underneath the numbers.
  assert.ok(/#typebox,\.tawrap #ghost\{padding-left:/.test(html),
    "both the textarea and the ghost overlay must be padded past the gutter");
});

test("prompts are bookmarkable and shareable, not only answers", () => {
  // Only answers were, which is backwards for the common case: you far more often want to find the
  // QUESTION you asked than the reply it produced.
  assert.ok(html.includes('mkMsgActs("P"'), "prompts must get the action pair");
  assert.ok(html.includes('mkMsgActs("R"'), "answers keep theirs");
  assert.ok(html.includes("function mkMsgActs(kind, n)"), "bookmarks must be keyed by kind, not by number alone");
});

test("the gutter column widens with the number of digits", () => {
  assert.ok(html.includes("var digits = String(Math.max(written, slots)).length"), "width must follow the widest number shown");
  assert.ok(html.includes('g.style.width = w + "px"'), "…and actually be applied");
  assert.ok(html.includes('ta.style.paddingLeft = (w + 10)'), "…with the text kept clear of the divider");
});

test("effort levels match the SDK exactly — there is no 'default' effort", () => {
  // ModelInfo.supportedEffortLevels is ('low'|'medium'|'high'|'xhigh'|'max'). "Default effort" was an
  // invented entry that mapped to nothing.
  assert.ok(sdkDts.includes("'low' | 'medium' | 'high' | 'xhigh' | 'max'"), "the SDK's level list changed — update the lab");
  assert.ok(html.includes('["low", "medium", "high", "xhigh", "max"]'), "the lab must offer exactly those five");
  assert.ok(!/Default effort/.test(html), "'Default effort' must not be offered — the SDK has no such level");
});

test("ultracode is modelled as the separate flag the SDK says it is, not an effort level", () => {
  assert.ok(sdkDts.includes("ultracode?: boolean"), "the SDK declares ultracode as a boolean");
  assert.ok(html.includes("S.ultracode"), "the lab must model it as a flag");
  assert.ok(html.includes('if (S.ultracode) S.effort = "xhigh"'), "…which forces xhigh, as the SDK describes");
});

test("dictation is NOT offered — dropped by decision, and the SDK could not have provided it anyway", () => {
  // Recorded rather than silently absent: the Agent SDK exposes no audio/microphone/transcription API,
  // so this could only ever have been a browser (Web Speech) feature. Dropped on request.
  assert.ok(!html.includes("SpeechRecognition"), "the dictation button was removed");
  assert.ok(!/id: "f-mic"/.test(html), "…and so was its control");
});


test("the context readout in the FOOTER (not just its tooltip) uses thousand separators", () => {
  // The earlier fix only reached the tooltip, and the test matched that tooltip string — so it passed
  // while the visible label still read "1000k". Assert on the rendered children, not the title.
  assert.ok(!/\(S\.ctxMax \/ 1000\) \+ "k tok/.test(html), "the visible label must not shorten the ceiling to 'k'");
  assert.ok(/\[S\.ctxTok\.toLocaleString\(\) \+ " \/ " \+ S\.ctxMax\.toLocaleString\(\)/.test(html),
    "both figures must be formatted in the label itself");
});

test("the two workspace themes actually switch", () => {
  // The Pact handler set data-theme to "pact" and then back to "core" on the same line (a double patch),
  // so Pact never rendered in its own palette.
  const pact = html.slice(html.indexOf('$("#wPact").onclick'), html.indexOf('$("#wPact").onclick') + 240);
  assert.ok(pact.includes('dataset.theme = "pact"'), "Pact must select the pact theme");
  assert.ok(!pact.includes('dataset.theme = "core"'), "…and must not immediately reset it to core");
  assert.ok(html.includes('body[data-theme="core"]') && html.includes('body[data-theme="pact"]'), "both palettes must exist");
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
  assert.ok(/\.mark\.--compact::before\{border-top:1px dashed/.test(html), "compact is a thin dashed rule");
  assert.ok(/\.mark\.--wrap::before\{border-top:3px double/.test(html), "wrap is a heavier double rule");
});

test("the session's compaction COUNT is surfaced, with why it matters", () => {
  assert.ok(html.includes('mk.kind === "compact"'), "compactions must be counted");
  assert.ok(html.includes("wrapping is what actually clears it"), "…and explain that compaction leaves luggage a wrap would clear");
});

test("a running compact/wrap shows progress in flow, not as a floating dialog", () => {
  assert.ok(html.includes("busyband"), "there must be a progress band");
  assert.ok(html.includes("nothing is deleted"), "…which reassures rather than just spinning");
  assert.ok(html.includes('function runEvent(kind)'), "and it must be drivable in the lab");
});

test("dialogs are scoped to the CHAT BOX, not the viewport", () => {
  // `position: fixed` centred them on the page, so in a multi-pane cockpit a pane's own dialog would
  // appear far from the pane that raised it.
  assert.ok(/\.pop\{position:absolute/.test(html), "popups must be positioned against the shell");
  assert.ok(/#hist\{position:absolute/.test(html), "…including the history popup");
  assert.ok(/#shell\{width:100%;position:relative/.test(html), "the shell must be the positioning context");
  assert.ok(html.includes('["#ctxpop", "#wrappop", "#hist"].forEach'), "dialogs must be re-homed into the shell after each rebuild");
  const { doc } = runLab();
  for (const id of ["ctxpop", "wrappop", "hist"]) {
    const n = doc.querySelector("#" + id);
    assert.ok(n && n.parentNode && n.parentNode.id === "shell", `#${id} must live inside the shell, not the page body`);
  }
});

test("the chat box takes all the width offered, and its dialogs fit a narrow pane", () => {
  // The cockpit runs four panes side by side; a fixed max-width would misrepresent the space it runs in.
  assert.ok(!/#shell\{[^}]*max-width:960px/.test(html), "the shell must not be pinned to a fixed width");
  assert.ok(html.includes('shell.style.maxWidth = S.width ? S.width'), "width must be simulatable");
  assert.ok(/\.popbox\{width:min\(460px,calc\(100% - 20px\)\)/.test(html), "a dialog must never exceed its pane");
  assert.ok(/\.histbox\{width:min\(520px/.test(html), "…including the history popup");
});

test("Compact and Wrap are ONE split control — the two answers to the same question", () => {
  assert.ok(html.includes('class: "splitL"') && html.includes('class: "splitR"'), "both halves must exist");
  assert.ok(html.includes('runEvent("compact")'), "the left half compacts");
  assert.ok(html.includes("wbtn.onclick = openWrap"), "the right half opens the wrap preview");
  // Compaction is available at any size; wrapping is refused while the conversation is light.
  assert.ok(!/cbtn\.disabled/.test(html), "compaction must not be gated — it is cheap and always valid");
  assert.ok(html.includes("wbtn.disabled = !wr.canWrapManually"), "wrapping stays gated");
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
  assert.ok(html.includes('$("#simWrap").onclick = openWrap'), "the rail button uses the same gate");
});

test("a confirmed wrap is counted exactly once", () => {
  const confirm = html.slice(html.indexOf("go.onclick = function () {"), html.indexOf("go.onclick = function () {") + 260);
  assert.ok(confirm.includes("S.wraps++"), "the confirm handler counts it");
  assert.ok(!/if \(kind === "wrap"\) S\.wraps\+\+/.test(html), "…and runEvent must not count it again");
});
