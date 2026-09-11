// validators-lib.js — shared helpers for the 24 SubagentStop Node validators.
//
// Each validator under plugins/bee/scripts/hooks/validators/<agent>.js requires
// this module and uses these helpers to enforce its acceptance contract on
// the agent's last assistant message (read from the transcript JSONL referenced
// by the SubagentStop payload).
//
// HARD CONTRACTS (per Phase 1 spec):
//   1. Validators emit EXACTLY ONE verdict JSON to stdout via emitVerdict:
//        {"ok": true}                                  // pass
//        {"ok": false, "reason": "<one-line cause>"}   // fail
//      No other bytes to stdout. No trailing newline. The Phase 2
//      runPerAgentValidator aggregator reads stdout as the verdict signal.
//      This INVERTS contract #1 of emit-event.js (which emits zero bytes);
//      validators MUST emit a verdict, even on internal failure.
//   2. Validators ALWAYS exit 0. A non-zero exit from a SubagentStop hook
//      could disrupt agent shutdown. Catch every error at top level and
//      exit 0 unconditionally. The catch handler MUST first call
//      emitVerdict(false, 'validator threw: ' + err.message) so Phase 2
//      never sees empty stdout from an in-band exception (CI-001 cross-plan
//      fix; diverges from emit-event.js which emits nothing on the catch
//      path).
//   3. NEVER throw across the top-level try/catch.
//   4. NO external dependencies. Only `fs`, `path`, and built-in `process`.
//
// SubagentStop payload shape (from stdin):
//   {
//     "session_id":      "string",
//     "transcript_path": "string",   // path to JSONL transcript on disk
//     "cwd":             "string",   // project root for the agent run
//     "hook_event_name": "string"    // "SubagentStop"
//   }
// Note: there is NO `last_assistant_message` field. Agent text lives in the
// JSONL at `transcript_path` and is read via readLastAssistantMessage.
//
// JSONL line shape (per assistant turn):
//   { "type": "assistant", "message": { "content": <string OR block-array> } }
// where block-array members are { type: "text", text } or { type: "tool_use",
// name, input, id, output_success? }. The `content` field is NESTED UNDER
// `message`, NOT at top level — canonical reference: team-task-validator.sh:51-60.
//
// All helpers in this module are pure-failure-safe: they never throw. Failure
// modes return null / empty-string / false / [] as appropriate.

'use strict';

const fs = require('fs');
const path = require('path');

const MAX_STDIN_BYTES = 10 * 1024 * 1024; // 10 MB defensive cap
const MAX_TRANSCRIPT_BYTES = 50 * 1024 * 1024; // 50 MB transcript cap

// ---------------------------------------------------------------------------
// readStdinSync — read all bytes from stdin (fd 0), never throw.
// Mirrors emit-event.js:41-53. Wrapped in try/catch because fs.readFileSync(0)
// can throw EAGAIN on some platforms when no data is piped.
// ---------------------------------------------------------------------------
function readStdinSync() {
  try {
    const buf = fs.readFileSync(0);
    if (buf.length > MAX_STDIN_BYTES) {
      return buf.slice(0, MAX_STDIN_BYTES).toString('utf8');
    }
    return buf.toString('utf8');
  } catch (_) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// safeJsonParse — parse JSON, return null on failure or non-object result.
// Validators always expect a top-level object payload; arrays / primitives /
// null are rejected so the caller can use a single null-check.
// ---------------------------------------------------------------------------
function safeJsonParse(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    return null;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// resolveRoot — 3-tier deterministic project-root resolution.
//   Tier 1: payload.cwd (string, non-empty) — the SubagentStop payload's own
//           cwd. This is the canonical signal from Claude Code's hook contract.
//   Tier 2: process.env.CLAUDE_PROJECT_DIR — set by Claude Code or by tests
//           that spawn validators with explicit env injection.
//   Tier 3: process.cwd() — last-resort fallback for ad-hoc invocations.
//
// NEVER throws. Caller can rely on a defined string return on every code path.
// ---------------------------------------------------------------------------
function resolveRoot(stdinPayload) {
  if (stdinPayload && typeof stdinPayload.cwd === 'string' && stdinPayload.cwd.length > 0) {
    return stdinPayload.cwd;
  }
  const env = process.env.CLAUDE_PROJECT_DIR;
  if (typeof env === 'string' && env.length > 0) return env;
  return process.cwd();
}

// ---------------------------------------------------------------------------
// autoModeActive — file-existence-only check for the auto-mode marker.
// The marker at <root>/.bee/.autonomous-run-active is written by conductor
// commands when agent_teams.status === "enabled". Validators skip their checks
// when auto mode is INACTIVE (per REQ-10 base inclusion semantics: validators
// only run during autonomous executions).
// NEVER throws — fs.existsSync swallows ENOENT, and resolveRoot is safe.
// ---------------------------------------------------------------------------
function autoModeActive(stdinPayload) {
  try {
    const root = resolveRoot(stdinPayload);
    return fs.existsSync(path.join(root, '.bee', '.autonomous-run-active'));
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// readLastAssistantMessage — read the LAST assistant turn from a JSONL
// transcript and return its content as a string.
//
// JSONL inner shape (canonical reference: team-task-validator.sh:51-60):
//   { "type": "assistant", "message": { "content": <string OR block-array> } }
// Handles BOTH content shapes:
//   - string: returned directly.
//   - block-array: filters to type === 'text' blocks and joins their .text
//     fields with '\n'. tool_use blocks contribute nothing to the text.
//
// Returns null on: missing/non-string path, unreadable file, parse failure,
// no assistant entry, missing entry.message, missing entry.message.content,
// empty result. NEVER throws.
// ---------------------------------------------------------------------------
function readLastAssistantMessage(transcriptPath) {
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) return null;
  let text;
  try {
    const stat = fs.statSync(transcriptPath);
    if (stat.size > MAX_TRANSCRIPT_BYTES) return null;
    text = fs.readFileSync(transcriptPath, 'utf8');
  } catch (_) {
    return null;
  }
  if (typeof text !== 'string' || text.length === 0) return null;

  const lines = text.split('\n');
  let lastAssistant = null;
  for (const line of lines) {
    if (line.length === 0) continue;
    const entry = safeJsonParse(line);
    if (entry && entry.type === 'assistant') {
      lastAssistant = entry;
    }
  }
  if (!lastAssistant) return null;
  if (!lastAssistant.message || typeof lastAssistant.message !== 'object') return null;
  const content = lastAssistant.message.content;
  if (typeof content === 'string') {
    return content.length > 0 ? content : null;
  }
  if (Array.isArray(content)) {
    const joined = content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
    return joined.length > 0 ? joined : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// extractToolCalls — walk every assistant turn and collect tool_use blocks
// into a flat array. Caller uses this to verify required tool invocations
// (e.g. T1.5 debug-investigator checks that Write was called with a memory
// file path matching a documented schema).
//
// Returns:
//   - Array<{ name, input, id, output_success }> — flat list across all
//     assistant entries; [] when readable but no tool_use blocks present.
//   - null on read/parse failure. Callers can distinguish "no tool calls"
//     from "couldn't read transcript" via Array.isArray(result).
//
// String-content entries contribute nothing (no array to walk → no tool_use
// possible in that turn). NEVER throws.
// ---------------------------------------------------------------------------
function extractToolCalls(transcriptPath) {
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) return null;
  let text;
  try {
    const stat = fs.statSync(transcriptPath);
    if (stat.size > MAX_TRANSCRIPT_BYTES) return null;
    text = fs.readFileSync(transcriptPath, 'utf8');
  } catch (_) {
    return null;
  }
  if (typeof text !== 'string') return null;

  const tools = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.length === 0) continue;
    const entry = safeJsonParse(line);
    if (!entry || entry.type !== 'assistant') continue;
    if (!entry.message || !Array.isArray(entry.message.content)) continue;
    for (const block of entry.message.content) {
      if (block && block.type === 'tool_use') {
        tools.push({
          name: block.name,
          input: block.input,
          id: block.id,
          output_success: block.output_success,
        });
      }
    }
  }
  return tools;
}

// ---------------------------------------------------------------------------
// emitVerdict — write the verdict JSON to stdout exactly once.
//   emitVerdict(true)           → {"ok":true}
//   emitVerdict(false, reason)  → {"ok":false,"reason":"<reason>"}
// No trailing newline. The `reason` argument is omitted from the output when
// ok === true (pass verdicts MUST NOT carry a reason field).
// ---------------------------------------------------------------------------
function emitVerdict(ok, reason) {
  const verdict = { ok: ok === true };
  if (verdict.ok !== true) {
    verdict.reason = typeof reason === 'string' ? reason : String(reason || 'unknown failure');
  }
  process.stdout.write(JSON.stringify(verdict));
}

// ---------------------------------------------------------------------------
// splitIntoChunks — TDD red-green chunk-split for assistant messages.
// Splits a message into ordered chunks at:
//   - Markdown ATX headings (lines beginning with `#` followed by space).
//   - Triple-fence code blocks (the opening and closing ``` lines are
//     boundaries; the fenced body itself becomes its own chunk).
//   - Blank-line gaps (one or more consecutive empty lines).
// A single paragraph with none of these boundaries yields ONE chunk — and a
// TDD red-green sequence cannot be confirmed inside a single chunk because
// the algorithm requires distinct chunks for FAIL and PASS evidence.
//
// Returns an Array<string>; each chunk is the joined content of its lines
// (trimmed of leading/trailing blank lines but with internal newlines preserved).
// Empty input → []. NEVER throws.
// ---------------------------------------------------------------------------
function splitIntoChunks(message) {
  if (typeof message !== 'string' || message.length === 0) return [];

  const lines = message.split('\n');
  const chunks = [];
  let current = [];
  let inFence = false;

  const flush = () => {
    while (current.length > 0 && current[0].trim() === '') current.shift();
    while (current.length > 0 && current[current.length - 1].trim() === '') current.pop();
    if (current.length > 0) chunks.push(current.join('\n'));
    current = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const isHeading = /^#{1,6}\s/.test(trimmed);
    const isFence = trimmed.startsWith('```');
    const isBlank = trimmed === '';

    if (isFence) {
      // Fence delimiters bound chunks: flush before opening, push fenced body,
      // flush after closing. Fence lines themselves stay with the fenced chunk
      // so PASS/FAIL detection inside the body remains intact.
      if (!inFence) {
        flush();
        current.push(line);
        inFence = true;
      } else {
        current.push(line);
        inFence = false;
        flush();
      }
      continue;
    }

    if (inFence) {
      current.push(line);
      continue;
    }

    if (isHeading) {
      flush();
      current.push(line);
      continue;
    }

    if (isBlank) {
      // A blank line ends the current chunk. Successive blanks collapse.
      if (current.length > 0) flush();
      continue;
    }

    current.push(line);
  }

  flush();
  return chunks;
}

// ---------------------------------------------------------------------------
// VALIDATOR_ROSTER — single source of truth for the 25 retained validators.
// Consumed by T1.10 (anti-duplication test), T1.12 (hooks.json roster check),
// and T1.13 (cross-platform static scan). 27 original prompt validators minus
// 3 removed per REQ-03 (spec-reviewer, discuss-partner, ui-auditor) plus 1
// added (finding-validator.js — review-pipeline `## Classification` schema,
// distinct from audit-finding-validator.js which validates the audit
// pipeline's `### Validation: F-` schema) = 25.
// Filenames match the kebab-case agent slug and end in `.js`.
// ---------------------------------------------------------------------------
const VALIDATOR_ROSTER = [
  // Audit family (11)
  'security-auditor.js',
  'error-handling-auditor.js',
  'database-auditor.js',
  'architecture-auditor.js',
  'api-auditor.js',
  'frontend-auditor.js',
  'performance-auditor.js',
  'audit-bug-detector.js',
  'audit-report-generator.js',
  'integration-checker.js',
  'swarm-consolidator.js',
  // Review / research-pipeline (11)
  'bug-detector.js',
  'pattern-reviewer.js',
  'plan-compliance-reviewer.js',
  'stack-reviewer.js',
  'fixer.js',
  'researcher.js',
  'assumptions-analyzer.js',
  'dependency-auditor.js',
  'testing-auditor.js',
  'audit-finding-validator.js',
  'finding-validator.js',
  // Semantic (2)
  'implementer.js',
  'quick-implementer.js',
  // Metadata (1)
  'debug-investigator.js',
];

module.exports = {
  readStdinSync,
  safeJsonParse,
  resolveRoot,
  autoModeActive,
  readLastAssistantMessage,
  extractToolCalls,
  emitVerdict,
  splitIntoChunks,
  VALIDATOR_ROSTER,
};
