// The workspace transcript store — the ONE place that reads and writes conversation history.
//
// Six call sites in workspace.mjs used to each open the flat `.claude/workspace/<key>.json`
// layout by hand; routing them all through here is what makes the per-repo/per-worktree move
// tractable. Two things changed under the hood:
//
//   • Layout — history is now grouped `<workspace-slug>/<sessionId>.jsonl`, so "everything for
//     Mnemosyne@main" is one directory instead of a filter across a flat pile.
//   • Format — append-only JSONL, one record per turn, instead of rewriting the whole transcript
//     on every result. Rewrites cost grew with conversation length and a crash mid-write could
//     truncate the entire history; an append can lose at most the last line.
//
// Both the new layout AND the legacy flat `<key>.json` files are read, so existing history keeps
// working with no migration step. Node builtins only — runs the same on Windows and Linux.
import { existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** `<repoPath>@<worktree>`. The worktree defaults to `main`. */
export function workspaceId(repoPath, worktree = "main") {
  return `${repoPath}@${worktree || "main"}`;
}

/** Inverse of workspaceId. A worktree name never contains `@`, so split on the LAST one; a bare
 *  id (a legacy key, or a repo with no explicit worktree) is treated as the `main` worktree. */
export function parseWorkspaceId(id) {
  const s = String(id || "");
  const at = s.lastIndexOf("@");
  if (at === -1) return { repo: s, worktree: "main" };
  return { repo: s.slice(0, at), worktree: s.slice(at + 1) || "main" };
}

// The escape delimiter MUST be a character outside the "kept" set below, so it can never appear
// literally in a slug — that is what makes slugFor/idFromSlug an injective, reversible pair. `~`
// is filesystem-safe on Windows and Linux and is not in the kept set. (An earlier version used
// `-`, which IS kept, so a key like `rc-1-2` was mis-decoded and its saved conversation could not
// be reopened.)
const SLUG_KEEP = /[^A-Za-z0-9@._-]/g;
const SLUG_ESC = /~([0-9a-f]{1,2})~/g;

/** A one-level, filesystem-safe directory/file name for a workspace id or session key. Path
 *  separators and any other character outside the kept set are escaped as `~<hex>~`, so the whole
 *  workspace is a single flat folder and the mapping round-trips exactly (see idFromSlug). */
export function slugFor(id) {
  return String(id).replace(SLUG_KEEP, (ch) => "~" + ch.charCodeAt(0).toString(16) + "~");
}

const isJsonl = (f) => f.endsWith(".jsonl");
const isLegacy = (f) => f.endsWith(".json");
const safeReaddir = (dir) => { try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; } };

/** One durable record for a turn (or a retirement marker). */
export function appendTurn(dir, id, sessionId, record) {
  if (!dir) return;
  const wsDir = join(dir, slugFor(id));
  try {
    if (!existsSync(wsDir)) mkdirSync(wsDir, { recursive: true });
    // The sessionId can itself be a path-shaped workspace key, so slug it for the filename too.
    appendFileSync(join(wsDir, `${slugFor(sessionId)}.jsonl`), JSON.stringify(record) + "\n");
  } catch { /* history is best-effort — never let a write failure break a live turn */ }
}

/** Append a retirement marker. The conversation stays; a `retired` record caps it. */
export function retire(dir, id, sessionId, at = Date.now()) {
  appendTurn(dir, id, sessionId, { t: "retired", at });
}

// Parse one JSONL file into { transcript[], retired, retiredAt }. A bad line is dropped, never
// fatal — a single corrupt append must not sink the whole conversation.
function parseJsonl(text) {
  const transcript = [];
  let retired = false, retiredAt = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    if (rec && rec.t === "retired") { retired = true; retiredAt = rec.at ?? null; continue; }
    transcript.push(rec);
  }
  return { transcript, retired, retiredAt };
}

// Shape a parsed session into the summary the History list shows.
function summarise({ id, sessionId, transcript, retired, retiredAt, updatedAt, usage, legacyKey }) {
  const { repo, worktree } = parseWorkspaceId(id);
  const first = transcript.find((m) => m && m.role === "user");
  const turns = usage?.turns || transcript.filter((m) => m && m.role === "user").length;
  return {
    sessionKey: legacyKey || id, workspaceId: id, sessionId: sessionId || legacyKey || null,
    repo, worktree, updatedAt: updatedAt || null, turns, usage: usage || null,
    retired, retiredAt, firstPrompt: first ? String(first.text).slice(0, 120) : "",
  };
}

// Enumerate every stored session across BOTH layouts, without reading full bodies unless `withText`.
function* eachSession(dir, { withText = false } = {}) {
  for (const ent of safeReaddir(dir)) {
    if (ent.isDirectory()) {
      const wsSlug = ent.name;
      const wsDir = join(dir, wsSlug);
      for (const f of safeReaddir(wsDir)) {
        if (!f.isFile() || !isJsonl(f.name)) continue;
        const abs = join(wsDir, f.name);
        let raw = ""; try { raw = readFileSync(abs, "utf8"); } catch { continue; }
        const { transcript, retired, retiredAt } = parseJsonl(raw);
        let updatedAt = null; try { updatedAt = statSync(abs).mtimeMs; } catch {}
        // Recover the workspace id from a record's stamp when present, else decode the dir slug.
        // The sessionId is the file stem, un-slugged back to the key a client would hold.
        const id = transcript[0]?.workspaceId || idFromSlug(wsSlug);
        yield { kind: "new", id, sessionId: idFromSlug(f.name.replace(/\.jsonl$/, "")),
          transcript, retired, retiredAt, updatedAt, raw: withText ? raw : null };
      }
    } else if (ent.isFile() && isLegacy(ent.name)) {
      const abs = join(dir, ent.name);
      let raw = ""; try { raw = readFileSync(abs, "utf8"); } catch { continue; }
      let t; try { t = JSON.parse(raw); } catch { continue; }
      const id = t.repo ? workspaceId(t.repo, "main") : (t.sessionKey || ent.name.replace(/\.json$/, ""));
      yield { kind: "legacy", id, legacyKey: t.sessionKey || ent.name.replace(/\.json$/, ""),
        sessionId: t.sessionId || t.sessionKey || null, transcript: Array.isArray(t.transcript) ? t.transcript : [],
        retired: false, retiredAt: null, updatedAt: t.updatedAt || null, usage: t.usage || null,
        repoOverride: t.repo || null, raw: withText ? raw : null };
    }
  }
}

// Exact inverse of slugFor: decode every `~<hex>~` escape. Because `~` never appears literally in
// a slug (it is outside the kept set, so slugFor always escapes it), this is unambiguous.
function idFromSlug(slug) {
  return String(slug).replace(SLUG_ESC, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Full transcript for one session. Accepts (dir, id, sessionId) for the new layout, or
 *  (dir, legacyKey) for a legacy file. Returns null when nothing matches. */
export function readSession(dir, id, sessionId) {
  if (!dir) return null;
  // New layout: read the specific file directly.
  if (sessionId) {
    const abs = join(dir, slugFor(id), `${slugFor(sessionId)}.jsonl`);
    if (existsSync(abs)) {
      let raw = ""; try { raw = readFileSync(abs, "utf8"); } catch { return null; }
      const { transcript, retired, retiredAt } = parseJsonl(raw);
      const { repo, worktree } = parseWorkspaceId(id);
      return { workspaceId: id, sessionId, repo, worktree, transcript, retired, retiredAt,
        usage: null, updatedAt: (() => { try { return statSync(abs).mtimeMs; } catch { return null; } })() };
    }
  }
  // Legacy fallback: `id` is actually the flat key.
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, "_");
  const legacy = join(dir, `${safe}.json`);
  if (existsSync(legacy)) {
    try {
      const t = JSON.parse(readFileSync(legacy, "utf8"));
      return { workspaceId: t.repo ? workspaceId(t.repo, "main") : id, sessionId: t.sessionId || t.sessionKey || id,
        repo: t.repo || null, worktree: "main", transcript: Array.isArray(t.transcript) ? t.transcript : [],
        retired: false, retiredAt: null, usage: t.usage || null, updatedAt: t.updatedAt || null };
    } catch { return null; }
  }
  return null;
}

/** Locate one session by its id alone (the client holds a session key, not a workspace id).
 *  Scans the new layout, then legacy files. Returns the full transcript, or null. */
export function findSession(dir, sessionKey) {
  if (!dir || !sessionKey) return null;
  for (const s of eachSession(dir)) {
    // The client holds a key: for new sessions that IS the file's sessionId; for a legacy file
    // the flat key may differ from Claude's own sessionId, so match either.
    if (s.sessionId === sessionKey || s.legacyKey === sessionKey) {
      const id = s.repoOverride ? workspaceId(s.repoOverride, "main") : s.id;
      const { repo, worktree } = parseWorkspaceId(id);
      return { workspaceId: id, sessionId: s.sessionId || sessionKey, repo, worktree, transcript: s.transcript,
        retired: s.retired, retiredAt: s.retiredAt, usage: s.usage || null, updatedAt: s.updatedAt || null };
    }
  }
  return null;
}

/** Newest-first session summaries, optionally scoped to one repo. */
export function listSessions(dir, { repo = null } = {}) {
  const out = [];
  for (const s of eachSession(dir)) {
    const sum = summarise({ ...s, id: s.repoOverride ? workspaceId(s.repoOverride, "main") : s.id });
    if (repo && sum.repo !== repo) continue;
    out.push(sum);
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}

/** Full-text search across saved conversations, optionally one repo, with a snippet per hit. */
export function searchSessions(dir, query, repo = null) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const s of eachSession(dir, { withText: true })) {
    const sum = summarise({ ...s, id: s.repoOverride ? workspaceId(s.repoOverride, "main") : s.id });
    if (repo && sum.repo !== repo) continue;
    const text = (s.transcript || []).map((m) => (m && m.text) || "").join("\n");
    const lower = text.toLowerCase();
    const at = lower.indexOf(q);
    if (at === -1) continue;
    let matchCount = 0; for (let i = 0; (i = lower.indexOf(q, i)) !== -1; i += q.length) matchCount++;
    const snippet = text.slice(Math.max(0, at - 40), at + q.length + 60).replace(/\s+/g, " ").trim();
    out.push({ ...sum, matchCount, snippet });
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}

/** Every stored conversation with its FULL transcript, grouped by repo, oldest-first within a
 *  repo. The learning loop mines this; it spans both the new layout and legacy files. Each entry
 *  is shaped like the old flat records ({ sessionKey, sessionId, repo, updatedAt, usage,
 *  transcript }) so existing distillation code needs no reshaping. */
export function loadAllByRepo(dir) {
  const by = new Map();
  for (const s of eachSession(dir, { withText: false })) {
    const id = s.repoOverride ? workspaceId(s.repoOverride, "main") : s.id;
    const { repo, worktree } = parseWorkspaceId(id);
    const k = repo || "unknown";
    if (!by.has(k)) by.set(k, []);
    by.get(k).push({
      sessionKey: s.legacyKey || s.sessionId, sessionId: s.sessionId, repo: k, worktree,
      updatedAt: s.updatedAt || 0, usage: s.usage || null,
      transcript: (s.transcript || []).map(({ workspaceId: _w, ...turn }) => turn),
    });
  }
  for (const arr of by.values()) arr.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  return by;
}

/** Per-repo raw-conversation volume — the learning-loop substrate accumulated so far. */
export function dataSizes(dir) {
  const by = new Map();
  for (const s of eachSession(dir, { withText: true })) {
    const repo = (s.repoOverride) || parseWorkspaceId(s.id).repo || "(unknown)";
    const rec = by.get(repo) || { repo, bytes: 0, conversations: 0, turns: 0 };
    rec.bytes += Buffer.byteLength(s.raw || "", "utf8");
    rec.conversations += 1;
    // Prefer a stored usage.turns (legacy files carry it); otherwise count user turns (JSONL).
    rec.turns += s.usage?.turns ?? (s.transcript || []).filter((m) => m && m.role === "user").length;
    by.set(repo, rec);
  }
  return [...by.values()];
}
