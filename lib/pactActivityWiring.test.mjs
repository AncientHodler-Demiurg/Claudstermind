// node --test lib/pactActivityWiring.test.mjs
//
// Source-text pinning for the wiring the behavioural tests (lib/pactActivityPanel.test.mjs,
// lib/replActivity.test.mjs) can't reach: the poll's own endpoint/lifecycle, and that the panel
// actually gets mounted into BOTH the desktop and mobile REPL terminal panes — ABOVE the existing
// manual-run output, which the request explicitly asked to keep untouched ("Please keep the manual
// runner, but make the pane show ambient activity too").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

test("pactActivityPoll fetches the real activity endpoint and feeds whichever panel is mounted", () => {
  const i = src.indexOf("function pactActivityPoll() {");
  assert.ok(i >= 0);
  const body = src.slice(i, src.indexOf("\n}\n", i) + 3);
  assert.match(body, /fetch\("\/api\/pact\/repl-activity"\)/);
  assert.match(body, /PACT_ACTIVITY_RENDER\(j\)/, "a successful poll must repaint the currently-mounted panel");
});

test("the activity timer starts in pactChatInit (the Pact view's own mount), polling immediately rather than waiting out the first tick", () => {
  const i = src.indexOf("function pactChatInit(host) {");
  assert.ok(i >= 0);
  const body = src.slice(i, src.indexOf("\n}\n", i) + 3);
  assert.match(body, /PACT_ACTIVITY_TIMER = setInterval\(pactActivityPoll, 4000\);/);
  assert.match(body, /pactActivityPoll\(\);(\s*\/\/[^\n]*)?\n\}/, "the first poll must fire right away, not wait 4s");
});

test("the activity timer is cleared on BOTH teardown paths: a full stop AND a temporary detach (background auto-continue)", () => {
  const stopAt = src.indexOf("function pactChatStop() {");
  const detachAt = src.indexOf("function pactChatDetachUI() {");
  assert.ok(stopAt >= 0 && detachAt >= 0);
  const stopBody = src.slice(stopAt, src.indexOf("\n}\n", stopAt) + 3);
  const detachBody = src.slice(detachAt, src.indexOf("\n}\n", detachAt) + 3);
  assert.match(stopBody, /clearInterval\(PACT_ACTIVITY_TIMER\); PACT_ACTIVITY_TIMER = null; PACT_ACTIVITY_RENDER = null;/);
  assert.match(detachBody, /clearInterval\(PACT_ACTIVITY_TIMER\); PACT_ACTIVITY_TIMER = null;/);
});

test("desktop: the activity panel is mounted in termEl, ABOVE the manual-run terminal output (termOut)", () => {
  const i = src.indexOf('const termEl = el("div", { class: "pact-term" }, [');
  assert.ok(i >= 0);
  const body = src.slice(i, i + 400);
  assert.match(body, /activityPanel\.el,\s*\n\s*termOut,/, "activityPanel.el must come BEFORE termOut in the children array");
});

test("desktop: the panel is built and registered as the active renderer alongside termEl", () => {
  const i = src.indexOf('const termOut = el("pre", { class: "pact-terminal" }');
  const body = src.slice(i, i + 900);
  assert.match(body, /const activityPanel = pactActivityPanel\(\);/);
  assert.match(body, /PACT_ACTIVITY_RENDER = activityPanel\.render;/);
});

test("mobile: termStage also mounts the SAME pactActivityPanel (one implementation, shared) above its own manual-run output", () => {
  const i = src.indexOf("function termStage() {");
  assert.ok(i >= 0);
  const body = src.slice(i, src.indexOf("\n  }\n", i) + 5);
  assert.match(body, /const activityPanel = pactActivityPanel\(\);/);
  assert.match(body, /PACT_ACTIVITY_RENDER = activityPanel\.render;/);
  assert.match(body, /activityPanel\.el,\s*\n\s*out,/, "activityPanel.el must come BEFORE the manual-run `out` pre in cache.term's children");
});

test("the manual runner (pactRunRepl / pactTermAppend / the ▶ Run button) is completely untouched by this change", () => {
  // Pins that the EXISTING manual-run plumbing still exists verbatim — "keep the manual runner".
  assert.match(src, /function pactRunRepl\(rel\) \{/);
  assert.match(src, /new EventSource\("\/api\/pact\/run\?path=" \+ encodeURIComponent\(rel\)\);/);
  assert.match(src, /const run = el\("button", \{ class: "pact-run-btn"/);
});
