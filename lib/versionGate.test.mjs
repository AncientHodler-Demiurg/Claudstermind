// node --test lib/versionGate.test.mjs
//
// "I think we should gate somehow that both local and remote should be running the same version,
//  otherwise we should show a message, chat disabled until both are the same version."
//
// WHY. The web is served by the relay; the ENGINE runs on the work machine; they are deployed and
// restarted separately, so they can differ at any moment. That is not exotic — it is the normal state
// between two deploys. It bit for real: a browser shipped with the auto-continue loop REMOVED (the
// engine owns it now) met an engine that did not yet have that loop, so the loop belonged to nobody,
// prompts sat queued, and nothing on screen said why. A protocol change makes a mismatch dangerous
// rather than merely odd, so the chat refuses loudly instead of behaving subtly wrongly.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const ws = readFileSync(join(__dir, "..", "lib", "workspace.mjs"), "utf8");
const css = readFileSync(join(__dir, "..", "dashboard", "public", "styles.css"), "utf8");

/** The gate's own predicate, lifted from app.js so the RULE is tested rather than restated. */
function mismatchFn() {
  const at = app.indexOf("function wsVersionMismatch()");
  assert.ok(at > 0, "wsVersionMismatch was renamed — this file is aimed at nothing");
  const body = app.slice(at, app.indexOf("\n}", at) + 2);
  // eslint-disable-next-line no-new-func
  return new Function("WS_WEB_VERSION", "WS_ENGINE_VERSION", body + " return wsVersionMismatch();");
}

test("a mismatch blocks, and matching versions do not", () => {
  const m = mismatchFn();
  assert.equal(m("1.18.0", "1.17.9"), true, "different builds must refuse");
  assert.equal(m("1.18.0", "1.18.0"), false, "the normal case must never be blocked");
});

test("silence is not a mismatch — an unknown version must never lock the chat", () => {
  // The engine may be too old to stamp a version at all, and no frame has arrived on a cold start.
  // Refusing on silence would mean the chat is dead every time you open it, which is a far worse
  // failure than the one this prevents.
  const m = mismatchFn();
  assert.equal(m("1.18.0", ""), false, "no word from the engine yet is not a disagreement");
  assert.equal(m("", "1.18.0"), false, "…and neither is not knowing our own build");
  assert.equal(m("", ""), false);
});

test("the engine stamps the version it actually loaded, on a frame every client gets", () => {
  assert.match(ws, /export const ENGINE_VERSION/,
    "the engine must report its OWN build, read from the package it is running");
  assert.match(ws, /this\.send\("state", null, \{ engineVersion: ENGINE_VERSION/,
    "it rides the session snapshot — the one frame every client is guaranteed to receive, so no " +
    "extra round-trip is needed to learn it");
});

test("both workspaces refuse at the choke point every send passes through", () => {
  // Not at each button: a prompt, a queued drain, an auto-continue round and a slash command all
  // converge on these two functions, and gating anywhere else leaves a path that quietly bypasses it.
  const pact = app.slice(app.indexOf("async function pactChatDispatch"), app.indexOf("async function pactChatDispatch") + 700);
  assert.match(pact, /if \(wsVersionMismatch\(\)\)/, "Pact must refuse inside pactChatDispatch");
  const core = app.slice(app.indexOf("  async function send(p) {"), app.indexOf("  async function send(p) {") + 500);
  assert.match(core, /if \(wsVersionMismatch\(\)\)/, "Core must refuse inside send()");
  for (const frag of [pact, core])
    assert.match(frag, /wsVersionWhy\(\)/,
      "…and both must show the SAME sentence, naming both versions — 'it stopped working' is the " +
      "report this exists to prevent");
});

test("the refusal is visible without scrolling, and only sending is blocked", () => {
  assert.match(css, /\.ws-version-bar \{[^}]*position: fixed/,
    "a banner you have to scroll to find is one nobody reads on a phone");
  assert.ok(!/body\.ws-version-blocked[^{]*\{[^}]*display:\s*none/.test(css),
    "the conversation must stay readable — only sending refuses");
});

test("the engine learns its version from the package, not a hard-coded string", () => {
  const at = ws.indexOf("export const ENGINE_VERSION");
  const body = ws.slice(at, ws.indexOf("})();", at));
  assert.match(body, /package\.json/, "a literal would drift the moment someone bumps the version");
  assert.match(body, /catch/, "and an unreadable package must yield '', which the gate treats as silence");
});
