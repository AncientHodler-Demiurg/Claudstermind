// node --test lib/autoContinue.test.mjs
//
// The rules that decide whether an UNATTENDED agent sends itself another prompt. This is the whole
// reason lib/autoContinue.mjs is a pure module: the loop it feeds runs on the server with nobody
// watching, so "does it stop when it should?" has to be answerable by a test rather than by leaving
// it running and counting what it spent.
import test from "node:test";
import assert from "node:assert/strict";
import { autoDecide, autoNextText, autoHasReply, AUTO_CAP, AUTO_DELAY_MS, AUTO_FALLBACK } from "./autoContinue.mjs";

const reply = [{ role: "assistant", text: "done." }];
const NOW = 1_000_000;
const live = (over = {}) => ({ on: true, hold: false, busy: false, transcript: reply,
                               count: 0, cap: AUTO_CAP, at: 0, now: NOW, ...over });

test("armed only when there is something to continue FROM", () => {
  assert.equal(autoDecide(live()).arm, true);
  assert.equal(autoDecide(live({ transcript: [] })).reason, "no-reply",
    "a session that has never answered must not be prompted by itself");
  assert.equal(autoDecide(live({ transcript: [{ role: "user", text: "hi" }] })).reason, "no-reply");
  assert.equal(autoDecide(live({ transcript: [{ role: "assistant", text: "" }] })).reason, "no-reply",
    "an empty reply is not a reply");
});

test("every reason it refuses is named, because a silent loop cannot be debugged", () => {
  assert.equal(autoDecide(live({ on: false })).reason, "off");
  assert.equal(autoDecide(live({ busy: true })).reason, "busy");
  assert.equal(autoDecide(live({ count: AUTO_CAP })).reason, "cap");
  assert.equal(autoDecide(live({ hold: true })).reason, "composing");
  for (const r of ["off", "busy", "cap", "composing", "no-reply"])
    assert.equal(autoDecide(live({ on: r !== "off" ? true : false, busy: r === "busy", count: r === "cap" ? AUTO_CAP : 0,
                                   hold: r === "composing", transcript: r === "no-reply" ? [] : reply })).fire, false,
      "a refused decision must never also fire (" + r + ")");
});

test("the ceiling is absolute — this is what stands between an unattended loop and the budget", () => {
  assert.equal(autoDecide(live({ count: AUTO_CAP - 1 })).arm, true, "the last granted round still runs");
  assert.equal(autoDecide(live({ count: AUTO_CAP })).arm, false, "and then it stops, without a human");
  assert.equal(autoDecide(live({ count: AUTO_CAP + 5 })).arm, false, "…and stays stopped if the count overshoots");
  assert.equal(autoDecide(live({ count: 3, cap: 3 })).reason, "cap", "a lowered ceiling takes effect immediately");
});

test("the deadline is kept, not minted on every evaluation", () => {
  // Every event re-evaluates this. Restarting the countdown each time is how a loop stays armed
  // forever without ever sending — it never reaches zero.
  const first = autoDecide(live());
  assert.equal(first.at, NOW + AUTO_DELAY_MS);
  const later = autoDecide(live({ at: first.at, now: NOW + 3000 }));
  assert.equal(later.at, first.at, "the countdown must keep running down, not restart");
  assert.equal(later.fire, false);
  const due = autoDecide(live({ at: first.at, now: first.at }));
  assert.equal(due.fire, true, "and fire when it is reached");
});

test("a deadline already long past fires at once rather than being extended", () => {
  // The server slept, or the process restarted. The turn ended ages ago; the next round is overdue.
  const d = autoDecide(live({ at: NOW - 60_000, now: NOW }));
  assert.equal(d.fire, true);
});

test("an absurd stored deadline is not trusted", () => {
  // A deadline further out than the delay allows cannot have come from this loop.
  const d = autoDecide(live({ at: NOW + AUTO_DELAY_MS * 100, now: NOW }));
  assert.equal(d.at, NOW + AUTO_DELAY_MS, "a nonsensical deadline is replaced, not honoured");
});

test("the next prompt is read from what the agent actually said", () => {
  assert.equal(autoNextText([{ role: "assistant", text: "Next: LIQUID.pact" }]), "Continue with LIQUID.pact.");
  assert.equal(autoNextText([{ role: "assistant", text: "next up — ATS" }]), "Continue with ATS.");
  assert.equal(autoNextText([{ role: "assistant", text: "I'll continue with Khronoton next time" }]),
    "Continue with Khronoton.");
  assert.equal(autoNextText([{ role: "assistant", text: "All done, nothing left." }]), AUTO_FALLBACK,
    "no named next step means the generic continue — the loop must still send something");
  assert.equal(autoNextText([]), AUTO_FALLBACK);
  assert.equal(autoNextText(null), AUTO_FALLBACK);
});

test("the word \"next\" in a sentence is not a named next step", () => {
  // The browser's version tried a loose `next …` pattern first, so "I'll continue with Khronoton next
  // time" matched "next time" and produced "Continue with time." — a real sentence, confidently
  // wrong, and unattended it spends a whole round on it. Naming a next step takes a separator.
  assert.equal(autoNextText([{ role: "assistant", text: "I'll continue with Khronoton next time" }]),
    "Continue with Khronoton.", "the explicit form must win over an incidental 'next'");
  for (const s of ["I'll pick this up next time", "the next step is unclear", "next week maybe"])
    assert.equal(autoNextText([{ role: "assistant", text: s }]), AUTO_FALLBACK,
      "unsure must fall back to a generic continue rather than invent a target: " + s);
});

test("it reads the LAST reply, not the first", () => {
  const t = [{ role: "assistant", text: "Next: alpha" }, { role: "user", text: "go" },
             { role: "assistant", text: "Next: omega" }];
  assert.equal(autoNextText(t), "Continue with omega.", "continuing from a stale suggestion repeats work");
});

test("both transcript shapes are understood", () => {
  // The server stores rows as `{ kind: 'assistant' }`; the browser's model uses `{ role }`. One
  // reader, both shapes, because feeding it the wrong one silently yields 'no-reply' — a loop that
  // is simply never armed and says nothing about why.
  assert.equal(autoHasReply([{ kind: "assistant", text: "hi" }]), true);
  assert.equal(autoHasReply([{ role: "assistant", text: "hi" }]), true);
  assert.equal(autoNextText([{ kind: "assistant", text: "Next: beta" }]), "Continue with beta.");
});

test("a full sweep runs to the ceiling and stops — bounded, unattended", () => {
  let count = 0, at = 0, now = NOW, fired = 0;
  for (let guard = 0; guard < 5000 && count < AUTO_CAP + 3; guard++) {
    const d = autoDecide(live({ count, at, now }));
    if (d.fire) { fired++; count++; at = 0; now += 30_000; continue; }   // the round runs
    if (!d.arm) break;
    at = d.at; now += 250;
  }
  assert.equal(fired, AUTO_CAP, "exactly one batch, then it waits for a human");
  assert.equal(autoDecide(live({ count })).reason, "cap");
});
