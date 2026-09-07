// node --test lib/chatShellRoleSlots.test.mjs
//
// WHY THIS EXISTS: two bugs, both reported as "the live workspace does not look like the Chat Shell
// Lab", both with causes nobody would guess from reading the markup.
//
// 1. CSS COMMENT CLOSING EARLY. The lab's own <style> opened with a comment documenting the theme
//    variables, and that comment contained the text "--bub-*/etc." — a literal `*/` INSIDE it. CSS
//    comments end at the first `*/`, so the comment closed three lines early, the rest of it became
//    live CSS, and the parser recovering from that garbage swallowed the very next rule whole:
//    `*{box-sizing:border-box}`. Every element in the lab silently fell back to `content-box`, while
//    production (which has its own reset in styles.css) did not — so the lab, the one page that is
//    supposed to BE the design, was the only page rendering it wrong. The visible symptoms were a
//    type box a whole row taller than its content and prompt text overlapping the line-number gutter,
//    because chat-shell.js's geometry computes border-box sizes.
//
// 2. ROLE SUBSTITUTION vs TRAILING SLOTS. Pact's repo/worktree pickers and model picker are richer
//    than the package's natives, so Pact hid the natives and appended its own to `actionExtra` /
//    `modelExtra` — slots that sit at the END of their rows. The row order therefore disagreed with
//    the Lab's (repo/branch after ⇕Full, the model picker after effort), and because a slot did not
//    wrap its own children, a narrow Pact pane collapsed into ragged part-empty rows. A control for a
//    role now mounts AT that role's position, and the native is simply not mounted.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const pub = (f) => readFileSync(join(__dir, "..", "dashboard", "public", f), "utf8");
const pkg = (f) => readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", f), "utf8");

/* ============================ 1. the comment that ate a rule ================================= */

/** Strips CSS comments the way a CSS parser does: a comment ends at the FIRST `*/` after `/*`. */
function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ""); }

function labStyleBlock() {
  const html = pub("chat-shell-lab.html");
  const open = html.indexOf("<style>");
  const close = html.indexOf("</style>", open);
  assert.ok(open >= 0 && close > open, "the lab must have an inline <style> block");
  return html.slice(open + "<style>".length, close);
}

test("no comment in the lab's stylesheet closes early — an unmatched */ means a rule got eaten", () => {
  const live = stripComments(labStyleBlock());
  // After correctly stripping comments, a surviving `*/` can only be the tail of a comment that
  // already closed somewhere earlier than intended. That is the exact signature of this bug, and it
  // is invisible in the source: the text reads like one continuous comment.
  assert.ok(!live.includes("*/"),
    "an unmatched */ survives comment-stripping — a comment closed early and whatever followed it, " +
    "including the next rule, is being parsed as CSS");
});

test("the lab's box-sizing reset is real CSS, not text trapped inside a comment", () => {
  const live = stripComments(labStyleBlock()).replace(/\s+/g, "");
  assert.ok(live.includes("*{box-sizing:border-box}"),
    "the lab must reset box-sizing OUTSIDE any comment: chat-shell.js's geometry (paintGutter's " +
    "gutter width and layoutNow's type-box height) computes border-box sizes, so under content-box " +
    "the type box renders a row too tall and the text overlaps the gutter");
});

/* ============================ 2. role substitution =========================================== */

test("a slot wraps its own children, so it cannot drag a whole row with it", () => {
  const css = pkg("components.css");
  const rule = css.match(/\.cs-shell \.cs-inline \{[^}]*\}/);
  assert.ok(rule, ".cs-inline must be declared in the package's component sheet");
  assert.ok(/flex-wrap:\s*wrap/.test(rule[0]),
    "a slot holding several controls must wrap them like the row does (.hrow/.frow are flex-wrap: " +
    "wrap); as one indivisible block it jumps to its own line and takes every control with it");
});

test("every substitutable role is mounted at its role's position, never appended to a trailing slot", () => {
  const ui = pkg("chat-shell-ui.js");
  assert.ok(/function role\(name, native\) \{ return slots\[name\] \|\| native; \}/.test(ui),
    "the package must offer role substitution: a host's own control REPLACES the native one");
  // The action row's repo/worktree position, and the model row's picker/readout/permission/context
  // positions — these are exactly the roles whose hosts have richer controls.
  // Rows are groups now (see lib/chatShellRowGroups.test.mjs), so a role sits at its position WITHIN
  // its group — the ordering guarantee is unchanged, the container around it is not.
  assert.ok(/CS\.grp\(\[role\("meta", metaGroup\)\]\)/.test(ui),
    "the repo/worktree role must be its own group, before the history/bookmark/expand group, as in the Lab");
  assert.ok(/CS\.grp\(\[histBtn, role\("bookmarks", bmBtn\), expandBtn, actionExtra\]\)/.test(ui),
    "bookmarks must be substitutable, at its own position — Pact's richer bookmark popup used to be " +
    "hidden here entirely and re-appended in a separate row above the compose box instead");
  // The model row is four STACKED pairs now (CS.stack): a control over its own caption. The role
  // positions are unchanged — what changed is that each role's companion sits under it rather than
  // beside it, so "· running Opus 5" reads as a caption on the picker instead of a duplicate of it.
  assert.ok(/CS\.stack\(\[role\("modelPick", modelSel\)\], \[role\("modelNow", modelNow\)\]\)/.test(ui),
    "the model picker comes FIRST on the model row, captioned by the running-model readout beneath it");
  assert.ok(/CS\.stack\(\[effortSel\], \[role\("permission", permSel\), modelExtra\]\)/.test(ui),
    "effort sits over the permission mode it runs under — and permission stays substitutable, at its own position");
  // The context readout is no longer ON the model row at all — it is the LAST group of the header's
  // stats row, which is what makes it the right-hand one there. It keeps its role hook so a host can
  // still substitute a richer readout.
  assert.ok(/var ctxGroup = CS\.grp\(\[role\("context", ctxBtn\)\]\)/.test(ui),
    "the context readout must be its own group, last in the header's stats row");
  assert.ok(!/modelRowContent:[^\]]*role\("context"/.test(ui),
    "…and must not still be wedged into the model row as well");
});

test("Pact substitutes its richer controls by ROLE — it does not hide the natives and trail its own", () => {
  const app = pub("app.js");
  const mount = app.slice(app.indexOf("window.ChatShellUI.mount(host, {"));
  const opts = mount.slice(0, mount.indexOf("on: {"));
  for (const role of ["meta:", "modelPick: pactModelSel", "permission: modeSel", "bookmarks: bmWrap"]) {
    assert.ok(opts.includes(role), `Pact must pass its own control for the role: ${role}`);
  }
  // modelNow and context are NOT substituted, and must not be again: Pact was handing over a bare
  // span where Core uses the package's chip, so the same two readouts rendered as plain grey text in
  // one workspace and as chips in the other ("why isn't this looking similar between the two
  // places"). Substitution is for a control that is genuinely RICHER than the native — a readout
  // that only ever shows text is not.
  for (const role of ["modelNow: modelNow", "context: usageEl"]) {
    assert.ok(!opts.includes(role),
      `${role} must use the package's own node — a plain readout has nothing richer to offer`);
  }
  assert.ok(app.includes("usageEl = pv.els.contextBtn; usageEl.classList.add(\"pc-usage\");"),
    "…and Pact's class name is aliased onto the package's node, so its by-class updaters still find it");
  // swarmEl has no native counterpart, so it is a genuine extra and belongs in the trailing slot.
  assert.ok(/modelExtra: \[swarmEl\]/.test(opts),
    "only controls with NO native counterpart may go in a trailing slot");
  assert.ok(!/modelExtra: \[pactModelSel/.test(opts),
    "the model picker must never be dumped in the trailing slot again — that is what put it after " +
    "the effort selector while the Lab shows it first");
});
