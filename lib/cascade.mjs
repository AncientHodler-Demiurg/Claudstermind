// Aggregate a live master-pollinate cascade from the state files on disk.
//
//   D:/_Claude/.wasp/master-state.md              ← tier 1 (the suite run)
//   <workspace>/.wasp/state.md                    ← tier 2 (one per workspace)
//   <repo>/.wasp/state.md                         ← tier 3 (one per repo's pollinate)
//
// The dashboard is a READER of these files, never their owner — so a cascade an
// agent starts in a terminal (`/wasp:master-pollinate`) renders here exactly the
// same as one started from the Ops button. Both write these files; we just poll.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseWaspState } from "./waspState.mjs";

/**
 * Read the workspace list out of master-pollinate.yml.
 * A 6-line hand-rolled read of two known keys — not a YAML parser, and it does not
 * pretend to be one: anything more structural belongs to wasp itself.
 */
const unquote = (v) => v.trim().replace(/^["']|["']$/g, "");

function readWorkspaces(masterRoot) {
  const yml = join(masterRoot, ".wasp", "master-pollinate.yml");
  if (!existsSync(yml)) return [];
  const out = [];
  let inWorkspaces = false;
  for (const raw of readFileSync(yml, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (/^workspaces:/.test(line)) { inWorkspaces = true; continue; }
    if (inWorkspaces && /^\S/.test(line)) break;          // next top-level key
    if (!inWorkspaces) continue;

    // A list item starts with `-`; its keys may follow on that line or below it, in
    // either order. Values may be quoted (the sibling `scope:` keys in the real file
    // are). Getting this wrong drops a whole workspace SILENTLY, which reads as
    // "AncientPantheon isn't running" rather than "the dashboard can't see it".
    if (/^\s*-/.test(line)) out.push({ path: "", name: "" });
    const item = out[out.length - 1];
    if (!item) continue;

    const path = (line.match(/^\s*(?:-\s*)?path:\s*(.+)$/) || [])[1];
    if (path) item.path = unquote(path);
    const name = (line.match(/^\s*(?:-\s*)?name:\s*(.+)$/) || [])[1];
    if (name) item.name = unquote(name);
  }
  return out.filter((w) => w.path).map((w) => ({ ...w, name: w.name || w.path }));
}

/** Every repo inside a workspace that carries a .wasp/state.md (a tier-3 pollinate run). */
function repoStates(workspaceDir, workspaceName) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 2) return;                                 // ecosystem/<role>/<repo>
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === "node_modules" || e.name === ".git") continue;
      const sub = join(dir, e.name);
      const state = join(sub, ".wasp", "state.md");
      if (existsSync(state)) {
        const parsed = parseWaspState(state, e.name);
        if (parsed) found.push({ ...parsed, workspace: workspaceName });
      }
      walk(sub, depth + 1);
    }
  };
  walk(workspaceDir, 0);
  return found;
}

/**
 * The whole cascade, in one object.
 * `running` is true when ANY tier reports an in-flight run — an agent-driven
 * workspace cascade with no master run above it still lights the tab up.
 */
export function readCascade(masterRoot) {
  // No default: an implicit cwd-relative root silently returns an empty cascade, which
  // reads as "no run in progress" — the one lie this module must never tell.
  if (!masterRoot) throw new Error("readCascade(masterRoot) requires the master root path");

  const master = parseWaspState(join(masterRoot, ".wasp", "master-state.md"), "suite");

  const workspaces = [];
  const repos = [];
  for (const ws of readWorkspaces(masterRoot)) {
    const dir = join(masterRoot, ws.path);
    if (!existsSync(dir)) {
      // Declared in master-pollinate.yml but not on disk. Surface it — dropping it
      // would make a missing workspace indistinguishable from a quiescent one.
      workspaces.push({ name: ws.name, path: ws.path, state: null, configured: false, missing: true });
      continue;
    }
    const state = parseWaspState(join(dir, ".wasp", "state.md"), ws.name);
    workspaces.push({
      name: ws.name,
      path: ws.path,
      state,                                              // null ⇒ this workspace has never run
      configured: existsSync(join(dir, ".wasp", "cross-pollinate.yml")),
      missing: false,
    });
    repos.push(...repoStates(dir, ws.name));
  }

  const anyRunning =
    Boolean(master?.running) ||
    workspaces.some((w) => w.state?.running) ||
    repos.some((r) => r.running);

  // A run whose Status is still `in-progress` can already contain a ❌ package gate.
  // Surfacing only the run-level status there would show a clean "RUNNING" header
  // over a broken publish, so a failed GATE counts as a failure too.
  const brokeAGate = (s) => Boolean(s) && ((s.counts.failed || 0) > 0 || s.failed);
  const anyFailed =
    brokeAGate(master) ||
    workspaces.some((w) => brokeAGate(w.state)) ||
    repos.some(brokeAGate);

  // Whatever state file was touched most recently — the "as of" the UI shows.
  const lastUpdate = [master, ...workspaces.map((w) => w.state), ...repos]
    .filter(Boolean)
    .map((s) => s.lastUpdate || s.started || "")
    .sort()
    .pop() || null;

  return {
    running: anyRunning,
    failed: anyFailed,
    everRun: Boolean(master) || workspaces.some((w) => w.state) || repos.length > 0,
    lastUpdate,
    master,
    workspaces,
    repos,
  };
}
