// The snapshot: the read-only state the bridge pushes up the tunnel, and the same
// data the local dashboard's read endpoints serve. One builder, so the online site
// shows byte-identical data to the local one.
//
// SECURITY: this payload crosses the network to the relay (and on to a modern admin's
// browser). It carries token METADATA only — names, expiry, where a secret is declared,
// whether the store file is present — NEVER a token value. enrich() checks file presence,
// not contents; no value is ever read into the snapshot.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { readCascade } from "./cascade.mjs";
import { allReposGitStatus } from "./gitStatus.mjs";
import { repoCommitActivity } from "./gitActivity.mjs";
import { readRegistry, enrich, groupTokens, tokenTotals } from "./tokenRegistry.mjs";
import { readActivity, readLastBackup } from "../orchestrator/activity.mjs";
import { listArchives } from "../orchestrator/archives.mjs";
import { readBackupConfig } from "../orchestrator/backupConfig.mjs";

const todayStr = () => new Date().toLocaleDateString("sv-SE");

// git log across every repo is ~6s, far too slow for the 15s snapshot push, so cache it.
// Commits are occasional; a 10-minute window is plenty fresh for a daily-activity view.
const ACT_TTL_MS = 10 * 60 * 1000;
let ACT_CACHE = { at: 0, key: "", data: null };
export function cachedActivity(repos, root, sinceDays = 30) {
  const now = Date.now();
  const key = `${(repos || []).length}:${sinceDays}`;
  if (ACT_CACHE.data && ACT_CACHE.key === key && now - ACT_CACHE.at < ACT_TTL_MS) return ACT_CACHE.data;
  let data;
  try { data = repoCommitActivity(repos, root, { sinceDays }); }
  catch (e) { data = { sinceDays, days: [], repos: [], totals: { commits: 0, churn: 0, byDay: {} }, error: String(e) }; }
  ACT_CACHE = { at: now, key, data };
  return data;
}

/** Recursive byte size of a brain folder, ignoring .git, bounded in depth. */
function dirSize(d, depth = 0) {
  let b = 0;
  if (depth > 6 || !existsSync(d)) return 0;
  try {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) b += dirSize(p, depth + 1);
      else try { b += statSync(p).size; } catch { /* skip unreadable */ }
    }
  } catch { /* skip unreadable dir */ }
  return b;
}

/** The Brain view payload — ported verbatim from the local /api/brain handler. */
export function readBrain(brainDir) {
  const out = { repos: [], worklog: [], totals: {}, daily: {} };
  let worklogLines = [];
  try { worklogLines = readFileSync(join(brainDir, "_worklog.md"), "utf8").split(/\r?\n/).filter((l) => l.startsWith("- ")); } catch {}
  try {
    const folders = readdirSync(brainDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "_TEMPLATE").map((e) => e.name);
    for (const key of folders) {
      const folder = join(brainDir, key);
      const hasState = existsSync(join(folder, "_state.md"));
      let g = () => "", updated = "";
      if (hasState) {
        const md = readFileSync(join(folder, "_state.md"), "utf8");
        g = (l) => (md.match(new RegExp("\\*\\*" + l + ":\\*\\*\\s*(.*)")) || [])[1]?.trim() || "";
        updated = g("updated");
      }
      const curated = readdirSync(folder).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
      const repoPath = g("path") || key;
      out.repos.push({
        repo: repoPath, key, branch: g("branch"), dirty: g("uncommitted"), focus: g("last focus"),
        updated, contextBytes: dirSize(folder), curatedFiles: curated.length, hasState,
        worklogCount: worklogLines.filter((l) => l.includes("**" + repoPath + "**")).length,
      });
    }
    out.repos.sort((a, b) => (b.updated || "").localeCompare(a.updated || "") || b.contextBytes - a.contextBytes);
  } catch {}
  out.worklog = worklogLines.slice(-40).reverse();
  try { out.daily = JSON.parse(readFileSync(join(brainDir, "_daily.json"), "utf8")); } catch { out.daily = {}; }
  out.totals = {
    contextBytes: out.repos.reduce((s, r) => s + r.contextBytes, 0),
    repos: out.repos.length, worklogEntries: worklogLines.length,
    withState: out.repos.filter((r) => r.hasState).length,
  };
  return out;
}

/** The Packages view payload — ported verbatim from the local /api/packages handler. */
export function scanPackages(root) {
  const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build", ".turbo", ".vite", ".pnpm-store", "_Archive", ".wasp", ".bee", "iosevka-src"]);
  const found = [];
  const repoAt = (dir) => { let d = dir; for (let i = 0; i < 12; i++) { if (existsSync(join(d, ".git"))) return d; const p = dirname(d); if (p === d) break; d = p; } return null; };
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries = []; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isFile() && e.name === "package.json")) {
      try {
        const pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        if (pj.name) {
          const repo = repoAt(dir);
          found.push({ name: pj.name, version: pj.version || "?", private: !!pj.private,
            scope: pj.name.startsWith("@") ? pj.name.split("/")[0] : "(unscoped)",
            repo: repo ? repo.slice(root.length).replace(/^[\\/]+/, "").replace(/\\/g, "/") : "?",
            isRoot: repo ? resolve(dir) === resolve(repo) : false });
        }
      } catch {}
    }
    for (const e of entries) if (e.isDirectory() && !SKIP.has(e.name)) walk(join(dir, e.name), depth + 1);
  };
  for (const eco of ["StoaChain", "OuroborosNetwork", "AncientPantheon", "AncientClients", "Tools", "Media"]) walk(join(root, eco), 0);
  const repos = {};
  for (const p of found) (repos[p.repo] = repos[p.repo] || { repo: p.repo, published: [], sub: [], appRoot: null });
  for (const p of found) {
    const r = repos[p.repo];
    if (!p.private) r.published.push(p);
    else if (p.isRoot) r.appRoot = p;
    else r.sub.push(p);
  }
  const repoList = Object.values(repos).sort((a, b) => (b.published.length - a.published.length) || a.repo.localeCompare(b.repo));
  const scopes = {};
  for (const p of found) if (!p.private) (scopes[p.scope] = scopes[p.scope] || []).push(p);
  for (const s in scopes) scopes[s].sort((a, b) => a.name.localeCompare(b.name));
  return { scopes, repos: repoList, totals: {
    published: found.filter((p) => !p.private).length,
    sub: found.filter((p) => p.private && !p.isRoot).length,
    apps: found.filter((p) => p.private && p.isRoot).length, all: found.length } };
}

/**
 * Assemble the full snapshot. Every section is defensively guarded so a missing file
 * (no map.json yet, no brain folder) degrades that section, never the whole push.
 * @param {{root, dataDir, brainDir, secretsDir}} paths
 */
export async function buildSnapshot(paths) {
  const { root, dataDir, brainDir, secretsDir } = paths;
  const snap = { at: new Date().toISOString() };

  let map = { repos: [] };
  try { map = JSON.parse(await readFile(join(dataDir, "map.json"), "utf8")); } catch {}
  snap.map = map;

  try { snap.git = allReposGitStatus(map.repos || [], root); } catch (e) { snap.git = { repos: [], totals: {}, error: String(e) }; }
  snap.activityDaily = cachedActivity(map.repos || [], root);   // cached; drives the Activity tab (+ public showcase)
  try { snap.brain = readBrain(brainDir); } catch (e) { snap.brain = { repos: [], worklog: [], totals: {}, error: String(e) }; }
  try { snap.packages = scanPackages(root); } catch (e) { snap.packages = { scopes: {}, repos: [], totals: {}, error: String(e) }; }
  try { snap.cascade = readCascade(root); } catch (e) { snap.cascade = { running: false, everRun: false, workspaces: [], repos: [], master: null, error: String(e) }; }
  try { snap.activity = { activity: readActivity(), lastBackup: readLastBackup() }; } catch (e) { snap.activity = { error: String(e) }; }

  try {
    const reg = readRegistry(dataDir);
    const tokens = enrich(reg.tokens, secretsDir, todayStr());   // metadata only — presence + expiry, no values
    snap.tokens = { meta: reg.meta || {}, tokens, grouped: groupTokens(tokens), totals: tokenTotals(tokens) };
  } catch (e) { snap.tokens = { meta: {}, tokens: [], grouped: {}, totals: {}, error: String(e) }; }

  try { const cfg = readBackupConfig(); snap.backupConfig = cfg; snap.backups = listArchives(cfg.location); }
  catch (e) { snap.backupConfig = {}; snap.backups = { available: false, archives: [], error: String(e) }; }

  return snap;
}
