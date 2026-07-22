// The learning loop — mine the raw per-repo conversation transcripts (.claude/workspace) into a
// distilled knowledge base per repo (brain/<key>/_distilled.md). Two modes, toggleable:
//   - heuristic (always available, no AI, deterministic): extract the asks + the outcomes.
//   - claude (opt-in, tracked usage): a one-shot summary into durable knowledge + skills.
// The raw transcripts are NEVER pruned — this only ADDS a distilled layer.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const repoKey = (repo) => String(repo || "unknown").split(/[\\/]/).pop() || "unknown";

/** Load every saved transcript, grouped by repo. */
export function loadTranscripts(transcriptDir) {
  const by = new Map();
  let files = [];
  try { files = readdirSync(transcriptDir); } catch { return by; }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const t = JSON.parse(readFileSync(join(transcriptDir, f), "utf8"));
      const k = t.repo || "unknown";
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(t);
    } catch { continue; }
  }
  for (const arr of by.values()) arr.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  return by;
}

/** One conversation → its asks + assistant conclusions (pure). */
export function conversationDigest(t) {
  const requests = (t.transcript || []).filter((m) => m && m.role === "user").map((m) => String(m.text).trim()).filter(Boolean);
  const conclusions = (t.transcript || []).filter((m) => m && m.role === "assistant").map((m) => String(m.text).trim()).filter(Boolean);
  return { sessionKey: t.sessionKey, updatedAt: t.updatedAt || 0, requests, conclusions };
}

/** Heuristic per-repo knowledge markdown from its conversations (deterministic, no AI). */
export function heuristicRepoMarkdown(repo, transcripts) {
  const digests = transcripts.map(conversationDigest);
  const totalTurns = digests.reduce((s, d) => s + d.requests.length, 0);
  const lines = [
    `# Distilled knowledge — ${repo}`,
    "",
    `_Heuristic digest of ${transcripts.length} conversation(s), ${totalTurns} request(s). Auto-generated; raw kept in .claude/workspace._`,
    "",
  ];
  for (const d of digests) {
    const when = d.updatedAt ? new Date(d.updatedAt).toISOString().slice(0, 16).replace("T", " ") : "";
    lines.push(`## ${when} · ${d.sessionKey || ""}`.trim());
    if (d.requests.length) {
      lines.push("**Asked:**");
      for (const r of d.requests) lines.push(`- ${firstLines(r, 2)}`);
    }
    if (d.conclusions.length) {
      // The last assistant turn is usually the summary/outcome.
      lines.push("**Outcome:**");
      lines.push(`- ${firstLines(d.conclusions[d.conclusions.length - 1], 4)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function firstLines(s, n) { return String(s).split(/\r?\n/).filter(Boolean).slice(0, n).join(" ").slice(0, 400); }

/** Write the distilled markdown for a repo into its brain folder. */
export function writeDistilled(brainDir, repo, markdown) {
  const dir = join(brainDir, repoKey(repo));
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "_distilled.md"), markdown); return { ok: true, path: join(dir, "_distilled.md") }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

/** Run the heuristic distiller across all (or one) repo. Returns a per-repo summary. */
export function runHeuristicDistill({ transcriptDir, brainDir, repo }) {
  const by = loadTranscripts(transcriptDir);
  const out = [];
  for (const [r, ts] of by) {
    if (repo && r !== repo) continue;
    const md = heuristicRepoMarkdown(r, ts);
    const w = writeDistilled(brainDir, r, md);
    out.push({ repo: r, key: repoKey(r), conversations: ts.length, bytes: Buffer.byteLength(md, "utf8"), wrote: w.ok });
  }
  return { mode: "heuristic", repos: out };
}

/** The Claude summarization prompt for one repo's conversations. */
export function claudePrompt(repo, transcripts) {
  const convos = transcripts.map((t, i) => {
    const body = (t.transcript || []).map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${String(m.text).slice(0, 4000)}`).join("\n");
    return `--- Conversation ${i + 1} ---\n${body}`;
  }).join("\n\n");
  return `You are building a durable knowledge base for the repository "${repo}". From the raw agent conversations below, extract ONLY lasting, reusable knowledge — architecture facts, decisions and their rationale, conventions, gotchas, and repeatable "skills" (step-by-step procedures that worked). Omit chit-chat and one-off state. Output concise Markdown with sections: "## Facts", "## Decisions", "## Gotchas", "## Skills". Be specific and short.\n\n${convos}`;
}

// ---- config + usage persistence (on the work machine, under .claude) ----
export function readDistillConfig(claudeDir) {
  try { return { claudeEnabled: false, ...JSON.parse(readFileSync(join(claudeDir, "distill-config.json"), "utf8")) }; }
  catch { return { claudeEnabled: false }; }
}
export function writeDistillConfig(claudeDir, cfg) {
  try { if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true }); writeFileSync(join(claudeDir, "distill-config.json"), JSON.stringify(cfg, null, 2)); return true; } catch { return false; }
}
export function readDistillUsage(claudeDir) {
  try { return JSON.parse(readFileSync(join(claudeDir, "distill-usage.json"), "utf8")); }
  catch { return { runs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, lastRun: null }; }
}
export function addDistillUsage(claudeDir, usage, costUsd) {
  const u = readDistillUsage(claudeDir);
  u.runs += 1;
  u.inputTokens += usage?.input_tokens || 0;
  u.outputTokens += usage?.output_tokens || 0;
  u.costUsd += typeof costUsd === "number" ? costUsd : 0;
  u.lastRun = Date.now();
  try { if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true }); writeFileSync(join(claudeDir, "distill-usage.json"), JSON.stringify(u, null, 2)); } catch {}
  return u;
}

/** Claude-mode distiller — a one-shot summary per repo, no tools (summary only), usage tracked.
 *  `sdkQuery` injectable for tests; `cleanEnv` strips host secrets before spawning. */
export async function runClaudeDistill({ transcriptDir, brainDir, claudeDir, root, repo, token, sdkQuery, cleanEnv }) {
  const by = loadTranscripts(transcriptDir);
  const runQuery = sdkQuery || (await import("@anthropic-ai/claude-agent-sdk")).query;
  const baseEnv = cleanEnv ? cleanEnv(process.env) : { ...process.env };
  const out = [];
  for (const [r, ts] of by) {
    if (repo && r !== repo) continue;
    const prompt = claudePrompt(r, ts);
    let md = "", usage = null, cost = 0, err = null;
    try {
      const q = runQuery({
        prompt: (async function* () { yield { type: "user", message: { role: "user", content: prompt } }; })(),
        options: {
          cwd: root,
          canUseTool: async () => ({ behavior: "deny", message: "distillation is summary-only — no tools" }),
          includePartialMessages: false,
          env: token ? { ...baseEnv, CLAUDE_CODE_OAUTH_TOKEN: token } : baseEnv,
        },
      });
      for await (const msg of q) {
        if (msg.type === "assistant") md += (msg.message?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
        if (msg.type === "result") { usage = msg.usage || null; cost = msg.total_cost_usd || 0; }
      }
    } catch (e) { err = String(e && e.message || e); }
    if (err) { out.push({ repo: r, key: repoKey(r), error: err }); continue; }
    const w = writeDistilled(brainDir, r, `# Distilled knowledge — ${r}\n\n_Claude-distilled from ${ts.length} conversation(s). Raw kept in .claude/workspace._\n\n${md.trim()}`);
    const u = usage ? addDistillUsage(claudeDir, usage, cost) : null;
    out.push({ repo: r, key: repoKey(r), bytes: Buffer.byteLength(md, "utf8"), wrote: w.ok, usage, cost });
  }
  return { mode: "claude", repos: out, usage: readDistillUsage(claudeDir) };
}

export { repoKey };
