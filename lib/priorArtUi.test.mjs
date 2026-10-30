// node --test lib/priorArtUi.test.mjs
//
// Ch.2.3b's server side (lib/priorArt.mjs, lib/workspace.mjs's `_prompt` emitting a `priorArt`
// event) is fully covered by lib/priorArt.test.mjs and lib/workspace.test.mjs's integration
// tests. This file pins the remaining client half: both workspaces (Pact and Core/ws) must
// actually receive that event and push a row for it, and the shared renderer
// (lib/chatShellPackage.test.mjs already covers `buildMark({kind:"priorArt"})` itself — this is
// just "does app.js actually call it").
//
// Same source-presence-check convention lib/compactionMarker.test.mjs already uses for "both
// workspaces render the mark through the package's ONE builder" — a full DOM mount of either
// chat surface for one event case is disproportionate when the shared renderer already has its
// own dedicated DOM-level suite.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

test("Pact's event switch has a priorArt case that pushes the event's text into t.msgs", () => {
  const i = app.indexOf('case "priorArt":');
  assert.ok(i >= 0, "Pact must handle the priorArt WS_OUT event");
  const body = app.slice(i, app.indexOf("return;", i) + 7);
  assert.match(body, /t\.msgs\.push\(\{\s*kind:\s*"priorArt",\s*text:\s*d\.text,\s*at:\s*d\.at\s*\}\)/);
  assert.match(body, /pactChatPaint\(t\)/, "the pane must actually repaint, or the row is invisible until something else triggers one");
});

test("Core/ws's event handler has a priorArt branch that pushes the event's text into p.transcript", () => {
  const i = app.indexOf('if (data.kind === "priorArt") {');
  assert.ok(i >= 0, "Core/ws must handle the priorArt WS_OUT event");
  const body = app.slice(i, app.indexOf("return;", i) + 7);
  assert.match(body, /p\.transcript\.push\(\{\s*kind:\s*"priorArt",\s*text:\s*data\.text,\s*at:\s*data\.at\s*\}\)/);
  assert.match(body, /schedulePaint\(p\)/, "the pane must actually repaint");
});

test("wsMarkNode delegates priorArt to ChatShell.buildMark — never a separate, ad-hoc node", () => {
  const i = app.indexOf("function wsMarkNode(m) {");
  assert.ok(i >= 0);
  const body = app.slice(i, app.indexOf("\n}", i));
  assert.match(body, /m && m\.kind === "priorArt"/);
  assert.match(body, /window\.ChatShell\.buildMark\(\{ kind: "priorArt"/);
});

test("both Pact's and Core's row-kind dispatchers route priorArt through wsMarkNode, same as compacted/wrapped/turnError", () => {
  // Also matches keySwitch (multi-key OAuth failover, from the parallel feat-pact-changed-review
  // line this merged with) — same dispatcher line, same requirement either way.
  const matches = app.match(/if \(m\.kind === "compacted" \|\| m\.kind === "wrapped" \|\| m\.kind === "turnError" \|\| m\.kind === "keySwitch" \|\| m\.kind === "priorArt"\) return wsMarkNode\(m\);/g) || [];
  assert.equal(matches.length, 2, "Pact's message renderer and Core's renderItem must BOTH dispatch priorArt the same way");
});
