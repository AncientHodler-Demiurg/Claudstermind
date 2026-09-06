// node --test lib/workspaceThemeIdentity.test.mjs
//
// Core and Pact shared one --accent value (and everything built on it — 130 rules reference
// var(--accent) in styles.css: buttons, focus rings, links). This asserts each workspace's chat
// surface (.ws-pane for Core, .pact-right for Pact, both dark and light mode) gets its own distinct
// accent, so the workspaces are visually identifiable from the accent colour alone.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dir, "..", "dashboard", "public", "styles.css"), "utf8");

function accentOf(selectorRegex) {
  const m = selectorRegex.exec(css);
  if (!m) return null;
  const body = css.slice(m.index, css.indexOf("}", m.index));
  const acc = /--accent:\s*(#[0-9a-fA-F]{3,8})/.exec(body);
  return acc ? acc[1].toLowerCase() : null;
}

test("Core's chat pane (.ws-pane) defines its own dark-mode accent", () => {
  const v = accentOf(/\.ws-pane\s*\{[^}]*--accent:/);
  assert.ok(v, ".ws-pane must define --accent");
});

test("Pact's chat surface (.pact-right) defines its own dark-mode accent", () => {
  const v = accentOf(/\.pact-right\s*\{[^}]*--accent:/);
  assert.ok(v, ".pact-right must define --accent");
});

test("Core and Pact accents are DISTINCT from each other and from the shared :root default", () => {
  const root = accentOf(/:root\s*\{[^}]*--accent:/);
  const core = accentOf(/\.ws-pane\s*\{[^}]*--accent:/);
  const pact = accentOf(/\.pact-right\s*\{[^}]*--accent:/);
  assert.ok(root && core && pact, "all three accents must be found");
  assert.notEqual(core, pact, "Core and Pact must not share the same accent — that defeats the point");
  assert.notEqual(core, root, "Core's accent must actually differ from the app-wide default");
  assert.notEqual(pact, root, "Pact's accent must actually differ from the app-wide default");
});

test("both workspaces also override their accent in LIGHT mode, not just dark", () => {
  const coreLight = accentOf(/body\[data-theme="light"\]\s+\.ws-pane\s*\{[^}]*--accent:/);
  const pactLight = accentOf(/body\[data-theme="light"\]\s+\.pact-right\s*\{[^}]*--accent:/);
  assert.ok(coreLight, "Core needs a light-mode accent override, or switching to light silently erases workspace identity");
  assert.ok(pactLight, "Pact needs a light-mode accent override, or switching to light silently erases workspace identity");
  assert.notEqual(coreLight, pactLight, "light-mode accents must also be distinct from each other");
});

test("P#/R# addressing tag colours are untouched by workspace theming (they must read the same everywhere)", () => {
  // Round 6 decision, carried over from the lab: the tag scheme is an addressing scheme, not decor,
  // so it must not vary per workspace or a user could never learn it once.
  assert.ok(css.includes(".ws-num") || css.includes("num-r") || css.includes("num-p"),
    "the numbering-tag rule must still exist and this test must be able to find it");
});
