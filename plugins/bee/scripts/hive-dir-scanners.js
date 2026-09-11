#!/usr/bin/env node
// Hive Directory Scanners -- Markdown/JSON scanners for the .bee/ subdirectories
// used by the Bee Hive dashboard snapshot API.
//
// Each exported scanner takes a `beeDir` (absolute path to the project's `.bee/`
// directory) and returns an array of lightweight metadata objects. Every
// returned item includes a `filePath` so downstream consumers can deep-link
// back to the source file.
//
// Design principles:
//   1. Never throw. Missing directories, malformed frontmatter, broken JSON,
//      missing heading metadata -- all of these return partial data or an
//      empty array. The snapshot aggregator (T1.7) cannot tolerate exceptions.
//   2. Zero external dependencies. YAML frontmatter is parsed with a tiny
//      regex + line splitter (flat key:value only, which is all the bee/
//      file formats use).
//   3. Each scanner owns exactly one file format. The aggregator composes.
//
// Scanners:
//   scanNotes(beeDir)          -> .bee/notes/*.md
//   scanSeeds(beeDir)          -> .bee/seeds/seed-*.md
//   scanDiscussions(beeDir)    -> .bee/discussions/*.md  (heading-based metadata)
//   scanForensics(beeDir)      -> .bee/forensics/*-report.md
//   scanDebugSessions(beeDir)  -> .bee/debug/sessions/*/state.json
//   scanQuickTasks(beeDir)     -> .bee/quick/*.md        (heading + dash list)
//   scanLearnings(beeDir)      -> .bee/specs/*/phases/*/LEARNINGS.md
//   scanReviews(beeDir)        -> .bee/specs/*/phases/*/REVIEW.md

const fs = require('fs');
const path = require('path');

// ========== Internal helpers ==========

/**
 * Safely list the entries of a directory. Returns `[]` for any error
 * (missing directory, permission denied, not-a-directory).
 */
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

/** Safely read a UTF-8 file. Returns `null` if anything goes wrong. */
function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    return null;
  }
}

/**
 * Extract the YAML frontmatter block between `---` delimiters and parse flat
 * `key: value` pairs. Returns `{}` if no frontmatter found or malformed.
 * Only supports scalar values -- nested maps and arrays are ignored, which
 * matches every bee/ file format this scanner sees.
 */
function parseFrontmatter(content) {
  if (typeof content !== 'string') return {};
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const block = match[1];
  const result = {};
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith('#')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (!key) continue;
    let value = line.slice(colonIdx + 1).trim();
    // Strip matching surrounding quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Return the body of a markdown file with the leading YAML frontmatter block
 * removed. If no frontmatter is present, returns the original content.
 */
function stripFrontmatter(content) {
  if (typeof content !== 'string') return '';
  const match = content.match(/^---\n[\s\S]*?\n---\n?/);
  return match ? content.slice(match[0].length) : content;
}

/**
 * Build a human-readable title from a note filename slug.
 * Example: `2026-04-10-093000-refactor-the-server.md` -> `refactor the server`
 */
function titleFromNoteFilename(filename) {
  let base = filename.replace(/\.md$/i, '');
  // Strip leading YYYY-MM-DD-HHMMSS (if present)
  base = base.replace(/^\d{4}-\d{2}-\d{2}-\d{6}-/, '');
  // Strip leading YYYY-MM-DD- (if the HHMMSS part wasn't there)
  base = base.replace(/^\d{4}-\d{2}-\d{2}-/, '');
  return base.replace(/-/g, ' ').trim();
}

/** First non-empty line of the markdown body, used as a fallback title. */
function firstNonEmptyLine(body) {
  if (typeof body !== 'string') return '';
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

// ========== scanNotes ==========

function scanNotes(beeDir) {
  const notesDir = path.join(beeDir, 'notes');
  const entries = safeReaddir(notesDir);
  const results = [];

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const filePath = path.join(notesDir, entry);
    const content = safeReadFile(filePath);
    if (content === null) continue;

    const fm = parseFrontmatter(content);
    const body = stripFrontmatter(content);
    const date = fm.date || null;
    const bodyTitle = firstNonEmptyLine(body);
    const title = bodyTitle || titleFromNoteFilename(entry);

    results.push({
      filePath,
      title,
      date,
      body: body.trim() || null,
    });
  }

  return results;
}

// ========== scanSeeds ==========

function scanSeeds(beeDir) {
  const seedsDir = path.join(beeDir, 'seeds');
  const entries = safeReaddir(seedsDir);
  const results = [];

  for (const entry of entries) {
    // Only files matching seed-*.md
    if (!/^seed-.+\.md$/i.test(entry)) continue;
    const filePath = path.join(seedsDir, entry);
    const content = safeReadFile(filePath);
    if (content === null) continue;

    const fm = parseFrontmatter(content);
    const id = fm.id || null;
    const idea = fm.idea || null;
    const trigger = fm.trigger || null;
    const planted = fm.planted || null;
    const status = fm.status || null;
    const title = idea || id || entry.replace(/\.md$/i, '');

    results.push({
      filePath,
      id,
      title,
      idea,
      trigger,
      planted,
      status,
    });
  }

  return results;
}

// ========== scanDiscussions ==========

function scanDiscussions(beeDir) {
  const discussionsDir = path.join(beeDir, 'discussions');
  const entries = safeReaddir(discussionsDir);
  const results = [];

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const filePath = path.join(discussionsDir, entry);
    const content = safeReadFile(filePath);
    if (content === null) continue;

    // Title: "# Discussion: (.+)"
    const titleMatch = content.match(/^#\s*Discussion:\s*(.+)$/m);
    let title = titleMatch ? titleMatch[1].trim() : null;
    if (!title) {
      // Fallback to the filename minus the date prefix and extension.
      title = entry.replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ');
    }

    // Date: "## Date\n\n(.+)"
    const dateMatch = content.match(/^##\s*Date\s*\n+\s*(.+)$/m);
    let date = dateMatch ? dateMatch[1].trim() : null;
    if (!date) {
      // Fallback to the filename date prefix, if present.
      const fileDateMatch = entry.match(/^(\d{4}-\d{2}-\d{2})/);
      if (fileDateMatch) date = fileDateMatch[1];
    }

    results.push({
      filePath,
      title,
      date,
    });
  }

  return results;
}

// ========== scanForensics ==========

function scanForensics(beeDir) {
  const forensicsDir = path.join(beeDir, 'forensics');
  const entries = safeReaddir(forensicsDir);
  const results = [];

  // Severity ranking: CRITICAL > HIGH > MEDIUM > LOW
  const severityRank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

  for (const entry of entries) {
    // Only files matching *-report.md
    if (!/-report\.md$/i.test(entry)) continue;
    const filePath = path.join(forensicsDir, entry);
    const content = safeReadFile(filePath);
    if (content === null) continue;

    // Title: "# Forensic Report: (.+)"
    const titleMatch = content.match(/^#\s*Forensic Report:\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : null;

    // Date: "**Generated:** (.+)"
    const dateMatch = content.match(/^\*\*Generated:\*\*\s*(.+)$/m);
    const date = dateMatch ? dateMatch[1].trim() : null;

    // Severity: scan the Severity Summary table for rows with count > 0,
    // pick the highest-ranked severity that has a nonzero count.
    let severity = null;
    const summaryMatch = content.match(/##\s*Severity Summary\s*\n([\s\S]*?)(?:\n##\s|$)/);
    if (summaryMatch) {
      const tableBlock = summaryMatch[1];
      let bestRank = 0;
      for (const row of tableBlock.split('\n')) {
        // Table rows look like: | CRITICAL | 1 | description |
        const rowMatch = row.match(/\|\s*(CRITICAL|HIGH|MEDIUM|LOW)\s*\|\s*(\d+)\s*\|/);
        if (!rowMatch) continue;
        const level = rowMatch[1];
        const count = parseInt(rowMatch[2], 10);
        if (count > 0 && severityRank[level] > bestRank) {
          bestRank = severityRank[level];
          severity = level;
        }
      }
    }

    results.push({
      filePath,
      title,
      date,
      severity,
    });
  }

  return results;
}

// ========== scanDebugSessions ==========

function scanDebugSessions(beeDir) {
  const sessionsDir = path.join(beeDir, 'debug', 'sessions');
  const entries = safeReaddir(sessionsDir);
  const results = [];

  for (const entry of entries) {
    const sessionDir = path.join(sessionsDir, entry);
    let stat;
    try {
      stat = fs.statSync(sessionDir);
    } catch (_e) {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const statePath = path.join(sessionDir, 'state.json');
    const content = safeReadFile(statePath);
    if (content === null) continue;

    let state;
    try {
      state = JSON.parse(content);
    } catch (_e) {
      // Malformed state.json -- skip this session entirely.
      continue;
    }
    if (!state || typeof state !== 'object') continue;

    results.push({
      filePath: statePath,
      slug: state.slug || entry,
      status: state.status || null,
      created: state.created || null,
      updated: state.updated || null,
      current_focus: state.current_focus || null,
    });
  }

  return results;
}

// ========== scanQuickTasks ==========

function scanQuickTasks(beeDir) {
  const quickDir = path.join(beeDir, 'quick');
  const entries = safeReaddir(quickDir);
  const results = [];

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const filePath = path.join(quickDir, entry);
    const content = safeReadFile(filePath);
    if (content === null) continue;

    // Heading: "# Quick Task (\d+): (.+)" OR fallback to "# (.+)"
    let number = null;
    let title = null;
    const qtMatch = content.match(/^#\s*Quick Task\s*(\d+)\s*:\s*(.+)$/m);
    if (qtMatch) {
      number = parseInt(qtMatch[1], 10) || qtMatch[1];
      title = qtMatch[2].trim();
    } else {
      // Fallback: extract leading number from filename (e.g., "002-something.md")
      const fileNumMatch = entry.match(/^(\d+)[-_]/);
      if (fileNumMatch) number = parseInt(fileNumMatch[1], 10) || fileNumMatch[1];
      const headingMatch = content.match(/^#\s*(.+)$/m);
      if (headingMatch) title = headingMatch[1].trim();
      else title = entry.replace(/\.md$/i, '');
    }

    // Metadata lines: "- Date: YYYY-MM-DD", "- Status: STATUS"
    const dateMatch = content.match(/^\s*-\s*Date:\s*(.+)$/m);
    const statusMatch = content.match(/^\s*-\s*Status:\s*(.+)$/m);
    const date = dateMatch ? dateMatch[1].trim() : null;
    const status = statusMatch ? statusMatch[1].trim() : null;

    results.push({
      filePath,
      number,
      title,
      date,
      status,
    });
  }

  return results;
}

// ========== scanLearnings / scanReviews (shared phase-file walker) ==========

/**
 * Walk `.bee/specs/<spec>/phases/<phase-dir>/<targetFilename>` and return one
 * entry per discovered file. Used by scanLearnings and scanReviews.
 */
function scanPhaseFiles(beeDir, targetFilename) {
  const specsDir = path.join(beeDir, 'specs');
  const specs = safeReaddir(specsDir);
  const results = [];

  for (const spec of specs) {
    const specPath = path.join(specsDir, spec);
    let specStat;
    try {
      specStat = fs.statSync(specPath);
    } catch (_e) {
      continue;
    }
    if (!specStat.isDirectory()) continue;

    const phasesDir = path.join(specPath, 'phases');
    const phases = safeReaddir(phasesDir);

    for (const phaseDirName of phases) {
      const phaseDirPath = path.join(phasesDir, phaseDirName);
      let phaseStat;
      try {
        phaseStat = fs.statSync(phaseDirPath);
      } catch (_e) {
        continue;
      }
      if (!phaseStat.isDirectory()) continue;

      const filePath = path.join(phaseDirPath, targetFilename);
      const content = safeReadFile(filePath);
      if (content === null) continue;

      // Parse the phase directory name: "NN-phase-name" -> number="NN", name="phase-name"
      let phaseNumber = null;
      let phaseName = phaseDirName;
      const phaseMatch = phaseDirName.match(/^(\d+)[-_](.+)$/);
      if (phaseMatch) {
        phaseNumber = phaseMatch[1];
        phaseName = phaseMatch[2];
      }

      results.push({
        filePath,
        phaseNumber,
        phaseName,
        content,
      });
    }
  }

  return results;
}

function scanLearnings(beeDir) {
  return scanPhaseFiles(beeDir, 'LEARNINGS.md');
}

function scanReviews(beeDir) {
  return scanPhaseFiles(beeDir, 'REVIEW.md');
}

// ========== Exports ==========

module.exports = {
  scanNotes,
  scanSeeds,
  scanDiscussions,
  scanForensics,
  scanDebugSessions,
  scanQuickTasks,
  scanLearnings,
  scanReviews,
};
