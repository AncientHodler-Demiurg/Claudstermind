// conversationRoll.mjs — PURE decision + seed-assembly logic for auto-rolling a long
// conversation into a fresh, bounded segment.
//
// Per docs/AGENTIC-CHAT-ENGINE.md §1 + "Locked decisions" (2026-09-05):
//   • roll when the ACTIVE segment reaches 400 turns OR 25 MB (whichever first),
//   • carry the last 40 turns VERBATIM into the new segment; older turns are summarized.
//
// This module owns ONLY the pure parts: the roll decision, the head/tail split, the
// seed-text assembly, and stable segment ids. The integrator does the impure work
// (creating the new SDK session, GENERATING the summary of `head`, archiving `head`).
//
// No imports. All functions guard against bad input and never throw on malformed rows.

// MEASURED, not guessed (2026-09-06). Taken from the real 8,287-turn workspace transcript at
// `.claude/workspace/OuroborosNetwork…@main`: 4.53 MB of prose, **546 chars ≈ 137 tokens per turn**.
//
// The seed this file builds is ALREADY prose-only — buildSeedText renders tool rows as `[tool: name]`
// and images as `[image]`, and `s.transcript` only ever receives user/assistant turns. So a carried
// turn is cheap, and `tailTurns: 40` (≈5,500 tokens) was far more conservative than anyone realised:
// it was chosen when nobody had measured the per-turn cost.
//
//   40 turns  ≈   5,500 tok    (the old default)
//  200 turns  ≈  27,300 tok    ~2.7% of a 1M window, ~14% of a 200k one
//
// Raising the tail is the cheapest continuity win available: five times the carried context for a
// rounding error on a modern window. Raised to 200.
//
// `maxTurns` 400 → 1000: a turn is one ROW (a prompt OR an answer), so 400 turns was only ~200
// exchanges — low enough that it fired before the context window was anywhere near full and rolled
// conversations that still had plenty of room.
//
// `maxBytes` stays at 25 MiB. It is measured against `JSON.stringify(transcript)` — prose only, since
// images live on disk as paths — so at ~137 tok/turn it is roughly 6x further away than a 1M context
// window and effectively never binds. It remains only as a runaway guard.
export const ROLL_DEFAULTS = Object.freeze({
  maxTurns: 1000,
  maxBytes: 25 * 1024 * 1024, // 25 MiB (= 26.2 MB decimal)
  tailTurns: 200,
});

// A "turn" is a user or assistant row. Everything else (tool_use, tool_result, init,
// result, …) is a non-turn row that may be interleaved inside the carried span.
// Rows may key their role as `role` (persisted transcript) or `kind` (live events), so
// accept either.
function rowRole(row) {
  if (!row || typeof row !== "object") return null;
  if (row.role === "user" || row.role === "assistant") return row.role;
  if (row.kind === "user" || row.kind === "assistant") return row.kind;
  return null;
}

function isTurn(row) {
  return rowRole(row) !== null;
}

/**
 * conversationStats(arr) → { turns, prompts, responses, bytes }
 *   turns     = count of user+assistant rows
 *   prompts   = count of user rows
 *   responses = count of assistant rows
 *   bytes     = UTF-8 byte length of JSON.stringify(arr)
 */
export function conversationStats(arr) {
  const rows = Array.isArray(arr) ? arr : [];
  let prompts = 0;
  let responses = 0;
  for (const row of rows) {
    const role = rowRole(row);
    if (role === "user") prompts++;
    else if (role === "assistant") responses++;
  }
  let bytes = 0;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(rows)).length;
  } catch {
    bytes = 0;
  }
  return { turns: prompts + responses, prompts, responses, bytes };
}

/**
 * shouldRoll(stats, opts = ROLL_DEFAULTS) → boolean
 *   true when turns >= maxTurns OR bytes >= maxBytes.
 */
export function shouldRoll(stats, opts = ROLL_DEFAULTS) {
  const s = stats && typeof stats === "object" ? stats : {};
  const o = opts && typeof opts === "object" ? opts : {};
  const maxTurns = Number.isFinite(o.maxTurns) ? o.maxTurns : ROLL_DEFAULTS.maxTurns;
  const maxBytes = Number.isFinite(o.maxBytes) ? o.maxBytes : ROLL_DEFAULTS.maxBytes;
  const turns = Number.isFinite(s.turns) ? s.turns : 0;
  const bytes = Number.isFinite(s.bytes) ? s.bytes : 0;
  return turns >= maxTurns || bytes >= maxBytes;
}

/**
 * splitForRoll(arr, tailTurns = 40) → { head, tail }
 *   tail = the last `tailTurns` user/assistant turns carried VERBATIM, plus any tool
 *          (non-turn) rows interleaved WITHIN that span (i.e. everything from the first
 *          carried turn to the end). Leading tool rows before the first carried turn
 *          stay in head.
 *   head = everything before the tail (to be summarized by the integrator).
 * Short-array guard: when there are <= tailTurns turns, the whole array is the tail and
 * head is empty.
 */
export function splitForRoll(arr, tailTurns = ROLL_DEFAULTS.tailTurns) {
  const rows = Array.isArray(arr) ? arr : [];
  const k = Number.isFinite(tailTurns) && tailTurns > 0 ? Math.floor(tailTurns) : ROLL_DEFAULTS.tailTurns;

  const turnIndexes = [];
  for (let i = 0; i < rows.length; i++) {
    if (isTurn(rows[i])) turnIndexes.push(i);
  }

  // Fewer (or equal) turns than the tail budget → carry everything verbatim.
  if (turnIndexes.length <= k) {
    return { head: [], tail: rows.slice() };
  }

  // The tail starts at the (k-th-from-end) turn; tool rows before it stay in head.
  const startIdx = turnIndexes[turnIndexes.length - k];
  return { head: rows.slice(0, startIdx), tail: rows.slice(startIdx) };
}

// Extract a best-effort tool name from a non-turn row for the [tool: name] placeholder.
function toolName(row) {
  if (!row || typeof row !== "object") return null;
  if (typeof row.name === "string" && row.name) return row.name;
  if (typeof row.tool === "string" && row.tool) return row.tool;
  if (Array.isArray(row.tools) && row.tools[0] && typeof row.tools[0].name === "string") {
    return row.tools[0].name;
  }
  if (typeof row.kind === "string" && row.kind) return row.kind;
  return null;
}

function hasImages(row) {
  return !!(row && Array.isArray(row.images) && row.images.length);
}

// Render a single carried row as a readable line, or null to skip it entirely.
function renderRow(row) {
  const role = rowRole(row);
  if (role === "user" || role === "assistant") {
    const label = role === "user" ? "**You:**" : "**Agent:**";
    const text = typeof row.text === "string" ? row.text : "";
    const parts = [];
    if (text.trim()) parts.push(text.trim());
    if (hasImages(row)) {
      for (let i = 0; i < row.images.length; i++) parts.push("[image]");
    }
    if (!parts.length) return null; // empty turn with nothing to show
    return `${label} ${parts.join(" ")}`;
  }
  // Non-turn (tool) row → placeholder.
  const name = toolName(row);
  return name ? `[tool: ${name}]` : "[tool]";
}

/** Does the tail end on the agent's OWN unanswered question? `roll()` submits the whole seed as if
 *  it were a fresh message from the user (see lib/claudeSession.mjs) — so when the carried-forward
 *  tail's last real turn is the agent asking something, the very next thing the model reads is a
 *  message that reads exactly like a continuation of a dialogue it never got an answer to. Observed
 *  in production, verbatim: "...Does this design look right? Approve it and we move to planning." —
 *  note the reply does NOT end on the "?"; the question is followed by an imperative clause, which is
 *  the realistic shape of "propose, then ask." Requiring the literal last character to be "?" missed
 *  this real case entirely. So the check looks for a "?" anywhere in roughly the closing stretch of
 *  the reply (280 chars — comfortably past a trailing sentence or two), not only the exact last
 *  character. With nothing telling it otherwise, the model resolved its own question — "Confirmed —
 *  the design looks right. Please proceed to planning." — and was about to act on an approval that
 *  was never actually given. Deliberately biased toward an unnecessary reassurance (cheap) over a
 *  missed real one (the expensive failure this exists to close). */
function tailEndsOnAgentQuestion(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (!isTurn(row)) continue;   // skip trailing tool rows to find the last REAL turn
    const role = rowRole(row);
    const text = row && typeof row.text === "string" ? row.text.trim() : "";
    return role === "assistant" && /\?/.test(text.slice(-280));
  }
  return false;
}

/**
 * buildSeedText({ summary, tailRows, sourceRef }) → string
 * Assembles the text that seeds a new segment:
 *   ## Carried-forward summary   (the provided summary of the archived head)
 *   ## Recent turns (verbatim)   (tailRows rendered as **You:** / **Agent:** lines;
 *                                 tool rows and images become placeholders)
 *   a note that this recap is NOT a real message from the user (only when the tail ends on the
 *     agent's own unanswered question — see tailEndsOnAgentQuestion)
 *   footer pointing at sourceRef for the full history.
 * Pure string assembly.
 */
export function buildSeedText({ summary, tailRows, sourceRef } = {}) {
  const summaryText = typeof summary === "string" && summary.trim()
    ? summary.trim()
    : "_(no summary provided)_";
  const rows = Array.isArray(tailRows) ? tailRows : [];

  const rendered = [];
  for (const row of rows) {
    const line = renderRow(row);
    if (line) rendered.push(line);
  }
  const recentBlock = rendered.length ? rendered.join("\n\n") : "_(no recent turns)_";
  // Placed directly after the tail, closest to the question it's about — a footer at the very
  // bottom, after the sourceRef line, reads as an afterthought rather than the FIRST thing the model
  // should weigh before deciding what "continuing" means here.
  const pendingNote = tailEndsOnAgentQuestion(rows)
    ? "\n\nNOTE: this whole seed is an automatic continuity recap, not a new message from your user — " +
      "no one has replied yet. The last turn above is YOUR OWN question, still unanswered. Do not " +
      "assume it was approved and do not act on it; wait for the user's real next message."
    : "";

  const refText = typeof sourceRef === "string" && sourceRef.trim() ? sourceRef.trim() : "(unknown)";

  return [
    "## Carried-forward summary",
    "",
    summaryText,
    "",
    "## Recent turns (verbatim)",
    "",
    recentBlock + pendingNote,
    "",
    "---",
    `Full history archived at \`${refText}\` — use recall to read earlier turns.`,
  ].join("\n");
}

/**
 * segmentRef(conversationId, n) → stable segment id like "<conversationId>#seg<n>".
 */
export function segmentRef(conversationId, n) {
  const id = conversationId == null ? "" : String(conversationId);
  const seq = Number.isFinite(n) ? Math.floor(n) : 0;
  return `${id}#seg${seq}`;
}
