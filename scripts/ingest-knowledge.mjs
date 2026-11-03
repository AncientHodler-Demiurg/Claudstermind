#!/usr/bin/env node
// scripts/ingest-knowledge.mjs — the real, committed ingestion engine: distill a workspace's
// already-archived conversation history into the exocortex knowledge store (facts/decisions).
//
// This REPLACES a one-off, never-committed pilot script from an earlier session (ran once against
// Mnemosyne/Khronoton, $3.57, 212 items extracted, then the script itself was lost — see
// lib/knowledgeIngest.mjs's own header for the full story). Same mechanics, this time saved.
//
// COSTS REAL MONEY — one Claude call per 200-row chunk of archived conversation, same shape as the
// existing "Distil with Claude" button (lib/distill.mjs) already uses. DRY RUN BY DEFAULT: shows
// how many rows/chunks a repo has and a rough cost estimate (from the ACTUAL pilot's own measured
// rate), changes nothing, until you pass --confirm.
//
//   node scripts/ingest-knowledge.mjs --repo <repo> [--worktree main] [--confirm]
//
// Examples:
//   node scripts/ingest-knowledge.mjs --repo AncientPantheon/automatons/Mnemosyne
//   node scripts/ingest-knowledge.mjs --repo Claudstermind --worktree main --confirm
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { workspaceDir, workspaceId as makeWorkspaceId } from "../lib/storage.mjs";
import { readWorkspaceRows, chunkRows, runKnowledgeIngest, INGEST_CHUNK_ROWS } from "../lib/knowledgeIngest.mjs";
import { readClaudeKeys } from "../lib/claudeKeys.mjs";
import { readClaudeToken } from "../lib/workspace.mjs";
import { cleanClaudeEnv } from "../lib/claudeSession.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dir, "..");
const MASTER_ROOT = resolve(__dir, "..", "..");   // same one level up as scripts/migrate-brain.mjs / dashboard/server.mjs's MASTER_ROOT

const argv = process.argv.slice(2);
const flagValue = (name) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
const CONFIRM = argv.includes("--confirm");
const REPO = flagValue("--repo");
const WORKTREE = flagValue("--worktree") || "main";
const SECRETS_DIR = flagValue("--secrets-dir") || join(MASTER_ROOT, ".secrets");
const TRANSCRIPT_DIR = flagValue("--transcript-dir") || join(MASTER_ROOT, ".claude", "workspace");

if (!REPO) {
  console.error("usage: node scripts/ingest-knowledge.mjs --repo <repo> [--worktree main] [--confirm]");
  console.error("  --confirm           actually run (costs real money) — without it, dry-run only");
  console.error("  --secrets-dir, --transcript-dir   override the default MASTER_ROOT-relative paths");
  process.exit(1);
}

// The pilot's own measured rate ($3.5741 / 2,621 rows across 14 real chunks) — the only real-world
// data point this estimate can be grounded in. Shown as a rough per-repo projection, clearly labeled
// as an estimate, never as a promise — the SDK's own total_cost_usd per chunk is what actually counts,
// reported live once a real run starts.
const PILOT_COST_PER_ROW = 3.5741 / 2621;

async function main() {
  const id = makeWorkspaceId(REPO, WORKTREE);
  const wsDir = workspaceDir(TRANSCRIPT_DIR, id);
  const rows = readWorkspaceRows(wsDir);
  const chunks = chunkRows(rows, INGEST_CHUNK_ROWS);
  const estCost = rows.length * PILOT_COST_PER_ROW;

  console.log(`workspace: ${id}`);
  console.log(`archived rows: ${rows.length}  (${chunks.length} chunk(s) of up to ${INGEST_CHUNK_ROWS} rows = ${chunks.length} model call(s))`);
  console.log(`rough cost estimate: $${estCost.toFixed(4)}  (from the earlier pilot's own measured rate — not a guarantee; the real total is reported live below)`);
  if (!rows.length) { console.log("\nNothing archived for this workspace yet — nothing to ingest."); return; }

  if (!CONFIRM) {
    console.log("\nDRY RUN — nothing was called, nothing was written. Pass --confirm to actually run this (it will spend real money).");
    return;
  }

  const keys = readClaudeKeys(SECRETS_DIR);
  const token = (keys[0] && keys[0].token) || readClaudeToken(SECRETS_DIR);
  if (!token) { console.error(`No Claude token found under ${SECRETS_DIR} — run \`claude setup-token\` first.`); process.exit(1); }

  console.log(`\nRunning for real against ${chunks.length} chunk(s)...\n`);
  const result = await runKnowledgeIngest({
    workspaceDir: wsDir, repo: REPO, root: REPO_ROOT, token, cleanEnv: cleanClaudeEnv,
    onChunk: (i, total, r) => {
      const status = r.error ? `ERROR: ${r.error}` : `+${r.written.facts} fact(s), +${r.written.decisions} decision(s)`;
      console.log(`  chunk ${i}/${total} (${r.rows} rows) — $${r.cost.toFixed(4)} — ${status}`);
    },
  });

  console.log(`\nDone. ${result.chunksRun} chunk(s) run, ${result.factsWritten} fact(s) + ${result.decisionsWritten} decision(s) written, real total cost: $${result.totalCost.toFixed(4)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
