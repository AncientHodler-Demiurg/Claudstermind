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

// ===== THE SAME RACE, a WHOLE TAB (not just its draft) — the "explorer conversation disappeared" bug

test("REGRESSION (live report): \"I had an explorer conversation on the pact workspace, it has disappeared... I never retired it\" — the unguarded flush is fixed", () => {
  // pactChatInit() wipes PACT_CHAT to a single fresh tab on EVERY mount; pactRestoreState()'s fetch
  // (with retries — genuinely several seconds on a slow link) is what corrects it with the real saved
  // tabs, and PACT_STATE_READY stays false for exactly that window so nothing can persist the
  // temporary stub over the real data. Sending a message is fast enough to land inside that window —
  // and the send path's own flush (unlike pactChatStop's and the pagehide handler's) had no
  // PACT_STATE_READY guard, so it happily overwrote a real multi-tab list with the single-tab stub.
  const i = src.indexOf("pactChatRender();   // reflect a fresh auto-name on the tab");
  assert.ok(i >= 0, "the send-dispatch function must exist");
  const slice = src.slice(i, i + 1700);
  assert.match(slice, /if \(PACT_STATE_READY\) pactStateFlush\(\);/,
    "the send path's flush must be gated the SAME way pactChatStop's and the pagehide handler's already are");
  assert.ok(!/^\s*pactStateFlush\(\);\s*$/m.test(slice.split("if (PACT_STATE_READY) pactStateFlush();")[0] || ""),
    "no earlier, unguarded pactStateFlush() call should remain ahead of the guarded one in this slice");
});

test("every pactStateFlush() call site is gated on PACT_STATE_READY — a bare, unguarded call must never reappear", () => {
  // Pins the invariant directly, not just the one known-bad call site: pactChatStop's own comment says
  // this was already a deliberate rule ("leaving Pact — stop persisting a torn-down layout") for two of
  // the three call sites; the send path was the one exception. All three must now agree.
  const calls = [...src.matchAll(/(?<!\/\/.*)\bpactStateFlush\(/g)];
  // Every call site, in context, must have "PACT_STATE_READY" within the preceding ~80 chars (an `if`
  // guard or a `&&` short-circuit) OR be the function's own definition line.
  let unguarded = 0;
  for (const m of calls) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 10), m.index))) continue;   // the definition itself, "function pactStateFlush("
    const before = src.slice(Math.max(0, m.index - 90), m.index);
    if (!/PACT_STATE_READY/.test(before)) unguarded++;
  }
  assert.equal(unguarded, 0, "every call to pactStateFlush() must be preceded by a PACT_STATE_READY check");
});

test("a tab created and genuinely SENT during the restore window is preserved across the server correction, not discarded", () => {
  const i = src.indexOf("const preFetchTabKeys = new Set();");
  assert.ok(i >= 0, "the pre-fetch tab-key baseline must be captured, mirroring preFetchDrafts");
  const body = src.slice(i, i + 5000);
  assert.match(body, /newTabsWithRealSends/, "new tabs with a real sent message must be tracked separately from mere drafts");
  assert.match(body, /!preFetchTabKeys\.has\(t\.key\)/, "only a tab that's NEW since the baseline counts — an existing tab is already covered by the draft merge");
  assert.match(body, /t\.msgs\.some\(\(m\) => m && m\.role === "user"\)/, "must have a REAL sent message, not just exist — an empty new tab has nothing worth protecting");
  assert.match(body, /for \(const t of newTabsWithRealSends\) if \(PACT_CHAT && Array\.isArray\(PACT_CHAT\.tabs\) && !PACT_CHAT\.tabs\.some\(\(x\) => x\.key === t\.key\)\) PACT_CHAT\.tabs\.push\(t\);/,
    "a captured tab still missing after the server's answer replaces the array must be re-appended");
  // Ordering: the capture must happen BEFORE pactRestoreChat(saved.chat) replaces the array, and the
  // re-append must happen AFTER — otherwise there is nothing to compare against / nothing to restore.
  const captureAt = body.indexOf("newTabsWithRealSends.push(t)");
  const replaceAt = body.indexOf("pactRestoreChat(saved.chat)");
  const reappendAt = body.indexOf("PACT_CHAT.tabs.push(t)");
  assert.ok(captureAt >= 0 && replaceAt > captureAt && reappendAt > replaceAt,
    "capture, then replace, then re-append — any other order loses the tab or never detects it");
});
