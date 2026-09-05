// node --test lib/pactAutoContinue.test.mjs
// Pact chat AUTO-CONTINUE — the decision layer. Lives in the browser monolith (dashboard/public/app.js);
// we can't eval the whole file (it boots the DOM), so we slice out the sentinel-marked pure helper and eval
// just that. Same pattern as lib/coldLoadStatus.test.mjs / lib/swarmState.test.mjs.
//
// WHY THIS FILE EXISTS. Auto-continue ("tick the box, the agent keeps going") had four rounds of patches
// (1.5.47 / 1.5.48 / 1.5.49 / 1.5.80) and still did not reliably continue turns. It had ZERO tests, because
// its whole decision was tangled into a DOM renderer. Every failure had the same shape: a condition that
// suppressed the loop, checked in one place, not mirrored in the other, and invisible to the user.
//
// The specific stuck states these tests pin down, each of which shipped:
//   1. RECURSION/CRASH — the countdown tick treated `_suggestDismissed` as a stop condition, the renderer
//      did not, so renderer→arm→tick→stop→renderer looped without bound: `RangeError: Maximum call stack
//      size exceeded` thrown out of every repaint. Dismissing the suggestion now cannot gate the loop at
//      all (it isn't even an input here), and the call graph is one-directional.
//   2. COUNTDOWN NEVER REACHING ZERO — the deadline was re-minted by whatever repainted last. A live
//      deadline must survive re-evaluation.
//   3. SILENT STOPS — cap reached / compose box not empty hid the entire bar (or stopped the loop with no
//      cue), so "I ticked it and nothing happened" was the whole user-visible story. Both now keep the bar
//      shown and carry a reason string.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const APP = join(__dir, "..", "dashboard", "public", "app.js");
const src = readFileSync(APP, "utf8");
const begin = "// ===== PACT AUTO-CONTINUE — pure decision helper";
const end = "// ===== end PACT AUTO-CONTINUE pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "auto-continue pure helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactAutoDecide, pactAutoHasReply, pactAutoWhy, PACT_AUTO_CAP, PACT_AUTO_DELAY_MS } =
  new Function(block + "\nreturn { pactAutoDecide, pactAutoHasReply, pactAutoWhy, PACT_AUTO_CAP, PACT_AUTO_DELAY_MS };")();

const NOW = 1_000_000;
/** A tab that SHOULD be counting down: on screen, has replied, auto on, idle, nothing typed. */
const live = (over = {}) => ({ autoContinue: true, busy: false, hasReply: true, active: true,
  composeText: "", autoCount: 0, autoCap: PACT_AUTO_CAP, deadline: 0, now: NOW, ...over });

test("the happy path: idle + on + a reply on screen → armed with a full countdown", () => {
  const d = pactAutoDecide(live());
  assert.equal(d.show, true, "the bar (and its toggle) must be on screen");
  assert.equal(d.arm, true, "THE feature: the loop must actually arm");
  assert.equal(d.fire, false, "…but not send instantly — there's a grace window to cancel");
  assert.equal(d.deadline, NOW + PACT_AUTO_DELAY_MS);
  assert.equal(d.msLeft, PACT_AUTO_DELAY_MS);
  assert.equal(d.reason, "", "armed means no suppression reason");
});

test("REGRESSION (the countdown that never reached zero): a live deadline survives re-evaluation", () => {
  // A turn produces dozens of repaints, and every one re-decides. The old code minted a fresh deadline on
  // each pass whenever the timer had been momentarily stopped, so the remaining time kept resetting to 6s
  // and the send never happened. Re-deciding must be a no-op on an already-running countdown.
  let s = live();
  let d = pactAutoDecide(s);
  const firstDeadline = d.deadline;
  for (let ms = 250; ms <= 5750; ms += 250) {
    d = pactAutoDecide({ ...s, deadline: d.deadline, now: NOW + ms });
    assert.equal(d.arm, true);
    assert.equal(d.deadline, firstDeadline, `repaint at +${ms}ms must not restart the countdown`);
    assert.equal(d.fire, false);
    assert.equal(d.msLeft, PACT_AUTO_DELAY_MS - ms);
  }
  d = pactAutoDecide({ ...s, deadline: firstDeadline, now: NOW + PACT_AUTO_DELAY_MS });
  assert.equal(d.fire, true, "at the deadline it finally fires");
  assert.equal(d.msLeft, 0);
});

test("REGRESSION (the crash): dismissing the suggestion cannot stop the loop", () => {
  // The stuck state that broke the WHOLE Pact chat: the countdown tick stopped on `_suggestDismissed` and
  // then re-entered the renderer, which re-armed, which ticked… `RangeError: Maximum call stack size
  // exceeded` on every repaint. `dismissed` is not an input to this decider at all — pressing ✕ hides the
  // suggestion chip and nothing else, exactly as the ✕'s own tooltip has always promised.
  const code = block.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");   // comments explain it; CODE must not use it
  assert.ok(!/dismiss/i.test(code), "the arming decision must not read any dismissed flag");
  const d = pactAutoDecide({ ...live(), dismissed: true, _suggestDismissed: true });
  assert.equal(d.arm, true, "a dismissed suggestion must leave auto-continue running");
});

test("REGRESSION (the crash, structurally): the decision layer never calls back into the renderer", () => {
  // The recursion was only possible because the countdown could re-enter the thing that started it. The
  // call graph is now one-directional: pactChatUpdateSuggest → pactAutoEnsure → pactAutoDecide, never back.
  assert.ok(!/pactChatUpdateSuggest/.test(block), "the pure decision block must not reference the renderer");
  const ensure = src.slice(src.indexOf("function pactAutoEnsure(t) {"));
  const ensureBody = ensure.slice(0, ensure.indexOf("\n}\n") + 3);
  assert.ok(ensureBody.length > 100, "found pactAutoEnsure's body");
  assert.ok(!/pactChatUpdateSuggest/.test(ensureBody),
    "pactAutoEnsure must never call pactChatUpdateSuggest — that edge is what made the loop unbounded");
});

test("a backgrounded tab / slept phone fires as soon as it wakes, instead of stalling", () => {
  // setInterval is throttled (or frozen) in a background tab. On return the deadline is long past; the
  // loop must catch up rather than sit there with an expired countdown showing "sending in 0s".
  const d = pactAutoDecide({ ...live(), deadline: NOW - 60_000, now: NOW });
  assert.equal(d.arm, true);
  assert.equal(d.fire, true, "an already-expired deadline sends immediately on wake");
});

test("a nonsense deadline (clock jump / restored garbage) is re-minted, not trusted", () => {
  for (const bad of [NOW + PACT_AUTO_DELAY_MS + 1, NOW + 9e9, -5, 0, null, undefined, "soon", NaN]) {
    const d = pactAutoDecide({ ...live(), deadline: bad });
    assert.equal(d.deadline, NOW + PACT_AUTO_DELAY_MS, `deadline ${String(bad)} must be replaced`);
    assert.equal(d.fire, false, `deadline ${String(bad)} must not cause an instant send`);
  }
});

test("mid-round: the loop pauses, the control stays VISIBLE, and it says why", () => {
  for (const busy of [true]) {
    const d = pactAutoDecide(live({ busy }));
    assert.equal(d.show, true, "1.5.48 promised an always-visible toggle — being busy must not hide it");
    assert.equal(d.arm, false, "no countdown while a round is running");
    assert.equal(d.reason, "busy");
    assert.match(pactAutoWhy(d), /round is running/);
  }
  // …and the instant the round ends it re-arms on its own, with a fresh full window.
  const after = pactAutoDecide(live({ busy: false, deadline: 0 }));
  assert.equal(after.arm, true);
  assert.equal(after.msLeft, PACT_AUTO_DELAY_MS);
});

test("REGRESSION (the silent stop): text in the compose box PAUSES the loop but never hides it", () => {
  // The old renderer returned early — hiding the entire bar — whenever the compose box had any text. A
  // persisted draft, or the text the failed-send path itself put back in the box, therefore made
  // Auto-continue vanish with no explanation and no way to see its state. Worse, `t.draft` survives
  // reloads, so the loop stayed dead across restarts.
  const d = pactAutoDecide(live({ composeText: "  half a thought " }));
  assert.equal(d.show, true, "the toggle must stay on screen while you type");
  assert.equal(d.arm, false, "your half-typed message outranks the robot");
  assert.equal(d.reason, "composing");
  assert.match(pactAutoWhy(d), /send or clear your message/);
  // Clearing the box resumes it — no reload, no re-tick of the checkbox.
  assert.equal(pactAutoDecide(live({ composeText: "   " })).arm, true, "whitespace-only is not composing");
  assert.equal(pactAutoDecide(live({ composeText: "" })).arm, true);
});

test("REGRESSION (the silent stop): the rolling ceiling pauses LOUDLY, and stays visible", () => {
  // autoCount/autoCap persist across reloads. A tab restored at 10/10 came back with the checkbox still
  // ticked and the loop permanently dead — the exact "I ticked it and it does nothing" report.
  const d = pactAutoDecide(live({ autoCount: 10, autoCap: 10 }));
  assert.equal(d.capReached, true);
  assert.equal(d.arm, false, "the ceiling must still bound an unattended sweep");
  assert.equal(d.show, true, "but the reason has to be on screen, not silent");
  assert.equal(d.reason, "cap");
  assert.match(pactAutoWhy(d), /paused at 10\/10 rounds/);
  // Granting the next batch (the ▷ Continue (+10) button / re-ticking Auto) resumes it.
  assert.equal(pactAutoDecide(live({ autoCount: 10, autoCap: 20 })).arm, true);
  // …and one round short of the ceiling still runs.
  assert.equal(pactAutoDecide(live({ autoCount: 9, autoCap: 10 })).arm, true);
});

test("switched off: visible, off, no countdown, no nagging reason", () => {
  const d = pactAutoDecide(live({ autoContinue: false }));
  assert.equal(d.show, true);
  assert.equal(d.on, false);
  assert.equal(d.arm, false);
  assert.equal(d.reason, "off");
  assert.equal(pactAutoWhy(d), "", "an off switch is not a fault — say nothing");
});

test("a tab that isn't on screen never runs the loop (exactly one owner)", () => {
  const d = pactAutoDecide(live({ active: false }));
  assert.equal(d.show, false);
  assert.equal(d.arm, false);
  assert.equal(d.reason, "inactive");
});

test("a conversation with no agent reply yet has no bar and no loop", () => {
  const d = pactAutoDecide(live({ hasReply: false }));
  assert.equal(d.show, false);
  assert.equal(d.arm, false);
  assert.equal(d.reason, "no-reply");
});

test("defaults are safe: junk/empty input decides 'do nothing'", () => {
  for (const s of [undefined, null, {}, { autoContinue: true }]) {
    const d = pactAutoDecide(s);
    assert.equal(d.arm, false);
    assert.equal(d.fire, false);
  }
  const d = pactAutoDecide(live({ autoCap: 0, autoCount: -3 }));
  assert.equal(d.autoCap, PACT_AUTO_CAP, "a 0/absent cap falls back to the default ceiling");
  assert.equal(d.autoCount, 0, "a negative count is clamped, not treated as 'past the cap'");
  assert.equal(d.arm, true);
});

test("pactAutoHasReply: only a non-empty assistant message counts", () => {
  assert.equal(pactAutoHasReply([{ role: "assistant", text: "hi" }]), true);
  assert.equal(pactAutoHasReply([{ role: "user", text: "hi" }]), false);
  assert.equal(pactAutoHasReply([{ role: "assistant", text: "" }]), false, "an empty reply is not a reply");
  assert.equal(pactAutoHasReply([{ kind: "tool_use", tools: [] }]), false, "tool rows alone are not a reply");
  assert.equal(pactAutoHasReply([null, undefined, { role: "assistant", text: "ok" }]), true);
  assert.equal(pactAutoHasReply([]), false);
  assert.equal(pactAutoHasReply(null), false);
  assert.equal(pactAutoHasReply("nope"), false);
});

test("a full ten-round sweep runs to the ceiling and then stops — bounded, not runaway", () => {
  // End-to-end over the decider: each round arms, counts down, fires, goes busy, comes back idle.
  let now = NOW, count = 0, deadline = 0, fired = 0;
  for (let guard = 0; guard < 5000 && count < PACT_AUTO_CAP + 2; guard++) {
    const d = pactAutoDecide(live({ autoCount: count, deadline, now }));
    if (d.fire) { fired++; count++; deadline = 0; now += 30_000; continue; }   // the round runs
    if (!d.arm) break;                                                          // ceiling reached
    deadline = d.deadline;
    now += 250;
  }
  assert.equal(fired, PACT_AUTO_CAP, "exactly one batch of rounds, unattended");
  assert.equal(pactAutoDecide(live({ autoCount: count })).reason, "cap");
});
