// Tests for lib/retrieval.mjs — Ch.2.3's port of ECC's instinct-relevance.js + SessionStart
// budgeting pipeline: confidence floor, relevance boosts, item cap, char-budget truncation.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  PROJECT_SCOPE_BOOST,
  STACK_MATCH_BOOST,
  CONFIDENCE_FLOOR,
  MAX_ITEMS,
  CONTEXT_CHAR_BUDGET,
  confidenceFromObservationCount,
  tokenize,
  matchesStack,
  computeRelevanceBoost,
  rankFacts,
  formatFactsForContext,
  limitContextChars,
  retrieveForContext,
} from "./retrieval.mjs";
import { openDb, addFact } from "./knowledgeStore.mjs";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "retrieval-"));
}

test("constants match what was verified against ECC's actual source, not memory", () => {
  assert.equal(PROJECT_SCOPE_BOOST, 0.25);
  assert.equal(STACK_MATCH_BOOST, 0.2);
  assert.equal(CONFIDENCE_FLOOR, 0.7);
  assert.equal(MAX_ITEMS, 6);
  assert.equal(CONTEXT_CHAR_BUDGET, 8000);
});

// ---------------------------------------------------------------------------
// confidenceFromObservationCount — ECC's observation-frequency table
// ---------------------------------------------------------------------------

test("confidenceFromObservationCount follows ECC's documented frequency table exactly", () => {
  assert.equal(confidenceFromObservationCount(0), null, "zero observations — no evidence to score");
  assert.equal(confidenceFromObservationCount(1), 0.3);
  assert.equal(confidenceFromObservationCount(2), 0.3);
  assert.equal(confidenceFromObservationCount(3), 0.5);
  assert.equal(confidenceFromObservationCount(5), 0.5);
  assert.equal(confidenceFromObservationCount(6), 0.7);
  assert.equal(confidenceFromObservationCount(10), 0.7);
  assert.equal(confidenceFromObservationCount(11), 0.85);
  assert.equal(confidenceFromObservationCount(500), 0.85);
  assert.equal(confidenceFromObservationCount(-3), null);
  assert.equal(confidenceFromObservationCount(NaN), null);
  assert.equal(confidenceFromObservationCount(undefined), null);
});

// ---------------------------------------------------------------------------
// tokenize / matchesStack / computeRelevanceBoost
// ---------------------------------------------------------------------------

test("tokenize splits on non-alphanumerics and lowercases, avoiding substring false positives", () => {
  assert.deepEqual(tokenize("Use Go for the backend"), ["use", "go", "for", "the", "backend"]);
  assert.deepEqual(tokenize("good code"), ["good", "code"], "`go` must not match inside `good`");
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize(null), []);
});

test("matchesStack matches on whole-token intersection with fact.text, not substring", () => {
  assert.equal(matchesStack({ text: "always run go vet before committing" }, new Set(["go"])), true);
  assert.equal(matchesStack({ text: "this code looks good" }, new Set(["go"])), false, "substring inside `good` must not count");
  assert.equal(matchesStack({ text: "no relevant keywords here" }, new Set(["rust"])), false);
  assert.equal(matchesStack({ text: "x" }, new Set()), false, "empty stack keyword set never matches");
  assert.equal(matchesStack(null, new Set(["go"])), false);
  assert.equal(matchesStack({ text: "go" }, null), false);
});

test("matchesStack is case-insensitive on the keyword side — a real stack detector hands back \"Go\"/\"TypeScript\", not lowercase", () => {
  assert.equal(matchesStack({ text: "use go for the backend" }, new Set(["Go"])), true);
  assert.equal(matchesStack({ text: "written in typescript" }, new Set(["TypeScript"])), true);
  assert.equal(matchesStack({ text: "nothing relevant" }, new Set(["RUST"])), false);
});

test("computeRelevanceBoost sums project + stack boosts independently, defaults match the exported constants", () => {
  const stack = new Set(["rust"]);
  assert.equal(computeRelevanceBoost({ scope: "project", text: "irrelevant" }, stack), PROJECT_SCOPE_BOOST);
  assert.equal(computeRelevanceBoost({ scope: "global", text: "use rust for this" }, stack), STACK_MATCH_BOOST);
  assert.equal(computeRelevanceBoost({ scope: "project", text: "use rust for this" }, stack), PROJECT_SCOPE_BOOST + STACK_MATCH_BOOST);
  assert.equal(computeRelevanceBoost({ scope: "global", text: "nothing matches" }, stack), 0);
  assert.equal(computeRelevanceBoost({ scope: "project", text: "x" }, stack, { projectBoost: 0.5 }), 0.5, "custom boost override");
});

// ---------------------------------------------------------------------------
// rankFacts — the filter/score/sort/cap pipeline
// ---------------------------------------------------------------------------

test("rankFacts excludes anything below the confidence floor, INCLUDING null (unscored) confidence", () => {
  const facts = [
    { id: 1, text: "a", confidence: 0.9, scope: "global", createdAt: 1 },
    { id: 2, text: "b", confidence: 0.69, scope: "global", createdAt: 2 }, // just under the 0.7 floor
    { id: 3, text: "c", confidence: null, scope: "global", createdAt: 3 }, // never scored
    { id: 4, text: "d", scope: "global", createdAt: 4 }, // confidence entirely absent
  ];
  const ranked = rankFacts(facts);
  assert.deepEqual(ranked.map((f) => f.id), [1]);
});

test("rankFacts sorts by (confidence + relevance) descending — a project-scoped 0.7 outranks an unrelated global 0.9 by exactly the boost math ECC's comment describes", () => {
  const facts = [
    { id: 1, text: "unrelated global fact", confidence: 0.9, scope: "global", createdAt: 1 },
    { id: 2, text: "project fact", confidence: 0.7, scope: "project", createdAt: 2 },
  ];
  const ranked = rankFacts(facts); // 0.7+0.25=0.95 > 0.9
  assert.deepEqual(ranked.map((f) => f.id), [2, 1]);
});

test("rankFacts stack-matching boost can also surface a lower-confidence fact above an unrelated higher one", () => {
  const facts = [
    { id: 1, text: "unrelated", confidence: 0.9, scope: "global", createdAt: 1 },
    { id: 2, text: "always use rust for this", confidence: 0.75, scope: "global", createdAt: 2 },
  ];
  const ranked = rankFacts(facts, { stackKeywords: new Set(["rust"]) }); // 0.75+0.2=0.95 > 0.9
  assert.deepEqual(ranked.map((f) => f.id), [2, 1]);
});

test("rankFacts ties break on createdAt descending (newer wins)", () => {
  const facts = [
    { id: 1, text: "older", confidence: 0.8, scope: "global", createdAt: 100 },
    { id: 2, text: "newer", confidence: 0.8, scope: "global", createdAt: 200 },
  ];
  assert.deepEqual(rankFacts(facts).map((f) => f.id), [2, 1]);
});

test("rankFacts caps at maxItems (default 6)", () => {
  const facts = Array.from({ length: 10 }, (_, i) => ({ id: i, text: `fact ${i}`, confidence: 0.9, scope: "global", createdAt: i }));
  assert.equal(rankFacts(facts).length, 6);
  assert.equal(rankFacts(facts, { maxItems: 2 }).length, 2);
});

test("rankFacts with maxItems:0 returns nothing — a legitimate request, not a fallback to the default cap", () => {
  const facts = [{ id: 1, text: "x", confidence: 0.9, scope: "global", createdAt: 1 }];
  assert.deepEqual(rankFacts(facts, { maxItems: 0 }), []);
  // Only genuinely invalid values (negative, non-numeric) fall back to the default.
  assert.equal(rankFacts(facts, { maxItems: -1 }).length, 1);
  assert.equal(rankFacts(facts, { maxItems: "not a number" }).length, 1);
});

test("relevanceEnabled: false collapses ranking to confidence-only, ignoring scope/stack entirely", () => {
  const facts = [
    { id: 1, text: "unrelated global", confidence: 0.9, scope: "global", createdAt: 1 },
    { id: 2, text: "project fact using rust", confidence: 0.7, scope: "project", createdAt: 2 },
  ];
  const ranked = rankFacts(facts, { stackKeywords: new Set(["rust"]), relevanceEnabled: false });
  assert.deepEqual(ranked.map((f) => f.id), [1, 2], "0.9 beats 0.7 once every boost is zeroed");
  assert.equal(ranked[1]._relevance, 0);
});

test("rankFacts never throws on bad input", () => {
  assert.deepEqual(rankFacts(null), []);
  assert.deepEqual(rankFacts(undefined), []);
  assert.deepEqual(rankFacts([null, undefined, 42]), []);
});

// ---------------------------------------------------------------------------
// formatFactsForContext / limitContextChars
// ---------------------------------------------------------------------------

test("formatFactsForContext renders the '- [scope NN%] text' line shape, or '' when empty", () => {
  assert.equal(formatFactsForContext([]), "");
  const block = formatFactsForContext([
    { text: "always validate input", scope: "global", confidence: 0.9 },
    { text: "prefer explicit error types", scope: "project", confidence: 0.75 },
  ]);
  assert.equal(block, "Active knowledge:\n- [global 90%] always validate input\n- [project 75%] prefer explicit error types");
});

test("a fact's displayed scope label and its scoring treatment never disagree, even for a malformed/missing scope — regression for a real inconsistency", () => {
  // Before the fix: computeRelevanceBoost required strict scope === "project" for the boost,
  // while formatFactsForContext labeled anything non-"global" as "project" — so a fact with
  // scope: undefined displayed as "[project ...]" while silently scoring ZERO project boost.
  const malformed = { text: "x", confidence: 0.7, createdAt: 1 }; // scope entirely absent
  assert.equal(computeRelevanceBoost(malformed, new Set()), PROJECT_SCOPE_BOOST, "displayed as project — must also score the project boost");
  const [rendered] = formatFactsForContext([{ ...malformed, confidence: 0.7 }]).split("\n").slice(1);
  assert.match(rendered, /^- \[project /);

  const ranked = rankFacts([malformed]);
  assert.equal(ranked[0]._score, 0.7 + PROJECT_SCOPE_BOOST, "rankFacts' actual scoring agrees with both of the above");
});

test("limitContextChars leaves short text untouched, hard-truncates long text with a trailing marker", () => {
  assert.equal(limitContextChars("short", 8000), "short");
  const long = "x".repeat(9000);
  const truncated = limitContextChars(long, 8000);
  assert.equal(truncated.length, 8000, "the RESULT must respect the budget exactly");
  assert.ok(truncated.includes("[Context truncated"));
  assert.ok(truncated.startsWith("xxxx"));
});

test("limitContextChars at the exact boundary is untouched (== is not truncated)", () => {
  const exact = "x".repeat(8000);
  assert.equal(limitContextChars(exact, 8000), exact);
});

// ---------------------------------------------------------------------------
// retrieveForContext — the composed end-to-end pipeline
// ---------------------------------------------------------------------------

const PROV = { conversationId: "c1", turnKind: "prompt", turnNumber: 1, at: 1700000000000 };

test("retrieveForContext composes list -> rank -> format -> budget over a real store", () => {
  const base = tmp();
  const db = openDb(base);
  addFact(db, { text: "unscored fact, never surfaces", ...PROV }); // no confidence
  addFact(db, { text: "below the floor", confidence: 0.5, ...PROV });
  addFact(db, { text: "clears the floor, global", confidence: 0.9, scope: "global", ...PROV });
  addFact(db, { text: "clears the floor, project scoped", confidence: 0.72, scope: "project", ...PROV });

  const result = retrieveForContext(db, {});
  assert.equal(result.count, 2);
  assert.ok(result.text.includes("clears the floor, global"));
  assert.ok(result.text.includes("clears the floor, project scoped"));
  assert.ok(!result.text.includes("unscored fact"));
  assert.ok(!result.text.includes("below the floor"));
  assert.equal(result.truncated, false);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("retrieveForContext degrades to confidence-only when no stack matches anything — a real code path, not hypothetical", () => {
  const base = tmp();
  const db = openDb(base);
  addFact(db, { text: "a fact about kubernetes", confidence: 0.75, scope: "global", ...PROV });
  addFact(db, { text: "a fact about something else entirely", confidence: 0.71, scope: "global", ...PROV });

  const result = retrieveForContext(db, { stackKeywords: new Set(["rust", "terraform"]) }); // matches neither
  assert.equal(result.count, 2, "both still surface, ranked purely on confidence since no boost applied to either");
  assert.ok(result.text.indexOf("kubernetes") < result.text.indexOf("something else"), "higher confidence (0.75) still ranks first");
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("retrieveForContext truncates when the assembled block exceeds the char budget", () => {
  const base = tmp();
  const db = openDb(base);
  addFact(db, { text: "x".repeat(9000), confidence: 0.9, ...PROV });

  const result = retrieveForContext(db, { charBudget: 500 });
  assert.equal(result.truncated, true);
  assert.equal(result.text.length, 500);
  db.close();
  fs.rmSync(base, { recursive: true, force: true });
});

test("retrieveForContext never throws on a null db", () => {
  assert.deepEqual(retrieveForContext(null, {}), { text: "", count: 0, truncated: false });
});
