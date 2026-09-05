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
 */
export async function runModelSweep(models, testFn, opts = {}) {
  const list = Array.isArray(models) ? models.filter((m) => typeof m === "string" && m) : [];
  const concurrency = Math.max(1, Number.isFinite(opts.concurrency) ? Math.floor(opts.concurrency) : 4);
  const results = new Array(list.length);
  if (!list.length || typeof testFn !== "function") return results.filter(Boolean);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      try { results[i] = await testFn(list[i]); }
      catch (e) { results[i] = { ok: false, model: list[i], error: String((e && e.message) || e) }; }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, list.length) }, worker);
  await Promise.all(workers);
  return results;
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
