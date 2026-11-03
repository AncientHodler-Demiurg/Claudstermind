// lib/knowledgeIngest.mjs — THE actual "ingestion engine": distills a workspace's already-archived
// conversation history into the exocortex knowledge store (lib/knowledgeStore.mjs's facts/decisions),
// for real, as a committed and reusable feature — not the one-off, never-committed script a prior
// session used to pilot this on two repos (Mnemosyne/Khronoton, $3.57, 212 items) and then lost.
//
// Reads from lib/conversationFts.mjs's `segment_rows` table (the SAME archived-conversation index
// "Total recall" already builds live, see lib/workspace.mjs's archiveSegment call) rather than
// re-parsing raw JSONL — it already has exactly the shape needed (conversationId, kind, number,
// text, at), one row per archived turn, across every conversation in the workspace.
//
// PROVENANCE IS REAL, PER-ITEM, NOT A CHUNK-LEVEL GUESS: each chunk sent to the model is a batch of
// rows, each labeled with its own `[kind#number]` tag; the model is asked to cite which single row
// each extracted fact/decision came from, and that citation resolves back to the REAL row's own
// conversationId/turnKind/turnNumber/at — the exact shape lib/provenance.mjs's normalizeProvenance
// requires. A citation that doesn't match anything in the chunk (a hallucinated tag, or none given)
// falls back to the chunk's own last row rather than being rejected outright — SOME provenance,
// even if coarse, serves addFact/addDecision's "never store without provenance" contract better
// than silently dropping an otherwise-good extraction.
//
// Pure functions (chunkRows, ingestPrompt, parseIngestReply, toStoreOps) are the whole extraction
// LOGIC, unit-testable with zero I/O. The actual SDK call + DB writes are the thin imperative
// wrapper (runKnowledgeIngest), same split lib/distill.mjs's runClaudeDistill already uses.
import { openDb as openFtsDb } from "./conversationFts.mjs";
import { openDb as openKnowledgeDb, addFact, addDecision } from "./knowledgeStore.mjs";
import { syncArchiveIntoFts } from "./conversationArchive.mjs";

export const INGEST_CHUNK_ROWS = 200;   // matches the earlier pilot's own chunk size

/** Split rows (already in id/archive order) into chunks of `size`. Pure. */
export function chunkRows(rows, size = INGEST_CHUNK_ROWS) {
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Every archived row for a workspace, oldest first (ascending id = archive order — the same order
 *  the conversations actually happened in). Never throws; a missing/corrupt FTS db is just [].
 *
 *  Syncs the FTS mirror from the real archived segments on disk FIRST (see syncArchiveIntoFts's own
 *  doc comment in conversationArchive.mjs) — without this, a workspace whose segments were archived
 *  but never SEARCHED even once would read back zero rows here despite genuinely having archived
 *  history, which is exactly what happened on the first real run of this against `Mnemosyne@main`. */
export function readWorkspaceRows(workspaceDir) {
  const db = openFtsDb(workspaceDir);
  if (!db) return [];
  try {
    syncArchiveIntoFts(db, workspaceDir);
    const rows = db.prepare("SELECT conversationId, kind, number, text, at FROM segment_rows ORDER BY id ASC").all();
    return rows;
  } catch { return []; }
  finally { try { db.close(); } catch { /* best effort */ } }
}

/** The extraction prompt for ONE chunk. Pure. Each row carries its own citable [kind#number] tag so
 *  the model's answer can point back to a REAL row, not just assert "somewhere in here". */
export function ingestPrompt(repo, chunk) {
  const body = chunk.map((r) => `[${r.kind}#${r.number}] ${String(r.text || "").slice(0, 2000)}`).join("\n\n");
  return `You are extracting durable, reusable knowledge for the repository "${repo}" from a slice of its real raw conversation history below (each line tagged [kind#number] for citation). Extract ONLY lasting knowledge — architecture facts, conventions, gotchas, and decisions with their rationale. Omit chit-chat, one-off task status, and anything not likely to still matter later.

For EVERY fact or decision, cite the SINGLE [kind#number] tag it is most directly drawn from — never invent a tag that isn't in the text below.

Respond with STRICT JSON ONLY — no markdown fences, no commentary before or after — exactly this shape (omit "facts" or "decisions" entirely if there is nothing to report in that category; never invent content to fill it):
{"facts":[{"text":"...","kind":"fact","confidence":0.8,"sourceKind":"response","sourceNumber":12}],"decisions":[{"title":"...","rationale":"...","sourceKind":"response","sourceNumber":40}]}

--- conversation history slice ---
${body}`;
}

/** Parse the model's reply into `{ facts, decisions }`, each entry validated for the minimum shape
 *  needed to proceed (non-empty text/title). Never throws — a malformed reply (bad JSON, markdown
 *  fences the model added anyway, a missing field) degrades to empty arrays rather than crashing a
 *  long batch run over dozens of chunks. Pure. */
export function parseIngestReply(text) {
  try {
    const cleaned = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const j = JSON.parse(cleaned);
    const facts = Array.isArray(j.facts)
      ? j.facts.filter((f) => f && typeof f.text === "string" && f.text.trim())
      : [];
    const decisions = Array.isArray(j.decisions)
      ? j.decisions.filter((d) => d && typeof d.title === "string" && d.title.trim())
      : [];
    return { facts, decisions };
  } catch {
    return { facts: [], decisions: [] };
  }
}

/** Resolve a `{sourceKind, sourceNumber}` citation back to the chunk's REAL row (real
 *  conversationId/kind/number/at) — the thing that makes provenance genuine instead of guessed.
 *  A citation matching nothing in THIS chunk (hallucinated, or simply omitted) falls back to the
 *  chunk's own last row: coarse provenance beats none, per addFact/addDecision's own contract that
 *  nothing is ever stored without SOME provenance. Pure. */
function resolveSource(chunk, item) {
  const hit = chunk.find((r) => r.kind === item.sourceKind && r.number === item.sourceNumber);
  return hit || chunk[chunk.length - 1];
}

/** Turn one chunk's parsed reply into ready-to-write addFact/addDecision option objects, each
 *  carrying REAL provenance resolved from the chunk. Pure (no DB access — the caller writes). */
export function toStoreOps(chunk, parsed) {
  const facts = parsed.facts.map((f) => {
    const src = resolveSource(chunk, f);
    return {
      text: f.text.trim(),
      kind: typeof f.kind === "string" && f.kind.trim() ? f.kind.trim() : "fact",
      confidence: Number.isFinite(f.confidence) && f.confidence >= 0 && f.confidence <= 1 ? f.confidence : null,
      conversationId: src.conversationId, turnKind: src.kind, turnNumber: src.number, at: src.at ?? null,
    };
  });
  const decisions = parsed.decisions.map((d) => {
    const src = resolveSource(chunk, d);
    return {
      title: d.title.trim(), rationale: typeof d.rationale === "string" ? d.rationale : "",
      conversationId: src.conversationId, turnKind: src.kind, turnNumber: src.number, at: src.at ?? null,
    };
  });
  return { facts, decisions };
}

/** The real ingestion run for ONE workspace: read its archived rows, chunk them, call Claude once
 *  per chunk (summary-only, no tools — same posture as distill.mjs's runClaudeDistill), parse +
 *  write each chunk's extraction, track real cost from the SDK's own `total_cost_usd`. Returns a
 *  full accounting — rows read, chunks run, facts/decisions written, total cost — so a caller can
 *  report exactly what happened (and what it cost) rather than a bare "done".
 *
 *  `sdkQuery` injectable for tests; `cleanEnv` strips host secrets before spawning, same as every
 *  other live SDK caller in this codebase. `onChunk(i, total, result)` is an optional progress
 *  callback — a long run (dozens of chunks, real money per call) must be able to show live progress,
 *  not go silent until the very end. */
export async function runKnowledgeIngest({ workspaceDir, repo, root, token, sdkQuery, cleanEnv, onChunk }) {
  const rows = readWorkspaceRows(workspaceDir);
  const chunks = chunkRows(rows);
  const runQuery = sdkQuery || (await import("@anthropic-ai/claude-agent-sdk")).query;
  const baseEnv = cleanEnv ? cleanEnv(process.env) : { ...process.env };
  const kdb = openKnowledgeDb(workspaceDir);
  let totalCost = 0, factsWritten = 0, decisionsWritten = 0;
  const chunkResults = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const prompt = ingestPrompt(repo, chunk);
    let text = "", cost = 0, usage = null, err = null;
    try {
      const q = runQuery({
        prompt: (async function* () { yield { type: "user", message: { role: "user", content: prompt } }; })(),
        options: {
          cwd: root,
          canUseTool: async () => ({ behavior: "deny", message: "knowledge ingestion is extraction-only — no tools" }),
          includePartialMessages: false,
          env: token ? { ...baseEnv, CLAUDE_CODE_OAUTH_TOKEN: token } : baseEnv,
        },
      });
      for await (const msg of q) {
        if (msg.type === "assistant") text += (msg.message?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
        if (msg.type === "result") { usage = msg.usage || null; cost = msg.total_cost_usd || 0; }
      }
    } catch (e) { err = String(e && e.message || e); }
    let written = { facts: 0, decisions: 0 };
    if (!err && kdb) {
      const parsed = parseIngestReply(text);
      const ops = toStoreOps(chunk, parsed);
      for (const f of ops.facts) { if (addFact(kdb, f)) { factsWritten++; written.facts++; } }
      for (const d of ops.decisions) { if (addDecision(kdb, d)) { decisionsWritten++; written.decisions++; } }
    }
    totalCost += cost;
    const result = { chunk: i + 1, rows: chunk.length, cost, usage, error: err, written };
    chunkResults.push(result);
    if (typeof onChunk === "function") { try { onChunk(i + 1, chunks.length, result); } catch { /* a progress callback must never break the run */ } }
  }
  try { kdb?.close?.(); } catch { /* best effort */ }
  return { repo, rowsRead: rows.length, chunksRun: chunks.length, factsWritten, decisionsWritten, totalCost, chunks: chunkResults };
}
