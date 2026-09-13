// node --test lib/conversationRoll.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  ROLL_DEFAULTS,
  conversationStats,
  shouldRoll,
  splitForRoll,
  buildSeedText,
  segmentRef,
} from "./conversationRoll.mjs";

// Helpers to build transcript rows.
const u = (text, extra = {}) => ({ role: "user", text, at: 1, ...extra });
const a = (text, extra = {}) => ({ role: "assistant", text, at: 2, ...extra });
const tool = (name) => ({ role: "tool", name });

function convo(nTurns) {
  const rows = [];
  for (let i = 0; i < nTurns; i++) {
    rows.push(i % 2 === 0 ? u(`prompt ${i}`) : a(`response ${i}`));
  }
  return rows;
}

test("ROLL_DEFAULTS values are locked and frozen", () => {
  // Raised on MEASURED evidence (2026-09-06) from the real 8,287-turn workspace transcript:
  // 546 chars ≈ 137 tokens per carried turn, because the seed is prose-only (buildSeedText renders
  // tool rows as `[tool: name]`, and s.transcript only ever holds user/assistant turns).
  //   tailTurns  40 → 200   ≈5,500 → ≈27,300 tok: 5x the carried context for ~2.7% of a 1M window
  //   maxTurns  400 → 1000  a turn is one ROW, so 400 was only ~200 exchanges and fired far too early
  assert.equal(ROLL_DEFAULTS.maxTurns, 1000);
  assert.equal(ROLL_DEFAULTS.maxBytes, 25 * 1024 * 1024);   // MiB; ~6x further away than a 1M window
  assert.equal(ROLL_DEFAULTS.tailTurns, 200);
  assert.ok(Object.isFrozen(ROLL_DEFAULTS));
});

test("the carried seed is PROSE ONLY — tool payloads never travel into a new window", () => {
  // This is the property that makes a large tailTurns affordable, so it is asserted rather than assumed.
  const rows = [
    { role: "user", text: "do the thing", images: [{ path: "a.png" }] },
    { kind: "tool_use", name: "Bash", input: { command: "x".repeat(50000) } },
    { kind: "tool_result", content: "y".repeat(200000) },
    { role: "assistant", text: "done" },
  ];
  const seed = buildSeedText({ summary: "s", tailRows: rows, sourceRef: "c#seg1" });
  assert.ok(!seed.includes("x".repeat(100)), "a tool's input must not be carried verbatim");
  assert.ok(!seed.includes("y".repeat(100)), "a tool's output must not be carried verbatim");
  assert.match(seed, /\[tool: Bash\]/, "…it becomes a named placeholder instead");
  assert.match(seed, /\[image\]/, "images become placeholders too — the bytes live on disk");
  assert.ok(seed.length < 2000, `a seed over 4 tool payloads should stay tiny, got ${seed.length} chars`);
});

test("conversationStats counts turns/prompts/responses and byte length", () => {
  const arr = [u("hi"), a("yo"), tool("Read"), u("again")];
  const s = conversationStats(arr);
  assert.equal(s.prompts, 2);
  assert.equal(s.responses, 1);
  assert.equal(s.turns, 3); // tool row is not a turn
  assert.equal(s.bytes, new TextEncoder().encode(JSON.stringify(arr)).length);
});

test("conversationStats guards bad input", () => {
  assert.deepEqual(conversationStats(null), { turns: 0, prompts: 0, responses: 0, bytes: 2 });
  assert.deepEqual(conversationStats(undefined).turns, 0);
});

test("shouldRoll — turns threshold (>= maxTurns)", () => {
  // Boundaries follow ROLL_DEFAULTS.maxTurns rather than a hardcoded 400, so raising the default
  // cannot leave a stale literal asserting the old behaviour.
  const cap = ROLL_DEFAULTS.maxTurns;
  assert.equal(shouldRoll({ turns: cap - 1, bytes: 0 }), false);
  assert.equal(shouldRoll({ turns: cap, bytes: 0 }), true);      // at the boundary
  assert.equal(shouldRoll({ turns: cap + 1, bytes: 0 }), true);
});

test("shouldRoll — bytes threshold (>= maxBytes)", () => {
  const cap = ROLL_DEFAULTS.maxBytes;
  assert.equal(shouldRoll({ turns: 0, bytes: cap - 1 }), false);
  assert.equal(shouldRoll({ turns: 0, bytes: cap }), true); // at the boundary
  assert.equal(shouldRoll({ turns: 0, bytes: cap + 1 }), true);
});

test("shouldRoll — either trigger fires; custom opts honored", () => {
  assert.equal(shouldRoll({ turns: ROLL_DEFAULTS.maxTurns + 100, bytes: 0 }), true);
  assert.equal(shouldRoll({ turns: 0, bytes: 1e9 }), true);
  assert.equal(shouldRoll({ turns: 5, bytes: 5 }, { maxTurns: 5, maxBytes: 999 }), true);
  assert.equal(shouldRoll({ turns: 4, bytes: 5 }, { maxTurns: 5, maxBytes: 999 }), false);
});

test("splitForRoll returns exactly the last N turns verbatim + correct head", () => {
  const arr = convo(100); // 100 turns, no tool rows
  const { head, tail } = splitForRoll(arr, 40);
  assert.equal(head.length, 60);
  assert.equal(tail.length, 40);
  // tail is verbatim = the last 40 rows of the source, in order
  assert.deepEqual(tail, arr.slice(60));
  // head + tail reconstructs the whole array
  assert.deepEqual([...head, ...tail], arr);
});

test("splitForRoll carries interleaved tool rows within the span; leading tool rows stay in head", () => {
  // Layout: [tool, u, tool, a, u]  ; ask for last 2 turns.
  const arr = [tool("Bash"), u("q1"), tool("Read"), a("r1"), u("q2")];
  const { head, tail } = splitForRoll(arr, 2);
  // last 2 turns are a("r1") and u("q2"); the tool row between them is carried,
  // but the leading tool and the first turn stay in head.
  assert.deepEqual(head, [tool("Bash"), u("q1"), tool("Read")]);
  assert.deepEqual(tail, [a("r1"), u("q2")]);
});

test("splitForRoll short-array edge cases: all tail, empty head", () => {
  const arr = convo(10);
  const { head, tail } = splitForRoll(arr, 40);
  assert.deepEqual(head, []);
  assert.deepEqual(tail, arr);

  // exactly tailTurns turns → still all tail
  const exact = convo(40);
  const r2 = splitForRoll(exact, 40);
  assert.deepEqual(r2.head, []);
  assert.equal(r2.tail.length, 40);

  // empty / bad input
  assert.deepEqual(splitForRoll([], 40), { head: [], tail: [] });
  assert.deepEqual(splitForRoll(null, 40), { head: [], tail: [] });
});

test("splitForRoll uses the default tailTurns (200)", () => {
  const arr = convo(250);
  const { head, tail } = splitForRoll(arr);
  assert.equal(tail.length, 200);
  assert.equal(head.length, 50);
});

test("buildSeedText contains the summary, renders tail turns, and the source footer", () => {
  const summary = "The user built a parser and we fixed two bugs.";
  const tailRows = [u("What next?"), a("Ship it."), tool("Bash")];
  const seed = buildSeedText({ summary, tailRows, sourceRef: "conv-1#seg3" });

  assert.match(seed, /## Carried-forward summary/);
  assert.match(seed, /The user built a parser and we fixed two bugs\./);
  assert.match(seed, /## Recent turns \(verbatim\)/);
  assert.match(seed, /\*\*You:\*\* What next\?/);
  assert.match(seed, /\*\*Agent:\*\* Ship it\./);
  assert.match(seed, /\[tool: Bash\]/);
  assert.match(seed, /conv-1#seg3/);
});

test("buildSeedText renders [image] placeholders and skips empty turns", () => {
  const tailRows = [
    u("look at this", { images: ["blob-a", "blob-b"] }),
    a(""), // empty assistant turn → skipped
    { role: "tool" }, // tool row with no name → [tool]
  ];
  const seed = buildSeedText({ summary: "s", tailRows, sourceRef: "x" });
  assert.match(seed, /\*\*You:\*\* look at this \[image\] \[image\]/);
  assert.match(seed, /\[tool\]/);
  assert.doesNotMatch(seed, /\*\*Agent:\*\*/); // empty assistant turn was skipped
});

// THE REPORT, real production sequence: a wrap fired the instant after the agent asked "Does this
// design look right? Approve it and we move to planning." — its own unanswered question. roll()
// submits the ENTIRE seed as the fresh session's first message, so the model's very next input reads
// like a continuation of a dialogue it never got a reply to. Observed: it answered its own question —
// "Confirmed — the design looks right. Please proceed to planning." — and was about to act on an
// approval that was never actually given. The user's next real message was "so go ahead with the
// planning, or have you lost context?", catching it before any planning work happened.
test("buildSeedText warns the model when the tail ends on ITS OWN unanswered question", () => {
  const tailRows = [u("Looked into it."), a("Design is at design.md. Does this design look right? Approve it and we move to planning.")];
  const seed = buildSeedText({ summary: "s", tailRows, sourceRef: "conv-1#seg2" });
  assert.match(seed, /not a new message from your user/i);
  assert.match(seed, /unanswered/i);
  assert.match(seed, /do not assume it was approved/i);
});

test("buildSeedText adds NO warning when the tail does not end on a question", () => {
  const tailRows = [u("What next?"), a("Ship it.")];
  const seed = buildSeedText({ summary: "s", tailRows, sourceRef: "x" });
  assert.doesNotMatch(seed, /not a new message from your user/i);
});

test("buildSeedText: a trailing tool row after the question doesn't hide the warning", () => {
  // A question can be immediately followed by tool-use bookkeeping rows before the roll boundary —
  // the LAST REAL TURN is what matters, not the literal last row.
  const tailRows = [a("Approve it?"), { role: "tool", name: "Bash" }];
  const seed = buildSeedText({ summary: "s", tailRows, sourceRef: "x" });
  assert.match(seed, /not a new message from your user/i);
});

test("buildSeedText: a trailing USER question is not the agent's own — no warning", () => {
  // The signal is specifically "the AGENT is waiting on itself" (roll() makes the seed look like a
  // user message, so an agent-authored question at the tail is the one that gets silently
  // self-answered). A user's own trailing question is a different, unrelated shape.
  const tailRows = [a("Here's the plan."), u("Does this look right to you?")];
  const seed = buildSeedText({ summary: "s", tailRows, sourceRef: "x" });
  assert.doesNotMatch(seed, /not a new message from your user/i);
});

test("buildSeedText guards missing/empty fields", () => {
  const seed = buildSeedText();
  assert.match(seed, /## Carried-forward summary/);
  assert.match(seed, /_\(no summary provided\)_/);
  assert.match(seed, /_\(no recent turns\)_/);
  assert.match(seed, /\(unknown\)/);
});

test("segmentRef produces a stable id string", () => {
  assert.equal(segmentRef("conv-1", 0), "conv-1#seg0");
  assert.equal(segmentRef("conv-1", 3), "conv-1#seg3");
  assert.equal(segmentRef(42, 2), "42#seg2");
  assert.equal(segmentRef(null, null), "#seg0");
});
