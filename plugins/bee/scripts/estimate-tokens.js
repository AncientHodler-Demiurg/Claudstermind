#!/usr/bin/env node
// estimate-tokens.js -- Token heat-map for the BeeDev plugin surface.
//
// Walks the four token-bearing areas of `plugins/bee/`:
//   - agents/   (recursive: includes stacks/<stack>/*.md variants)
//   - commands/ (flat: *.md slash-command definitions)
//   - skills/   (recursive: SKILL.md + templates/* per skill)
//   - hooks/hooks.json (single file, the hook registration manifest)
//
// For each file it counts tokens via the cheap chars/4 approximation
// (`Math.ceil(content.length / 4)`). This is accurate to within roughly
// +-10-15% versus tiktoken / Anthropic-actual for English markdown -- good
// enough for relative ranking and pipeline-cost estimation. Zero new
// dependencies on purpose: this script must run on a vanilla Node install
// the same as the other scripts in this directory.
//
// Outputs (written to BEE_METRICS_DIR, defaulting to <repo>/.bee/metrics):
//   heat-map-YYYY-MM-DD.md    Human-readable report (top-20, pipelines, etc.)
//   heat-map-YYYY-MM-DD.json  Machine-readable sidecar for downstream tooling
//
// Environment overrides (used by the test runner; safe to set in CI too):
//   BEE_METRICS_DIR  Override the output directory.
//   BEE_DATE         Override the date stamp in filenames + report header.
//
// Pipeline cost simulation:
//   Per-agent input cost approximated as (agent_md + auto-injected skills),
//   where skills come from the agent's frontmatter `skills:` list. Worst-case
//   = N * full_per_agent_cost (no caching). Best-case = full_per_agent_cost
//   for the first spawn + (N-1) * agent-only delta for the rest, which bounds
//   what full prefix caching can buy back. These are approximations -- they
//   exclude per-task user prompts, context packets, and mid-task tool reads,
//   and they assume no inter-agent sharing of stack-skill content. Use them
//   for ranking, not for billing.

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Filesystem helpers (mirrors scripts/hive-dir-scanners.js -- never throw)
// ---------------------------------------------------------------------------

function safeReaddir(dir) {
  try {
    if (!fs.existsSync(dir)) return [];
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return [];
    return fs.readdirSync(dir);
  } catch (_e) {
    return [];
  }
}

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    return null;
  }
}

function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch (_e) {
    return null;
  }
}

// Validate BEE_DATE input to prevent path traversal via filename construction
// (CWE-22). Falls back to today's UTC date on missing/malformed input.
function safeDate(input) {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  if (input) {
    process.stderr.write(
      'estimate-tokens: BEE_DATE rejected (must match YYYY-MM-DD), falling back to today\n'
    );
  }
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Core: token counter + recursive walker
// ---------------------------------------------------------------------------

function estimateTokens(content) {
  if (typeof content !== 'string' || content.length === 0) return 0;
  return Math.ceil(content.length / 4);
}

// Walk a directory recursively, returning every file path (no directories).
// Filter is applied per-file by the caller via `accept(name)`.
function walkFiles(rootDir, accept) {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of safeReaddir(dir)) {
      const full = path.join(dir, entry);
      const stat = safeStat(full);
      if (!stat) continue;
      if (stat.isDirectory()) {
        stack.push(full);
      } else if (stat.isFile()) {
        if (!accept || accept(entry, full)) out.push(full);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Frontmatter helpers (used by pipeline simulation to find auto-injected skills)
// ---------------------------------------------------------------------------

function extractFrontmatter(content) {
  if (typeof content !== 'string') return null;
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

// Parse the `skills:` list from an agent frontmatter block. Supports the YAML
// list form used across all agents:
//
//   skills:
//     - core
//     - review
//     - context7
//
// Returns an array of skill names (relative to plugins/bee/skills/), or [].
function parseSkillsList(frontmatterBlock) {
  if (!frontmatterBlock) return [];
  const lines = frontmatterBlock.split('\n');
  const skills = [];
  let inSkills = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (/^skills\s*:\s*$/.test(line)) {
      inSkills = true;
      continue;
    }
    if (inSkills) {
      // Continuation: must be a list item indented under `skills:`.
      const itemMatch = line.match(/^\s+-\s*(.+?)\s*$/);
      if (itemMatch) {
        skills.push(itemMatch[1]);
      } else if (/^\S/.test(line)) {
        // Next top-level key reached -- end of the list.
        inSkills = false;
      }
    }
  }
  return skills;
}

// ---------------------------------------------------------------------------
// Inventory builder
// ---------------------------------------------------------------------------

function inventoryAt(repoRoot) {
  const pluginDir = path.join(repoRoot, 'plugins', 'bee');
  const agentsDir = path.join(pluginDir, 'agents');
  const commandsDir = path.join(pluginDir, 'commands');
  const skillsDir = path.join(pluginDir, 'skills');
  const hooksFile = path.join(pluginDir, 'hooks', 'hooks.json');

  const items = [];

  // Agents (recursive -- includes stacks/<stack>/*.md variants).
  for (const file of walkFiles(agentsDir, (name) => name.endsWith('.md'))) {
    const content = safeReadFile(file);
    if (content === null) continue;
    items.push({
      path: path.relative(repoRoot, file),
      tokens: estimateTokens(content),
      type: 'agent',
      content,
    });
  }

  // Commands (flat -- *.md only).
  for (const entry of safeReaddir(commandsDir)) {
    if (!entry.endsWith('.md')) continue;
    const file = path.join(commandsDir, entry);
    const content = safeReadFile(file);
    if (content === null) continue;
    items.push({
      path: path.relative(repoRoot, file),
      tokens: estimateTokens(content),
      type: 'command',
    });
  }

  // Skills (recursive -- SKILL.md + templates/*; both .md and .json count).
  for (const file of walkFiles(skillsDir, (name) => /\.(md|json)$/i.test(name))) {
    const content = safeReadFile(file);
    if (content === null) continue;
    items.push({
      path: path.relative(repoRoot, file),
      tokens: estimateTokens(content),
      type: 'skill',
    });
  }

  // hooks.json (single file).
  const hooksContent = safeReadFile(hooksFile);
  if (hooksContent !== null) {
    items.push({
      path: path.relative(repoRoot, hooksFile),
      tokens: estimateTokens(hooksContent),
      type: 'hook',
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Pipeline cost simulation
// ---------------------------------------------------------------------------

// Each pipeline names the agents it spawns. Counts come from the slash-command
// definitions:
//   /bee:review          -- 5 reviewers (review-implementation.md:48 lists the
//                          full-spec mode set; ad-hoc mode spawns a subset).
//   /bee:ship            -- per-phase loop = executor + 5 reviewers + validators;
//                          we approximate at the same 5 reviewers plus implementer
//                          and finding-validator (run sequentially per finding).
//   /bee:quick           -- researcher + quick-implementer; +4 reviewers when the
//                          --review flag is set. We use the with-review path so
//                          the worst-case bound covers the more expensive run.
const PIPELINE_DEFS = {
  review: {
    label: '/bee:review (5-agent ad-hoc / full-spec spawn)',
    agents: [
      'bug-detector.md',
      'pattern-reviewer.md',
      'plan-compliance-reviewer.md',
      'stack-reviewer.md',
      'audit-bug-detector.md',
    ],
  },
  ship: {
    label: '/bee:ship (per-phase: executor + 5 reviewers + validator)',
    agents: [
      'implementer.md',
      'bug-detector.md',
      'pattern-reviewer.md',
      'plan-compliance-reviewer.md',
      'stack-reviewer.md',
      'audit-bug-detector.md',
      'finding-validator.md',
    ],
  },
  quick: {
    label: '/bee:quick (researcher + quick-implementer + 4 reviewers when --review)',
    agents: [
      'researcher.md',
      'quick-implementer.md',
      'bug-detector.md',
      'pattern-reviewer.md',
      'plan-compliance-reviewer.md',
      'stack-reviewer.md',
    ],
  },
};

// Build a {skillName: tokens} map for skills that are auto-injected. We only
// resolve skills referenced by the simulated agents; everything is keyed off
// the SKILL.md content (which is the canonical entry point a skill loader reads).
function buildSkillTokenMap(repoRoot, skillNames) {
  const skillsDir = path.join(repoRoot, 'plugins', 'bee', 'skills');
  const out = new Map();
  for (const name of skillNames) {
    const skillFile = path.join(skillsDir, name, 'SKILL.md');
    const content = safeReadFile(skillFile);
    out.set(name, content === null ? 0 : estimateTokens(content));
  }
  return out;
}

// Per-agent cost = agent_md tokens + sum(skill SKILL.md tokens) for skills the
// agent declares in its frontmatter `skills:` list. Stack skills, context
// packets, and per-task user prompts are NOT included -- we only model the
// always-on prefix that prefix caching could amortize.
function perAgentCost(repoRoot, agentRel) {
  const agentFile = path.join(repoRoot, 'plugins', 'bee', 'agents', agentRel);
  const content = safeReadFile(agentFile);
  if (content === null) {
    return { agent_tokens: 0, skill_tokens: 0, total: 0, skills: [] };
  }
  const fm = extractFrontmatter(content);
  const skills = parseSkillsList(fm);
  const skillMap = buildSkillTokenMap(repoRoot, skills);
  const agentTokens = estimateTokens(content);
  let skillTokens = 0;
  for (const s of skills) skillTokens += skillMap.get(s) || 0;
  return {
    agent_tokens: agentTokens,
    skill_tokens: skillTokens,
    total: agentTokens + skillTokens,
    skills,
  };
}

function simulatePipelines(repoRoot) {
  const results = {};
  for (const [key, def] of Object.entries(PIPELINE_DEFS)) {
    const breakdown = def.agents.map((a) => ({ agent: a, ...perAgentCost(repoRoot, a) }));
    const totals = breakdown.map((b) => b.total);
    const sumFull = totals.reduce((a, b) => a + b, 0);

    // Worst case: every spawn pays the full prefix (no caching wins). We bill
    // each agent at its own full cost since each agent has its own preamble.
    const worst = sumFull;

    // Best case (full prefix caching across spawns): the longest shared prefix
    // is `core` (every agent declares it). We approximate by assuming the core
    // SKILL.md is paid once, and only the agent-specific bytes are paid per
    // spawn after that. Other shared skills (review, audit, context7) are
    // pipeline-dependent so we don't try to subtract them -- this errs toward
    // a conservative best-case (i.e., "best" is still pessimistic vs. real
    // caching).
    const corePath = path.join(repoRoot, 'plugins', 'bee', 'skills', 'core', 'SKILL.md');
    const coreTokens = estimateTokens(safeReadFile(corePath) || '');
    // Subtract (N-1) copies of the core skill; floor at 0 in case an agent
    // didn't include core for some reason.
    const sharedSavings = Math.max(0, (def.agents.length - 1) * coreTokens);
    const best = Math.max(0, sumFull - sharedSavings);

    // Refactor savings (projected): per-pipeline duplication-cluster tokens
    // (Q18 vendor-citation paragraph + 13-field finding format) that the v4.2
    // skill-reference refactor is projected to remove. Counted only on agents
    // that participate in finding production within this pipeline.
    const findingAgentCount = def.agents.filter((a) => FINDING_AGENT_NAMES.has(a)).length;
    const refactorSavings = REFACTOR_TOKENS_PER_FINDING_AGENT * findingAgentCount;

    results[key] = {
      label: def.label,
      agent_count: def.agents.length,
      worst,
      best,
      refactor_savings: refactorSavings,
      finding_agent_count: findingAgentCount,
      breakdown,
    };
  }
  return results;
}

// ---------------------------------------------------------------------------
// Duplication clusters (informational -- hand-curated estimates from the
// research notes; the script reports them so the heat-map carries the signal
// in the same place as the raw token data).
// ---------------------------------------------------------------------------

// Reviewer/auditor agents: agents that produce findings (matched by the
// vendor-citation contract test's TIER A + B + stack variants list).
const FINDING_AGENT_NAMES = new Set([
  'bug-detector.md',
  'stack-reviewer.md',
  'audit-bug-detector.md',
  'security-auditor.md',
  'api-auditor.md',
  'pattern-reviewer.md',
  'plan-compliance-reviewer.md',
  'database-auditor.md',
  'performance-auditor.md',
  'frontend-auditor.md',
  'error-handling-auditor.md',
  'testing-auditor.md',
  'integration-checker.md',
  'architecture-auditor.md',
  'dependency-auditor.md',
  'ui-auditor.md',
  'test-auditor.md',
  'integrity-auditor.md',
  'spec-reviewer.md',
  'plan-reviewer.md',
  'debug-investigator.md',
]);

// Q18 vendor-citation paragraph: ~10 lines * ~80 chars/line = ~200 tokens
// duplicated into every finding-producing agent.
const Q18_TOKENS_PER_AGENT = 200;

// 13-field finding format: ~25 lines * ~50 chars/line = ~313 tokens, present
// in every reviewer/auditor agent that templates findings inline.
const FORMAT_TOKENS_PER_AGENT = 313;

// Per-finding-agent duplication that the v4.2 skill-reference refactor projects
// to remove (Q18 paragraph + 13-field finding format, replaced by skill refs).
const REFACTOR_TOKENS_PER_FINDING_AGENT = Q18_TOKENS_PER_AGENT + FORMAT_TOKENS_PER_AGENT;

function duplicationClusters(items) {
  const findingAgents = items.filter(
    (i) => i.type === 'agent' && FINDING_AGENT_NAMES.has(path.basename(i.path))
  );

  const q18Total = Q18_TOKENS_PER_AGENT * findingAgents.length;
  const formatTotal = FORMAT_TOKENS_PER_AGENT * findingAgents.length;

  return {
    finding_agents: findingAgents.length,
    q18_paragraph: {
      tokens_per_agent: Q18_TOKENS_PER_AGENT,
      agent_count: findingAgents.length,
      total: q18Total,
    },
    finding_format: {
      tokens_per_agent: FORMAT_TOKENS_PER_AGENT,
      agent_count: findingAgents.length,
      total: formatTotal,
    },
  };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderMarkdown({ date, items, top20, pipelines, dup, totalsByType, totalTokens }) {
  const lines = [];
  lines.push(`# Token Heat-Map -- ${date}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total files scanned: ${items.length}`);
  lines.push(`- Total estimated tokens (chars/4): ${totalTokens}`);
  lines.push(`- Totals by type:`);
  for (const [type, count] of Object.entries(totalsByType)) {
    lines.push(`  - ${type}: ${count} tokens`);
  }
  lines.push('- Approximation: chars/4 (Math.ceil); +-10-15% accuracy vs. tiktoken/Anthropic actual');
  lines.push('');

  lines.push('## Top 20 Token Sinks');
  lines.push('');
  lines.push('| Rank | Path | Tokens (chars/4) | Type | % of category total |');
  lines.push('|------|------|------------------|------|---------------------|');
  // totalsByType keys are plural (agents/commands/skills/hooks); item.type is
  // singular (agent/command/skill/hook). Map singular -> plural for lookup.
  const TYPE_TO_TOTAL_KEY = { agent: 'agents', command: 'commands', skill: 'skills', hook: 'hooks' };
  top20.forEach((item, idx) => {
    const totalKey = TYPE_TO_TOTAL_KEY[item.type];
    const categoryTotal = (totalKey && totalsByType[totalKey]) || 0;
    const pct = categoryTotal > 0 ? (item.tokens / categoryTotal) * 100 : 0;
    lines.push(`| ${idx + 1} | ${item.path} | ${item.tokens} | ${item.type} | ${pct.toFixed(1)}% |`);
  });
  lines.push('');

  lines.push('## Pipeline Cost Simulations');
  lines.push('');
  lines.push(
    'Per-agent cost = agent .md + auto-injected `skills:` from frontmatter.'
  );
  lines.push(
    'Worst case bills every spawn full (zero caching). Best case subtracts the shared `core` skill prefix on (N-1) spawns -- the floor that prefix caching can buy back.'
  );
  lines.push('Both numbers exclude per-task user prompts, context packets, and mid-task tool reads. Use for ranking, not billing.');
  lines.push('');
  for (const [key, def] of Object.entries(pipelines)) {
    lines.push(`### ${def.label}`);
    lines.push('');
    lines.push('| Scenario | Total Tokens | Per-Agent Avg | Agent Count |');
    lines.push('|----------|--------------|---------------|-------------|');
    const avgWorst = Math.round(def.worst / def.agent_count);
    const avgBest = Math.round(def.best / def.agent_count);
    lines.push(`| Worst (no caching) | ${def.worst} | ${avgWorst} | ${def.agent_count} |`);
    lines.push(`| Best (full prefix caching) | ${def.best} | ${avgBest} | ${def.agent_count} |`);
    lines.push(`| Caching savings | ${def.worst - def.best} | -- | -- |`);
    lines.push(`| Refactor savings (projected) | ${def.refactor_savings} | -- | ${def.finding_agent_count} |`);
    lines.push('');
    lines.push('Per-agent breakdown:');
    lines.push('');
    lines.push('| Agent | Agent Tokens | Skill Tokens | Total |');
    lines.push('|-------|--------------|--------------|-------|');
    for (const b of def.breakdown) {
      lines.push(`| ${b.agent} | ${b.agent_tokens} | ${b.skill_tokens} | ${b.total} |`);
    }
    lines.push('');
  }

  lines.push('## Duplication Clusters (informational)');
  lines.push('');
  lines.push(
    `- Q18 vendor-citation paragraph: ~${dup.q18_paragraph.tokens_per_agent} tokens x ${dup.q18_paragraph.agent_count} finding-producing agents = ~${dup.q18_paragraph.total} tokens of duplication`
  );
  lines.push(
    `- 13-field finding format: ~${dup.finding_format.tokens_per_agent} tokens x ${dup.finding_format.agent_count} finding-producing agents = ~${dup.finding_format.total} tokens of duplication`
  );
  lines.push(
    '- Duplication estimates are hand-curated from research notes (Q18 paragraph length, finding-format template lines); rerun with refined per-cluster measurements once the v4.2 skill-reference refactor lands.'
  );
  lines.push('');

  lines.push('## Methodology');
  lines.push('');
  lines.push('- Token approximation: `Math.ceil(content.length / 4)`');
  lines.push('- Accuracy bound: +-10-15% vs. tiktoken / Anthropic-actual on English markdown');
  lines.push(
    '- Pipeline simulation: per-agent cost = agent .md tokens + sum(SKILL.md tokens for declared `skills:`)'
  );
  lines.push(
    '- Worst case = sum(per-agent) (no caching wins on any spawn)'
  );
  lines.push(
    '- Best case = worst - (N-1) * tokens(core SKILL.md), modeling only the always-on shared prefix'
  );
  lines.push(
    '- Excluded: per-task user prompts, context packets injected by the conductor, mid-task tool reads, stack-skill content (varies per project)'
  );
  lines.push('- Walk targets: plugins/bee/agents (recursive), plugins/bee/commands (flat), plugins/bee/skills (recursive), plugins/bee/hooks/hooks.json (single file)');
  lines.push('');

  return lines.join('\n');
}

function renderJson({ items, top20, pipelines, totalsByType }) {
  return {
    generated_at: new Date().toISOString(),
    approximation: 'chars/4',
    totals_by_type: totalsByType,
    top_sinks: top20.map((i) => ({ path: i.path, tokens: i.tokens, type: i.type })),
    pipelines: Object.fromEntries(
      Object.entries(pipelines).map(([k, v]) => [
        k,
        {
          worst: v.worst,
          best: v.best,
          agent_count: v.agent_count,
          refactor_savings: v.refactor_savings,
          finding_agent_count: v.finding_agent_count,
        },
      ])
    ),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  // Repo root = cwd. The script must be invoked from the project root so
  // `plugins/bee/` resolves to the live source tree.
  const repoRoot = process.cwd();

  const date = safeDate(process.env.BEE_DATE);
  const outDir =
    process.env.BEE_METRICS_DIR || path.join(repoRoot, '.bee', 'metrics');

  // Ensure output directory exists. We create it best-effort -- if creation
  // fails the subsequent writes will fail loudly and the test will catch it.
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (_e) {
    // Surface the error rather than swallowing it.
    process.stderr.write(`estimate-tokens: cannot create output dir ${outDir}\n`);
    process.exit(1);
  }

  const items = inventoryAt(repoRoot);
  if (items.length === 0) {
    process.stderr.write(
      `estimate-tokens: no scannable files found under ${path.join(repoRoot, 'plugins', 'bee')} -- is the cwd the repo root?\n`
    );
    process.exit(1);
  }

  // Strip the cached `content` field before downstream consumption -- we only
  // needed it during inventory (and we don't even read it back currently, but
  // it's the kind of thing that bloats JSON if we forget).
  const cleanItems = items.map(({ content: _c, ...rest }) => rest);

  // Sort descending by tokens, take the top 20.
  const sorted = cleanItems.slice().sort((a, b) => b.tokens - a.tokens);
  const top20 = sorted.slice(0, 20);

  // Totals by type.
  const totalsByType = { agents: 0, commands: 0, skills: 0, hooks: 0 };
  for (const item of cleanItems) {
    if (item.type === 'agent') totalsByType.agents += item.tokens;
    else if (item.type === 'command') totalsByType.commands += item.tokens;
    else if (item.type === 'skill') totalsByType.skills += item.tokens;
    else if (item.type === 'hook') totalsByType.hooks += item.tokens;
  }
  const totalTokens =
    totalsByType.agents + totalsByType.commands + totalsByType.skills + totalsByType.hooks;

  const pipelines = simulatePipelines(repoRoot);
  const dup = duplicationClusters(cleanItems);

  const md = renderMarkdown({
    date,
    items: cleanItems,
    top20,
    pipelines,
    dup,
    totalsByType,
    totalTokens,
  });
  const jsonObj = renderJson({ items: cleanItems, top20, pipelines, totalsByType });

  const mdPath = path.join(outDir, `heat-map-${date}.md`);
  const jsonPath = path.join(outDir, `heat-map-${date}.json`);
  fs.writeFileSync(mdPath, md, 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(jsonObj, null, 2) + '\n', 'utf8');

  process.stdout.write(
    `estimate-tokens: wrote ${mdPath} and ${jsonPath} (${cleanItems.length} files, ${totalTokens} tokens)\n`
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  estimateTokens,
  walkFiles,
  parseSkillsList,
  inventoryAt,
  simulatePipelines,
  duplicationClusters,
  renderMarkdown,
  renderJson,
  safeDate,
};
