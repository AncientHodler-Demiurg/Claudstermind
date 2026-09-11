#!/usr/bin/env node
// Bee Statusline for Claude Code — Honeycomb Design
// Shows: Opus 4.8 🐝 4.5 ┊ ⬢⬢⬡⬡ P3/4 EXEC ┊ █████░░░░░ 48% ┊ Δ7
//        model name+version, then plugin version after the bee; one hexagon per phase.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Compact status map
const STATUS_SHORT = {
  'PLANNED': 'PLAN',
  'PLAN_REVIEWED': 'PRVW',
  'EXECUTING': 'EXEC',
  'EXECUTED': 'BUILT',
  'REVIEWING': 'RVNG',
  'REVIEWED': 'REV',
  'TESTING': 'TEST',
  'TESTED': 'PASS',
  'COMMITTED': 'OK',
  'DONE': 'DONE',
};

// Phases considered "complete" for progress calculation
const DONE_STATUSES = new Set(['REVIEWED', 'TESTED', 'COMMITTED', 'DONE']);

// Short model label with version: "Claude Opus 4.8 (1M context)" → "Opus 4.8".
// Keeping the model version next to the plugin version disambiguates the two when
// their numbers are close (e.g. Opus 4.8 vs bee 4.5).
function shortModel(name) {
  if (!name) return '';
  const lower = name.toLowerCase();
  // model version like 4.8 / 4.6 (first major.minor in the display name)
  const ver = name.match(/(\d+\.\d+)/);
  let tier = null;
  if (lower.includes('opus')) tier = 'Opus';
  else if (lower.includes('sonnet')) tier = 'Sonnet';
  else if (lower.includes('fable')) tier = 'Fable';
  else if (lower.includes('haiku')) tier = 'Haiku';
  if (tier) return ver ? `${tier} ${ver[1]}` : tier;
  // Unknown model: fall back to the last word (don't risk duplicating a version)
  const parts = name.split(/\s+/);
  return parts.length > 1 ? parts.slice(-1)[0] : name;
}

// Count git dirty files (uncommitted changes + untracked)
function gitDirtyCount(dir) {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 2000,
    });
    if (!out.trim()) return 0;
    return out.trim().split('\n').length;
  } catch {
    return -1;
  }
}

// Build honeycomb phase progress (⬢⬢⬢⬡⬡ style, one hexagon per phase)
function honeycombBar(completed, total) {
  if (total === 0) return '';
  const filled = Math.max(0, Math.min(completed, total)); // one hex == one phase
  const done = '\u2B22'; // ⬢ filled hexagon
  const pending = '\u2B21'; // ⬡ empty hexagon
  const bar = done.repeat(filled) + pending.repeat(total - filled);

  // Color: green if all done, cyan if in progress
  if (completed === total) {
    return `\x1b[32m${bar}\x1b[0m`;
  }
  return `\x1b[36m${bar}\x1b[0m`;
}

// Read JSON from stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    const model = shortModel(data.model?.display_name);
    const dir = data.workspace?.current_dir || process.cwd();
    const remaining = data.context_window?.remaining_percentage;

    // Plugin version — injected by setup-statusline.js, falls back to plugin.json
    const BEE_VERSION = '__BEE_VERSION__';
    let version = '';
    try {
      version = BEE_VERSION.startsWith('__') ? null : BEE_VERSION;
      if (!version) {
        const pluginPath = path.join(__dirname, '..', '.claude-plugin', 'plugin.json');
        if (fs.existsSync(pluginPath)) {
          version = JSON.parse(fs.readFileSync(pluginPath, 'utf8')).version;
        }
      }
      // Trim to major.minor (4.0.0 → 4.0)
      if (version) {
        const parts = version.split('.');
        version = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : version;
      }
    } catch (e) {
      // Never crash the statusline
    }

    // Separator style
    const sep = `\x1b[2m\u250A\x1b[0m`; // ┊ thin dotted vertical

    // Bee state extraction from .bee/STATE.md
    let beeSegment = '\x1b[2mready\x1b[0m';
    try {
      const statePath = path.join(dir, '.bee', 'STATE.md');
      if (fs.existsSync(statePath)) {
        const stateContent = fs.readFileSync(statePath, 'utf8');

        // Extract spec status
        const specStatusMatch = stateContent.match(/^- Status:\s*(.+)$/m);
        const specStatus = specStatusMatch ? specStatusMatch[1].trim() : 'NO_SPEC';

        // Check last action for quick task indicator
        const lastCmdMatch = stateContent.match(/^- Command:\s*(.+)$/m);
        const lastCmd = lastCmdMatch ? lastCmdMatch[1].trim() : '';
        const isQuick = lastCmd.includes('quick');

        // Extract spec name
        const specPathMatch = stateContent.match(/^- Path:\s*\.bee\/specs\/([^/\s]+)/m);
        const specName = specPathMatch ? specPathMatch[1] : null;

        if (specStatus === 'NO_SPEC' || !specName) {
          if (isQuick) {
            beeSegment = '\x1b[36mquick\x1b[0m';
          } else {
            beeSegment = '\x1b[2mready\x1b[0m';
          }
        } else {
          // Parse phases table — count completed vs total (only from ## Phases section)
          const phasesSection = stateContent.match(/## Phases\n[\s\S]*?(?=\n## |\n*$)/);
          const phaseRows = phasesSection ? phasesSection[0].match(/^\|\s*\d+\s*\|.*\|$/gm) : null;
          let activePhase = null;
          let totalPhases = 0;
          let completedPhases = 0;

          if (phaseRows) {
            totalPhases = phaseRows.length;
            for (const row of phaseRows) {
              const cols = row.split('|').map(c => c.trim()).filter(c => c !== '');
              if (cols.length >= 3) {
                const phaseNum = cols[0];
                const phaseStatus = cols[2];
                if (DONE_STATUSES.has(phaseStatus)) {
                  completedPhases++;
                } else if (!activePhase) {
                  activePhase = { num: phaseNum, status: phaseStatus };
                }
              }
            }
          }

          const hBar = honeycombBar(completedPhases, totalPhases);

          if (activePhase) {
            const st = STATUS_SHORT[activePhase.status] || activePhase.status;
            beeSegment = `${hBar} \x1b[1mP${activePhase.num}/${totalPhases}\x1b[0m \x1b[33m${st}\x1b[0m`;
          } else if (totalPhases > 0) {
            beeSegment = `${hBar} \x1b[32mall done\x1b[0m`;
          } else {
            beeSegment = '\x1b[2mno phases\x1b[0m';
          }
        }
      }
    } catch (e) {
      // Never crash the statusline
    }

    // Multi-spec queue indicator.
    // Uses specs-registry activeSpecs() semantics (non-terminal stages).
    // Determines whether the global STATE.md currently reflects one of the active specs
    // (a "focused" spec) by matching the Current Spec Path slug against the registry.
    //
    // Outcomes:
    //   • .bee/worktree-spec marker present: append ⊞wt, skip queue logic (stale copied registry)
    //   • No specs.json (legacy/idle): no-op — beeSegment unchanged (byte-identical to single-spec path)
    //   • active.length === 0: no-op
    //   • active.length >= 1, focused spec present: append " +N queued" when N > 0
    //   • active.length >= 1, NO focused spec (NO_SPEC global): replace beeSegment with
    //     "{N} spec(s) queued — none focused"
    try {
      // If running inside a promoted worktree, the marker takes priority — annotate and skip queue logic
      const wtMarkerPath = path.join(dir, '.bee', 'worktree-spec');
      const inWorktree = fs.existsSync(wtMarkerPath);
      if (inWorktree) {
        beeSegment = beeSegment + ` \x1b[2m⊞wt\x1b[0m`;
      }
      const specsJsonPath = path.join(dir, '.bee', 'specs.json');
      if (!inWorktree && fs.existsSync(specsJsonPath)) {
        const raw = fs.readFileSync(specsJsonPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.specs)) {
          const TERMINAL = ['shipped', 'archived'];
          const active = parsed.specs
            .filter(s => !TERMINAL.includes(s.stage))
            .sort((a, b) => String(b.last_touched || '').localeCompare(String(a.last_touched || '')));

          if (active.length > 0) {
            // Detect focused spec: extract slug from STATE.md Current Spec Path and match registry
            let focusedSlug = null;
            try {
              const statePath = path.join(dir, '.bee', 'STATE.md');
              if (fs.existsSync(statePath)) {
                const stateContent = fs.readFileSync(statePath, 'utf8');
                const specPathMatch = stateContent.match(/^- Path:\s*\.bee\/specs\/([^/\s]+)/m);
                const specStatusMatch = stateContent.match(/^- Status:\s*(.+)$/m);
                const specStatus = specStatusMatch ? specStatusMatch[1].trim() : 'NO_SPEC';
                const slug = specPathMatch ? specPathMatch[1] : null;
                if (slug && specStatus !== 'NO_SPEC' && active.some(s => s.slug === slug)) {
                  focusedSlug = slug;
                }
              }
            } catch (_) {}

            if (focusedSlug) {
              // Worktree indicator: if the focused spec's location is not in-place, annotate
              const focusedSpec = active.find(s => s.slug === focusedSlug);
              const isWorktree = focusedSpec && focusedSpec.location && focusedSpec.location !== 'in-place';
              if (isWorktree) {
                beeSegment = beeSegment + ` \x1b[2m⊞wt\x1b[0m`;
              }

              // Focused spec: append "+N queued" when there are other active specs
              const queued = active.length - 1;
              if (queued > 0) {
                beeSegment = beeSegment + ` \x1b[2m+${queued} queued\x1b[0m`;
              }
              // queued === 0 and not worktree: single-spec path — no-op, beeSegment unchanged
            } else {
              // No focused spec but active specs exist — surface the queue and name the most-recently-touched spec
              const top = active[0]; // already sorted most-recently-touched first
              const topLabel = top.title && top.title !== top.slug ? top.title : top.slug;
              const queueSuffix = active.length > 1 ? ` \x1b[2m(+${active.length - 1} more)\x1b[0m` : '';
              beeSegment = `\x1b[33m${active.length} queued\x1b[0m \x1b[2m— none focused; last: ${topLabel}\x1b[0m${queueSuffix}`;
            }
          }
        }
      }
    } catch (e) {
      // Never crash the statusline — if specs.json is unreadable, proceed without it
    }

    // Git dirty count
    let gitSegment = '';
    const dirty = gitDirtyCount(dir);
    if (dirty > 0) {
      gitSegment = ` ${sep} \x1b[33m\u0394${dirty}\x1b[0m`;
    }

    // Context window — fuel gauge with ━ (heavy line) and ░ (light shade)
    const rem = Math.round(remaining ?? 100);
    const rawUsed = Math.max(0, Math.min(100, 100 - rem));
    const used = Math.min(100, Math.round((rawUsed / 80) * 100));

    const totalSegs = 10;
    const filledSegs = Math.floor(used / 10);
    const heavy = '\u2588'; // █ full block — high-contrast filled cell
    const light = '\u2591'; // ░ light shade — empty cell
    const bar = heavy.repeat(filledSegs) + light.repeat(totalSegs - filledSegs);

    let ctx;
    if (used < 63) {
      ctx = `\x1b[32m${bar}\x1b[0m \x1b[32m${used}%\x1b[0m`;
    } else if (used < 81) {
      ctx = `\x1b[33m${bar}\x1b[0m \x1b[33m${used}%\x1b[0m`;
    } else if (used < 95) {
      ctx = `\x1b[38;5;208m${bar}\x1b[0m \x1b[38;5;208m${used}%\x1b[0m`;
    } else {
      ctx = `\x1b[31m${bar}\x1b[0m \x1b[31m${used}%\x1b[0m`;
    }

    // Model segment (dim, only if available)
    const modelSeg = model ? `\x1b[2m${model}\x1b[0m ` : '';

    // Output: 🐝 4.0 ┊ ⬢⬢⬢⬡⬡ P3/5 EXEC ┊ ━━━━░░░░░░ 48% ┊ Δ7
    process.stdout.write(
      `${modelSeg}\u{1F41D} ${version ? version + ' ' : ''}${sep} ${beeSegment} ${sep} ${ctx}${gitSegment}`
    );
  } catch (e) {
    // Silent fail - don't break statusline on parse errors
  }
});
