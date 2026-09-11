#!/usr/bin/env node
// Test: scripts/hooks/emit-event.js — Claude Code hooks event producer.
//
// These tests cover Quick 010 acceptance criteria for the append-only event
// producer that wires PreToolUse, PostToolUse, Stop, SubagentStop, and
// UserPromptSubmit hooks into a daily-rotated .bee/events/YYYY-MM-DD.jsonl log.
//
// Strategy: hybrid structural + behavioral.
//   - Structural: parse hooks.json, assert new matcher-groups are present AND
//     all pre-existing matcher-groups are preserved verbatim. Syntax-check the
//     emit-event.js script via `node --check`.
//   - Behavioral: spawn emit-event.js via spawnSync with fixture stdin and
//     CLAUDE_PROJECT_DIR pointed at a fresh tmpdir. Read the resulting jsonl
//     file and assert the 10-field schema, type shapes, null defaults, and
//     the critical stdout-silence + exit-0-always contracts.
//
// Covers Quick 010 acceptance criteria 1-14. Mirrors the hand-rolled assert
// pattern from hive-api-file.test.js — no test runner dependency.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Anchor all file paths to __dirname so the test is robust to any install
// layout (repo checkout, plugin cache, symlink workspace). Mirrors the
// __dirname-relative pattern used by hive-api-file.test.js:24.
const SCRIPT_PATH = path.join(__dirname, '..', 'hooks', 'emit-event.js');
const HOOKS_JSON_PATH = path.join(__dirname, '..', '..', 'hooks', 'hooks.json');

// REPO_ROOT is only needed as the `cwd` for `git check-ignore` (Test 16).
// Discover it dynamically via `git rev-parse --show-toplevel` so the test
// works from any clone path. Fall back to a __dirname-relative ascent if git
// is unavailable (e.g., running from a non-git extracted tarball).
const REPO_ROOT = (() => {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: __dirname,
    encoding: 'utf8',
  });
  if (result.status === 0 && result.stdout) {
    return result.stdout.trim();
  }
  return path.resolve(__dirname, '..', '..', '..', '..');
})();

let passed = 0;
let failed = 0;
const tmpDirs = [];

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${testName}`);
  } else {
    failed++;
    console.log(`  FAIL: ${testName}`);
  }
}

function makeTmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-events-'));
  tmpDirs.push(dir);
  // Create .bee/.hive-pid so the emit-event.js guard allows writing.
  // The guard checks for this file to ensure events are only produced
  // when the Bee Hive dashboard is actively running.
  const beeDir = path.join(dir, '.bee');
  fs.mkdirSync(beeDir, { recursive: true });
  fs.writeFileSync(path.join(beeDir, '.hive-pid'), '99999', 'utf8');
  return dir;
}

function cleanupTmpDirs() {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
      /* best effort */
    }
  }
}

function runEmit(kind, stdinJson, tmpRoot) {
  return spawnSync('node', [SCRIPT_PATH, kind], {
    input: stdinJson == null ? '' : stdinJson,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmpRoot },
  });
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function readJsonlLines(tmpRoot) {
  const file = path.join(tmpRoot, '.bee', 'events', todayUtc() + '.jsonl');
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  return text.split('\n').filter((l) => l.length > 0);
}

function safeParse(line) {
  if (typeof line !== 'string' || line.length === 0) return null;
  try {
    return JSON.parse(line);
  } catch (_) {
    return null;
  }
}

// ============================================================
// Test 1: Script file exists and is syntactically valid
// ============================================================
console.log('Test 1: Script file exists and is syntactically valid Node.js');
assert(fs.existsSync(SCRIPT_PATH), 'emit-event.js exists at expected path');
if (fs.existsSync(SCRIPT_PATH)) {
  const syntax = spawnSync('node', ['--check', SCRIPT_PATH], {
    encoding: 'utf8',
  });
  assert(syntax.status === 0, 'emit-event.js passes `node --check` syntax validation');
} else {
  assert(false, 'emit-event.js passes `node --check` syntax validation');
}

// ============================================================
// Test 2: Script source uses zero-dep Node built-ins only
// ============================================================
console.log('\nTest 2: Zero-dep Node style');
let scriptSrc = '';
try {
  scriptSrc = fs.readFileSync(SCRIPT_PATH, 'utf8');
} catch (_) {
  scriptSrc = '';
}
assert(scriptSrc.length > 0, 'can read emit-event.js source');
assert(
  /require\(['"]fs['"]\)/.test(scriptSrc) && /require\(['"]path['"]\)/.test(scriptSrc),
  'imports fs and path built-ins'
);
assert(
  !/console\.log/.test(scriptSrc),
  'script contains NO console.log calls (stdout silence contract)'
);
assert(
  !/process\.stdout\.write/.test(scriptSrc),
  'script contains NO process.stdout.write calls'
);
assert(
  /CLAUDE_PROJECT_DIR/.test(scriptSrc),
  'script reads process.env.CLAUDE_PROJECT_DIR'
);
assert(
  /process\.exit\(0\)/.test(scriptSrc),
  'script explicitly exits 0 (never non-zero)'
);
assert(
  !/process\.exit\([^0)]/.test(scriptSrc),
  'script never calls process.exit with a non-zero argument'
);

// ============================================================
// Test 3: PreToolUse with file-path payload writes a valid event line
// ============================================================
console.log('\nTest 3: PreToolUse with Edit file_path payload');
{
  const tmp = makeTmpRoot();
  const payload = JSON.stringify({
    session_id: 'sess-abc',
    tool_name: 'Edit',
    tool_input: { file_path: 'src/App.tsx' },
  });
  const result = runEmit('pre_tool_use', payload, tmp);
  assert(result.status === 0, 'exits 0 on valid pre_tool_use payload');
  assert(result.stdout === '', 'stdout is empty (zero bytes)');

  const lines = readJsonlLines(tmp);
  assert(lines.length === 1, 'wrote exactly one jsonl line');
  let event = null;
  try {
    event = JSON.parse(lines[0] || '{}');
  } catch (_) {
    /* invalid JSON */
  }
  assert(event && typeof event === 'object', 'line is a valid JSON object');
  if (event) {
    const expectedKeys = [
      'ts',
      'session',
      'kind',
      'tool',
      'agent',
      'filePath',
      'command',
      'durationMs',
      'success',
      'cwd',
    ];
    const actualKeys = new Set(Object.keys(event));
    // Additive-schema contract: every original key MUST still be present
    // (existing readers MUST NOT break). Extra fields (e.g., hookDurationMs
    // added in NFR-03 instrumentation) are explicitly allowed.
    const missing = expectedKeys.filter((k) => !actualKeys.has(k));
    assert(
      missing.length === 0,
      'event still has all 10 original keys (additive-schema contract): missing=' + JSON.stringify(missing)
    );
    assert(event.kind === 'pre_tool_use', 'kind is "pre_tool_use"');
    assert(event.session === 'sess-abc', 'session is "sess-abc"');
    assert(event.tool === 'Edit', 'tool is "Edit"');
    assert(event.filePath === 'src/App.tsx', 'filePath is "src/App.tsx"');
    assert(event.command === null, 'command is null (not a Bash call)');
    assert(event.agent === null, 'agent is null (no agent_type in payload)');
    assert(event.durationMs === null, 'durationMs is null');
    assert(event.success === null, 'success is null');
    assert(event.cwd === tmp, 'cwd matches CLAUDE_PROJECT_DIR');
    assert(typeof event.ts === 'string', 'ts is a string');
    assert(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.ts || ''),
      'ts is ISO 8601 with milliseconds in UTC (YYYY-MM-DDTHH:mm:ss.sssZ)'
    );
    assert(
      (event.ts || '').slice(0, 10) === todayUtc(),
      'ts date portion matches today (UTC)'
    );
  } else {
    for (let i = 0; i < 14; i++) assert(false, 'field check skipped (event parse failed)');
  }
}

// ============================================================
// Test 4: PreToolUse with Bash command payload
// ============================================================
console.log('\nTest 4: PreToolUse with Bash command payload');
{
  const tmp = makeTmpRoot();
  const payload = JSON.stringify({
    session_id: 'sess-bash',
    tool_name: 'Bash',
    tool_input: { command: 'git status' },
  });
  const result = runEmit('pre_tool_use', payload, tmp);
  assert(result.status === 0, 'exits 0');
  assert(result.stdout === '', 'stdout is empty');
  const lines = readJsonlLines(tmp);
  assert(lines.length === 1, 'one line written');
  const event = safeParse(lines[0]) || {};
  assert(event.tool === 'Bash', 'tool is "Bash"');
  assert(event.command === 'git status', 'command is "git status"');
  assert(event.filePath === null, 'filePath is null (Bash has no file_path)');
}

// ============================================================
// Test 5: SubagentStop with agent_type — bee: prefix stripped
// ============================================================
console.log('\nTest 5: SubagentStop strips bee: prefix from agent_type');
{
  const tmp = makeTmpRoot();
  const payload = JSON.stringify({
    session_id: 'sess-sub',
    agent_type: 'bee:quick-implementer',
  });
  const result = runEmit('subagent_stop', payload, tmp);
  assert(result.status === 0, 'exits 0');
  assert(result.stdout === '', 'stdout is empty');
  const lines = readJsonlLines(tmp);
  assert(lines.length === 1, 'one line written');
  const event = safeParse(lines[0]) || {};
  assert(event.kind === 'subagent_stop', 'kind is "subagent_stop"');
  assert(
    event.agent === 'quick-implementer',
    'agent is "quick-implementer" (bee: prefix stripped)'
  );
  assert(event.tool === null, 'tool is null');
  assert(event.filePath === null, 'filePath is null');
}

// ============================================================
// Test 6: PostToolUse with tool_response fields
// ============================================================
console.log('\nTest 6: PostToolUse extracts durationMs and success');
{
  const tmp = makeTmpRoot();
  const payload = JSON.stringify({
    session_id: 'sess-post',
    tool_name: 'Edit',
    tool_input: { file_path: 'x.ts' },
    tool_response: { duration_ms: 1234, success: true },
  });
  const result = runEmit('post_tool_use', payload, tmp);
  assert(result.status === 0, 'exits 0');
  assert(result.stdout === '', 'stdout is empty');
  const lines = readJsonlLines(tmp);
  assert(lines.length === 1, 'one line written');
  const event = safeParse(lines[0]) || {};
  assert(event.kind === 'post_tool_use', 'kind is "post_tool_use"');
  assert(event.durationMs === 1234, 'durationMs extracted from tool_response');
  assert(event.success === true, 'success extracted from tool_response');
}

// ============================================================
// Test 7: Stop lifecycle event (empty stdin)
// ============================================================
console.log('\nTest 7: Stop lifecycle event with empty stdin');
{
  const tmp = makeTmpRoot();
  const result = runEmit('stop', '', tmp);
  assert(result.status === 0, 'exits 0 on empty stdin');
  assert(result.stdout === '', 'stdout is empty');
  const lines = readJsonlLines(tmp);
  assert(lines.length === 1, 'one line written even with empty stdin');
  const event = safeParse(lines[0]) || {};
  assert(event.kind === 'stop', 'kind is "stop"');
  assert(event.session === null, 'session is null (no payload)');
  assert(event.tool === null, 'tool is null');
  assert(event.agent === null, 'agent is null');
  assert(event.filePath === null, 'filePath is null');
  assert(event.command === null, 'command is null');
  assert(event.durationMs === null, 'durationMs is null');
  assert(event.success === null, 'success is null');
  assert(event.cwd === tmp, 'cwd still populated');
  assert(typeof event.ts === 'string', 'ts still populated');
}

// ============================================================
// Test 8: UserPromptSubmit kind accepted
// ============================================================
console.log('\nTest 8: UserPromptSubmit kind produces an event');
{
  const tmp = makeTmpRoot();
  const result = runEmit('user_prompt_submit', '{}', tmp);
  assert(result.status === 0, 'exits 0');
  assert(result.stdout === '', 'stdout is empty');
  const lines = readJsonlLines(tmp);
  assert(lines.length === 1, 'one line written');
  const event = safeParse(lines[0]) || {};
  assert(event.kind === 'user_prompt_submit', 'kind is "user_prompt_submit"');
}

// ============================================================
// Test 9: Unknown kind is silently ignored
// ============================================================
console.log('\nTest 9: Unknown kind exits 0 without writing a line');
{
  const tmp = makeTmpRoot();
  const result = runEmit('weird_unknown_kind', '{}', tmp);
  assert(result.status === 0, 'exits 0 on unknown kind');
  assert(result.stdout === '', 'stdout is empty');
  const lines = readJsonlLines(tmp);
  assert(lines.length === 0, 'no jsonl line written for unknown kind');
}

// ============================================================
// Test 10: Malformed stdin falls through to null payload event
// ============================================================
console.log('\nTest 10: Malformed stdin produces event with null payload fields');
{
  const tmp = makeTmpRoot();
  const result = runEmit('pre_tool_use', 'not{ json at all', tmp);
  assert(result.status === 0, 'exits 0 on malformed JSON stdin');
  assert(result.stdout === '', 'stdout is empty');
  const lines = readJsonlLines(tmp);
  assert(lines.length === 1, 'one line written (AC2: fall through to null payload)');
  const event = safeParse(lines[0]) || {};
  assert(event.kind === 'pre_tool_use', 'kind preserved from argv');
  assert(event.session === null, 'session null after parse failure');
  assert(event.tool === null, 'tool null after parse failure');
  assert(event.filePath === null, 'filePath null after parse failure');
}

// ============================================================
// Test 11: Daily rotation file path
// ============================================================
console.log('\nTest 11: Output path is .bee/events/YYYY-MM-DD.jsonl');
{
  const tmp = makeTmpRoot();
  runEmit('stop', '', tmp);
  const expected = path.join(tmp, '.bee', 'events', todayUtc() + '.jsonl');
  assert(fs.existsSync(expected), 'jsonl file exists at expected daily path');
  const dir = path.join(tmp, '.bee', 'events');
  assert(fs.existsSync(dir), '.bee/events/ directory was lazily created');
  assert(
    fs.existsSync(dir) && fs.statSync(dir).isDirectory(),
    '.bee/events/ is a directory'
  );
}

// ============================================================
// Test 12: Sequential append safety — 10 invocations produce 10 lines
// ============================================================
console.log('\nTest 12: Ten sequential appends produce ten distinct lines');
{
  const tmp = makeTmpRoot();
  for (let i = 0; i < 10; i++) {
    const payload = JSON.stringify({
      session_id: `sess-${i}`,
      tool_name: 'Edit',
      tool_input: { file_path: `file-${i}.ts` },
    });
    runEmit('pre_tool_use', payload, tmp);
  }
  const lines = readJsonlLines(tmp);
  assert(lines.length === 10, 'ten lines written after ten invocations');
  let allValid = true;
  let allDistinct = true;
  const seenSessions = new Set();
  for (const line of lines) {
    const ev = safeParse(line);
    if (!ev) {
      allValid = false;
      continue;
    }
    if (seenSessions.has(ev.session)) allDistinct = false;
    seenSessions.add(ev.session);
  }
  assert(allValid, 'all 10 lines are valid JSON (no interleaved corruption)');
  assert(allDistinct, 'all 10 lines have distinct session ids');
}

// ============================================================
// Test 13: 10 MB stdin cap — oversized input does not crash
// ============================================================
console.log('\nTest 13: Oversized stdin (>10 MB) does not crash the hook');
{
  const tmp = makeTmpRoot();
  const giant = 'x'.repeat(11 * 1024 * 1024);
  const result = runEmit('pre_tool_use', giant, tmp);
  assert(result.status === 0, 'exits 0 on oversized stdin');
  assert(result.stdout === '', 'stdout is empty');
}

// ============================================================
// Test 14: hooks.json structural wiring
// ============================================================
console.log('\nTest 14: hooks.json has new matcher-groups appended additively');
let hooksJson = null;
let hooksRaw = '';
try {
  hooksRaw = fs.readFileSync(HOOKS_JSON_PATH, 'utf8');
  hooksJson = JSON.parse(hooksRaw);
} catch (e) {
  assert(false, 'hooks.json parses as valid JSON: ' + e.message);
}

if (hooksJson && hooksJson.hooks) {
  const h = hooksJson.hooks;

  // Helper: does any matcher-group in the given event array wire emit-event for the given kind?
  // Matches both the direct `emit-event.js` and the `emit-event-gate.sh` wrapper (the gate execs
  // emit-event.js only when a consumer is active — see emit-event-gate.sh).
  function findEmitGroup(eventArr, kind) {
    if (!Array.isArray(eventArr)) return null;
    for (const group of eventArr) {
      const inner = group && Array.isArray(group.hooks) ? group.hooks : [];
      for (const entry of inner) {
        if (
          entry &&
          entry.type === 'command' &&
          typeof entry.command === 'string' &&
          entry.command.includes('scripts/hooks/emit-event') &&
          entry.command.endsWith(' ' + kind)
        ) {
          return { group, entry };
        }
      }
    }
    return null;
  }

  // PreToolUse — the redundant pre_tool_use emit was DROPPED for speed (the dashboard
  // already hides pre events: LiveActivityPanel filters ev.kind !== 'pre_tool_use').
  assert(Array.isArray(h.PreToolUse), 'PreToolUse is an array');
  const pre = findEmitGroup(h.PreToolUse, 'pre_tool_use');
  assert(pre === null, 'PreToolUse no longer emits a pre_tool_use event (dropped — dashboard hides pre events)');

  // PostToolUse
  const post = findEmitGroup(h.PostToolUse, 'post_tool_use');
  assert(post !== null, 'PostToolUse contains an emit-event.js post_tool_use entry');
  if (post) {
    assert(post.entry.timeout === 5, 'PostToolUse emit-event entry has timeout: 5');
    assert(
      post.group.matcher === undefined,
      'PostToolUse emit-event group has no matcher'
    );
  }

  // Stop
  const stop = findEmitGroup(h.Stop, 'stop');
  assert(stop !== null, 'Stop contains an emit-event.js stop entry');
  if (stop) {
    assert(stop.entry.timeout === 5, 'Stop emit-event entry has timeout: 5');
  }

  // SubagentStop
  const sub = findEmitGroup(h.SubagentStop, 'subagent_stop');
  assert(sub !== null, 'SubagentStop contains an emit-event.js subagent_stop entry');
  if (sub) {
    assert(sub.entry.timeout === 5, 'SubagentStop emit-event entry has timeout: 5');
    assert(
      sub.group.matcher === undefined,
      'SubagentStop emit-event group has no matcher (catch-all, after all validators)'
    );
    // It should be the LAST group in SubagentStop.
    const lastGroup = h.SubagentStop[h.SubagentStop.length - 1];
    assert(
      lastGroup === sub.group,
      'SubagentStop emit-event group is the LAST entry (after all 25+ validators)'
    );
  }

  // UserPromptSubmit
  const ups = findEmitGroup(h.UserPromptSubmit, 'user_prompt_submit');
  assert(ups !== null, 'UserPromptSubmit contains an emit-event.js user_prompt_submit entry');
  if (ups) {
    assert(ups.entry.timeout === 5, 'UserPromptSubmit emit-event entry has timeout: 5');
  }
}

// ============================================================
// Test 15: hooks.json preserves pre-existing matcher-groups verbatim
// ============================================================
console.log('\nTest 15: hooks.json preserves all pre-existing matcher-groups');
if (hooksJson && hooksJson.hooks) {
  // Pre-existing commands that MUST still appear somewhere in hooks.json
  const requiredSubstrings = [
    'scripts/load-context.sh',
    'scripts/setup-statusline.js',
    'scripts/auto-lint.sh',
    'scripts/save-session-context.sh',
    'scripts/inject-memory.sh',
    'scripts/stop-review-check.sh',
    'scripts/pre-commit-gate.sh',
    'scripts/session-end-summary.sh',
  ];
  for (const sub of requiredSubstrings) {
    assert(
      hooksRaw.includes(sub),
      `hooks.json still contains pre-existing script reference: ${sub}`
    );
  }

  // Count matcher-groups that use type:"command" — perf/validator-dispatcher consolidated the
  // 25 per-agent SubagentStop matchers into a single dispatch.js entry. SubagentStop now has
  // exactly 2 type:"command" entries: dispatch.js (routes all 25 validators in-process) + the
  // terminal emit-event-gate.sh catch-all. The 25 matchers live in dispatch.js RULES.
  let commandValidatorCount = 0;
  if (Array.isArray(hooksJson.hooks.SubagentStop)) {
    for (const grp of hooksJson.hooks.SubagentStop) {
      if (grp && Array.isArray(grp.hooks)) {
        for (const entry of grp.hooks) {
          if (entry && entry.type === 'command') commandValidatorCount++;
        }
      }
    }
  }
  assert(
    commandValidatorCount === 2,
    `SubagentStop has exactly 2 type:"command" entries (dispatcher + catch-all) (found ${commandValidatorCount})`
  );

  // Specific existing matcher-groups we promised to preserve.
  const preBash = (hooksJson.hooks.PreToolUse || []).find(
    (g) => g && g.matcher === 'Bash'
  );
  assert(
    preBash !== undefined,
    'PreToolUse still has the Bash matcher-group (pre-commit-gate.sh)'
  );

  const postWE = (hooksJson.hooks.PostToolUse || []).find(
    (g) => g && g.matcher === 'Write|Edit'
  );
  assert(
    postWE !== undefined,
    'PostToolUse still has the Write|Edit matcher-group (auto-lint.sh)'
  );
}

// ============================================================
// Test 16: .gitignore already covers .bee/events/ via broad rule
// ============================================================
console.log('\nTest 16: .gitignore covers .bee/events/ via existing broad rule');
{
  const result = spawnSync(
    'git',
    ['check-ignore', '-v', '.bee/events/test.jsonl'],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  );
  assert(
    result.status === 0,
    'git check-ignore exits 0 for .bee/events/test.jsonl (file is ignored)'
  );
  assert(
    /\.gitignore:\d+:\.bee\//.test(result.stdout || ''),
    '.bee/events/test.jsonl is ignored via the existing .bee/ rule in .gitignore'
  );
}

// ============================================================
// Test 17: Silent failure — unwritable output dir cannot crash the hook
// ============================================================
console.log('\nTest 17: Silent failure on unwritable output directory');
{
  const tmp = makeTmpRoot();
  // Create .bee/events as a FILE so mkdir fails downstream (ENOTDIR on append).
  // Script must still exit 0 and stdout must be empty.
  fs.mkdirSync(path.join(tmp, '.bee'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.bee', 'events'), 'blocker', 'utf8');
  const result = runEmit('stop', '', tmp);
  assert(result.status === 0, 'exits 0 even when output dir cannot be created');
  assert(result.stdout === '', 'stdout is empty on failure path');
}

// ============================================================
// Cleanup and summary
// ============================================================
cleanupTmpDirs();
const total = passed + failed;
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${total} assertions`);
process.exit(failed > 0 ? 1 : 0);
