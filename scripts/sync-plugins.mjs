#!/usr/bin/env node
// Re-vendor bee / wasp / nectar from an upstream checkout.
//
//   node scripts/sync-plugins.mjs [--from <path-to-wasp-dev>] [--check]
//
// WHY A SCRIPT AND NOT A SUBMODULE. A submodule makes every clone a two-step and every CI a
// surprise; a subtree buries the update in a merge commit nobody reads. These are ~7.6 MB of
// markdown that change when George ships a new bee — a copy, with the source commit written down,
// is honest about what it is and leaves `git diff` readable, which is what you actually want to see
// before accepting someone else's workflow changes into your agent.
//
// `--check` reports drift without writing, so CI (or you, before a release) can answer "is our
// vendored bee still the upstream one?" without touching the tree.
import { cpSync, existsSync, readFileSync, writeFileSync, rmSync, chmodSync, statSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));
const DEST = join(ROOT, "plugins");
const NAMES = ["bee", "wasp", "nectar"];
const DEFAULT_FROM = resolve(ROOT, "..", "Tools", "wasp-dev");

const args = process.argv.slice(2);
const check = args.includes("--check");
const fromIdx = args.indexOf("--from");
const FROM = fromIdx >= 0 ? resolve(args[fromIdx + 1]) : DEFAULT_FROM;

const git = (...a) => { try { return execFileSync("git", ["-C", FROM, ...a], { encoding: "utf8" }).trim(); } catch { return ""; } };

if (!existsSync(FROM)) {
  console.error(`upstream checkout not found: ${FROM}\n  pass --from <path> (a clone of the wasp-dev repo)`);
  process.exit(2);
}

const manifestPath = join(DEST, ".vendor.json");
const prev = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
const commit = git("rev-parse", "HEAD");
const origin = git("remote", "get-url", "origin");

const versionOf = (base, name) => {
  try { return JSON.parse(readFileSync(join(base, name, ".claude-plugin", "plugin.json"), "utf8")).version || null; }
  catch { return null; }
};

/* A HOOK THE SHELL CANNOT EXECUTE IS NOT A HOOK. `cpSync` faithfully copies the source's mode, and
   the source's mode is wrong: git only records the executable bit for files committed as 100755, and
   upstream's are 100644 — measured, 0 of 18. So every hook these plugins register failed the instant
   it fired, with one line of "Permission denied" and nothing else. Upstream's packaging is upstream's
   business right up until we vendor it and ship it as part of ourselves; then it is ours. */
const shellScripts = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) shellScripts(p, out);
    else if (e.isFile() && p.endsWith(".sh")) out.push(p);
  }
  return out;
};
const notExecutable = (dir) => shellScripts(dir).filter((f) => !(statSync(f).mode & 0o111));

if (check) {
  let drift = 0;
  for (const n of NAMES) {
    const up = versionOf(join(FROM, "plugins"), n), here = versionOf(DEST, n);
    if (up !== here) { console.log(`DRIFT  ${n}: vendored ${here} vs upstream ${up}`); drift++; }
    else console.log(`ok     ${n}: ${here}`);
  }
  if (prev?.commit && commit && prev.commit !== commit) { console.log(`DRIFT  upstream commit ${commit.slice(0,8)} vs vendored ${prev.commit.slice(0,8)}`); drift++; }
  const dead = notExecutable(DEST);
  if (dead.length) { console.log(`DRIFT  ${dead.length} hook script(s) not executable — they fail with "Permission denied" the first time they fire:`); for (const f of dead.slice(0, 5)) console.log(`         ${f}`); drift++; }
  process.exit(drift ? 1 : 0);
}

for (const n of NAMES) {
  const src = join(FROM, "plugins", n);
  if (!existsSync(src)) { console.error(`skip ${n}: not in ${src}`); continue; }
  rmSync(join(DEST, n), { recursive: true, force: true });
  cpSync(src, join(DEST, n), { recursive: true });
  const fixed = notExecutable(join(DEST, n));
  for (const f of fixed) chmodSync(f, statSync(f).mode | 0o111);
  console.log(`vendored ${n}@${versionOf(join(FROM, "plugins"), n)}${fixed.length ? ` (+x on ${fixed.length} hook script${fixed.length === 1 ? "" : "s"})` : ""}`);
}

const out = {
  note: "VENDORED. Do not hand-edit — run scripts/sync-plugins.mjs. See plugins/README.md.",
  upstream: origin || null, syncedFrom: FROM, syncedAt: new Date().toISOString(), commit: commit || null,
  plugins: Object.fromEntries(NAMES.map((n) => [n, {
    version: versionOf(DEST, n),
    author: (() => { try { const m = JSON.parse(readFileSync(join(DEST, n, ".claude-plugin", "plugin.json"), "utf8")); return m.author?.name || m.author || null; } catch { return null; } })(),
  }])),
};
writeFileSync(manifestPath, JSON.stringify(out, null, 2) + "\n");
console.log(`\nwrote plugins/.vendor.json @ ${commit.slice(0, 8) || "(no git)"}`);
