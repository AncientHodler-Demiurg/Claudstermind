// node --test lib/compositedAnimations.test.mjs
//
// "It's so laggy on so many chat views (8 that I have now) that it's hard to use."
//
// Profiled with eight panes at 6x CPU throttle, and the answer was not JavaScript: 71% of the main
// thread sat in V8's `(program)` bucket — layout, style and PAINT. Splitting it further:
//
//     TaskDuration 4833 ms | Script 351 (7%) | Layout 697 (14%) | Style 292 (6%) | PAINT 3688 (73%)
//
// Bisected by disabling one animation at a time. It was ONE:
//
//     baseline                  4833 ms main thread   3590 ms paint   1412 style recalcs / 20 s
//     box-shadow pulse OFF      2206 ms                895 ms          366
//     spinner OFF               4853 ms               3559 ms         1443   (i.e. free)
//
// One animation was 54% of ALL main-thread work — with only ONE pane busy. A cockpit with eight busy
// panes runs eight of them.
//
// WHY: `box-shadow` is not a compositable property. Animating it re-runs style and re-paints the
// element AND the area the shadow bleeds into, every frame, on the main thread. `opacity` on a
// promoted layer is handled entirely by the compositor — no style, no paint, no main-thread work.
// The spinner measured free precisely because it animates `transform`, which is also composited.
//
// After: 2620 ms main thread (-46%), 1040 ms paint (-71%), 416 style recalcs (-71%). And the control
// flipped meaning: forcibly disabling the pulse now changes almost nothing (2297 vs 2620), where
// before it halved the workload.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const sheets = {
  "components.css": readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "components.css"), "utf8"),
  "styles.css": readFileSync(join(__dir, "..", "dashboard", "public", "styles.css"), "utf8"),
};

/** Every @keyframes block, as { name → the properties it animates }. */
function keyframeProps(css) {
  const out = {};
  const re = /@keyframes\s+([A-Za-z0-9_-]+)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    // Walk braces from the opening one so nested keyframe steps are included whole.
    let depth = 0, i = re.lastIndex - 1, end = i;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") { depth--; if (!depth) { end = i; break; } }
    }
    const body = css.slice(re.lastIndex, end);
    out[m[1]] = [...body.matchAll(/([a-z-]+)\s*:/g)].map((x) => x[1]);
  }
  return out;
}

// Only these can be animated without main-thread work. `filter` is GPU-capable but expensive on a
// software rasteriser, so it is not on the list.
const COMPOSITED = new Set(["opacity", "transform", "rotate", "scale", "translate"]);

test("the work-pulse animates ONLY compositable properties — this one was 54% of the main thread", () => {
  for (const [file, css] of Object.entries(sheets)) {
    const kf = keyframeProps(css);
    for (const name of ["csWorkPulse", "wsWorkPulse"]) {
      if (!kf[name]) continue;
      for (const prop of kf[name]) {
        assert.ok(COMPOSITED.has(prop),
          `${file} @keyframes ${name} animates "${prop}" — box-shadow (and anything else off this list) `
          + "cannot be composited, so every frame re-paints on the main thread, times one per open pane");
      }
    }
  }
});

test("the ring itself is a STATIC shadow on a pseudo-element, so the look is unchanged", () => {
  const c = sheets["components.css"];
  assert.match(c, /\.cs-shell \.btn-send\.work-pulse::after[^{]*\{[^}]*box-shadow: 0 0 0 2px/,
    "the ring must still be drawn — moving it to ::after is what lets opacity carry the animation");
  assert.match(c, /\.cs-shell \.btn-send\.work-pulse::after[^{]*\{[^}]*will-change: opacity/,
    "…promoted, or the compositor may not take it");
  assert.ok(!/\.cs-shell \.btn-send\.(work-pulse|--pulse) \{[^}]*animation:/.test(c),
    "the BUTTON must no longer animate — only its ring does");
});

test("reduced motion still shows the ring, just still", () => {
  const c = sheets["components.css"];
  const i = c.indexOf("prefers-reduced-motion", c.indexOf("csWorkPulse"));
  assert.ok(i > 0, "there must be a reduced-motion branch");
  assert.match(c.slice(i, i + 240), /::after \{ animation: none; opacity: /,
    "someone who has asked for no motion must still see that work is happening");
});

test("no OTHER continuously-running animation animates an uncompositable property", () => {
  // Scoped to the ones that run forever (`infinite`); a one-shot flash is not a per-frame cost.
  for (const [file, css] of Object.entries(sheets)) {
    const kf = keyframeProps(css);
    const forever = new Set([...css.matchAll(/animation:\s*([A-Za-z0-9_-]+)[^;]*infinite/g)].map((m) => m[1]));
    for (const name of forever) {
      const props = kf[name];
      if (!props) continue;
      const bad = props.filter((p) => !COMPOSITED.has(p));
      assert.deepEqual(bad, [],
        `${file} @keyframes ${name} runs forever and animates ${bad.join(", ")} — that is a repaint every `
        + "frame, for as long as it is on screen");
    }
  }
});

/* ---- off-screen rows -------------------------------------------------------------------------- */

test("transcript rows skip layout and paint while off-screen", () => {
  const s = sheets["styles.css"];
  assert.match(s, /\.ws-line, \.pc-msg \{ content-visibility: auto; contain-intrinsic-size: auto 72px; \}/,
    "with eight panes most of ~1,450 message rows are scrolled out of view; `content-visibility: auto` "
    + "lets the browser skip them entirely until they scroll in");
  // `auto` in contain-intrinsic-size is the part that matters for correctness, not speed: it makes
  // Chrome REMEMBER each row's real height once measured, so scrollHeight stops being an estimate —
  // and the stick controller reads exactly that to decide "am I at the bottom".
  assert.match(s, /contain-intrinsic-size: auto /,
    "without the `auto` keyword the scrollbar (and 'stick to bottom') would work off guessed heights");
});
