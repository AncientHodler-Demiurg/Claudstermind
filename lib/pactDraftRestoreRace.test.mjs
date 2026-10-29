// node --test lib/pactDraftRestoreRace.test.mjs
//
// THE REPORT: "Every time I come back to the pact workspace on mobile, this message appears written,
// although it's extremely old and I erase it every time when I'm here on mobile. It still persist
// somehow." — a long, clearly-ancient draft (visible in a screenshot: a paragraph about an "FVT"
// table and a "Master Collect" button) kept reappearing in the compose box after being cleared.
//
// Root cause, confirmed in pactRestoreState (app.js): on open, it draws the device's last-seen LOCAL
// layout immediately (so the composer is usable before the slow network fetch lands), then once the
// server's authoritative copy arrives, a "keep what was typed in the meantime" merge protects any
// draft typed during that wait from being clobbered by the server's answer. The merge's bug: it
// treated "the draft is non-empty right now" as proof the user typed it just now — but a draft that
// is non-empty ONLY because the local draw painted a stale `localStorage` value (never corrected on
// THIS device, however it got stale) looks identical. So a stale local draft got captured as "typed",
// then stamped back over the server's correctly-cleared value — on EVERY restore, forever. A real
// clear, made on this device or any other, could never stick.
//
// The fix: compare against a baseline taken right after the local draw, not mere non-emptiness.
// Unchanged since that baseline = just the local draw, not real typing = the server's answer must win
// outright, including when the server says the draft is now empty.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== PACT DRAFT RESTORE RACE — pure helper";
const end = "// ===== end PACT DRAFT RESTORE RACE pure helper =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "pactDraftWasTypedSincePrefetch helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
// eslint-disable-next-line no-new-func
const { pactDraftWasTypedSincePrefetch } = new Function(block + "\nreturn { pactDraftWasTypedSincePrefetch };")();

test("THE BUG, reproduced: a stale local draft, unchanged since the local draw, must NOT be treated as freshly typed", () => {
  // This is exactly the reported shape: the local draw painted an old draft ("the FVT paragraph");
  // nothing was typed during the network wait, so `now` is identical to `before`.
  const before = "here is how it looks, it still doesnt work... [the ancient FVT/Master Collect paragraph]";
  const now = before;   // nothing happened in between — the user never touched the box this visit
  assert.equal(pactDraftWasTypedSincePrefetch(before, now), false,
    "unchanged since the local draw = just the local draw itself, not real typing — the server's answer must be allowed to win, even to an empty draft");
});

test("real typing during the network wait IS protected — the whole point of the merge this helper backs", () => {
  const before = "";   // local draw had nothing for this tab
  const now = "wait, one more thing before you commit";   // the user typed this while the fetch was in flight
  assert.equal(pactDraftWasTypedSincePrefetch(before, now), true);
});

test("typing that happens to land on a NON-EMPTY local draft is still protected — must differ from baseline, not merely be non-empty", () => {
  const before = "old draft from the local draw";
  const now = "old draft from the local draw PLUS something the user just added";
  assert.equal(pactDraftWasTypedSincePrefetch(before, now), true);
});

test("a tab cleared to empty during the wait is correctly NOT re-protected as 'typed' (there's nothing to protect)", () => {
  const before = "something";
  const now = "";
  assert.equal(pactDraftWasTypedSincePrefetch(before, now), false,
    "an empty 'now' is never worth capturing into the typed map — the merge's own `!t.draft` check already only reinstates a NON-empty captured value");
});

test("both empty (never had a draft, never typed one) — not typed", () => {
  assert.equal(pactDraftWasTypedSincePrefetch("", ""), false);
  assert.equal(pactDraftWasTypedSincePrefetch(undefined, undefined), false);
  assert.equal(pactDraftWasTypedSincePrefetch(null, null), false);
});

test("the merge call site actually uses the baseline comparison, not a bare truthiness check on t.draft", () => {
  // Pins the wiring itself, so a future edit can't quietly revert to the old (buggy) `if (t.key && t.draft)`
  // shape without a test noticing — that exact revert is what caused the live incident.
  assert.match(src, /if \(t\.key && pactDraftWasTypedSincePrefetch\(preFetchDrafts\.get\(t\.key\), t\.draft\)\) typed\.set\(t\.key, t\.draft\);/,
    "the 'typed' capture must go through the baseline-aware helper, not a bare `t.draft` truthiness check");
  assert.match(src, /const preFetchDrafts = new Map\(\);/, "the baseline snapshot must be taken right after the local draw");
});
