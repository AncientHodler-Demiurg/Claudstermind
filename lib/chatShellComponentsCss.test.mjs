// node --test lib/chatShellComponentsCss.test.mjs
//
// WHY THIS EXISTS: theme (1.6.5) unified the PALETTE and frame (1.7.0) unified the REGION STRUCTURE,
// but every widget inside the shell — chips, bubbles, P#/R# medallions, the type box, the gutter, the
// joined Compact│Wrap control — was still TWO implementations: the Chat Shell Lab's `.chip`/`.msg`/
// `.sel`/`.btn-send` and production's parallel `.exo-chip`/`.ws-line`/`.ws-send`. They happened to be
// in the same places and drifted on look, which is exactly why the live workspaces kept reading as a
// different application from the Lab no matter how many individual values were copied across.
//
// chat-shell-components.css is now the ONE copy. These tests pin the property that makes that true and
// keeps it true: the rules exist in exactly one file, BOTH pages load that same file, neither page
// re-declares them locally, and every rule is scoped so it cannot leak into the rest of the dashboard.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const pub = (f) => readFileSync(join(__dir, "..", "dashboard", "public", f), "utf8");
// The chat box is a PACKAGE now — its files live in packages/claude-chat-shell/src and are served
// at /chat-shell/*, by the dashboard and the Chat Shell Lab alike, from that one directory.
const pkg = (f) => readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", f), "utf8");
const components = pkg("components.css");
const lab = pub("chat-shell-lab.html");
const index = pub("index.html");
const styles = pub("styles.css");
const app = pub("app.js");

test("the component stylesheet is loaded by BOTH the lab and production — the same file, not two copies", () => {
  assert.ok(lab.includes('<link rel="stylesheet" href="/chat-shell/chat-shell.css">'),
    "the lab must link the package's stylesheet");
  assert.ok(index.includes('<link rel="stylesheet" href="/chat-shell/chat-shell.css" />'),
    "production must link the very same URL");
  // Order matters in production: scoped though they are, these rules must be able to win against
  // production's own long-standing element rules, which live in styles.css.
  assert.ok(index.indexOf('href="/styles.css"') < index.indexOf('href="/chat-shell/chat-shell.css"'),
    "production must load the shared component sheet AFTER styles.css so the lab's design wins");
});

test("every rule is scoped to .cs-shell — nothing can leak into the rest of the dashboard", () => {
  // A bare `button {}` or `.chip {}` from the lab would restyle the file editor, the rail and the
  // landing page the moment production loaded this file. Each selector in a group must carry the scope.
  const body = components.replace(/\/\*[\s\S]*?\*\//g, "");            // strip comments
  const offenders = [];
  for (const m of body.matchAll(/(^|\})\s*([^{}@]+)\{/g)) {
    const sel = m[2].trim();
    if (!sel || sel.startsWith("@") || sel.startsWith("from") || sel.startsWith("to") || /^\d+%/.test(sel)) continue;
    for (const one of sel.split(",")) {
      const s = one.trim();
      if (s && !s.startsWith(".cs-shell")) offenders.push(s);
    }
  }
  assert.deepEqual(offenders, [], "every selector must start with .cs-shell");
});

test("the lab no longer carries its own copy of the component rules", () => {
  const style = lab.slice(lab.indexOf("<style>"), lab.indexOf("</style>"));
  for (const gone of [".msg.--u{", ".msg.--a{", ".num-r{", ".gutter{", ".sendgrp{", ".btn-send{",
                      ".seambulb{", ".split .splitL{", ".tawrap{", ".sel{"]) {
    assert.ok(!style.includes(gone), `${gone} must live only in chat-shell-components.css, not in the lab's own <style>`);
  }
  // …and neither does production, in its own stylesheet.
  assert.ok(!styles.includes(".cs-shell"), "production's styles.css must not re-declare the shared scope either");
});

test("both production chat containers carry the .cs-shell scope class, or none of it applies", () => {
  // Neither workspace applies it by hand any more — mount() does, for every consumer.
  assert.ok(app.includes("window.ChatShellUI.mount(paneRoot, {"), "a Core pane must be mounted through the package");
  assert.ok(app.includes("window.ChatShellUI.mount(host, {"), "…and so must Pact's desktop chat host");
  assert.ok(lab.includes('id="shell" class="cs-shell"'), "…and so must the lab's shell, or it is styling something else");
  // mount() is what puts the class there for any OTHER consumer, so it is the real guarantee.
  assert.ok(pkg("chat-shell-ui.js").includes('host.classList.add("cs-shell");'),
    "mount() must apply the scope class itself — a consumer must not have to remember to");
});

test("production mounts the package rather than building its own chat box", () => {
  // The real guarantee is not "these class names appear in app.js" — it is that neither workspace
  // constructs chat-box markup at all any more. Both hand a host element to mount() and wire
  // callbacks; the package owns every control, so there is nothing left to drift.
  for (const [needle, why] of [
    ["window.ChatShellUI.mount(paneRoot, {", "Core mounts the package"],
    ["window.ChatShellUI.mount(host, {", "Pact's desktop path mounts the package"],
    ["const promptEl = view.els.typebox;", "Core's compose field IS the package's"],
    ["input = pv.els.typebox;", "…and so is Pact's"],
    ["const sendBtn = view.els.sendBtn;", "Core's Send is the package's"],
    ["send = pv.els.sendBtn;", "…and so is Pact's"],
    ["const seamBulb = view.els.seamBulb;", "the Live/Held marker is the package's"],
    ["pactSeamBulb = pv.els.seamBulb;", "…in both workspaces"],
  ]) assert.ok(app.includes(needle), why);
  // …and the constructions they replaced are genuinely gone, not left duplicated alongside.
  for (const gone of ['class: "ws-tawrap tawrap"', 'class: "ws-gutter gutter"',
                      'class: "loginbtn ws-send btn-send"', 'class: "ws-lines-chip chip"']) {
    assert.ok(!app.includes(gone), gone + " must be gone — the package builds it now");
  }
});

test("the addressing-scheme colours are declared ONCE, workspace-independently", () => {
  // P# blue / R# violet must be identical in Core, Pact and the lab: they are how a turn is addressed,
  // not decoration. Declared in the shared theme file's :root, never inside a per-workspace block.
  const theme = pkg("theme.css");
  assert.ok(/:root\s*\{[^}]*--tag-r-bg:\s*#c77dff/.test(theme), "R# violet must be a global token");
  assert.ok(/:root\s*\{[^}]*--tag-p-bg:\s*#1b4fc4/.test(theme), "P# blue must be a global token");
  assert.ok(!lab.slice(lab.indexOf("<style>"), lab.indexOf("</style>")).includes("--tag-r-bg:"),
    "the lab must not re-declare them locally");
});
