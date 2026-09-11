#!/usr/bin/env node
// Test: scripts/hooks/validators/validators-lib.js — shared helpers for the
// 24 SubagentStop Node validators.
//
// Contract per Phase 1 T1.1 acceptance:
//   - SIX pure helpers (readStdinSync, safeJsonParse, resolveRoot,
//     autoModeActive, readLastAssistantMessage, extractToolCalls, emitVerdict)
//     plus a chunk-split helper (splitIntoChunks) shared by T1.4 validators.
//   - VALIDATOR_ROSTER exported as a 24-row array.
//   - Helpers never throw; failure modes return null/empty/false.
//   - emitVerdict writes exactly one JSON object via process.stdout.write,
//     no trailing newline, omits `reason` when ok === true.
//
// Mirrors the assert + counter idiom from command-primitives.test.js:31-58.
// Explicit cleanupTmpDirs() before process.exit, per F-PAT-005 (NOT
// process.on('exit', ...)).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LIB_PATH = path.join(__dirname, '..', 'hooks', 'validators', 'validators-lib.js');
const lib = require(LIB_PATH);

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-validator-lib-'));
  tmpDirs.push(dir);
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

// ---------------------------------------------------------------------------
// Module surface
// ---------------------------------------------------------------------------

console.log('=== validators-lib.js: module surface ===');
assert(typeof lib.readStdinSync === 'function', 'exports readStdinSync function');
assert(typeof lib.safeJsonParse === 'function', 'exports safeJsonParse function');
assert(typeof lib.resolveRoot === 'function', 'exports resolveRoot function');
assert(typeof lib.autoModeActive === 'function', 'exports autoModeActive function');
assert(typeof lib.readLastAssistantMessage === 'function', 'exports readLastAssistantMessage function');
assert(typeof lib.extractToolCalls === 'function', 'exports extractToolCalls function');
assert(typeof lib.emitVerdict === 'function', 'exports emitVerdict function');
assert(typeof lib.splitIntoChunks === 'function', 'exports splitIntoChunks function (shared by T1.4)');
assert(Array.isArray(lib.VALIDATOR_ROSTER), 'exports VALIDATOR_ROSTER as array');

// ---------------------------------------------------------------------------
// VALIDATOR_ROSTER — single source of truth
// ---------------------------------------------------------------------------

console.log('\n=== VALIDATOR_ROSTER ===');
assert(lib.VALIDATOR_ROSTER.length === 25, 'roster contains exactly 25 entries (27 minus 3 removed plus 1 added: finding-validator)');
// Sentinel members from each family — confirms the roster covers all four buckets.
assert(lib.VALIDATOR_ROSTER.includes('security-auditor.js'), 'roster covers Audit family (security-auditor.js)');
assert(lib.VALIDATOR_ROSTER.includes('swarm-consolidator.js'), 'roster covers Audit family tail (swarm-consolidator.js)');
assert(lib.VALIDATOR_ROSTER.includes('bug-detector.js'), 'roster covers Review/research family (bug-detector.js)');
assert(lib.VALIDATOR_ROSTER.includes('audit-finding-validator.js'), 'roster covers Review/research family tail (audit-finding-validator.js)');
assert(lib.VALIDATOR_ROSTER.includes('finding-validator.js'), 'roster covers Review/research family (finding-validator.js — F-BUG-001 cross-flow contract fix)');
assert(lib.VALIDATOR_ROSTER.includes('implementer.js'), 'roster covers Semantic family (implementer.js)');
assert(lib.VALIDATOR_ROSTER.includes('quick-implementer.js'), 'roster covers Semantic family (quick-implementer.js)');
assert(lib.VALIDATOR_ROSTER.includes('debug-investigator.js'), 'roster covers Metadata family (debug-investigator.js)');
// Removed-validator absence — confirms REQ-03 removals are honored.
assert(!lib.VALIDATOR_ROSTER.includes('spec-reviewer.js'), 'spec-reviewer.js removed per REQ-03');
assert(!lib.VALIDATOR_ROSTER.includes('discuss-partner.js'), 'discuss-partner.js removed per REQ-03');
assert(!lib.VALIDATOR_ROSTER.includes('ui-auditor.js'), 'ui-auditor.js removed per REQ-03');
// Kebab-case filename invariant — every roster entry MUST end in .js and contain no underscores or uppercase.
{
  const allKebab = lib.VALIDATOR_ROSTER.every((f) => /^[a-z][a-z0-9-]*\.js$/.test(f));
  assert(allKebab, 'all roster filenames are kebab-case ending in .js');
}

// ---------------------------------------------------------------------------
// safeJsonParse — parse failures and non-object inputs return null
// ---------------------------------------------------------------------------

console.log('\n=== safeJsonParse ===');
assert(lib.safeJsonParse('') === null, 'empty string returns null');
assert(lib.safeJsonParse('not json') === null, 'malformed input returns null');
assert(lib.safeJsonParse('[1,2,3]') === null, 'top-level array returns null (validators expect objects)');
assert(lib.safeJsonParse('"hello"') === null, 'top-level primitive string returns null');
assert(lib.safeJsonParse('42') === null, 'top-level number returns null');
assert(lib.safeJsonParse('null') === null, 'JSON null returns null');
{
  const result = lib.safeJsonParse('{"session_id": "abc", "cwd": "/x"}');
  assert(result !== null && result.session_id === 'abc' && result.cwd === '/x', 'valid object parsed with fields preserved');
}

// ---------------------------------------------------------------------------
// resolveRoot — 3 tiers, deterministic precedence
// ---------------------------------------------------------------------------

console.log('\n=== resolveRoot (3-tier precedence) ===');

// Tier 1: payload.cwd present and non-empty wins over env and process.cwd().
{
  const origCpd = process.env.CLAUDE_PROJECT_DIR;
  try {
    process.env.CLAUDE_PROJECT_DIR = '/env-root';
    const result = lib.resolveRoot({ cwd: '/payload-root' });
    assert(result === '/payload-root', 'tier 1: payload.cwd wins over env and process.cwd()');
  } finally {
    if (origCpd !== undefined) process.env.CLAUDE_PROJECT_DIR = origCpd;
    else delete process.env.CLAUDE_PROJECT_DIR;
  }
}

// Tier 1 skip: payload.cwd is empty string → falls through.
{
  const origCpd = process.env.CLAUDE_PROJECT_DIR;
  try {
    process.env.CLAUDE_PROJECT_DIR = '/env-fallback';
    const result = lib.resolveRoot({ cwd: '' });
    assert(result === '/env-fallback', 'tier 1 skips empty-string cwd, env takes over');
  } finally {
    if (origCpd !== undefined) process.env.CLAUDE_PROJECT_DIR = origCpd;
    else delete process.env.CLAUDE_PROJECT_DIR;
  }
}

// Tier 1 skip: payload.cwd not a string → falls through.
{
  const origCpd = process.env.CLAUDE_PROJECT_DIR;
  try {
    process.env.CLAUDE_PROJECT_DIR = '/env-fallback';
    const result = lib.resolveRoot({ cwd: 123 });
    assert(result === '/env-fallback', 'tier 1 skips non-string cwd, env takes over');
  } finally {
    if (origCpd !== undefined) process.env.CLAUDE_PROJECT_DIR = origCpd;
    else delete process.env.CLAUDE_PROJECT_DIR;
  }
}

// Tier 2: CLAUDE_PROJECT_DIR env var when no payload.cwd.
{
  const origCpd = process.env.CLAUDE_PROJECT_DIR;
  try {
    process.env.CLAUDE_PROJECT_DIR = '/env-root';
    const result = lib.resolveRoot({});
    assert(result === '/env-root', 'tier 2: env var used when payload has no cwd');
    const result2 = lib.resolveRoot(null);
    assert(result2 === '/env-root', 'tier 2: env var used when payload is null');
  } finally {
    if (origCpd !== undefined) process.env.CLAUDE_PROJECT_DIR = origCpd;
    else delete process.env.CLAUDE_PROJECT_DIR;
  }
}

// Tier 3: process.cwd() fallback when neither payload.cwd nor env set.
// Necessary mutation with mandatory cleanup (per iter 3 F-005 procedure).
{
  const tmpRoot = makeTmpRoot();
  const orig = process.cwd();
  const origCpd = process.env.CLAUDE_PROJECT_DIR;
  try {
    process.chdir(tmpRoot);
    delete process.env.CLAUDE_PROJECT_DIR;
    const result = lib.resolveRoot({});
    // fs.realpathSync handles macOS /private/var vs /var symlink resolution.
    assert(fs.realpathSync(result) === fs.realpathSync(tmpRoot), 'tier 3: returns process.cwd() when no payload.cwd and no env var');
  } finally {
    process.chdir(orig);
    if (origCpd !== undefined) process.env.CLAUDE_PROJECT_DIR = origCpd;
    else delete process.env.CLAUDE_PROJECT_DIR;
  }
}

// ---------------------------------------------------------------------------
// autoModeActive — file-existence-only signal
// ---------------------------------------------------------------------------

console.log('\n=== autoModeActive ===');

// Marker file present in payload-rooted dir → true.
{
  const tmpRoot = makeTmpRoot();
  fs.mkdirSync(path.join(tmpRoot, '.bee'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, '.bee', '.autonomous-run-active'), '2026-05-12T18:35:00Z\n', 'utf8');
  assert(lib.autoModeActive({ cwd: tmpRoot }) === true, 'returns true when marker exists at <root>/.bee/.autonomous-run-active');
}

// Marker file absent → false.
{
  const tmpRoot = makeTmpRoot();
  assert(lib.autoModeActive({ cwd: tmpRoot }) === false, 'returns false when marker absent (no .bee dir at all)');
}

// .bee/ present but marker absent → false.
{
  const tmpRoot = makeTmpRoot();
  fs.mkdirSync(path.join(tmpRoot, '.bee'), { recursive: true });
  assert(lib.autoModeActive({ cwd: tmpRoot }) === false, 'returns false when .bee/ exists but marker missing');
}

// Never throws even with malformed payload.
{
  let threw = false;
  try {
    lib.autoModeActive(undefined);
    lib.autoModeActive(null);
    lib.autoModeActive({ cwd: 12345 });
  } catch (_) {
    threw = true;
  }
  assert(threw === false, 'never throws on malformed payload (undefined/null/non-string cwd)');
}

// ---------------------------------------------------------------------------
// readLastAssistantMessage — JSONL transcript reader
// ---------------------------------------------------------------------------

console.log('\n=== readLastAssistantMessage ===');

// Missing path → null.
assert(lib.readLastAssistantMessage(undefined) === null, 'undefined path returns null');
assert(lib.readLastAssistantMessage(null) === null, 'null path returns null');
assert(lib.readLastAssistantMessage('') === null, 'empty path returns null');

// Unreadable file → null.
{
  const tmpRoot = makeTmpRoot();
  const noSuch = path.join(tmpRoot, 'does-not-exist.jsonl');
  assert(lib.readLastAssistantMessage(noSuch) === null, 'unreadable file returns null');
}

// Empty file → null.
{
  const tmpRoot = makeTmpRoot();
  const fp = path.join(tmpRoot, 'empty.jsonl');
  fs.writeFileSync(fp, '', 'utf8');
  assert(lib.readLastAssistantMessage(fp) === null, 'empty file returns null');
}

// Malformed JSONL lines are skipped, no throw.
{
  const tmpRoot = makeTmpRoot();
  const fp = path.join(tmpRoot, 'malformed.jsonl');
  fs.writeFileSync(fp, 'not json\n{also not json\n', 'utf8');
  assert(lib.readLastAssistantMessage(fp) === null, 'all-malformed file returns null (no throw)');
}

// Missing entry.message → null.
{
  const tmpRoot = makeTmpRoot();
  const fp = path.join(tmpRoot, 'no-message.jsonl');
  fs.writeFileSync(fp, JSON.stringify({ type: 'assistant' }) + '\n', 'utf8');
  assert(lib.readLastAssistantMessage(fp) === null, 'assistant entry without message returns null');
}

// Missing entry.message.content → null.
{
  const tmpRoot = makeTmpRoot();
  const fp = path.join(tmpRoot, 'no-content.jsonl');
  fs.writeFileSync(fp, JSON.stringify({ type: 'assistant', message: {} }) + '\n', 'utf8');
  assert(lib.readLastAssistantMessage(fp) === null, 'message without content field returns null');
}

// String-content shape — returns content directly.
{
  const tmpRoot = makeTmpRoot();
  const fp = path.join(tmpRoot, 'string-content.jsonl');
  const lines = [
    JSON.stringify({ type: 'user', message: { content: 'hello' } }),
    JSON.stringify({ type: 'assistant', message: { content: 'Task complete. 4 tests passing.' } }),
  ].join('\n');
  fs.writeFileSync(fp, lines + '\n', 'utf8');
  assert(lib.readLastAssistantMessage(fp) === 'Task complete. 4 tests passing.', 'string content shape: returns the string verbatim');
}

// Array-of-blocks shape — concatenates text blocks, skips tool_use blocks.
{
  const tmpRoot = makeTmpRoot();
  const fp = path.join(tmpRoot, 'block-content.jsonl');
  const blocks = [
    { type: 'text', text: 'Reading the file.' },
    { type: 'tool_use', name: 'Read', input: { file_path: '/x' }, id: 't1' },
    { type: 'text', text: 'Now writing.' },
  ];
  fs.writeFileSync(fp, JSON.stringify({ type: 'assistant', message: { content: blocks } }) + '\n', 'utf8');
  const result = lib.readLastAssistantMessage(fp);
  assert(result === 'Reading the file.\nNow writing.', 'array-of-blocks: concatenates text blocks with newline, skips tool_use');
}

// Multiple assistant entries — returns LAST one's content (not first).
{
  const tmpRoot = makeTmpRoot();
  const fp = path.join(tmpRoot, 'multi-assistant.jsonl');
  const lines = [
    JSON.stringify({ type: 'assistant', message: { content: 'first assistant turn' } }),
    JSON.stringify({ type: 'user', message: { content: 'user reply' } }),
    JSON.stringify({ type: 'assistant', message: { content: 'last assistant turn' } }),
  ].join('\n');
  fs.writeFileSync(fp, lines + '\n', 'utf8');
  assert(lib.readLastAssistantMessage(fp) === 'last assistant turn', 'returns LAST assistant entry, not first');
}

// ---------------------------------------------------------------------------
// extractToolCalls — JSONL tool_use extractor
// ---------------------------------------------------------------------------

console.log('\n=== extractToolCalls ===');

// Missing / unreadable → null (caller distinguishes from []).
assert(lib.extractToolCalls(undefined) === null, 'undefined path returns null (distinct from [])');
{
  const tmpRoot = makeTmpRoot();
  assert(lib.extractToolCalls(path.join(tmpRoot, 'nope.jsonl')) === null, 'unreadable file returns null');
}

// Readable but no tool_use blocks → [] (NOT null).
{
  const tmpRoot = makeTmpRoot();
  const fp = path.join(tmpRoot, 'no-tools.jsonl');
  const lines = [
    JSON.stringify({ type: 'assistant', message: { content: 'plain string, no tool calls' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'just text' }] } }),
  ].join('\n');
  fs.writeFileSync(fp, lines + '\n', 'utf8');
  const result = lib.extractToolCalls(fp);
  assert(Array.isArray(result) && result.length === 0, 'returns [] when readable but no tool_use blocks present');
}

// Tool_use blocks across multiple assistant entries → flat collected array.
{
  const tmpRoot = makeTmpRoot();
  const fp = path.join(tmpRoot, 'with-tools.jsonl');
  const lines = [
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'reading' },
          { type: 'tool_use', name: 'Read', input: { file_path: '/a' }, id: 't1' },
        ],
      },
    }),
    JSON.stringify({ type: 'user', message: { content: 'ok' } }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Write', input: { file_path: '/b', content: 'hi' }, id: 't2' },
          { type: 'tool_use', name: 'Bash', input: { command: 'ls' }, id: 't3' },
        ],
      },
    }),
  ].join('\n');
  fs.writeFileSync(fp, lines + '\n', 'utf8');
  const result = lib.extractToolCalls(fp);
  assert(Array.isArray(result) && result.length === 3, 'collects 3 tool_use blocks across 2 assistant entries');
  assert(result[0].name === 'Read' && result[0].input.file_path === '/a' && result[0].id === 't1', 'first tool_use: Read with input + id preserved');
  assert(result[1].name === 'Write' && result[1].input.content === 'hi', 'second tool_use: Write with input preserved');
  assert(result[2].name === 'Bash' && result[2].input.command === 'ls', 'third tool_use: Bash with input preserved');
}

// String-content assistant entries contribute nothing to tool_use list (no array to walk).
{
  const tmpRoot = makeTmpRoot();
  const fp = path.join(tmpRoot, 'mixed-string-and-array.jsonl');
  const lines = [
    JSON.stringify({ type: 'assistant', message: { content: 'string only — no tool_use possible here' } }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/c' }, id: 't9' }],
      },
    }),
  ].join('\n');
  fs.writeFileSync(fp, lines + '\n', 'utf8');
  const result = lib.extractToolCalls(fp);
  assert(Array.isArray(result) && result.length === 1 && result[0].name === 'Edit', 'string-content entries skipped; only array-content tool_use blocks collected');
}

// ---------------------------------------------------------------------------
// emitVerdict — exactly one JSON object to stdout, no trailing newline
// ---------------------------------------------------------------------------

console.log('\n=== emitVerdict (subprocess-isolated stdout capture) ===');

// Run the helper in a subprocess so we can capture stdout cleanly without
// disturbing the test harness's own stdout stream.
function runEmitVerdictSubprocess(snippet) {
  return spawnSync('node', ['-e', snippet], {
    encoding: 'utf8',
    env: { ...process.env },
  });
}

// Pass verdict: { ok: true } only, no `reason` field.
{
  const result = runEmitVerdictSubprocess(
    `const lib = require(${JSON.stringify(LIB_PATH)}); lib.emitVerdict(true);`
  );
  assert(result.status === 0, 'pass verdict subprocess exits 0');
  assert(result.stdout === '{"ok":true}', 'pass verdict stdout is exactly `{"ok":true}` (no newline, no reason)');
}

// Fail verdict: { ok: false, reason: "..." }.
{
  const result = runEmitVerdictSubprocess(
    `const lib = require(${JSON.stringify(LIB_PATH)}); lib.emitVerdict(false, "test failure message");`
  );
  assert(result.status === 0, 'fail verdict subprocess exits 0');
  assert(result.stdout === '{"ok":false,"reason":"test failure message"}', 'fail verdict stdout includes reason, no trailing newline');
}

// Pass verdict ignores reason argument (must not appear in JSON).
{
  const result = runEmitVerdictSubprocess(
    `const lib = require(${JSON.stringify(LIB_PATH)}); lib.emitVerdict(true, "ignored");`
  );
  assert(result.stdout === '{"ok":true}', 'pass verdict ignores reason argument (omitted from JSON)');
}

// ---------------------------------------------------------------------------
// readStdinSync — EOF / empty input returns empty string
// ---------------------------------------------------------------------------

console.log('\n=== readStdinSync (via subprocess with empty stdin) ===');
{
  const result = spawnSync('node', [
    '-e',
    `const lib = require(${JSON.stringify(LIB_PATH)}); process.stdout.write(JSON.stringify({ value: lib.readStdinSync() }));`,
  ], { encoding: 'utf8', input: '' });
  assert(result.status === 0, 'readStdinSync subprocess exits 0 on empty stdin');
  const parsed = JSON.parse(result.stdout);
  assert(parsed.value === '', 'empty stdin returns empty string (EOF safe, no throw on EAGAIN)');
}
{
  const result = spawnSync('node', [
    '-e',
    `const lib = require(${JSON.stringify(LIB_PATH)}); process.stdout.write(JSON.stringify({ value: lib.readStdinSync() }));`,
  ], { encoding: 'utf8', input: '{"session_id":"abc"}' });
  const parsed = JSON.parse(result.stdout);
  assert(parsed.value === '{"session_id":"abc"}', 'piped JSON input returned verbatim');
}

// ---------------------------------------------------------------------------
// splitIntoChunks — TDD red-green chunk-split algorithm (5 cases per F-003)
// ---------------------------------------------------------------------------

console.log('\n=== splitIntoChunks (chunk-split algorithm) ===');

// Case 1: heading-split — `## Setup\n...\n## Run` yields 2 chunks.
{
  const msg = '## Setup\nwrite the failing test\n## Run\nnpm test passes';
  const chunks = lib.splitIntoChunks(msg);
  assert(chunks.length === 2, 'heading-split: 2 markdown headings yield 2 chunks');
  assert(chunks[0].includes('Setup') && chunks[0].includes('failing test'), 'first chunk contains Setup heading + body');
  assert(chunks[1].includes('Run') && chunks[1].includes('npm test'), 'second chunk contains Run heading + body');
}

// Case 2: fence-split — triple-fence block bounds a chunk.
{
  const msg = 'before\n```\nFAIL: test x\n```\nafter';
  const chunks = lib.splitIntoChunks(msg);
  assert(chunks.length >= 2, 'fence-split: fence block creates a chunk boundary');
  const fenceChunk = chunks.find((c) => c.includes('FAIL: test x'));
  assert(fenceChunk !== undefined, 'fence-bounded chunk preserves FAIL content');
}

// Case 3: blank-line-split — multiple blank lines between text yield chunks.
{
  const msg = 'first paragraph\n\n\nsecond paragraph\n\n\nthird paragraph';
  const chunks = lib.splitIntoChunks(msg);
  assert(chunks.length === 3, 'blank-line-split: 2 blank-line gaps yield 3 chunks');
  assert(chunks[0].includes('first') && chunks[1].includes('second') && chunks[2].includes('third'), 'blank-line chunks preserve order');
}

// Case 4: no-boundaries flat — single paragraph yields ONE chunk; red-green cannot be confirmed.
{
  const msg = 'one paragraph of text with no headings or fences or blank lines';
  const chunks = lib.splitIntoChunks(msg);
  assert(chunks.length === 1, 'no-boundaries: single paragraph yields exactly 1 chunk');
}

// Case 5: mixed — heading + fence + blank-line yields ordered chunks where FAIL precedes PASS.
{
  const msg = '## Red phase\n\n```\nFAIL: assert false\n```\n\n## Green phase\n\n```\nPASS: assert true\n```';
  const chunks = lib.splitIntoChunks(msg);
  assert(chunks.length >= 2, 'mixed: heading+fence+blank yields multiple chunks');
  const failIdx = chunks.findIndex((c) => c.includes('FAIL'));
  const passIdx = chunks.findIndex((c) => c.includes('PASS'));
  assert(failIdx !== -1 && passIdx !== -1 && failIdx < passIdx, 'FAIL chunk precedes PASS chunk in mixed message');
}

// ---------------------------------------------------------------------------
// Cleanup + summary
// ---------------------------------------------------------------------------

cleanupTmpDirs();
const total = passed + failed;
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${total} assertions`);
process.exit(failed > 0 ? 1 : 0);
