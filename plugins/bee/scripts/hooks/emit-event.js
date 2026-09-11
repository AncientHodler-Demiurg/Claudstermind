#!/usr/bin/env node
// emit-event.js — Claude Code hooks → .bee/events/YYYY-MM-DD.jsonl producer.
//
// Usage (wired in plugins/bee/hooks/hooks.json):
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/emit-event.js <kind>
//
// Where <kind> is one of:
//   pre_tool_use | post_tool_use | stop | subagent_stop | user_prompt_submit
//
// Reads the Claude Code hook payload from stdin (JSON), extracts a small set
// of fields, and atomically appends one JSON line to a daily-rotated log at
// {CLAUDE_PROJECT_DIR}/.bee/events/YYYY-MM-DD.jsonl.
//
// HARD CONTRACTS:
//   1. Zero bytes to stdout on every code path. PreToolUse treats any stdout
//      as a BLOCK signal (see pre-commit-gate.sh:4).
//   2. Always exit 0. A non-zero exit from a PreToolUse/PostToolUse hook can
//      block the user's tool call. Catch every error, swallow it, exit 0.
//   3. Never throw across the top-level try/catch.
//   4. No external dependencies. Only fs, path, and built-in process.

const fs = require('fs');
const path = require('path');

const KNOWN_KINDS = new Set([
  'pre_tool_use',
  'post_tool_use',
  'stop',
  'subagent_stop',
  'user_prompt_submit',
]);

const MAX_STDIN_BYTES = 10 * 1024 * 1024; // 10 MB defensive cap

function resolveRoot() {
  const env = process.env.CLAUDE_PROJECT_DIR;
  if (typeof env === 'string' && env.length > 0) return env;
  return process.cwd();
}

function readStdinSync() {
  // fs.readFileSync(0) reads from stdin file descriptor. Wrapped because
  // it throws EAGAIN on some platforms when no data is piped.
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

function pickString(obj, key) {
  if (!obj || typeof obj !== 'object') return null;
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function pickNumber(obj, key) {
  if (!obj || typeof obj !== 'object') return null;
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function pickBool(obj, key) {
  if (!obj || typeof obj !== 'object') return null;
  const v = obj[key];
  return typeof v === 'boolean' ? v : null;
}

function stripBeePrefix(agentType) {
  if (typeof agentType !== 'string') return null;
  const stripped = agentType.startsWith('bee:') ? agentType.slice(4) : agentType;
  return stripped.length > 0 ? stripped : null;
}

function buildEvent(kind, payload, cwd) {
  const toolInput = payload && typeof payload.tool_input === 'object' ? payload.tool_input : null;
  const toolResponse = payload && typeof payload.tool_response === 'object' ? payload.tool_response : null;

  // success: prefer explicit `success` boolean, fall back to !is_error.
  let success = pickBool(toolResponse, 'success');
  if (success === null && toolResponse && typeof toolResponse.is_error === 'boolean') {
    success = !toolResponse.is_error;
  }

  return {
    ts: new Date().toISOString(),
    session: pickString(payload, 'session_id'),
    kind: kind,
    tool: pickString(payload, 'tool_name'),
    agent: stripBeePrefix(payload && payload.agent_type),
    filePath: pickString(toolInput, 'file_path'),
    command: pickString(toolInput, 'command'),
    durationMs: pickNumber(toolResponse, 'duration_ms'),
    success: success,
    cwd: cwd,
  };
}

function writeLastError(root, message) {
  try {
    const dir = path.join(root, '.bee', 'events');
    fs.mkdirSync(dir, { recursive: true });
    const line = new Date().toISOString() + ' ' + String(message).replace(/\s+/g, ' ') + '\n';
    fs.appendFileSync(path.join(dir, '.last-error'), line, 'utf8');
  } catch (_) {
    /* best effort */
  }
}

function main() {
  const kind = process.argv[2];
  if (!kind || !KNOWN_KINDS.has(kind)) {
    // Unknown / missing kind — silently ignore.
    return;
  }

  const root = resolveRoot();

  // Guard: only write events when there is an active consumer for them.
  // Two consumer signals exist; either one is sufficient to proceed:
  //   1. .bee/.hive-pid — written by hive-start.sh, cleaned up by hive-stop.sh.
  //      Signals the dashboard is actively reading events.
  //   2. .bee/.autonomous-run-active — written by autonomous orchestration
  //      (execute-phase / ship). Autonomous runs need SubagentStop telemetry
  //      as the fallback transcript_path source for batch validator stdin
  //      payloads (REQ-09 aggregation). Without this bypass, autonomous runs
  //      without an active dashboard silently drop telemetry.
  // When NEITHER marker is present we exit silently to avoid:
  //   (a) creating .bee/events/ in non-bee projects (no .bee/ dir at all)
  //   (b) growing stale .jsonl files in bee projects that don't use the dashboard
  const hivePidExists = fs.existsSync(path.join(root, '.bee', '.hive-pid'));
  const autonomousActive = fs.existsSync(path.join(root, '.bee', '.autonomous-run-active'));
  if (!hivePidExists && !autonomousActive) return;

  const hookStart = Date.now();
  const raw = readStdinSync();
  const payload = safeJsonParse(raw);
  const event = buildEvent(kind, payload, root);
  event.hookDurationMs = Date.now() - hookStart;

  const dir = path.join(root, '.bee', 'events');
  const file = path.join(dir, event.ts.slice(0, 10) + '.jsonl');

  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8');
}

// Top-level try/catch: nothing escapes, exit always 0.
try {
  main();
} catch (err) {
  try {
    writeLastError(resolveRoot(), (err && err.message) || String(err));
  } catch (_) {
    /* best effort */
  }
}

process.exit(0);
