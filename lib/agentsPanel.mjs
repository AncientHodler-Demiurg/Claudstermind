// agentsPanel — pure VIEW-MODEL shaping for the background-agents fleet panel (ROADMAP 2.4 / T3.2).
//
// WHY THIS EXISTS. The complaint this closes is: "you told me work was happening in background
// agents and I had no way to tell whether anything was actually running or whether it had silently
// died." So the design rule here is HONESTY OVER TIDINESS:
//   - a missing start time renders "unknown", NEVER a plausible-looking "0s";
//   - a negative or absurd elapsed (clock skew between server and browser) renders "unknown" and
//     sets `clockSkew`, NEVER a clamped-to-zero number that looks like real data;
//   - "possibly stalled" is derived, labelled a HEURISTIC on every row and on the panel, and is
//     never presented as "this agent is dead";
//   - counts are recomputed from the rows, and any disagreement with the server's own totals is
//     surfaced as `mismatch` rather than silently preferring one of them.
//
// WHERE THE INPUT COMES FROM (docs/work/agentic-chat-engine/CONTRACT.md §2):
//   - `event.panel`                  on `background` / `taskStarted` / `taskDone`
//   - `sessionSummary.backgroundPanel` on a `state` frame (null on a stub engine = NO DATA)
//   - `sessionSummary.background` / `event.tasks` — the raw ARRAY fallback (no status field)
// All four are accepted by `shapeAgentsPanel`, so a caller never has to unwrap by hand.
//
// COMPOSITION: the server runs `shapeBackground()` from lib/backgroundTasks.mjs and puts the result
// on the wire; this module consumes exactly that shape and adds the things only a client can know
// (its own clock, what it saw last tick). It deliberately does NOT import backgroundTasks.mjs —
// this file must stay inlineable into the browser bundle, same as backgroundTasks.mjs itself.
//
// PURE: no imports, no Date, no Math.random, no DOM, no timers. Callers pass `now`.

/** How long a running agent may go with no observed change before the panel says "possibly stalled".
 *  Five minutes: background subagents legitimately work silently for minutes (see CONTRACT.md §6 on
 *  deep work), and per-agent `tokens` only moves when the SDK reports it — usually once, at settle —
 *  so anything shorter would flag every healthy long-running agent. This is a UI hint only. */
export const AGENT_STALE_AFTER_MS = 5 * 60 * 1000;

/** Any elapsed beyond this is treated as clock skew / a bad timestamp rather than a real duration. */
export const AGENT_MAX_ELAPSED_MS = 7 * 24 * 60 * 60 * 1000;

/** Fixed wording so every surface says the same thing and nobody re-phrases it as a fact. */
export const AGENT_STALE_NOTE =
  "Heuristic: no change seen for over 5 minutes. The agent may simply be working quietly — this is a guess, not a status report.";

/** The normalized states a row can be in. Exported so a renderer can exhaustively switch on them
 *  and still survive a NEW server status (which maps to "unknown", never silently to "running"). */
export const AGENT_STATES = ["running", "done", "error", "unknown"];

const isObj = (v) => v !== null && typeof v === "object";
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const str = (v) => (typeof v === "string" ? v : "");

/** Normalize an arbitrary status string into one of AGENT_STATES, forward-compatibly: an unknown
 *  status is NOT coerced into "running" (that would invent liveness) — it becomes "unknown" and the
 *  raw value is preserved on the row so a future server status renders as itself. */
export function agentState(status) {
  const s = str(status).toLowerCase();
  if (s === "running") return "running";
  if (s === "done" || s === "completed" || s === "complete" || s === "success") return "done";
  if (s === "error" || s === "failed" || s === "failure") return "error";
  return "unknown";
}

// Unwrap any of the accepted payload shapes into a plain array of agent-ish records.
// Returns null (NOT []) when there is genuinely no data, so "no data" and "no agents" stay distinct.
function pickAgents(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isObj(payload)) return null;
  if (Array.isArray(payload.agents)) return payload.agents;                 // the panel model itself
  if (isObj(payload.panel) && Array.isArray(payload.panel.agents)) return payload.panel.agents;   // an event
  if (isObj(payload.backgroundPanel) && Array.isArray(payload.backgroundPanel.agents)) return payload.backgroundPanel.agents; // a sessionSummary
  if (Array.isArray(payload.background)) return payload.background;         // sessionSummary fallback
  if (Array.isArray(payload.tasks)) return payload.tasks;                   // event fallback
  return null;
}

// The panel object the totals should be compared against, if the payload carried one.
function pickPanel(payload) {
  if (!isObj(payload) || Array.isArray(payload)) return null;
  if (Array.isArray(payload.agents)) return payload;
  if (isObj(payload.panel)) return payload.panel;
  if (isObj(payload.backgroundPanel)) return payload.backgroundPanel;
  return null;
}

/**
 * Elapsed, honestly. Prefers a real `startedAt` against the caller's clock; falls back to the
 * server's snapshot `elapsedMs`; otherwise UNKNOWN.
 *
 * `elapsedMs === 0` from the wire is treated as UNKNOWN on purpose. `shapeBackground()` emits 0 both
 * for "no startedAt" and for "no now", and an agent whose true age is exactly 0 ms is unobservable
 * in practice (the event has already made a round trip). Showing "unknown" for one tick of a
 * genuinely brand-new agent is a far cheaper mistake than showing a frozen "0s" forever, which is
 * the exact symptom that made the fleet look dead.
 */
function readElapsed(a, now) {
  const startedAt = fin(a.startedAt) ? a.startedAt : null;
  if (startedAt !== null && startedAt > 0 && fin(now) && now > 0) {
    const raw = now - startedAt;
    if (raw < 0) return { elapsedMs: null, elapsedKnown: false, clockSkew: true };
    if (raw > AGENT_MAX_ELAPSED_MS) return { elapsedMs: null, elapsedKnown: false, clockSkew: true };
    return { elapsedMs: raw, elapsedKnown: true, clockSkew: false };
  }
  const snap = a.elapsedMs;
  if (fin(snap)) {
    if (snap < 0 || snap > AGENT_MAX_ELAPSED_MS) return { elapsedMs: null, elapsedKnown: false, clockSkew: true };
    if (snap === 0) return { elapsedMs: null, elapsedKnown: false, clockSkew: false };
    return { elapsedMs: snap, elapsedKnown: true, clockSkew: false };
  }
  return { elapsedMs: null, elapsedKnown: false, clockSkew: false };
}

/** "unknown" | "45s" | "3m 07s" | "2h 05m". Never renders a negative or a bare 0 for unknown input. */
export function agentElapsedLabel(ms) {
  if (!fin(ms) || ms < 0) return "unknown";
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return `${m}m ${String(s).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

// Identity of "has anything changed about this agent since last tick".
// Description is included because an enriching `background` event is real evidence of liveness.
function fingerprint(row) {
  return `${row.state}|${row.status}|${row.tokens}|${row.description}`;
}

/**
 * trackAgentActivity(prev, payload, now) → { seen: { <id>: { lastChangeAt, fingerprint } } }
 *
 * The one piece of state the panel needs and the server cannot supply: WHEN THIS CLIENT LAST SAW
 * THIS AGENT CHANGE. Call it on every background event / state frame, keep the result, and pass it
 * back into `shapeAgentsPanel` as `opts.tracking`.
 *
 * - unchanged fingerprint → `lastChangeAt` is preserved (that is what makes staleness measurable)
 * - changed fingerprint or first sighting → `lastChangeAt = now`
 * - agents absent from the payload are DROPPED (they left the live set)
 * - a non-finite `now`, or a payload with no agent data at all, returns `prev` untouched — a
 *   reconnect blip must not reset every agent's clock and hide a genuinely stalled fleet
 */
export function trackAgentActivity(prev, payload, now) {
  const base = isObj(prev) && isObj(prev.seen) ? prev : { seen: {} };
  const list = pickAgents(payload);
  if (!Array.isArray(list) || !fin(now)) return base;
  const rows = normalizeRows(list, now);
  const seen = {};
  for (const row of rows) {
    const fp = fingerprint(row);
    const old = base.seen[row.id];
    seen[row.id] = isObj(old) && old.fingerprint === fp && fin(old.lastChangeAt)
      ? { lastChangeAt: old.lastChangeAt, fingerprint: fp }
      : { lastChangeAt: now, fingerprint: fp };
  }
  return { seen };
}

// Shared normalization used by both the tracker and the shaper, so a fingerprint is computed over
// exactly the fields the panel renders. Order is PRESERVED (see shapeAgentsPanel docs).
function normalizeRows(list, now) {
  const out = [];
  const ids = new Set();
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!isObj(a)) continue;
    const id = a.id == null || a.id === "" ? `#${i}` : String(a.id);
    if (ids.has(id)) continue; // first sighting wins; a duplicate id must not double-count tokens
    ids.add(id);

    const subagentType = str(a.subagentType) || null;
    const taskType = str(a.taskType) || null;
    // The raw `background` array has no status. It IS the authoritative live set, so "running" is
    // the honest reading — but it is an assumption, and `statusKnown` says so.
    const statusKnown = typeof a.status === "string" && a.status !== "";
    const status = statusKnown ? a.status : "running";
    const label = str(a.label) || subagentType || taskType || "agent";
    const tokens = fin(Number(a.tokens)) && Number(a.tokens) > 0 ? Math.floor(Number(a.tokens)) : 0;
    const description = str(a.description);

    out.push({
      id,
      label,
      type: taskType,
      subagentType,
      description,
      status,
      statusKnown,
      state: agentState(status),
      tokens,
      summary: str(a.summary),
      ...readElapsed(a, now),
    });
  }
  return out;
}

/**
 * shapeAgentsPanel(payload, now, opts?) → view model
 *
 * payload: a panel model, a `background`/`taskStarted`/`taskDone` event, a `sessionSummary`, a bare
 *          agents array, or null/undefined.
 * now:     the client's clock in ms (may be omitted; elapsed then falls back to the server snapshot).
 * opts:    { tracking } from `trackAgentActivity`, { staleAfterMs } to override the heuristic window.
 *
 * Returns:
 * {
 *   hasData, count, running, done, errored, unknown, totalTokens,
 *   staleCount, anyStale, heuristic: true, staleAfterMs, staleNote,
 *   summary, reported, mismatch,
 *   agents: [{ id, label, type, subagentType, description, status, statusKnown, state, tokens,
 *              elapsedMs, elapsedKnown, elapsedLabel, clockSkew,
 *              sinceChangeMs, stale, staleReason, staleNote, title }]
 * }
 *
 * ORDERING is the input's order, verbatim. CONTRACT.md §2a: "Sort order is stable and server-decided:
 * running first, then by start time. Do not re-sort." Preserving it is also what keeps rows from
 * jumping as tokens tick — nothing here orders by a value that changes.
 *
 * `hasData:false` means NO DATA (a null `backgroundPanel`, a stub engine, nothing received yet) and
 * must render differently from `count:0`, which means "there really are no background agents".
 */
export function shapeAgentsPanel(payload, now, opts = {}) {
  const staleAfterMs = fin(opts && opts.staleAfterMs) && opts.staleAfterMs > 0 ? opts.staleAfterMs : AGENT_STALE_AFTER_MS;
  const tracking = isObj(opts) && isObj(opts.tracking) && isObj(opts.tracking.seen) ? opts.tracking.seen : null;
  const list = pickAgents(payload);

  if (!Array.isArray(list)) {
    return {
      hasData: false, count: 0, running: 0, done: 0, errored: 0, unknown: 0, totalTokens: 0,
      staleCount: 0, anyStale: false, heuristic: true, staleAfterMs, staleNote: AGENT_STALE_NOTE,
      summary: "background agents: no data", reported: null, mismatch: false, agents: [],
    };
  }

  const rows = normalizeRows(list, now).map((row) => {
    const track = tracking && isObj(tracking[row.id]) && fin(tracking[row.id].lastChangeAt)
      ? tracking[row.id].lastChangeAt
      : null;

    let sinceChangeMs = null;
    let staleReason = null;
    if (track !== null && fin(now)) {
      const d = now - track;
      if (d >= 0 && d <= AGENT_MAX_ELAPSED_MS) sinceChangeMs = d;
      staleReason = "idle-since-last-change";
    } else if (row.tokens === 0 && row.elapsedKnown) {
      // No tracking history (e.g. straight after a reconnect) and the agent has never reported a
      // single token: its whole lifetime is time we have no evidence about. Weaker signal, so it is
      // labelled differently rather than dressed up as the same thing.
      sinceChangeMs = row.elapsedMs;
      staleReason = "no-activity-observed";
    }

    const stale = row.state === "running" && sinceChangeMs !== null && sinceChangeMs >= staleAfterMs;
    const title = row.description ? `${row.label} — ${row.description}` : row.label;
    return {
      ...row,
      elapsedLabel: agentElapsedLabel(row.elapsedMs),
      sinceChangeMs,
      stale,
      staleReason: stale ? staleReason : null,
      staleNote: stale ? AGENT_STALE_NOTE : null,
      title,
    };
  });

  const count = rows.length;
  const running = rows.filter((r) => r.state === "running").length;
  const done = rows.filter((r) => r.state === "done").length;
  const errored = rows.filter((r) => r.state === "error").length;
  const unknown = rows.filter((r) => r.state === "unknown").length;
  const totalTokens = rows.reduce((s, r) => s + r.tokens, 0);
  const staleCount = rows.filter((r) => r.stale).length;

  const panel = pickPanel(payload);
  const reported = panel && (fin(panel.count) || fin(panel.totalTokens))
    ? {
        count: fin(panel.count) ? panel.count : null,
        running: fin(panel.running) ? panel.running : null,
        done: fin(panel.done) ? panel.done : null,
        totalTokens: fin(panel.totalTokens) ? panel.totalTokens : null,
      }
    : null;
  const mismatch = !!reported && (
    (reported.count !== null && reported.count !== count) ||
    (reported.totalTokens !== null && reported.totalTokens !== totalTokens)
  );

  return {
    hasData: true, count, running, done, errored, unknown, totalTokens,
    staleCount, anyStale: staleCount > 0, heuristic: true, staleAfterMs, staleNote: AGENT_STALE_NOTE,
    summary: agentsPanelSummary({ hasData: true, count, running, done, errored, unknown, staleCount }),
    reported, mismatch, agents: rows,
  };
}

/** One line for a collapsed panel header. Token totals are left out on purpose — the caller formats
 *  those with the existing `k()` helper (lib/backgroundTasks.mjs / lib/contextUsage.mjs). */
export function agentsPanelSummary(vm) {
  if (!isObj(vm) || vm.hasData === false) return "background agents: no data";
  const count = fin(vm.count) ? vm.count : 0;
  if (count === 0) return "no background agents";
  const parts = [`${count} agent${count === 1 ? "" : "s"}`];
  const detail = [];
  if (vm.running) detail.push(`${vm.running} running`);
  if (vm.done) detail.push(`${vm.done} done`);
  if (vm.errored) detail.push(`${vm.errored} error${vm.errored === 1 ? "" : "s"}`);
  if (vm.unknown) detail.push(`${vm.unknown} unknown`);
  if (detail.length) parts.push(detail.join(", "));
  if (vm.staleCount) parts.push(`${vm.staleCount} possibly stalled`);
  return parts.join(" · ");
}
