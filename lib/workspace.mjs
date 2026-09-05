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
import { randomUUID } from "node:crypto";
import { ClaudeSession, emptyUsage, toMode, isMode } from "./claudeSession.mjs";
import { WS_CONTROL_ACTIONS } from "./protocol.mjs";
import { readClaudeKeys, keyFingerprint, usageExhaustion, pickActiveKeyIndex } from "./claudeKeys.mjs";
import * as store from "./workspaceStore.mjs";
import { listWorktrees, createWorktree, removeWorktree, needsInstall, resolveWorktreeDir } from "./worktrees.mjs";
import { omniModelChoices, fetchOmniModels, omniProviderOf } from "./omniRoute.mjs";
import { windowTail, windowAround } from "./conversationWindow.mjs";
import { shapeContextUsage } from "./contextUsage.mjs";
import { conversationStats, shouldRoll, splitForRoll, buildSeedText, segmentRef, ROLL_DEFAULTS } from "./conversationRoll.mjs";
import { archiveSegment, migrateLegacyRootSegments, readIndex, recallByNumber, recallByQuery, SEG_DIR } from "./conversationArchive.mjs";

const TOKEN_FILE = "claude-oauth-token.txt";
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;   // a new folder/repo name — no separators, no ..

// How many trailing transcript messages a resync/open sends by DEFAULT. The web only renders the last
// ~20 turns (WS_TURN_RENDER_CAP), so shipping a whole multi-hundred-KB history on every reload/reconnect
// just to show the tail is what makes a big conversation take 5–20s to appear on a mobile connection. Send
// the tail; the client fetches the rest (`full: true`) only when the reader clicks "Show earlier".
const WS_RESYNC_MSG_CAP = 250;
// Cap a transcript to its last WS_RESYNC_MSG_CAP messages unless `full`; report whether it was truncated
// (so the client knows there's more to fetch) and the true total. Also report `promptOffset` /
// `responseOffset` — how many user / assistant messages precede the returned window — so the client can label
// every prompt/response with its ABSOLUTE position (P#/R#) in the whole conversation, counting the ones that
// weren't shipped. 0/0 when nothing was withheld.
function capTranscript(transcript, full, limit, around) {
  const arr = transcript || [];
  if (full) return { transcript: arr, transcriptTruncated: false, transcriptTotal: arr.length, promptOffset: 0, responseOffset: 0 };
  // `around` (a row index) → a BAND centered there (jump-to-#N without loading the whole history). Otherwise
  // `limit` → the last N rows (the "Show earlier" growing tail). Both delegate to the shared, unit-tested
  // conversationWindow module so Core, Pact (and later DMP) window identically.
  if (typeof around === "number" && around >= 0) {
    const w = windowAround(arr, around, { before: WS_RESYNC_MSG_CAP, after: WS_RESYNC_MSG_CAP });
    return { transcript: w.transcript, transcriptTruncated: w.truncatedBefore || w.truncatedAfter, transcriptTotal: w.total, promptOffset: w.promptOffset, responseOffset: w.responseOffset, windowStart: w.start, windowEnd: w.end };
  }
  const n = (typeof limit === "number" && limit > 0) ? Math.floor(limit) : WS_RESYNC_MSG_CAP;
  const w = windowTail(arr, n);
  return { transcript: w.transcript, transcriptTruncated: w.truncatedBefore, transcriptTotal: w.total, promptOffset: w.promptOffset, responseOffset: w.responseOffset };
}

// Same hard cap the HTTP layer enforces on the way in (dashboard/server.mjs and relay/server.mjs's
// readBody). Re-checked HERE, in _saveImage, because a prompt riding the WS tunnel (relay →
// bridge) arrives as an already-parsed `data` object via handleIn() — it never passes through
// either HTTP server's body-read path at all, so THAT cap alone would leave this route
// completely uncapped. Compared against the base64 STRING length (not the decoded bytes), so the
// check runs before Buffer.from ever allocates the decoded buffer.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BASE64_LEN = Math.ceil(MAX_IMAGE_BYTES * 4 / 3);
// Matches Claude Code's own attachment limit — checked here too (not just the client's own cap
// on how many it lets you pick) since a prompt riding the WS tunnel skips the client entirely.
const MAX_IMAGES_PER_PROMPT = 5;
// A prompt accepted this soon after a "deepwork" phase ended is landing right as that backgrounded
// activity was wrapping up — real chance its own leftover output is still in flight and arrives
// interleaved with (or instead of) a reply to THIS new prompt. Reported directly: the busy
// indicator briefly showed idle, a prompt was sent and accepted, then more unrelated-looking
// output arrived and the sent prompt seemed to vanish. Flagged for the web (turn.deepWorkRisk),
// not silently treated as an ordinary turn — see ClaudeSession's _lastDeepWorkEndedAt.
const DEEP_WORK_RISK_GRACE_MS = 10_000;
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
    this._modelsCache = null;                         // last successful models list — see _models()
    // Multi-key OAuth: last-known plan usage per key NAME → { limits, exhaustedUntil, at }. Drives the
    // automatic fall-through to the next key when one's 5h/weekly limit runs out (see _activeKey/_prompt).
    this._keyUsage = {};
  }

  /** The OAuth key a NEW session should run under: the first key that isn't currently exhausted (5h or
   *  weekly limit hit, until its reset). This is the automatic failover — a fresh turn lands on the next
   *  usable account. null when no keys are configured. */
  _activeKey() {
    const keys = readClaudeKeys(this.secretsDir);
    if (!keys.length) return null;
    const i = pickActiveKeyIndex(keys, this._keyUsage, Date.now());
    return i >= 0 ? keys[i] : null;
  }

  /** Legacy alias — `trusted` is now just the bypassPermissions mode. */
  get trustedDefault() { return this.defaultMode === "bypassPermissions"; }

  /** Register an output sink `(kind, sessionKey, data) => void` — every future `send(...)` call
   *  fans out to it, alongside any other currently-registered sinks. */
  addSink(fn) { if (typeof fn === "function") this._sinks.add(fn); }
  /** Unregister a sink previously passed to `addSink` — a no-op if it isn't registered. */
  removeSink(fn) { this._sinks.delete(fn); }

  hasToken() { return readClaudeKeys(this.secretsDir).length > 0 || !!readClaudeToken(this.secretsDir); }

  /** The `{ token, keyName }` a NEW session should run under — same resolution _prompt uses (the first
   *  non-exhausted multi-key entry, falling back to the legacy single-token file). Pulled out so a caller
   *  that needs a token WITHOUT going through _prompt's full repo/worktree machinery (the OmniRoute model
   *  test tool — see testModel below) doesn't have to duplicate the failover logic. `token` is null when
   *  the machine has none configured at all. */
  activeTokenInfo() {
    const activeKey = this._activeKey();
    return { token: activeKey ? activeKey.token : readClaudeToken(this.secretsDir), keyName: activeKey ? activeKey.name : null };
  }

  /** Resolve a workspace-relative path to an absolute dir, refusing any escape past root. */
  resolveDir(localPath) {
    if (typeof localPath !== "string") return null;
    const r = resolve(this.root);
    const abs = resolve(this.root, localPath.replace(/^_Claude[\\/]/, ""));
    if (abs !== r && !abs.startsWith(r + sep)) return null;
    return abs;
  }

  sessionSummary(s) {
    const bg = s.backgroundTasks ? [...s.backgroundTasks.values()] : [];
    return { sessionKey: s.key, cwd: s.cwd, repo: s.repoLabel || null, status: s.status,
      worktree: s.worktree || "main", workspaceId: s.workspaceId || (s.repoLabel ? store.workspaceId(s.repoLabel, s.worktree || "main") : null),
      sessionId: s.sessionId, mode: s.mode, trusted: s.trusted, usage: s.usage,
      // Authoritative turn timing so a reloaded / re-entered client shows REAL elapsed + REAL silence, not a
      // clock restarted from when it re-noticed the busy state (see claudeSession turnStartedAt/lastActivityAt).
      turnStartedAt: s.turnStartedAt ?? null, lastActivityAt: s.lastActivityAt ?? null,
      // Agent-spawned background work running independently of the chat turn — so a reconnecting /
      // not-locally-open client still sees "hidden work is running" (see claudeSession.mjs).
      // `background` stays the RAW live array every existing client already reads; `backgroundPanel`
      // is the shaped panel model (count / running / per-agent label+elapsed+tokens / fleet total)
      // the background-agents panel renders from. Additive on purpose — changing `background`'s type
      // would break the current renderers.
      backgroundCount: bg.length, background: bg,
      backgroundPanel: typeof s.backgroundPanel === "function" ? s.backgroundPanel() : null };
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

  _prompt(sessionKey, { repo, worktree, text, trusted, mode, model, effort, fastMode, resume, fresh, scoped, by: from, image, images }) {
    if (!sessionKey || !text || !String(text).trim()) return;
    // Each pane carries its OWN mode; `trusted` is the older boolean form of the same thing.
    // Neither given → the workspace default.
    const wanted = isMode(mode) ? mode : (typeof trusted === "boolean" ? toMode(trusted) : null);
    // `images` (an array, up to MAX_IMAGES_PER_PROMPT) is the current shape; the older singular
    // `image` field still works too — normalized to a one-item array — since it costs nothing to
    // keep accepting it and every existing caller/test uses it.
    const imgs = (Array.isArray(images) ? images : (images ? [images] : (image ? [image] : []))).filter(Boolean);
    if (imgs.length > MAX_IMAGES_PER_PROMPT) {
      return this.send("event", sessionKey, { kind: "error",
        message: `Too many images attached (${imgs.length}) — up to ${MAX_IMAGES_PER_PROMPT} per message.` });
    }
    let s = this.sessions.get(sessionKey);
    // A finished/errored session can't accept more input (its SDK query has ended) — drop
    // it so a fresh one starts under the same key instead of silently swallowing the prompt.
    if (s && (s._ended || s.status === "error" || s.status === "ended")) { this._resolvePendingFor(sessionKey, "deny"); this.sessions.delete(sessionKey); s = null; }
    // A live session still pinned to a worktree that was REMOVED out-of-band (e.g. merged + deleted by another
    // agent, so the dashboard's own worktree-remove cleanup never ran), or a tab that MIGRATED to a different
    // worktree, keeps its ORIGINAL cwd. Reusing it would launch claude in a checkout that no longer exists
    // ("Path … does not exist") or the wrong one. When the caller now wants a different worktree than where
    // this IDLE session runs, or that session's cwd has vanished, retire it so the new-session path below
    // re-resolves the correct cwd and continues the conversation there — exactly as migrating a not-yet-live
    // tab already does. (A BUSY turn is left alone; it's refused with `busy` in the existing-session branch.)
    if (s && !s._ended && s.status !== "thinking" && s.status !== "awaiting-permission" && s.status !== "deepwork"
        && ((worktree || "main") !== (s.worktree || "main") || (s.cwd && !existsSync(s.cwd)))) {
      this._resolvePendingFor(sessionKey, "deny");
      try { s.stop(); } catch {}
      this.sessions.delete(sessionKey);
      s = null;
    }
    if (!s) {
      // A named (non-main) worktree runs in ITS OWN checkout under .worktrees/, never the main
      // repo directory — resolveWorktreeDir refuses to silently fall back to main for a missing/
      // removed worktree, because doing so would defeat the entire point of an isolated worktree
      // (this used to be exactly the bug: cwd resolution ignored `worktree` and every worktree
      // pane actually ran in the main checkout the whole time, unnoticed because the conversation
      // history — grouped by repo+worktree — still LOOKED correctly separated).
      const cwd = resolveWorktreeDir(this.root, repo, worktree);
      if (!cwd || !existsSync(cwd)) {
        const label = worktree && worktree !== "main" ? `${repo}@${worktree}` : repo;
        const message = worktree && worktree !== "main"
          ? `Worktree "${worktree}" not found for ${repo} — it may have been removed. Pick "main" or create a new worktree.`
          : `Not a valid workspace path: ${label}`;
        return this.send("event", sessionKey, { kind: "error", message });
      }
      // Run under the active OAuth key (multi-key failover: the first non-exhausted key). Fall back to
      // the legacy single-token file if no key store exists. Tag the session with the key's name so its
      // usage lands on the right account in _usageLimits.
      const activeKey = this._activeKey();
      const token = activeKey ? activeKey.token : readClaudeToken(this.secretsDir);
      const keyName = activeKey ? activeKey.name : null;
      if (!token) return this.send("event", sessionKey, { kind: "error", message: "No Claude token on the machine — run `claude setup-token` and save it to .secrets/claude-oauth-token.txt (or add keys to .secrets/claude-oauth-keys.csv)." });
      // A Pact chat (scoped) is ONE continuous conversation identified by its session key; migrating it to a
      // worktree changes only WHERE ITS AGENT RUNS (the cwd resolved above), never where its history is
      // stored. Persisting under repo@<worktree> instead SPLIT a migrated conversation's saved turns across
      // repo@main (pre-migration) and repo@<worktree> (post-migration) — same key, two files — which
      // findSession/resync can't reunite, so a tab that lost its binding fell back to showing only the
      // pre-migration half (the "my migrated tabs reverted" bug). Keep scoped persistence at the canonical
      // repo@main; a Core pane keeps repo@<worktree> as its actual conversation identity.
      const workspaceId = scoped ? store.workspaceId(repo, "main") : store.workspaceId(repo, worktree || "main");
      // Save (and validate) the attached images, if any, BEFORE any session is created or
      // registered — an unrecognized mediaType (in ANY of them) throws here and the whole prompt
      // attempt fails with nothing partially created: no session in `this.sessions`, no
      // transcript turn, no JSONL record, no stray file — not even for images earlier in the
      // batch than the bad one (see `_saveImages`'s validate-before-writing-any pass).
      const savedImages = imgs.length ? this._saveImages(workspaceId, imgs) : [];
      // Auto-resume when the caller sent no explicit `resume` and this isn't a brand-new (`fresh`) turn.
      // The rule depends on the surface, and is the STRUCTURAL fix for "SWP answered as Master":
      //   • `scoped` (a Pact chat tab — MANY independent conversations share one workspace id) → resume
      //     ONLY this sessionKey's OWN saved session. NEVER the workspace's latest session, which is a
      //     SIBLING (e.g. Master) — auto-resuming that is exactly what bled Master/AQP context into the
      //     SWP tab. If this conversation has no real saved session of its own, start blank.
      //   • else (the Core cockpit — one ongoing conversation per repo, keyed by the workspace id) →
      //     the workspace's latest session, so a new pane continues the repo's real context.
      let autoResume = null;
      if (!fresh) {
        if (scoped) {
          const own = this.transcriptDir ? store.findSession(this.transcriptDir, sessionKey) : null;
          autoResume = own && own.realSessionId ? own.realSessionId : null;   // Claude's own id for THIS tab, never a sibling's / the key
        } else {
          autoResume = this._latestWorkspaceRow(workspaceId)?.sessionId || null;
        }
      }
      const rawResumeId = resume || autoResume || null;
      // Last-line defense, right at the point of consumption: NEVER hand the SDK a resume value equal to
      // this workspace's own id OR this pane's own sessionKey. Neither is ever a real Claude session id —
      // the workspace id is `repo@worktree`, and the sessionKey is a per-conversation uuid the STORE
      // falls back to as "sessionId" when a session was interrupted before Claude stamped its real id.
      // Both broke prompts hard ("--resume ... is not a UUID", or "No conversation found with session ID:
      // <key>") regardless of source (client-sent `resume`, or the auto-resume lookup above).
      const resumeId = rawResumeId && rawResumeId !== workspaceId && rawResumeId !== sessionKey ? rawResumeId : null;
      s = new ClaudeSession({
        key: sessionKey, cwd, token, keyName, model: model || this.model,
        effort: effort || undefined, fastMode: !!fastMode,
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
      // Seed the pane's DISPLAYED transcript. Three cases, by the CALLER'S intent (it can't be inferred
      // from the key — a Core pane and a Pact tab can both carry a uuid key):
      //   • `fresh` (Pact "new chat") → blank. Many conversations share ONE workspace id in Pact, so a
      //     merged seed would dump EVERY other conversation (Master + every audit tab) into a brand-new
      //     tab — the "new chat picked up Master" bug.
      //   • `scoped` (a Pact tab continuing its OWN saved conversation) → just that session's turns,
      //     never the workspace merge, which would re-flood it with every other chat.
      //   • default (Core cockpit pane — one conversation per repo) → the full merged workspace history,
      //     so what's shown agrees with the SDK context just resumed (key-scoped fallback when empty).
      if (fresh) {
        s.transcript = [];
      } else if (scoped) {
        s.transcript = this._readSavedTranscript(sessionKey);
      } else {
        s.transcript = this.transcriptDir ? store.readWorkspace(this.transcriptDir, workspaceId) : [];
        if (!s.transcript.length) s.transcript = this._readSavedTranscript(sessionKey);
      }
      s._persistedCount = s.transcript.length;
      this.sessions.set(sessionKey, s);
      const turn = { role: "user", text, at: Date.now() };
      if (savedImages.length) turn.images = savedImages;
      // Stamp the worktree this turn actually ran in (non-main only). Now that a Pact conversation persists in
      // ONE stable place regardless of worktree, this is the durable record of WHERE it ran — the client
      // recovers a lost worktree binding from it, and reconstructs the migration marker(s) from the
      // main→worktree transitions, even if the IDE-state layout (which used to be the only home for either)
      // is dropped or corrupted.
      if (worktree && worktree !== "main") turn.worktree = worktree;
      s.transcript.push(turn);
      // Persist the prompt the INSTANT it's accepted — do NOT wait for the turn to finish. Persistence
      // otherwise only flushes at a turn boundary ("result" / stop), so a prompt whose turn never
      // reaches one — the user hits Stop and the SDK interrupt hangs, the process is restarted/killed,
      // or a mid-turn crash — was only ever in memory and vanished from the DISPLAY mirror on the next
      // reload, even though Claude's own session log kept it. Reloading history then couldn't bring it
      // back (the mirror, not the SDK log, is what the UI replays). Writing it here closes that window.
      this._persist(s);
      // Echo the accepted user turn to EVERY subscriber (with the sender id), so a second terminal
      // sharing this session renders the prompt live — not just Claude's reply. The sender skips
      // its own echo via `by`. `images`/`workspaceId` ride along too — confirmed in production an
      // image was otherwise saved to disk and persisted on the turn, but never told to ANY live
      // listener, so it silently vanished from the UI the instant the compose box cleared, even
      // though it was fully attached to the prompt Claude actually received.
      this.send("event", sessionKey, { kind: "user", text, at: turn.at, by: from || null, images: savedImages, workspaceId });
      s.prompt(text, savedImages.length ? imgs : undefined);
      // Cold-load cue: a first prompt into a NOT-live conversation cold-loads the whole SDK session file here; on a
      // big one that's a one-time multi-minute grind (until the auto-roll trims it). Tell the client it's LOADING
      // (not stuck), with the size; the first real output flips it to "done" (see _onEvent's loadingHistoryDone).
      const _coldBytes = resumeId ? this._sdkSessionBytes(resumeId) : 0;
      if (_coldBytes > 25 * 1024 * 1024) { s._coldLoadAt = Date.now(); s._coldLoadBytes = _coldBytes; this.send("event", sessionKey, { kind: "loadingHistory", bytes: _coldBytes }); }
      s.start();
      this.send("state", sessionKey, { session: this.sessionSummary(s) });
    } else {
      // Single-writer turn lock. A Claude session is turn-based: it can only work one prompt at
      // a time. With two terminals on the same session, a second prompt sent mid-turn would
      // interleave into the same agent. Refuse it with a `busy` event instead — the sender's
      // terminal shows "working…" rather than silently queueing behind someone else's turn.
      // "deepwork" counts too: the SDK's query is still actively producing content for a
      // backgrounded task even though the visible turn already ended (see claudeSession.mjs) —
      // accepting a new prompt here would push it into `_input()` while that same generator is
      // still mid-flight, exactly the interleaving this lock exists to prevent.
      if (s.status === "thinking" || s.status === "awaiting-permission" || s.status === "deepwork") {
        return this.send("event", sessionKey, { kind: "busy", status: s.status,
          message: "This workspace is working on a turn. Wait for it to finish before sending another prompt." });
      }
      if (wanted) s.setMode(wanted);
      // A model/effort/fast-mode switch picked mid-conversation (the selector matching Claude
      // Code Desktop's own) — previously `model` only ever applied at NEW-session creation; an
      // already-running pane had no way to switch models at all. Applied here the same way
      // `wanted` (mode) is: only when the caller actually asked for a change.
      if (model && model !== s.model) s.setModel(model);
      if (effort !== undefined && effort !== s.effort) s.setEffort(effort || undefined);
      if (fastMode !== undefined && !!fastMode !== s.fastMode) s.setFastMode(!!fastMode);
      // Same nothing-partial guarantee as the new-session path above: a bad mediaType (in ANY of
      // the images) throws here, before the turn is pushed or the session's prompt() is called.
      const savedImages = imgs.length ? this._saveImages(s.workspaceId, imgs) : [];
      const turn = { role: "user", text, at: Date.now() };
      if (savedImages.length) turn.images = savedImages;
      if (s.worktree && s.worktree !== "main") turn.worktree = s.worktree;   // durable record of where this turn ran (see the new-session path)
      // status is genuinely NOT busy right here (the check above already returned if it were) —
      // but "genuinely idle" and "genuinely, durably done" aren't the same thing when the idle
      // moment followed a deepwork phase within the last DEEP_WORK_RISK_GRACE_MS.
      const deepWorkRisk = !!(s._lastDeepWorkEndedAt && (Date.now() - s._lastDeepWorkEndedAt) < DEEP_WORK_RISK_GRACE_MS);
      if (deepWorkRisk) turn.deepWorkRisk = true;
      s.transcript.push(turn);
      this._persist(s);   // persist-on-send (see the new-session path): survive an interrupt/crash/restart before the turn's own result flush
      this.send("event", sessionKey, { kind: "user", text, at: turn.at, by: from || null, images: savedImages, workspaceId: s.workspaceId, deepWorkRisk: deepWorkRisk || undefined });
      s.prompt(text, savedImages.length ? imgs : undefined);
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

  /** Save a whole batch of attached images (up to MAX_IMAGES_PER_PROMPT) atomically: every
   *  image's mediaType is checked BEFORE any of them touch disk, so a bad image later in the
   *  list can't leave an earlier, perfectly valid image's file stranded on disk with no
   *  corresponding turn record — the same "nothing partial" guarantee `_saveImage` gives a
   *  single image, extended across the whole batch. Size (MAX_IMAGE_BASE64_LEN) is still only
   *  checked per-image inside `_saveImage` itself, same as before — an oversized image throws at
   *  its own turn in the `.map`, no earlier saves in the batch are undone (SDK-cwd-local disk
   *  files, not a transaction we can roll back — this is the same trade-off `_saveImage` alone
   *  already made for the oversized case, just not yet exercised by a batch). */
  _saveImages(workspaceId, images) {
    for (const image of images) {
      if (!store.IMAGE_EXT[image.mediaType]) throw new Error(`_saveImage: unrecognized mediaType "${image.mediaType}"`);
    }
    return images.map((image) => this._saveImage(workspaceId, image));
  }

  _onEvent(sessionKey, ev) {
    const s = this.sessions.get(sessionKey);
    // Cold-load DONE: the first REAL SDK event (not our own "status") from a session that was cold-loading a big
    // history means the load finished and output is flowing — tell the client to flip "Loading…" → "✓ loaded".
    if (s && s._coldLoadAt && ev && ev.kind !== "status") {
      this.send("event", sessionKey, { kind: "loadingHistoryDone", ms: Date.now() - s._coldLoadAt, bytes: s._coldLoadBytes || 0 });
      s._coldLoadAt = null;
    }
    // Multi-key failover: a turn that errored on the account's rate/usage limit marks THIS key exhausted
    // so the NEXT turn falls over to the next key. The per-turn usage_EXPERIMENTAL check is the primary,
    // reset-accurate signal; this catches a mid-turn limit hit before usage reflects 100%.
    if (s && ev && ev.kind === "error" && s.keyName && /rate.?limit|usage limit|429|quota|too many requests/i.test(String(ev.message || ""))) {
      this._markKeyExhausted(s.keyName);
    }
    if (s) {
      // Stamp `at` ONCE and put it on both the persisted turn AND the forwarded event. Clients need this
      // `at` live (not only after a reload) to key a bookmark to the response — and because a later resync
      // REPLACES the message list with the server's transcript, the live `at` must be the SAME value that
      // gets persisted, or the bookmark would orphan on the next resync. (Before: only the persisted turn
      // got an `at`, so a freshly-finished reply had none and its ☆ bookmark button silently did nothing.)
      if (ev.kind === "assistant" && ev.text) { const at = Date.now(); s.transcript?.push({ role: "assistant", text: ev.text, at }); ev = { ...ev, at }; }
      // A turn is durably flushed to the JSONL store the instant it completes — BEFORE the "result"
      // event is broadcast below. So stamping `persisted: true` on that event is accurate: by the
      // time any client sees the result, the turn is already safely on disk. This is what backs the
      // web's "✓ Saved — safe to close" signal.
      if (ev.kind === "result") {
        // Stamp the SDK's turn duration onto this turn's assistant reply BEFORE it's flushed, so the
        // "Thought for …" label survives a reload (the persisted transcript carries it). The newest
        // assistant turn is the one this result concludes.
        if (ev.durationMs != null && Array.isArray(s.transcript)) {
          for (let i = s.transcript.length - 1; i >= 0; i--) { const m = s.transcript[i]; if (m && m.role === "assistant") { m.durationMs = ev.durationMs; break; } }
        }
        this._persist(s); ev = { ...ev, persisted: true };
        this._maybeRoll(s);   // once a conversation is big enough, roll it onto a fresh tiny SDK session (fast resume, forever)
        // Auto-record this key's plan usage at EVERY turn-end (not only when a client asks), so the
        // Usage tab always reflects the latest and proactive percentage-based failover has fresh data.
        // The SDK query is still open here (streaming-input session), so getUsageLimits() works. Fire
        // and forget — a null/unavailable answer is recorded too, so the tab can say so honestly.
        if (s.keyName) {
          s.getUsageLimits().then((limits) => { this._recordKeyUsage(s.keyName, limits); this._sendKeysUsage(); }).catch(() => {});
          // Also record the account identity (email/subscription) this key is tied to, so the Usage tab
          // can name it — best-effort, gated by the same profile scope as usage (often absent for a
          // setup-token, so this may be a no-op, but subscriptionType/tokenSource can still come through).
          s.getAccountInfo().then((info) => { if (info) { this._recordKeyAccount(s.keyName, info); this._sendKeysUsage(); } }).catch(() => {});
        }
      }
    }
    this.send("event", sessionKey, ev);
    // Graceful close: a pane closed while this session was mid-turn asked to let it FINISH rather
    // than interrupt it (see `_control` delete). Now that the turn has genuinely concluded (idle,
    // ended, or errored) and its output is persisted, clean the session up. Without this the
    // finished-in-the-background session would linger forever (memory + a live claude subprocess).
    if (s && s._closeWhenIdle && (s.status === "idle" || s.status === "ended" || s.status === "error")) {
      s._closeWhenIdle = false;
      this._persist(s);
      try { s.stop(); } catch {}
      this.sessions.delete(sessionKey);
      this._sendSessions();   // authoritative snapshot without the now-gone session
      return;
    }
    // A status transition (or a turn completing) changes the "which conversations are live / working
    // right now" picture. Broadcast a compact sessions snapshot so EVERY client's live-conversation
    // stats + History "active" marks stay fresh — a plain event only reaches a client that has that
    // exact session open in a pane, so cross-client visibility needs this explicit push. A change in
    // background work (spawned workflows/tasks) matters the same way — and especially when the chat
    // is idle, since that's the only signal that hidden work is running.
    if (ev.kind === "status" || ev.kind === "result" || ev.kind === "background") this._sendSessions();
  }

  /** Broadcast just the live-sessions snapshot (lighter than the full `_sendList`, which also
   *  re-sends repos + config). Keeps every client's "N conversations · M working · K clients"
   *  readout and the History active-marks in step as sessions come, go, and change status. */
  _sendSessions() {
    this.send("state", null, { sessions: [...this.sessions.values()].map((x) => this.sessionSummary(x)) });
  }

  _ask(sessionKey, req) {
    return new Promise((resolvePerm) => {
      // Keep tool+input alongside the resolver so a client that RECONNECTS mid-prompt (reload / PWA reopen /
      // relay flap) can have the prompt RE-SENT (see _resendPendingPerms). Without this a turn blocked inside
      // canUseTool stayed blocked forever with no UI to answer it — "stuck for hours, reload is the same."
      this.pendingPerms.set(req.requestId, { resolve: resolvePerm, sessionKey, tool: req.tool, input: req.input });
      this.send("permission", sessionKey, { requestId: req.requestId, tool: req.tool, input: req.input });
    });
  }
  /** Re-emit every still-pending permission prompt for a session — called when a client (re)attaches, so a
   *  turn blocked awaiting a decision gets its Approve/Deny UI back and can be unblocked instead of hanging. */
  _resendPendingPerms(sessionKey) {
    for (const [requestId, p] of this.pendingPerms) {
      if (p.sessionKey === sessionKey) this.send("permission", sessionKey, { requestId, tool: p.tool, input: p.input });
    }
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
    if (!s) return;
    // The web "Stop" button — interrupt the CURRENT turn (Claude Code's ■ stop) but KEEP the
    // conversation alive so the user can immediately send another prompt. Settle any pending
    // permission FIRST so the SDK can unwind (canUseTool is blocked awaiting the web decision).
    this._resolvePendingFor(sessionKey, "deny");
    // ACKNOWLEDGE THE CLICK IMMEDIATELY. The interrupt below can take up to 6s (a wedged stream burns the
    // full timeout), and the old code only emitted state AFTER it — so for those seconds the UI still showed
    // "thinking" and the ■ Stop button looked dead ("I pressed stop and nothing happened; it stopped later").
    // This frame is the receipt: the client flips to a "■ stopping…" state right away, so the press is always
    // visibly registered even when the underlying interrupt is slow. The authoritative idle state still
    // follows below once the interrupt actually lands (or times out).
    this.send("event", sessionKey, { kind: "stopping", at: Date.now() });
    // NEVER let a genuinely-hung turn make Stop itself hang: a stalled SDK stream can make s.interrupt()
    // (which awaits this._q.interrupt()) block forever, so the old bare `await s.interrupt()` meant the ■ Stop
    // button never returned and the reader couldn't unstick a wedged turn. Race it against a timeout so _stop
    // ALWAYS returns, then force the displayed status to idle so the UI un-sticks regardless. If the underlying
    // subprocess is truly wedged (a stalled `for await` never re-checks _respawn), a fresh prompt re-spawns the
    // session; the guaranteed hard kill remains the engine reload. See the stuck-turn incident (44+ min hang).
    await Promise.race([
      Promise.resolve().then(() => s.interrupt()).catch(() => {}),
      new Promise((r) => setTimeout(r, 6000)),
    ]);
    if (s.status !== "idle" && s.status !== "ended" && s.status !== "error") s.status = "idle";
    this._persist(s);   // save whatever completed before the interrupt
    this.send("state", sessionKey, { session: this.sessionSummary(s) });
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
          // Closing a pane whose session is MID-TURN: don't interrupt and lose the in-flight reply
          // (the old behavior, and the "sometimes the last prompts get lost" report). Instead let
          // the turn finish and persist, then _onEvent cleans the session up once it's idle. Denying
          // any pending permission prompt frees a turn that was blocked waiting for input this now-
          // closed pane will never provide, so it can still reach a conclusion. An already-idle (or
          // ended/errored) session has no work to preserve — stop + persist + delete it right away.
          const busy = s.status === "thinking" || s.status === "awaiting-permission" || s.status === "deepwork";
          this._resolvePendingFor(key, "deny");
          if (busy) { s._closeWhenIdle = true; continue; }
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
      case "sessions": return this._sendSessionList(args.repo);
      case "sessionOpen": return this._openSession(args);
      case "sessionDelete": return this._deleteSession(args);
      case "open": return this._openTranscript(args.sessionKey, { scoped: !!args.scoped, full: !!args.full, limit: args.limit, around: args.around });
      case "resync": return this._resync(args.sessionKey, { scoped: !!args.scoped, full: !!args.full, limit: args.limit, around: args.around });
      case "dataSizes": return this._sendDataSizes();
      case "search": return this._sendSearch(args.query, args.repo);
      case "workspacesOn": return this._sendWorkspacesOn(args.repo);
      case "worktrees": return this._sendWorktrees(args.repo);
      case "worktreeAdd": return this._worktreeAdd(args.repo, args.name);
      case "worktreeRemove": return this._worktreeRemove(args.repo, args.name);
      case "setModel": return this.sessions.get(args.sessionKey)?.setModel(args.model || undefined);
      case "setEffort": return this.sessions.get(args.sessionKey)?.setEffort(args.effort || undefined);
      case "setFastMode": return this.sessions.get(args.sessionKey)?.setFastMode(!!args.enabled);
      case "models": return this._models(args.sessionKey);
      case "contextUsage": return this._contextUsage(args.sessionKey);
      case "usageLimits": return this._usageLimits(args.sessionKey);
      case "keysUsage": return this._sendKeysUsage();
      case "recall": return this._recall(args);
      default: return;
    }
  }

  /** The model catalog for the selector — display name, description, effort/fast-mode support
   *  (see the SDK's ModelInfo). This is a property of a RUNNING `claude` subprocess, not knowable
   *  before one exists, so: prefer `sessionKey`'s own live session; fall back to ANY other live
   *  session (the catalog is tied to the CLI build/account, not the specific conversation, so
   *  borrowing one is valid); fall back to the last successful answer (`_modelsCache`) so a brand
   *  new pane with no session yet still sees a populated selector; empty only on a machine that
   *  has never yet had a single live session answer this. */
  _models(sessionKey) {
    const s = (sessionKey && this.sessions.get(sessionKey)) || [...this.sessions.values()][0] || null;
    // No OmniRoute key ⇒ Claude-only, exactly the original synchronous behavior (nothing new, no fetch).
    if (!process.env.OMNIROUTE_KEY) {
      if (!s) return this.send("state", sessionKey, { models: this._modelsCache || [] });
      s.getSupportedModels().then((models) => {
        if (models.length) this._modelsCache = models;
        this.send("state", sessionKey, { models: models.length ? models : (this._modelsCache || []) });
      });
      return;
    }
    // OmniRoute configured ⇒ merge its LIVE catalog (your Claude abo via cc/*, plus free/other models), fetched
    // from /v1/models (cached), falling back to the static list on any failure. Async — an added lane, never Claude's.
    const omniP = fetchOmniModels(process.env).catch(() => omniModelChoices(process.env));
    if (!s) { omniP.then((omni) => this.send("state", sessionKey, { models: [...(this._modelsCache || []), ...omni] })); return; }
    Promise.all([s.getSupportedModels(), omniP]).then(([models, omni]) => {
      if (models.length) this._modelsCache = models;
      const base = models.length ? models : (this._modelsCache || []);
      this.send("state", sessionKey, { models: [...base, ...omni] });
    });
  }

  /** Point-in-time model catalog for callers that can't ride the WS "control" round-trip _models()
   *  streams over (e.g. a plain REST endpoint) — the OmniRoute model test tool's "pick any model" list.
   *  Same sourcing as _models (a live session's real catalog, falling back to the warm _modelsCache;
   *  OmniRoute's live catalog merged in when configured) but RETURNED as `{ anthropic, omni }` instead of
   *  pushed to a sink. Never throws — an unreachable OmniRoute gateway just yields an empty `omni`. */
  async modelCatalogSnapshot() {
    const s = [...this.sessions.values()][0] || null;
    let anthropic = this._modelsCache || [];
    if (s) {
      const live = await s.getSupportedModels().catch(() => []);
      if (live.length) { this._modelsCache = live; anthropic = live; }
    }
    const omni = process.env.OMNIROUTE_KEY
      ? await fetchOmniModels(process.env).catch(() => omniModelChoices(process.env))
      : [];
    return { anthropic, omni };
  }

  /** Fire ONE prompt against a brand-new, throwaway ClaudeSession PINNED to `model` — the OmniRoute model
   *  test tool's core primitive ("does this model actually answer, end to end?"). Deliberately independent
   *  of `this.sessions`/any repo or Pact history: never registered, never resumed, never reused, torn down
   *  the moment it settles or times out. This is the ONLY correct way to test a model — an existing
   *  session's `setModel()` does NOT actually re-route providers (the base URL/auth token is fixed at
   *  ClaudeSession spawn — see claudeSession.mjs _buildOptions' comment — a live session only picks up a
   *  new lane on its NEXT prompt at the earliest, never synchronously), so reusing or retargeting a shared
   *  session would silently keep testing whatever provider it already spawned on. Resolves
   *  `{ ok, model, provider, reply, latencyMs, error }` — never throws, even on a hard SDK/network failure
   *  (the raw message lands in `error`, never a generic "failed"). */
  async testModel({ model, promptText, timeoutMs = 45000 } = {}) {
    const mdl = String(model || "").trim();
    const text = String(promptText || "").trim();
    const provider = omniProviderOf(mdl);
    const started = Date.now();
    if (!mdl) return { ok: false, model: mdl, provider, reply: "", latencyMs: 0, error: "No model given." };
    if (!text) return { ok: false, model: mdl, provider, reply: "", latencyMs: 0, error: "No prompt given." };
    const { token, keyName } = this.activeTokenInfo();
    if (!token) return { ok: false, model: mdl, provider, reply: "", latencyMs: 0, error: "No Claude token on the machine — run `claude setup-token` and save it (see .secrets/)." };

    const replyParts = [];
    let settle;
    const settled = new Promise((resolve) => { settle = resolve; });
    const session = new ClaudeSession({
      key: "modeltest-" + randomUUID(), cwd: this.root, model: mdl, token, keyName,
      sdkQuery: this.sdkQuery,
      onEvent: (_key, ev) => {
        if (ev.kind === "assistant" && ev.text) replyParts.push(ev.text);
        else if (ev.kind === "result") settle({ kind: "result", ev });
        else if (ev.kind === "error") settle({ kind: "error", ev });
      },
      // Deny any tool use outright (never wired to a real approval UI) — a test session only needs the
      // model to answer in text; denying is safe and keeps this from ever touching real files/commands.
      onPermission: async () => "deny",
    });
    session.prompt(text);
    session.start();
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ kind: "timeout" }), Math.max(1, timeoutMs)));
    const outcome = await Promise.race([settled, timeout]);
    try { await session.stop(); } catch {}
    const latencyMs = Date.now() - started;
    const reply = replyParts.join("");
    if (outcome.kind === "timeout") return { ok: false, model: mdl, provider, reply, latencyMs, error: `Timed out after ${timeoutMs}ms with no result.` };
    if (outcome.kind === "error") return { ok: false, model: mdl, provider, reply, latencyMs, error: String(outcome.ev.message || "Session error.") };
    if (outcome.ev.isError) return { ok: false, model: mdl, provider, reply, latencyMs, error: String(outcome.ev.resultText || outcome.ev.subtype || "The model reported an error result.") };
    return { ok: true, model: mdl, provider, reply, latencyMs, error: null };
  }

  /** Context-window usage for ONE live session — inherently per-conversation, so (unlike
   *  _models/_usageLimits) there's no meaningful fallback to another session when this one isn't
   *  live: null just means "nothing to show yet". */
  _contextUsage(sessionKey) {
    const s = sessionKey ? this.sessions.get(sessionKey) : null;
    // `contextBreakdown` is ALWAYS an object, on every path — the popover renders `ok: false` as
    // "unavailable" rather than as "0% used", and a missing key would be indistinguishable from a
    // zeroed one at the client. `usage` (the raw SDK response) is kept for the compact badge and may
    // be null. See docs/work/agentic-chat-engine/CONTRACT.md §1.
    if (!s) return this.send("event", sessionKey, { kind: "contextUsage", usage: null, contextBreakdown: shapeContextUsage(null) });
    s.getContextUsage().then((usage) => this.send("event", sessionKey, { kind: "contextUsage", usage, contextBreakdown: shapeContextUsage(usage) }));
  }

  /** claude.ai plan rate-limit utilization — account-wide, not per-conversation, so (like
   *  _models) any live session can answer it; EXPERIMENTAL per the SDK's own naming, see
   *  ClaudeSession.getUsageLimits(). */
  _usageLimits(sessionKey) {
    const s = (sessionKey && this.sessions.get(sessionKey)) || [...this.sessions.values()][0] || null;
    if (!s) return this.send("event", sessionKey, { kind: "usageLimits", limits: null });
    s.getUsageLimits().then((limits) => {
      this._recordKeyUsage(s.keyName, limits);   // remember this account's usage + whether it's now exhausted
      this.send("event", sessionKey, { kind: "usageLimits", limits });
      this._sendKeysUsage();                      // let the Usage tab reflect the new per-key state
    });
  }

  /** Record a key's last-known plan usage (from usage_EXPERIMENTAL) and whether it's exhausted — the
   *  input the automatic failover reads. `limits.rate_limits` at ≥100% marks the key blocked until reset. */
  _recordKeyUsage(keyName, limits) {
    if (!keyName) return;
    const rl = limits && limits.rate_limits;
    const ex = usageExhaustion(rl);
    // `available` is the SDK's rate_limits_available: false for API-key/Bedrock/Vertex auth or a token
    // missing the plan-usage scope (rate_limits is then null). We record it so the Usage tab can say
    // "unavailable for this key" instead of the misleading "no usage yet" — the data will never arrive.
    const available = !!(limits && limits.rate_limits_available);
    const prev = this._keyUsage[keyName] || {};
    this._keyUsage[keyName] = { ...prev, limits: limits || null, available, exhaustedUntil: ex.exhausted ? ex.until : null, at: Date.now() };
  }

  /** Record the Claude account identity a key authenticates as (email/subscription/token source), for
   *  the Usage tab's per-key label. Merged into the same _keyUsage record so it survives a usage refresh. */
  _recordKeyAccount(keyName, info) {
    if (!keyName || !info) return;
    const prev = this._keyUsage[keyName] || {};
    this._keyUsage[keyName] = { ...prev, account: {
      email: info.email || null, organization: info.organization || null,
      subscriptionType: info.subscriptionType || null, tokenSource: info.tokenSource || null,
    } };
  }

  /** Mark a key exhausted right now (e.g. a turn hit a rate-limit error before usage reflected 100%) so
   *  the NEXT turn fails over. Blocks until the key's known 5-hour reset, or a 1-hour cooldown if unknown. */
  _markKeyExhausted(keyName) {
    if (!keyName) return;
    const prev = this._keyUsage[keyName] || {};
    const knownReset = prev.limits?.rate_limits?.five_hour?.resets_at ? new Date(prev.limits.rate_limits.five_hour.resets_at).getTime() : null;
    this._keyUsage[keyName] = { ...prev, exhaustedUntil: Math.max(knownReset || 0, Date.now() + 60 * 60 * 1000), at: Date.now() };
    this._sendKeysUsage();
  }

  /** The multi-key store's live state for the Usage tab: each key's name + fingerprint (never the raw
   *  token) + last-known usage + whether it's active (the failover pick) or currently exhausted. */
  _keysUsage() {
    const keys = readClaudeKeys(this.secretsDir);
    const now = Date.now();
    const activeIdx = pickActiveKeyIndex(keys, this._keyUsage, now);
    return keys.map((k, i) => {
      const u = this._keyUsage[k.name] || null;
      const exhausted = !!(u && u.exhaustedUntil && now < u.exhaustedUntil);
      return { name: k.name, fingerprint: keyFingerprint(k.token), active: i === activeIdx, exhausted,
        checked: !!(u && u.at), available: !!(u && u.available), account: (u && u.account) || null,
        exhaustedUntil: (u && u.exhaustedUntil) || null, limits: (u && u.limits) || null, at: (u && u.at) || null };
    });
  }
  _sendKeysUsage() { this.send("state", null, { keysUsage: this._keysUsage() }); }

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
    // A reattached worktree with genuinely diverged history — createWorktree already refused to
    // silently discard it; surface that here so it's not a silent surprise the next time someone
    // works in it.
    if (r.staleWarning) this.send("event", null, { kind: "note", message: r.staleWarning });
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

  /** Does this repo+worktree actually exist as a real checkout right now? "main" always does
   *  (it's the repo itself). Used to flag history rows whose worktree has since been removed —
   *  see _sendHistory. */
  _worktreeExists(repo, worktree, cache) {
    if (!worktree || worktree === "main") return true;
    if (!cache.has(repo)) cache.set(repo, new Set((listWorktrees(this.root, repo) || []).map((w) => w.name)));
    return cache.get(repo).has(worktree);
  }

  /** One row per WORKSPACE (repo+worktree), newest first — every past session file for that
   *  workspace aggregated into a single summary — so a "new chat" on a worktree that already has
   *  history doesn't show up as a second, disconnected-looking row. Each row is flagged
   *  `missingWorktree: true` when its worktree no longer exists on disk (removed, or this box
   *  never had it) — a real, permanent past conversation, just one whose checkout is gone, so the
   *  web can show it as historical-only rather than implying it can be casually continued (see
   *  the "resume a missing worktree" control action, which offers to recreate it instead). */
  _sendHistory(repo) {
    const rows = store.listWorkspaces(this.transcriptDir);
    const scoped = repo ? rows.filter((w) => w.repo === repo) : rows;
    const cache = new Map();   // repo -> Set(existing worktree names) — one `git worktree list` per repo, not per row
    const out = scoped.map((w) => ({ ...w, missingWorktree: !this._worktreeExists(w.repo, w.worktree, cache) }));
    this.send("state", null, { history: out, historyRepo: repo || null });
  }

  /** One row PER SAVED SESSION for a repo (newest first) — unlike `_sendHistory`, which aggregates a
   *  whole repo@worktree into a single row. This is what backs the Pact chat's history panel, where
   *  every past chat is its own listed, resumable, renameable, deletable entry. Each row carries
   *  `sessionId` (the file/lookup key = the chat tab's key) AND `realSessionId` (the SDK id `resume`
   *  needs to continue that specific conversation with full context). */
  _sendSessionList(repo) {
    const rows = store.listSessions(this.transcriptDir, { repo: repo || null });
    this.send("state", null, { pactSessions: rows, pactSessionsRepo: repo || null });
  }

  /** Rehydrate ONE saved session's transcript (for the history panel's Resume / Load-into-box).
   *  Reads that single session file by (workspaceId, sessionId) — NOT the whole-workspace merge
   *  `_openTranscript` does — so the chat box shows exactly that conversation. Echoed back on the
   *  `sessionId` key the client opened the tab under. */
  _openSession({ repo, worktree, sessionId, full = false }) {
    if (!sessionId) return;
    const wid = store.workspaceId(repo, worktree || "main");
    const found = store.readSession(this.transcriptDir, wid, sessionId);
    if (!found) return this.send("event", sessionId, { kind: "error", message: "That conversation could not be opened." });
    const transcript = (found.transcript || []).map(({ workspaceId: _w, ...turn }) => turn);
    // Ship only the TAIL by default (the same cap resync/open use). A big saved conversation — a Pact Master
    // tab's history was 2.2 MB on disk — otherwise transfers whole through the tunnel on every page load, which
    // is the multi-second blank-chat wait on mobile. The client renders far less than 250 messages anyway and
    // fetches older ones on demand ("Show earlier", full:true).
    this.send("transcript", sessionId, { sessionKey: sessionId, sessionId: found.sessionId || sessionId,
      workspaceId: wid, repo: found.repo, worktree: found.worktree, usage: found.usage || null, ...capTranscript(transcript, full) });
  }

  /** Delete one saved session (the history panel's per-row Delete). Tears down any live session on
   *  that key first, then removes the JSONL, then re-sends the per-session list so the panel updates. */
  _deleteSession({ repo, worktree, sessionId }) {
    if (!sessionId) return;
    const s = this.sessions.get(sessionId);
    if (s) { this._resolvePendingFor(sessionId, "deny"); try { s.stop(); } catch {} this.sessions.delete(sessionId); }
    store.deleteSession(this.transcriptDir, store.workspaceId(repo, worktree || "main"), sessionId);
    return this._sendSessionList(repo);
  }

  /** The most-recently-updated recorded row for a workspace id, or null when it has no saved
   *  history yet. Used to auto-seed `options.resume` for a fresh pane. */
  _latestWorkspaceRow(workspaceId) {
    if (!this.transcriptDir) return null;
    return store.listWorkspaces(this.transcriptDir).find((w) => w.workspaceId === workspaceId) || null;
  }

  /** The best-known CURRENT state of a session: live in-memory state (`s.transcript`/`s.status`/
   *  `s.usage`, updated turn-by-turn as events happen — see `_onEvent`) if a session for this key
   *  is still running, else whatever's durably saved. This distinction matters because persistence
   *  only flushes at turn boundaries (`_persist`, on "result"/stop) — a disk-only read can lag live
   *  state by up to a whole in-flight turn. That gap is exactly what silently "lost" a just-sent
   *  prompt (and its still-forming or just-finished reply): a pane is torn down and rebuilt from
   *  scratch every time its section is reopened (the web client's `restorePanes()`), which used to
   *  always re-read from disk only — invisible for as long as a turn hadn't been persisted yet.
   *  Returns null when nothing is known about this key at all (never opened here, no live session,
   *  no saved file). `sessionKey` may be a workspace id (what history rows carry) or a legacy/
   *  per-session key; either form resolves to its workspace id in the disk-fallback path. */
  _liveOrSavedState(sessionKey, { scoped = false, full = false, limit, around } = {}) {
    const live = this.sessions.get(sessionKey);
    if (live) {
      return { sessionId: live.sessionId, repo: live.repoLabel || null, worktree: live.worktree || "main",
        workspaceId: live.workspaceId || sessionKey, usage: live.usage, status: live.status,
        turnStartedAt: live.turnStartedAt ?? null, lastActivityAt: live.lastActivityAt ?? null,   // authoritative clock for the reconnecting client
        ...capTranscript(live.transcript, full, limit, around) };
    }
    const direct = this._latestWorkspaceRow(sessionKey);           // sessionKey IS a workspace id
    const bySession = direct ? null : store.findSession(this.transcriptDir, sessionKey);
    const workspaceId = direct ? sessionKey : bySession?.workspaceId;
    if (!workspaceId) return null;
    const row = direct || this._latestWorkspaceRow(workspaceId);
    const { repo, worktree } = store.parseWorkspaceId(workspaceId);
    // Which transcript to replay on a resync / reopen of a NON-live session:
    //   • `scoped` AND resolved to one specific saved session (`bySession`) → replay ONLY that session.
    //     This is the Pact chat model (many conversations share a workspace id, each tab is its own
    //     session file). Merging the whole workspace here is exactly what re-flooded a resynced Pact tab
    //     (e.g. after a daemon restart dropped it from live) with Master + every other chat.
    //   • else → the whole merged workspace history (Core cockpit — one ongoing conversation per repo).
    // Strip store bookkeeping from replayed turns; keep only conversation content.
    const transcript = ((scoped && bySession)
      ? (bySession.transcript || [])
      : (this.transcriptDir ? store.readWorkspace(this.transcriptDir, workspaceId) : [])
    ).map(({ workspaceId: _w, ...turn }) => turn);
    return { sessionId: row?.sessionId ?? bySession?.sessionId ?? null, repo: row?.repo ?? repo,
      worktree: row?.worktree ?? worktree, workspaceId, usage: bySession?.usage ?? null, status: "idle", ...capTranscript(transcript, full, limit, around) };
  }

  /** Stream a workspace's conversation back — live if it's still running, else the full merged
   *  saved history (every past session file for that workspace, oldest to newest) — for read-only
   *  viewing or pane reattachment (see `restorePanes()`, the "Resume" history button). */
  _openTranscript(sessionKey, { scoped = false, full = false, limit, around } = {}) {
    const s = this._liveOrSavedState(sessionKey, { scoped, full, limit, around });
    // Echo the ORIGINALLY-REQUESTED sessionKey back on the not-found path too — the client
    // correlates this reply against its pendingOpens map by that key; sending null there leaks
    // the pending entry instead of resolving it.
    if (!s) return this.send("event", sessionKey, { kind: "error", message: "That conversation could not be opened." });
    this.send("transcript", sessionKey, { sessionKey, ...s });
    this._resendPendingPerms(sessionKey);   // a reattach to a turn blocked awaiting permission gets its Approve/Deny back
  }

  /** Reconnect catch-up. Every broadcast hop between here and a browser (the local SSE fan-out,
   *  the outbound tunnel socket, the relay's per-browser fan-out) is fire-and-forget — a client
   *  that's disconnected for even one event's duration loses it silently, forever, with nothing
   *  to replay it. Rather than adding a backlog buffer at every hop, a reconnecting client asks
   *  for this instead: the CURRENT state of the session it was watching (see `_liveOrSavedState`). */
  _resync(sessionKey, { scoped = false, full = false, limit, around } = {}) {
    if (!sessionKey) return;
    const s = this._liveOrSavedState(sessionKey, { scoped, full, limit, around });
    if (!s) return;   // nothing known about this key on this process — leave the pane as-is
    this.send("event", sessionKey, { kind: "resync", live: this.sessions.has(sessionKey), ...s });
    this._resendPendingPerms(sessionKey);   // same on a resync: don't leave a blocked-on-permission turn unanswerable
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
  /** Best-effort byte size of the SDK's OWN session log for a resume id — globbed by filename across the project
   *  dirs, so we never reverse-engineer Claude Code's cwd→dir encoding. Used only to warn about a big cold-load. */
  _sdkSessionBytes(resumeId) {
    if (!resumeId) return 0;
    try {
      const base = join(process.env.HOME || "", ".claude", "projects");
      for (const d of readdirSync(base)) {
        try { return statSync(join(base, d, resumeId + ".jsonl")).size; } catch { /* not in this project dir */ }
      }
    } catch { /* no ~/.claude/projects — fine */ }
    return 0;
  }

  /** AUTO-ROLL: when a conversation has grown past the threshold (measured SINCE the last roll, so it fires once
   *  per window, not every turn), transparently roll it onto a FRESH tiny SDK session. The store stays continuous
   *  (keyed by s.key) so the DISPLAY is unbroken; the head is archived for recall; the SEED (summary + last 40
   *  turns) goes to the new session so the MODEL keeps context; every turn after stamps the new (small) session
   *  id, so `--resume` stays fast forever. A roll must NEVER break turn completion — fully guarded. */
  _maybeRoll(s) {
    try {
      if (!s || !Array.isArray(s.transcript) || typeof s.roll !== "function") return;
      const from = s._rolledThrough || 0;
      const slice = s.transcript.slice(from);
      if (!shouldRoll(conversationStats(slice))) return;
      const { head, tail } = splitForRoll(slice, ROLL_DEFAULTS.tailTurns);
      if (!head.length) return;                                    // nothing to summarize yet — wait
      s._rolledThrough = s.transcript.length;                      // don't re-roll until another window accrues
      // Segment numbering and the absolute P#/R# offsets are properties of the CONVERSATION, not of this
      // process — a restart would otherwise restart both at zero, so the next roll would overwrite an
      // existing `<conv>#seg1` archive AND re-claim P1.. for a range that is really P600.. . Seed them
      // once per live session from the archive index that is already on disk.
      this._seedRollState(s);
      const n = (s._segmentCount = (s._segmentCount || 0) + 1);
      const sourceRef = segmentRef(s.key, n);
      // Mechanical carry-forward summary (no extra model turn → a roll can't stall on summary quality): the head's
      // user prompts, first line of each. The FULL head is archived verbatim for recall.
      const summary = head.filter((r) => r && r.role === "user" && typeof r.text === "string" && r.text.trim())
        .map((r) => "- " + r.text.split("\n")[0].slice(0, 140)).slice(-80).join("\n") || "(earlier turns)";
      // Archive INSIDE the workspace's own dir (…/<workspace-slug>/_segments/) — NOT the transcriptDir root, where
      // eachSession would treat _segments as a bogus workspace and leak every segment into the conversation list.
      // The index's P#/R# ranges are ABSOLUTE across the whole conversation, so each segment starts where the
      // previous one ended. Passing 0/0 every time (the old behaviour) made segment 2+ claim P1.. again, and
      // recallByNumber takes the FIRST entry whose range contains the number — so every recall of a late turn
      // silently answered with an EARLY one. Track the running offsets on the session.
      const pOff = s._archivedPrompts || 0, rOff = s._archivedResponses || 0;
      const headStats = conversationStats(head);
      s._archivedPrompts = pOff + headStats.prompts;
      s._archivedResponses = rOff + headStats.responses;
      try {
        if (s.workspaceId) {
          this._ensureSegmentsMigrated();
          // `workspaceId` is what makes an archived row's image references resolvable later: they are stored
          // as `images/<hash>.<ext>` RELATIVE to the workspace's own dir (workspaceStore.saveImage), so the
          // archive alone cannot resolve them — recall carries the workspace id back out with every hit.
          archiveSegment(join(this.transcriptDir, store.slugFor(s.workspaceId)),
            { conversationId: s.key, workspaceId: s.workspaceId, n, rows: head, summary,
              promptOffset: pOff, responseOffset: rOff, at: new Date().toISOString() });
        }
      } catch { /* archive is best-effort; the roll still proceeds */ }
      const seed = buildSeedText({ summary, tailRows: tail, sourceRef });
      this.send("event", s.key, { kind: "rolling", segment: n, sourceRef });   // the "⟳ Rolling to a fresh window…" cue
      s.roll(seed);                                                // fresh session, seeded — see ClaudeSession.roll
    } catch { /* never let a roll failure sink the turn */ }
  }

  /** The archive base dir for a session key — the workspace dir the roll writes `_segments/` into.
   *  Works for a session that is no longer live (the common case for recall: you are asking about a
   *  conversation you rolled off ages ago), by resolving the key through the store. Null when the key
   *  is unknown here or there is no transcript dir at all. */
  _archiveBaseFor(sessionKey) {
    if (!this.transcriptDir || !sessionKey) return null;
    const live = this.sessions.get(sessionKey);
    let wid = live && live.workspaceId ? live.workspaceId : null;
    if (!wid) {
      // The key may itself BE a workspace id (a Core pane), else look the saved session up.
      try {
        const row = this._latestWorkspaceRow(sessionKey);
        wid = row ? row.workspaceId : (store.findSession(this.transcriptDir, sessionKey)?.workspaceId || null);
      } catch { wid = null; }
      // Last resort: a Core pane's session key IS its workspace id, so if an archive dir exists under
      // that name, that's the one — this keeps recall working for a conversation whose store rows are
      // gone/never written while its archive survives.
      if (!wid && existsSync(join(this.transcriptDir, store.slugFor(sessionKey), SEG_DIR))) wid = sessionKey;
    }
    return wid ? join(this.transcriptDir, store.slugFor(wid)) : null;
  }

  /** RECALL — read a turn that has rolled off the active window back out of the archive, either by its
   *  absolute P#/R# number ("what did you say at #1237") or by a substring query. Per the locked design
   *  decision, recall is VISIBLE, not silent magic: a `lookingUp` event turns the "🔍 Looking up historical
   *  turns…" cue ON before the disk scan, and the terminal `recall` event turns it OFF — always exactly one
   *  of each, including on the not-found path, so the cue can never be left stuck on.
   *
   *  args = { sessionKey, kind?: "prompt"|"response", number?: n, query?: "…", limit?: 10 }
   *  A `number` (with `kind`) takes precedence over `query`. */
  _recall({ sessionKey, kind, number, query, limit } = {}) {
    if (!sessionKey) return;
    const wantKind = kind === "response" ? "response" : "prompt";
    const num = Number.isFinite(Number(number)) ? Math.floor(Number(number)) : null;
    const q = typeof query === "string" ? query.trim() : "";
    const byNumber = num !== null && num >= 1;
    if (!byNumber && !q) return this.send("event", sessionKey, { kind: "recall", mode: "query", query: "", ok: false, hits: [], error: "Nothing to recall — give a turn number or a search query." });

    const mode = byNumber ? "number" : "query";
    this.send("event", sessionKey, { kind: "lookingUp", mode, kindOf: wantKind, number: byNumber ? num : null, query: byNumber ? "" : q, at: Date.now() });
    let out;
    try {
      this._ensureSegmentsMigrated();
      const base = this._archiveBaseFor(sessionKey);
      if (!base) out = byNumber
        ? { kind: "recall", mode, kindOf: wantKind, number: num, ok: false, hit: null, error: "No archive for this conversation yet." }
        : { kind: "recall", mode, query: q, ok: false, hits: [], error: "No archive for this conversation yet." };
      else if (byNumber) {
        const hit = recallByNumber(base, { conversationId: sessionKey, kind: wantKind, number: num });
        out = { kind: "recall", mode, kindOf: wantKind, number: num, ok: !!hit, hit: hit || null,
          error: hit ? null : `No archived ${wantKind} #${num} — it may still be in the active window.` };
      } else {
        const hits = recallByQuery(base, { conversationId: sessionKey, query: q, limit: Number.isFinite(Number(limit)) ? Number(limit) : 10 });
        out = { kind: "recall", mode, query: q, ok: hits.length > 0, hits, error: hits.length ? null : "Nothing archived matches that." };
      }
    } catch (e) {
      out = byNumber
        ? { kind: "recall", mode, kindOf: wantKind, number: num, ok: false, hit: null, error: String(e && e.message || e) }
        : { kind: "recall", mode, query: q, ok: false, hits: [], error: String(e && e.message || e) };
    }
    // ALWAYS emitted — the terminal event is what clears the "🔍 Looking up…" cue.
    this.send("event", sessionKey, { ...out, at: Date.now() });
  }

  /** One-time, lazy backfill of the LEGACY archive location. Rolls written by an earlier build landed in
   *  `<transcriptDir>/_segments/` (the transcript ROOT) rather than inside the owning workspace's dir — where
   *  the store enumerates them as a bogus "_segments" conversation and, worse, their image references cannot
   *  be resolved (an image `path` is relative to the WORKSPACE dir). Runs at most once per manager, only when
   *  a root `_segments` dir actually exists, and never throws. */
  /** Recover a conversation's archive bookkeeping (highest segment number + how many prompts/responses are
   *  already archived) from the on-disk index, once per live session. Without this every process restart
   *  restarts the numbering at seg1/P1, which overwrites an existing segment file and gives two segments
   *  overlapping absolute ranges — and `recallByNumber` takes the FIRST entry whose range matches. */
  _seedRollState(s) {
    if (s._rollStateSeeded || !this.transcriptDir || !s.workspaceId) return;
    s._rollStateSeeded = true;
    try {
      this._ensureSegmentsMigrated();
      const index = readIndex(join(this.transcriptDir, store.slugFor(s.workspaceId)))
        .filter((e) => e && String(e.conversationId) === String(s.key));
      for (const e of index) {
        if (Number.isFinite(e.n)) s._segmentCount = Math.max(s._segmentCount || 0, e.n);
        if (Number.isFinite(e.promptEnd)) s._archivedPrompts = Math.max(s._archivedPrompts || 0, e.promptEnd);
        if (Number.isFinite(e.responseEnd)) s._archivedResponses = Math.max(s._archivedResponses || 0, e.responseEnd);
      }
    } catch { /* an unreadable index just means we start from zero — never block the roll */ }
  }

  _ensureSegmentsMigrated() {
    if (this._segmentsMigrated || !this.transcriptDir) return;
    this._segmentsMigrated = true;
    try { migrateLegacyRootSegments(this.transcriptDir, (wid) => join(this.transcriptDir, store.slugFor(wid))); }
    catch { /* best effort — a failed migration must never block a roll or a recall */ }
  }

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
      // Write-side guard, belt-and-suspenders with _prompt's own read-side one: never stamp a
      // realSessionId equal to this workspace's own id. A real Claude session id is always a
      // UUID — this exact self-referential shape is what a past bug produced, and once written
      // it poisoned every future resume attempt for that workspace until the data itself (not
      // just the code) was fixed.
      const realSessionId = (s.sessionId && s.sessionId !== s.workspaceId) ? s.sessionId : null;
      store.appendTurn(this.transcriptDir, s.workspaceId, s.key, { ...turn, workspaceId: s.workspaceId, realSessionId });
    }
    s._persistedCount = (s.transcript || []).length;
  }

  /** Flush EVERY live session's un-persisted turns to disk. Called on graceful shutdown (sessiond's SIGTERM
   *  handler) so restarting the engine mid-turn saves the response blocks generated so far instead of losing
   *  them with the process — the gap behind "a restart interrupted my turn and the reply vanished". Idempotent
   *  (a session already flushed writes nothing) and best-effort per session (one failure never blocks the
   *  rest). Returns the number of sessions that had pending turns written. */
  persistAll() {
    let n = 0;
    for (const s of this.sessions.values()) {
      try { const before = s._persistedCount || 0; this._persist(s); if ((s._persistedCount || 0) > before) n++; } catch { /* keep flushing the rest */ }
    }
    return n;
  }

  /** How many live sessions are mid-turn RIGHT NOW (thinking / awaiting-permission / deepwork) — the ones an
   *  engine restart would interrupt. Surfaced on the deploy page so a restart is never done blindly. */
  liveTurnCount() {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (s.status === "thinking" || s.status === "awaiting-permission" || s.status === "deepwork") n++;
    }
    return n;
  }
}
