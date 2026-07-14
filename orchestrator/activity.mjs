// Activity registry reader — the "is any agent working?" oracle.
//
// Claude Code hooks (see heartbeat.mjs + README) drop a per-session JSON file in
// ACTIVITY_DIR every time a tool runs, and mark it stopped on session end. This
// module reads those heartbeats and decides whether the suite is IDLE (safe to
// back up / cascade) or ACTIVE (an agent is mid-work somewhere).
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
// Central registry lives above Claudstermind so any session in any repo writes to one place.
export const CLAUDE_ROOT = resolve(__dir, "..", "..");            // D:/_Claude
export const ACTIVITY_DIR = join(CLAUDE_ROOT, ".claude", "activity");
export const STALE_MS = 120_000; // a heartbeat older than 2 min with no "stopped" mark is treated as a dead session

export function ensureDir() {
  if (!existsSync(ACTIVITY_DIR)) mkdirSync(ACTIVITY_DIR, { recursive: true });
}

/** Read all session heartbeats and compute suite activity. */
export function readActivity() {
  ensureDir();
  const now = Date.now();
  const sessions = [];
  let files = [];
  try { files = readdirSync(ACTIVITY_DIR).filter((f) => f.endsWith(".json")); } catch {}
  for (const f of files) {
    try {
      const s = JSON.parse(readFileSync(join(ACTIVITY_DIR, f), "utf8"));
      // A file is a session because it LOOKS like one — not because nobody remembered
      // to denylist it. This dir also holds bookkeeping (backups.json, last-backup.json),
      // and this gate is what stands between an agent's live edits and `tar -xf`; the
      // next bookkeeping file dropped in here must not silently become a "session".
      if (!s.sessionId || typeof s.ts !== "number") continue;
      const ageMs = now - s.ts;
      const live = s.status !== "stopped" && ageMs < STALE_MS;
      sessions.push({ sessionId: s.sessionId, repo: s.repo || null, cwd: s.cwd || null, tool: s.tool || null, event: s.event || null, ageSeconds: Math.round(ageMs / 1000), status: s.status || "active", live });
    } catch {}
  }
  const liveSessions = sessions.filter((s) => s.live);
  const activeRepos = [...new Set(liveSessions.map((s) => s.repo).filter(Boolean))];
  const newestLive = liveSessions.reduce((m, s) => Math.min(m, s.ageSeconds), Infinity);
  return {
    active: liveSessions.length > 0,
    activeRepos,
    liveSessionCount: liveSessions.length,
    idleSeconds: liveSessions.length ? 0 : (sessions.length ? Math.min(...sessions.map((s) => s.ageSeconds)) : null),
    lastActivitySeconds: newestLive === Infinity ? (sessions.length ? Math.min(...sessions.map((s) => s.ageSeconds)) : null) : newestLive,
    sessions,
    checkedAt: new Date().toISOString(),
  };
}

/** Read the last-backup record if present. */
export function readLastBackup() {
  ensureDir();
  const p = join(ACTIVITY_DIR, "last-backup.json");
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}
