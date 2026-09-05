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
        startedAt: prev.startedAt ?? null,
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
 *   { count, running, done, agents:[{ id, label, description, elapsedMs, tokens, status }], totalTokens }
 * label = subagentType || taskType || "agent"; elapsedMs = now - startedAt (0 if no startedAt/now).
 * agents sorted running-first, then by startedAt. "removed" tasks are excluded. Null-safe (empty → zeroed).
 */
export function shapeBackground(state, now) {
  const map = isObj(state) && isObj(state.tasks) ? state.tasks : {};
  const live = Object.values(map).filter((t) => isObj(t) && t.status !== "removed");

  const agents = live
    .map((t) => ({
      id: t.id,
      label: t.subagentType || t.taskType || "agent",
      description: t.description || "",
      elapsedMs: t.startedAt && now ? Math.max(0, now - t.startedAt) : 0,
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
