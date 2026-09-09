// node --test lib/autoContinueServer.test.mjs
//
// The SERVER-side auto-continue loop, against the real WorkspaceManager with a mock agent.
// lib/autoContinue.test.mjs proves the RULES; this proves the SCHEDULING obeys them — that the loop
// actually fires, actually stops, and cannot be talked into firing twice.
//
// This is the file that has to be trustworthy. The loop sends prompts on a machine with nobody
// watching: every bug here is spent budget, and this codebase has already shipped a double-send twice
// from the client side ("Why was this send multiple times, it must be sent once").
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceManager } from "./workspace.mjs";
import { AUTO_CAP } from "./autoContinue.mjs";

/** An agent that answers EVERY prompt and stays alive between them — which is what a real session
 *  does, and what this loop depends on. A mock that consumed one prompt and returned ended the
 *  session after the first turn: the loop then fired correctly into a corpse, `count` incremented,
 *  and nothing arrived. That looked exactly like "the loop does not work" and was not. */
function replyQuery() {
  return (opts) => (async function* () {
    for await (const msg of opts.prompt) {
      const said = String(msg?.message?.content ?? "");
      yield { type: "assistant", message: { content: [{ type: "text", text: "ack: " + said }] } };
      yield { type: "result", subtype: "success", is_error: false,
              usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0, duration_ms: 1, result: "ok" };
    }
  })();
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "auto-root-"));
  const secretsDir = join(root, ".secrets"); mkdirSync(secretsDir);
  writeFileSync(join(secretsDir, "claude-oauth-token.txt"), "sk-ant-oat-TESTTOKEN\n");
  mkdirSync(join(root, "repo"));
  return { root, secretsDir };
}
/** `autoDelayMs: 0` — the countdown is proven in lib/autoContinue.test.mjs; waiting 8s per round here
 *  would buy nothing and make this file too slow to run. */
function mgr(extra = {}) {
  const fx = fixture(); const sends = [];
  const m = new WorkspaceManager({ root: fx.root, secretsDir: fx.secretsDir, sdkQuery: replyQuery(),
    listRepos: () => [{ name: "repo", localPath: "repo", org: "Test" }],
    sdkProjectsDir: join(fx.root, "no-sdk-store"), autoDelayMs: 0,
    send: (kind, key, data) => sends.push({ kind, key, data }) , ...extra });
  return { m, sends };
}
const KEY = "repo@main";
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
/** Every prompt the agent was actually given, in order. */
const asked = (m) => {
  const s = m.sessions.get(KEY);
  return (s?.transcript || []).filter((r) => r && (r.kind === "user" || r.role === "user")).map((r) => r.text);
};

async function start(m) {
  m.handleIn("prompt", KEY, { repo: "repo", worktree: "main", text: "first", trusted: true });
  await settle(120);
}

test("the loop runs a round with no client attached at all", async () => {
  // The whole point. Nothing here is a browser: no timers in a page, no visible tab.
  const { m } = mgr();
  await start(m);
  assert.equal(asked(m).length, 1, "only the human prompt so far");
  m.handleIn("control", KEY, { action: "autoContinue", args: { sessionKey: KEY, on: true } });
  await settle(200);
  assert.ok(asked(m).length >= 2, "the server must send the next prompt by itself");
  assert.match(asked(m)[1], /Continue/, "…and it is the continue text, not a repeat of the human's");
  await m.stopAll?.();
});

test("it stops at the ceiling, unattended, and says why", async () => {
  const { m } = mgr();
  await start(m);
  m.handleIn("control", KEY, { action: "autoContinue", args: { sessionKey: KEY, on: true } });
  await settle(1200);
  const s = m.sessions.get(KEY);
  assert.equal(s.auto.count, AUTO_CAP, "exactly one batch of rounds — this is the budget guard");
  assert.equal(asked(m).length, AUTO_CAP + 1, "the human's prompt plus the ceiling's worth of rounds");
  assert.equal(s.auto.reason, "cap", "and it must be able to say why it stopped");
  await settle(300);
  assert.equal(asked(m).length, AUTO_CAP + 1, "…and it stays stopped");
  await m.stopAll?.();
});

test("Stop switches the loop off rather than pausing it", async () => {
  // Someone reached for the brake on a sweep running by itself. Re-arming and carrying on eight
  // seconds later is the most alarming thing this feature could do.
  const { m } = mgr();
  await start(m);
  m.handleIn("control", KEY, { action: "autoContinue", args: { sessionKey: KEY, on: true } });
  await settle(150);
  await m.handleIn("stop", KEY);
  const after = asked(m).length;
  await settle(300);
  assert.equal(m.sessions.get(KEY).auto.on, false, "Stop must turn the loop OFF");
  assert.equal(asked(m).length, after, "and nothing further may go out");
  await m.stopAll?.();
});

test("turning it on twice does not run two loops", async () => {
  // One timer per session, always cleared before another is set. Two timers is two prompts, and this
  // codebase has shipped that bug twice already from the client side.
  const { m } = mgr();
  await start(m);
  for (let i = 0; i < 5; i++)
    m.handleIn("control", KEY, { action: "autoContinue", args: { sessionKey: KEY, on: true } });
  await settle(1200);
  assert.equal(m.sessions.get(KEY).auto.count, AUTO_CAP,
    "five switch-ons must still produce exactly one batch, not five interleaved loops");
  await m.stopAll?.();
});

test("a human typing holds the loop, and releasing resumes it", async () => {
  const { m } = mgr();
  await start(m);
  m.handleIn("control", KEY, { action: "autoContinue", args: { sessionKey: KEY, on: true, hold: true } });
  await settle(200);
  assert.equal(asked(m).length, 1, "a held loop sends nothing while someone is typing");
  assert.equal(m.sessions.get(KEY).auto.reason, "composing");
  m.handleIn("control", KEY, { action: "autoContinue", args: { sessionKey: KEY, hold: false } });
  await settle(200);
  assert.ok(asked(m).length >= 2, "clearing the box lets it resume");
  await m.stopAll?.();
});

test("a human send resets the ceiling — it rations a robot, not you", async () => {
  const { m } = mgr();
  await start(m);
  m.handleIn("control", KEY, { action: "autoContinue", args: { sessionKey: KEY, on: true } });
  await settle(1200);
  assert.equal(m.sessions.get(KEY).auto.count, AUTO_CAP);
  /* HELD while we check, deliberately. The reset is instant, but so is the next batch with a
     zero-length delay in this fixture — the loop is still ON, so it would immediately spend the
     fresh grant and the count would read 10 again. That is correct behaviour and a useless
     assertion; holding it isolates the thing being tested. */
  m.handleIn("control", KEY, { action: "autoContinue", args: { sessionKey: KEY, hold: true } });
  m.handleIn("prompt", KEY, { repo: "repo", worktree: "main", text: "carry on", trusted: true });
  await settle(150);
  assert.equal(m.sessions.get(KEY).auto.count, 0, "your own message grants a fresh batch");
  await m.stopAll?.();
});

test("the client cannot raise its own ceiling", async () => {
  // The count and the cap are the server's. A loop whose limit is whatever the last client claimed
  // has no limit at all.
  const { m } = mgr();
  await start(m);
  m.handleIn("control", KEY, { action: "autoContinue", args: { sessionKey: KEY, on: true, cap: 9999, count: -50 } });
  await settle(1200);
  const s = m.sessions.get(KEY);
  assert.equal(s.auto.cap, AUTO_CAP, "a cap sent by a client must be ignored outright");
  assert.equal(s.auto.count, AUTO_CAP, "…and the batch still stops where the server says");
  await m.stopAll?.();
});

test("the loop's state is broadcast, so every device sees a sweep none of them is driving", async () => {
  const { m, sends } = mgr();
  await start(m);
  m.handleIn("control", KEY, { action: "autoContinue", args: { sessionKey: KEY, on: true } });
  await settle(200);
  const states = sends.filter((x) => x.kind === "state" && x.data?.sessions);
  assert.ok(states.length, "session state must still be broadcast");
  const mine = states.at(-1).data.sessions.find((x) => x.sessionKey === KEY);
  assert.ok(mine.auto, "the summary must carry the loop's state");
  assert.equal(mine.auto.on, true);
  assert.equal(typeof mine.auto.count, "number");
  assert.equal(typeof mine.auto.cap, "number");
  await m.stopAll?.();
});
