// retrieval.mjs — Ch.2.3, retrieval into the agent's context: this is where "the brain got
// smarter" actually happens. Reimplemented (per HANDOFF: "reimplement," not translate 1:1) from
// ECC's two source files, verified against ECC's actual source rather than guessed from memory:
//
//   - scripts/lib/instinct-relevance.js — the relevance-boost math: at SessionStart there is no
//     user task yet, so "relevance" is location/stack relevance. A project-scoped item and a
//     stack-matching item each get a small additive boost on top of raw confidence. Constants
//     (+0.25 project, +0.20 stack) copied exactly; ECC's own comment explains the arithmetic:
//     chosen so a project-scoped 0.7 item (0.7+0.25=0.95) can surface above an unrelated global
//     0.9, and a stack-matching 0.75 item (0.75+0.20=0.95) can too.
//   - scripts/hooks/session-start.js's `summarizeActiveInstincts` + `limitSessionStartContext` —
//     the actual SessionStart budgeting pipeline: filter by confidence floor (0.7) -> compute
//     boost -> sort by (confidence + boost) descending -> cap at N items (6) -> format into a
//     block of text -> hard-truncate THE WHOLE ASSEMBLED BLOCK to a character budget (8000) with
//     a trailing marker if it overflowed. Verified this is a simple slice-based truncation of the
//     final string, NOT a per-item bin-packing algorithm — reading the source mattered here,
//     since "8000-char budget" alone under-specifies which of those two very different things it
//     means.
//
// ADAPTED, not copied verbatim, in one place: ECC's instincts carry structured `domain`/
// `trigger`/`stack` frontmatter fields for stack-matching; our `facts` (lib/knowledgeStore.mjs)
// are freeform text with no such fields, so `matchesStack` tokenizes `fact.text` itself instead.
// Everything else — the constants, the filter/score/sort/cap/format/truncate pipeline shape — is
// a direct port.
//
// SCOPE OF THIS SLICE (deliberate, matches 2.0/2.1/2.2a's pattern): `rankFacts`/`retrieveForContext`
// take `stackKeywords` as a caller-supplied Set<string> — this module does NOT itself detect the
// current project's language/framework stack (ECC's `detectStackKeywords` calls a whole separate
// `project-detect` module). Building a stack detector is a distinct concern from ranking/budgeting
// and is not named in the plan's 2.3 acceptance criteria; wiring a real one in is later work.
// When no stack keywords are supplied, every stack boost is 0 and ranking degrades to
// confidence(+project boost)-only — this is a real, tested code path, not a hypothetical.
//
// ESM. Pure functions only except `retrieveForContext`, which reads via
// lib/knowledgeStore.mjs's `listFacts` (one-directional dependency — knowledgeStore never
// imports this module, so there is no cycle). Never throws.

import { listFacts } from "./knowledgeStore.mjs";

// Additive ranking boosts — copied exactly from ECC's instinct-relevance.js. Deliberately not
// configurable via environment for the same reason ECC gives: this is relevance ranking, not
// another tunable knob on top of the confidence floor / item cap, which already are.
export const PROJECT_SCOPE_BOOST = 0.25;
export const STACK_MATCH_BOOST = 0.2;

// SessionStart budgeting constants — copied exactly from ECC's session-start.js.
export const CONFIDENCE_FLOOR = 0.7;
export const MAX_ITEMS = 6;
export const CONTEXT_CHAR_BUDGET = 8000;

// ECC's observer.md: "Initial confidence based on observation frequency" — a real, documented
// table, not a guess. Reimplemented here as a pure function so a future nudge/detector (2.2b) or
// a human proposing a fact by hand can compute a starting confidence instead of inventing one.
// Returns null for < 1 observation (the table doesn't cover "zero evidence").
const OBSERVATION_FREQUENCY_TABLE = [
  { min: 11, confidence: 0.85 },
  { min: 6, confidence: 0.7 },
  { min: 3, confidence: 0.5 },
  { min: 1, confidence: 0.3 },
];
export function confidenceFromObservationCount(n) {
  const count = Number.isFinite(n) ? Math.floor(n) : 0;
  if (count < 1) return null;
  for (const { min, confidence } of OBSERVATION_FREQUENCY_TABLE) {
    if (count >= min) return confidence;
  }
  return null;
}

/** tokenize(value) → lowercase word tokens (split on non-alphanumerics). Token-SET matching
 *  avoids substring false positives such as the keyword `go` matching the word `good` — copied
 *  from ECC exactly, same rationale. */
export function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** scopeLabel(fact) → "global" iff `fact.scope === "global"`, else "project" — the ONE place this
 *  "anything that isn't exactly global counts as project" rule is defined, shared by
 *  `computeRelevanceBoost` (what gets the boost) and `formatFactsForContext` (what gets
 *  displayed), so a fact with a missing/malformed `scope` can never be labeled one way and scored
 *  another — a real bug this fixed: the boost used to require strict `scope === "project"` while
 *  the display fell back to "project" for anything non-"global", so an edge-case fact (e.g.
 *  `scope: undefined`) would render as `[project NN%]` while silently scoring zero project boost. */
function scopeLabel(fact) {
  return fact && fact.scope === "global" ? "global" : "project";
}

/** matchesStack(fact, stackKeywords) → whether `fact.text`'s tokens intersect `stackKeywords` by
 *  whole-token match, CASE-INSENSITIVE on the keyword side (`tokenize` already lowercases
 *  `fact.text`'s tokens; a caller-supplied keyword like "Go" or "TypeScript" — exactly what a
 *  real stack detector would hand back — must still match, not silently miss because it wasn't
 *  pre-lowercased). Adapted from ECC's `instinctMatchesStack`, which matched against structured
 *  domain/trigger/stack fields our freeform facts don't have — text tokens stand in for those. */
export function matchesStack(fact, stackKeywords) {
  if (!fact || !stackKeywords || stackKeywords.size === 0) return false;
  const tokens = new Set(tokenize(fact.text));
  for (const keyword of stackKeywords) {
    if (tokens.has(String(keyword).toLowerCase())) return true;
  }
  return false;
}

/**
 * computeRelevanceBoost(fact, stackKeywords, opts) → additive boost, deterministic and pure.
 * A project-scoped fact and a stack-matching fact each contribute their boost; both can apply.
 * Copied from ECC's `computeRelevanceBoost` exactly, `fact.scope` standing in for `_scopeLabel`
 * (via the shared `scopeLabel` helper, so this never disagrees with how a fact is displayed).
 */
export function computeRelevanceBoost(fact, stackKeywords, opts = {}) {
  const projectBoost = Number.isFinite(opts.projectBoost) ? opts.projectBoost : PROJECT_SCOPE_BOOST;
  const stackBoost = Number.isFinite(opts.stackBoost) ? opts.stackBoost : STACK_MATCH_BOOST;
  let boost = 0;
  if (fact && scopeLabel(fact) === "project") boost += projectBoost;
  if (matchesStack(fact, stackKeywords)) boost += stackBoost;
  return boost;
}

/**
 * rankFacts(facts, { stackKeywords, confidenceFloor, maxItems, projectBoost, stackBoost,
 * relevanceEnabled }) → a new array, each entry the original fact plus `_relevance` and `_score`,
 * filtered to `confidence >= confidenceFloor` (a fact with a NULL confidence — never scored —
 * never clears the floor; this is the "degrade to confidence-only ranking when nothing matches"
 * path degrading further still to "nothing at all" for genuinely unscored facts, which is
 * correct: an unscored fact has no confidence to rank by), sorted by `(confidence + relevance)`
 * descending, ties broken by `createdAt` descending (newer wins — our domain has no equivalent of
 * ECC's lexical-id tie-break, so recency is the more useful default), capped at `maxItems`.
 *
 * `relevanceEnabled = false` zeroes every boost, collapsing to confidence-only ordering — the
 * same escape hatch ECC's `ECC_INSTINCT_RELEVANCE_RANKING=off` provides, exposed here as a plain
 * option rather than an env var (this module has no business reading process.env).
 */
export function rankFacts(facts, opts = {}) {
  try {
    const list = Array.isArray(facts) ? facts : [];
    const {
      stackKeywords = new Set(),
      confidenceFloor = CONFIDENCE_FLOOR,
      maxItems = MAX_ITEMS,
      projectBoost,
      stackBoost,
      relevanceEnabled = true,
    } = opts && typeof opts === "object" ? opts : {};
    // `>= 0`, not `> 0` — maxItems:0 is a legitimate "give me nothing" request (a real bug
    // before this fix: it silently fell back to the default cap of 6 instead of returning []).
    const cap = Number.isFinite(maxItems) && maxItems >= 0 ? Math.floor(maxItems) : MAX_ITEMS;

    const scored = [];
    for (const fact of list) {
      if (!fact || !Number.isFinite(fact.confidence) || fact.confidence < confidenceFloor) continue;
      const relevance = relevanceEnabled ? computeRelevanceBoost(fact, stackKeywords, { projectBoost, stackBoost }) : 0;
      scored.push({ ...fact, _relevance: relevance, _score: fact.confidence + relevance });
    }

    scored.sort((left, right) => {
      if (right._score !== left._score) return right._score - left._score;
      const leftAt = Number.isFinite(left.createdAt) ? left.createdAt : 0;
      const rightAt = Number.isFinite(right.createdAt) ? right.createdAt : 0;
      return rightAt - leftAt;
    });

    return scored.slice(0, cap);
  } catch {
    return [];
  }
}

/** formatFactsForContext(ranked) → "Active knowledge:\n- [scope NN%] text" block, or "" if
 *  `ranked` is empty. Mirrors ECC's `- [scope confidence%] action` line shape and its "Active
 *  instincts:" header, renamed for our vocabulary (facts, not instincts). */
export function formatFactsForContext(ranked) {
  const list = Array.isArray(ranked) ? ranked : [];
  if (!list.length) return "";
  const lines = list.map((f) => {
    const scope = scopeLabel(f);
    const pct = `${Math.round((Number.isFinite(f.confidence) ? f.confidence : 0) * 100)}%`;
    return `- [${scope} ${pct}] ${f.text}`;
  });
  return `Active knowledge:\n${lines.join("\n")}`;
}

/**
 * limitContextChars(text, maxChars) → `text` unchanged if it already fits, else hard-truncated
 * with a trailing marker — copied from ECC's `limitSessionStartContext` exactly (same slice
 * arithmetic, same "why", generalized off its ECC-specific env-var names in the marker text).
 */
export function limitContextChars(text, maxChars = CONTEXT_CHAR_BUDGET) {
  const context = String(text || "");
  if (context.length <= maxChars) return context;
  const marker = "\n\n[Context truncated to fit the retrieval budget.]";
  const prefixLength = Math.max(0, maxChars - marker.length);
  return `${context.slice(0, prefixLength).trimEnd()}${marker}`.slice(0, maxChars);
}

/**
 * retrieveForContext(db, { conversationId, kind, stackKeywords, confidenceFloor, maxItems,
 * charBudget, relevanceEnabled, poolLimit = 200 }) → { text, count, truncated }
 *
 * The composed end-to-end pipeline a SessionStart-style hook would call: list candidate facts
 * (optionally scoped to a conversationId/kind — omit for the whole brain, not just one
 * conversation, since a fact learned in one conversation should surface in a different one
 * later) -> rank -> format -> budget. `poolLimit` bounds how many candidate rows are pulled from
 * the store before ranking (a cheap safety cap, independent of `maxItems`'s post-rank cap).
 */
export function retrieveForContext(db, opts = {}) {
  try {
    const {
      conversationId, kind, stackKeywords, confidenceFloor, maxItems, charBudget,
      relevanceEnabled, poolLimit = 200,
    } = opts && typeof opts === "object" ? opts : {};
    const pool = listFacts(db, { conversationId, kind, limit: poolLimit });
    const ranked = rankFacts(pool, { stackKeywords, confidenceFloor, maxItems, relevanceEnabled });
    const formatted = formatFactsForContext(ranked);
    const text = limitContextChars(formatted, charBudget);
    return { text, count: ranked.length, truncated: text.length < formatted.length };
  } catch {
    return { text: "", count: 0, truncated: false };
  }
}
