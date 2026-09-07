// node --test lib/resyncHave.test.mjs
//
// THE COST THIS REMOVES. The client's self-heal watchdog re-asks the server for a session's state
// every ~8 seconds per pane, to catch events a flaky stream may have dropped. The reply carried the
// whole transcript window every time — MEASURED off the live stream: **158 KB for a 250-row window**.
// An eight-pane cockpit therefore moved ~1.26 MB of JSON every 8 seconds: serialized here once per
// connected terminal, parsed there, on one thread each. That is enough to delay the echo of a
// freshly-typed prompt by seconds (Core does not append optimistically — the bubble appears when the
// SERVER echoes it) and to make typing stutter, all for a question that is answerable in a few bytes.
//
// A transcript is append-only, so "same row count, same last timestamp" PROVES the client is current.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceManager } from "./workspace.mjs";

function mgr() {
  const root = mkdtempSync(join(tmpdir(), "resync-have-"));
  const secretsDir = join(root, ".secrets"); mkdirSync(secretsDir);
  writeFileSync(join(secretsDir, "claude-oauth-token.txt"), "sk-ant-oat-TESTTOKEN\n");
  mkdirSync(join(root, "repo"));
  const sends = [];
  const m = new WorkspaceManager({ root, secretsDir, sdkQuery: () => (async function* () {})(),
    listRepos: () => [{ name: "repo", localPath: "repo", org: "Test" }],
    send: (kind, key, data) => sends.push({ kind, key, data }) });
  return { m, sends, root };
}
/** A live session with `n` real turns, exactly as _liveOrSavedState will read it. */
function seed(m, key, n) {
  const transcript = [];
  for (let i = 0; i < n; i++) transcript.push({ role: i % 2 ? "assistant" : "user", text: "turn " + i, at: 1000 + i });
  m.sessions.set(key, { key, workspaceId: "Test/repo@main", transcript, status: "idle", usage: null,
    mode: "default", cwd: "/repo", roll: () => true });
  return transcript;
}
const lastResync = (sends) => [...sends].reverse().find((s) => s.data && s.data.kind === "resync");

test("no `have` at all still ships the transcript — an older client must keep working", () => {
  const { m, sends, root } = mgr();
  seed(m, "k", 12);
  m._resync("k", {});
  const r = lastResync(sends);
  assert.ok(Array.isArray(r.data.transcript), "without the hint the server cannot know, so it sends everything");
  assert.equal(r.data.transcript.length, 12);
  rmSync(root, { recursive: true, force: true });
});

test("a client that is UP TO DATE gets the state without the rows it already has", () => {
  const { m, sends, root } = mgr();
  const tx = seed(m, "k", 12);
  m._resync("k", { have: { n: 12, at: tx[11].at } });
  const r = lastResync(sends);
  assert.equal(r.data.transcript, undefined, "the 158 KB of rows the client already holds must not be sent back");
  // …but the watchdog still does its job: everything a dropped event could have desynced is here.
  assert.equal(r.data.kind, "resync");
  assert.equal(r.data.status, "idle", "status still syncs — that is what the watchdog exists for");
  assert.ok("live" in r.data, "and whether the session is live");
  rmSync(root, { recursive: true, force: true });
});

test("a client that is BEHIND gets the full transcript — the watchdog must still heal", () => {
  const { m, sends, root } = mgr();
  const tx = seed(m, "k", 12);
  m._resync("k", { have: { n: 10, at: tx[9].at } });     // missed the last two turns
  const r = lastResync(sends);
  assert.ok(Array.isArray(r.data.transcript), "a short count means missed events — send the rows");
  assert.equal(r.data.transcript.length, 12);
  rmSync(root, { recursive: true, force: true });
});

test("same COUNT but a different last turn still ships — a matching length is not proof", () => {
  const { m, sends, root } = mgr();
  seed(m, "k", 12);
  m._resync("k", { have: { n: 12, at: 999999 } });
  const r = lastResync(sends);
  assert.ok(Array.isArray(r.data.transcript),
    "the tail must match too, or a client holding a different 12 rows would be left wrong forever");
  rmSync(root, { recursive: true, force: true });
});

test("a missing or malformed `at` is treated as 'not proven', never as a match", () => {
  const { m, sends, root } = mgr();
  seed(m, "k", 12);
  for (const have of [{ n: 12 }, { n: 12, at: null }, { n: "12", at: "nonsense" }]) {
    sends.length = 0;
    m._resync("k", { have });
    assert.ok(Array.isArray(lastResync(sends).data.transcript),
      `have=${JSON.stringify(have)} proves nothing — the rows must be sent`);
  }
  rmSync(root, { recursive: true, force: true });
});

test("an EMPTY conversation matches on count alone — there is no last row to compare", () => {
  const { m, sends, root } = mgr();
  seed(m, "k", 0);
  m._resync("k", { have: { n: 0 } });
  assert.equal(lastResync(sends).data.transcript, undefined, "nothing to send, and nothing missed");
  rmSync(root, { recursive: true, force: true });
});

test("the client sends `have` on watchdog resyncs, but never on a jump/band request", () => {
  const app = readFileSync(new URL("../dashboard/public/app.js", import.meta.url), "utf8");
  assert.match(app, /out\.have = \{ n: tx\.length, at: last && typeof last === "object" \? last\.at : undefined \};/,
    "the hint must carry the count AND the tail timestamp");
  assert.match(app, /if \(tx && out\.around == null && out\.aroundTurn == null\)/,
    "a jump asks the SERVER to choose rows around a number — sending `have` there could suppress them");
});


test("the control dispatcher actually FORWARDS `have` — it hand-picks fields, so a new one must be named", () => {
  // This is how the first cut shipped broken: `_resync` accepted the hint, the client sent it, and
  // the `case "resync":` line in between silently dropped it. Measured live: a resync with a
  // deliberately MATCHING hint still returned all 250 rows. Executed here rather than grepped.
  const { m, sends, root } = mgr();
  const tx = seed(m, "k", 12);
  m.handleIn("control", null, { action: "resync", args: { sessionKey: "k", have: { n: 12, at: tx[11].at } } });
  assert.equal(lastResync(sends).data.transcript, undefined,
    "a matching hint sent through the REAL entry point must suppress the rows");

  sends.length = 0;
  m.handleIn("control", null, { action: "resync", args: { sessionKey: "k" } });
  assert.ok(Array.isArray(lastResync(sends).data.transcript), "…and no hint still ships them");
  rmSync(root, { recursive: true, force: true });
});
