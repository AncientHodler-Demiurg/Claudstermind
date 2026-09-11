#!/usr/bin/env node
// plan-checker.js - static pre-LLM structural validator for TASKS.md.
//
// Runs as a Bash-invoked CLI from plan-phase.md (Step 5.5) and plan-all.md
// (Step 3f.1.5) BEFORE the 4 LLM plan-review agents spawn. Catches mechanical
// drift in TASKS.md deterministically so LLM tokens go to semantic concerns.
//
// CLI contract:
//   node plan-checker.js <tasks-md-path> [requirements-md-path]
// Exit codes:
//   0 = clean (no active findings)
//   1 = issues found (active findings present after suppression)
//   2 = internal error (callers MUST fail-open: proceed to LLM-only review)
//
// Read-only — never writes TASKS.md. Side artifact: writes plan-checker-report.md
// next to TASKS.md for audit trail.
//
// Module exports (for tests):
//   parseTasks(tasksMdText)
//   parseListField(rawValue)
//   parseRequirements(requirementsMdText)
//   parseSuppressions(tasksMdText)
//   check1_fileOwnership, check2_needsReferences, check3a_waveMissing,
//   check3b_waveNonMonotonic, check4_reqAnchors, check5_filesTouched,
//   check6_dependsOnTypo, check7_acceptance
//   applySuppressions, formatReport
//   resetFindingCounters, nextId

'use strict';

const fs = require('fs');
const path = require('path');

// ===== Parsers =====

// Match a task block opener: `- [ ] T1.1 | desc | agent` or `- [x] ...`.
// Group 3 is the trailing segment (agent, plus any inline `| needs: ...`).
const TASK_HEADER_RE = /^-\s*\[[\sx]\]\s+(T\d+(?:\.\d+)+)\s*\|\s*([^|]+?)\s*\|\s*(.+)$/;

// Section heading that opens a wave block: `### Wave 2` (phase files) or
// `## Wave 2` (template). The wave number is captured.
const WAVE_HEADER_RE = /^#{2,4}\s+Wave\s+(\d+)\b/i;

// Inline dependency declaration on the task header line's trailing segment:
// `bee-implementer | needs: T1.1, T1.2`. Bee's canonical schema puts `needs`
// here, NOT as a `- needs:` sub-field.
const INLINE_NEEDS_RE = /\|\s*needs:\s*(.+)$/i;

/**
 * Returns true when a line should close (terminate) the current task block.
 * A line terminates the block when it is non-empty, is not a field line
 * (`  - key: value`), and is not indented with 4 spaces or a tab.
 */
function isTaskBlockTerminator(line) {
  return (
    line.trim() !== '' &&
    !/^\s+-\s+\w+:/.test(line) &&
    !line.startsWith('    ') &&
    !line.startsWith('\t')
  );
}

// True when `line` is an indented sub-bullet under a multi-line field value
// (4-space OR tab indentation in front of `- `).
function isSubBullet(line) {
  return /^(?:    |\t)-\s+/.test(line);
}

function parseTasks(tasksMdText) {
  const lines = tasksMdText.split(/\r?\n/);
  const tasks = [];

  let current = null;
  // Track the most recently-seen field on `current` so we can attach
  // continuation sub-bullets to it when the header-line value was empty.
  // `pendingField` is one of: null | 'acceptance' | 'files_touched' | <other>.
  // `pendingAccumulating` toggles on when the header value was empty AND
  // (for files_touched / acceptance) we expect sub-bullet lines to follow.
  let pendingField = null;
  let pendingAccumulating = false;
  // Wave membership in bee's canonical schema is set by a `### Wave N` section
  // header that a task sits under, not by a per-task `- wave:` sub-field.
  // Track the wave of the most recent header so each task inherits it.
  let currentWave = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const waveHeaderMatch = line.match(WAVE_HEADER_RE);
    if (waveHeaderMatch && !line.match(TASK_HEADER_RE)) {
      // A wave section header also terminates any open task block.
      if (current) {
        tasks.push(current);
        current = null;
        pendingField = null;
        pendingAccumulating = false;
      }
      const n = parseInt(waveHeaderMatch[1], 10);
      currentWave = isNaN(n) ? null : n;
      continue;
    }

    const headerMatch = line.match(TASK_HEADER_RE);

    if (headerMatch) {
      if (current) tasks.push(current);
      const trailing = headerMatch[3].trim();
      // Split the trailing segment into the agent and an optional inline
      // `| needs: ...` dependency list (bee's canonical dependency location).
      const inlineNeedsMatch = trailing.match(INLINE_NEEDS_RE);
      let agent = trailing;
      let inlineNeeds = [];
      if (inlineNeedsMatch) {
        agent = trailing.slice(0, inlineNeedsMatch.index).replace(/\|\s*$/, '').trim();
        inlineNeeds = inlineNeedsMatch[1]
          .split(',')
          .map(s => s.trim().replace(/^['"]/, '').replace(/['"]$/, ''))
          .filter(Boolean);
      }
      current = {
        id: headerMatch[1],
        description: headerMatch[2].trim(),
        agent,
        wave: currentWave,
        needs: inlineNeeds,
        files_touched: [],
        filesTouchedPresent: false,
        requirements: [],
        acceptance: '',
        startLine: i + 1,
        endLine: i + 1,
      };
      pendingField = null;
      pendingAccumulating = false;
      continue;
    }

    if (!current) continue;

    if (isTaskBlockTerminator(line)) {
      tasks.push(current);
      current = null;
      pendingField = null;
      pendingAccumulating = false;
      continue;
    }

    current.endLine = i + 1;

    // Continuation: sub-bullet lines attach to whatever field is pending.
    if (pendingAccumulating && isSubBullet(line)) {
      const subValue = line.replace(/^(?:    |\t)-\s+/, '').trim();
      if (pendingField === 'files_touched') {
        if (subValue.length > 0) current.files_touched.push(subValue);
      } else if (pendingField === 'acceptance') {
        if (subValue.length > 0) {
          current.acceptance =
            current.acceptance.length === 0 ? subValue : current.acceptance + '\n' + subValue;
        }
      }
      continue;
    }

    const fieldMatch = line.match(/^\s+-\s+(\w+):\s*(.*)$/);
    if (!fieldMatch) {
      // Non-field, non-subbullet line inside block (e.g. comments, raw prose).
      // Stop accumulating but stay inside the task block.
      pendingAccumulating = false;
      pendingField = null;
      continue;
    }
    const [, fieldName, rawValue] = fieldMatch;
    const value = rawValue.trim();
    pendingField = fieldName;
    pendingAccumulating = false;

    switch (fieldName) {
      case 'wave': {
        const n = parseInt(value, 10);
        current.wave = isNaN(n) ? null : n;
        break;
      }
      case 'needs':
        current.needs = parseListField(value);
        break;
      case 'files_touched':
        current.files_touched = parseListField(value);
        current.filesTouchedPresent = true;
        if (value === '') pendingAccumulating = true;
        break;
      case 'requirements':
        current.requirements = parseListField(value);
        break;
      case 'acceptance':
        current.acceptance = value;
        if (value === '') pendingAccumulating = true;
        break;
      default:
        break;
    }
  }

  if (current) tasks.push(current);

  return { tasks };
}

// NOTE: naive split on `,` — does not handle commas embedded inside quoted strings.
// TASKS.md filenames and task IDs do not contain commas in practice. If a future
// caller needs robust CSV-style parsing, replace with a proper tokenizer.
function parseListField(raw) {
  const trimmed = raw.trim();
  if (trimmed === '[]' || trimmed === '') return [];
  const inner = trimmed.replace(/^\[/, '').replace(/\]$/, '');
  if (!inner.trim()) return [];
  return inner.split(',').map(s => s.trim().replace(/^['"]/, '').replace(/['"]$/, '')).filter(Boolean);
}

/**
 * Parse REQ-NN / NFR-NN ids from a requirements.md text. Accepts both:
 *   - `## REQ-NN` heading style, AND
 *   - `**REQ-NN:` / `**NFR-NN:` bold-bulleted style used by real bee specs.
 */
function parseRequirements(text) {
  const ids = new Set();
  if (typeof text !== 'string' || text.length === 0) return ids;
  // Heading style
  const headingRe = /^##\s+(REQ-\d+|NFR-\d+)\b/gm;
  let m;
  while ((m = headingRe.exec(text)) !== null) ids.add(m[1]);
  // Bold-bulleted style: `**REQ-01:` or `**NFR-02:`
  const boldRe = /\*\*\s*(REQ-\d+|NFR-\d+)\s*:/g;
  while ((m = boldRe.exec(text)) !== null) ids.add(m[1]);
  return ids;
}

// ===== Finding factory =====

let _findingCounter = 0;

function resetFindingCounters() {
  _findingCounter = 0;
}

function nextId(_severity) {
  _findingCounter += 1;
  return 'F-PC-' + String(_findingCounter).padStart(3, '0');
}

function makeFinding({ severity, category, message, evidence, fix, taskId, sourceLine }) {
  const f = {
    id: nextId(severity),
    severity,
    category,
    message,
    evidence,
    fix,
  };
  if (taskId) f.taskId = taskId;
  if (sourceLine) f.sourceLine = sourceLine;
  return f;
}

// ===== Checks =====

// Check 1: same-wave file ownership conflict (CRITICAL).
function check1_fileOwnership(tasks) {
  const findings = [];
  const taskById = new Map(tasks.map(t => [t.id, t]));
  const waveMap = new Map();
  for (const t of tasks) {
    if (t.wave == null) continue;
    if (!Array.isArray(t.files_touched) || t.files_touched.length === 0) continue;
    if (!waveMap.has(t.wave)) waveMap.set(t.wave, new Map());
    const fileMap = waveMap.get(t.wave);
    for (const rawFile of t.files_touched) {
      // Normalize: strip backticks, parenthetical annotations, square-bracket tags
      const file = rawFile
        .replace(/`/g, '')
        .replace(/\s*\(.*?\)\s*/g, '')
        .replace(/\[.*?\]/g, '')
        .trim();
      if (!file) continue;
      if (!fileMap.has(file)) fileMap.set(file, []);
      fileMap.get(file).push(t.id);
    }
  }
  for (const [wave, fileMap] of waveMap) {
    for (const [file, taskIds] of fileMap) {
      if (taskIds.length < 2) continue;
      const firstTask = taskById.get(taskIds[0]);
      findings.push(
        makeFinding({
          severity: 'critical',
          category: 'file-ownership',
          message: `Same-wave file conflict in Wave ${wave}`,
          evidence: `Wave ${wave}: ${taskIds.join(' and ')} both list \`${file}\``,
          fix: `Move one of ${taskIds.join(', ')} to a different wave OR reassign file ownership`,
          sourceLine: firstTask ? firstTask.startLine : undefined,
        })
      );
    }
  }
  return findings;
}

// Check 2: needs references must point to declared task ids (HIGH).
function check2_needsReferences(tasks) {
  const findings = [];
  const idSet = new Set(tasks.map(t => t.id));
  for (const t of tasks) {
    if (!Array.isArray(t.needs)) continue;
    for (const n of t.needs) {
      if (n === t.id) {
        findings.push(
          makeFinding({
            severity: 'high',
            category: 'needs-self-reference',
            message: `Task ${t.id} declares itself in needs`,
            evidence: `${t.id} needs: [${t.needs.join(', ')}]`,
            fix: `Remove ${t.id} from its own needs list`,
            taskId: t.id,
            sourceLine: t.startLine,
          })
        );
        continue;
      }
      if (!idSet.has(n)) {
        findings.push(
          makeFinding({
            severity: 'high',
            category: 'needs-dangling',
            message: `Task ${t.id} needs unknown task ${n}`,
            evidence: `${t.id} needs: [${t.needs.join(', ')}] — ${n} not declared in this plan`,
            fix: `Either remove ${n} from needs, or add the missing task definition`,
            taskId: t.id,
            sourceLine: t.startLine,
          })
        );
      }
    }
  }
  return findings;
}

// Check 3a: wave field missing (HIGH).
function check3a_waveMissing(tasks) {
  const findings = [];
  for (const t of tasks) {
    if (t.wave == null) {
      findings.push(
        makeFinding({
          severity: 'high',
          category: 'wave-missing',
          message: `Task ${t.id} has no wave assignment`,
          evidence: `${t.id} is missing the \`wave:\` field`,
          fix: `Add \`- wave: <N>\` to ${t.id}`,
          taskId: t.id,
          sourceLine: t.startLine,
        })
      );
    }
  }
  return findings;
}

// Check 3b: wave gaps + forward references (MEDIUM).
function check3b_waveNonMonotonic(tasks) {
  const findings = [];
  const taskById = new Map(tasks.map(t => [t.id, t]));

  // Gap detection across declared waves
  const declared = Array.from(new Set(tasks.map(t => t.wave).filter(w => typeof w === 'number'))).sort(
    (a, b) => a - b
  );
  for (let i = 1; i < declared.length; i++) {
    if (declared[i] - declared[i - 1] > 1) {
      // Source line: first task carrying the higher wave (the gap-side wave).
      const higherWave = declared[i];
      const firstAtHigher = tasks.find(t => t.wave === higherWave);
      findings.push(
        makeFinding({
          severity: 'medium',
          category: 'wave-gap',
          message: `Wave numbering has a gap: ${declared[i - 1]} → ${declared[i]}`,
          evidence: `Declared waves: [${declared.join(', ')}]`,
          fix: `Renumber waves to be contiguous (no gaps)`,
          sourceLine: firstAtHigher ? firstAtHigher.startLine : undefined,
        })
      );
    }
  }

  // Forward-ref detection: needs pointing to a higher wave is illegal
  for (const t of tasks) {
    if (t.wave == null) continue;
    if (!Array.isArray(t.needs)) continue;
    for (const n of t.needs) {
      const dep = taskById.get(n);
      if (!dep || dep.wave == null) continue;
      if (dep.wave > t.wave) {
        findings.push(
          makeFinding({
            severity: 'medium',
            category: 'wave-forward-ref',
            message: `Task ${t.id} (wave ${t.wave}) needs ${n} (wave ${dep.wave}) — dependency in a later wave`,
            evidence: `${t.id} wave=${t.wave}, needs ${n} which is wave=${dep.wave}`,
            fix: `Move ${t.id} to wave ${dep.wave + 1} OR pull ${n} forward`,
            taskId: t.id,
            sourceLine: t.startLine,
          })
        );
      }
    }
  }

  return findings;
}

// Check 4: REQ-/NFR- anchors in `requirements:` must exist in requirements.md (MEDIUM).
function check4_reqAnchors(tasks, reqIds) {
  const findings = [];
  if (!(reqIds instanceof Set) || reqIds.size === 0) return findings;
  for (const t of tasks) {
    if (!Array.isArray(t.requirements)) continue;
    for (const ref of t.requirements) {
      const norm = ref.trim();
      if (!/^(REQ|NFR)-\d+$/.test(norm)) continue;
      if (!reqIds.has(norm)) {
        findings.push(
          makeFinding({
            severity: 'medium',
            category: 'req-anchor-missing',
            message: `Task ${t.id} references ${norm} which is not declared in requirements.md`,
            evidence: `${t.id} requirements: [${t.requirements.join(', ')}] — ${norm} has no matching anchor`,
            fix: `Either add ${norm} to requirements.md, or remove it from ${t.id}`,
            taskId: t.id,
            sourceLine: t.startLine,
          })
        );
      }
    }
  }
  return findings;
}

// Check 5: files_touched field absent (MEDIUM).
function check5_filesTouched(tasks) {
  const findings = [];
  for (const t of tasks) {
    if (!t.filesTouchedPresent) {
      findings.push(
        makeFinding({
          severity: 'medium',
          category: 'files-touched-missing',
          message: `Task ${t.id} has no files_touched field`,
          evidence: `${t.id} block lines ${t.startLine}-${t.endLine} — no \`files_touched:\` field present`,
          fix: `Add \`- files_touched: [...]\` or \`- files_touched:\` with sub-bullets to ${t.id}`,
          taskId: t.id,
          sourceLine: t.startLine,
        })
      );
    }
  }
  return findings;
}

// Check 6: depends_on typo (canonical field is `needs`) (HIGH).
function check6_dependsOnTypo(text) {
  const findings = [];
  if (typeof text !== 'string') return findings;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s+-\s+depends_on:/.test(lines[i])) {
      findings.push(
        makeFinding({
          severity: 'high',
          category: 'depends_on-typo',
          message: 'Field `depends_on` is not recognized; the canonical field is `needs`',
          evidence: `Line ${i + 1}: ${lines[i].trim()}`,
          fix: 'Rename `depends_on:` to `needs:`',
          sourceLine: i + 1,
        })
      );
    }
  }
  return findings;
}

// Check 7: empty / placeholder acceptance criteria (MEDIUM).
const ACCEPTANCE_PLACEHOLDERS = new Set(['', 'tbd', 'todo', '[]', 'n/a', 'na']);

function check7_acceptance(tasks) {
  const findings = [];
  for (const t of tasks) {
    const a = (t.acceptance || '').trim().toLowerCase();
    if (ACCEPTANCE_PLACEHOLDERS.has(a)) {
      findings.push(
        makeFinding({
          severity: 'medium',
          category: 'acceptance-empty',
          message: `Task ${t.id} has empty or placeholder acceptance criteria`,
          evidence: `${t.id} acceptance: \`${t.acceptance || '(empty)'}\``,
          fix: `Add concrete, testable acceptance bullets to ${t.id}`,
          taskId: t.id,
          sourceLine: t.startLine,
        })
      );
    }
  }
  return findings;
}

// ===== Suppressions =====

const SUPPRESSION_RE = /<!--\s*plan-checker-allow:\s*(F-PC-\d{3})\s+(.+?)\s*-->/g;

function parseSuppressions(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const { tasks } = parseTasks(text);
  const lines = text.split(/\r?\n/);
  // Build a "task region" map: for each task, the region runs from its
  // startLine up to (but not including) the next task's startLine — OR EOF
  // for the last task. This widens scope-detection beyond the parser's
  // strict endLine so that indented HTML comments which terminate the field
  // block still resolve to their owning task.
  const regions = tasks.map((t, idx) => ({
    id: t.id,
    start: t.startLine,
    end: idx + 1 < tasks.length ? tasks[idx + 1].startLine - 1 : lines.length,
  }));
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    SUPPRESSION_RE.lastIndex = 0;
    let m;
    while ((m = SUPPRESSION_RE.exec(lines[i])) !== null) {
      const id = m[1];
      const reason = m[2];
      const lineNum = i + 1;
      let scope = 'file';
      // Marker must be indented (i.e. inside a task block visually) to count
      // as task-bound; flush-left comments are file-scope.
      const isIndented = /^\s/.test(lines[i]);
      if (isIndented) {
        for (const r of regions) {
          if (lineNum >= r.start && lineNum <= r.end) {
            scope = { taskId: r.id };
            break;
          }
        }
      }
      results.push({ id, reason, scope, line: lineNum });
    }
  }
  return results;
}

function applySuppressions(findings, suppressions) {
  const active = [];
  const suppressed = [];
  for (const f of findings) {
    let isSuppressed = false;
    for (const s of suppressions) {
      if (s.id !== f.id) continue;
      if (s.scope === 'file') {
        isSuppressed = true;
        break;
      }
      if (s.scope && typeof s.scope === 'object' && s.scope.taskId && s.scope.taskId === f.taskId) {
        isSuppressed = true;
        break;
      }
    }
    if (isSuppressed) suppressed.push(f);
    else active.push(f);
  }
  return { active, suppressed };
}

// ===== Report formatter =====

// MUST satisfy the bug-detector formatReport regex contract
// (plugins/bee/scripts/hooks/validators/bug-detector.js lines 49-85):
//   1. msg.includes('## Bugs Detected')
//   2. /^###\s+(Critical|High|Medium)\b/m
//   3. /`[^`\n]+:\d+`/
//   4. /\*\*Total:\s*\d+\s*critical,\s*\d+\s*high,\s*\d+\s*medium\*\*/i
//   5. /\*\*Evidence:\*\*/ OR /\bEvidence:/
//   6. /\*\*Impact:\*\*/ OR /\bImpact:/
//   7. /\*\*Test Gap:\*\*/ OR /\bTest Gap:/
function formatReport(active, suppressed, taskCount, waveCount) {
  if ((active || []).length === 0 && (suppressed || []).length === 0) {
    return `Plan structure clean (7 checks PASS, ${taskCount} tasks across ${waveCount} waves).`;
  }

  const lines = [];
  lines.push('# Plan Issues Detected (plan-checker)');
  lines.push('');

  if ((active || []).length > 0) {
    lines.push('## Bugs Detected');
    lines.push('');

    const bySeverity = { critical: [], high: [], medium: [] };
    for (const f of active) {
      const sev = f.severity || 'medium';
      if (!bySeverity[sev]) bySeverity[sev] = [];
      bySeverity[sev].push(f);
    }

    const sevHeading = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    for (const sev of ['critical', 'high', 'medium']) {
      const group = bySeverity[sev];
      if (!group || group.length === 0) continue;
      lines.push(`### ${sevHeading(sev)}`);
      lines.push('');
      for (const f of group) {
        const sourceRef = `\`TASKS.md:${f.sourceLine || 1}\``;
        lines.push(`- **Finding:** ${f.id} ${f.category} — ${f.message}`);
        lines.push(`- **Evidence:** ${sourceRef} — ${f.evidence}`);
        lines.push(`- **Impact:** ${impactFor(f)}`);
        lines.push(`- **Test Gap:** ${testGapFor(f)}`);
        lines.push(`- **Fix:** ${f.fix}`);
        lines.push('');
      }
    }

    const counts = {
      critical: (bySeverity.critical || []).length,
      high: (bySeverity.high || []).length,
      medium: (bySeverity.medium || []).length,
    };
    lines.push(`**Total: ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium**`);
    lines.push('');
  } else {
    lines.push('## Bugs Detected');
    lines.push('');
    lines.push('### Medium');
    lines.push('');
    lines.push('- **Finding:** (no active findings — see suppressed section below)');
    lines.push('- **Evidence:** `TASKS.md:1` — none');
    lines.push('- **Impact:** none');
    lines.push('- **Test Gap:** none');
    lines.push('');
    lines.push('**Total: 0 critical, 0 high, 0 medium**');
    lines.push('');
  }

  if ((suppressed || []).length > 0) {
    lines.push('## Suppressed (acknowledged)');
    lines.push('');
    for (const f of suppressed) {
      lines.push(`- ${f.id} ${f.category || ''} — ${f.message || ''}`);
    }
    lines.push('');
  }

  lines.push(`_Summary: ${taskCount} tasks across ${waveCount} waves._`);
  return lines.join('\n');
}

function impactFor(f) {
  switch (f.category) {
    case 'file-ownership':
      return 'Parallel execution will git-merge-conflict on the shared file';
    case 'needs-dangling':
    case 'needs-self-reference':
      return 'Wave scheduler cannot resolve dependency; execute-phase may hang or skip';
    case 'wave-missing':
      return 'Task has no execution wave; will be skipped silently by execute-phase';
    case 'wave-gap':
      return 'Wave numbering drift may confuse downstream tooling';
    case 'wave-forward-ref':
      return 'Dependency points to a wave that has not yet executed';
    case 'req-anchor-missing':
      return 'Coverage matrix will have a dangling reference; spec traceability broken';
    case 'files-touched-missing':
      return 'File-ownership checks (Check 1) cannot run for this task; collisions hidden';
    case 'depends_on-typo':
      return 'Field name is not parsed by execute-phase; dependency silently lost';
    case 'acceptance-empty':
      return 'Implementer cannot verify completion; review pipeline cannot assert success';
    default:
      return 'Plan integrity reduced';
  }
}

function testGapFor(f) {
  switch (f.category) {
    case 'file-ownership':
      return 'No paired-contract test prevents same-wave file overlap';
    case 'needs-dangling':
    case 'needs-self-reference':
      return 'No paired-contract test prevents dangling/circular needs refs';
    case 'wave-missing':
      return 'No structural validator currently rejects tasks without a wave field';
    case 'wave-gap':
    case 'wave-forward-ref':
      return 'No wave-monotonicity check in pre-LLM gate';
    case 'req-anchor-missing':
      return 'Coverage matrix is built post-hoc by plan-compliance-reviewer';
    case 'files-touched-missing':
      return 'No structural validator currently requires files_touched';
    case 'depends_on-typo':
      return 'No deny-list for non-canonical field names';
    case 'acceptance-empty':
      return 'No structural validator currently checks acceptance is non-empty';
    default:
      return 'No targeted structural check';
  }
}

// ===== CLI main =====

function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    process.stderr.write('Usage: node plan-checker.js <tasks-md-path> [requirements-md-path]\n');
    process.exit(2);
  }

  const tasksPath = argv[0];
  const reqsPath = argv[1] || null;

  let tasksText;
  try {
    tasksText = fs.readFileSync(tasksPath, 'utf8');
  } catch (err) {
    process.stderr.write(`Cannot read TASKS.md at ${tasksPath}: ${err.message}\n`);
    process.exit(2);
  }

  let reqsText = null;
  if (reqsPath) {
    try {
      reqsText = fs.readFileSync(reqsPath, 'utf8');
    } catch (_) {
      reqsText = null;
    }
  }

  resetFindingCounters();

  let parsed;
  try {
    parsed = parseTasks(tasksText);
  } catch (err) {
    process.stderr.write(`parseTasks failed: ${err.message}\n`);
    process.exit(2);
  }

  const tasks = parsed.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    process.stderr.write('No tasks parsed from TASKS.md — internal error\n');
    try {
      const reportPath = path.join(path.dirname(tasksPath), 'plan-checker-report.md');
      fs.writeFileSync(reportPath, 'plan-checker: no tasks parsed (internal error)\n');
    } catch (_) {}
    process.exit(2);
  }

  const findings = [];
  findings.push(...check1_fileOwnership(tasks));
  findings.push(...check2_needsReferences(tasks));
  findings.push(...check3a_waveMissing(tasks));
  findings.push(...check3b_waveNonMonotonic(tasks));
  if (reqsText) {
    const reqIds = parseRequirements(reqsText);
    findings.push(...check4_reqAnchors(tasks, reqIds));
  }
  // check5_filesTouched is intentionally NOT run here: bee's canonical TASKS.md
  // schema (skills/core/templates/tasks.md) has no per-task `files_touched:`
  // field — file ownership lives in the prose Wave Plan, which is not
  // machine-parseable per task. Running the check would false-flag every real
  // bee plan. The function is retained as an export for callers that supply a
  // files_touched-bearing schema, but the CLI gate does not emit its findings.
  findings.push(...check6_dependsOnTypo(tasksText));
  findings.push(...check7_acceptance(tasks));

  const suppressions = parseSuppressions(tasksText);
  const { active, suppressed } = applySuppressions(findings, suppressions);

  const waveSet = new Set(tasks.map(t => t.wave).filter(w => typeof w === 'number'));
  const waveCount = waveSet.size;

  const report = formatReport(active, suppressed, tasks.length, waveCount);

  try {
    const reportPath = path.join(path.dirname(tasksPath), 'plan-checker-report.md');
    fs.writeFileSync(reportPath, report + '\n');
  } catch (_) {
    // best-effort
  }

  process.stdout.write(report + '\n');
  process.exit(active.length > 0 ? 1 : 0);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`plan-checker internal error: ${err && err.stack ? err.stack : String(err)}\n`);
    process.exit(2);
  }
}

module.exports = {
  parseTasks,
  parseListField,
  parseRequirements,
  parseSuppressions,
  applySuppressions,
  formatReport,
  resetFindingCounters,
  nextId,
  check1_fileOwnership,
  check2_needsReferences,
  check3a_waveMissing,
  check3b_waveNonMonotonic,
  check4_reqAnchors,
  check5_filesTouched,
  check6_dependsOnTypo,
  check7_acceptance,
};
