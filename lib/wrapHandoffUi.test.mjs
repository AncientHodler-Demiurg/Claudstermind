// node --test lib/wrapHandoffUi.test.mjs
//
// Ch.2.5c's server side (lib/workspace.mjs's wrapPreview `handoff` field, manualRoll's
// `handoffOverride`) is fully covered by lib/workspace.test.mjs. This file pins the client half
// in both workspaces — the show-and-edit handoff textarea in the Wrap dialog — using the same
// source-presence-check convention lib/compactionMarker.test.mjs and lib/priorArtUi.test.mjs
// already use: a full DOM mount of either Wrap dialog for this one feature is disproportionate
// when the server logic already has its own thorough suite.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

// Pact's wrap functions are TOP-LEVEL (closing brace at column 0); Core's are nested one level
// inside the cockpit's closure (closing brace indented 2 spaces) — the terminator must match each
// function's own actual indentation, or the slice stops at the first NESTED block's closing brace
// instead of the function's own (exactly the bug this file's first draft had).
function wholeFunction(name, indent) {
  const i = app.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `${name} must exist in app.js`);
  const end = app.indexOf(`\n${indent}}`, i);
  assert.ok(end >= 0, `${name}'s closing brace must be found`);
  return app.slice(i, end + indent.length + 1);
}

for (const [openFn, action, indent] of [["pactOpenWrapDialog", "t", ""], ["wsOpenWrapDialog", "p", "  "]]) {
  test(`${openFn}: fires prepareHandoff alongside wrapPreview when the dialog opens`, () => {
    const body = wholeFunction(openFn, indent);
    assert.match(body, new RegExp(`action:\\s*"prepareHandoff",\\s*args:\\s*\\{\\s*sessionKey:\\s*${action}\\.`));
    assert.match(body, new RegExp(`action:\\s*"wrapPreview",\\s*args:\\s*\\{\\s*sessionKey:\\s*${action}\\.`));
  });

  test(`${openFn}: the confirm click forwards the handoff box's CURRENT value as handoffOverride`, () => {
    const body = wholeFunction(openFn, indent);
    assert.match(body, /const handoffOverride = \w+\._wrapDialog && \w+\._wrapDialog\.handoffBox \? \w+\._wrapDialog\.handoffBox\.value : undefined;/);
    assert.match(body, /action:\s*"wrapNow",\s*args:\s*\{\s*sessionKey:\s*\w+\.(?:sessionKey|key),\s*handoffOverride\s*\}/);
  });

  test(`${openFn}: schedules exactly one follow-up wrapPreview re-fetch, skipped once the user has edited the box`, () => {
    const body = wholeFunction(openFn, indent);
    assert.match(body, /setTimeout\(\(\) => \{\s*if \(\w+\._wrapDialog && !\w+\._wrapDialog\.handoffEdited\) wsPost\("control", \{ action: "wrapPreview"/);
  });
}

for (const [fillFn, indent] of [["pactFillWrapPreview", ""], ["wsFillWrapPreview", "  "]]) {
  test(`${fillFn}: renders an editable handoff textarea, labeled by source (cached vs mechanical)`, () => {
    const body = wholeFunction(fillFn, indent);
    assert.match(body, /class:\s*"ws-pane-dialog-handoff"/, "the shared CSS class, so both surfaces look the same");
    assert.match(body, /handoff\.source === "cached" \? "AI-drafted handoff/);
  });

  test(`${fillFn}: preserves the user's OWN edited text across a refill — never overwrites a human mid-edit`, () => {
    const body = wholeFunction(fillFn, indent);
    assert.match(body, /const keepHandoff = \w+\._wrapDialog\.handoffEdited;/);
    assert.match(body, /handoffBox\.value = keepHandoff \? priorHandoffValue : handoff\.text;/);
    assert.match(body, /handoffBox\.addEventListener\("input", \(\) => \{ \w+\._wrapDialog\.handoffEdited = true; \}\);/);
  });

  test(`${fillFn}: captures the PRIOR textarea value before the body is wiped (replaceChildren destroys the old node)`, () => {
    const body = wholeFunction(fillFn, indent);
    const keepIdx = body.indexOf("keepHandoff");
    const wipeIdx = body.indexOf("replaceChildren()");
    assert.ok(keepIdx >= 0 && wipeIdx > keepIdx, "the capture must happen BEFORE replaceChildren, or the value is already gone");
  });
}

test("the PACT_HANDOFF_REFRESH_MS / WS_HANDOFF_REFRESH_MS constants are declared ABOVE their function, never inside a closure referenced before declaration (see lib/appScopeLeaks.test.mjs)", () => {
  for (const name of ["PACT_HANDOFF_REFRESH_MS", "WS_HANDOFF_REFRESH_MS"]) {
    const declIdx = app.indexOf(`const ${name} = 2500;`);
    const useIdx = app.indexOf(`}, ${name});`);
    assert.ok(declIdx >= 0 && useIdx >= 0 && declIdx < useIdx, `${name} must be declared before its use`);
  }
});
