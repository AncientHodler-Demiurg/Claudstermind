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

/** Distill a raw SDK message into a compact event for the web transcript. */
export function toEvent(msg) {
  if (!msg || typeof msg !== "object") return null;
  if (msg.type === "system" && msg.subtype === "init") return { kind: "init", sessionId: msg.session_id, model: msg.model, cwd: msg.cwd };
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
    if (results.length) return { kind: "tool_result", count: results.length };
    return null;
  }
  if (msg.type === "result") {
    return { kind: "result", subtype: msg.subtype, isError: !!msg.is_error,
      usage: msg.usage || null, costUsd: msg.total_cost_usd ?? null, durationMs: msg.duration_ms ?? null,
      resultText: typeof msg.result === "string" ? msg.result : null };
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
    this.mode = toMode(opts.mode, opts.trusted ? "bypassPermissions" : "default");
    this.token = opts.token;
    this.resume = opts.resume || null;   // resume a saved session by its Claude session id
    this.onEvent = opts.onEvent || (() => {});
    this.onPermission = opts.onPermission || (async () => "deny");
    this.sdkQuery = opts.sdkQuery;
    this.sessionId = null;          // Claude's own session id (for resume/persistence)
    this.usage = emptyUsage();
    this.status = "idle";           // idle | thinking | awaiting-permission | error | ended
    this._inbox = [];               // queued user prompts
    this._wake = null;
    this._q = null;
    this._started = false;
    this._ended = false;
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

  // The async input stream fed to the SDK — yields user messages as they're pushed.
  async *_input() {
    // seed prompt already queued before start()
    while (!this._ended) {
      while (this._inbox.length) {
        const text = this._inbox.shift();
        // A new turn is starting — reflect "thinking" so the web dot lights on every
        // follow-up, not just the first (status is otherwise only reset to idle on result).
        if (this.status !== "thinking") { this.status = "thinking"; this._emit({ kind: "status", status: this.status }); }
        yield { type: "user", message: { role: "user", content: text } };
      }
      if (this._ended) break;
      await new Promise((res) => { this._wake = res; });
    }
  }

  prompt(text) {
    this._inbox.push(text);
    if (this._wake) { const w = this._wake; this._wake = null; w(); }
    return this;
  }

  _emit(event) { try { this.onEvent(this.key, { ...event, sessionKey: this.key }); } catch {} }

  async start() {
    if (this._started) return; this._started = true;
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
      includePartialMessages: false,
      permissionMode: this.mode,
      // The SDK refuses `bypassPermissions` unless the caller opts in explicitly. Sent for
      // every session (not just the ones starting in bypass) because setPermissionMode() can
      // switch INTO bypass later, after this option is no longer changeable.
      allowDangerouslySkipPermissions: true,
      env: this.token ? { ...cleanClaudeEnv(process.env), CLAUDE_CODE_OAUTH_TOKEN: this.token } : cleanClaudeEnv(process.env),
    };
    if (this.model) options.model = this.model;
    if (this.resume) options.resume = this.resume;   // continue a saved conversation with full prior context

    // Real SDK by default; tests inject a mock. Lazy import so the SDK only loads for
    // real sessions, never in unit tests.
    const runQuery = this.sdkQuery || (await import("@anthropic-ai/claude-agent-sdk")).query;

    this.status = "thinking"; this._emit({ kind: "status", status: this.status });
    try {
      this._q = runQuery({ prompt: this._input(), options });
      for await (const msg of this._q) {
        const ev = toEvent(msg);
        if (!ev) continue;
        if (ev.kind === "init") this.sessionId = ev.sessionId;
        if (ev.kind === "result") { addUsage(this.usage, ev.usage, ev.costUsd); this.status = "idle"; }
        this._emit({ ...ev, usageTotal: this.usage });
      }
      this.status = "ended"; this._emit({ kind: "status", status: this.status });
    } catch (e) {
      this.status = "error";
      this._emit({ kind: "error", message: String(e && e.message || e) });
    } finally {
      this._ended = true; if (this._wake) { const w = this._wake; this._wake = null; w(); }
    }
  }

  async stop() {
    this._ended = true;
    if (this._wake) { const w = this._wake; this._wake = null; w(); }
    try { await this._q?.return?.(); } catch {}
    try { this._q?.interrupt?.(); } catch {}
    this.status = "ended";
  }
}
