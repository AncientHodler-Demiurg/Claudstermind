// Activity heartbeat — the target of Claude Code hooks.
//
// Wire this into hooks (see README) on SessionStart / PostToolUse / Stop. On each
// call it records a per-session heartbeat so the orchestrator knows an agent is
// working, and in WHICH repo. On Stop/SessionEnd it marks the session stopped so
// backups/cascades can proceed the moment work ceases.
//
// Reads the hook payload as JSON on stdin (Claude Code passes session_id, cwd,
// hook_event_name, tool_name, ...). Fails silent — a broken hook must never block
// the user's tools.
import { writeFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTIVITY_DIR, CLAUDE_ROOT, ensureDir } from "./activity.mjs";

function readStdin() {
  return new Promise((res) => {
    let b = "";
    process.stdin.on("data", (c) => (b += c));
    process.stdin.on("end", () => res(b));
    setTimeout(() => res(b), 400); // don't hang if no stdin
  });
}

// Walk up from cwd to find the enclosing git repo; label it by its path under _Claude.
function repoFor(cwd) {
  if (!cwd) return null;
  let dir = resolve(cwd);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, ".git"))) {
      const rel = dir.startsWith(CLAUDE_ROOT) ? dir.slice(CLAUDE_ROOT.length).replace(/^[\\/]+/, "") : basename(dir);
      return rel || basename(dir);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwd.startsWith(CLAUDE_ROOT) ? (cwd.slice(CLAUDE_ROOT.length).replace(/^[\\/]+/, "").split(/[\\/]/)[0] || null) : null;
}

(async () => {
  try {
    ensureDir();
    const raw = await readStdin();
    let p = {};
    try { p = raw ? JSON.parse(raw) : {}; } catch {}
    const sessionId = p.session_id || p.sessionId || "unknown";
    const event = p.hook_event_name || p.hookEventName || process.argv[2] || "tick";
    const cwd = p.cwd || process.cwd();
    const file = join(ACTIVITY_DIR, `${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
    const stopping = /stop|sessionend|end/i.test(event);
    writeFileSync(file, JSON.stringify({
      sessionId, cwd, repo: repoFor(cwd), tool: p.tool_name || p.toolName || null,
      event, ts: Date.now(), status: stopping ? "stopped" : "active",
    }, null, 0));
  } catch {
    // never block the user's tooling
  }
  process.exit(0);
})();
