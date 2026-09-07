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
