#!/usr/bin/env node
// Test: scripts/hooks/validators/debug-investigator.js — SubagentStop Node
// validator for the debug-investigator agent (T1.5 of v4.5.0 spec).
//
// Each assertion drives its expected verdict from a synthesized SubagentStop
// payload + transcript JSONL. The validator MUST:
//   - skip (emit {"ok":true}) when auto-mode is INACTIVE (no .bee/.autonomous-run-active)
//   - fail closed on missing transcript_path or unreadable transcript
//   - fail when the last assistant message lacks one of the three canonical
//     signal headings (ROOT CAUSE FOUND / CHECKPOINT REACHED / INVESTIGATION
//     INCONCLUSIVE)
//   - enforce per-signal subfields (Evidence + Confidence + file:line for
//     ROOT CAUSE; Type + What I Need for CHECKPOINT; Checked + Remaining
//     Possibilities for INCONCLUSIVE)
//   - reject Write/Edit tool_use calls whose file_path escapes .bee/debug/
//     (absolute outside, relative outside, .. traversal, Windows separators
//     all routed through one POSIX canonicalisation)
//   - distinguish three metadata failure modes with three distinct reason
//     strings (Rule 9): transcript_path unreadable (entire transcript bad),
//     "cannot verify write-confinement; metadata unavailable" (tool-call
//     extraction failed), vacuously-safe (empty tool-call array)
//   - enforce the 7-hypothesis ceiling and the pruning-vs-archival audit trail
//
// Mirrors the assert + counter idiom from validator-lib.test.js:30-38.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const VALIDATOR = path.join(
  __dirname,
  '..',
  'hooks',
  'validators',
  'debug-investigator.js'
);

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

function makeTmpRoot(autoMode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-di-validator-'));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, '.bee'), { recursive: true });
  if (autoMode) {
    fs.writeFileSync(path.join(dir, '.bee', '.autonomous-run-active'), '');
  }
  return dir;
}

function writeTranscript(root, jsonlEntries) {
  const transcriptPath = path.join(root, 'transcript.jsonl');
  fs.writeFileSync(transcriptPath, jsonlEntries.map((e) => JSON.stringify(e)).join('\n'));
  return transcriptPath;
}

function assistantTextOnly(text) {
  return { type: 'assistant', message: { content: text } };
}

function assistantBlocks(blocks) {
  return { type: 'assistant', message: { content: blocks } };
}

function run(payload) {
  const r = spawnSync('node', [VALIDATOR], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
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
// Marker semantics
// ---------------------------------------------------------------------------

console.log('=== debug-investigator.js: marker-skip semantics ===');

{
  // Auto-mode INACTIVE: the validator MUST pass without inspecting content.
  // This is the base-inclusion contract from REQ-10: validators only run
  // during autonomous executions.
  const root = makeTmpRoot(false);
  const transcriptPath = writeTranscript(root, [
    assistantTextOnly('no signal heading at all and nothing else'),
  ]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout === '{"ok":true}' && out.status === 0,
    'auto-mode INACTIVE: validator skips structural checks and emits {"ok":true}'
  );
}

// ---------------------------------------------------------------------------
// Payload integrity
// ---------------------------------------------------------------------------

console.log('=== debug-investigator.js: payload integrity ===');

{
  // Missing transcript_path: cannot proceed; emit a distinct reason string
  // so debug-time diagnosis can tell "validator hit a malformed payload"
  // apart from "transcript was provided but unreadable".
  const root = makeTmpRoot(true);
  const out = run({ session_id: 's', cwd: root, hook_event_name: 'SubagentStop' });
  assert(
    out.stdout.includes('"ok":false') && out.stdout.includes('missing transcript_path'),
    'missing transcript_path field emits {"ok":false, reason: invalid SubagentStop payload (missing transcript_path)}'
  );
}

{
  // Transcript file at the named path does not exist on disk: this is
  // distinct from "extractToolCalls returned null" (which means the file
  // was readable enough for the text path but tool extraction failed) and
  // distinct from "empty tool-call array" (vacuously safe).
  const root = makeTmpRoot(true);
  const out = run({
    session_id: 's',
    transcript_path: path.join(root, 'does-not-exist.jsonl'),
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout.includes('"transcript_path unreadable"'),
    'unreadable transcript emits "transcript_path unreadable" (distinct from metadata-unavailable)'
  );
}

// ---------------------------------------------------------------------------
// Signal-heading enforcement (Check 1)
// ---------------------------------------------------------------------------

console.log('=== debug-investigator.js: signal-heading enforcement ===');

{
  // An agent message with no canonical signal heading violates the agent's
  // output contract — the conductor downstream cannot route the response.
  const root = makeTmpRoot(true);
  const transcriptPath = writeTranscript(root, [
    assistantTextOnly('I poked around but here are some thoughts without a heading.'),
  ]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout.includes('missing investigation signal'),
    'no ROOT CAUSE / CHECKPOINT / INCONCLUSIVE heading → fail with "missing investigation signal"'
  );
}

// ---------------------------------------------------------------------------
// ROOT CAUSE FOUND subfields (Check 2)
// ---------------------------------------------------------------------------

console.log('=== debug-investigator.js: ROOT CAUSE FOUND subfields ===');

{
  // Happy path: Evidence section + backtick file:line citation + Confidence.
  const root = makeTmpRoot(true);
  const body = [
    '## ROOT CAUSE FOUND',
    'Evidence: the bug is in `app/Http/Controllers/AuthController.php:42` (token refresh).',
    'Confidence: HIGH',
  ].join('\n');
  const transcriptPath = writeTranscript(root, [assistantTextOnly(body)]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout === '{"ok":true}',
    'ROOT CAUSE FOUND with Evidence + backtick file:line + Confidence → pass'
  );
}

{
  // No backtick file:line citation: Evidence and Confidence both present but
  // the citation that proves the agent looked at real code is missing.
  const root = makeTmpRoot(true);
  const body = [
    '## ROOT CAUSE FOUND',
    'Evidence: I saw it in the controller somewhere.',
    'Confidence: HIGH',
  ].join('\n');
  const transcriptPath = writeTranscript(root, [assistantTextOnly(body)]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout.includes('backtick file:line citation'),
    'ROOT CAUSE FOUND without `path:NN` citation → fail (citation is the evidence anchor)'
  );
}

{
  // Missing Confidence: agent contract requires it for ROOT CAUSE; without
  // it the conductor cannot weigh the finding against alternatives.
  const root = makeTmpRoot(true);
  const body = [
    '## ROOT CAUSE FOUND',
    'Evidence: `app/Foo.php:10` is where it breaks.',
  ].join('\n');
  const transcriptPath = writeTranscript(root, [assistantTextOnly(body)]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout.includes("missing 'Confidence' field"),
    'ROOT CAUSE FOUND without Confidence field → fail'
  );
}

// ---------------------------------------------------------------------------
// CHECKPOINT REACHED subfields (Check 3)
// ---------------------------------------------------------------------------

console.log('=== debug-investigator.js: CHECKPOINT REACHED subfields ===');

{
  // Happy path: Type + What I Need both present, Type value is one of the
  // three allowed enums.
  const root = makeTmpRoot(true);
  const body = [
    '## CHECKPOINT REACHED',
    'Type: human-verify',
    'What I Need: confirmation staging DB matches prod schema.',
  ].join('\n');
  const transcriptPath = writeTranscript(root, [assistantTextOnly(body)]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout === '{"ok":true}',
    'CHECKPOINT REACHED with Type + What I Need → pass'
  );
}

{
  // Type value outside the allowed enum: conductor routing depends on the
  // three documented values; arbitrary strings break the routing contract.
  const root = makeTmpRoot(true);
  const body = [
    '## CHECKPOINT REACHED',
    'Type: random-other-value',
    'What I Need: stuff',
  ].join('\n');
  const transcriptPath = writeTranscript(root, [assistantTextOnly(body)]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout.includes('human-verify, need-info, decision'),
    'CHECKPOINT REACHED with non-enum Type → fail naming the allowed values'
  );
}

// ---------------------------------------------------------------------------
// INVESTIGATION INCONCLUSIVE subfields (Check 4)
// ---------------------------------------------------------------------------

console.log('=== debug-investigator.js: INVESTIGATION INCONCLUSIVE subfields ===');

{
  // Happy path: Checked + Remaining Possibilities.
  const root = makeTmpRoot(true);
  const body = [
    '## INVESTIGATION INCONCLUSIVE',
    'Checked: 4 hypotheses against the codebase.',
    'Remaining Possibilities: race condition in cache layer or upstream API drift.',
  ].join('\n');
  const transcriptPath = writeTranscript(root, [assistantTextOnly(body)]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout === '{"ok":true}',
    'INVESTIGATION INCONCLUSIVE with Checked + Remaining Possibilities → pass'
  );
}

{
  // Missing Remaining Possibilities: the inconclusive verdict is unactionable
  // without the open hypothesis list.
  const root = makeTmpRoot(true);
  const body = [
    '## INVESTIGATION INCONCLUSIVE',
    'Checked: 3 hypotheses.',
  ].join('\n');
  const transcriptPath = writeTranscript(root, [assistantTextOnly(body)]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout.includes("'Remaining Possibilities' section"),
    'INVESTIGATION INCONCLUSIVE without Remaining Possibilities → fail'
  );
}

// ---------------------------------------------------------------------------
// Write-confinement (Check 5) — the central security check
// ---------------------------------------------------------------------------

console.log('=== debug-investigator.js: write-confinement ===');

{
  // Write to .bee/debug/sessions/.../state.json (relative): allowed.
  const root = makeTmpRoot(true);
  const body = '## CHECKPOINT REACHED\nType: need-info\nWhat I Need: more info.';
  const transcriptPath = writeTranscript(root, [
    assistantBlocks([
      { type: 'text', text: body },
      {
        type: 'tool_use',
        id: 't1',
        name: 'Write',
        input: { file_path: '.bee/debug/sessions/foo/state.json', content: '{}' },
      },
    ]),
  ]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout === '{"ok":true}',
    'relative .bee/debug/sessions/foo/state.json Write → pass (canonical resolve confirms confinement)'
  );
}

{
  // Write to a project file outside .bee/debug/: this is the core contract
  // breach the validator exists to catch.
  const root = makeTmpRoot(true);
  const body = '## CHECKPOINT REACHED\nType: need-info\nWhat I Need: more info.';
  const transcriptPath = writeTranscript(root, [
    assistantBlocks([
      { type: 'text', text: body },
      {
        type: 'tool_use',
        id: 't1',
        name: 'Write',
        input: { file_path: 'app/Http/Controllers/AuthController.php', content: '<?php' },
      },
    ]),
  ]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout.includes('wrote outside .bee/debug/') &&
      out.stdout.includes('app/Http/Controllers/AuthController.php'),
    'Write to app/Http/Controllers/AuthController.php → fail with offending path in reason'
  );
}

{
  // .. traversal attempt: the canonical resolve collapses .. before the
  // prefix check, so an escape attempt out of .bee/debug/ is detected.
  // The iter 1 simple `.startsWith` check would have missed this.
  const root = makeTmpRoot(true);
  const body = '## CHECKPOINT REACHED\nType: need-info\nWhat I Need: more info.';
  const transcriptPath = writeTranscript(root, [
    assistantBlocks([
      { type: 'text', text: body },
      {
        type: 'tool_use',
        id: 't1',
        name: 'Write',
        input: { file_path: '.bee/debug/../../../etc/passwd', content: 'evil' },
      },
    ]),
  ]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout.includes('wrote outside .bee/debug/'),
    '.. traversal `.bee/debug/../../../etc/passwd` → fail (canonical resolve defeats the escape)'
  );
}

{
  // Windows backslash separators on a path that IS inside .bee/debug/ when
  // normalised: the `.replace(/\\/g, '/')` pre-normalisation feeds the
  // canonicalisation; one code path handles both OSes.
  const root = makeTmpRoot(true);
  const body = '## CHECKPOINT REACHED\nType: need-info\nWhat I Need: more info.';
  const transcriptPath = writeTranscript(root, [
    assistantBlocks([
      { type: 'text', text: body },
      {
        type: 'tool_use',
        id: 't1',
        name: 'Edit',
        input: {
          file_path: '.bee\\debug\\sessions\\foo\\report.md',
          old_string: 'a',
          new_string: 'b',
        },
      },
    ]),
  ]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout === '{"ok":true}',
    'Windows-separator Edit `.bee\\debug\\sessions\\foo\\report.md` → pass (normalisation handles separators)'
  );
}

{
  // Look-alike sibling directory `.bee/debug-evil/`: the trailing '/' on
  // allowedRoot in the validator prevents the prefix check from accepting
  // a directory whose name merely starts with `debug`.
  const root = makeTmpRoot(true);
  const body = '## CHECKPOINT REACHED\nType: need-info\nWhat I Need: more info.';
  const transcriptPath = writeTranscript(root, [
    assistantBlocks([
      { type: 'text', text: body },
      {
        type: 'tool_use',
        id: 't1',
        name: 'Write',
        input: { file_path: '.bee/debug-evil/state.json', content: '{}' },
      },
    ]),
  ]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout.includes('wrote outside .bee/debug/'),
    '.bee/debug-evil/ sibling → fail (trailing slash on allowedRoot prevents prefix-only confusion)'
  );
}

{
  // Tool call other than Write/Edit (e.g. Bash, Read, Grep) MUST NOT trigger
  // confinement checks — only Write and Edit mutate files.
  const root = makeTmpRoot(true);
  const body = '## CHECKPOINT REACHED\nType: need-info\nWhat I Need: more info.';
  const transcriptPath = writeTranscript(root, [
    assistantBlocks([
      { type: 'text', text: body },
      {
        type: 'tool_use',
        id: 't1',
        name: 'Bash',
        input: { command: 'git log --oneline -5' },
      },
      {
        type: 'tool_use',
        id: 't2',
        name: 'Read',
        input: { file_path: 'app/Http/Controllers/AuthController.php' },
      },
    ]),
  ]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout === '{"ok":true}',
    'Bash + Read (non-mutating tools) on paths outside .bee/debug/ → pass (only Write/Edit are policed)'
  );
}

// ---------------------------------------------------------------------------
// Hypothesis ceiling (Check 6)
// ---------------------------------------------------------------------------

console.log('=== debug-investigator.js: hypothesis ceiling ===');

{
  // 8 ### H1..H8 markers exceed the documented ceiling of 7.
  const root = makeTmpRoot(true);
  const body = [
    '## INVESTIGATION INCONCLUSIVE',
    'Checked: 8 hypotheses.',
    'Remaining Possibilities: many.',
    '### H1 one',
    '### H2 two',
    '### H3 three',
    '### H4 four',
    '### H5 five',
    '### H6 six',
    '### H7 seven',
    '### H8 eight',
  ].join('\n');
  const transcriptPath = writeTranscript(root, [assistantTextOnly(body)]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout.includes('hypothesis count exceeds 7'),
    '8 ### H tokens → fail naming the documented ceiling'
  );
}

{
  // Boundary: exactly 7 active hypotheses → pass.
  const root = makeTmpRoot(true);
  const body = [
    '## INVESTIGATION INCONCLUSIVE',
    'Checked: 7 hypotheses.',
    'Remaining Possibilities: tba.',
    '### H1 a', '### H2 b', '### H3 c', '### H4 d', '### H5 e', '### H6 f', '### H7 g',
  ].join('\n');
  const transcriptPath = writeTranscript(root, [assistantTextOnly(body)]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout === '{"ok":true}',
    'exactly 7 hypotheses at the documented ceiling → pass (boundary inclusive)'
  );
}

// ---------------------------------------------------------------------------
// Pruning audit trail (Check 7)
// ---------------------------------------------------------------------------

console.log('=== debug-investigator.js: pruning audit trail ===');

{
  // Pruning mentioned without archived_hypotheses: this is the audit-trail
  // contract (pruning != deletion).
  const root = makeTmpRoot(true);
  const body = [
    '## INVESTIGATION INCONCLUSIVE',
    'Checked: 5 hypotheses; I pruned H3 because confidence dropped to 10%.',
    'Remaining Possibilities: H1, H2, H4, H5.',
  ].join('\n');
  const transcriptPath = writeTranscript(root, [assistantTextOnly(body)]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout.includes('archived_hypotheses') && out.stdout.includes('"ok":false'),
    'pruning mentioned without archived_hypotheses → fail naming the missing audit trail'
  );
}

{
  // Pruning WITH archived_hypotheses reference → pass.
  const root = makeTmpRoot(true);
  const body = [
    '## INVESTIGATION INCONCLUSIVE',
    'Checked: 5 hypotheses. I pruned H3 (10% confidence) — moved to archived_hypotheses.',
    'Remaining Possibilities: H1, H2, H4, H5.',
  ].join('\n');
  const transcriptPath = writeTranscript(root, [assistantTextOnly(body)]);
  const out = run({
    session_id: 's',
    transcript_path: transcriptPath,
    cwd: root,
    hook_event_name: 'SubagentStop',
  });
  assert(
    out.stdout === '{"ok":true}',
    'pruning paired with archived_hypotheses → pass (audit trail intact)'
  );
}

// ---------------------------------------------------------------------------
// Cleanup + summary
// ---------------------------------------------------------------------------

cleanupTmpDirs();
const total = passed + failed;
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${total} assertions`);
process.exit(failed > 0 ? 1 : 0);
