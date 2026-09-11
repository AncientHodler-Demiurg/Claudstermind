// spec-state.js -- per-spec STATE.md lifecycle + the global mirror. Per-spec STATE.md is
// authoritative; .bee/STATE.md mirrors the last-touched spec so existing consumers keep working.
const fs = require('fs');
const path = require('path');

function specStatePath(beeDir, slug) { return path.join(beeDir, 'specs', slug, 'STATE.md'); }
function globalStatePath(beeDir) { return path.join(beeDir, 'STATE.md'); }

function renderSpecState({ name, slug, status }) {
  return [
    '# Bee Project State', '',
    '## Current Spec',
    `- Name: ${name}`,
    `- Path: .bee/specs/${slug}/`,
    `- Status: ${status}`, '',
    '<!-- Valid Status values:',
    '  NO_SPEC       — No active spec; project is idle or between features.',
    '  SPEC_CREATED  — Spec document exists but no phases have been executed yet.',
    '  IN_PROGRESS   — At least one phase has moved past the planned stage.',
    '  COMPLETED     — All phases committed and review-implementation is done.',
    '  ARCHIVED      — Developer ran archive-spec; spec is stored in history.',
    '-->', '',
    '## Phases',
    '| # | Name | Status | Plan | Plan Review | Executed | Reviewed | Tested | Committed |',
    '|---|------|--------|------|-------------|----------|----------|--------|-----------|', '',
    '<!-- Valid Phase Status values:',
    '  PENDING       — Phase exists but planning has not started.',
    '  PLANNED       — Phase has been planned; TASKS.md created with task breakdown and waves.',
    '  PLAN_REVIEWED — Phase plan has been reviewed and approved; ready for execution.',
    '  EXECUTING     — Phase is currently being executed; wave-based task implementation in progress.',
    '  EXECUTED      — All tasks in the phase completed; implementation is done.',
    '  REVIEWING     — Code review is in progress for this phase.',
    '  REVIEWED      — Code review complete; all findings resolved or accepted.',
    '  TESTING       — Manual test scenarios are being verified for this phase.',
    '  TESTED        — All test scenarios passed; phase is ready to commit.',
    '  COMMITTED     — Phase changes have been committed to version control.',
    '-->', '',
    '## Quick Tasks', '',
    '| # | Description | Date | Commit |',
    '|---|-------------|------|--------|', '',
    '## Decisions Log', '',
    '<!-- Structured decision entry format:',
    '  Each entry records an autonomous decision made during ship or plan-all execution.',
    '',
    '  Format:',
    '  - **[WHAT]:** Brief description of the decision made.',
    '  - **Why:** Reasoning behind the choice.',
    '  - **Alternative rejected:** What option was considered but not chosen, and why.',
    '',
    '  Example:',
    '  - **[Review finding auto-fixed]:** Applied null-check fix to UserService.getProfile return value.',
    '  - **Why:** Bug-detector flagged potential null dereference; fix is mechanical and safe.',
    '  - **Alternative rejected:** Deferring to next phase — finding is in current phase scope and trivial to fix now.',
    '-->', '',
    '## Last Action',
    '- Command: /bee:new-spec',
    '- Timestamp:',
    '- Result: spec created', '',
  ].join('\n');
}

function initSpecState(beeDir, slug, { name, status }) {
  const p = specStatePath(beeDir, slug);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, renderSpecState({ name, slug, status: status || 'SPEC_CREATED' }));
  return p;
}

function specMemoryPath(beeDir, slug) { return path.join(beeDir, 'specs', slug, 'memory.md'); }

function renderSpecMemory({ name }) {
  return [
    `# Spec Memory — ${name}`, '',
    '<!-- bee-spec-memory-template',
    'Per-spec memory. Manually curated, like .bee/user.md but scoped to THIS spec.',
    'It is injected into every bee agent at SubagentStart while this is the single active',
    'spec (suppressed when two or more specs are active). Put here what agents should ALWAYS',
    'know while working on this spec: the chosen approach, hard constraints, invariants,',
    'gotchas, "always do X / never do Y here". Keep it short — this is agent guidance, not a',
    'decision log (decisions live in STATE.md). Edit via /bee:memory or directly.',
    '-->', '',
  ].join('\n');
}

function initSpecMemory(beeDir, slug, { name } = {}) {
  const p = specMemoryPath(beeDir, slug);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, renderSpecMemory({ name: name || slug }));
  return p;
}

function mirrorToGlobal(beeDir, slug) {
  const src = specStatePath(beeDir, slug);
  if (!fs.existsSync(src)) return false;
  fs.writeFileSync(globalStatePath(beeDir), fs.readFileSync(src, 'utf8'));
  return true;
}

function snapshotToPerSpec(beeDir, slug) {
  const g = globalStatePath(beeDir);
  if (!fs.existsSync(g)) return false;
  const dest = specStatePath(beeDir, slug);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, fs.readFileSync(g, 'utf8'));
  return true;
}

const PROJECT_GLOBAL_SECTIONS = ['Quick Tasks'];

// The "## heading" block: from its line up to just before the next "## " or end-of-string.
function getSectionBlock(content, heading) {
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n)(## ${esc}[ \\t]*\\n[\\s\\S]*?)(?=\\n## |\\s*$)`);
  const m = content.match(re);
  return m ? m[1] : null;
}

function upsertSectionBlock(content, heading, block) {
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|\\n)## ${esc}[ \\t]*\\n[\\s\\S]*?(?=\\n## |\\s*$)`);
  if (re.test(content)) return content.replace(re, (m, p1) => `${p1}${block}`);
  return `${content.replace(/\s*$/, '')}\n\n${block}\n`;
}

// Restore the spec's snapshot into global, but KEEP the live global's project-global sections.
function restoreToGlobal(beeDir, slug) {
  const src = specStatePath(beeDir, slug);
  if (!fs.existsSync(src)) return false;
  let merged = fs.readFileSync(src, 'utf8');
  const g = globalStatePath(beeDir);
  if (fs.existsSync(g)) {
    const cur = fs.readFileSync(g, 'utf8');
    for (const h of PROJECT_GLOBAL_SECTIONS) {
      const block = getSectionBlock(cur, h);
      if (block) merged = upsertSectionBlock(merged, h, block);
    }
  }
  fs.writeFileSync(g, merged);
  return true;
}

module.exports = { specStatePath, globalStatePath, renderSpecState, initSpecState, mirrorToGlobal, snapshotToPerSpec, restoreToGlobal, PROJECT_GLOBAL_SECTIONS, getSectionBlock, upsertSectionBlock, specMemoryPath, renderSpecMemory, initSpecMemory };
