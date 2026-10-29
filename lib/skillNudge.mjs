// skillNudge.mjs — Ch.2.2b/2.2c, the detector lib/skillStore.mjs's own comments deferred: the
// clustering logic that turns N observations (or instincts) of the same repeated work into a
// call to proposeSkill/amendSkill, once the right threshold is crossed — and never more than
// once for the same cluster. Sits one layer above lib/skillStore.mjs, same split as
// lib/retrieval.mjs sitting above lib/knowledgeStore.mjs.
//
// Two orchestrators:
//   - nudgeSkill  — Ch.2.2b, D6's SKILL-candidate gate: cluster >= SKILL_CLUSTER_THRESHOLD (2)
//     observations.
//   - nudgeAgent  — Ch.2.2c, D6's SEPARATE agent-candidate gate: >= AGENT_INSTINCT_MIN_COUNT (3)
//     instincts at >= AGENT_INSTINCT_MIN_AVG_CONFIDENCE (0.75) average confidence.
//
// Both follow the SAME shape, deliberately kept parallel rather than unified into one generic
// function — the two signals (a count vs. a count-AND-average) are different enough that a forced
// abstraction would cost more clarity than it saves, the same judgment call this codebase already
// made for skills vs. facts in Ch.2.4 (two distinct decay mechanisms, not one generic one).
//
// THE SUBAGENT HOOKUP (Hermes's shape: nudge -> background review subagent -> skill create/patch,
// still human-approved): neither orchestrator calls a model directly. Both take an OPTIONAL
// injected async `draft(ctx)` callback -- called ONLY when a propose/amend is actually about to
// happen (never on a below-threshold nudge, so a background subagent is never invoked before the
// pattern is real). This is the exact same decoupling lib/wrapHandoff.mjs's `generateHandoff`
// already uses for "which model, which session" -- testable with a fake draft function here, wired
// to a real one is a live-trigger concern for whoever calls this module (same boundary as Ch.2.3b
// and Ch.2.5b: this slice builds the shape, a later integration pass decides WHEN in a live
// session a nudge actually fires and WHICH subagent drafts). If `opts.content` is already given,
// `draft` is never called at all -- a caller that already has content (e.g. a test, or a caller
// that drafted inline) pays no extra cost.
//
// ESM. Every exported function is async (a draft callback may be) and never throws -- a rejecting
// or empty-returning draft degrades to action: "draft-failed", not a crash.

import {
  SKILL_CLUSTER_THRESHOLD,
  AGENT_INSTINCT_MIN_COUNT,
  AGENT_INSTINCT_MIN_AVG_CONFIDENCE,
  getSkill,
  proposeSkill,
  amendSkill,
  recordObservation,
  countObservations,
  listObservations,
  recordInstinct,
  instinctStats,
  listInstincts,
} from "./skillStore.mjs";

async function resolveContent(opts, draft, ctx) {
  if (typeof opts.content === "string" && opts.content.trim()) return opts.content;
  if (typeof draft !== "function") return null;
  try {
    const drafted = await draft(ctx);
    return typeof drafted === "string" && drafted.trim() ? drafted : null;
  } catch {
    return null;
  }
}

/**
 * nudgeSkill(db, opts, draft) → { action, observation, count, result }
 *
 * opts: { clusterKey, skillId, note, content, amendmentReason, conversationId, turnKind,
 * turnNumber, at } — `clusterKey`/`skillId` identify the repeated-work pattern; `content` is
 * optional (fall back to `draft`).
 * draft: optional async (ctx) => content, where ctx = { clusterKey, skillId, count,
 * observations, action: "propose"|"amend" }. Called only when actually proposing or amending.
 *
 * action is one of:
 *   "below-threshold" — observation recorded, cluster hasn't crossed SKILL_CLUSTER_THRESHOLD yet.
 *   "proposed"         — threshold just crossed, no skill existed yet, proposeSkill succeeded.
 *   "amended"           — a skill for this skillId already exists (this cluster was already
 *                          proposed before), amendSkill succeeded instead of re-proposing.
 *   "no-content"        — a propose/amend was due but no content was available (no `opts.content`
 *                          and no `draft`, or draft returned nothing).
 *   "failed"             — propose/amend was attempted but the underlying store call returned null
 *                          (e.g. invalid provenance, bad kind) despite content being available.
 *   "invalid"             — bad input (missing db/clusterKey/skillId, or recordObservation itself
 *                          rejected the call, e.g. invalid provenance) — nothing was recorded.
 *
 * Never proposes the same skillId twice: once a skill exists for it, every later nudge of the
 * same cluster takes the amend branch, never the propose branch.
 */
export async function nudgeSkill(db, opts = {}, draft) {
  const o = opts && typeof opts === "object" ? opts : {};
  const clusterKey = typeof o.clusterKey === "string" ? o.clusterKey.trim() : "";
  const skillId = typeof o.skillId === "string" ? o.skillId.trim() : "";
  if (!db || !clusterKey || !skillId) {
    return { action: "invalid", observation: null, count: 0, result: null };
  }

  const observation = recordObservation(db, {
    clusterKey,
    skillId,
    note: o.note,
    conversationId: o.conversationId,
    turnKind: o.turnKind,
    turnNumber: o.turnNumber,
    at: o.at,
  });
  if (!observation) {
    return { action: "invalid", observation: null, count: countObservations(db, clusterKey), result: null };
  }

  const existing = getSkill(db, skillId);
  const count = countObservations(db, clusterKey);

  if (existing) {
    const content = await resolveContent(o, draft, {
      clusterKey, skillId, count, observations: listObservations(db, clusterKey), action: "amend",
    });
    if (!content) return { action: "no-content", observation, count, result: null };
    const result = amendSkill(db, skillId, { content, amendmentReason: o.amendmentReason });
    return { action: result ? "amended" : "failed", observation, count, result };
  }

  if (count < SKILL_CLUSTER_THRESHOLD) {
    return { action: "below-threshold", observation, count, result: null };
  }

  const content = await resolveContent(o, draft, {
    clusterKey, skillId, count, observations: listObservations(db, clusterKey), action: "propose",
  });
  if (!content) return { action: "no-content", observation, count, result: null };
  const result = proposeSkill(db, {
    skillId,
    content,
    observationCount: count,
    amendmentReason: o.amendmentReason,
    conversationId: o.conversationId,
    turnKind: o.turnKind,
    turnNumber: o.turnNumber,
    at: o.at,
  });
  return { action: result ? "proposed" : "failed", observation, count, result };
}

/**
 * nudgeAgent(db, opts, draft) → { action, instinct, count, avgConfidence, result }
 *
 * Same shape as nudgeSkill, but gated on D6's agent-candidate threshold instead: count >=
 * AGENT_INSTINCT_MIN_COUNT AND avgConfidence >= AGENT_INSTINCT_MIN_AVG_CONFIDENCE, both required.
 * `proposeSkill`/`amendSkill` are called with `kind: "agent"` so agent candidates live in the
 * same `skills` table (and share its approve/reject/version/decay machinery) without being
 * confused for a skill candidate — `listSkills(db, { kind: "agent" })` is how a caller tells them
 * apart.
 *
 * opts: { clusterKey, agentId, note, confidence, content, amendmentReason, conversationId,
 * turnKind, turnNumber, at }. `confidence` is THIS instinct's own confidence (0..1) — the
 * threshold checks the cluster's AVERAGE across all recorded instincts, not this one alone.
 *
 * action is one of: "below-threshold" | "proposed" | "amended" | "no-content" | "failed" |
 * "invalid" — same meanings as nudgeSkill, substituting the instinct count+average gate.
 */
export async function nudgeAgent(db, opts = {}, draft) {
  const o = opts && typeof opts === "object" ? opts : {};
  const clusterKey = typeof o.clusterKey === "string" ? o.clusterKey.trim() : "";
  const agentId = typeof o.agentId === "string" ? o.agentId.trim() : "";
  if (!db || !clusterKey || !agentId) {
    return { action: "invalid", instinct: null, count: 0, avgConfidence: null, result: null };
  }

  const instinct = recordInstinct(db, {
    clusterKey,
    agentId,
    confidence: o.confidence,
    note: o.note,
    conversationId: o.conversationId,
    turnKind: o.turnKind,
    turnNumber: o.turnNumber,
    at: o.at,
  });
  if (!instinct) {
    const stats = instinctStats(db, clusterKey);
    return { action: "invalid", instinct: null, count: stats.count, avgConfidence: stats.avgConfidence, result: null };
  }

  const existing = getSkill(db, agentId);
  const { count, avgConfidence } = instinctStats(db, clusterKey);

  if (existing) {
    const content = await resolveContent(o, draft, {
      clusterKey, agentId, count, avgConfidence, instincts: listInstincts(db, clusterKey), action: "amend",
    });
    if (!content) return { action: "no-content", instinct, count, avgConfidence, result: null };
    const result = amendSkill(db, agentId, { content, amendmentReason: o.amendmentReason });
    return { action: result ? "amended" : "failed", instinct, count, avgConfidence, result };
  }

  const crossed = count >= AGENT_INSTINCT_MIN_COUNT && avgConfidence != null && avgConfidence >= AGENT_INSTINCT_MIN_AVG_CONFIDENCE;
  if (!crossed) {
    return { action: "below-threshold", instinct, count, avgConfidence, result: null };
  }

  const content = await resolveContent(o, draft, {
    clusterKey, agentId, count, avgConfidence, instincts: listInstincts(db, clusterKey), action: "propose",
  });
  if (!content) return { action: "no-content", instinct, count, avgConfidence, result: null };
  const result = proposeSkill(db, {
    skillId: agentId,
    kind: "agent",
    content,
    observationCount: count, // proposeSkill's own gate (>=2) is weaker than and already satisfied by `crossed` above
    amendmentReason: o.amendmentReason,
    conversationId: o.conversationId,
    turnKind: o.turnKind,
    turnNumber: o.turnNumber,
    at: o.at,
  });
  return { action: result ? "proposed" : "failed", instinct, count, avgConfidence, result };
}
