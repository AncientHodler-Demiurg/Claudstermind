// Phase-4 reorg DRY-RUN — read-only. Scans the workspace for the packages being renamed/re-scoped
// and reports every consumer that would need a re-pin. Mutates NOTHING. Run:
//   node Claudstermind/scripts/phase4-dryrun.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.WS_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The scope/name changes Phase 4 makes (from map.json movement notes).
const SCOPE_RENAMES = [
  { from: "@stoachain/ouronet-core", to: "@ouronet/ouronet-core" },
  { from: "@stoachain/ouronet-codex", to: "@ouronet/ouronet-codex" },
  { from: "@stoachain/dalos-crypto", to: "@ouronet/dalos-crypto" },
];
const SCOPE_PREFIX = { "@stoachain/": "→ (some become @ouronet/* — confirm per package)" };

const SKIP = new Set(["node_modules", ".git", "_Archive", ".next", "dist", "build", ".turbo"]);
const pkgs = [];
function walk(dir, depth = 0) {
  if (depth > 6) return;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === "package.json" && e.isFile()) {
      try { pkgs.push({ path: join(dir, e.name), json: JSON.parse(readFileSync(join(dir, e.name), "utf8")) }); } catch {}
    }
    if (e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name)) walk(join(dir, e.name), depth + 1);
  }
}
walk(ROOT);

const deps = (p) => ({ ...p.json.dependencies, ...p.json.devDependencies, ...p.json.peerDependencies });
const rel = (p) => p.path.replace(ROOT, "").replace(/^[\\/]/, "");

console.log(`Phase-4 dry-run over ${pkgs.length} package.json under ${ROOT}\n`);

console.log("## Consumers to RE-PIN (exact scoped-package renames)");
for (const { from, to } of SCOPE_RENAMES) {
  const users = pkgs.filter((p) => from in deps(p));
  console.log(`\n${from}  →  ${to}   (${users.length} consumer(s))`);
  for (const u of users) console.log(`  - ${rel(u)}   pins ${deps(u)[from]}`);
}

console.log("\n## All @stoachain/* references (review which move to @ouronet/*)");
const byScope = new Map();
for (const p of pkgs) for (const d of Object.keys(deps(p))) if (d.startsWith("@stoachain/")) {
  if (!byScope.has(d)) byScope.set(d, []); byScope.get(d).push(rel(p));
}
for (const [dep, users] of [...byScope].sort()) console.log(`  ${dep}  ← ${users.length}: ${users.map((u) => u.split(/[\\/]/).slice(0, 2).join("/")).join(", ")}`);

console.log("\n## Repos to create / rename on GitHub (HUMAN-ONLY — outward actions)");
console.log("  - create  github.com/AncientClients/Zarlo");
console.log("  - rename  DALOS_Crypto → dalos-crypto        (org: StoaChain → OuroborosNetwork)");
console.log("  - rename  Ouronet → ouronet-pact             (org: StoaChain → OuroborosNetwork; out of _Archive)");
console.log("  - split   stoa-js → stoa-chain-libs (@stoachain) + ouronet-libs (@ouronet, → OuroborosNetwork)");
console.log("  - rename  ancientholdings-website → ancientholdings-hub");
console.log("  - remote  chainweb-mining-client: push to the 'stoachain' remote (origin stays kadena-io)");
console.log("  - OuroborosFont → AncientHodler-Demiurg (no product remote; iosevka-src upstream)");
console.log("\nThis script changed nothing. Execution order + steps: docs/work/phase4-reorg/RUNBOOK.md");
