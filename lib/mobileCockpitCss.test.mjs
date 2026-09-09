// node --test lib/mobileCockpitCss.test.mjs
//
// WHY THIS EXISTS. dashboard/public/mobile-cockpit.css is a PORT, and a port is where a design gets
// lost one rule at a time. The mock it comes from (dashboard/public/mobile-lab.html, pinned by
// lib/mobileLab.test.mjs) is the phone layout as it was settled over eight review rounds; the
// cockpit is that same stylesheet with the mock's `.m-` classes renamed `.mc-`, every rule put
// behind the `.ws-mobile2` switch, and the mock's page furniture dropped. Nothing in that edit
// fails loudly: a rule that is renamed wrong, unscoped or dropped still parses.
//
// Three of these rules were each paid for once, on a real screen:
//
// 1. "there isn't a scroll bar, and i cant scroll down" — the repository chooser. Nothing was
//    overflowing; the content was being COMPRESSED. Every surface here is a scroll container that
//    is also a flex column (that is how its sections stack with a gap), and a flex item shrinks by
//    default, so the cards squashed and scrollHeight stayed equal to clientHeight. Measured in
//    Chromium at 412x915: scrollHeight 810 -> 910 against a clientHeight of 810 once the direct
//    children were pinned to `flex: 0 0 auto` (design decision 10).
// 2. The rails reserve nothing. Padding the low zone to keep them clear took 48px from the field
//    you type into, to protect two corners that had nothing in them (decision 1, A6).
// 3. One scrollbar design in the product — the package's, in frame.css. "the scrolls is different"
//    is the report that unified the transcript's and the type box's; a second declaration in this
//    file re-opens it (decision 11).
//
// And two properties of the port itself. Every rule stays behind `.ws-mobile2`, because the switch
// defaults to OFF and A2 requires today's mobile layout to be untouched until it is flipped — this
// file is loaded for everyone, phone and desktop, the moment index.html links it. And no `.m-`
// selector survives, because the cockpit emits `.mc-` class names: a missed rename is a surface
// that renders as unstyled divs, with nothing logged anywhere.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dir, "..", "dashboard", "public", "mobile-cockpit.css"), "utf8");

/** Strips CSS comments the way a parser does: a comment ends at the FIRST close after the open. */
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ""); }

/**
 * Every style rule as { selectors, body }. Descends into @media/@supports (their contents are
 * ordinary rules and must be scoped like any other) and skips @keyframes, whose `from`/`to` are
 * not selectors and cannot be scoped by anything.
 */
function rules(src) {
  const out = [];
  let i = 0;
  for (;;) {
    const open = src.indexOf("{", i);
    if (open < 0) return out;
    const prelude = src.slice(i, open).trim();
    let depth = 0, j = open;
    for (; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}" && --depth === 0) break;
    }
    const body = src.slice(open + 1, j);
    if (!prelude.startsWith("@")) out.push({ selectors: prelude.split(",").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean), body });
    else if (/^@(media|supports|layer|container)\b/.test(prelude)) out.push(...rules(body));
    i = j + 1;
  }
}

const RULES = rules(stripComments(css));
const SELECTORS = RULES.flatMap((r) => r.selectors);
/** The declarations of the first rule targeting exactly this class, "" when there is no such rule. */
const declOf = (cls) => (RULES.find((r) => r.selectors.some((s) => s.endsWith("." + cls))) || { body: "" }).body;

test("every rule stays behind the .ws-mobile2 switch, so the cockpit ships dark", () => {
  const loose = SELECTORS.filter((s) => !s.startsWith(".ws-mobile2"));
  assert.deepEqual(loose, [],
    "these rules apply to everyone the moment index.html links this file — the switch defaults to " +
    "OFF, and A2 requires the current mobile layout to be byte-for-byte what it is today, and the " +
    "desktop unchanged at any width, until it is flipped");
});

test("no selector was left behind on the mock's .m- class names", () => {
  const stale = SELECTORS.filter((s) => /\.m-[a-z]/.test(s));
  assert.deepEqual(stale, [],
    "the cockpit builds .mc- class names, so a selector still on the mock's names dresses nothing: " +
    "that surface renders as unstyled divs stacked down the page and no error is raised anywhere");
});

test("a scroll container that is also a flex column must not let its children shrink", () => {
  const pinned = RULES.filter((r) => /flex:\s*0 0 auto/.test(r.body))
    .flatMap((r) => r.selectors).map((s) => s.replace(/\s*>\s*/g, ">"));
  for (const box of ["mc-over-body", "mc-sheet-body", "mc-pbody", "mc-list", "mc-sec"])
    assert.ok(pinned.some((s) => s.endsWith(`.${box}>*`)),
      `.${box}'s direct children may shrink, so its content compresses instead of overflowing: ` +
      "scrollHeight stays equal to clientHeight, there is nothing to scroll, and the list is " +
      "silently shorter than what it is listing");
  // …and the names in that rule must still be the containers that actually scroll, or it pins
  // children nobody is trying to scroll past while the real surface goes back to compressing.
  for (const box of ["mc-over-body", "mc-sheet-body", "mc-pbody", "mc-list"])
    assert.match(declOf(box), /overflow-y:\s*auto/,
      `.${box} is named in the no-shrink rule but is no longer a scrolling surface — one of the two is wrong`);
});

test("the rails are drawn over the low zone's corners and reserve nothing", () => {
  assert.match(declOf("mc-low"), /flex:\s*0 0 auto/, "the low zone must exist as its own strip — it is what carries the rails");
  assert.ok(!/padding(?!-(top|bottom))/.test(declOf("mc-low")),
    "horizontal padding on the low zone is 48px taken out of the field you type into, spent " +
    "keeping clear two corners that have nothing in them — the rails are drawn OVER them");
  const rail = declOf("mc-rail");
  assert.match(rail, /position:\s*absolute/,
    "a rail in the flow pushes the compose row aside, which is exactly the width moving the rails " +
    "down here was meant to give back");
  assert.match(rail, /top:\s*0;transform:translateY\(-50%\)/,
    "each rail must straddle the seam between the transcript and the footer rather than belong to " +
    "either side, the way the Live bulb does on that same line");
});

test("one scrollbar design in the product, and it is the package's", () => {
  assert.ok(!/scrollbar-width|scrollbar-color/.test(stripComments(css)),
    "a second scrollbar declaration puts the transcript and the type box back at different widths " +
    "and different colours on one screen — 'the scrolls is different' is the report that ended that");
  const frame = readFileSync(join(__dir, "..", "packages", "claude-chat-shell", "src", "frame.css"), "utf8");
  assert.match(frame, /\.rg-core, \.rg-typebox \{ scrollbar-width: thin/,
    "…because the one declaration lives in the package, and the cockpit's scrolling surfaces reach " +
    "it by carrying .rg-core / .rg-typebox");
});

test("the transcript is the only region that flexes", () => {
  assert.match(declOf("mc-core"), /flex:\s*1 1 auto;min-height:0/,
    "the transcript must be the region that takes what is left, or A1's 65% is whatever the strips leave over");
  for (const strip of ["mc-head", "mc-compose", "mc-btnrow", "mc-risers"])
    assert.match(declOf(strip), /flex:\s*0 0 auto/,
      `.${strip} would compete with the transcript for height: a type box that grows must PUSH the ` +
      "conversation up, never squeeze it or sit on top of it");
});

test("no comment in this file closes early and eats the rule after it", () => {
  // A literal close INSIDE a CSS comment ended it three lines early in the Chat Shell Lab and
  // silently deleted the next rule — lib/chatShellRoleSlots.test.mjs exists for that exact bug.
  // This file is mostly comments, so it is the likeliest place in the repo for it to happen again.
  assert.equal((css.match(/\/\*/g) || []).length, (css.match(/\*\//g) || []).length,
    "a comment that is never closed swallows every rule after it to the end of the file");
  assert.ok(!stripComments(css).includes("*/"),
    "a close survives comment-stripping, which can only mean a comment ended earlier than it reads: " +
    "the rest of that sentence is now live CSS and the rule after it is being parsed as garbage");
});
