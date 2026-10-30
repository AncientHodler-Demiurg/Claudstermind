// wrapHandoff.mjs — Ch.2.5a, the REAL handoff that replaces the mechanical one at wrap time —
// the generation/caching/freshness logic only. Wiring this into a live roll (lib/workspace.mjs's
// `_performRoll`, plus the client-side 60%-of-context "generate now" trigger that today lives
// entirely in ChatShell.wrapReadiness) is 2.5b, deliberately deferred, same split as 2.2a/2.2b
// and 2.3a/2.3b — this module has no opinion on WHEN it's called, only on what happens once it is.
//
// THE PROBLEM (docs/work/exocortex/plan.md 2.5): `buildSeedText` (lib/conversationRoll.mjs) is a
// deliberately mechanical summary — the first line of each archived user prompt — chosen so a
// roll can never stall waiting on model-quality summarization. That was fine when a human watched
// every wrap. Auto-continue now runs unattended: a wrap mid-sweep hands a fresh window a list of
// prompt TITLES, with nobody there to notice the handoff carries what was asked, never what was
// DECIDED.
//
// THE FIX, without losing the no-stall property: generate the REAL handoff EARLY — at the 60%
// manual-wrap threshold, long before the roll actually has to happen — cache it, and consult the
// cache at actual wrap time. Three explicit outcomes, not an inferred "else":
//   1. A fresh cache exists  -> use it verbatim.
//   2. A STALE cache exists (conversation moved materially past where it was generated)
//                            -> fall back to the mechanical summary, exactly as today.
//   3. No cache exists yet (wrap fired before the 60% mark ever ran, or generation failed)
//                            -> fall back to the mechanical summary, exactly as today.
// The roll itself NEVER waits on a model call — generation, if it happens at all, happened
// earlier and off the roll's own critical path.
//
// CONTENT (plan.md 2.5): decisions, current state, open threads, and where to recall from — not
// a retelling of what was asked. `buildHandoffPrompt` feeds a model the ACTUAL transcript excerpt
// (via conversationRoll.renderRows — the same rendering buildSeedText itself uses, reused rather
// than duplicated) plus any already-recorded decisions/facts (Ch.2.1), and asks for exactly those
// four sections.
//
// Pure functions except `generateHandoff`, which takes an INJECTED async `generate(prompt)`
// callback rather than calling any specific model/SDK itself — keeps this module testable with a
// fake generator and keeps "which model, which session" a 2.5b wiring decision, not baked in here.
//
// ESM, no imports beyond lib/conversationRoll.mjs's `renderRows`. Never throws.

import { renderRows } from "./conversationRoll.mjs";

// How many turns may accrue between "this handoff was generated" and "the roll actually fires"
// before it's considered stale. Tunable, not architecture — same spirit as every other threshold
// this branch has introduced (SKILL_CLUSTER_THRESHOLD, SKILL_DECAY_WINDOW, ...). A quarter of the
// default tail-carry window (200) is the starting guess: enough slack that the common case (wrap
// fires shortly after crossing 60%) always hits the fresh path, but not so much that a handoff
// generated from a much earlier conversation state gets used unnoticed.
export const HANDOFF_STALE_AFTER_TURNS = 50;

/**
 * buildHandoffPrompt({ rows, decisions, facts, sourceRef }) → prompt string
 *
 * `rows` — the transcript excerpt to summarize (typically the head about to be archived, same
 * input shape as conversationRoll.splitForRoll's `head`). `decisions`/`facts` — already-recorded
 * rows from lib/knowledgeStore.mjs (title/rationale, text respectively) folded in as STRUCTURED
 * context the model doesn't have to re-derive from prose. `sourceRef` — the archive segment this
 * conversation will be recallable from after the roll (conversationRoll.segmentRef's shape).
 */
export function buildHandoffPrompt(opts) {
  const { rows, decisions, facts, sourceRef } = opts && typeof opts === "object" ? opts : {};
  const transcript = renderRows(rows);

  const decisionLines = (Array.isArray(decisions) ? decisions : [])
    .map((d) => d && typeof d.title === "string" && d.title.trim()
      ? `- ${d.title.trim()}${d.rationale ? ` — ${d.rationale}` : ""}`
      : null)
    .filter(Boolean);
  const decisionsBlock = decisionLines.length ? decisionLines.join("\n") : "(none recorded)";

  const factLines = (Array.isArray(facts) ? facts : [])
    .map((f) => f && typeof f.text === "string" && f.text.trim() ? `- ${f.text.trim()}` : null)
    .filter(Boolean);
  const factsBlock = factLines.length ? factLines.join("\n") : "(none recorded)";

  const refText = typeof sourceRef === "string" && sourceRef.trim() ? sourceRef.trim() : "(unknown)";

  return [
    "You are writing a HANDOFF for the next agent picking up this conversation after it rolls",
    "into a fresh window. Write what was DECIDED and what matters NOW — never a retelling of",
    "what was asked. Be concise; this is a briefing, not a transcript.",
    "",
    "Produce exactly these four sections, as markdown headings:",
    "## Decisions Made",
    "## Current State",
    "## Open Threads",
    "## Where to Recall From",
    "",
    "Already-recorded decisions (do not just repeat these verbatim — synthesize, and add any",
    "that were made in conversation but never formally recorded):",
    decisionsBlock,
    "",
    "Already-recorded facts/conventions relevant to this conversation:",
    factsBlock,
    "",
    "The conversation excerpt to summarize:",
    "---",
    transcript,
    "---",
    "",
    `For "Where to Recall From", point at \`${refText}\` for the full archived history.`,
  ].join("\n");
}

/**
 * isHandoffFresh(cached, currentTurns, { staleAfterTurns } = {}) → boolean
 *
 * `cached` must be a `{ text, generatedAtTurn }` shape (as `generateHandoff` produces) — anything
 * else (null, missing `generatedAtTurn`, empty `text`) is NOT fresh. Fresh means the conversation
 * has advanced no more than `staleAfterTurns` turns since generation.
 */
export function isHandoffFresh(cached, currentTurns, opts) {
  if (!cached || typeof cached.text !== "string" || !cached.text.trim()) return false;
  if (!Number.isFinite(cached.generatedAtTurn)) return false;
  if (!Number.isFinite(currentTurns)) return false;
  const o = opts && typeof opts === "object" ? opts : {};
  const staleAfter = Number.isFinite(o.staleAfterTurns) ? o.staleAfterTurns : HANDOFF_STALE_AFTER_TURNS;
  const elapsed = currentTurns - cached.generatedAtTurn;
  return elapsed >= 0 && elapsed <= staleAfter;
}

/**
 * resolveHandoff({ cached, currentTurns, mechanicalSummary, staleAfterTurns }) → { text, source }
 * `source` is `'cached'` or `'mechanical'` — always ONE of exactly two values, so a caller never
 * has to guess which path was taken (useful for logging/telemetry once this is wired up in 2.5b).
 * The three branches named in plan.md 2.5 all resolve to `'mechanical'` here except the fresh
 * case: no cache yet, a stale cache, and a cache that fails `isHandoffFresh` for any other reason
 * are indistinguishable to the ROLL — they all mean "use the thing that never stalls."
 */
export function resolveHandoff(opts) {
  const { cached, currentTurns, mechanicalSummary, staleAfterTurns } = opts && typeof opts === "object" ? opts : {};
  if (isHandoffFresh(cached, currentTurns, { staleAfterTurns })) {
    return { text: cached.text, source: "cached" };
  }
  const fallback = typeof mechanicalSummary === "string" ? mechanicalSummary : "";
  return { text: fallback, source: "mechanical" };
}

/**
 * generateHandoff({ rows, decisions, facts, sourceRef, currentTurns, generate }) → Promise<{
 * text, generatedAtTurn, generatedAt } | null>
 *
 * Builds the prompt, calls the INJECTED `generate(prompt) -> Promise<string>` (the caller's job
 * to point at an actual cheap model — this module has no SDK dependency), and shapes a successful
 * non-empty result into a cache entry stamped with `currentTurns` (what `isHandoffFresh` compares
 * against later) and a wall-clock timestamp. Returns null — never throws — if `generate` throws,
 * rejects, or returns an empty/non-string result: a failed generation must leave the cache slot
 * exactly as if generation had never been attempted, so `resolveHandoff` falls back to the
 * mechanical summary rather than caching garbage. This is what "generate ahead of the roll, off
 * its critical path" means in practice — the caller awaits this whenever is convenient (at the
 * 60% mark, in 2.5b), and the roll itself never touches `generate` at all.
 */
export async function generateHandoff(opts = {}) {
  try {
    const { rows, decisions, facts, sourceRef, currentTurns, generate } = opts;
    if (typeof generate !== "function") return null;
    if (!Number.isFinite(currentTurns)) return null; // nothing for isHandoffFresh to compare against later
    const prompt = buildHandoffPrompt({ rows, decisions, facts, sourceRef });
    const result = await generate(prompt);
    const text = typeof result === "string" ? result.trim() : "";
    if (!text) return null;
    return {
      text,
      generatedAtTurn: currentTurns,
      generatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}
