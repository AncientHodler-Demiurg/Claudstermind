// Tests for lib/wrapHandoff.mjs — Ch.2.5a: the real-handoff generation/caching/freshness logic
// that replaces the mechanical buildSeedText summary at wrap time, without losing its "never
// stalls the roll" property.

import test from "node:test";
import assert from "node:assert/strict";

import {
  HANDOFF_STALE_AFTER_TURNS,
  buildHandoffPrompt,
  isHandoffFresh,
  resolveHandoff,
  generateHandoff,
} from "./wrapHandoff.mjs";

const u = (text) => ({ role: "user", text });
const a = (text) => ({ role: "assistant", text });

// ---------------------------------------------------------------------------
// buildHandoffPrompt
// ---------------------------------------------------------------------------

test("buildHandoffPrompt asks for exactly the four named sections", () => {
  const prompt = buildHandoffPrompt({ rows: [u("hi")], sourceRef: "conv-1#seg0" });
  assert.match(prompt, /## Decisions Made/);
  assert.match(prompt, /## Current State/);
  assert.match(prompt, /## Open Threads/);
  assert.match(prompt, /## Where to Recall From/);
});

test("buildHandoffPrompt folds in the transcript excerpt via conversationRoll's own rendering", () => {
  const prompt = buildHandoffPrompt({ rows: [u("what should we use for search"), a("FTS5")] });
  assert.match(prompt, /\*\*You:\*\* what should we use for search/);
  assert.match(prompt, /\*\*Agent:\*\* FTS5/);
});

test("buildHandoffPrompt folds in already-recorded decisions and facts as structured context, not asking the model to re-derive them", () => {
  const prompt = buildHandoffPrompt({
    rows: [],
    decisions: [{ title: "Use SQLite FTS5", rationale: "zero new deps" }],
    facts: [{ text: "Claudstermind is model-agnostic" }],
  });
  assert.match(prompt, /Use SQLite FTS5 — zero new deps/);
  assert.match(prompt, /Claudstermind is model-agnostic/);
});

test("buildHandoffPrompt degrades gracefully with no decisions/facts/rows/sourceRef", () => {
  const prompt = buildHandoffPrompt({});
  assert.match(prompt, /\(none recorded\)/);
  assert.match(prompt, /\(unknown\)/);
  assert.doesNotThrow(() => buildHandoffPrompt());
  assert.doesNotThrow(() => buildHandoffPrompt(null), "an explicit null, not just undefined, must not throw");
});

// ---------------------------------------------------------------------------
// isHandoffFresh / resolveHandoff — the three explicit branches, not an inferred "else"
// ---------------------------------------------------------------------------

test("HANDOFF_STALE_AFTER_TURNS is 50, a documented tunable, not a magic inline number", () => {
  assert.equal(HANDOFF_STALE_AFTER_TURNS, 50);
});

test("branch 1: a FRESH cache is used verbatim", () => {
  const cached = { text: "real handoff content", generatedAtTurn: 600 };
  assert.equal(isHandoffFresh(cached, 620), true, "20 turns elapsed, well under the 50-turn tolerance");
  const result = resolveHandoff({ cached, currentTurns: 620, mechanicalSummary: "mechanical fallback" });
  assert.deepEqual(result, { text: "real handoff content", source: "cached" });
});

test("branch 2: a STALE cache (conversation moved materially past generation) falls back to mechanical", () => {
  const cached = { text: "real handoff content", generatedAtTurn: 600 };
  assert.equal(isHandoffFresh(cached, 700), false, "100 turns elapsed, over the 50-turn tolerance");
  const result = resolveHandoff({ cached, currentTurns: 700, mechanicalSummary: "mechanical fallback" });
  assert.deepEqual(result, { text: "mechanical fallback", source: "mechanical" });
});

test("branch 3: NO cache yet (wrap fired before the 60% generation ever ran) falls back to mechanical", () => {
  assert.equal(isHandoffFresh(null, 620), false);
  assert.equal(isHandoffFresh(undefined, 620), false);
  const result = resolveHandoff({ cached: null, currentTurns: 620, mechanicalSummary: "mechanical fallback" });
  assert.deepEqual(result, { text: "mechanical fallback", source: "mechanical" });
});

test("isHandoffFresh rejects malformed cache shapes without throwing", () => {
  assert.equal(isHandoffFresh({ text: "" }, 10), false, "empty text");
  assert.equal(isHandoffFresh({ text: "x" }, 10), false, "missing generatedAtTurn");
  assert.equal(isHandoffFresh({ text: "x", generatedAtTurn: "not a number" }, 10), false);
  assert.equal(isHandoffFresh({ text: "x", generatedAtTurn: 100 }, NaN), false, "bad currentTurns");
  assert.equal(isHandoffFresh({ text: "x", generatedAtTurn: 100 }, 50), false, "currentTurns went BACKWARD — never fresh");
});

test("isHandoffFresh at the exact staleness boundary is still fresh (<=, not <)", () => {
  const cached = { text: "x", generatedAtTurn: 100 };
  assert.equal(isHandoffFresh(cached, 150), true, "exactly HANDOFF_STALE_AFTER_TURNS elapsed");
  assert.equal(isHandoffFresh(cached, 151), false, "one turn past the boundary");
});

test("isHandoffFresh/resolveHandoff accept a custom staleAfterTurns override", () => {
  const cached = { text: "x", generatedAtTurn: 100 };
  assert.equal(isHandoffFresh(cached, 105, { staleAfterTurns: 3 }), false);
  const result = resolveHandoff({ cached, currentTurns: 105, mechanicalSummary: "fallback", staleAfterTurns: 3 });
  assert.equal(result.source, "mechanical");
});

test("resolveHandoff never throws on missing/malformed input, INCLUDING an explicit null (not just undefined)", () => {
  assert.deepEqual(resolveHandoff({}), { text: "", source: "mechanical" });
  assert.deepEqual(resolveHandoff(), { text: "", source: "mechanical" });
  assert.deepEqual(resolveHandoff(null), { text: "", source: "mechanical" });
});

test("isHandoffFresh never throws when opts is an explicit null", () => {
  assert.equal(isHandoffFresh({ text: "x", generatedAtTurn: 1 }, 2, null), true);
});

// ---------------------------------------------------------------------------
// generateHandoff — the injected-generator orchestration, no-stall on failure
// ---------------------------------------------------------------------------

test("generateHandoff shapes a successful generation into a fresh-comparable cache entry", async () => {
  const fakeGenerate = async (prompt) => {
    assert.match(prompt, /## Decisions Made/, "the generator receives the real prompt");
    return "  ## Decisions Made\nUsed FTS5.\n  ";
  };
  const result = await generateHandoff({ rows: [u("hi")], currentTurns: 620, sourceRef: "c#seg1", generate: fakeGenerate });
  assert.ok(result);
  assert.equal(result.text, "## Decisions Made\nUsed FTS5.", "trimmed");
  assert.equal(result.generatedAtTurn, 620);
  assert.ok(Number.isFinite(result.generatedAt));

  // And it round-trips through isHandoffFresh/resolveHandoff correctly.
  assert.equal(isHandoffFresh(result, 630), true);
});

test("generateHandoff NEVER throws when the generator rejects — a failed generation must not stall or crash anything", async () => {
  const failing = async () => { throw new Error("model unavailable"); };
  const result = await generateHandoff({ rows: [], currentTurns: 10, generate: failing });
  assert.equal(result, null);
});

test("generateHandoff treats an empty/whitespace-only generation as a failure, never caches garbage", async () => {
  assert.equal(await generateHandoff({ rows: [], currentTurns: 10, generate: async () => "" }), null);
  assert.equal(await generateHandoff({ rows: [], currentTurns: 10, generate: async () => "   " }), null);
  assert.equal(await generateHandoff({ rows: [], currentTurns: 10, generate: async () => null }), null);
});

test("generateHandoff requires a valid generator function and a finite currentTurns", async () => {
  assert.equal(await generateHandoff({ rows: [], currentTurns: 10 }), null, "no generate() supplied");
  assert.equal(await generateHandoff({ rows: [], generate: async () => "text" }), null, "no currentTurns supplied — nothing for later freshness checks to compare against");
  assert.equal(await generateHandoff({ rows: [], currentTurns: NaN, generate: async () => "text" }), null);
});

test("generateHandoff never throws on completely malformed input", async () => {
  assert.equal(await generateHandoff(), null);
  assert.equal(await generateHandoff(null), null);
});
