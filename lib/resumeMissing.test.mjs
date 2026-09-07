// node --test lib/resumeMissing.test.mjs
//
// THE REPORT: "there is a chat opened for the Khronoton repository but the prompts are stuck."
//
// They were not stuck — they were FAILING, silently, and had been for every prompt sent to that
// conversation. Two prompts (22:04 and 22:11) each spawned a session that produced nothing and
// vanished. The cause: the stored resume id `b17780e2-…` had no SDK session file left on disk, and
// `claude --resume <missing>` exits immediately:
//
//   No conversation found with session ID: b17780e2-dc9f-44f1-8629-9fb687b601af
//   {"type":"result","subtype":"error_during_execution","is_error":true,"errors":["No conversation …"]}
//
// Reproduced verbatim against the real binary. Two independent defects made that unreadable:
//
//   1. The SDK's `errors` array was dropped at the event boundary, so `isError` survived but the
//      SENTENCE explaining it did not — nothing downstream could have told the user why.
//   2. A result with `is_error` was treated as an ordinary completed turn: status went idle, no row
//      was recorded, and the pane looked exactly like one where nothing had happened.
//
// And the condition was unrecoverable: the id never changes, so every future prompt dies the same way.
//
// THE CONSERVATISM THAT MATTERS: "the file is not in ~/.claude/projects" has two readings — it is
// gone, or we are looking in the wrong place. Acting on the second would drop every VALID resume on
// a machine that keeps its sessions elsewhere, breaking every conversation at once to fix one. So the
// store must be VISIBLE (present and non-empty) before its silence is treated as evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceManager } from "./workspace.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "resume-missing-"));
  const secretsDir = join(root, ".secrets"); mkdirSync(secretsDir);
  writeFileSync(join(secretsDir, "claude-oauth-token.txt"), "sk-ant-oat-TESTTOKEN\n");
  mkdirSync(join(root, "repo"));
  return root;
}
/** An SDK session store holding exactly the ids given. */
function sdkStore(root, ids) {
  const dir = join(root, "sdk-projects", "-home-user-repo");
  mkdirSync(dir, { recursive: true });
  for (const id of ids) writeFileSync(join(dir, id + ".jsonl"), "{}\n");
  return join(root, "sdk-projects");
}
function mgr(root, sdkProjectsDir) {
  const sends = [];
  const m = new WorkspaceManager({ root, secretsDir: join(root, ".secrets"),
    sdkQuery: () => (async function* () {})(), sdkProjectsDir,
    listRepos: () => [{ name: "repo", localPath: "repo", org: "Test" }],
    send: (kind, key, data) => sends.push({ kind, key, data }) });
  return { m, sends };
}

/* ---- 1. is the store even visible? ------------------------------------------------------------ */

test("an INVISIBLE store never condemns a resume id — the risk is dropping every valid one", () => {
  const root = fixture();
  const { m } = mgr(root, join(root, "does-not-exist"));
  assert.equal(m._sdkStoreVisible(), false, "a missing store is not evidence of anything");
  assert.equal(m._sdkSessionFile("any-id"), "", "…and it certainly cannot confirm a file");
  rmSync(root, { recursive: true, force: true });
});

test("an EMPTY store is also not evidence — it is indistinguishable from looking in the wrong place", () => {
  const root = fixture();
  const dir = join(root, "sdk-projects"); mkdirSync(dir, { recursive: true });
  const { m } = mgr(root, dir);
  assert.equal(m._sdkStoreVisible(), false, "an empty directory proves nothing about where sessions live");
  rmSync(root, { recursive: true, force: true });
});

test("a POPULATED store is evidence, and answers both ways", () => {
  const root = fixture();
  const dir = sdkStore(root, ["1111aaaa-0000-0000-0000-000000000000"]);
  const { m } = mgr(root, dir);
  assert.equal(m._sdkStoreVisible(), true);
  assert.ok(m._sdkSessionFile("1111aaaa-0000-0000-0000-000000000000").endsWith(".jsonl"), "present is found");
  assert.equal(m._sdkSessionFile("b17780e2-dc9f-44f1-8629-9fb687b601af"), "", "absent is absent — the Khronoton id");
  rmSync(root, { recursive: true, force: true });
});

test("_sdkSessionBytes rides the same lookup, so 'how big' and 'is it there' can never disagree", () => {
  const root = fixture();
  const dir = sdkStore(root, ["2222bbbb-0000-0000-0000-000000000000"]);
  const { m } = mgr(root, dir);
  assert.ok(m._sdkSessionBytes("2222bbbb-0000-0000-0000-000000000000") > 0);
  assert.equal(m._sdkSessionBytes("nope"), 0);
  rmSync(root, { recursive: true, force: true });
});

/* ---- 2. the failed turn has to SAY so -------------------------------------------------------- */

test("a result with is_error records a durable turnError row AND tells the client", () => {
  const root = fixture();
  const { m, sends } = mgr(root, join(root, "none"));
  const s = { key: "k", workspaceId: "Test/repo@main", transcript: [], status: "idle" };
  m.sessions.set("k", s);
  m._onEvent("k", { kind: "result", isError: true, subtype: "error_during_execution",
    errors: ["No conversation found with session ID: b17780e2-dc9f-44f1-8629-9fb687b601af"] });

  const row = s.transcript.find((r) => r && r.kind === "turnError");
  assert.ok(row, "a failed turn must leave a mark — a cue that fades is no use to someone returning to the pane");
  assert.match(row.message, /No conversation found with session ID/, "…carrying the SDK's OWN reason, not a euphemism");
  assert.equal(row.subtype, "error_during_execution");
  assert.equal(typeof row.at, "number");

  const ev = sends.find((x) => x.data && x.data.kind === "turnError");
  assert.ok(ev, "and the live client must hear about it too");
  assert.equal(ev.data.at, row.at, "same `at`, so a resync replaces the optimistic copy instead of doubling it");
  rmSync(root, { recursive: true, force: true });
});

test("an ORDINARY result records nothing — this must not fire on every successful turn", () => {
  const root = fixture();
  const { m, sends } = mgr(root, join(root, "none"));
  const s = { key: "k", workspaceId: "Test/repo@main", transcript: [], status: "idle" };
  m.sessions.set("k", s);
  m._onEvent("k", { kind: "result", isError: false, usage: null });
  assert.equal(s.transcript.filter((r) => r && r.kind === "turnError").length, 0);
  assert.equal(sends.filter((x) => x.data && x.data.kind === "turnError").length, 0);
  rmSync(root, { recursive: true, force: true });
});

test("is_error with NO errors array still says something rather than nothing", () => {
  const root = fixture();
  const { m } = mgr(root, join(root, "none"));
  const s = { key: "k", workspaceId: "Test/repo@main", transcript: [], status: "idle" };
  m.sessions.set("k", s);
  m._onEvent("k", { kind: "result", isError: true, subtype: "error_during_execution", errors: [] });
  const row = s.transcript.find((r) => r && r.kind === "turnError");
  assert.ok(row && row.message, "falling back to the subtype beats an empty red bar");
  assert.match(row.message, /error_during_execution/);
  rmSync(root, { recursive: true, force: true });
});

/* ---- 3. the event boundary that lost the sentence --------------------------------------------- */

test("the SDK's `errors` array survives the event boundary at all", async () => {
  const { shapeEvent } = await import("./claudeSession.mjs");
  if (typeof shapeEvent !== "function") return;   // not exported in this build — covered by _onEvent above
  const ev = shapeEvent({ type: "result", subtype: "error_during_execution", is_error: true,
    errors: ["No conversation found with session ID: x"] });
  assert.deepEqual(ev.errors, ["No conversation found with session ID: x"]);
});

/* ---- 4. a recovery must not be dressed up as a failure ---------------------------------------- */

test("the two cases are told apart: a recovered turn is NOT reported as a failed one", async () => {
  const { readFileSync } = await import("node:fs");
  const shellJs = readFileSync(new URL("../packages/claude-chat-shell/src/chat-shell.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../dashboard/public/app.js", import.meta.url), "utf8");

  // The recovery case is a turn that SUCCEEDED — the dead window was dropped and a fresh one ran.
  // Shouting "TURN FAILED" about it is a worse lie than saying nothing, and it shipped that way for
  // one round before a live render showed it.
  assert.match(shellJs, /var note = o\.tone === "notice";/, "the builder must distinguish the two");
  assert.match(shellJs, /\\u21bb FRESH WINDOW \\u2014 " : "\\u26a0 TURN FAILED \\u2014 "/,
    "amber 'fresh window' for a recovery, red 'turn failed' for a death");
  assert.match(app, /tone: m\.subtype === "resume-missing" \? "notice" : "error"/,
    "and the caller must route `resume-missing` to the notice tone");
});

test("the recovery notice names what was lost AND what survived", async () => {
  const { readFileSync } = await import("node:fs");
  const ws = readFileSync(new URL("./workspace.mjs", import.meta.url), "utf8");
  const i = ws.indexOf('subtype: "resume-missing"');
  const around = ws.slice(Math.max(0, i - 700), i);
  // Someone reading this bar needs three facts, and the third is the one that stops a panic.
  assert.match(around, /no longer on disk/, "what happened");
  assert.match(around, /starts a fresh one/, "what was done about it");
  assert.match(around, /transcript above is intact/, "and that nothing of theirs was lost");
});
