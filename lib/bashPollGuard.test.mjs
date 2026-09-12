// node --test lib/bashPollGuard.test.mjs
//
// THE BUG: a Pact session left 11 background bash jobs running, each an `until <cond>; do sleep N;
// done` loop with no ceiling of its own, polling an output file that had stopped changing hours
// earlier. The `pact` REPL run it was waiting on had already exited — the loop could never resolve,
// and never would, because nothing was left to write the string it was grepping for. The command
// LOOKED bounded (it contained "timeout 2400") — that timeout wrapped the pact run, not the loop
// waiting on it. Asked directly, the agent checked for the word "pact" in the process list and
// reported "nothing of mine is running" — genuinely, from that check. Eleven zombies said otherwise.
import test from "node:test";
import assert from "node:assert/strict";
import { bashNeedsPollCeiling, bashPollGuardHook } from "./bashPollGuard.mjs";

test("flags the exact real-world shape: a timeout on the awaited command does not bound the loop waiting on it", () => {
  const cmd = 'nohup timeout 2400 pact modules/_probeAT.repl > /tmp/at3.out 2>/tmp/at3.err & echo started; ' +
    'until grep -qE "Load failed|Load success" /tmp/at3.out 2>/dev/null; do sleep 20; done; grep -E "pairs=" /tmp/at3.out';
  assert.equal(bashNeedsPollCeiling(cmd), true);
});

test("a bare poll loop with no timeout anywhere is flagged", () => {
  assert.equal(bashNeedsPollCeiling('until grep -q done out.log; do sleep 5; done'), true);
});

test("a loop wrapped in its OWN timeout is NOT flagged", () => {
  assert.equal(bashNeedsPollCeiling(`timeout 300 bash -c 'until grep -q done out.log; do sleep 5; done'`), false);
});

test("a loop launched after a `;` from an unrelated earlier timeout'd statement is still flagged", () => {
  // The earlier `timeout 60 sleep 60` bounds nothing but itself; the loop after it has no ceiling.
  assert.equal(bashNeedsPollCeiling('timeout 60 sleep 60; until grep -q done out.log; do sleep 5; done'), true);
});

test("a `2>&1`-style ampersand does not mask a genuinely unbounded loop that follows it", () => {
  // The `&` inside `2>&1` must not be mistaken for a statement boundary that "explains away" the
  // real backgrounding `&` right after it — either way, nothing here bounds the loop, so it must
  // still be flagged regardless of which `&` the boundary walk lands on.
  const cmd = 'nohup pact x.repl > out 2>&1 & until grep -q done out; do sleep 5; done';
  assert.equal(bashNeedsPollCeiling(cmd), true);
});

test("a loop nested inside an outer `timeout ... bash -c` is flagged if a background `&` sits between them", () => {
  // Deliberately conservative (see the module doc): an outer timeout wrapping the whole script is a
  // real bound in principle, but a `nohup ... &` between it and the loop is exactly the shape that
  // detaches the awaited process from that outer timeout's reach in practice. Flagging here trades an
  // occasional avoidable deny for never again missing a loop that can outlive its wrapper.
  const nested = "timeout 300 bash -c 'nohup pact x.repl > out 2>&1 & until grep -q done out; do sleep 5; done'";
  assert.equal(bashNeedsPollCeiling(nested), true);
});

test("no loop at all — an ordinary command — is never flagged", () => {
  assert.equal(bashNeedsPollCeiling('npm test'), false);
  assert.equal(bashNeedsPollCeiling('git status && git diff'), false);
});

test("a counted for-loop (bounded by construction, no sleep-poll shape) is not flagged", () => {
  assert.equal(bashNeedsPollCeiling('for i in 1 2 3; do echo $i; done'), false);
});

test("multiple statements: only an actually-unbounded loop among them trips it", () => {
  const safe = `timeout 120 bash -c 'until grep -q x a; do sleep 2; done'; echo done`;
  assert.equal(bashNeedsPollCeiling(safe), false);
  const mixed = `timeout 120 bash -c 'until grep -q x a; do sleep 2; done'; until grep -q y b; do sleep 2; done`;
  assert.equal(bashNeedsPollCeiling(mixed), true);
});

test("empty/missing command is never flagged", () => {
  assert.equal(bashNeedsPollCeiling(""), false);
  assert.equal(bashNeedsPollCeiling(null), false);
  assert.equal(bashNeedsPollCeiling(undefined), false);
});

test("bashPollGuardHook: only Bash is ever inspected", () => {
  assert.equal(bashPollGuardHook("Read", { command: "until x; do sleep 1; done" }), null);
  assert.equal(bashPollGuardHook("Task", { command: "until x; do sleep 1; done" }), null);
});

test("bashPollGuardHook: a safe Bash command is waved through (null — no hook output)", () => {
  assert.equal(bashPollGuardHook("Bash", { command: "npm test" }), null);
});

test("bashPollGuardHook: an unbounded loop is denied with an actionable reason", () => {
  const out = bashPollGuardHook("Bash", { command: "until grep -q done out; do sleep 5; done" });
  assert.ok(out, "must return a decision, not null, for the dangerous shape");
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /timeout/i);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /wait loop|loop/i);
});

test("bashPollGuardHook: missing tool_input never throws", () => {
  assert.equal(bashPollGuardHook("Bash", undefined), null);
  assert.equal(bashPollGuardHook("Bash", null), null);
});
