// node --test lib/freshConversation.test.mjs
//
// "That conversation could not be opened." — in red, over an empty transcript, on a chat box the
// user had just created. Ticking multi-chat and adding a chat makes a slot id (`repo@main#2`) that
// has no live session, no saved workspace row and no saved session, so `_liveOrSavedState` returned
// null and `_openTranscript` reported it as a failure. Opening a NEW conversation is the most
// ordinary thing there is; it must come back empty, not broken.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceManager } from "./workspace.mjs";

function mgr() {
  const root = mkdtempSync(join(tmpdir(), "fresh-"));
  const secretsDir = join(root, ".secrets");
  mkdirSync(secretsDir); writeFileSync(join(secretsDir, "claude-oauth-token.txt"), "sk-ant-oat-T\n");
  mkdirSync(join(root, "repo"));
  const sends = [];
  const m = new WorkspaceManager({ root, secretsDir,
    listRepos: () => [{ name: "repo", localPath: "repo", org: "Test" }],
    sdkProjectsDir: join(root, "none"), send: (kind, key, data) => sends.push({ kind, key, data }) });
  return { m, sends };
}
const framesFor = (sends, key) => ({
  transcript: sends.find((x) => x.kind === "transcript" && x.key === key),
  error: sends.find((x) => x.kind === "event" && x.key === key && x.data?.kind === "error"),
});

test("a brand-new multi-chat slot opens EMPTY, not as an error", () => {
  const { m, sends } = mgr();
  const KEY = "repo@main#2";                 // exactly what ticking multi-chat + "＋ New chat" makes
  m.handleIn("control", KEY, { action: "open", args: { sessionKey: KEY } });
  const f = framesFor(sends, KEY);
  assert.ok(!f.error, "a conversation you just created must not be reported as one that failed to open");
  assert.ok(f.transcript, "it must answer with a transcript frame");
  assert.deepEqual(f.transcript.data.transcript, [], "…an empty one");
  assert.equal(f.transcript.data.status, "idle");
  assert.equal(f.transcript.data.workspaceId, KEY, "and it must know which conversation it is");
});

test("the plain (non-slot) workspace id opens empty too", () => {
  // The same path serves a repo whose conversation has simply never been started.
  const { m, sends } = mgr();
  const KEY = "repo@main";
  m.handleIn("control", KEY, { action: "open", args: { sessionKey: KEY } });
  const f = framesFor(sends, KEY);
  assert.ok(!f.error);
  assert.ok(f.transcript);
  assert.equal(f.transcript.data.worktree, "main");
});

test("a genuinely unknown id still says so — this must not swallow real failures", () => {
  // A stale uuid from a dead link is NOT a new conversation. Turning every miss into a blank
  // conversation would hide a broken reference behind an empty screen.
  const { m, sends } = mgr();
  const KEY = "3f9c1e7a-0000-4444-8888-deadbeefcafe";   // a session id shape, no `@`
  m.handleIn("control", KEY, { action: "open", args: { sessionKey: KEY, scoped: true } });
  const f = framesFor(sends, KEY);
  assert.ok(f.error, "an id that names no conversation must still report that it could not be opened");
  assert.match(f.error.data.message, /could not be opened/);
  assert.ok(!f.transcript, "…and must not fabricate an empty conversation for it");
});
