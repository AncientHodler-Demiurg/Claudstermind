// brain-sync — auto-writeback of work state into each repo's own brain folder.
//
// Stop hook. For the repo the session is working in, writes:
//   Claudstermind/brain/<repo>/state.md    — current auto snapshot (overwritten)
//   Claudstermind/brain/<repo>/worklog.md  — this repo's chronological log
//   Claudstermind/brain/_worklog.md         — global cross-repo log (one line per change)
// The same brain/<repo>/ folder also holds the CURATED knowledge (ARCHITECTURE.md,
// LEARNINGS.md, etc.) an agent writes over time — so one folder per repo is the whole brain.
// Mechanical (git) → zero tokens, fails silent.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, readdirSync, openSync, readSync, closeSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dir = dirname(fileURLToPath(import.meta.url));
const CLAUDE_ROOT = resolve(__dir, "..", "..");
const BRAIN = join(CLAUDE_ROOT, "Claudstermind", "brain");
const GLOBAL_LOG = join(BRAIN, "_worklog.md");

function readStdin() { return new Promise((res) => { let b = ""; process.stdin.on("data", (c) => (b += c)); process.stdin.on("end", () => res(b)); setTimeout(() => res(b), 400); }); }
function git(repo, args) { try { return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } }
function repoRoot(cwd) { let d = resolve(cwd); for (let i = 0; i < 8; i++) { if (existsSync(join(d, ".git"))) return d; const p = dirname(d); if (p === d) break; d = p; } return null; }
function lastUserFocus(tp) {
  try {
    if (!tp || !existsSync(tp)) return "";
    const size = statSync(tp).size, want = Math.min(size, 262144), fd = openSync(tp, "r");
    const buf = Buffer.alloc(want); readSync(fd, buf, 0, want, size - want); closeSync(fd);
    const lines = buf.toString("utf8").split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try { const o = JSON.parse(lines[i]); const role = o.role || o.type || o.message?.role;
        if (role === "user") { let t = o.content ?? o.text ?? o.message?.content ?? ""; if (Array.isArray(t)) t = t.map((x) => (typeof x === "string" ? x : x.text || "")).join(" ");
          t = String(t).replace(/\s+/g, " ").trim(); if (t && !t.startsWith("[SYSTEM") && !t.startsWith("<")) return t.slice(0, 160); } } catch {}
    }
  } catch {}
  return "";
}

(async () => {
  try {
    const raw = await readStdin(); let p = {}; try { p = raw ? JSON.parse(raw) : {}; } catch {}
    const cwd = p.cwd || process.cwd();
    const repo = repoRoot(cwd); if (!repo) return done();
    const rel = repo.startsWith(CLAUDE_ROOT) ? repo.slice(CLAUDE_ROOT.length).replace(/^[\\/]+/, "").replace(/\\/g, "/") : basename(repo);
    if (rel === "Claudstermind") return done();
    const key = basename(repo);                              // one folder per repo, keyed by basename
    const folder = join(BRAIN, key); mkdirSync(folder, { recursive: true });

    const branch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]) || "?";
    const head = git(repo, ["rev-parse", "--short", "HEAD"]) || "?";
    const headMsg = git(repo, ["log", "-1", "--format=%s"]) || "";
    const dirty = git(repo, ["status", "--porcelain"]).split(/\r?\n/).filter(Boolean);
    const diffstat = git(repo, ["diff", "--shortstat"]);
    const focus = lastUserFocus(p.transcript_path || p.transcriptPath);

    const statePath = join(folder, "_state.md");   // underscore-prefixed so it never collides with a curated STATE.md (Windows is case-insensitive)
    const marker = `${head}|${dirty.length}`;
    let last = ""; try { last = readFileSync(statePath, "utf8").match(/<!--marker:(.*?)-->/)?.[1] || ""; } catch {}
    const changed = marker !== last;
    const ts = new Date().toISOString();

    writeFileSync(statePath, `<!--marker:${marker}-->
# ${rel} — state (auto)

- **path:** ${rel}
- **updated:** ${ts}
- **branch:** ${branch} @ ${head}${headMsg ? `  ("${headMsg}")` : ""}
- **uncommitted:** ${dirty.length} file(s)${diffstat ? "  ·  " + diffstat : ""}
- **last focus:** ${focus || "(unknown)"}

${dirty.length ? "### working changes\n" + dirty.slice(0, 40).map((l) => "- `" + l.trim() + "`").join("\n") + "\n" : ""}> Curated knowledge for this repo lives alongside this file in brain/${key}/ (ARCHITECTURE.md, LEARNINGS.md, …).
`);

    if (changed) {
      const line = `- ${ts} · **${rel}** · ${branch}@${head} · ${dirty.length} dirty${diffstat ? " (" + diffstat.replace(/^\s*/, "") + ")" : ""}${focus ? " · " + focus : ""}\n`;
      const repoLog = join(folder, "_worklog.md");
      if (!existsSync(repoLog)) writeFileSync(repoLog, `# ${rel} — worklog\n\n`);
      appendFileSync(repoLog, line);
      if (!existsSync(GLOBAL_LOG)) writeFileSync(GLOBAL_LOG, "# Claudstermind global worklog\n\n> Auto-appended by brain-sync. One line per change across all repos.\n\n");
      appendFileSync(GLOBAL_LOG, line);

      // ---- daily rollup: how much knowledge the brain holds each day + what was worked on ----
      try {
        const dailyPath = join(BRAIN, "_daily.json");
        const day = ts.slice(0, 10);
        let daily = {}; try { daily = JSON.parse(readFileSync(dailyPath, "utf8")); } catch {}
        // Measure the SAME thing the dashboard's "total knowledge base" does: the sum of
        // the per-repo brain folders (excluding the _TEMPLATE scaffolding and top-level
        // bookkeeping files), so the daily log and the total always agree.
        const size = (d) => { let b = 0; try { for (const e of readdirSync(d, { withFileTypes: true })) {
          if (e.name === ".git") continue; const p = join(d, e.name);
          if (e.isDirectory()) b += size(p); else try { b += statSync(p).size; } catch {} } } catch {} return b; };
        let brainBytes = 0;
        try { for (const e of readdirSync(BRAIN, { withFileTypes: true })) {
          if (e.isDirectory() && e.name !== "_TEMPLATE") brainBytes += size(join(BRAIN, e.name)); } } catch {}
        const e = daily[day] || { kb: 0, changes: 0, repos: [], commits: [] };
        e.kb = brainBytes;
        e.changes = (e.changes || 0) + 1;
        if (!e.repos.includes(rel)) e.repos.push(rel);
        if (headMsg && !e.commits.includes(headMsg)) e.commits.push(headMsg);
        daily[day] = e;
        writeFileSync(dailyPath, JSON.stringify(daily, null, 2));
      } catch {}
    }
  } catch {}
  done();
})();
function done() { process.exit(0); }
