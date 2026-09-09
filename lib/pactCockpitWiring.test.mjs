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
  assert.match(app, /slots: \{ buttons: \[menuB\] \}/,
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
