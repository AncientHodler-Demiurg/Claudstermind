// priorArt.mjs — Ch.2.3b, wiring Ch.2.0 (conversation recall) + Ch.2.3a (knowledge retrieval)
// into a real live trigger: the "you already solved this" prior-art check named in
// docs/EXOCORTEX-VISION.md's north star (§6.2) and docs/EXOCORTEX-LEARNINGS.md.
//
// FIRES AT TASK START: a brand-new session's first prompt (see lib/workspace.mjs's `_prompt`,
// the `!s` branch) — not every turn. This answers 2.3b's three deliberately-deferred questions:
//   - "fire automatically at task start" → here, at new-session creation.
//   - "where does the knowledge store's baseDir live for a real install" → Ch.1.1's
//     `workspaceDir(transcriptDir, workspaceId)`, now that it exists — the SAME directory
//     conversationFts/knowledgeStore/skillStore already use (see three-zone-model.md).
//   - "where does stackKeywords come from live" → still nowhere; no live project-stack detector
//     exists (2.3a's own deferral, carried forward rather than guessed at here). `stackKeywords`
//     is simply omitted — the project-scope boost in `retrieveForContext` still applies, only the
//     stack-match boost never fires. A real detector is a further, still-separate task.
//
// DELIBERATELY SURFACES, DOES NOT INJECT: this emits a visible event for a human to see (same
// "propose, don't auto-adopt" spirit as D6/Ch.2.2/Ch.2.5) rather than silently rewriting the text
// the model receives — the decision whether to act on prior art stays with the user. Rendering
// the event in the UI is a `dashboard/public/app.js` concern, not built here (same boundary
// Ch.2.5b draws between generating a handoff and showing it).
//
// ESM. Never throws — any failure (missing dir, corrupt db, bad input) degrades to `null`, same
// convention as every other store/retrieval function in this codebase.

import { workspaceDir } from "./storage.mjs";
import { recallByQuery } from "./conversationArchive.mjs";
import { openDb as openKnowledgeDb } from "./knowledgeStore.mjs";
import { retrieveForContext } from "./retrieval.mjs";

export const PRIOR_ART_RECALL_LIMIT = 3;

/**
 * buildPriorArtContext({ transcriptDir, workspaceId, query }) → { text, hits, knowledgeCount } | null
 *
 * `query` is the user's own first prompt text in the new session — searched verbatim, no
 * preprocessing, against:
 *   - conversational recall (Ch.2.0's FTS5 index) over the WHOLE workspace's archive — NOT
 *     scoped to one conversationId, since a fact learned in a sibling conversation in the same
 *     repo still counts as prior art for a brand-new one.
 *   - durable knowledge (Ch.2.1's facts/decisions), ranked and budgeted via Ch.2.3a's
 *     `retrieveForContext`, also unscoped to one conversationId for the same reason.
 *
 * Returns `null` — never an empty-string `text` — when there is genuinely nothing to show, so a
 * caller never emits a vacuous "prior art" event for a brand-new repo/workspace with nothing
 * archived yet.
 */
export function buildPriorArtContext(opts = {}) {
  try {
    const { transcriptDir, workspaceId, query } = opts && typeof opts === "object" ? opts : {};
    const q = typeof query === "string" ? query.trim() : "";
    if (!transcriptDir || !workspaceId || !q) return null;
    const baseDir = workspaceDir(transcriptDir, workspaceId);

    const hits = recallByQuery(baseDir, { query: q, limit: PRIOR_ART_RECALL_LIMIT });

    let knowledgeText = "";
    let knowledgeCount = 0;
    const kdb = openKnowledgeDb(baseDir);
    if (kdb) {
      try {
        const ctx = retrieveForContext(kdb, {});
        knowledgeText = ctx.text;
        knowledgeCount = ctx.count;
      } finally {
        kdb.close();
      }
    }

    if (hits.length === 0 && knowledgeCount === 0) return null;

    const parts = [];
    if (hits.length) {
      parts.push(
        "Related past turns in this workspace:\n" +
        hits.map((h) => `  - ${h.kind === "prompt" ? "you asked" : "it answered"} (#${h.number}): ${h.snippet}`).join("\n")
      );
    }
    if (knowledgeText) parts.push(knowledgeText);

    return { text: parts.join("\n\n"), hits, knowledgeCount };
  } catch {
    return null;
  }
}
