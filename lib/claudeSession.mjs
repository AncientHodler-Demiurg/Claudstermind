// A live Claude Code session, driven remotely — the engine behind the web Workspace.
//
// Wraps the Claude Agent SDK's streaming query: one long-lived session bound to one repo
// (cwd), multi-turn (you push follow-up prompts), streaming its messages out as events,
// and routing each tool-permission decision either to the web (approve/deny) or straight
// through (trusted mode). Usage/cost accumulates per session.
//
// Auth: the bridge injects the subscription token (from `claude setup-token`) via the
// CLAUDE_CODE_OAUTH_TOKEN env before spawning; this module only cleans the inherited
// child-session vars that would otherwise make the spawn expect host-refreshed auth.
import { randomUUID } from "node:crypto";
import { omniRouteFor } from "./omniRoute.mjs";
import { reduceBackground, shapeBackground } from "./backgroundTasks.mjs";

// Names whose VALUE is a secret the remotely-driven agent must never see. The agent runs
// arbitrary shell + reads repo/tool content (a prompt-injection surface), so a leaked
// AGENT_DEVICE_SECRET or GitHub PAT in its env could be exfiltrated. Keep only the one
// credential the agent legitimately needs (its own OAuth token).
const SECRETISH = /(SECRET|TOKEN|APIKEY|API_KEY|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|_PAT$|GH_TOKEN|GITHUB_TOKEN)/i;

/** The permission modes a pane may run in — the same set the Claude Code UI's mode selector
 *  offers, in its order. `id` goes straight to the SDK's `permissionMode`. */
export const PERMISSION_MODES = Object.freeze([
  { id: "default", label: "Manual", hint: "Ask before every tool." },
  { id: "acceptEdits", label: "Accept edits", hint: "File edits run automatically; everything else asks." },
  { id: "plan", label: "Plan", hint: "Read-only — Claude plans but executes nothing." },
  { id: "auto", label: "Auto", hint: "Claude judges each tool; risky ones still ask." },
  { id: "bypassPermissions", label: "Bypass permissions", hint: "Runs everything without asking — like working locally." },
]);
const MODE_IDS = new Set(PERMISSION_MODES.map((m) => m.id));
export const isMode = (m) => typeof m === "string" && MODE_IDS.has(m);
/** Coerce anything (including the legacy `trusted` boolean) to a valid mode id. */
export const toMode = (m, fallback = "default") => (isMode(m) ? m : (m === true ? "bypassPermissions" : m === false ? "default" : fallback));

/** Strip the vars a nested Claude Code context injects (so the spawn uses the headless
 *  subscription token, not host auth refresh) AND every host secret, so the agent's
 *  environment carries no credential except its own OAuth token. */
export function cleanClaudeEnv(base) {
  const env = { ...base };
  for (const k of Object.keys(env)) {
    if (k === "CLAUDE_CODE_OAUTH_TOKEN") continue;                       // the one credential the agent needs
    if (k === "CLAUDECODE" || k === "AI_AGENT" || k === "BAGGAGE") { delete env[k]; continue; }
    if (/^CLAUDE_CODE_/i.test(k)) { delete env[k]; continue; }
    if (k === "AGENT_DEVICE_SECRET" || k === "RELAY_URL" || SECRETISH.test(k)) delete env[k];   // never hand host secrets to the agent
  }
  return env;
}

// Event kinds that describe agent-spawned BACKGROUND work (independent of the chat turn), not
// reply content — used to keep them from being mistaken for the turn still producing output.
export const BG_KINDS = new Set(["background", "taskStarted", "taskDone"]);

// A tool result's content is a string OR an array of blocks ({ type:"text", text } / strings). Flatten it to
// plain text and CAP it — a Bash/REPL dump can be huge, and this rides a live event, not the persisted store.
// Keep the HEAD and TAIL around a truncation notice so the command context AND the final pass/fail both show.
const TOOL_OUTPUT_CAP = 8000;
export function toolResultText(content) {
  let s = "";
  if (typeof content === "string") s = content;
  else if (Array.isArray(content)) s = content.map((b) => (typeof b === "string" ? b : (b && b.type === "text" ? (b.text || "") : ""))).filter(Boolean).join("\n");
  else if (content && content.type === "text") s = content.text || "";
  s = String(s == null ? "" : s);
  if (s.length > TOOL_OUTPUT_CAP) s = s.slice(0, TOOL_OUTPUT_CAP - 500) + "\n\n…[truncated " + (s.length - TOOL_OUTPUT_CAP) + " chars]…\n\n" + s.slice(-450);
  return s;
}
/** Distill a raw SDK message into a compact event for the web transcript. */
export function toEvent(msg) {
  if (!msg || typeof msg !== "object") return null;
  if (msg.type === "system" && msg.subtype === "init") return { kind: "init", sessionId: msg.session_id, model: msg.model, cwd: msg.cwd };
  // Partial/streaming text — only surfaces when `includePartialMessages: true` (see start()).
  // A live preview only, never persisted/stored: the complete `type: "assistant"` message below
  // still arrives with the authoritative full text, which is what the transcript actually keeps.
  // This is the whole point of the feature — the web console can show Claude "typing" a reply as
  // it's generated, the same way the desktop app does, instead of silence until the full turn ends.
  if (msg.type === "stream_event") {
    const ev = msg.event;
    if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
      return { kind: "assistant_delta", text: ev.delta.text };
    }
    return null;   // tool-input deltas, thinking deltas, block/message start-stop — not rendered live (yet)
  }
  if (msg.type === "assistant") {
    const parts = (msg.message?.content) || [];
    const text = parts.filter((c) => c.type === "text").map((c) => c.text).join("");
    const tools = parts.filter((c) => c.type === "tool_use").map((c) => ({ name: c.name, input: c.input }));
    if (text) return { kind: "assistant", text };
    if (tools.length) return { kind: "tool_use", tools };
    return null;
  }
  if (msg.type === "user") {
    const parts = (msg.message?.content) || [];
    const results = parts.filter((c) => c.type === "tool_result");
    // Carry each tool result's OUTPUT (capped) so the web can SHOW it — e.g. the stdout of a Pact `.repl`
    // test the agent ran via Bash. Previously only a count survived, so tool output was invisible ("nothing
    // shows when the agent runs repl tests"). `count` is kept for older clients that only read that.
    if (results.length) return { kind: "tool_result", count: results.length, results: results.map((r) => ({ output: toolResultText(r.content), isError: !!r.is_error })) };
    return null;
  }
  if (msg.type === "result") {
    return { kind: "result", subtype: msg.subtype, isError: !!msg.is_error,
      usage: msg.usage || null, costUsd: msg.total_cost_usd ?? null, durationMs: msg.duration_ms ?? null,
      resultText: typeof msg.result === "string" ? msg.result : null };
  }
  // Background work the agent spawned that runs INDEPENDENTLY of the chat turn — a Workflow or a
  // backgrounded Task/Bash. These `system` messages arrive on the query stream even while the turn
  // is idle (the chat looks "free"), which is exactly the state where the user otherwise has no way
  // to know work is still happening. `background_tasks_changed` is authoritative (REPLACE: the full
  // live set after any change); task_started/task_notification enrich it (workflow name; a settle).
  if (msg.type === "system" && msg.subtype === "background_tasks_changed") {
    return { kind: "background", tasks: (msg.tasks || []).map((t) => ({ id: t.task_id, taskType: t.task_type, description: t.description,
      // Read DEFENSIVELY: the SDK's own task shape is richer than the three fields above on some
      // builds (a Task tool's subagent name, a workflow's name, a running token count). Forwarding
      // them when present is what lets the background-agents panel say WHICH agent and HOW hard,
      // instead of just "something is running"; absent, the panel falls back to the task type.
      subagentType: t.subagent_type ?? t.subagentType ?? null, workflowName: t.workflow_name ?? t.workflowName ?? null,
      tokens: t.tokens ?? t.total_tokens ?? 0 })) };
  }
  if (msg.type === "system" && msg.subtype === "task_started") {
    return { kind: "taskStarted", id: msg.task_id, taskType: msg.task_type || null, workflowName: msg.workflow_name || null,
      subagentType: msg.subagent_type ?? msg.subagentType ?? null,
      description: msg.description || "", skipTranscript: !!msg.skip_transcript };
  }
  if (msg.type === "system" && msg.subtype === "task_notification") {
    // `tokens` is the settle-time token spend for that subagent — the "how intense / how many tokens"
    // half of the panel. Read defensively (several spellings, absent on older builds → 0).
    return { kind: "taskDone", id: msg.task_id, status: msg.status, summary: msg.summary || "",
      tokens: msg.tokens ?? msg.total_tokens ?? msg.usage?.total_tokens ?? 0, skipTranscript: !!msg.skip_transcript };
  }
  // Compaction boundary — the CLI ran `/compact` (or auto-compacted). This is the CONFIRMATION the web
  // needs: without it a compact looks like it did nothing (the transcript is unchanged; only the hidden
  // context window shrank). Surface pre/post token counts so the console can say "🗜 compacted N→M".
  if (msg.type === "system" && msg.subtype === "compact_boundary") {
    const m = msg.compact_metadata || {};
    return { kind: "compacted", trigger: m.trigger || "manual", preTokens: m.pre_tokens ?? null, postTokens: m.post_tokens ?? null };
  }
  return null;
}

/** Accumulate usage across a session's result messages. */
export function addUsage(acc, usage, costUsd) {
  acc.turns += 1;
  if (usage) {
    acc.inputTokens += usage.input_tokens || 0;
    acc.outputTokens += usage.output_tokens || 0;
    acc.cacheReadTokens += usage.cache_read_input_tokens || 0;
    acc.cacheCreationTokens += usage.cache_creation_input_tokens || 0;
  }
  if (typeof costUsd === "number") acc.costUsd += costUsd;
  return acc;
}
export const emptyUsage = () => ({ turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 });

/**
 * One remote Claude session. Injectable `sdkQuery` (defaults to the real SDK) so the
 * streaming/permission/usage plumbing is testable with a mock.
 *
 * opts = {
 *   cwd, model,
 *   effort,                         // an EffortLevel id ('low'|'medium'|'high'|'xhigh'|'max') — omit for the model's default
 *   fastMode,                       // boolean — Settings-layer flag, no top-level query() option for it
 *   mode,                           // a PERMISSION_MODES id (legacy `trusted: true` ⇒ bypassPermissions)
 *   token,                          // subscription OAuth token (CLAUDE_CODE_OAUTH_TOKEN)
 *   onEvent(sessionKey, event),     // stream: init | assistant | tool_use | tool_result | result | status
 *   onPermission(sessionKey, req) → Promise<"allow"|"deny">,   // web approve/deny
 *   sdkQuery                        // the SDK query() (injected for tests)
 * }
 */
export class ClaudeSession {
  constructor(opts) {
    this.key = opts.key || randomUUID();
    this.cwd = opts.cwd;
    this.model = opts.model;
    this.effort = opts.effort || undefined;      // an EffortLevel id ('low'|'medium'|'high'|'xhigh'|'max'); undefined = model default
    this.fastMode = !!opts.fastMode;
    this.mode = toMode(opts.mode, opts.trusted ? "bypassPermissions" : "default");
    this.token = opts.token;
    this.keyName = opts.keyName || null;   // which named OAuth key this session runs under (multi-key usage tracking)
    this.resume = opts.resume || null;   // resume a saved session by its Claude session id
    this.onEvent = opts.onEvent || (() => {});
    this.onPermission = opts.onPermission || (async () => "deny");
    this.sdkQuery = opts.sdkQuery;
    this.sessionId = null;          // Claude's own session id (for resume/persistence)
    this.usage = emptyUsage();
    this.status = "idle";           // idle | thinking | awaiting-permission | deepwork | error | ended
    // Authoritative turn timing — the SERVER's truth about "is a turn running and since when", so a client that
    // reloads / navigates away and back (losing its local clock) shows the REAL elapsed instead of restarting from
    // zero, and "stuck?" is judged by REAL silence. turnStartedAt: when the current busy phase began (null when
    // idle). lastActivityAt: when the subprocess last produced ANY output (the honest liveness heartbeat).
    this.turnStartedAt = null;
    this.lastActivityAt = null;
    this._lastDeepWorkEndedAt = null;   // Date.now() of the last "deepwork" → idle transition — see start()
    this.backgroundTasks = new Map();   // task_id → { taskType, description } — agent-spawned work running independently of the chat turn (see toEvent)
    // The SHAPED view of the same thing: the reducer in lib/backgroundTasks.mjs folds the three
    // background event kinds into one panel model (count / per-agent label + elapsed + tokens /
    // fleet total). `backgroundTasks` above is the raw live set every existing consumer reads;
    // this is the extra, richer view the background-agents panel renders from. Kept in step here,
    // in the session, so a client that RECONNECTS gets it from sessionSummary rather than having
    // to replay events it already missed — the exact complaint behind "you said work was happening
    // in the background and I couldn't tell".
    this.backgroundState = { tasks: {} };
    this._inbox = [];               // queued user prompts
    this._wake = null;
    this._q = null;
    this._started = false;
    this._ended = false;
    // Seamless lane switching (Direct-Claude ⇄ OmniRoute): the base URL is fixed at spawn, so crossing lanes
    // mid-conversation means re-spawning the query with the SAME conversation resumed. These track that.
    this._gen = 0;                  // bumps on each (re)spawn — a stale _input() generation stops yielding
    this._respawn = false;          // set to break the current query loop WITHOUT ending the session, to re-spawn
    this._rolling = false;          // a respawn that starts a BRAND-NEW session (resume cleared) — see roll()
    this._laneStale = false;        // the picked model is on a different lane than the running query — re-spawn next prompt
    this._runningLane = null;       // the lane the CURRENT _q actually spawned on ("direct" | "omni:<baseUrl>")
  }

  /** Fold ONE background event into `backgroundState`. The SDK's task events carry no timestamp, so the
   *  start time is stamped here, on first sighting, from the wall clock — the reducer itself stays pure
   *  and never restarts a clock it already has. `now` is injectable for tests. */
  _trackBackground(ev, now = Date.now()) {
    let e = ev;
    if (ev.kind === "taskStarted") e = { ...ev, startedAt: ev.startedAt ?? now };
    else if (ev.kind === "background") e = { ...ev, tasks: (ev.tasks || []).map((t) => ({ startedAt: now, ...t })) };
    this.backgroundState = reduceBackground(this.backgroundState, e);
  }

  /** The background-agents panel model for RIGHT NOW — `{ count, running, done, agents[], totalTokens }`.
   *  See lib/backgroundTasks.mjs `shapeBackground`. */
  backgroundPanel(now = Date.now()) { return shapeBackground(this.backgroundState, now); }

  /** The routing lane a model runs on: "direct" (Anthropic) or "omni:<baseUrl>" (an OmniRoute gateway). All
   *  omni models share ONE gateway, so switching among them is same-lane (a live setModel); only Direct⇄OmniRoute
   *  crosses lanes and needs a re-spawn. The base URL, not the model name, is what's fixed at subprocess spawn. */
  _laneOf(model) {
    const o = omniRouteFor(model, process.env);
    return o ? ("omni:" + o.baseUrl) : "direct";
  }

  /** True only in the mode that runs every tool unattended — kept as a derived flag so the
   *  older `trusted` wording (state frames, tests) still reads correctly. */
  get trusted() { return this.mode === "bypassPermissions"; }
  setTrusted(v) { return this.setMode(v ? "bypassPermissions" : "default"); }

  /** Switch permission mode. On a session that's already streaming this also tells the SDK —
   *  `permissionMode` is fixed at query start, so without setPermissionMode() a mid-session
   *  change would only alter our own canUseTool shortcut and diverge from the real mode. */
  setMode(mode) {
    const next = toMode(mode, this.mode);
    if (next === this.mode) return this.mode;
    this.mode = next;
    if (this._started && !this._ended) Promise.resolve(this._q?.setPermissionMode?.(next)).catch(() => {});
    this._emit({ kind: "mode", mode: next });
    return this.mode;
  }

  /** Switch model. Same live-update shape as setMode(): the SDK's own setModel() takes effect on
   *  the NEXT turn (it's fixed for one already-in-flight turn), so nothing here needs to await it
   *  — this._q resolves in the background, and the confirmation the web actually reacts to is the
   *  synchronous `model` event emitted below, not the SDK call's own completion. */
  setModel(model) {
    const next = model || undefined;
    if (next === this.model) return this.model;
    this.model = next;
    if (this._started && !this._ended) {
      if (this._laneOf(next) !== this._runningLane) {
        // Crossing lanes (Direct-Claude ⇄ OmniRoute): can't retarget a live subprocess's base URL. Defer a
        // seamless re-spawn to the next prompt — the conversation resumes on the new lane with full context,
        // and any in-flight turn finishes undisturbed on the old lane. Matches Cursor's mid-chat model switch.
        this._laneStale = true;
      } else {
        // Same lane — the SDK can retarget live. Send the LANE-NATIVE name (omni ids drop the "omni/" prefix
        // so the gateway recognises them); no re-spawn, takes effect on the next turn.
        this._laneStale = false;
        const o = omniRouteFor(next, process.env);
        Promise.resolve(this._q?.setModel?.(o ? o.model : next)).catch(() => {});
      }
    }
    this._emit({ kind: "model", model: this.model });
    return this.model;
  }

  /** Switch reasoning effort. Mid-session this rides `applyFlagSettings` — note the SDK's own
   *  key there is `effortLevel`, not `effort` (the latter is only the INITIAL query() option,
   *  applied once at start() below); both spellings exist in the SDK's own surface, not a typo
   *  here. */
  setEffort(effort) {
    const next = effort || undefined;
    if (next === this.effort) return this.effort;
    this.effort = next;
    if (this._started && !this._ended) Promise.resolve(this._q?.applyFlagSettings?.({ effortLevel: next || null })).catch(() => {});
    this._emit({ kind: "effort", effort: this.effort });
    return this.effort;
  }

  /** Toggle fast mode. A Settings-layer flag (there's no top-level query() option for it), so
   *  the INITIAL value rides in `options.settings` at start() below, and a mid-session change
   *  goes through the same `applyFlagSettings` mid-session control call as effort. */
  setFastMode(enabled) {
    const next = !!enabled;
    if (next === this.fastMode) return this.fastMode;
    this.fastMode = next;
    if (this._started && !this._ended) Promise.resolve(this._q?.applyFlagSettings?.({ fastMode: next })).catch(() => {});
    this._emit({ kind: "fastMode", fastMode: this.fastMode });
    return this.fastMode;
  }

  /** Context-window usage breakdown for this session right now (system prompt, tools, messages,
   *  memory files, etc. — see the SDK's `getContextUsage()`). Null when the session hasn't
   *  started/has ended, or the underlying query doesn't support it (a test mock, or an older
   *  CLI) — never throws, since this backs a UI meter that should just show "unavailable" rather
   *  than break the pane. */
  async getContextUsage() {
    if (!this._q?.getContextUsage) return null;
    try { return await this._q.getContextUsage(); } catch { return null; }
  }

  /** claude.ai plan rate-limit utilization (5-hour / 7-day / per-model windows) plus session
   *  cost/usage totals — see the SDK's own
   *  `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`. EXPERIMENTAL BY ANTHROPIC'S
   *  OWN NAMING: the method name and response shape may change without notice in a future SDK
   *  release — this wrapper is the one place that breakage would need to be patched. Null (never
   *  throws) when unsupported/unavailable, same reasoning as getContextUsage(). */
  async getUsageLimits() {
    if (!this._q?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET) return null;
    try { return await this._q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(); } catch { return null; }
  }

  /** Identity of the authenticated account for this session's token — `{ email?, organization?,
   *  subscriptionType?, tokenSource?, apiKeySource?, apiProvider? }` per the SDK's AccountInfo. Lets
   *  the Usage tab label each key with the Claude account it's tied to. NOTE: `email`/`organization`
   *  are themselves gated by the `user:profile` OAuth scope — a `claude setup-token` (user:inference
   *  only) will typically return them absent, while `subscriptionType`/`tokenSource` may still be set.
   *  Null (never throws) when unsupported/unavailable, same reasoning as getUsageLimits(). */
  async getAccountInfo() {
    if (!this._q?.accountInfo) return null;
    try { return await this._q.accountInfo(); } catch { return null; }
  }

  /** The models this session's CLI build actually offers (display name, description, effort/
   *  fast-mode/auto-mode support) — what the model selector's dropdown is built from. Empty
   *  array (never throws) when unsupported/unavailable, or before the session has started (the
   *  list is a property of the running query, not knowable before one exists). */
  async getSupportedModels() {
    if (!this._q?.supportedModels) return [];
    try { return (await this._q.supportedModels()) || []; } catch { return []; }
  }

  // The async input stream fed to the SDK — yields user messages as they're pushed. Tagged with the spawn
  // `gen` it belongs to: after a lane re-spawn (which bumps _gen), a stale input stream from the OLD query
  // stops yielding and ends, so a queued prompt is drained by the NEW query's fresh _input(), never both.
  async *_input(gen = this._gen) {
    // seed prompt already queued before start()
    while (!this._ended && this._gen === gen) {
      while (this._inbox.length && this._gen === gen) {
        const { text, images } = this._inbox.shift();
        // A new turn is starting — reflect "thinking" so the web dot lights on every
        // follow-up, not just the first (status is otherwise only reset to idle on result).
        if (this.status !== "thinking") { this.status = "thinking"; this._emit({ kind: "status", status: this.status }); }
        this._beginTurn();   // a dequeued prompt starts a new turn — stamp the authoritative clock
        // Plain string content for the overwhelmingly common text-only case (unchanged from
        // before image support existed); a multi-part array (text + one block per image, up to
        // Claude Code's own 5-image limit) when any images ride along.
        const content = images && images.length
          ? [{ type: "text", text }, ...images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64Data } }))]
          : text;
        yield { type: "user", message: { role: "user", content } };
      }
      if (this._ended || this._gen !== gen) break;
      await new Promise((res) => { this._wake = res; });
    }
  }

  /** Queue a follow-up prompt. `images`, if given, rides alongside the text as extra SDK content
   *  blocks (Anthropic vision input) — omit it (or pass undefined) for the plain-string behavior
   *  every existing caller relies on. Accepts either a single `{ mediaType, base64Data }` object
   *  (back-compat with every existing single-image caller) or an array of them (the current,
   *  multi-image shape) — normalized to an array internally either way. */
  prompt(text, images) {
    const imgs = Array.isArray(images) ? images : (images ? [images] : undefined);
    this._inbox.push({ text, images: imgs });
    // A lane switch was pending — this prompt is the trigger to re-spawn the query on the new lane, resuming
    // the conversation, so THIS prompt (and everything after) runs there. Otherwise just wake the input stream.
    if (this._laneStale && this._started && !this._ended) {
      this._laneStale = false;
      this._requestRespawn();
    } else if (this._wake) { const w = this._wake; this._wake = null; w(); }
    return this;
  }

  /** End the current query GENERATION (not the session) so start()'s loop re-spawns it. Bumps _gen so the
   *  old _input() stream stops yielding, then ends the current query; the queued prompt survives in _inbox and
   *  is picked up by the fresh generation. */
  _requestRespawn() {
    if (!this._started || this._ended) return;
    this._respawn = true;
    this._gen++;                                                  // invalidate the running _input() generation
    try { this._q?.return?.(); } catch {}                        // end the current SDK query stream…
    try { this._q?.interrupt?.(); } catch {}                     // …and abort any in-flight turn on it
    if (this._wake) { const w = this._wake; this._wake = null; w(); }   // unpark the old _input so it exits on the gen check
  }

  /** Roll this conversation onto a FRESH SDK session seeded with `seedText` (a carried-forward summary + the
   *  recent verbatim turns). The old session's on-disk log is left behind untouched (the caller archives it); the
   *  new session starts tiny, so `--resume` cold-loads fast forever, however long the overall conversation grows.
   *  Same session KEY — the caller (WorkspaceManager) archives the head + trims the visible transcript to the tail.
   *  Returns false if the session isn't in a rollable state. */
  roll(seedText) {
    if (!this._started || this._ended || !seedText) return false;
    this._rolling = true;
    this.resume = null; this.sessionId = null;                            // next spawn is a brand-new session
    this._inbox.unshift({ text: String(seedText), images: undefined });   // the seed is the first message of the fresh session
    this._requestRespawn();                                                // break the current query; start()'s loop respawns fresh with the seed queued
    return true;
  }

  // Mark the start of a busy phase (idle→thinking/deepwork). Idempotent within a phase: only stamps a fresh
  // start when there isn't one running, so mid-turn events never restart the clock. Also bumps the heartbeat.
  _beginTurn() { if (this.turnStartedAt == null) this.turnStartedAt = Date.now(); this.lastActivityAt = Date.now(); }

  _emit(event) { try { this.onEvent(this.key, { ...event, sessionKey: this.key }); } catch {} }

  async start() {
    if (this._started) return; this._started = true;
    // Outer loop: (re)spawn the query. A lane switch (Direct-Claude ⇄ OmniRoute) breaks the current generation
    // with _respawn set; we then resume the SAME conversation on the new lane and continue — a seamless mid-chat
    // model switch (context preserved) rather than a brand-new conversation.
    while (!this._ended) {
      await this._runQueryOnce(this._gen);
      if (this._ended || !this._respawn) break;
      // A ROLL respawns onto a BRAND-NEW session (resume stays null → the SDK mints a fresh, tiny session file, so
      // cold-resume stays fast forever no matter how long the conversation gets). A lane-switch respawn instead
      // continues the SAME conversation (resume = current sessionId).
      if (this._rolling) { this._rolling = false; this.resume = null; this.sessionId = null; }
      else { this.resume = this.sessionId || this.resume; }
      this._respawn = false;
    }
  }

  /** Build the SDK query options for the CURRENT model/lane/resume — rebuilt on every (re)spawn. The env's base
   *  URL + auth is what differs between Direct-Claude and an OmniRoute lane, and it's fixed at subprocess spawn,
   *  which is precisely why crossing lanes re-spawns instead of retargeting the live process. */
  _buildOptions() {
    const canUseTool = async (toolName, input) => {
      if (this.trusted) return { behavior: "allow", updatedInput: input };
      this.status = "awaiting-permission";
      this._emit({ kind: "status", status: this.status });
      const decision = await this.onPermission(this.key, { requestId: randomUUID(), tool: toolName, input });
      this.status = "thinking"; this._emit({ kind: "status", status: this.status });
      return decision === "allow" ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "Denied from the web console." };
    };
    const options = {
      cwd: this.cwd,
      canUseTool,
      // Stream text as it's generated (SDKPartialAssistantMessage / `stream_event`), not just the
      // one complete message at the end of a turn — see `toEvent`'s `stream_event` handling. This
      // is what lets the web console show Claude "typing" live, matching the desktop app's feel,
      // instead of one big reply landing all at once with no visible progress in between.
      includePartialMessages: true,
      // The interactive AskUserQuestion "card" (multiple-choice) can't render in the embedded web
      // console — there's no clickable card and no way to send a selection back. In bypass it gets
      // auto-allowed with NO answer, so the agent sees no selection and thinks you never replied
      // ("the question card isn't capturing your selection"). Disallow it so the agent asks in PLAIN
      // TEXT instead — which renders fine and you answer with an ordinary message.
      disallowedTools: ["AskUserQuestion"],
      permissionMode: this.mode,
      // The SDK refuses `bypassPermissions` unless the caller opts in explicitly. Sent for
      // every session (not just the ones starting in bypass) because setPermissionMode() can
      // switch INTO bypass later, after this option is no longer changeable.
      allowDangerouslySkipPermissions: true,
      env: this.token ? { ...cleanClaudeEnv(process.env), CLAUDE_CODE_OAUTH_TOKEN: this.token } : cleanClaudeEnv(process.env),
    };
    // OmniRoute routing: an "omni/<id>" model (with OMNIROUTE_KEY set) runs THIS session through the local
    // OmniRoute gateway instead of Anthropic — Claude Code's base-URL override + the gateway key as the token.
    // Applied at spawn only (base URL can't change on a live subprocess), so pick an omni model on a fresh
    // chat. cleanClaudeEnv already stripped inherited ANTHROPIC_*/secret vars, so these are the only ones set.
    const omni = omniRouteFor(this.model, process.env);
    if (omni) {
      options.env = { ...cleanClaudeEnv(process.env), ANTHROPIC_BASE_URL: omni.baseUrl, ANTHROPIC_AUTH_TOKEN: omni.authToken };
      options.model = omni.model;
    } else if (this.model) {
      options.model = this.model;
    }
    if (this.effort) options.effort = this.effort;
    if (this.fastMode) options.settings = { ...(options.settings || {}), fastMode: true };   // no top-level query() option for this — Settings-layer only
    if (this.resume) options.resume = this.resume;   // continue a saved conversation with full prior context
    return options;
  }

  /** Run ONE query generation to its natural end (session over) OR a break for a lane re-spawn. start()'s loop
   *  decides whether to re-spawn afterward. `gen` tags this generation's _input() so a stale one stops yielding. */
  async _runQueryOnce(gen) {
    this._runningLane = this._laneOf(this.model);   // the lane we actually spawn on — setModel compares against it
    const options = this._buildOptions();
    // Real SDK by default; tests inject a mock. Lazy import so the SDK only loads for
    // real sessions, never in unit tests.
    const runQuery = this.sdkQuery || (await import("@anthropic-ai/claude-agent-sdk")).query;

    if (this.status !== "thinking") { this.status = "thinking"; this._emit({ kind: "status", status: this.status }); }
    this._beginTurn();
    try {
      this._q = runQuery({ prompt: this._input(gen), options });
      for await (const msg of this._q) {
        let ev = toEvent(msg);
        if (!ev) continue;
        this.lastActivityAt = Date.now();   // the subprocess produced output — the honest liveness heartbeat
        if (ev.kind === "init") this.sessionId = ev.sessionId;
        // A turn can end (status → idle, on "result") while the SDK keeps this same query alive
        // for backgrounded work — a Bash/Task run in the background, or a deferred tool use (see
        // the SDK's own `terminal_reason: "background_requested"` / `deferred_tool_use`). When
        // that background work settles, this SAME generator resumes yielding real turn content
        // (more assistant text, tool calls, another "result") with NO new prompt ever pushed
        // through `_input()` — so `_input()`'s own "thinking" transition (which only fires on a
        // freshly dequeued USER prompt) never re-arms. Without this, the web console's busy
        // indicator goes idle at the first "result" and stays idle for good even though Claude is
        // still genuinely working — the Send button reads "ready" while the agent keeps
        // delivering answers. Re-arm here too, driven by observed incoming activity rather than
        // only outgoing prompts — tagged as its own "deepwork" status (not "thinking") so the web
        // console can tell "Claude just started answering you" apart from "Claude finished the
        // visible turn but is still grinding on backgrounded work, expect more" (surfaced as a
        // distinct red "Deep Work" indicator rather than the ordinary orange "Working…").
        // The background/task events (below) are NOT turn content — the chat turn really is over;
        // that separate work runs on its own. So they must never flip the CHAT status back to
        // deepwork (which is about the query still producing REPLY content). Exclude them here.
        //
        // ROADMAP 2.0 ITEM 4.7 — "possible deepwork deadlock": INVESTIGATED, NOT REAL. Do not
        // re-litigate; see the `4.7:` tests in lib/claudeSession.test.mjs, which lock this down.
        // The worry was that entering deepwork here is driven by CONTENT events while leaving it is
        // driven ONLY by `result`, so a stray post-result event would pin the session busy forever
        // (gating auto-continue → no new prompt → no result → never clears). Post-result events do
        // happen — that is exactly why this branch exists — but deepwork is not terminal, because
        // this loop has only four exits and every one of them REWRITES `status`:
        //   • a `result`               → "idle"     (just below)
        //   • the generator ends       → "ended"    (after the for-await)
        //   • the generator throws     → "error"    (the catch)
        //   • a respawn (roll / lane)  → "thinking" (the next _runQueryOnce, via start()'s loop)
        // and `interrupt()` explicitly accepts deepwork as well, as does `_stop`, which force-idles
        // after its 6s race. What is left is a genuinely HUNG SDK turn — the stream stays open and
        // silent mid-turn — where reporting BUSY is the honest answer, not a bug, and which is the
        // separate hung-turn class `_stop`'s timeout already exists for. No timeout/self-heal is
        // added here on purpose: one would have to fire on silence, and legitimate deep work is
        // silent for minutes at a time, so it would un-busy live sessions and let a prompt interleave
        // into a running turn — the exact interleaving the single-writer turn lock exists to prevent.
        if (this.status === "idle" && !BG_KINDS.has(ev.kind) && ev.kind !== "result" && ev.kind !== "init" && ev.kind !== "compacted") { this.status = "deepwork"; this._beginTurn(); this._emit({ kind: "status", status: this.status }); }
        // Track the live set of agent-spawned background work (workflows, backgrounded tasks). This
        // is what lets the web show "hidden work is running" even while the chat sits idle/free —
        // `background_tasks_changed` is the authoritative REPLACE of the whole set.
        if (ev.kind === "background") this.backgroundTasks = new Map(ev.tasks.map((t) => [t.id, t]));
        if (BG_KINDS.has(ev.kind)) { this._trackBackground(ev); ev = { ...ev, panel: this.backgroundPanel() }; }
        // Remember exactly when a deepwork phase ended (not just THAT it did) — a prompt sent in
        // the next few seconds is landing right as this backgrounded activity was wrapping up, so
        // there's a real chance more of its output is still in flight and will arrive interleaved
        // with (or instead of) a reply to that new prompt. workspace.mjs's _prompt reads this to
        // flag such a turn for the web (see MAX_DEEP_WORK_RISK_MS there) — "it looked done, but
        // wasn't quite" is the exact report this exists to make visible instead of silent.
        if (ev.kind === "result") {
          if (this.status === "deepwork") this._lastDeepWorkEndedAt = Date.now();
          addUsage(this.usage, ev.usage, ev.costUsd); this.status = "idle";
          this.turnStartedAt = null;   // turn done — stop the authoritative clock (a later deepwork phase re-arms it)
        }
        this._emit({ ...ev, usageTotal: this.usage });
      }
      if (this._respawn && !this._ended) return;   // broke out for a seamless re-spawn — keep the session alive
      this.status = "ended"; this._emit({ kind: "status", status: this.status });
    } catch (e) {
      if (this._respawn && !this._ended) return;   // an interrupt during the re-spawn tear-down can surface as an error — swallow it
      this.status = "error";
      this._emit({ kind: "error", message: String(e && e.message || e) });
    } finally {
      if (!this._respawn) { this._ended = true; if (this._wake) { const w = this._wake; this._wake = null; w(); } }
    }
  }

  async stop() {
    this._ended = true;
    if (this._wake) { const w = this._wake; this._wake = null; w(); }
    try { await this._q?.return?.(); } catch {}
    try { this._q?.interrupt?.(); } catch {}
    this.status = "ended";
  }

  /** Interrupt the CURRENT turn (like Claude Code's stop button) but KEEP the session alive so the
   *  user can immediately send another prompt — unlike stop(), which ends the whole conversation.
   *  The SDK aborts the in-flight turn; a terminal "result" usually follows on the stream and the
   *  main loop resets status to idle + persists whatever completed. We also flip to idle right here
   *  so the web reacts instantly instead of waiting for that. No-op if nothing is running. */
  async interrupt() {
    if (!this._started || this._ended) return false;
    if (this.status !== "thinking" && this.status !== "awaiting-permission" && this.status !== "deepwork") return false;
    try { await this._q?.interrupt?.(); } catch {}
    if (this.status !== "idle" && this.status !== "ended") { this.status = "idle"; this._emit({ kind: "status", status: this.status }); }
    this._emit({ kind: "interrupted" });
    return true;
  }
}
