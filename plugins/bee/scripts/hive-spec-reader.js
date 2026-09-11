#!/usr/bin/env node
// hive-spec-reader.js
// Spec and phase file readers for the Bee Hive dashboard snapshot API.
//
// Exports:
//   readSpec(specDir)            -> { goal, userStories } | null
//   readPhases(specDir)          -> [{ number, name, description?, deliverables?, dependencies? }] | null
//   readRequirements(specDir)    -> { checked, total, sections: [{ name, checked, total }] } | null
//   readRoadmap(specDir)         -> { phaseMapping: [{ phase, goal, requirements, successCriteria }] } | null
//   readPhaseTasks(specDir)      -> [{ phaseNumber, phaseName, content }] | null
//   discoverActiveSpec(beeDir)   -> string | null
//
// All readers:
//   - Accept absolute paths
//   - Return null when the source file / directory does not exist
//   - Never throw on malformed content (degrade to partial or empty structures)

const fs = require('fs');
const path = require('path');

// -----------------------------------------------------------
// Small filesystem helpers (never throw)
// -----------------------------------------------------------

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return null;
  }
}

function safeReaddir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (e) {
    return null;
  }
}

function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch (e) {
    return null;
  }
}

// Extract the body of a `## Heading` section up to the next `## ` heading or
// end of file. Returns the body string or null if the heading is not found.
// We avoid the /m flag: it makes `$` match per-line which interacts badly
// with the lazy `[\s\S]*?` quantifier used below.
function extractSection(content, headingText) {
  // Escape regex metacharacters in the heading text.
  const escaped = headingText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    '(?:^|\\n)##\\s+' + escaped + '\\s*\\n+([\\s\\S]*?)(?=\\n##\\s|$)'
  );
  const m = content.match(re);
  return m ? m[1] : null;
}

// -----------------------------------------------------------
// readSpec
// -----------------------------------------------------------

function readSpec(specDir) {
  if (!specDir) return null;
  const filePath = path.join(specDir, 'spec.md');
  const content = safeRead(filePath);
  if (content === null) return null;

  try {
    // Goal: paragraph after the "## Goal" heading.
    const goalBody = extractSection(content, 'Goal');
    const goal = goalBody ? goalBody.trim() : '';

    // User Stories: bullet list under "## User Stories".
    const userStories = [];
    const storiesBody = extractSection(content, 'User Stories');
    if (storiesBody) {
      const lines = storiesBody.split(/\r?\n/);
      let current = null;
      for (const line of lines) {
        const bulletMatch = line.match(/^-\s+(.*)$/);
        if (bulletMatch) {
          if (current !== null) userStories.push(current.trim());
          current = bulletMatch[1];
        } else if (current !== null && /^\s+\S/.test(line)) {
          // Continuation line for the current bullet (indented wrap)
          current += ' ' + line.trim();
        } else if (line.trim() === '') {
          if (current !== null) {
            userStories.push(current.trim());
            current = null;
          }
        }
      }
      if (current !== null) userStories.push(current.trim());
    }

    return { goal, userStories };
  } catch (e) {
    // Defensive: never throw on malformed content.
    return { goal: '', userStories: [] };
  }
}

// -----------------------------------------------------------
// readPhases
// -----------------------------------------------------------

function readPhases(specDir) {
  if (!specDir) return null;
  const filePath = path.join(specDir, 'phases.md');
  const content = safeRead(filePath);
  if (content === null) return null;

  try {
    const phases = [];
    // Find all "## Phase N: name" headings using matchAll.
    const phaseHeaderRe = /^##\s+Phase\s+(\d+):\s*(.+)$/gm;
    const headers = [];
    for (const match of content.matchAll(phaseHeaderRe)) {
      headers.push({
        number: parseInt(match[1], 10),
        name: match[2].trim(),
        start: match.index,
        headerEnd: match.index + match[0].length,
      });
    }

    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      const bodyStart = h.headerEnd;
      const bodyEnd = i + 1 < headers.length ? headers[i + 1].start : content.length;
      const body = content.slice(bodyStart, bodyEnd);

      const phase = { number: h.number, name: h.name };

      // Description: text after "**Description:**" up to a blank-line + bold label,
      // another bold label, or the end of the body.
      const descMatch = body.match(/\*\*Description:\*\*\s*([\s\S]*?)(?=\n\s*\n\*\*|\n\*\*[A-Z][\w ]*:\*\*|$)/);
      if (descMatch) {
        phase.description = descMatch[1].trim();
      }

      // Deliverables: "**Deliverables:**" followed by a bullet list.
      const delivMatch = body.match(/\*\*Deliverables:\*\*\s*\n([\s\S]*?)(?=\n\s*\n\*\*|\n\*\*[A-Z][\w ]*:\*\*|$)/);
      if (delivMatch) {
        phase.deliverables = delivMatch[1]
          .split(/\r?\n/)
          .map(l => l.match(/^-\s+(.*)$/))
          .filter(Boolean)
          .map(mm => mm[1].trim());
      } else {
        phase.deliverables = [];
      }

      // Dependencies: "**Dependencies:** ..." -- can be a sentence ("Phase 1 ...")
      // or "None". Split on commas and semicolons if multiple.
      const depMatch = body.match(/\*\*Dependencies:\*\*\s*(.+?)(?=\n\s*\n|\n\*\*|$)/);
      if (depMatch) {
        const depText = depMatch[1].trim();
        if (/^none\b/i.test(depText)) {
          phase.dependencies = [];
        } else {
          phase.dependencies = depText
            .split(/[,;]/)
            .map(s => s.trim())
            .filter(Boolean);
        }
      } else {
        phase.dependencies = [];
      }

      phases.push(phase);
    }

    return phases;
  } catch (e) {
    return [];
  }
}

// -----------------------------------------------------------
// readRequirements
// -----------------------------------------------------------

function readRequirements(specDir) {
  if (!specDir) return null;
  const filePath = path.join(specDir, 'requirements.md');
  const content = safeRead(filePath);
  if (content === null) return null;

  try {
    const sections = [];
    let globalChecked = 0;
    let globalTotal = 0;

    // Walk the file line-by-line. Each "### Heading" starts a new subsection.
    // Checkboxes inside a subsection are counted toward that subsection.
    const lines = content.split(/\r?\n/);
    let current = null; // { name, checked, total }

    const flush = () => {
      if (current) {
        sections.push(current);
        globalChecked += current.checked;
        globalTotal += current.total;
      }
    };

    for (const line of lines) {
      const headingMatch = line.match(/^###\s+(.+)$/);
      if (headingMatch) {
        flush();
        current = { name: headingMatch[1].trim(), checked: 0, total: 0 };
        continue;
      }
      if (!current) continue;
      if (/^\s*-\s+\[x\]/i.test(line)) {
        current.checked += 1;
        current.total += 1;
      } else if (/^\s*-\s+\[\s\]/.test(line)) {
        current.total += 1;
      }
    }
    flush();

    return { checked: globalChecked, total: globalTotal, sections };
  } catch (e) {
    return { checked: 0, total: 0, sections: [] };
  }
}

// -----------------------------------------------------------
// readRoadmap
// -----------------------------------------------------------

function readRoadmap(specDir) {
  if (!specDir) return null;
  const filePath = path.join(specDir, 'ROADMAP.md');
  const content = safeRead(filePath);
  if (content === null) return null;

  try {
    const phaseMapping = [];
    // Locate the phase mapping table. It follows the
    // "## Phase-Requirement Mapping" heading and is composed of pipe-delimited rows.
    const tableBlock = extractSection(content, 'Phase-Requirement Mapping');
    if (tableBlock) {
      const rowLines = tableBlock
        .split(/\r?\n/)
        .filter(l => /^\|/.test(l));
      for (const row of rowLines) {
        if (/^\|\s*-+/.test(row)) continue; // separator row
        if (/^\|\s*Phase\s*\|/i.test(row)) continue; // header row
        const cells = row
          .split('|')
          .slice(1, -1) // drop the leading/trailing empty cells from the edge pipes
          .map(c => c.trim());
        if (cells.length < 4) continue;
        const phaseCell = cells[0];
        const goalCell = cells[1];
        const reqsCell = cells[2];
        const successCell = cells[3];
        const requirements = reqsCell
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
        // Success criteria in the table cell are numbered "1. Foo 2. Bar 3. Baz".
        const successCriteria = splitNumberedList(successCell);
        phaseMapping.push({
          phase: phaseCell,
          goal: goalCell,
          requirements,
          successCriteria,
        });
      }
    }
    return { phaseMapping };
  } catch (e) {
    return { phaseMapping: [] };
  }
}

function splitNumberedList(text) {
  if (!text) return [];
  const parts = text.split(/\s*(?:\d+\.\s+)/).map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    return text.trim() ? [text.trim()] : [];
  }
  return parts;
}

// -----------------------------------------------------------
// readPhaseTasks
// -----------------------------------------------------------

function readPhaseTasks(specDir) {
  if (!specDir) return null;
  const phasesDir = path.join(specDir, 'phases');
  const stat = safeStat(phasesDir);
  if (!stat || !stat.isDirectory()) return null;

  try {
    const entries = safeReaddir(phasesDir) || [];
    const results = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Expected naming: "{NN}-{slug}" e.g. "01-server-and-data-api"
      const nameMatch = entry.name.match(/^(\d+)-(.+)$/);
      if (!nameMatch) continue;
      const phaseNumber = parseInt(nameMatch[1], 10);
      const phaseSlug = nameMatch[2];
      const tasksPath = path.join(phasesDir, entry.name, 'TASKS.md');
      const content = safeRead(tasksPath);
      if (content === null) continue;
      results.push({
        phaseNumber,
        phaseName: phaseSlug,
        content,
      });
    }
    results.sort((a, b) => a.phaseNumber - b.phaseNumber);
    return results;
  } catch (e) {
    return [];
  }
}

// -----------------------------------------------------------
// discoverActiveSpec
// -----------------------------------------------------------

function discoverActiveSpec(beeDir) {
  if (!beeDir) return null;
  const specsDir = path.join(beeDir, 'specs');
  const stat = safeStat(specsDir);
  if (!stat || !stat.isDirectory()) return null;

  const entries = safeReaddir(specsDir);
  if (!entries) return null;

  // Keep only directories whose name starts with a YYYY-MM-DD date prefix.
  // Lexicographic sort works because ISO date prefixes are zero-padded.
  const datePrefixed = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(name => /^\d{4}-\d{2}-\d{2}/.test(name))
    .sort();

  if (datePrefixed.length === 0) return null;
  const newest = datePrefixed[datePrefixed.length - 1];
  return path.join(specsDir, newest);
}

module.exports = {
  readSpec,
  readPhases,
  readRequirements,
  readRoadmap,
  readPhaseTasks,
  discoverActiveSpec,
};
