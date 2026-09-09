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

test("every rule stays behind the .ws-mobile2 switch, so nothing leaks onto the desktop", () => {
  // `body.ws-mobile2 …` counts: it is the SAME gate, qualified so it can outrank a desktop rule that
  // carries a type selector of its own (`body.ws-full #main` beats `.ws-mobile2 #main` on
  // specificity, and the padding it sets is what stops the cockpit filling the screen).
  const loose = SELECTORS.filter((s) => !/^(?:body)?\.ws-mobile2\b/.test(s));
  assert.deepEqual(loose, [],
    "a rule that is not behind the switch applies the moment index.html links this file — including " +
    "on the desktop, which this cockpit must never touch at any width");
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

test("a re-homed desktop control is resized to the phone, not just moved onto it", () => {
  // Core does not use the cockpit's own compact/wrap buttons — it substitutes the package's real
  // control into that slot, and re-homing moves a node WITH its desktop geometry. Measured at 412px
  // before this rule: the group occupied 185px of the 388 available, right-aligned, with 27px-tall
  // buttons — under any touch target, and sitting in the same slot where Pact's fallback renders 44px.
  // The nesting matters: the buttons are inside `.split` inside `.cs-grow`, so a rule aimed at the
  // group's direct children stretches the group and moves nothing you can press.
  const rules = RULES.filter((r) => r.selectors.some((s) => /\.mc-sheet .*\.cs-grp/.test(s)));
  assert.ok(rules.length, "nothing adapts the re-homed group to the phone");
  const split = rules.find((r) => r.selectors.some((s) => /\.split\s*>\s*button/.test(s)));
  assert.ok(split, "the rule must reach the BUTTONS (.split > button), not stop at the group");
  assert.match(split.body, /min-height:\s*(4[0-9]|[5-9][0-9])px/,
    "a 27px control is not pressable on a phone — it needs a real touch height");
  assert.match(split.body, /flex:\s*1 1 0/, "…and both halves must share the width rather than hug their text");
  // Scoped to the sheet: the same package group appears in the compose row, where the package's own
  // alignment is correct and must not be overridden.
  for (const r of rules)
    assert.ok(r.selectors.every((s) => s.includes(".mc-sheet")),
      "this adaptation must not escape the sheet — it would re-align the same control in the compose row");
});

test("the type field and the buttons under it are ONE surface", () => {
  // "The typing field looks different core vs pact workspace — in pact workspace it's the whole,
  // incorporating the buttons below." The low zone was painted TWICE: `.mc-compose` carried a
  // background and the seam, `.mc-btnrow` carried a background of its own. Where those two happened
  // to resolve to the same colour it looked like one container by coincidence, and where they did
  // not — Pact, whose cockpit sits outside the palette's scope — the field read as a box sitting on
  // a separate strip. The ZONE owns the surface; the rows inside it own nothing.
  const low = declOf("mc-low");
  assert.match(low, /background:\s*var\(--panel\)/,
    "the low zone must paint the footer surface itself — if the rows inside it do, they can disagree");
  assert.match(low, /border-top:\s*var\(--seam-w[^;]*\)\s+solid\s+var\(--edge/,
    "one seam, on the zone, between what has been said and what you are about to say");
  for (const row of ["mc-compose", "mc-btnrow"])
    assert.ok(/background:\s*transparent/.test(declOf(row)) || !/background:/.test(declOf(row)),
      `.${row} paints its own background, which is the second surface that split the field from ` +
      "its buttons — the zone underneath is the only thing that should be painting here");
});

test("the seam falls back, because the cockpit is mounted outside the scope that defines it", () => {
  // `border-top: var(--seam-w) solid var(--edge)` with an undefined --seam-w is not a thin border:
  // it is an INVALID shorthand, and the whole declaration is dropped. Measured in Pact before the
  // palette reached it: computed border-top-width 0px. Both tokens carry a fallback so a host that
  // is missing the palette still gets a line.
  assert.match(declOf("mc-low"), /var\(--seam-w,\s*1px\)/,
    "no fallback means one undefined token silently deletes the seam rather than thinning it");
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
  // EVERY rule that styles the core must agree, not just the first one the lookup finds: Pact adopts a
  // whole host node and overrides `.mc-core` for it, and an override that forgot the flex would leave
  // that workspace's transcript sized by its content.
  const coreRules = RULES.filter((r) => r.selectors.some((s) => s.endsWith(".mc-core")));
  assert.ok(coreRules.length >= 1, ".mc-core must be styled");
  for (const r of coreRules)
    assert.match(r.body, /flex:\s*1 1 auto;min-height:0/,
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

test("the compose row stacks: attachments and reply chips ABOVE the box, never beside it", () => {
  // "the attachments bubble, make the typing are smaller, which isn't okay, they need to be placed on
  // top." The slot that carries them (`composeExtra`) sits inside `.mc-compose`, and in a row they
  // took width from the type box — the same mistake as the attach button that started this redesign.
  const compose = declOf("mc-compose");
  assert.ok(compose, ".mc-compose must exist");
  assert.match(compose, /flex-direction:\s*column/, "a row squeezes the box; a column stacks above it");
  assert.match(compose, /align-items:\s*stretch/, "…and the box must still take the full width");
});

test("on a phone the pane IS the screen — no page frame around it", () => {
  // The desktop keeps 10px/18px of padding for its grid, a rounded bordered card per pane, and a gap
  // under the workspace root. On a phone that is a frame around a layout whose whole point is not to
  // have one, and it cost ~100px more when the boot notice was showing.
  const need = [
    [/body\.ws-mobile2 #main\{padding:0\}/, "the page padding goes"],
    [/body\.ws-mobile2 \.ws-pane\{[^}]*border-radius:0/, "and the pane's card corners"],
    [/body\.ws-mobile2 \.ws-root > \.hint\{display:none\}/, "and the boot notice, which is read once and then costs a band of screen forever"],
  ];
  const flat = css.replace(/\s*([{};:,])\s*/g, "$1");
  for (const [re, why] of need) assert.match(flat, re, why);
  // `body.` qualified on purpose: `body.ws-full #main` carries a type selector and would otherwise win.
  assert.ok(!/(^|\n)\.ws-mobile2 #main/.test(css), "an unqualified selector loses to body.ws-full #main on specificity");
});
