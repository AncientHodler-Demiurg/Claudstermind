// provenance.mjs — the one shared definition of "where did this brain entry come from," used by
// every store that stamps provenance on a write (lib/knowledgeStore.mjs's facts/decisions,
// lib/skillStore.mjs's skill proposals). Extracted rather than duplicated because this is a
// CORRECTNESS CONTRACT, not merely similar-looking code: every store must reject the same shapes
// of missing/malformed provenance identically, or "no entry can be created without provenance"
// stops being true uniformly across the brain.
//
// conversationId + turnKind + turnNumber are MANDATORY. `at` (epoch ms, the source turn's own
// timestamp) is OPTIONAL — see docs/work/exocortex/plan.md 2.1 for why: real data always has it
// today, but nothing here should assume that forever.

/**
 * normalizeProvenance(input) → { conversationId, turnKind, turnNumber, at } | null
 * Returns null if `conversationId` is missing/blank, `turnKind` isn't "prompt"|"response", or
 * `turnNumber` isn't a finite integer >= 1. Never throws.
 */
export function normalizeProvenance(input) {
  const p = input && typeof input === "object" ? input : {};
  const conversationId = typeof p.conversationId === "string" ? p.conversationId.trim() : "";
  const turnKind = p.turnKind === "prompt" || p.turnKind === "response" ? p.turnKind : null;
  const turnNumber = Number.isFinite(p.turnNumber) ? Math.floor(p.turnNumber) : NaN;
  if (!conversationId || !turnKind || !(turnNumber >= 1)) return null;
  const at = Number.isFinite(p.at) ? Math.floor(p.at) : null;
  return { conversationId, turnKind, turnNumber, at };
}

/**
 * provenanceOf(row) → { conversationId, turnKind, turnNumber, at } | null
 * The read-side mirror of normalizeProvenance: extracts provenance back out of a persisted row
 * (a fact, decision, or skill proposal — anything shaped by normalizeProvenance at write time),
 * returning null if the row doesn't actually carry valid provenance (defensive — a row is only
 * ever missing this if something bypassed the write-side validation).
 */
export function provenanceOf(row) {
  if (!row || typeof row !== "object") return null;
  if (typeof row.conversationId !== "string" || !row.conversationId) return null;
  if (row.turnKind !== "prompt" && row.turnKind !== "response") return null;
  if (!Number.isFinite(row.turnNumber)) return null;
  return {
    conversationId: row.conversationId,
    turnKind: row.turnKind,
    turnNumber: row.turnNumber,
    at: Number.isFinite(row.at) ? row.at : null,
  };
}
