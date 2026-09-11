// node --test lib/pactCockpitWiring.test.mjs
//
// WHY THIS EXISTS. "the pact workspace isnt wired in on mobile, still looks like the old workspace."
// Core's port (lib/mobileCockpitWiring.test.mjs) could assume the chat-shell package was mounted and
// re-home its controls. Pact does NOT mount the package on a phone — it builds its own header, tool
// row and compose inside one node and re-renders them freely — so the cockpit adopts that whole node
// and drives Pact's own setters instead. Everything below is something that was wrong once while
// wiring it, and would be silent if it broke again.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const css = readFileSync(join(__dir, "..", "dashboard", "public", "mobile-cockpit.css"), "utf8");
// Sliced to the end of the function by brace matching, not by a guessed character count — the feed
// grew past 4000 characters and the last assertions silently had nothing to look at.
const mod = readFileSync(join(__dir, "..", "dashboard", "public", "mobile-cockpit.js"), "utf8");
const theme = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "theme.css"), "utf8");
/** Code with its comments removed. These assertions search for PATTERNS, and the comments explaining
 *  each fix quote the very pattern being banned ("this read `m.id || m.name`…"), so a prose-aware
 *  test marks its own explanation as the bug. Strip block comments and whole-line `//`. */
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const feed = (() => {
  const at = app.indexOf("function pactMcSync()"), open = app.indexOf("{", at);
  let d = 0;
  for (let i = open; i < app.length; i++) {
    if (app[i] === "{") d++;
    else if (app[i] === "}" && --d === 0) return app.slice(at, i + 1);
  }
  return "";
})();

test("Pact mounts the cockpit on the same gate as Core, and adopts its whole chat host", () => {
  assert.match(app, /const pactCockpit = WS_COCKPIT_MQ\.matches && WS_MOBILE2 && window\.MobileCockpit;/,
    "one gate for both workspaces, or a phone gets two different answers about what it is");
  // `pactChatRender` REPLACES the scroller on every render. Adopting the scroller would leave the
  // cockpit holding a node that is no longer in the document — an empty box that fills with nothing.
  assert.match(app, /transcript: chatHost,/,
    "the adopted node must be the host Pact re-renders INTO, not the scroller it replaces");
});

test("the body carries the switch class in Pact too — syncMobile never runs there", () => {
  // Every rule that reaches OUT of the cockpit is `body.ws-mobile2 …`, and the class is set by
  // syncMobile(), which lives inside the CORE view. In Pact it never runs: the module put the class
  // on its own host, which is enough for its own descendants and nothing else, so every rule hiding
  // Pact's header, tool row and compose silently missed and both layouts rendered at once.
  const branch = app.slice(app.indexOf("const pactCockpit ="), app.indexOf("const wrap = el(\"div\", { class: \"pactm-chatwrap\""));
  assert.match(branch, /document\.body\.classList\.add\("ws-mobile2"\)/, "Pact must set it itself");
  assert.match(app, /if \(!WS_COCKPIT_MQ\.matches\) document\.body\.classList\.remove\("ws-mobile2"\)/,
    "…and drop it when the phone rotates out, or the class outlives the layout it describes");
});

test("the cockpit's host is inside Pact's palette, or it paints in the app's colours", () => {
  // THE BUG THIS ENDS. Pact's theme is scoped `.pact-right`; the cockpit mounts on its own host,
  // which is NOT inside it. Every token therefore fell through to styles.css's :root palette, or to
  // nothing where the app has no such name. Measured on a phone: the compose painted rgb(18,25,51)
  // — the app's --panel, not Pact's #131b26 — the bubbles and field resolved to Core-ish blues, and
  // `border-top: var(--seam-w) solid var(--edge)` computed to 0px because an undefined --seam-w
  // invalidates the shorthand. It surfaced as "the type field looks different core vs pact".
  const host = (app.match(/class:\s*"(pactm-chatwrap pactm-cockpit)"/) || [])[1];
  assert.ok(host, "the cockpit host's class list moved — the assertion below is aimed at nothing");
  const cls = host.split(/\s+/).find((c) => theme.includes("." + c));
  assert.ok(cls,
    `none of the host's classes (${host}) appears in the shared theme file, so the cockpit renders ` +
    "outside every palette: not a wrong colour, an ABSENT one, and half its rules drop entirely");
  // …and specifically in PACT's block, not merely somewhere in the file.
  const pact = theme.slice(theme.indexOf('body[data-theme="dark"] .pact-right'));
  assert.ok(pact.slice(0, pact.indexOf("{")).includes("." + cls),
    `.${cls} must be listed on Pact's palette rule itself — Pact's chat is what it is showing`);
});

test("Pact's own chrome is hidden inside the adopted host — two of everything is what this ends", () => {
  for (const sel of ["pc-head", "pc-toolrow", "pc-compose", "pact-zone-hd"])
    assert.ok(css.includes(".mc-core > ." + sel), `Pact's own ${sel} must be hidden; the cockpit says it already`);
  assert.match(css, /body\.ws-mobile2 \.pactm-cbar, ?body\.ws-mobile2 \.pactm-modebar ?\{ ?display: ?none/,
    "and its two bars, which the cockpit's button row and risers replace");
  // The cue card is NOT chrome: it is the warning that the window is about to auto-compact.
  assert.match(css, /\.mc-core \.exo-bar\{display:none\}/, "the P#/R# row goes");
  assert.ok(!/\.mc-core \.exo-cues\{display:none\}/.test(css), "the auto-compaction warning stays — it is not decoration");
});

test("Pact keeps its ☰, because there it moves between BOXES", () => {
  assert.match(app, /buttons: \[menuB\],/,
    "Core dropped ☰ because its tree column is the repository chooser; Pact's moves between the tree, the editor groups and the REPL");
});

test("Send and Stop are the shared decision here too — three surfaces, one function", () => {
  assert.match(feed, /window\.ChatShell\.sendPresentation\(\{ busy, deep, stopping/,
    "Pact's own bar used to compute this with its own ternaries, which is how the two drifted in 1.13.0");
  assert.match(feed, /sending: pres,/);
});

test("the running strip reads as a person would say it, not as the wire spells it", () => {
  // It rendered "claude-opus-5 · effort: xhigh · Bypass permissions" and wrapped onto two lines.
  assert.match(feed, /prettyModel\(raw\)/, "the catalogue may not have arrived yet; prettyModel is the shared fallback");
  assert.match(feed, /\|\| \{\}\)\.short/, "WS_MODES already carries the short word the desktop uses in this spot");
  assert.ok(!/"effort: " \+ a\.effort/.test(feed), "the strip is a glance, not a form label");
});

test("every callback drives Pact's existing behaviour rather than a second copy of it", () => {
  const pairs = [
    [/send: \(\) => \{ const t = input\(\); pactChatSend\(act\(\)\)/, "sending goes through pactChatSend"],
    [/pactChatSaveDraft\(\); PACT_CHAT\.activeId = t\.id; pactChatRender\(\)/, "switching a chat saves the draft first, as Pact's own sheet does"],
    [/pickMark: \(at\) => drive\(\(a\) => pactChatScrollToResponse\(a, at\)\)/, "a mark scrolls to its turn"],
    [/compact: \(\) => pactCompact\(\)/, "Compact is Pact's own"],
    [/wrap: \(\) => pactOpenWrapDialog\(act\(\)\)/, "…and so is Wrap, with its confirmation"],
    [/openHistory: \(\) => openChatHistory\(\)/, "history is the sheet Pact already had"],
  ];
  for (const [re, why] of pairs) assert.match(app, re, why);
});

test("in Pact a CHAT is a conversation tab — there is no repository level above it", () => {
  assert.match(feed, /chats: tabs\.map/, "the chats list is PACT_CHAT.tabs");
  assert.match(feed, /conversations: \[\]/,
    "and the second list stays empty rather than repeating the first: Pact has no repository to hold threads under");
});

test("Pact's left pane holds what Pact has, and the two controls it holds are MOVED there", () => {
  // The port hid Pact's exocortex bar (it duplicates the head medallion and the right pane) and took
  // the P#/R# recall row with it — a capability lost, not a duplicate removed. And the worktree pill
  // sits in the tool row the cockpit also hides, while the module's own Workspace row would have
  // tapped nothing. Both are re-homed: each carries handlers a rebuild would not (the pill binds,
  // migrates and merges worktrees).
  const branch = app.slice(app.indexOf("const pactCockpit ="), app.indexOf("function pactMcSync()"));
  assert.match(branch, /chatHost\.querySelector\("\.exo-jump"\)/, "recall is moved into the pane, not rebuilt");
  assert.match(branch, /chatHost\.querySelector\("\.pc-wtpill"\)/, "and so is the worktree pill");
  assert.match(branch, /leftPane: \[/, "both go through the pane's own slot");
  assert.match(feed, /worktree: "",/,
    "…and the module's generic Workspace row is suppressed, or it duplicates the pill as a row that does nothing");
});

test("Pact's Wrap opens on a host that exists on a phone, and always says why when it will not", () => {
  // THE BUG THIS ENDS. `pactOpenWrapDialog` looked up `.pact-right` — the DESKTOP pane, which the
  // cockpit replaces wholesale — and returned when it was missing. On a phone that was every time:
  // no dialog, no note, no console line. Measured: `document.querySelector('.pact-right')` is null in
  // Pact's mobile layout. Two independent requirements, because fixing either alone still leaves a
  // button that appears dead half the time.
  const at = app.indexOf("function pactOpenWrapDialog");
  assert.ok(at > 0, "pactOpenWrapDialog was renamed — this test is aimed at nothing");
  const body = stripJs(app.slice(at, app.indexOf("\n}", at)));
  const readyAt = body.indexOf("canWrapManually");
  const hostAt = body.indexOf("pact-right");
  assert.ok(readyAt > 0 && hostAt > 0, "both the readiness check and the host lookup must still be here");
  assert.ok(readyAt < hostAt,
    "the readiness check must come BEFORE the host lookup: a layout whose host is missing would " +
    "otherwise swallow the one message that explains why nothing happened — which is how this was reported");
  assert.match(body, /closest\(["']\.pactm-chatwrap["']\)/,
    "the cockpit ADOPTS the chat host into its wrap, so the wrap is an ANCESTOR — a querySelector " +
    "searches downwards, finds nothing, and falls through to the scrolling transcript, where an " +
    "inset:0 overlay scrolls away with the content instead of covering the pane");
});

test("the phone's model wheel is built from the field the catalogue actually has", () => {
  // "[object Object]" once per model, measured in the Model wheel on a phone. The feed read
  // `m.id || m.name || String(m)`; cached catalogue rows carry none of those — their id field is
  // `value` — so every row fell through to String(m). It was not merely ugly: picking one wrote that
  // literal string back as the model id.
  assert.ok(!/m\.id \|\| m\.name/.test(stripJs(feed)),
    "the catalogue has no `id`/`name`; those fall through to String(m) and the wheel lists [object Object]");
  assert.match(feed, /modelOptionGroups\(/,
    "options must come from the helper both desktop pickers already use, not a fourth hand-rolled mapping");
  assert.match(feed, /startsWith\("omni\/"\)/,
    "the phone must apply the same omni filter as the desktop picker, or it offers routes the desktop hides");
  assert.match(feed, /WS_FALLBACK_MODELS/,
    "a cold load has no catalogue yet — an empty wheel cannot be used at all");
});

test("the ghost is published only while the countdown is actually running", () => {
  // Armed and not yet fired — that is the only window in which a pending send exists. Publishing it
  // any wider leaves the field advertising a message nothing is going to send.
  assert.match((function(){const a=app.indexOf('function pactPaintAutoControl');return app.slice(a, app.indexOf('\\n}', a));})(), /autoNext:\s*\(d\.arm && !d\.fire\)/,
    "a ghost outside the armed window advertises a send that is not coming");
  assert.match((function(){const a=app.indexOf('function pactPaintAutoControl');return app.slice(a, app.indexOf('\\n}', a));})(), /autoNext:[\s\S]{0,80}:\s*""/,
    "…and it must be cleared when not armed, or the last suggestion sticks forever");
});

test("the phone and the desktop read ONE decision, in both workspaces", () => {
  // "Mobile shows 4/10, desktop shows 10/10 — why do I get the feeling they are not wired to one and
  // the same thing?" Within a browser they ARE: one `ac` object is built and handed to both surfaces,
  // so they cannot disagree. Two DEVICES could, because each held its own count until the engine
  // became the owner of it — which is the divergence that was actually being seen, and why it
  // converged on its own once a state frame arrived.
  for (const [name, fn, cockpit] of [["Pact", "function pactPaintAutoControl", "PACT_MC.setState"],
                                     ["Core", "function wsAutoEnsure", "ui.mc.setState"]]) {
    const at = app.indexOf(fn);
    assert.ok(at > 0, name + "'s auto painter moved");
    const body = app.slice(at, at + 3000);
    const decl = (body.match(/const ac = \{/g) || []).length;
    assert.equal(decl, 1, name + " must build the decision ONCE — two objects can drift apart");
    assert.ok(body.includes(cockpit) && /_view\.setState|view\.setState/.test(body),
      name + " must hand that same object to BOTH surfaces");
    assert.ok(!/auto: \{[^}]*n:/.test(body.replace(/const ac = \{[^}]*\}/, "")),
      name + " must not re-derive the counts on the way to one of the two surfaces");
  }
});

test("a remount retires the cockpit it replaces", () => {
  // renderStage() runs on every chat switch, new chat, saved session and file open, and each run
  // mounts a fresh cockpit on the SAME adopted transcript. destroy() was never called, so every
  // remount left another live scroll watcher on that node. Measured: 2 capture-phase scroll listeners
  // with one cockpit on screen; after this, 1, and still 1 across three chat switches.
  const at = app.indexOf("PACT_MC = window.MobileCockpit.mount");
  assert.ok(at > 0, "the mount site moved — this assertion is aimed at nothing");
  const before = app.slice(Math.max(0, at - 600), at);
  assert.match(before, /PACT_MC\.destroy\(\)/,
    "the previous cockpit must be retired before a new one adopts the same transcript, or its " +
    "listeners outlive it and every scroll runs all of them");
});

test("the phone is fed the breakdown, from the same shaper the desktop popover uses", () => {
  // Neither feed ever published `parts` — both sent only { tokens, ceiling } — so the context page,
  // which lists the parts, had nothing to list and reported 0% over a full window.
  assert.match(feed, /parts:\s*mcContextParts\(usage\)/,
    "the breakdown must be published, or the context page can only ever show a free row");
  const at = app.indexOf("function mcContextParts");
  assert.ok(at > 0, "the helper must exist");
  const body = app.slice(at, app.indexOf("\n}", at));
  assert.match(body, /shapeContextPopover\(/,
    "shaped by the SAME function the desktop popover uses, so the two cannot disagree about the window");
  assert.match(body, /!s\.isFree/,
    "the shaper appends its own free segment; counting it as consumed double-counts the free space");
  assert.match(body, /\/\^free\\b\/i/,
    "the ENGINE also emits a 'Free space' category of its own — that is the second free row, and " +
    "counting it is what makes a breakdown add up to more than its window");
});

test("the wrap line tells you its threshold and whether it can fire", () => {
  // Core substitutes the package's own control here, which has always read "⟳ Wrap at 60%" and dimmed
  // itself. Pact renders the cockpit's fallback, which said a flat "↺ Wrap" whatever the state — so a
  // button about to refuse looked exactly like one about to work.
  assert.match(feed, /wrap:\s*\(\(\)\s*=>/, "pactMcSync must publish the wrap line's state");
  assert.match(feed, /wrapReadiness\(/,
    "…decided by the same helper the dialog itself uses, or the button and the action can disagree");
  assert.match(feed, /can:\s*!!r\.canWrapManually/, "the button needs to know whether it can fire");
  assert.match(feed, /note:\s*r\.reason/, "and the reason, which is what a tap on a dimmed button reports");
});

test("the pane renders no section for a level this host does not have", () => {
  // Pact has no repository above its conversations: a CHAT there IS a conversation tab. Rendering the
  // empty sections gave "No repository · current" over a button that opened an empty page — a
  // description of a structure that is not there.
  assert.match(mod, /if \(state\.repos\.length\) \{/, "the Repository section is conditional");
  assert.match(mod, /if \(state\.conversations\.length\) \{/, "so is the Conversations section");
  assert.match(mod, /var levelled = state\.repos\.length && state\.conversations\.length;/,
    "and the 1·/2· numbering only means something when both levels exist");
});

test("Pact's History page is fed Pact's own saved conversations", () => {
  // It opened empty over Pact's own sheet — two answers to one question, one of them blank.
  assert.match(feed, /PACT_CHAT && PACT_CHAT\.sessions/, "the rows come from the sessions Pact already holds");
  assert.match(feed, /name: pactHistName\(r\)/, "…named the way Pact names them everywhere else");
});

test("Pact's size-and-ceilings chips are computed on a phone at all", () => {
  // "Pact workspace doesn't display size and ceilings." pactPaintStatsRow's FIRST line was
  // `if (!PACT_CHAT || !PACT_CHAT._view) return;` — and on a phone there is no view, because Pact
  // mounts the chat-shell package only on the desktop. It returned before computing anything, so the
  // right pane's section had nothing to show.
  assert.match(app, /if \(!PACT_CHAT \|\| \(!PACT_CHAT\._view && !PACT_MC\)\) return;/,
    "the numbers are worth computing for either consumer");
  assert.match(app, /window\.ChatShell\.buildStatsChips\(statsData\)/,
    "…and built by the same function the package would have used, not a second copy of it");
  assert.match(app, /class: "cs-shell mc-chips"/,
    "wrapped in the package's own scope, so the chips are styled by it rather than by a copy of its rules");
});

test("a queued auto-continue does not arm another one — three copies of one prompt is three turns", () => {
  // "Continue where you left off." landed as P#119, P#120 and P#121, with two "Busy finishing the
  // current reply" notices between them. A send made while a turn is finishing is QUEUED, not
  // started, so `busy` stayed false, the loop re-armed and fired again after the delay. Each copy is
  // a full agent turn spent on work already in progress.
  assert.match(app, /function pactAutoPending\(t\)/, "a message already waiting has to be askable about");
  assert.match(app, /busy: pactChatBusy\(t\) \|\| pactAutoPending\(t\)/,
    "Pact's loop must count a queued message as a round that has not started yet");
  assert.match(app, /busy: wsPaneBusy\(p\) \|\| !!\(p\._queue && p\._queue\.length\)/,
    "…and Core's, which queues the same way and asked the same wrong question");
  assert.match(app, /if \(pactChatBusy\(t\) \|\| pactAutoPending\(t\)\) \{ pactAutoStop\(t\); return; \}/,
    "declining to send must also stop the countdown, or the next 250ms tick tries again");
});

test("auto-continue is turned on and off in ONE place", () => {
  // The cockpit had its own copy, missing the deadline reset (a stale deadline already in the past
  // could fire the instant it was switched on) and the ceiling re-grant (re-ticking at the cap looked
  // like it did nothing). A setting with two implementations has two behaviours.
  assert.match(app, /function pactSetAutoContinue\(a, v\)/);
  assert.match(app, /a\._autoDeadline = 0;\s+\/\/ a deliberate toggle always starts a fresh countdown/);
  assert.equal((app.match(/pactSetAutoContinue\(/g) || []).length, 3,
    "the definition plus exactly two callers — the desktop package and the cockpit");
  assert.ok(!/autoContinue: \(v\) => drive\(\(a\) => \{ a\._autoContinue = v;/.test(app),
    "no second implementation of the toggle may survive");
});
