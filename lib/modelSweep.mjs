// The OmniRoute "sweep" mode: fire ONE prompt against EVERY currently-exposed model, but never all at
// once — a raw Promise.all over ~220+ models would hammer every connected provider (Claude/Groq/Cursor/
// Kimi/OpenRouter) simultaneously. This is a small, injectable concurrency pool: `testFn(model)` is the
// actual per-model work (in production, WorkspaceManager#testModel bound — a brand-new, pinned session
// per model, per the "switching an existing session's model doesn't actually re-route" finding), so the
// batching/ordering logic here is unit-testable with a fake `testFn` and no real session/SDK involved.

/**
 * Run `testFn(model)` for every entry in `models`, at most `opts.concurrency` in flight at once.
 * Preserves input order in the returned array regardless of completion order. A `testFn` that throws
 * (rather than resolving/rejecting cleanly) is caught per-model so one bad model never aborts the rest
 * of the sweep. Never throws.
 *
 * `opts.onProgress({ index, model, result, done, total })` fires once per settled model, in COMPLETION
 * order (that's the point — a 200-model sweep is minutes long, so the UI must see rows land as they
 * land, not one dump at the end). A throwing listener is swallowed: a broken UI callback must never
 * abort the sweep. `opts.shouldStop()` is polled before each model is dispatched — returning true stops
 * the sweep launching anything NEW (already in-flight models still settle and still report), so a
 * cancelled sweep returns a SHORTER array rather than a padded/holed one.
 */
export async function runModelSweep(models, testFn, opts = {}) {
  const list = Array.isArray(models) ? models.filter((m) => typeof m === "string" && m) : [];
  const concurrency = Math.max(1, Number.isFinite(opts.concurrency) ? Math.floor(opts.concurrency) : 4);
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  const shouldStop = typeof opts.shouldStop === "function" ? opts.shouldStop : null;
  const results = new Array(list.length);
  if (!list.length || typeof testFn !== "function") return results.filter(Boolean);
  const total = list.length;
  let next = 0, done = 0;
  async function worker() {
    while (next < list.length) {
      if (shouldStop && shouldStop()) return;   // cancelled — claim no further work
      const i = next++;
      let result;
      try { result = await testFn(list[i]); }
      catch (e) { result = { ok: false, model: list[i], error: String((e && e.message) || e) }; }
      results[i] = result;
      done++;
      if (onProgress) { try { onProgress({ index: i, model: list[i], result, done, total }); } catch {} }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, list.length) }, worker);
  await Promise.all(workers);
  // A cancelled sweep leaves holes (never-dispatched slots). filter(Boolean) collapses them so callers
  // always get a dense array of REAL results; an uncancelled sweep is dense already, so this is a no-op.
  return results.filter(Boolean);
}

/** Shape one testModel-style result into a sweep table ROW: model, provider, ok/status, latency, and a
 *  short preview — the first ~200 chars of a successful reply, or the raw error text on failure (never a
 *  generic "failed" placeholder). Pure, defensive against a malformed/missing result. */
export function summarizeSweepRow(r) {
  const ok = !!(r && r.ok);
  const reply = typeof r?.reply === "string" ? r.reply : "";
  return {
    model: (r && r.model) || "",
    provider: (r && r.provider) || null,
    ok,
    status: ok ? "ok" : "error",
    latencyMs: Number.isFinite(r?.latencyMs) ? r.latencyMs : null,
    preview: ok ? reply.slice(0, 200) : String((r && r.error) || "Unknown error"),
  };
}

/**
 * The server-side STATE around a sweep: one sweep at a time, its rows accumulating as they land, and a
 * set of live subscribers (the SSE stream) plus a `snapshot()` a late joiner replays from. Extracted here
 * (rather than inlined in dashboard/server.mjs, like DEPLOY's ad-hoc object) precisely because a sweep is
 * long-running and cancellable: the "can I start? / is it done? / what did a reconnecting browser miss?"
 * transitions are exactly the part worth unit-testing, and they need no HTTP to exercise.
 *
 * `testFn(model)` is injected — in production `WorkspaceManager#testModel` bound to one prompt/timeout,
 * i.e. a brand-new PINNED session per model (an existing session's setModel does NOT re-route the
 * provider, so a sweep may never reuse a session). `now()` is injectable for deterministic tests.
 */
export function createSweepRun({ testFn, concurrency = 3, now = () => Date.now() } = {}) {
  const subs = new Set();
  let state = { running: false, stopping: false, startedAt: null, finishedAt: null, prompt: "", total: 0, done: 0, rows: [] };

  const snapshot = () => ({ ...state, rows: state.rows.slice() });
  const emit = (ev) => { for (const fn of subs) { try { fn(ev); } catch {} } };   // a broken subscriber must never break the sweep

  /** Subscribe to sweep events (`{kind:"start"|"row"|"end", …}`). Returns an unsubscribe function. */
  function subscribe(fn) { if (typeof fn !== "function") return () => {}; subs.add(fn); return () => subs.delete(fn); }

  /** Ask the running sweep to stop. In-flight models still settle and still report their row (they're
   *  real answers — throwing them away would hide exactly the result you waited for); nothing NEW starts. */
  function stop() { if (state.running) state.stopping = true; return snapshot(); }

  /** Start a sweep over `models` with `prompt`. Refuses (returns `{ok:false, reason:"busy"}`) while one is
   *  already running — a second concurrent sweep would double the load on every provider, which is the one
   *  thing the concurrency pool exists to prevent. Resolves the finished snapshot. */
  async function start(models, prompt = "", startOpts = {}) {
    if (state.running) return { ok: false, reason: "busy", snapshot: snapshot() };
    const list = Array.isArray(models) ? models.filter((m) => typeof m === "string" && m) : [];
    if (!list.length) return { ok: false, reason: "no-models", snapshot: snapshot() };
    // A per-run concurrency override, hard-capped: the whole reason this pool exists is that a sweep must
    // not hammer every provider at once, so a caller can dial it DOWN freely but never past the cap.
    const lanes = Math.min(8, Math.max(1, Number.isFinite(startOpts.concurrency) ? Math.floor(startOpts.concurrency) : concurrency));
    state = { running: true, stopping: false, startedAt: now(), finishedAt: null, prompt: String(prompt || ""), total: list.length, done: 0, rows: [] };
    emit({ kind: "start", total: list.length, prompt: state.prompt, startedAt: state.startedAt });
    await runModelSweep(list, testFn, {
      concurrency: lanes,
      shouldStop: () => state.stopping,
      onProgress: ({ result, done, total }) => {
        const row = summarizeSweepRow(result);
        state.rows.push(row);
        state.done = done;
        emit({ kind: "row", row, done, total });
      },
    });
    state.running = false;
    state.finishedAt = now();
    emit({ kind: "end", ...snapshot() });
    return { ok: true, snapshot: snapshot() };
  }

  return { start, stop, snapshot, subscribe };
}
