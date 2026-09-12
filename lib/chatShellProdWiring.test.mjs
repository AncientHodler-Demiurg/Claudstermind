// node --test lib/chatShellProdWiring.test.mjs
//
// chat-shell.js (dashboard/public/chat-shell.js) was written to be loaded by BOTH the prototyping
// lab AND production (see its own header comment), but for the whole time it existed, only the lab
// ever loaded it — dashboard/public/index.html had no reference to it at all, so `window.ChatShell`
// never existed in the real app. This asserts the load order in the one real entry point, so that
// gap cannot silently reopen: chat-shell.js must be present and must load BEFORE app.js, since app.js
// code (reply/quote, manual wrap) calls window.ChatShell at the moment those features run.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dir, "..", "dashboard", "public", "index.html"), "utf8");
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const components = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "components.css"), "utf8");

test("chat-shell.js is loaded by the real production page", () => {
  assert.match(html, /<script src="\/chat-shell\/chat-shell\.js"><\/script>/,
    "index.html must load the package's maths module");
});

test("chat-shell.js loads BEFORE app.js, so window.ChatShell exists when app.js runs", () => {
  const shellIdx = html.indexOf('<script src="/chat-shell/chat-shell.js">');
  const appIdx = html.indexOf('<script src="/app.js">');
  assert.ok(shellIdx >= 0, "the package's script tag must exist");
  assert.ok(appIdx >= 0, "app.js script tag must exist");
  assert.ok(shellIdx < appIdx, "chat-shell.js must appear before app.js in document order");
});

/* ================= Pact's Send/Stop must be driven, and Core's must stay styleable ============= */
//
// "the send button isn't lighting up correctly when the agent is working, in the pact workspace."
//
// Two independent reasons, both silent:
//   1. `.pc-compose` does not exist on desktop at all — Pact builds it with no children unless mobile,
//      because the package owns the compose area. The whole Send/Stop paint sat behind `if (compose)`.
//   2. Inside it, the buttons were looked up by `.pc-send`/`.pc-stop`. On desktop they are the
//      PACKAGE's buttons (`btn-send`/`btn-stop`) — Pact substitutes neither — so both lookups
//      returned null behind an `if (send)` guard.

test("Pact publishes the work state through the shell, not by hunting for .pc-send", () => {
  assert.match(app, /pv\.setState\(\{\s*sending:\s*\{/, "Pact must drive the shell's own sending state");
  // The state patch must not be trapped inside the desktop-absent `.pc-compose` guard again.
  const paint = app.slice(app.indexOf("function pactChatPaint(t) {"));
  const setStateAt = paint.indexOf("pv.setState({ sending:");
  const composeGuardAt = paint.indexOf("\n  if (compose) {");
  assert.ok(setStateAt > 0 && composeGuardAt > 0, "both the patch and the mobile guard must exist");
  assert.ok(setStateAt < composeGuardAt,
    "the work state must be published BEFORE the mobile-only `if (compose)` block — that guard is false on desktop");
});

test("Pact publishes the SHARED presentation, rather than deciding it again itself", () => {
  const paint = app.slice(app.indexOf("function pactChatPaint(t) {"));
  const patch = paint.slice(paint.indexOf("const pres = window.ChatShell.sendPresentation("), paint.indexOf("if (compose) {"));
  assert.ok(patch, "Pact must compute the shared decision before the mobile-only block");
  // The inputs are what Pact knows; the OUTPUT is not its business any more. Background work is in
  // there because its absence was one of the three ways Pact drifted from Core.
  for (const [needle, why] of [
    ["busy, deep, stopping", "the three facts about this turn"],
    ["background: ((t && t._background) || []).length > 0", "…and whether an agent-spawned task is still running"],
    ["pv.setState({ sending: { ...pres", "the result is published whole — no field re-derived on the way"],
    ["sendDisabled: false", "a mid-turn send still queues"],
  ]) assert.ok(patch.includes(needle), why);
  assert.ok(!/state: stopping \? null/.test(app),
    "the old inline chain must be gone, or Pact can drift from Core again");
});

test("Core's own class spelling is honoured by the package, since Core still uses it", () => {
  // Core is deliberately NOT migrated: it appends an elapsed label and stall warnings to these two
  // buttons on paths of its own (wsApplyStall), so routing them through setState risks a repaint
  // stamping over a stall warning. It works because the package's CSS matches BOTH spellings — this
  // pins that contract, so the legacy arm cannot be "tidied away" while Core still depends on it.
  assert.match(app, /ui\.sendBtn\.classList\.toggle\("busy", _pres\.state === "busy" \|\| _pres\.state === "deep"\)/,
    "Core toggles the bare class — from the SHARED decision, not from its own ternaries");
  assert.match(app, /ui\.sendBtn\.classList\.toggle\("deepwork", _pres\.state === "deep"\)/, "…and for deep work");
  assert.match(components, /\.cs-shell \.btn-send\.busy\b/, "so the package must keep matching it");
  assert.match(components, /\.cs-shell \.btn-send\.deepwork\b/, "…and this one");
  assert.match(components, /\.cs-shell \.btn-send\.work-pulse/, "…and the ring");
});

/* ================= ⧉ copy on EVERY message, in both workspaces ================================= */
//
// "for each message (prompt or answer) I also need a copy button … my use case is I want to show
// another agent what an agent said."
//
// `⤴` already existed but converts to WhatsApp formatting and only ever sat on ANSWERS — markdown
// handed to another agent has to survive intact, and a prompt is exactly as worth copying as a reply.
// Four render sites: Core prompt, Core answer, Pact prompt, Pact answer. Missing one is invisible
// until you happen to need it there — Pact's prompt button was built and then not inserted, and only
// a live count of the rendered buttons caught it.
test("the copy button is built AND inserted at all four message render sites", () => {
  assert.equal((app.match(/wsCopyMsgBtn\(/g) || []).length, 5,
    "one definition plus exactly four call sites: Core prompt, Core answer, Pact prompt, Pact answer");
  // Built is not the same as rendered — each one must actually reach its element's children.
  // An ANSWER'S corner is now one in-flow row (wsMsgHead — see lib/msgCornerRow.test.mjs for why),
  // so its needle is the row's argument list rather than a flat child list. A PROMPT keeps the flat
  // shape: its badge is still pinned and its ⧉/↩ were already in flow, so nothing there overlapped.
  for (const [needle, where] of [
    ['[wsNumBadge("P", m._pnum),\n        wsCopyMsgBtn(', "Core prompt"],
    ['wsMsgHead(wsNumBadge("R", m._rnum), [copyBtn,', "Core answer"],
    ['[pactNumBadge("P", m._pnum), copyBtnP,', "Pact prompt"],
    ['wsMsgHead(pactNumBadge("R", m._rnum), [copyBtnR,', "Pact answer"],
  ]) assert.ok(app.includes(needle), `${where}: the button must be in the rendered children, not just declared`);
});

test("plain click copies RAW text; the modifier copies the address", () => {
  const i = app.indexOf("function wsCopyMsgBtn(");
  const fn = app.slice(i, app.indexOf("\n}", i));
  assert.match(fn, /const wantRef = e\.altKey \|\| e\.shiftKey;/, "one button, two scopes");
  assert.match(fn, /wantRef \? wsTurnRef\(convId, kind, number\) : String\(text \|\| ""\)/,
    "raw text by default — not the WhatsApp conversion `⤴` does, which is lossy for an agent");
  assert.match(fn, /Alt\/Shift-click/, "the tooltip must advertise the modifier; a hidden one helps nobody");
});

test("the address is the same shape as the archive's own segment refs", () => {
  assert.match(app, /function wsTurnRef\(convId, kind, number\) \{\s*\n\s*return String\(convId \|\| ""\) \+ "#" \+ kind \+ String\(number \|\| 0\);/,
    "`<conversationId>#R949` is a sibling of `<conversationId>#seg14`, not a second scheme");
});
