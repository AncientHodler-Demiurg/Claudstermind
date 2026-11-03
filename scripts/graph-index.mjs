#!/usr/bin/env node
// scripts/graph-index.mjs — build a REAL graph.json for a real repo.
//
// The exocortex code-graph feature (Ch.3.1-3.5) shipped extraction (lib/codeGraphExtract.mjs),
// graph assembly (lib/codeGraph.mjs), incremental re-indexing (lib/codeGraphIndex.mjs), and a
// standalone viewer (dashboard/public/graph.html) — all tested, all working. What never existed
// was the thing that actually WALKS a real repo's files and writes the result anywhere:
// scripts/graph-smoke.mjs only ever fed the viewer a hardcoded 4-node fixture (its own job is
// confirming the viewer renders, not producing real data). "I wanted to see how the new exocortex
// and graphs work" surfaced that gap — this is the missing middle step.
//
//   node scripts/graph-index.mjs <repoPath> [outputPath]
//
// Walks <repoPath> for .js/.jsx/.mjs/.ts/.tsx files (skipping node_modules/.git/dist/build-ish
// dirs and any symlinked/unreadable entries), extracts each with codeGraphExtract.mjs, assembles
// ONE graph with codeGraph.mjs#buildGraph (idempotent per node id — built for exactly this: many
// files' batches merged into one graph), and writes the node-link JSON graph.html already knows
// how to read (see codeGraph.mjs's own header for why that exact shape).
//
// outputPath defaults to dashboard/public/graph.json — served statically, so /graph.html's
// default fetch (`./graph.json`, no `?src=` needed) picks it up immediately. Pass a different path
// to build a graph without touching the public dir (e.g. to compare two repos side by side via
// `?src=`).
import { readdirSync, statSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { join, relative, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createExtractor } from "../lib/codeGraphExtract.mjs";
import { buildGraph, toNodeLink } from "../lib/codeGraph.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", ".worktrees", "vendor"]);
const EXTS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const abs = join(dir, name);
    let st;
    try { st = statSync(abs); } catch { continue; }   // a broken symlink, permission denied, etc. — skip, never crash the whole run
    if (st.isDirectory()) walk(abs, out);
    else if (st.isFile() && EXTS.has(extname(name))) out.push(abs);
  }
  return out;
}

async function main() {
  const repoArg = process.argv[2];
  if (!repoArg) {
    console.error("usage: node scripts/graph-index.mjs <repoPath> [outputPath]");
    console.error("  outputPath defaults to dashboard/public/graph.json");
    process.exit(1);
  }
  const repoPath = resolve(repoArg);
  let repoReal;
  try { repoReal = realpathSync(repoPath); } catch { console.error(`not found: ${repoPath}`); process.exit(1); }
  const outputPath = process.argv[3] ? resolve(process.argv[3]) : join(__dir, "..", "dashboard", "public", "graph.json");

  const files = walk(repoReal, []);
  console.log(`extracting ${files.length} files from ${repoReal}…`);

  const extractor = await createExtractor();
  const allNodes = [], allEdges = [];
  let failed = 0;
  for (const abs of files) {
    const rel = relative(repoReal, abs);
    let source;
    try { source = readFileSync(abs, "utf8"); } catch { failed++; continue; }
    let batch;
    try { batch = extractor.extractFile(rel, source); } catch { failed++; continue; }   // extractFile itself already degrades broken/unsupported files to an empty batch; this is belt-and-suspenders
    if (batch && Array.isArray(batch.nodes)) allNodes.push(...batch.nodes);
    if (batch && Array.isArray(batch.edges)) allEdges.push(...batch.edges);
  }

  const graph = buildGraph({ nodes: allNodes, edges: allEdges });
  const nodeLink = toNodeLink(graph);
  writeFileSync(outputPath, JSON.stringify(nodeLink));
  console.log(`wrote ${outputPath}: ${nodeLink.nodes.length} nodes, ${nodeLink.links.length} links`
    + (failed ? ` (${failed}/${files.length} files failed to read/extract, skipped)` : ""));
}

main().catch((e) => { console.error(e); process.exit(1); });
