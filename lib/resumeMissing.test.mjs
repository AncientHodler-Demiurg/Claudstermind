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
  // THREE events land on this path and none of them is the other: a turn that died, a window the
  // engine had to replace (the turn ran), and an SDK diagnostic about a turn that worked. Two of the
  // three are amber, but they need different sentences — calling a diagnostic "FRESH WINDOW" would
  // just be a different wrong sentence than "TURN FAILED".
  assert.match(shellJs, /var note = o\.tone === "notice" \|\| o\.tone === "info";/, "the builder must distinguish them");
  assert.match(shellJs, /ENGINE NOTE/, "a diagnostic gets its own wording");
  assert.match(shellJs, /FRESH WINDOW/, "…a recovery its own");
  assert.match(shellJs, /TURN FAILED/, "…and only a death the red one");
  // Two things are notices rather than failures: a recovery, and an SDK diagnostic about a turn that
  // ran. The diagnostic is matched on the message here as well as refused at the source, so rows
  // persisted before that fix stop shouting too.
  assert.match(app, /m\.subtype === "resume-missing" \? "notice"/, "a recovery is a notice");
  assert.match(app, /diagnostic\\\]\/i\.test\(String\(m\.message \|\| ""\)\) \? "info"/,
    "an SDK diagnostic is its own thing again — neither a failure nor a fresh window");
  assert.match(app, /: "error";/, "…and only a genuinely dead turn is red");
  const shellJs2 = readFileSync(new URL("../packages/claude-chat-shell/src/chat-shell.js", import.meta.url), "utf8");
  assert.match(shellJs2, /ENGINE NOTE/, "…with wording of its own, not another event's");
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

/* ---- 5. a diagnostic about a turn that WORKED is not a failed turn ----------------------------- */
//
// Observed live, on a turn that had just streamed 21,039 output tokens and finished cleanly:
//
//   [ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use
//
// It arrives with `is_error` AND the SAME `subtype: "error_during_execution"` as a genuinely dead
// turn, so the subtype cannot separate them. What the turn DID can — and that is also the only
// definition matching the report this whole feature exists for ("the prompts are stuck": no reply at
// all, ever). Shouting TURN FAILED over a turn that answered is the same class of lie as staying
// silent over one that did not.

test("a turn that produced OUTPUT never gets a failure row, however the result is flagged", () => {
  const root = fixture();
  const { m, sends } = mgr(root, join(root, "none"));
  const s = { key: "k", workspaceId: "Test/repo@main", transcript: [], status: "idle" };
  m.sessions.set("k", s);
  m._onEvent("k", { kind: "assistant", text: "here is the answer" });          // the turn spoke
  m._onEvent("k", { kind: "result", isError: true, subtype: "error_during_execution",
    errors: ["[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use"] });

  assert.equal(s.transcript.filter((r) => r && r.kind === "turnError").length, 0,
    "a turn that answered did not fail — no permanent red bar across a working conversation");
  const warn = sends.find((x) => x.data && x.data.kind === "warning");
  assert.ok(warn, "…but it is not swallowed either: it belongs in the activity log");
  assert.match(warn.data.message, /ede_diagnostic/, "…carrying the SDK's own words");
  rmSync(root, { recursive: true, force: true });
});

/* REVISED. This test used to assert that running a tool, or a bare `output_tokens` count, both
   counted as "the turn produced something" and so downgraded a flagged result to a note. Both were
   wrong, and the report that proved it was a prompt that ran four tools, never answered, and sat
   under a quiet beige ENGINE NOTE: "it seems processing that blue prompt stalled, so I had to stop
   and reload." Tool calls are the engine talking to itself, and tool calls burn output tokens — so
   neither is evidence that the READER got anything. See lib/turnFailedClassification.test.mjs. */
test("only an ANSWER absolves a flagged result — not tools, not a token count", () => {
  const root = fixture();
  const { m } = mgr(root, join(root, "none"));
  for (const [label, pre, usage, failures, why] of [
    ["streamed text", { kind: "assistant", text: "x" }, null, 0, "it answered"],
    ["ran a tool", { kind: "tool_use", tools: [{ name: "Bash" }] }, null, 1, "tools are not a reply"],
    ["usage alone", null, { output_tokens: 21039 }, 1, "a token count is not a reply"],
  ]) {
    const s = { key: label, workspaceId: "Test/repo@main", transcript: [], status: "idle" };
    m.sessions.set(label, s);
    if (pre) m._onEvent(label, pre);
    m._onEvent(label, { kind: "result", isError: true, subtype: "error_during_execution", errors: ["[x_diagnostic] y"], usage });
    assert.equal(s.transcript.filter((r) => r && r.kind === "turnError").length, failures, `${label}: ${why}`);
  }
  rmSync(root, { recursive: true, force: true });
});

test("a turn that produced NOTHING still gets the red bar — the original bug must stay fixed", () => {
  const root = fixture();
  const { m } = mgr(root, join(root, "none"));
  const s = { key: "k", workspaceId: "Test/repo@main", transcript: [], status: "idle" };
  m.sessions.set("k", s);
  m._onEvent("k", { kind: "result", isError: true, subtype: "error_during_execution",
    errors: ["No conversation found with session ID: b17780e2-dc9f-44f1-8629-9fb687b601af"],
    usage: { output_tokens: 0 } });
  const row = s.transcript.find((r) => r && r.kind === "turnError");
  assert.ok(row, "nothing came back — that IS a failed turn");
  assert.match(row.message, /No conversation found/);
  rmSync(root, { recursive: true, force: true });
});

test("the flag resets, so one dead turn after a good one is still reported", () => {
  const root = fixture();
  const { m } = mgr(root, join(root, "none"));
  const s = { key: "k", workspaceId: "Test/repo@main", transcript: [], status: "idle" };
  m.sessions.set("k", s);
  m._onEvent("k", { kind: "assistant", text: "first turn spoke" });
  m._onEvent("k", { kind: "result", isError: false });
  m._onEvent("k", { kind: "result", isError: true, subtype: "error_during_execution", errors: ["dead"], usage: { output_tokens: 0 } });
  assert.equal(s.transcript.filter((r) => r && r.kind === "turnError").length, 1,
    "a previous turn's output must not vouch for this one — the flag has to clear at every result");
  rmSync(root, { recursive: true, force: true });
});
