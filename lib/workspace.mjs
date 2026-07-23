// The bridge-side manager for the remote Claude workspace. Owns the live ClaudeSession
// instances (one per web "session"), routes the tunnel's WS_IN actions to them, streams
// their WS_OUT output back up, and handles workspace management (new folder / new repo,
// list, trusted-mode, delete). Reads the subscription token from .secrets.
//
// Everything here is Node builtins + git + the SDK session — no OS-specific assumptions,
// so it runs the same on the Windows work machine now and the Linux box after migration.
import { join, resolve, sep } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { ClaudeSession, emptyUsage, toMode, isMode } from "./claudeSession.mjs";
import { WS_CONTROL_ACTIONS } from "./protocol.mjs";
import * as store from "./workspaceStore.mjs";
import { listWorktrees, createWorktree, removeWorktree, needsInstall } from "./worktrees.mjs";

const TOKEN_FILE = "claude-oauth-token.txt";
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;   // a new folder/repo name — no separators, no ..

// Same hard cap the HTTP layer enforces on the way in (dashboard/server.mjs and relay/server.mjs's
// readBody). Re-checked HERE, in _saveImage, because a prompt riding the WS tunnel (relay →
// bridge) arrives as an already-parsed `data` object via handleIn() — it never passes through
// either HTTP server's body-read path at all, so THAT cap alone would leave this route
// completely uncapped. Compared against the base64 STRING length (not the decoded bytes), so the
// check runs before Buffer.from ever allocates the decoded buffer.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BASE64_LEN = Math.ceil(MAX_IMAGE_BYTES * 4 / 3);
const TREE_SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", ".turbo", ".vite", ".pnpm-store", "_Archive", ".bee", ".wasp", "iosevka-src"]);

/** Walk the workspace into a nested folder tree, flagging folders that ARE repositories.
 *  A folder is a repository iff it holds a `.iz.md` marker (an explicit, git-ignored opt-in) —
 *  NOT merely a `.git` (which over-counts vendored/embedded/nested checkouts). Bounded depth
 *  + a skip-list keep it cheap and cross-platform (fs/path only). */
export const REPO_MARKER = ".iz.md";

/** Per-repo collected raw-conversation volume from a `.claude/workspace` transcript dir.
 *  Reused by the bridge stream AND the snapshot (so the Brain shows it on both surfaces).
 *  Delegates to the store, which reads both the new per-workspace layout and legacy files. */
export function readDataSizes(transcriptDir) {
  return store.dataSizes(transcriptDir);
}
export function walkTree(dir, name, depth = 0, maxDepth = 5) {
  const node = { name, isRepo: existsSync(join(dir, REPO_MARKER)), children: [] };
  if (depth >= maxDepth) return node;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return node; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".") || TREE_SKIP.has(e.name)) continue;
    node.children.push(walkTree(join(dir, e.name), e.name, depth + 1, maxDepth));
  }
  node.children.sort((a, b) => (b.isRepo - a.isRepo) || a.name.localeCompare(b.name));
  return node;
}

/** The subscription token minted by `claude setup-token`, or null. */
export function readClaudeToken(secretsDir) {
  try { const t = readFileSync(join(secretsDir, TOKEN_FILE), "utf8").trim(); return t || null; }
  catch { return null; }
}

export class WorkspaceManager {
  /**
   * @param {{root, secretsDir, send, sdkQuery?, model?, listRepos?, transcriptDir?}} o
   *   send(kind, sessionKey|null, data)  — push a WS_OUT frame up the tunnel
   *   listRepos() → [{name, localPath, org}]  — the repos the web may target
   */
  constructor(o = {}) {
    this.root = o.root;
    this.secretsDir = o.secretsDir;
    // Pluggable output sinks: every currently-registered sink gets every `send(kind, sessionKey,
    // data)` call, so the same session's events can reach more than one transport (local SSE,
    // the outbound tunnel, …) at once. `o.send` — the historical single hard-wired broadcast —
    // becomes just the first registered sink, so passing exactly one keeps today's behavior
    // byte-identical.
    this._sinks = new Set();
    if (typeof o.send === "function") this.addSink(o.send);
    // Each sink call is individually guarded: a throw from ONE sink (e.g. a dead tunnel socket, a
    // broken SSE write) must never stop delivery to the OTHER sinks, and must never propagate out
    // of `send()` into its caller — `_prompt`'s very first call is `this.send(...)` for the "user"
    // echo, BEFORE it ever dispatches to the SDK (`s.prompt`/`s.start()`); an unguarded throw there
    // would skip the turn entirely. Same swallow-and-continue precedent as the dashboard's own
    // `wsBroadcast`.
    this.send = (kind, sessionKey, data) => {
      for (const fn of this._sinks) { try { fn(kind, sessionKey, data); } catch {} }
    };
    this.sdkQuery = o.sdkQuery;                       // undefined → ClaudeSession uses the real SDK
    this.model = o.model || null;
    this.listRepos = o.listRepos || (() => []);
    this.transcriptDir = o.transcriptDir || (this.root ? join(this.root, ".claude", "workspace") : null);
    this.sessions = new Map();                        // sessionKey → ClaudeSession
    this.pendingPerms = new Map();                    // requestId → resolve
    this.defaultMode = "default";                     // permission mode a NEW session starts in
  }

  /** Legacy alias — `trusted` is now just the bypassPermissions mode. */
  get trustedDefault() { return this.defaultMode === "bypassPermissions"; }

  /** Register an output sink `(kind, sessionKey, data) => void` — every future `send(...)` call
   *  fans out to it, alongside any other currently-registered sinks. */
  addSink(fn) { if (typeof fn === "function") this._sinks.add(fn); }
  /** Unregister a sink previously passed to `addSink` — a no-op if it isn't registered. */
  removeSink(fn) { this._sinks.delete(fn); }

  hasToken() { return !!readClaudeToken(this.secretsDir); }

  /** Resolve a workspace-relative path to an absolute dir, refusing any escape past root. */
  resolveDir(localPath) {
    if (typeof localPath !== "string") return null;
    const r = resolve(this.root);
    const abs = resolve(this.root, localPath.replace(/^_Claude[\\/]/, ""));
    if (abs !== r && !abs.startsWith(r + sep)) return null;
    return abs;
  }

  sessionSummary(s) {
    return { sessionKey: s.key, cwd: s.cwd, repo: s.repoLabel || null, status: s.status,
      worktree: s.worktree || "main", workspaceId: s.workspaceId || (s.repoLabel ? store.workspaceId(s.repoLabel, s.worktree || "main") : null),
      sessionId: s.sessionId, mode: s.mode, trusted: s.trusted, usage: s.usage };
  }

  /** Entry point for a WS_IN frame from the tunnel. */
  handleIn(kind, sessionKey, data = {}) {
    switch (kind) {
      case "prompt": return this._prompt(sessionKey, data || {});
      case "permission": return this._permission(data || {});
      case "stop": return this._stop(sessionKey);
      case "control": return this._control(data || {});
      default: return;
    }
  }

  _prompt(sessionKey, { repo, worktree, text, trusted, mode, model, resume, by: from, image }) {
    if (!sessionKey || !text || !String(text).trim()) return;
    // Each pane carries its OWN mode; `trusted` is the older boolean form of the same thing.
    // Neither given → the workspace default.
    const wanted = isMode(mode) ? mode : (typeof trusted === "boolean" ? toMode(trusted) : null);
    let s = this.sessions.get(sessionKey);
    // A finished/errored session can't accept more input (its SDK query has ended) — drop
    // it so a fresh one starts under the same key instead of silently swallowing the prompt.
    if (s && (s._ended || s.status === "error" || s.status === "ended")) { this._resolvePendingFor(sessionKey, "deny"); this.sessions.delete(sessionKey); s = null; }
    if (!s) {
      const cwd = this.resolveDir(repo);
      if (!cwd || !existsSync(cwd)) return this.send("event", sessionKey, { kind: "error", message: `Not a valid workspace path: ${repo}` });
      const token = readClaudeToken(this.secretsDir);
      if (!token) return this.send("event", sessionKey, { kind: "error", message: "No Claude token on the machine — run `claude setup-token` and save it to .secrets/claude-oauth-token.txt." });
      const workspaceId = store.workspaceId(repo, worktree || "main");
      // Save (and validate) the attached image, if any, BEFORE any session is created or
      // registered — an unrecognized mediaType throws here and the whole prompt attempt fails
      // with nothing partially created: no session in `this.sessions`, no transcript turn, no
      // JSONL record, no stray file.
      const savedImage = image ? this._saveImage(workspaceId, image) : null;
      // Real resume: an explicit `resume` from the caller wins; otherwise, when this workspace
      // has prior recorded turns from ANY past session, seed the SDK's own resume from the
      // latest one automatically — a fresh "new chat" pane must continue Claude's REAL context,
      // not just show a transcript that looks continuous while the model starts blank.
      const resumeId = resume || this._latestWorkspaceRow(workspaceId)?.sessionId || null;
      s = new ClaudeSession({
        key: sessionKey, cwd, token, model: model || this.model,
        resume: resumeId,   // continue a saved conversation with full prior context
        mode: wanted || this.defaultMode,
        sdkQuery: this.sdkQuery,
        onEvent: (key, ev) => this._onEvent(key, ev),
        onPermission: (key, req) => this._ask(key, req),
      });
      s.repoLabel = repo;
      s.worktree = worktree || "main";
      s.workspaceId = workspaceId;
      if (resumeId) s.sessionId = resumeId;
      // Seed the pane's DISPLAYED transcript from the full merged workspace history (every past
      // session file for this repo+worktree, chronological) so what's shown agrees with the
      // context the SDK just resumed; fall back to the sessionKey-scoped read (a same-key
      // restart, e.g. before this key ever had a workspaceId) when the workspace has nothing.
      s.transcript = this.transcriptDir ? store.readWorkspace(this.transcriptDir, workspaceId) : [];
      if (!s.transcript.length) s.transcript = this._readSavedTranscript(sessionKey);
      s._persistedCount = s.transcript.length;
      this.sessions.set(sessionKey, s);
      const turn = { role: "user", text, at: Date.now() };
      if (savedImage) turn.image = savedImage;
      s.transcript.push(turn);
      // Echo the accepted user turn to EVERY subscriber (with the sender id), so a second terminal
      // sharing this session renders the prompt live — not just Claude's reply. The sender skips
      // its own echo via `by`.
      this.send("event", sessionKey, { kind: "user", text, at: turn.at, by: from || null });
      s.prompt(text, image);
      s.start();
      this.send("state", sessionKey, { session: this.sessionSummary(s) });
    } else {
      // Single-writer turn lock. A Claude session is turn-based: it can only work one prompt at
      // a time. With two terminals on the same session, a second prompt sent mid-turn would
      // interleave into the same agent. Refuse it with a `busy` event instead — the sender's
      // terminal shows "working…" rather than silently queueing behind someone else's turn.
      if (s.status === "thinking" || s.status === "awaiting-permission") {
        return this.send("event", sessionKey, { kind: "busy", status: s.status,
          message: "This workspace is working on a turn. Wait for it to finish before sending another prompt." });
      }
      if (wanted) s.setMode(wanted);
      // Same nothing-partial guarantee as the new-session path above: a bad mediaType throws here,
      // before the turn is pushed or the session's prompt() is called.
      const savedImage = image ? this._saveImage(s.workspaceId, image) : null;
      const turn = { role: "user", text, at: Date.now() };
      if (savedImage) turn.image = savedImage;
      s.transcript.push(turn);
      this.send("event", sessionKey, { kind: "user", text, at: turn.at, by: from || null });
      s.prompt(text, image);
      this.send("state", sessionKey, { session: this.sessionSummary(s) });
    }
  }

  /** Decode + persist an attached image (`{ mediaType, base64Data }`, base64 STRING as it arrives
   *  over the wire) via the store, returning the compact reference a JSONL turn keeps (`{ path,
   *  hash, mediaType }`) — never the raw base64. An oversized base64Data is rejected BEFORE
   *  Buffer.from ever decodes it (the HTTP layer's size cap never runs for a prompt arriving over
   *  the WS tunnel — see MAX_IMAGE_BYTES above). Bad/unrecognized mediaType propagates
   *  `store.saveImage`'s rejection untouched, with nothing written. */
  _saveImage(workspaceId, image) {
    if (typeof image.base64Data === "string" && image.base64Data.length > MAX_IMAGE_BASE64_LEN) {
      throw new Error(`_saveImage: image exceeds the ${MAX_IMAGE_BYTES}-byte cap`);
    }
    const buffer = Buffer.from(image.base64Data, "base64");
    const { path, hash } = store.saveImage(this.transcriptDir, workspaceId, buffer, image.mediaType);
    return { path, hash, mediaType: image.mediaType };
  }

  _onEvent(sessionKey, ev) {
    const s = this.sessions.get(sessionKey);
    if (s) {
      if (ev.kind === "assistant" && ev.text) s.transcript?.push({ role: "assistant", text: ev.text, at: Date.now() });
      if (ev.kind === "result") this._persist(s);
    }
    this.send("event", sessionKey, ev);
  }

  _ask(sessionKey, req) {
    return new Promise((resolvePerm) => {
      this.pendingPerms.set(req.requestId, { resolve: resolvePerm, sessionKey });
      this.send("permission", sessionKey, { requestId: req.requestId, tool: req.tool, input: req.input });
    });
  }
  _permission({ requestId, decision }) {
    const r = this.pendingPerms.get(requestId);
    if (r) { this.pendingPerms.delete(requestId); r.resolve(decision === "allow" ? "allow" : "deny"); }
  }
  /** Settle (default-deny) any permission prompts still awaiting for a session, so their
   *  resolvers never leak when the session is stopped/deleted/ended mid-prompt. */
  _resolvePendingFor(sessionKey, decision = "deny") {
    for (const [id, p] of this.pendingPerms) {
      if (p.sessionKey === sessionKey) { this.pendingPerms.delete(id); try { p.resolve(decision); } catch {} }
    }
  }

  async _stop(sessionKey) {
    const s = this.sessions.get(sessionKey);
    // Settle pending permissions FIRST: stop() awaits the SDK query's teardown, which is
    // itself blocked inside canUseTool waiting on the web decision — resolve (deny) it so
    // the query can unwind, otherwise stop() deadlocks.
    if (s) { this._resolvePendingFor(sessionKey, "deny"); await s.stop(); this._persist(s); this.send("state", sessionKey, { session: this.sessionSummary(s) }); }
  }

  _control({ action, args = {} }) {
    if (!WS_CONTROL_ACTIONS.includes(action)) return;
    switch (action) {
      case "setTrusted": return this._setMode({ mode: toMode(!!args.value) });
      case "setMode": return this._setMode(args);
      case "list": return this._sendList();
      case "delete": {
        for (const key of [].concat(args.sessionKeys || args.sessionKey || [])) {
          const s = this.sessions.get(key);
          if (!s) continue;
          this._resolvePendingFor(key, "deny");
          try { s.stop(); } catch {}
          this._persist(s);   // turns since the last result would otherwise be lost with the session
          this.sessions.delete(key);
        }
        return this._sendList();
      }
      case "newFolder": return this._create("newFolder", args);
      case "newRepo": return this._create("newRepo", args);
      case "tree": return this._sendTree();
      case "history": return this._sendHistory(args.repo);
      case "open": return this._openTranscript(args.sessionKey);
      case "dataSizes": return this._sendDataSizes();
      case "search": return this._sendSearch(args.query, args.repo);
      case "workspacesOn": return this._sendWorkspacesOn(args.repo);
      case "worktrees": return this._sendWorktrees(args.repo);
      case "worktreeAdd": return this._worktreeAdd(args.repo, args.name);
      case "worktreeRemove": return this._worktreeRemove(args.repo, args.name);
      default: return;
    }
  }

  /** Set the permission mode for ONE session (`sessionKey`) or, with no key, the workspace
   *  default — which also re-modes every live session, the old global-toggle behaviour. */
  _setMode({ sessionKey, mode }) {
    if (!isMode(mode)) return;
    if (sessionKey) this.sessions.get(sessionKey)?.setMode(mode);
    else { this.defaultMode = mode; for (const s of this.sessions.values()) s.setMode(mode); }
    return this._sendList();
  }

  /** The workspaces LIVE on a given repo right now — one per distinct worktree with an active
   *  session. This is what lets a second terminal ask "what's already running on Mnemosyne?"
   *  and choose to join one or start a new worktree, instead of blindly starting a disconnected
   *  session. Grouped by worktree; each entry names the session key a terminal would attach to. */
  _sendWorkspacesOn(repo) {
    const live = [];
    for (const s of this.sessions.values()) {
      if (repo && s.repoLabel !== repo) continue;
      live.push({
        workspaceId: s.workspaceId || (s.repoLabel ? store.workspaceId(s.repoLabel, s.worktree || "main") : null),
        repo: s.repoLabel || null, worktree: s.worktree || "main",
        sessionKey: s.key, status: s.status, mode: s.mode,
      });
    }
    this.send("state", null, { workspacesOn: live, workspacesOnRepo: repo || null });
  }

  /** The checkouts of a repo — main plus any worktrees — each flagged if it still needs an
   *  `npm install` before its dev server can run. This is what backs "start a new worktree". */
  _sendWorktrees(repo) {
    const list = (listWorktrees(this.root, repo) || []).map((w) => ({
      name: w.name, branch: w.branch || null, isMain: !!w.isMain,
      needsInstall: needsInstall(w.path),
    }));
    this.send("state", null, { worktrees: list, worktreesRepo: repo || null });
  }

  _worktreeAdd(repo, name) {
    const r = createWorktree(this.root, repo, name);
    if (!r.ok) return this.send("event", null, { kind: "error", message: r.error || "Could not create the worktree." });
    this.send("event", null, { kind: "created", what: "worktree", path: `${repo}@${name}` });
    // A fresh worktree usually can't run its dev server until dependencies are installed — say so
    // rather than auto-installing (a Next.js install is minutes).
    if (needsInstall(r.dir)) this.send("event", null, { kind: "note", message: `Worktree "${name}" created — run \`npm install\` in it before its dev server will start.` });
    this._sendWorktrees(repo);
  }

  _worktreeRemove(repo, name) {
    const r = removeWorktree(this.root, repo, name);
    if (!r.ok) return this.send("event", null, { kind: "error", message: r.error || "Could not remove the worktree." });
    this.send("event", null, { kind: "removed", what: "worktree", path: `${repo}@${name}` });
    this._sendWorktrees(repo);
  }

  _sendTree() {
    const root = resolve(this.root);
    const tree = walkTree(root, (root.split(/[\\/]/).filter(Boolean).pop() || "workspace"), 0);
    this.send("state", null, { tree });
  }

  /** Per-repo collected raw-conversation volume — the learning-loop substrate accumulated so far.
   *  Aggregates every saved transcript under `.claude/workspace/` by repo. */
  _sendDataSizes() { this.send("state", null, { dataSizes: readDataSizes(this.transcriptDir) }); }

  /** Full-text search across saved conversations (optionally one repo). Returns matches with a
   *  snippet around the first hit, so history is findable, not just listable. */
  _sendSearch(query, repo) {
    const out = store.searchSessions(this.transcriptDir, query, repo || null);
    this.send("state", null, { search: out, searchQuery: query || "" });
  }

  /** The saved raw transcript for one session key (empty if none / unreadable). Reads the new
   *  per-workspace store first, then the legacy flat file — so a same-key restart keeps history. */
  _readSavedTranscript(key) {
    if (!this.transcriptDir) return [];
    const found = store.findSession(this.transcriptDir, key);
    if (found && Array.isArray(found.transcript)) {
      // Drop store bookkeeping fields from replayed turns; keep only conversation content.
      return found.transcript.map(({ workspaceId, ...turn }) => turn);
    }
    return [];
  }

  /** One row per WORKSPACE (repo+worktree), newest first — every past session file for that
   *  workspace aggregated into a single summary — so a "new chat" on a worktree that already has
   *  history doesn't show up as a second, disconnected-looking row. */
  _sendHistory(repo) {
    const rows = store.listWorkspaces(this.transcriptDir);
    const out = repo ? rows.filter((w) => w.repo === repo) : rows;
    this.send("state", null, { history: out, historyRepo: repo || null });
  }

  /** The most-recently-updated recorded row for a workspace id, or null when it has no saved
   *  history yet. Used to auto-seed `options.resume` for a fresh pane. */
  _latestWorkspaceRow(workspaceId) {
    if (!this.transcriptDir) return null;
    return store.listWorkspaces(this.transcriptDir).find((w) => w.workspaceId === workspaceId) || null;
  }

  /** Stream the FULL merged conversation for a workspace back — every past session file for that
   *  workspace, oldest to newest — for read-only viewing or pane reattachment. `sessionKey` may be
   *  a workspace id (what history rows now carry, one row per workspace) or a legacy/per-session
   *  key (an already-open pane's saved key, or a pre-grouping single-file save); either form
   *  resolves to its workspace id before reading, so "Reopen" always shows the whole conversation,
   *  not just the one file whose name happens to match the requested key. */
  _openTranscript(sessionKey) {
    const direct = this._latestWorkspaceRow(sessionKey);           // sessionKey IS a workspace id
    const bySession = direct ? null : store.findSession(this.transcriptDir, sessionKey);
    const workspaceId = direct ? sessionKey : bySession?.workspaceId;
    // Echo the ORIGINALLY-REQUESTED sessionKey back on the not-found path too — the client
    // correlates this reply against its pendingOpens map by that key; sending null there leaks
    // the pending entry instead of resolving it.
    if (!workspaceId) return this.send("event", sessionKey, { kind: "error", message: "That conversation could not be opened." });
    const row = direct || this._latestWorkspaceRow(workspaceId);
    const { repo, worktree } = store.parseWorkspaceId(workspaceId);
    // Strip store bookkeeping from replayed turns; keep only conversation content.
    const transcript = (this.transcriptDir ? store.readWorkspace(this.transcriptDir, workspaceId) : [])
      .map(({ workspaceId: _w, ...turn }) => turn);
    this.send("transcript", sessionKey, { sessionKey, sessionId: row?.sessionId ?? bySession?.sessionId ?? null,
      repo: row?.repo ?? repo, worktree: row?.worktree ?? worktree, workspaceId, usage: bySession?.usage ?? null, transcript });
  }

  _sendList() {
    this.send("state", null, {
      repos: this.listRepos(),
      sessions: [...this.sessions.values()].map((s) => this.sessionSummary(s)),
      defaultMode: this.defaultMode,
      trustedDefault: this.trustedDefault,
      hasToken: this.hasToken(),
    });
  }

  _create(action, { parent, name }) {
    if (!SAFE_NAME.test(name || "") || name === "." || name === "..") return this.send("event", null, { kind: "error", message: "Invalid name — letters, digits, . _ - only (not . or ..)." });
    const parentAbs = parent ? this.resolveDir(parent) : resolve(this.root);
    if (!parentAbs || !existsSync(parentAbs)) return this.send("event", null, { kind: "error", message: "Invalid parent folder." });
    const abs = join(parentAbs, name);
    // Re-assert containment on the FINAL path — the write site must never trust that the
    // name check alone kept it under the root.
    const r = resolve(this.root);
    if (abs !== r && !abs.startsWith(r + sep)) return this.send("event", null, { kind: "error", message: "Refused — path escapes the workspace." });
    if (existsSync(abs)) return this.send("event", null, { kind: "error", message: `"${name}" already exists.` });
    try {
      mkdirSync(abs, { recursive: true });
      if (action === "newRepo") {
        const g = spawnSync("git", ["-C", abs, "init"], { encoding: "utf8", windowsHide: true });
        if (g.status !== 0) return this.send("event", null, { kind: "error", message: `git init failed: ${(g.stderr || "").slice(-160)}` });
        // Mark it a repository (the `.iz.md` opt-in) and git-ignore the marker locally so it
        // never shows in git status.
        try { writeFileSync(join(abs, REPO_MARKER), ""); } catch {}
        try { const ex = join(abs, ".git", "info", "exclude"); const cur = existsSync(ex) ? readFileSync(ex, "utf8") : ""; if (!cur.split(/\r?\n/).includes(REPO_MARKER)) writeFileSync(ex, cur + (cur.endsWith("\n") || !cur ? "" : "\n") + REPO_MARKER + "\n"); } catch {}
      }
      const rel = abs.slice(resolve(this.root).length + 1).replace(/\\/g, "/");
      this.send("event", null, { kind: "created", what: action === "newRepo" ? "repo" : "folder", path: rel });
      this._sendTree(); this._sendList();
    } catch (e) { this.send("event", null, { kind: "error", message: `Create failed: ${e.message}` }); }
  }

  /** Append the turns added since the last persist to this workspace's JSONL — append-only, so a
   *  crash mid-write loses at most one line, and cost no longer grows with conversation length.
   *  Raw history per repo/worktree is the durable substrate the distillation phase mines. */
  _persist(s) {
    if (!this.transcriptDir || !s.workspaceId) return;
    const from = s._persistedCount || 0;
    const pending = (s.transcript || []).slice(from);
    if (!pending.length) return;
    for (const turn of pending) {
      // The file is still named/keyed by `s.key` (the pane's lookup key) — findSession/the
      // same-key-restart path depend on that and the layout stays untouched by design. But `s.key`
      // is NOT Claude's own session id, so also stamp the REAL SDK id (captured from the `init`
      // event, on `s.sessionId`) once known — listWorkspaces reads this back out for resume, so a
      // fresh pane's `options.resume` is seeded with an id the SDK actually issued, not a lookup
      // key it never saw. Absent for turns persisted before any `init` (rare) or by pre-fix files —
      // listWorkspaces falls back to the file-derived id in that case, never crashes.
      store.appendTurn(this.transcriptDir, s.workspaceId, s.key, { ...turn, workspaceId: s.workspaceId, realSessionId: s.sessionId || null });
    }
    s._persistedCount = (s.transcript || []).length;
  }
}
