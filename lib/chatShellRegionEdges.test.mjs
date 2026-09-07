// node --test lib/chatShellRegionEdges.test.mjs
//
// TWO REPORTS, ONE FILE, because they turned out to be the same class of defect: a rule that reads
// correct in the source and loses in the browser.
//
//   1. "the header/footer and the core chat space have the SAME background colour and you can't see
//      that there's a border." Measured before the fix: Core painted rgb(8,12,24) for all three
//      regions, Pact rgb(19,27,38) for all three — even though components.css's own comment describes
//      "CORE = the reading surface, the LIGHTEST thing in the shell; HEADER/FOOTER = clearly DARKER".
//      The tone step existed as prose only: --hdr, --ftr and the core background all aliased --panel.
//
//   2. "the buttons need to be orange (working) and red (deep work), which they aren't." Measured:
//      idle == busy == deep == var(--acc) in Core, Pact AND the Lab. Those colours were keyed to
//      production's own `.ws-send`/`.pc-send` classes, which stopped existing on the button when both
//      workspaces migrated to the package's `.btn-send` — and `.cs-shell .btn-send` is the same
//      specificity AND loaded later, so it won even where a class did survive.
//
// The trap in #1's fix is worth its own test and gets one below: a `.ws-pane.on` focus override is
// specificity (0,2,0) and silently loses to the theme file's own `body[data-theme="dark"] .ws-pane`
// at (0,2,1). Written in styles.css it tested green and computed to the UNFOCUSED colour in a real
// browser. So this file checks the CASCADE, not just the text.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const pkg = (f) => readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", f), "utf8");
const pub = (f) => readFileSync(join(__dir, "..", "dashboard", "public", f), "utf8");
const theme = pkg("theme.css"), components = pkg("components.css");
const styles = pub("styles.css"), lab = pub("chat-shell-lab.html");

/** CSS specificity of a single (comma-free) selector, as [ids, classes/attrs/pseudo-classes, types].
 *  Enough for the flat selectors these stylesheets actually use. */
function specificity(sel) {
  let s = sel.trim().replace(/::[a-z-]+/g, " ");           // pseudo-ELEMENTS count as type; drop then re-add
  const els = (sel.match(/::[a-z-]+/g) || []).length;
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const cls = (s.match(/\.[\w-]+/g) || []).length
            + (s.match(/\[[^\]]+\]/g) || []).length
            + (s.match(/:(?!:)[a-z-]+/g) || []).length;
  s = s.replace(/#[\w-]+/g, " ").replace(/\.[\w-]+/g, " ").replace(/\[[^\]]+\]/g, " ").replace(/:(?!:)[a-z-]+/g, " ");
  const types = (s.match(/\b[a-z][\w-]*/gi) || []).length + els;
  return [ids, cls, types];
}
const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);

/** Every selector in `css` whose block declares `prop`. */
function declaringSelectors(css, prop) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (new RegExp("(^|[;\\s])" + prop.replace(/[-]/g, "\\-") + "\\s*:").test(m[2])) {
      for (const sel of m[1].split(",")) if (sel.trim() && !sel.trim().startsWith("@")) out.push(sel.trim());
    }
  }
  return out;
}

/* ---- 1. the tone step is real, not just described ---------------------------------------------- */

test("the core region does NOT paint the same token as the header and footer — the tone step is in values", () => {
  const core = /\.cs-shell \.rg-core \{[^}]*background:\s*var\(([^)]+)\)/.exec(components);
  const head = /\.cs-shell \.rg-header \{[^}]*background:\s*var\(([^)]+)\)/.exec(components);
  const foot = /\.cs-shell \.rg-footer \{[^}]*background:\s*var\(([^)]+)\)/.exec(components);
  assert.ok(core && head && foot, "all three regions must declare a background");
  assert.notEqual(core[1], head[1], "the reading surface and the chrome must not be the same token — that was the bug");
  // --hdr and --ftr are distinct names on purpose (a theme may want to move one alone), but they are
  // both CHROME: they must alias the same base, or "header and footer read as one surface" is luck.
  for (const t of [head[1], foot[1]]) {
    assert.match(theme, new RegExp("\\" + t + ":\\s*var\\(--panel\\)"), `${t} must alias --panel — it is chrome`);
  }
  assert.ok(!theme.includes("--core-bg: var(--panel);"), "…and the reading surface must NOT be that same value");
  assert.equal(core[1], "--core-bg", "the reading surface has its own token so a theme can move it alone");
});

test("--core-bg is defined for BOTH workspaces and is derived from --panel, so light mode steps too", () => {
  const decls = theme.match(/--core-bg:\s*([^;]+);/g) || [];
  assert.ok(decls.length >= 3, "core, pact and the theme-independent alias block must each define it");
  for (const d of decls) assert.match(d, /var\(--panel\)/, `--core-bg must derive from --panel, not be a hard-coded hex: ${d}`);
});

/* ---- 2. the seams read the same token as the frame --------------------------------------------- */

test("region seams and the shell's own frame are ONE token, at ONE width", () => {
  for (const [re, what] of [[/\.cs-shell \.rg-header \{[^}]*border-bottom:\s*([^;]+);/, "header seam"],
                            [/\.cs-shell \.rg-footer \{[^}]*border-top:\s*([^;]+);/, "footer seam"]]) {
    const m = re.exec(components);
    assert.ok(m, `${what} must declare a border`);
    assert.match(m[1], /var\(--seam-w\)/, `${what} must take the shared width token, not a literal`);
    assert.match(m[1], /var\(--edge\)/, `${what} must take the frame's own colour token`);
  }
  // Production's two frames — a Core pane and Pact's chat box — must read the same pair, or the
  // "same thickness in both workspaces" property is a coincidence rather than a guarantee.
  for (const sel of ["\n.ws-pane {", "\n.pact-chat, .pact-term {"]) {
    const i = styles.indexOf(sel);
    assert.ok(i > 0, `${sel} must exist`);
    const block = styles.slice(i, styles.indexOf("}", i));
    assert.match(block, /border:\s*var\(--seam-w[^;]*\)\s+solid\s+var\(--edge/, `${sel} frame must read --seam-w and --edge`);
  }
  assert.equal((theme.match(/--seam-w:/g) || []).length, 1, "exactly one place defines the seam width");
});

test("the Lab's own frame reads --edge too — the design source must show frame and seams agreeing", () => {
  const m = /#shell\{[^}]*border:\s*([^;]+);/.exec(lab);
  assert.ok(m, "the lab shell must declare a frame");
  assert.match(m[1], /var\(--edge\)/, "…and it must be the same token the seams use");
});

/* ---- 3. THE CASCADE TRAP -----------------------------------------------------------------------
 * This is the test that would have caught the bug I actually shipped mid-fix. */

test("the focused-pane --edge override outranks every other --edge declaration that also matches a pane", () => {
  const css = theme + "\n" + styles;
  const decls = declaringSelectors(css, "--edge");
  assert.ok(decls.length >= 3, "--edge must be declared somewhere for panes, Pact and focus");

  const focus = decls.filter((s) => /\.ws-pane\.on\b/.test(s));
  assert.ok(focus.length, "a focused Core pane must declare its own --edge");
  const best = focus.map(specificity).sort(cmp).pop();

  // Any OTHER declaration that a `.ws-pane` element can also match must not outrank the focus rule,
  // or focus computes to the unfocused colour — exactly what happened, in a browser, while every
  // test was green.
  const rivals = decls.filter((s) => !/\.ws-pane\.on\b/.test(s) && /\.ws-pane\b/.test(s));
  assert.ok(rivals.length, "the theme blocks that set --edge for a pane must exist (else this test proves nothing)");
  for (const r of rivals) {
    assert.ok(cmp(specificity(r), best) <= 0,
      `"${r}" (${specificity(r)}) outranks the focus rule (${best}) — a focused pane would keep the unfocused edge`);
  }
});

test("the specificity helper itself is right, or the guard above is decoration", () => {
  assert.deepEqual(specificity(".ws-pane.on"), [0, 2, 0]);
  assert.deepEqual(specificity('body[data-theme="dark"] .ws-pane'), [0, 2, 1]);
  assert.deepEqual(specificity('body[data-theme="dark"] .ws-pane.on'), [0, 3, 1]);
  assert.deepEqual(specificity("#shell"), [1, 0, 0]);
  // The exact comparison the guard makes: the shipped bug, and its fix.
  assert.ok(cmp(specificity('body[data-theme="dark"] .ws-pane'), specificity(".ws-pane.on")) > 0,
    "the theme block really does beat a bare .ws-pane.on — this is the trap");
  assert.ok(cmp(specificity('body[data-theme="dark"] .ws-pane'), specificity('body[data-theme="dark"] .ws-pane.on')) < 0,
    "…and matching the theme's own shape is what fixes it");
});

/* ---- 4. working / deep work belong to the package ---------------------------------------------- */

test("the package owns the working and deep-work colours — not production's own button selectors", () => {
  assert.match(components, /\.cs-shell \.btn-send\.--busy[^{]*\{[^}]*background:\s*var\(--work\)/,
    "the working state must be styled on the PACKAGE's button, or the Lab can never show it");
  assert.match(components, /\.cs-shell \.btn-send\.--deep[^{]*\{[^}]*background:\s*var\(--work-deep\)/,
    "and so must deep work");
  // Production toggles the bare class names directly; those must keep working, or the fix is live
  // only where a call site happened to be migrated.
  assert.match(components, /\.cs-shell \.btn-send\.busy\b/, "production's own `busy` class must still be honoured");
  assert.match(components, /\.cs-shell \.btn-send\.deepwork\b/, "…and `deepwork` too");
  // Deep work must come AFTER busy: production sets the two independently, so the tie has to break
  // toward red. (Same-specificity rules — source order is the whole mechanism.)
  assert.ok(components.indexOf(".cs-shell .btn-send.--deep") > components.indexOf(".cs-shell .btn-send.--busy"),
    "deep work is declared after busy so it wins the tie");
});

test("the work colours are workspace-INDEPENDENT, like --ok/--warn/--err", () => {
  const root = /:root \{([^}]*)\}/.exec(theme);
  assert.ok(root, ":root must exist");
  for (const t of ["--work:", "--work-deep:"]) assert.ok(root[1].includes(t), `${t} belongs in :root — a running turn looks the same in every workspace`);
  for (const t of ["--work:", "--work-deep:"]) {
    assert.equal((theme.match(new RegExp(t.replace("-", "\\-"), "g")) || []).length, 1, `${t} must be defined exactly once`);
  }
});

test("the blinking work ring exists in the package with its own keyframe name", () => {
  assert.match(components, /@keyframes csWorkPulse/, "the Lab loads no styles.css, so the keyframes must live here");
  assert.match(components, /\.cs-shell \.btn-send\.work-pulse/, "production's existing class must drive it");
  assert.match(components, /prefers-reduced-motion: reduce/, "…with a still fallback for reduced motion");
});

/* ---- 5. the Lab can actually SHOW all of this --------------------------------------------------- */

test("the Lab drives the work state through the package's own API, and offers every state", () => {
  assert.match(lab, /sending:\s*\{\s*state:\s*S\.work/, "the Lab must publish the state through setState, not by poking classes");
  for (const id of ["wIdle", "wBusy", "wDeep", "wBg"]) {
    assert.ok(lab.includes('id="' + id + '"'), `the Lab needs a ${id} control, or the state is undemonstrable`);
  }
  assert.match(lab, /\["wBusy",\s*"busy"/, "working must be wired");
  assert.match(lab, /\["wDeep",\s*"deep"/, "deep work must be wired");
  // Background-only is the interesting one: the ring blinks while the button still reads "Send".
  assert.match(lab, /\["wBg",\s*null,\s*true\]/, "background-only work must NOT set a turn state");
});
