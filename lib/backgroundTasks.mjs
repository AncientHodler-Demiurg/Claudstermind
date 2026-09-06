// backgroundTasks — pure functions that turn the agent's live background-task events
// (from lib/claudeSession.mjs `toEvent`) into a panel model for the UI:
// "▶ N agents working" + per-agent detail (type/subagent name, description, elapsed, tokens).
//
// PURE: no imports, no Date/Math.random. Callers pass timestamps (`now`) and tokens in.
//
// Real SDK event shapes this reducer keys off (quoted from lib/claudeSession.mjs):
//   background_tasks_changed → { kind:"background", tasks:[{ id, taskType, description }] }   // AUTHORITATIVE full live set
//   task_started             → { kind:"taskStarted", id, taskType, workflowName, description, skipTranscript }
//   task_notification        → { kind:"taskDone", id, status, summary, skipTranscript }
// `subagentType` and `tokens` are NOT emitted by the current toEvent — they are read
// defensively (present-if-present) so a richer event stream enriches the model for free.

const isObj = (v) => v !== null && typeof v === "object";

// keep the first non-undefined, non-empty-string value (so a later event that omits
// a field never drops what an earlier event established)
const keep = (...vals) => {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return vals.length ? vals[vals.length - 1] : undefined;
};

const doneStatus = (raw) => (typeof raw === "string" && /err|fail/i.test(raw) ? "error" : "done");

/**
 * reduceBackground(state, event) → new state
 *   state = { tasks: { <id>: { id, taskType, subagentType, description, workflowName, startedAt, tokens, status } } }
 * - "background"     REPLACES the live set: enrich present ids (preserve prior fields), mark absent ids status:"removed".
 * - "taskStarted"    adds/enriches one → status "running"; startedAt from event timestamp field if present, else null.
 * - "taskDone"       (a.k.a. task_notification) → status "done"/"error"; tokens if the event carries them.
 * Unknown ids on a done event create a minimal entry. Non-object event → state unchanged.
 */
export function reduceBackground(state, event) {
  const base = isObj(state) && isObj(state.tasks) ? state : { tasks: {} };
  if (!isObj(event)) return base;
  const tasks = { ...base.tasks };

  if (event.kind === "background") {
    const live = Array.isArray(event.tasks) ? event.tasks : [];
    const seen = new Set();
    for (const t of live) {
      if (!isObj(t) || t.id == null) continue;
      const id = t.id;
      seen.add(id);
      const prev = tasks[id] || {};
      const priorStatus = prev.status && prev.status !== "removed" ? prev.status : "running";
      tasks[id] = {
        id,
        taskType: keep(t.taskType, prev.taskType, null),
        subagentType: keep(t.subagentType, prev.subagentType, null),
        description: keep(t.description, prev.description, ""),
        workflowName: keep(t.workflowName, prev.workflowName, null),
        // First sighting of a task can come from `background_tasks_changed` rather than `task_started`
        // (the SDK emits the authoritative set on any change), so accept a startedAt riding on the
        // task itself — otherwise those agents render with elapsed 0 forever. A previously-known
        // startedAt always wins, so the clock never restarts on a later REPLACE of the same set.
        startedAt: prev.startedAt ?? t.startedAt ?? null,
        tokens: keep(t.tokens, prev.tokens, 0),
        status: priorStatus,
      };
    }
    // ids not in the authoritative set have vanished → mark removed (kept for history)
    for (const id of Object.keys(tasks)) {
      if (!seen.has(tasks[id].id)) tasks[id] = { ...tasks[id], status: "removed" };
    }
    return { ...base, tasks };
  }

  if (event.kind === "taskStarted") {
    if (event.id == null) return base;
    const prev = tasks[event.id] || {};
    tasks[event.id] = {
      id: event.id,
      taskType: keep(event.taskType, prev.taskType, null),
      subagentType: keep(event.subagentType, prev.subagentType, null),
      description: keep(event.description, prev.description, ""),
      workflowName: keep(event.workflowName, prev.workflowName, null),
      startedAt: event.startedAt ?? event.timestamp ?? prev.startedAt ?? null,
      tokens: keep(event.tokens, prev.tokens, 0),
      status: "running",
    };
    return { ...base, tasks };
  }

  if (event.kind === "taskDone" || event.kind === "taskNotification") {
    if (event.id == null) return base;
    const prev = tasks[event.id] || { id: event.id };
    tasks[event.id] = {
      id: event.id,
      taskType: keep(prev.taskType, null),
      subagentType: keep(prev.subagentType, null),
      description: keep(event.description, prev.description, ""),
      workflowName: keep(prev.workflowName, null),
      startedAt: prev.startedAt ?? null,
      // When it ENDED. Without this, a finished task's "elapsed" was `now - startedAt`, which is not a
      // duration at all — it is "how long ago it began", and it keeps growing forever. A 4-second task
      // read as "9h 17m" nine hours later.
      //
      // Defaults to NULL, not to Date.now(). Stamping the moment we happened to process the event would
      // invent a finish time — and the reducer can run well after the fact (a replay, a reconnect
      // catch-up), so the invented number would be confidently wrong. An unknown duration stays null and
      // renders as unknown, which is the same rule elapsedMs already follows.
      finishedAt: event.finishedAt ?? event.timestamp ?? prev.finishedAt ?? null,
      tokens: keep(event.tokens, prev.tokens, 0),
      status: doneStatus(event.status),
      summary: keep(event.summary, prev.summary, ""),
    };
    return { ...base, tasks };
  }

  return base;
}

/**
 * shapeBackground(state, now) → panel model
 *   { count, running, done, agents:[{ id, label, description, startedAt, elapsedMs, tokens, status }], totalTokens }
 * label = subagentType || taskType || "agent".
 *
 * `startedAt` is the RAW server epoch-ms start (null when unknown). It is emitted alongside `elapsedMs`
 * because a snapshot alone cannot drive a trustworthy live clock: a reconnecting client would have to
 * start a browser-local timer that resets on every reload — the exact failure `turnStartedAt` exists to
 * avoid (CONTRACT §6). With `startedAt` the client ticks against an absolute instant instead.
 *
 * `elapsedMs` is `now - startedAt`, or **null** when either is unknown. NOT 0: a truly 0 ms-old agent is
 * unobservable, so 0 was never meaningfully true — it only made "unknown" indistinguishable from "just
 * started" and invited a fake "0s" in the UI.
 *
 * agents sorted running-first, then by startedAt. "removed" tasks are excluded. Null-safe (empty → zeroed).
 */
/**
 * RETENTION. A finished agent must eventually leave, or the panel becomes a session-long changelog:
 * 26 rows, 23 of them successes from nine hours ago, burying the 3 that failed.
 *
 * The rules, and why each one:
 *   running     kept, always. This is the question the panel exists to answer.
 *   done        kept for `keepDoneMs` after it finished, then dropped. Long enough to see what just
 *               happened, short enough that it never becomes history. A success nobody read is not
 *               information.
 *   error       kept until DISMISSED, never auto-dropped. A failure that disappears on a timer is a
 *               failure you will never know about — and it is the only row worth interrupting for.
 *   unknown end kept. If we never learned when it finished we cannot know if it has aged out, and
 *               guessing would drop rows arbitrarily.
 *
 * Pure: takes `now`, returns a new state. Dismissal is explicit (`dismissed` ids) so an error can only
 * leave because someone actually saw it.
 */
export const RETAIN_DONE_MS = 3 * 60 * 1000;

export function pruneFinished(state, now, opts = {}) {
  const map = isObj(state) && isObj(state.tasks) ? state.tasks : {};
  const keepDoneMs = Number.isFinite(opts.keepDoneMs) ? opts.keepDoneMs : RETAIN_DONE_MS;
  const dismissed = opts.dismissed instanceof Set ? opts.dismissed
    : new Set(Array.isArray(opts.dismissed) ? opts.dismissed : []);
  const out = {};
  for (const id of Object.keys(map)) {
    const t = map[id];
    if (!isObj(t)) continue;
    if (dismissed.has(id)) continue;                       // explicitly acknowledged → gone
    const st = t.status || "running";
    if (st === "running") { out[id] = t; continue; }       // never drop live work
    if (st === "error") { out[id] = t; continue; }          // errors leave only by being dismissed
    if (st === "removed") continue;                         // the engine already retired it
    // done: age it out, but only when we actually know when it ended
    if (!t.finishedAt || !now) { out[id] = t; continue; }
    if (now - t.finishedAt < keepDoneMs) out[id] = t;
  }
  return { ...state, tasks: out };
}

export function shapeBackground(state, now) {
  const map = isObj(state) && isObj(state.tasks) ? state.tasks : {};
  const live = Object.values(map).filter((t) => isObj(t) && t.status !== "removed");

  const agents = live
    .map((t) => ({
      id: t.id,
      label: t.subagentType || t.taskType || "agent",
      description: t.description || "",
      startedAt: t.startedAt ?? null,
      finishedAt: t.finishedAt ?? null,
      // `elapsedMs` is how long it has been RUNNING, and is therefore null once it is not running —
      // a stopped clock must not keep ticking. A finished task reports how long it TOOK (durationMs,
      // null when we never saw it start) and how long ago it ended (finishedAgoMs). Three different
      // questions that were all being answered with the same growing number.
      elapsedMs: (t.status === "running" || !t.status) && t.startedAt && now
        ? Math.max(0, now - t.startedAt) : null,
      durationMs: t.startedAt && t.finishedAt ? Math.max(0, t.finishedAt - t.startedAt) : null,
      finishedAgoMs: t.finishedAt && now ? Math.max(0, now - t.finishedAt) : null,
      tokens: Number(t.tokens) || 0,
      status: t.status || "running",
    }))
    .sort((a, b) => {
      const ar = a.status === "running" ? 0 : 1;
      const br = b.status === "running" ? 0 : 1;
      if (ar !== br) return ar - br;
      const as = liveStartedAt(map, a.id);
      const bs = liveStartedAt(map, b.id);
      return (as ?? 0) - (bs ?? 0);
    });

  const running = agents.filter((a) => a.status === "running").length;
  const done = agents.filter((a) => a.status === "done" || a.status === "error").length;
  const totalTokens = agents.reduce((s, a) => s + a.tokens, 0);
  return { count: agents.length, running, done, agents, totalTokens };
}

const liveStartedAt = (map, id) => (isObj(map[id]) ? map[id].startedAt : null);

/** k(n) → compact token count for the panel ("128k", "1.2M"). */
export function k(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  if (Math.abs(v) >= 1e6) return trim(v / 1e6) + "M";
  if (Math.abs(v) >= 1000) return trim(v / 1000) + "k";
  return String(v);
}

const trim = (x) => String(Math.round(x * 10) / 10);
