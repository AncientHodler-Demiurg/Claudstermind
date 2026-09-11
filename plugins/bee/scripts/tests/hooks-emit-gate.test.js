#!/usr/bin/env node
// Locks the hooks speed optimization: emit-event is shell-gated (no node cold-start
// when no dashboard/autonomous consumer), the redundant pre_tool_use event is dropped
// (the dashboard already hides pre events), and the team validators fast-exit when
// Agent Teams is not enabled. Pure-quality hooks (pre-commit-gate, auto-lint, the
// per-agent validators) are untouched.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let passed = 0, failed = 0;
function assert(c, n) { if (c) { passed++; console.log(`  PASS: ${n}`); } else { failed++; console.log(`  FAIL: ${n}`); } }

const ROOT = path.join(__dirname, '..', '..');
const hooks = fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8');
const hooksJson = JSON.parse(hooks);

console.log('hooks.json: emit-event gated + pre_tool_use dropped');
assert(!/emit-event\.js pre_tool_use/.test(hooks), 'pre_tool_use emit-event hook removed (dashboard already hides pre events)');
assert((hooks.match(/emit-event-gate\.sh/g) || []).length === 4, 'exactly 4 emit-event hooks routed through emit-event-gate.sh');
assert(!/node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/hooks\/emit-event\.js/.test(hooks), 'emit-event.js is never invoked directly (all gated)');
const pre = JSON.stringify(hooksJson.hooks.PreToolUse || []);
assert(/pre-commit-gate\.sh/.test(pre), 'PreToolUse still runs pre-commit-gate.sh (quality gate untouched)');
assert(!/emit-event/.test(pre), 'PreToolUse no longer emits events');
// The per-agent SubagentStop validators are consolidated into dispatch.js, now gated by
// dispatch-gate.sh — the validators no-op in manual mode (autoModeActive false), so the gate
// skips the node boot unless an autonomous run is active. hooks.json routes to the gate; the
// gate execs dispatch.js; dispatch.js routes to all 25 validators.
assert(/dispatch-gate\.sh/.test(hooks), 'hooks.json SubagentStop routes through dispatch-gate.sh');
assert((hooks.match(/scripts\/hooks\/validators\//g) || []).length === 0, 'hooks.json no longer invokes validators/ directly (gated behind dispatch-gate.sh)');
const dispatchGateSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'hooks', 'dispatch-gate.sh'), 'utf8');
assert(/\.autonomous-run-active/.test(dispatchGateSrc), 'dispatch-gate.sh gates on the auto-mode marker (.autonomous-run-active)');
assert(/validators\/dispatch\.js/.test(dispatchGateSrc), 'dispatch-gate.sh execs validators/dispatch.js when active');
const dispatchSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'hooks', 'validators', 'dispatch.js'), 'utf8');
assert((dispatchSrc.match(/^  \[/gm) || []).length === 25, 'dispatch.js RULES array has exactly 25 per-agent entries');

console.log('\nemit-event-gate.sh exists + executable + checks the right markers');
const gate = path.join(ROOT, 'scripts', 'hooks', 'emit-event-gate.sh');
assert(fs.existsSync(gate), 'emit-event-gate.sh exists');
assert(!!(fs.statSync(gate).mode & 0o111), 'emit-event-gate.sh is executable');
const gsrc = fs.readFileSync(gate, 'utf8');
assert(/\.hive-pid/.test(gsrc) && /\.autonomous-run-active/.test(gsrc), 'gate checks both consumer markers (matches emit-event.js)');
assert(/exec node/.test(gsrc), 'gate execs node when a consumer is active');

console.log('\ngate.sh behavior — no consumer = no node boot / no events; consumer = events written');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-gate-'));
  fs.mkdirSync(path.join(tmp, '.bee'), { recursive: true });
  const run = () => { try { execFileSync('bash', [gate, 'post_tool_use'], { input: '{"tool_name":"Read"}', env: { ...process.env, CLAUDE_PROJECT_DIR: tmp }, encoding: 'utf8' }); } catch (_) { /* always exit 0 */ } };
  run();
  assert(!fs.existsSync(path.join(tmp, '.bee', 'events')), 'no consumer → .bee/events/ not created (node never booted)');
  fs.writeFileSync(path.join(tmp, '.bee', '.hive-pid'), '1');
  run();
  const ev = path.join(tmp, '.bee', 'events');
  assert(fs.existsSync(ev) && fs.readdirSync(ev).some(f => f.endsWith('.jsonl')), 'with .hive-pid → event written (full behavior preserved)');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\ndispatch-gate.sh — no autonomous run = no node boot / no verdict; run active = dispatch.js routes');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-dgate-'));
  fs.mkdirSync(path.join(tmp, '.bee'), { recursive: true });
  const dgate = path.join(ROOT, 'scripts', 'hooks', 'dispatch-gate.sh');
  const payload = '{"cwd":"' + tmp + '","agent_type":"implementer","transcript_path":"/nonexistent"}';
  const run = () => { try { return execFileSync('bash', [dgate], { input: payload, env: { ...process.env, CLAUDE_PROJECT_DIR: tmp }, encoding: 'utf8' }); } catch (_) { return ''; } };
  assert(run().trim() === '', 'no .autonomous-run-active → dispatch-gate emits nothing (node never booted)');
  fs.writeFileSync(path.join(tmp, '.bee', '.autonomous-run-active'), '1');
  assert(run().includes('"ok"'), 'with .autonomous-run-active → dispatch.js runs and emits a verdict');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\ndispatch-gate.sh — fail-open: marker under $PWD but NOT CLAUDE_PROJECT_DIR still boots (validators resolve payload.cwd first)');
{
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-dgate-wt-'));     // agent cwd — has the marker
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-dgate-oth-')); // CLAUDE_PROJECT_DIR — no marker
  fs.mkdirSync(path.join(wt, '.bee'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.bee', '.autonomous-run-active'), '1');
  const dgate = path.join(ROOT, 'scripts', 'hooks', 'dispatch-gate.sh');
  const payload = '{"cwd":"' + wt + '","agent_type":"implementer","transcript_path":"/nonexistent"}';
  let out = '';
  try { out = execFileSync('bash', [dgate], { input: payload, cwd: wt, env: { ...process.env, CLAUDE_PROJECT_DIR: other }, encoding: 'utf8' }); } catch (_) { out = ''; }
  assert(out.includes('"ok"'), 'marker under $PWD with CLAUDE_PROJECT_DIR elsewhere → dispatch still runs (validation not silently disabled)');
  fs.rmSync(wt, { recursive: true, force: true });
  fs.rmSync(other, { recursive: true, force: true });
}

console.log('\nteam validators fast-exit when Agent Teams is not enabled');
for (const f of ['team-task-validator.sh', 'team-idle-validator.sh']) {
  const s = fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8');
  assert(/agent_teams\.status/.test(s) && /"enabled"/.test(s) && /exit 0/.test(s), `${f} guards on agent_teams.status = enabled`);
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`);
process.exit(failed > 0 ? 1 : 0);
