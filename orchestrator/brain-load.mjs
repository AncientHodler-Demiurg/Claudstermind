// brain-load — injects the cross-repo brain digest into a new session (SessionStart hook).
// Reads each repo's brain/<repo>/state.md + the global worklog, prints a compact digest.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const BRAIN = resolve(__dir, "..", "brain");
const MAX_REPOS = 14, TAIL = 12;
const field = (md, l) => { const m = md.match(new RegExp("\\*\\*" + l + ":\\*\\*\\s*(.*)")); return m ? m[1].trim() : ""; };

try {
  if (!existsSync(BRAIN)) process.exit(0);
  const dirs = readdirSync(BRAIN, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(BRAIN, e.name, "_state.md")))
    .map((e) => ({ n: e.name, m: statSync(join(BRAIN, e.name, "_state.md")).mtimeMs })).sort((a, b) => b.m - a.m).slice(0, MAX_REPOS);
  const out = [];
  if (dirs.length) {
    out.push("🧠 Claudstermind brain — cross-repo work state (auto, most-recent first):");
    for (const { n } of dirs) {
      let md = ""; try { md = readFileSync(join(BRAIN, n, "_state.md"), "utf8"); } catch { continue; }
      const path = field(md, "path") || n, branch = field(md, "branch"), dirty = field(md, "uncommitted"), focus = field(md, "last focus"), updated = field(md, "updated");
      out.push(`  • ${path}: ${branch} · ${dirty} · ${updated ? updated.slice(0, 16).replace("T", " ") : ""}${focus && focus !== "(unknown)" ? `\n      last: ${focus}` : ""}`);
    }
  }
  const gl = join(BRAIN, "_worklog.md");
  if (existsSync(gl)) { const tail = readFileSync(gl, "utf8").split(/\r?\n/).filter((l) => l.startsWith("- ")).slice(-TAIL); if (tail.length) { out.push("\nRecent worklog:"); tail.forEach((l) => out.push("  " + l.replace(/^- /, ""))); } }
  if (out.length) { out.push("\n(Each repo's full knowledge base + auto-state: Claudstermind/brain/<repo>/. Maintained by brain-sync.)"); process.stdout.write(out.join("\n") + "\n"); }
} catch {}
process.exit(0);
