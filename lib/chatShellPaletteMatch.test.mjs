// node --test lib/chatShellPaletteMatch.test.mjs
// Side-by-side comparison against the real chat-shell lab showed production still reading as a
// visibly different palette, despite the header/footer/gutter/expand layout work landing correctly.
// A first pass (this file's original version) copied the lab's hex values into styles.css — matching
// in VALUE, but still two separately-maintained copies, which is not what "same colours" turned out to
// mean: the user wanted ONE block of code, edited once, driving both surfaces. This now asserts that
// stronger property: dashboard/public/chat-shell-theme.css is the SINGLE place these hex values are
// defined, styles.css reaches them only via @import (no duplicate hex), and chat-shell-lab.html reaches
// them only via a real <link> (no duplicate hex either) — so editing the shared file is provably the
// only way to change either surface's colours. Wiring-presence checks (app.js/styles.css "boots the
// DOM"), same convention as the rest of this migration.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const pub = (name) => readFileSync(join(__dir, "..", "dashboard", "public", name), "utf8");
const theme = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "theme.css"), "utf8");
const css = pub("styles.css");
const lab = pub("chat-shell-lab.html");

function block(src, selectorNeedle) {
  const i = src.indexOf(selectorNeedle);
  assert.ok(i >= 0, `selector not found: ${selectorNeedle}`);
  const open = src.indexOf("{", i);
  const close = src.indexOf("}", open);
  return src.slice(open + 1, close);
}

test("the package's own stylesheet is what pulls the palette in — production does not re-import it", () => {
  // styles.css used to @import the theme file directly. It no longer needs to: index.html links the
  // package's single stylesheet, which imports theme/frame/components itself. A consumer of the
  // package adds ONE <link> and is done — that is the drop-in contract.
  const entry = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "chat-shell.css"), "utf8");
  assert.ok(entry.includes('@import url("./theme.css");'), "the package entry stylesheet must pull in the palette");
  // The thing that must not exist is an @IMPORT, not the word. Substring-matching the filename made
  // this fail the moment a comment in styles.css pointed a reader at the theme file for the reason
  // a value lives there rather than here — which is the opposite of drift, and exactly the sort of
  // note that should be encouraged.
  assert.ok(!/@import[^;]*chat-shell-theme\.css/.test(css), "the host app must not reach around the package for it");
  assert.ok(!/@import[^;]*(theme|frame|components)\.css/.test(css), "…nor for any other of the package's parts");
});

test("chat-shell-lab.html reaches the SAME shared theme file via a real <link>, not a copy", () => {
  assert.ok(lab.includes('<link rel="stylesheet" href="/chat-shell/chat-shell.css">'), "the lab must link the package stylesheet that pulls it in");
});

test("neither styles.css nor the lab still hardcodes the palette hex values — the shared file is the only source", () => {
  // These exact hex values used to be duplicated in styles.css AND in the lab's own <style> block.
  // If either still contains them directly (outside the shared file), a future edit could silently
  // diverge the two again.
  assert.ok(!css.includes("--bub-u: #243059"), "styles.css must not hardcode Core's bubble colour itself");
  assert.ok(!css.includes("--bub-u: #2b4152"), "styles.css must not hardcode Pact's bubble colour itself");
  assert.ok(!lab.includes("--panel:#1a2440"), "the lab must not hardcode Core's panel colour itself");
  assert.ok(!lab.includes("--panel:#25303f"), "the lab must not hardcode Pact's panel colour itself");
});

test("the shared theme file defines Core's full dark palette + bubble tokens, matched to BOTH documents' selectors", () => {
  const b = block(theme, 'body[data-theme="dark"] .ws-pane, body[data-theme="core"] {');
  assert.ok(b.includes("--panel: #080c18") && b.includes("--bg-2: #1a2440") && b.includes("--panel-2: #131d34"));
  assert.ok(b.includes("--line: #22304a") && b.includes("--ink: #e7ecff") && b.includes("--ink-soft: #9aa6c7"));
  assert.ok(b.includes("--bub-u: #243059") && b.includes("--bub-a: #121b30"));
  // lab-native aliases, so chat-shell-lab.html's OWN existing rules (var(--acc)/var(--panel2)/
  // var(--chip)/var(--field)/var(--seam)) resolve correctly without the lab needing any rule changes.
  assert.ok(b.includes("--acc: var(--accent)") && b.includes("--chip: var(--panel-2)") && b.includes("--field: var(--panel-2)"));
});

test("the shared theme file defines Pact's full dark palette + bubble tokens, matched to BOTH documents' selectors", () => {
  const b = block(theme, 'body[data-theme="dark"] .pact-right, body[data-theme="pact"] {');
  assert.ok(b.includes("--panel: #131b26") && b.includes("--bg-2: #25303f") && b.includes("--panel-2: #1c2634"));
  assert.ok(b.includes("--line: #3a4757") && b.includes("--ink: #eef4fa") && b.includes("--ink-soft: #a8b6c6"));
  assert.ok(b.includes("--bub-u: #2b4152") && b.includes("--bub-a: #1d2735"));
});

test("light mode is untouched in the shared file (the lab has no light design; only accent differs there)", () => {
  const b = block(theme, 'body[data-theme="light"] .ws-pane {');
  assert.ok(!b.includes("--panel:") && !b.includes("--bg-2:"), "light mode must not be given dark hex values");
});

test("both message bubbles (production AND Pact) read the shared tokens directly, not just an accent-derived guess", () => {
  assert.ok(css.includes("background: var(--bub-u, color-mix(in srgb, var(--accent) 26%, var(--panel-2)))"), "Core user bubble");
  assert.ok(css.includes("background: var(--bub-a, var(--chip))") && css.includes(".ws-line.ws-assistant"), "Core assistant bubble reads --bub-a");
  assert.ok(css.includes('background: var(--bub-u, #2f6feb)'), "Pact user bubble — the OLD fixed loud blue (#2f6feb) is now only a fallback, not the live value");
  assert.ok(!css.includes(".pc-user { align-self: flex-end; background: #2f6feb;"), "the old unconditional fixed-blue rule must be gone");
});
