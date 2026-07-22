// The bridge-side manager for the remote Claude workspace. Owns the live ClaudeSession
// instances (one per web "session"), routes the tunnel's WS_IN actions to them, streams
// their WS_OUT output back up, and handles workspace management (new folder / new repo,
// list, trusted-mode, delete). Reads the subscription token from .secrets.
//
// Everything here is Node builtins + git + the SDK session — no OS-specific assumptions,
// so it runs the same on the Windows work machine now and the Linux box after migration.
import { join, resolve, sep } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { ClaudeSession, emptyUsage, toMode, isMode } from "./claudeSession.mjs";
import { WS_CONTROL_ACTIONS } from "./protocol.mjs";

const TOKEN_FILE = "claude-oauth-token.txt";
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;   // a new folder/repo name — no separators, no ..
const TREE_SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", ".turbo", ".vite", ".pnpm-store", "_Archive", ".bee", ".wasp", "iosevka-src"]);

/** Walk the workspace into a nested folder tree, flagging folders that ARE repositories.
 *  A folder is a repository iff it holds a `.iz.md` marker (an explicit, git-ignored opt-in) —
 *  NOT merely a `.git` (which over-counts vendored/embedded/nested checkouts). Bounded depth
 *  + a skip-list keep it cheap and cross-platform (fs/path only). */
export const REPO_MARKER = ".iz.md";

/** Per-repo collected raw-conversation volume from a `.claude/workspace` transcript dir.
 *  Pure + reused by the bridge stream AND the snapshot (so the Brain shows it on both surfaces). */
export function readDataSizes(transcriptDir) {
  const by = new Map();
  let files = [];
  try { files = readdirSync(transcriptDir); } catch { return []; }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = readFileSync(join(transcriptDir, f), "utf8");
      const t = JSON.parse(raw);
      const repo = t.repo || "(unknown)";
      const rec = by.get(repo) || { repo, bytes: 0, conversations: 0, turns: 0 };
      rec.bytes += Buffer.byteLength(raw, "utf8");
      rec.conversations += 1;
      rec.turns += t.usage?.turns || (t.transcript || []).filter((m) => m && m.role === "user").length || 0;
      by.set(repo, rec);
    } catch { continue; }
  }
  return [...by.values()];
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
    this.send = o.send || (() => {});
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

  _prompt(sessionKey, { repo, text, trusted, mode, model, resume }) {
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
      s = new ClaudeSession({
        key: sessionKey, cwd, token, model: model || this.model,
        resume: resume || null,   // continue a saved conversation with full prior context
        mode: wanted || this.defaultMode,
        sdkQuery: this.sdkQuery,
        onEvent: (key, ev) => this._onEvent(key, ev),
        onPermission: (key, req) => this._ask(key, req),
      });
      s.repoLabel = repo;
      if (resume) s.sessionId = resume;
      // Seed from any saved transcript under this key so a restarted/continued session keeps
      // its prior turns — persist overwrites `${key}.json`, so starting empty would erase the
      // full raw history (the learning-loop substrate) on every same-key restart.
      s.transcript = this._readSavedTranscript(sessionKey);
      this.sessions.set(sessionKey, s);
      s.transcript.push({ role: "user", text, at: Date.now() });
      s.prompt(text);
      s.start();
      this.send("state", sessionKey, { session: this.sessionSummary(s) });
    } else {
      if (wanted) s.setMode(wanted);
      s.transcript.push({ role: "user", text, at: Date.now() });
      s.prompt(text);
      this.send("state", sessionKey, { session: this.sessionSummary(s) });
    }
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
    const q = String(query || "").trim().toLowerCase();
    const out = [];
    if (q) {
      let files = [];
      try { files = readdirSync(this.transcriptDir); } catch { files = []; }
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        try {
          const t = JSON.parse(readFileSync(join(this.transcriptDir, f), "utf8"));
          if (repo && t.repo !== repo) continue;
          const text = (t.transcript || []).map((m) => (m && m.text) || "").join("\n");
          const at = text.toLowerCase().indexOf(q);
          if (at === -1) continue;
          let matchCount = 0; for (let i = 0; (i = text.toLowerCase().indexOf(q, i)) !== -1; i += q.length) matchCount++;
          const snippet = text.slice(Math.max(0, at - 40), at + q.length + 60).replace(/\s+/g, " ").trim();
          const first = (t.transcript || []).find((m) => m && m.role === "user");
          out.push({ sessionKey: t.sessionKey, sessionId: t.sessionId || null, repo: t.repo || null,
            updatedAt: t.updatedAt || null, matchCount, snippet, firstPrompt: first ? String(first.text).slice(0, 100) : "" });
        } catch { continue; }
      }
      out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }
    this.send("state", null, { search: out, searchQuery: query || "" });
  }

  /** The saved raw transcript for one session key (empty if none / unreadable). */
  _readSavedTranscript(key) {
    if (!this.transcriptDir) return [];
    try {
      const safe = String(key).replace(/[^a-zA-Z0-9_-]/g, "_");
      const t = JSON.parse(readFileSync(join(this.transcriptDir, `${safe}.json`), "utf8"));
      return Array.isArray(t.transcript) ? t.transcript : [];
    } catch { return []; }
  }

  /** Read the saved transcripts, newest first, as compact summaries (optionally one repo). */
  _sendHistory(repo) {
    const out = [];
    let files = [];
    try { files = readdirSync(this.transcriptDir); } catch { files = []; /* no history dir yet */ }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      // Per-file guard covers BOTH a corrupt/partial file (parse throws) and a structurally
      // odd one (e.g. a null transcript entry) — one bad file must not abort the whole listing.
      try {
        const t = JSON.parse(readFileSync(join(this.transcriptDir, f), "utf8"));
        if (repo && t.repo !== repo) continue;
        const first = (t.transcript || []).find((m) => m && m.role === "user");
        out.push({ sessionKey: t.sessionKey, sessionId: t.sessionId || null, repo: t.repo || null,
          updatedAt: t.updatedAt || null, turns: t.usage?.turns || 0, usage: t.usage || null,
          firstPrompt: first ? String(first.text).slice(0, 120) : "" });
      } catch { continue; }
    }
    out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    this.send("state", null, { history: out, historyRepo: repo || null });
  }

  /** Stream one saved conversation's full raw transcript back for read-only viewing. */
  _openTranscript(sessionKey) {
    const safe = String(sessionKey || "").replace(/[^a-zA-Z0-9_-]/g, "_");
    try {
      const t = JSON.parse(readFileSync(join(this.transcriptDir, `${safe}.json`), "utf8"));
      this.send("transcript", sessionKey, { sessionKey: t.sessionKey, sessionId: t.sessionId, repo: t.repo, usage: t.usage, transcript: t.transcript || [] });
    } catch { this.send("event", null, { kind: "error", message: "That conversation could not be opened." }); }
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

  /** Persist the FULL raw transcript + usage so the web can list, reopen, and resume a
   *  conversation — and so a later learning loop has the complete substrate. Not pruned:
   *  raw history per repo is the durable data the distillation phase will mine. */
  _persist(s) {
    if (!this.transcriptDir) return;
    if (!s.transcript?.length) return;   // never leave an empty shell in History (delete can fire before any turn)
    try {
      if (!existsSync(this.transcriptDir)) mkdirSync(this.transcriptDir, { recursive: true });
      const safe = String(s.key).replace(/[^a-zA-Z0-9_-]/g, "_");
      writeFileSync(join(this.transcriptDir, `${safe}.json`), JSON.stringify({
        sessionKey: s.key, sessionId: s.sessionId, repo: s.repoLabel, cwd: s.cwd,
        usage: s.usage, updatedAt: Date.now(), transcript: s.transcript || [],
      }, null, 0));
    } catch { /* history is best-effort */ }
  }
}
