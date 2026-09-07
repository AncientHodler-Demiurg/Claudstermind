// node --test lib/wrapBoundaryDurability.test.mjs
//
// THE BUG THIS FILE EXISTS FOR — observed in production, on real user data.
//
// "Where does the current (un-archived) window start" used to be an in-memory counter,
// `s._rolledThrough`, set at roll time and never persisted. sessiond restarts routinely (a deploy, a
// crash, a `systemctl restart`), and a restart rebuilds the session with the FULL transcript reloaded
// from disk while the counter comes back at 0. So the "turns since the last wrap" slice was suddenly
// the ENTIRE conversation — which for any long-lived workspace is already far past `maxTurns` — and
// the very next completed turn auto-wrapped. Every restart. Regardless of how recently it had wrapped.
//
// Measured on OuroborosNetwork/daimons/OuronetUI@main before the fix: three archived segments whose
// contents ALL begin at the conversation's very first prompt (each re-archiving everything its
// predecessor already held), the last two wrap marks only 57 turns apart against a 1000-turn
// threshold. It also inflates the absolute P#/R# ranges those archives carry — the index
// `recallByNumber` resolves against — so recalling a turn by number can answer with the wrong turn.
//
// The fix: the boundary is DERIVED from the transcript's own durable `{kind:"wrapped"}` marks
// (WorkspaceManager#_rollFrom) rather than remembered in a field that dies with the process.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceManager } from "./workspace.mjs";
import { ROLL_DEFAULTS } from "./conversationRoll.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "wrap-boundary-"));
  const secretsDir = join(root, ".secrets"); mkdirSync(secretsDir);
  writeFileSync(join(secretsDir, "claude-oauth-token.txt"), "sk-ant-oat-TESTTOKEN\n");
  mkdirSync(join(root, "repo"));
  return { root, secretsDir };
}
function mgr(fx) {
  const m = new WorkspaceManager({ root: fx.root, secretsDir: fx.secretsDir, sdkQuery: () => (async function* () {})(),
    listRepos: () => [{ name: "repo", localPath: "repo", org: "Test" }], send: () => {} });
  return m;
}
/** A session-shaped object with `n` real turns. `roll` is counted, never executed. */
function convo(key, n, rolls) {
  const s = { key, workspaceId: "Test/repo@main", transcript: [], roll: () => { rolls.n++; return true; } };
  for (let i = 0; i < n; i++) s.transcript.push({ role: i % 2 ? "assistant" : "user", text: "turn " + i });
  return s;
}
const CAP = ROLL_DEFAULTS.maxTurns, TAIL = ROLL_DEFAULTS.tailTurns;

test("_rollFrom: with no wrap mark the window is the whole transcript; a mark moves it to just past that mark", () => {
  const m = mgr(fixture());
  const rolls = { n: 0 };
  const s = convo("c", 10, rolls);
  assert.equal(m._rollFrom(s), 0, "nothing wrapped yet — the window is everything");

  s.transcript.splice(4, 0, { kind: "wrapped", segment: 1, at: 1 });
  assert.equal(m._rollFrom(s), 5, "the window starts AFTER the mark — the mark itself belongs to the archived side");

  s.transcript.push({ kind: "wrapped", segment: 2, at: 2 });
  assert.equal(m._rollFrom(s), s.transcript.length, "the LAST mark wins, not the first");
});

test("_rollFrom is pure — reading it never mutates the session or the transcript", () => {
  const m = mgr(fixture());
  const s = convo("c", 6, { n: 0 });
  s.transcript.splice(3, 0, { kind: "wrapped", segment: 1, at: 1 });
  const before = JSON.stringify(s.transcript);
  const keys = Object.keys(s).sort().join(",");
  m._rollFrom(s); m._rollFrom(s); m._rollFrom(s);
  assert.equal(JSON.stringify(s.transcript), before, "the transcript is untouched");
  assert.equal(Object.keys(s).sort().join(","), keys, "no bookkeeping field is grown onto the session");
});

// THE REGRESSION ITSELF. This is the test that fails against the old counter-based code.
test("a restart must NOT re-wrap: a session rebuilt from a transcript that already carries a wrap mark stays put", () => {
  const fx = fixture(); const m = mgr(fx);
  const rolls = { n: 0 };

  // A long conversation, well past the threshold, wraps once. Everything so far is correct.
  const s = convo("conv-restart", CAP + TAIL + 20, rolls);
  m._maybeRoll(s);
  assert.equal(rolls.n, 1, "the first wrap fires at the threshold, as it should");
  const wrappedTranscript = s.transcript.slice();
  assert.ok(wrappedTranscript.some((r) => r.kind === "wrapped"), "…and leaves a durable mark behind");

  // sessiond restarts: a BRAND NEW session object, same durable transcript reloaded from disk, no
  // in-memory bookkeeping carried across. This is exactly what the old code could not survive.
  const restarted = { key: "conv-restart", workspaceId: "Test/repo@main",
    transcript: wrappedTranscript.slice(), roll: () => { rolls.n++; return true; } };
  m._maybeRoll(restarted);
  assert.equal(rolls.n, 1, "a restart alone must not wrap anything — nothing new has accrued since the mark");

  // Restarting repeatedly must stay just as quiet — the old bug fired once per restart, forever.
  for (let i = 0; i < 5; i++) {
    const again = { key: "conv-restart", workspaceId: "Test/repo@main",
      transcript: restarted.transcript.slice(), roll: () => { rolls.n++; return true; } };
    m._maybeRoll(again);
  }
  assert.equal(rolls.n, 1, "five more restarts, still one wrap");

  rmSync(fx.root, { recursive: true, force: true });
});

test("after a restart the NEXT wrap still fires — but only once a full window has genuinely accrued", () => {
  const fx = fixture(); const m = mgr(fx);
  const rolls = { n: 0 };
  const s = convo("conv-next", CAP + TAIL + 20, rolls);
  m._maybeRoll(s);
  assert.equal(rolls.n, 1);

  const restarted = { key: "conv-next", workspaceId: "Test/repo@main",
    transcript: s.transcript.slice(), roll: () => { rolls.n++; return true; } };

  // One turn short of the threshold: still nothing.
  for (let i = 0; i < CAP - 1; i++) restarted.transcript.push({ role: i % 2 ? "assistant" : "user", text: "post " + i });
  m._maybeRoll(restarted);
  assert.equal(rolls.n, 1, "just under the threshold must not wrap");

  // Cross it, and it fires exactly once more.
  restarted.transcript.push({ role: "user", text: "the one that tips it" });
  m._maybeRoll(restarted);
  assert.equal(rolls.n, 2, "crossing the threshold after a restart still wraps");

  rmSync(fx.root, { recursive: true, force: true });
});

test("the second wrap archives only what came AFTER the first — segments must not overlap", () => {
  // The visible symptom of the old bug: every archived segment began at the conversation's first
  // prompt. Segment n+1's head must start after segment n's window, never at the top again.
  const fx = fixture(); const m = mgr(fx);
  const rolls = { n: 0 };
  const heads = [];
  const s = { key: "conv-seg", workspaceId: "Test/repo@main", transcript: [], roll: () => { rolls.n++; return true; } };
  for (let i = 0; i < CAP + TAIL + 20; i++) s.transcript.push({ role: i % 2 ? "assistant" : "user", text: "A" + i });
  const origPerform = m._performRoll.bind(m);
  m._performRoll = (sess, slice) => { heads.push(slice[0] && slice[0].text); return origPerform(sess, slice); };

  m._maybeRoll(s);
  // A restart, then a genuinely new window of turns.
  const restarted = { key: "conv-seg", workspaceId: "Test/repo@main",
    transcript: s.transcript.slice(), roll: () => { rolls.n++; return true; } };
  for (let i = 0; i < CAP + TAIL + 20; i++) restarted.transcript.push({ role: i % 2 ? "assistant" : "user", text: "B" + i });
  m._maybeRoll(restarted);

  assert.equal(rolls.n, 2, "two genuine wraps");
  assert.equal(heads[0], "A0", "the first wrap starts at the conversation's first turn");
  assert.ok(heads[1] && heads[1] !== "A0", "the second must NOT start at the first turn again — that was the corruption");
  assert.ok(String(heads[1]).startsWith("B") || Number(String(heads[0]).slice(1)) < Number(String(heads[1]).slice(1)),
    "the second window begins strictly after the first one ended");

  rmSync(fx.root, { recursive: true, force: true });
});

test("manualRoll and wrapPreview read the SAME derived boundary the automatic path does", () => {
  const fx = fixture(); const m = mgr(fx);
  const rolls = { n: 0 };
  const s = convo("conv-manual", CAP + TAIL + 20, rolls);
  m.sessions.set(s.key, s);
  m._maybeRoll(s);
  assert.equal(rolls.n, 1);

  // Straight after a wrap, only the tail remains in the window — so a preview must report there is
  // nothing to archive, and a manual wrap must refuse rather than re-archive the same turns.
  const prev = m.wrapPreview(s.key);
  assert.equal(prev.empty, true, "nothing left to wrap immediately after a wrap");
  assert.equal(m.manualRoll(s.key).ok, false, "and a manual wrap has nothing to do either");
  assert.equal(rolls.n, 1, "…so no second roll happened");

  rmSync(fx.root, { recursive: true, force: true });
});
