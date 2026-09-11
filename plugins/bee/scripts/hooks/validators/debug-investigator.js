#!/usr/bin/env node
// debug-investigator.js — SubagentStop Node validator for the debug-investigator agent.
//
// Mirror of the prompt block at plugins/bee/hooks/hooks.json:321 translated into
// deterministic structural + metadata checks. Reads the SubagentStop payload
// from stdin, loads the agent's last assistant message AND the full tool_use
// block stream from the JSONL transcript, then enforces:
//   1. The agent's output carries one of the canonical signal headings
//      (ROOT CAUSE FOUND / CHECKPOINT REACHED / INVESTIGATION INCONCLUSIVE)
//      with the per-signal subfields required by the agent contract.
//   2. The agent did NOT write or edit any file outside `.bee/debug/`.
//      debug-investigator is a diagnostic-only agent (tools: Read, Grep, Glob,
//      Bash) — the only writable surface is the session directory under
//      `.bee/debug/`. Any Write/Edit tool call with a file_path outside that
//      tree is a contract breach.
//   3. Hypothesis count stays at or below the documented ceiling (7).
//   4. If the agent mentions "pruning", it also references the
//      `archived_hypotheses` audit trail (pruning != deletion).
//
// Write-confinement uses CANONICAL path resolution: every Write/Edit
// file_path is normalised to POSIX separators, resolved against the project
// root via path.posix.resolve, and prefix-matched against the allowed
// .bee/debug/ root. This single algorithm handles absolute paths, relative
// paths, Windows backslash separators, and `..` traversal attempts.
//
// Hard contract (per validators-lib.js header):
//   - emits EXACTLY ONE verdict JSON to stdout via emitVerdict
//   - process.exit(0) on every code path
//   - top-level try/catch — catch handler emits a verdict BEFORE exit so the
//     Phase 2 runPerAgentValidator aggregator never sees empty stdout
//     (CI-001 cross-plan fix)
//
// Fail-closed policy on metadata access (per phase plan F-005):
//   - readLastAssistantMessage returns null  → "transcript_path unreadable"
//     (transcript itself unreadable / no assistant turn / empty content)
//   - extractToolCalls returns null          → "cannot verify
//     write-confinement; metadata unavailable" (transcript readable enough
//     for the text path but tool_use extraction failed — distinct failure
//     mode; do not collapse with transcript_path unreadable)
//   - extractToolCalls returns []            → vacuously safe (no Write/Edit
//     calls to police); structural checks still run on the message body

'use strict';

const path = require('path');
const {
  readStdinSync,
  safeJsonParse,
  resolveRoot,
  autoModeActive,
  readLastAssistantMessage,
  extractToolCalls,
  emitVerdict,
} = require('./validators-lib.js');

// Canonical write-confinement check. Returns true when filePath resolves
// inside the project's .bee/debug/ tree under POSIX normalisation.
function isWithinDebug(filePath, root) {
  if (typeof filePath !== 'string' || filePath.length === 0) return false;
  if (typeof root !== 'string' || root.length === 0) return false;
  const posixRoot = root.replace(/\\/g, '/');
  const posixPath = filePath.replace(/\\/g, '/');
  const allowedRoot = path.posix.join(posixRoot, '.bee', 'debug') + '/';
  const canonical = path.posix.resolve(posixRoot, posixPath);
  return canonical.startsWith(allowedRoot);
}

function main(rawInput) {
  const payload = safeJsonParse(typeof rawInput === 'string' ? rawInput : readStdinSync());

  if (!autoModeActive(payload)) {
    return emitVerdict(true);
  }

  if (!payload || typeof payload.transcript_path !== 'string') {
    return emitVerdict(false, 'invalid SubagentStop payload (missing transcript_path)');
  }

  const msg = readLastAssistantMessage(payload.transcript_path);
  if (msg === null) return emitVerdict(false, 'transcript_path unreadable');
  if (msg.length === 0) return emitVerdict(false, 'empty assistant message');

  // Check 1: exactly one of the canonical signal headings present.
  const hasRootCause = msg.includes('## ROOT CAUSE FOUND');
  const hasCheckpoint = msg.includes('## CHECKPOINT REACHED');
  const hasInconclusive = msg.includes('## INVESTIGATION INCONCLUSIVE');
  const signalCount = (hasRootCause ? 1 : 0) + (hasCheckpoint ? 1 : 0) + (hasInconclusive ? 1 : 0);
  if (signalCount === 0) {
    return emitVerdict(
      false,
      "missing investigation signal: expected one of '## ROOT CAUSE FOUND', '## CHECKPOINT REACHED', or '## INVESTIGATION INCONCLUSIVE'"
    );
  }

  // Check 2: ROOT CAUSE FOUND requires Evidence + Confidence subfields, with
  // at least one `path/to/file:NN` style citation inside the Evidence body.
  if (hasRootCause) {
    if (!/Evidence/i.test(msg)) {
      return emitVerdict(false, "ROOT CAUSE FOUND missing 'Evidence' section");
    }
    // file:line reference inside backticks — accepts `path/file.ext:NN` or
    // `path/file.ext:NN-MM`. Drives expectation from the agent contract,
    // not from a hardcoded sample.
    const fileLineRef = /`[^`\n]+\.[A-Za-z0-9]+:\d+(?:-\d+)?[^`\n]*`/;
    if (!fileLineRef.test(msg)) {
      return emitVerdict(false, 'ROOT CAUSE FOUND missing backtick file:line citation');
    }
    if (!/Confidence/i.test(msg)) {
      return emitVerdict(false, "ROOT CAUSE FOUND missing 'Confidence' field");
    }
  }

  // Check 3: CHECKPOINT REACHED requires Type + What I Need subfields.
  if (hasCheckpoint) {
    if (!/Type\s*:/i.test(msg)) {
      return emitVerdict(false, "CHECKPOINT REACHED missing 'Type:' field");
    }
    if (!/(human-verify|need-info|decision)/i.test(msg)) {
      return emitVerdict(
        false,
        "CHECKPOINT REACHED 'Type' must be one of: human-verify, need-info, decision"
      );
    }
    if (!/What I Need/i.test(msg)) {
      return emitVerdict(false, "CHECKPOINT REACHED missing 'What I Need' field");
    }
  }

  // Check 4: INVESTIGATION INCONCLUSIVE requires Checked + Remaining
  // Possibilities subfields.
  if (hasInconclusive) {
    if (!/Checked/i.test(msg)) {
      return emitVerdict(false, "INVESTIGATION INCONCLUSIVE missing 'Checked' section");
    }
    if (!/Remaining Possibilities/i.test(msg)) {
      return emitVerdict(
        false,
        "INVESTIGATION INCONCLUSIVE missing 'Remaining Possibilities' section"
      );
    }
  }

  // Check 5: write-confinement via tool-call metadata. Three-tier policy:
  //   null  → fail closed (metadata unverifiable)
  //   []    → vacuously safe (no Write/Edit issued)
  //   [...] → enforce .bee/debug/ confinement on every Write/Edit call.
  const toolCalls = extractToolCalls(payload.transcript_path);
  if (toolCalls === null) {
    return emitVerdict(false, 'cannot verify write-confinement; metadata unavailable');
  }
  const root = resolveRoot(payload);
  const writeCalls = toolCalls.filter((c) => c && (c.name === 'Write' || c.name === 'Edit'));
  for (const call of writeCalls) {
    const filePath = call.input && typeof call.input.file_path === 'string'
      ? call.input.file_path
      : null;
    if (filePath === null) {
      // A Write/Edit call without a file_path string can't be confined.
      return emitVerdict(
        false,
        'debug-investigator ' + call.name + ' call missing file_path; cannot verify confinement'
      );
    }
    if (!isWithinDebug(filePath, root)) {
      return emitVerdict(
        false,
        'debug-investigator wrote outside .bee/debug/: ' + filePath
      );
    }
  }

  // Check 6: hypothesis count ceiling. Scan for explicit hypothesis tokens
  // (### H1, ### H2, ...) which the agent contract uses to label them.
  const hypothesisMatches = msg.match(/###\s*H\d+\b/g) || [];
  const hypothesisIds = new Set(hypothesisMatches.map((s) => s.toLowerCase().replace(/\s+/g, '')));
  if (hypothesisIds.size > 7) {
    return emitVerdict(
      false,
      'hypothesis count exceeds 7 active hypotheses (found ' + hypothesisIds.size + ')'
    );
  }

  // Check 7: pruning audit trail. If the message mentions pruning, it must
  // also reference the archived_hypotheses sink so pruning != deletion.
  if (/prun(?:ed|ing)/i.test(msg) && !/archived_hypotheses/i.test(msg)) {
    return emitVerdict(
      false,
      "pruning mentioned without 'archived_hypotheses' reference; pruning must archive, not delete"
    );
  }

  return emitVerdict(true);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    emitVerdict(false, 'validator threw: ' + (err && err.message ? err.message : String(err)));
  }
  process.exit(0);
}

module.exports = { main };
