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
import { writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTIVITY_DIR, CLAUDE_ROOT, ensureDir } from "./activity.mjs";

// A short, human "what is the agent doing right now" line, from the tool's own input.
// This is what the Ops tab surfaces per repo. Kept terse and non-sensitive-ish.
function actionDetail(tool, input) {
  if (!input || typeof input !== "object") return null;
  const base = (p) => (typeof p === "string" ? p.split(/[\\/]/).pop() : null);
  switch (tool) {
    case "Write": case "Edit": case "MultiEdit": case "NotebookEdit":
      return input.file_path ? "editing " + base(input.file_path) : "editing a file";
    case "Read": return input.file_path ? "reading " + base(input.file_path) : "reading";
    case "Bash": return input.command ? "run: " + String(input.command).replace(/\s+/g, " ").trim().slice(0, 64) : "running a command";
    case "Grep": return input.pattern ? "search: " + String(input.pattern).slice(0, 40) : "searching";
    case "Glob": return input.pattern ? "glob: " + String(input.pattern).slice(0, 40) : "globbing";
    case "Task": return "delegating to a subagent";
    default: return tool || null;
  }
}

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

    // ONLY a real session end stops the session. "Stop" fires at the end of EVERY
    // assistant turn — treating it as "stopped" made the suite flip to idle between
    // turns while an agent was plainly still working. So Stop is now just a heartbeat
    // (it refreshes ts, keeping the session live); the session goes idle only on
    // SessionEnd, or after STALE_MS of genuine silence.
    const stopping = /sessionend/i.test(event);
    const tool = p.tool_name || p.toolName || null;
    const input = p.tool_input || p.toolInput || null;

    // Carry the last known action forward across turns: Stop / SessionStart carry no
    // tool, so keep whatever the previous heartbeat captured rather than blanking it.
    let prev = {};
    try { prev = JSON.parse(readFileSync(file, "utf8")); } catch {}
    const detail = actionDetail(tool, input) || (tool ? tool : (prev.detail || null));

    writeFileSync(file, JSON.stringify({
      sessionId, cwd, repo: repoFor(cwd), tool: tool || prev.tool || null,
      detail, event, ts: Date.now(), status: stopping ? "stopped" : "active",
    }, null, 0));
  } catch {
    // never block the user's tooling
  }
  process.exit(0);
})();
