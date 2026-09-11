#!/usr/bin/env node
// hive-state-parser.js -- Parses .bee/STATE.md into a structured object.
//
// Exports:
//   parseStateMd(filePath) -> {
//     currentSpec: { name, path, status },
//     phases: [{ number, name, status, plan, planReview, executed, reviewed, tested, committed }],
//     quickTasks: [{ number, description, date, commit }],
//     decisionsLog: string,
//     lastAction: { command, timestamp, result }
//   }
//
// Regex patterns are carried over from bee-statusline.js (lines 103-166) so both
// consumers share the same parse semantics. Missing and malformed files are
// handled gracefully -- the function never throws. Missing fields are returned
// as null (scalars) or empty arrays/strings.

const fs = require('fs');

// ---------------------------------------------------------------------------
// Empty-state factory: the shape returned for missing/malformed input.
// ---------------------------------------------------------------------------
function emptyState() {
  return {
    currentSpec: {
      name: null,
      path: null,
      status: null,
    },
    phases: [],
    quickTasks: [],
    decisionsLog: '',
    lastAction: {
      command: null,
      timestamp: null,
      result: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Section extraction: grab everything between a heading and the next H2 heading
// (or end-of-file). Matches the phasesSection pattern in bee-statusline.js.
// ---------------------------------------------------------------------------
function extractSection(content, heading) {
  // Escape regex special chars in heading
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`## ${escaped}\\n[\\s\\S]*?(?=\\n## |\\n*$)`);
  const match = content.match(re);
  return match ? match[0] : '';
}

// ---------------------------------------------------------------------------
// Current Spec: - Name, - Path (.bee/specs/{dir}/), - Status
// Regex reused from bee-statusline.js lines 110-120.
// ---------------------------------------------------------------------------
function parseCurrentSpec(content) {
  const spec = { name: null, path: null, status: null };

  const nameMatch = content.match(/^- Name:[ \t]*(.+)$/m);
  if (nameMatch) spec.name = nameMatch[1].trim();

  const pathMatch = content.match(/^- Path:\s*\.bee\/specs\/([^/\s]+)/m);
  if (pathMatch) spec.path = pathMatch[1];

  const statusMatch = content.match(/^- Status:[ \t]*(.+)$/m);
  if (statusMatch) spec.status = statusMatch[1].trim();

  return spec;
}

// ---------------------------------------------------------------------------
// Phases table. Reuses the exact pattern from bee-statusline.js lines 130-149:
//   - Phases section: /## Phases\n[\s\S]*?(?=\n## |\n*$)/
//   - Phase row: /^\|\s*\d+\s*\|.*\|$/gm
//   - Column split: row.split('|').map(c => c.trim()).filter(c => c !== '')
// Columns: #, Name, Status, Plan, Plan Review, Executed, Reviewed, Tested, Committed
// ---------------------------------------------------------------------------
function parsePhases(content) {
  const phases = [];
  const section = extractSection(content, 'Phases');
  if (!section) return phases;

  const rows = section.match(/^\|\s*\d+\s*\|.*\|$/gm);
  if (!rows) return phases;

  for (const row of rows) {
    // NOTE: The statusline's `.filter(c => c !== '')` strips empty cells, which
    // breaks column alignment when trailing columns are blank. For structured
    // parsing we must preserve empty cells, so we split differently: strip the
    // leading and trailing pipe, then split on `|` and trim each cell.
    const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '');
    const cols = trimmed.split('|').map(c => c.trim());

    // Pad to 9 columns in case the row has fewer
    while (cols.length < 9) cols.push('');

    phases.push({
      number: parseInt(cols[0], 10) || cols[0],
      name: cols[1],
      status: cols[2],
      plan: cols[3],
      planReview: cols[4],
      executed: cols[5],
      reviewed: cols[6],
      tested: cols[7],
      committed: cols[8],
    });
  }

  return phases;
}

// ---------------------------------------------------------------------------
// Quick Tasks table. Same pipe-row shape as Phases.
// Columns: #, Description, Date, Commit
// ---------------------------------------------------------------------------
function parseQuickTasks(content) {
  const tasks = [];
  const section = extractSection(content, 'Quick Tasks');
  if (!section) return tasks;

  const rows = section.match(/^\|\s*\d+\s*\|.*\|$/gm);
  if (!rows) return tasks;

  for (const row of rows) {
    const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '');
    const cols = trimmed.split('|').map(c => c.trim());
    while (cols.length < 4) cols.push('');

    tasks.push({
      number: parseInt(cols[0], 10) || cols[0],
      description: cols[1],
      date: cols[2],
      commit: cols[3],
    });
  }

  return tasks;
}

// ---------------------------------------------------------------------------
// Decisions Log: free-form text between "## Decisions Log" and the next "## "
// heading. Strip the heading line itself and any leading/trailing blank lines.
// ---------------------------------------------------------------------------
function parseDecisionsLog(content) {
  const section = extractSection(content, 'Decisions Log');
  if (!section) return '';

  // Remove the heading line
  const withoutHeading = section.replace(/^## Decisions Log\n?/, '');
  return withoutHeading.trim();
}

// ---------------------------------------------------------------------------
// Last Action: - Command, - Timestamp, - Result. Scoped to the Last Action
// section so we do not accidentally match `- Command:` lines from elsewhere.
// ---------------------------------------------------------------------------
function parseLastAction(content) {
  const action = { command: null, timestamp: null, result: null };
  const section = extractSection(content, 'Last Action');
  if (!section) return action;

  const commandMatch = section.match(/^- Command:[ \t]*(.+)$/m);
  if (commandMatch) action.command = commandMatch[1].trim();

  const timestampMatch = section.match(/^- Timestamp:[ \t]*(.+)$/m);
  if (timestampMatch) action.timestamp = timestampMatch[1].trim();

  const resultMatch = section.match(/^- Result:[ \t]*(.+)$/m);
  if (resultMatch) action.result = resultMatch[1].trim();

  return action;
}

// ---------------------------------------------------------------------------
// Public entrypoint.
// ---------------------------------------------------------------------------
function parseStateMd(filePath) {
  // Missing path or non-existent file -> empty state
  if (!filePath || !fs.existsSync(filePath)) {
    return emptyState();
  }

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return emptyState();
  }

  try {
    return {
      currentSpec: parseCurrentSpec(content),
      phases: parsePhases(content),
      quickTasks: parseQuickTasks(content),
      decisionsLog: parseDecisionsLog(content),
      lastAction: parseLastAction(content),
    };
  } catch (e) {
    // Any unexpected parse failure -> return empty state rather than crash
    return emptyState();
  }
}

module.exports = {
  parseStateMd,
};
