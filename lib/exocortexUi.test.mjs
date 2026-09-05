// node --test lib/exocortexUi.test.mjs
//
// The exocortex UI's WORDING AND AFFORDANCE POLICY lives in dashboard/public/app.js (the browser
// monolith), so — exactly as lib/coldLoadStatus.test.mjs and lib/pactPrintRows.test.mjs do — we slice
// the sentinel-marked pure block out and eval just that. We can't eval the whole file: it boots a DOM.
//
// What is under test here is NOT the decision logic (that lives in the pure lib/ modules and has its
// own suites) but the honesty rules layered on top of it, every one of which is a bug that was
// specifically asked to be prevented:
//   - "N earlier turns" above is EXACT; "more below" carries NO count, ever;
//   - a client-inferred cue is worded as a possibility, never asserted;
//   - a tier action only becomes a BUTTON when this surface can really perform it (`roll` cannot —
//     there is no roll member of WS_CONTROL_ACTIONS — so it must render as a note);
//   - an in-flight jump ALWAYS has text (a jump is a multi-round-trip search; a frozen-looking UI
//     is the failure mode).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== EXOCORTEX UI — pure helpers";
const end = "// ===== end EXOCORTEX UI pure helpers =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "exocortex UI helper block markers must exist in app.js");
const block = src.slice(a, b + end.length);
const H = new Function(
  block + "\nreturn { exoNum, exoParseTurnRef, exoTurnRefLabel, exoAffordanceText, exoTierAffordances, exoCueLine, exoJumpStatusText, exoJumpBusy };"
)();

test("exoParseTurnRef accepts every shape a person types", () => {
  assert.deepEqual(H.exoParseTurnRef("1237"), { kind: "prompt", number: 1237 });
  assert.deepEqual(H.exoParseTurnRef("#1237"), { kind: "prompt", number: 1237 });
  assert.deepEqual(H.exoParseTurnRef("P1237"), { kind: "prompt", number: 1237 });
  assert.deepEqual(H.exoParseTurnRef("  p#1,237 "), { kind: "prompt", number: 1237 });
  assert.deepEqual(H.exoParseTurnRef("R 1237"), { kind: "response", number: 1237 });
  assert.deepEqual(H.exoParseTurnRef("42", "response"), { kind: "response", number: 42 }, "a bare number follows the caller's default kind");
});

test("exoParseTurnRef refuses anything that is not a turn — that is what frees the box for search", () => {
  for (const bad of ["", "   ", "kadena pact", "P", "#", "0", "P0", "-3", "1.5", "12a", null, undefined, {}]) {
    assert.equal(H.exoParseTurnRef(bad), null, JSON.stringify(bad) + " must not parse as a turn (P#/R# are 1-based)");
  }
});

test("exoAffordanceText: the count above is exact, the count below NEVER exists", () => {
  const mid = H.exoAffordanceText({ hasAbove: true, hasBelow: true, turnsAbove: 1204, turnsBelow: null, atStart: false, atEnd: false });
  assert.equal(mid.above, "▲ 1,204 earlier turns");
  assert.equal(mid.below, "▼ more below");
  assert.ok(!/\d/.test(mid.below), "the below affordance must contain NO number — transcriptTotal counts rows, so any turn count there is invented");

  const one = H.exoAffordanceText({ hasAbove: true, hasBelow: false, turnsAbove: 1, turnsBelow: 0, atStart: false, atEnd: true });
  assert.equal(one.above, "▲ 1 earlier turn", "singular");
  assert.equal(one.below, "");
  assert.equal(one.atEnd, true);

  const top = H.exoAffordanceText({ hasAbove: false, hasBelow: true, turnsAbove: 0, turnsBelow: null, atStart: true, atEnd: false });
  assert.equal(top.above, "");
  assert.equal(top.atStart, true);

  // A window that IS truncated above but whose offsets are 0 (nothing but tool rows precede it):
  // say "earlier history" rather than a bogus "0 earlier turns".
  const odd = H.exoAffordanceText({ hasAbove: true, hasBelow: false, turnsAbove: 0, turnsBelow: 0 });
  assert.equal(odd.above, "▲ earlier history");

  assert.deepEqual(H.exoAffordanceText(null), { above: "", below: "", atStart: false, atEnd: false, hasAbove: false, hasBelow: false });
});

test("exoTierAffordances: only real actions become buttons; `roll` is a note, never a dead button", () => {
  const critical = {
    key: "critical", label: "Critical", tone: "danger", severity: 3, available: true, pct: 94,
    advice: "Auto-compaction is imminent…", actions: ["roll", "compact"],
  };
  const full = H.exoTierAffordances(critical, { compact: true, newChat: true });
  assert.deepEqual(full.buttons.map((b) => b.action), ["compact"], "roll must NOT produce a button — there is no roll control action");
  assert.equal(full.notes.length, 1);
  assert.match(full.notes[0], /engine itself/);
  assert.match(full.notes[0], /archived/, "the note must say history is kept, not deleted");
  assert.equal(full.advice, critical.advice, "the tier's own advice is shown verbatim, not paraphrased");

  const noCompact = H.exoTierAffordances(critical, { compact: false, newChat: false });
  assert.deepEqual(noCompact.buttons, [], "a surface that cannot compact must not offer a compact button");
  assert.equal(noCompact.notes.length, 2, "…and must say so instead of silently dropping the advice");

  const actNow = H.exoTierAffordances(
    { key: "actNow", label: "Act now", tone: "warn", severity: 2, available: true, pct: 84, advice: "Roll or start a new chat…", actions: ["roll", "newChat"] },
    { compact: true, newChat: true }
  );
  assert.deepEqual(actNow.buttons.map((b) => b.action), ["newChat"]);

  const roomy = H.exoTierAffordances({ key: "roomy", label: "Comfortable", tone: "ok", severity: 0, available: true, pct: 12, advice: "Plenty of room", actions: [] }, { compact: true, newChat: true });
  assert.deepEqual(roomy.buttons, []);
  assert.deepEqual(roomy.notes, []);

  const unknown = H.exoTierAffordances(null, { compact: true });
  assert.equal(unknown.available, false);
  assert.equal(unknown.pct, null, "an unknown tier has NO percentage — never 0");
});

test("exoCueLine hedges anything the client inferred, and only that", () => {
  const observed = H.exoCueLine({ kind: "rolling", text: "Rolling to a fresh window… (segment 2)", icon: "⟳", tone: "notice", confidence: "observed", inferred: false });
  assert.equal(observed.hedged, false);
  assert.equal(observed.text, "Rolling to a fresh window… (segment 2)");
  assert.match(observed.title, /Reported by the engine/);

  const guessed = H.exoCueLine({ kind: "compacting", text: "Context 94% full — auto-compaction likely soon", icon: "⟳", tone: "warn", confidence: "heuristic", inferred: true });
  assert.equal(guessed.hedged, true);
  assert.equal(guessed.text, "Possibly: Context 94% full — auto-compaction likely soon");
  assert.match(guessed.title, /GUESS/);
  assert.ok(!/^Context/.test(guessed.text), "a heuristic must never be stated as bare fact");

  // `inferred` alone is enough — a future heuristic cue that forgets `confidence` still gets hedged.
  assert.equal(H.exoCueLine({ text: "x", inferred: true }).hedged, true);
  assert.equal(H.exoCueLine({ text: "x", confidence: "heuristic" }).hedged, true);
  assert.equal(H.exoCueLine(null).text, "");
});

test("exoJumpStatusText: an in-flight jump ALWAYS says something, and terminal states are terminal", () => {
  const searching = { kind: "prompt", number: 1237, attempt: 3, maxAttempts: 12, status: "searching" };
  assert.match(H.exoJumpStatusText(searching), /Finding P#1,237/);
  assert.match(H.exoJumpStatusText(searching), /probe 3 of 12/, "the user must see progress, not a frozen box");
  assert.equal(H.exoJumpBusy(searching), true);

  for (const st of ["landed", "cached", "exhausted", "missing", "error"]) {
    const j = { kind: "response", number: 42, attempt: 12, maxAttempts: 12, status: st, error: "boom" };
    assert.notEqual(H.exoJumpStatusText(j), "", st + " must render text");
    assert.equal(H.exoJumpBusy(j), false, st + " must not leave a spinner running");
  }
  assert.match(H.exoJumpStatusText({ kind: "response", number: 42, status: "exhausted" }), /Recall/, "an exhausted jump must point at the archive");
  assert.match(
    H.exoJumpStatusText({ kind: "prompt", number: 9999, status: "missing", reason: "above-range", count: 600 }),
    /600 prompts/,
    "when the engine reports the turn count, say it"
  );
  assert.match(H.exoJumpStatusText({ kind: "prompt", number: 5, status: "missing", reason: "no-turns" }), /no prompt/);
  assert.equal(H.exoJumpStatusText(null), "");
  assert.equal(H.exoJumpStatusText({}), "");
  assert.equal(H.exoJumpBusy(null), false);
});

test("exoNum / exoTurnRefLabel format the way the existing P#/R# badges do", () => {
  assert.equal(H.exoNum(1349), "1,349");
  assert.equal(H.exoNum(7), "7");
  assert.equal(H.exoTurnRefLabel("response", 1237), "R#1,237");
  assert.equal(H.exoTurnRefLabel("prompt", 1), "P#1");
  assert.equal(H.exoTurnRefLabel(undefined, undefined), "P#0");
});
