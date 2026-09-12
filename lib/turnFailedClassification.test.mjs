// node --test lib/turnFailedClassification.test.mjs
//
// "What is that engine note error? It seems processing that blue prompt stalled, so I had to stop
//  and reload."
//
// The note itself is the Agent SDK's own words, passed through verbatim:
//
//   [ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null
//
// The engine decides how loudly to say it. A `result` frame carrying `is_error` is either a turn that
// genuinely died, or a remark about a turn that worked — the SDK sends BOTH with
// `subtype: "error_during_execution"`, so the subtype cannot separate them. What the turn DID can.
//
// The rule used to be `_turnOutput`, set by `assistant`, `assistant_delta`, **`tool_use` and
// `tool_result`** — even though its own docstring asked "did the current turn produce anything the
// user can see?". Tool calls are the engine talking to itself. So a turn that ran four tools, never
// answered, and then errored counted as "worked fine, just a diagnostic": a quiet beige note under a
// prompt with no reply. That is precisely the "prompts are stuck" report the whole feature exists
// for, wearing the disguise meant for successful turns.
//
// An answer is text the reader got. Nothing else counts.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceManager } from "./workspace.mjs";

const fixture = () => mkdtempSync(join(tmpdir(), "cm-turnfail-"));
function mgr(root) {
  const sends = [];
  const m = new WorkspaceManager({ root, transcriptDir: join(root, "tx"),
    send: (kind, sessionKey, data) => sends.push({ kind, sessionKey, data }) });
  return { m, sends };
}
const session = (m) => { const s = { key: "k", workspaceId: "T/repo@main", transcript: [], status: "idle" }; m.sessions.set("k", s); return s; };
const rows = (s, kind) => s.transcript.filter((r) => r && r.kind === kind);
const DIAG = ["[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null"];

test("tool calls are not an answer — a turn that only ran tools and died FAILED", () => {
  const root = fixture(); const { m, sends } = mgr(root); const s = session(m);
  m._onEvent("k", { kind: "tool_use", tools: [{ name: "Read" }] });
  m._onEvent("k", { kind: "tool_result", results: [{ output: "ok" }] });
  m._onEvent("k", { kind: "result", isError: true, subtype: "error_during_execution", errors: DIAG });

  assert.equal(rows(s, "turnError").length, 1,
    "four tool calls and no reply is a stalled prompt, not a working conversation with a remark");
  assert.ok(!sends.some((x) => x.data && x.data.kind === "warning"),
    "…and it must not ALSO be downgraded to a note — one verdict, not two");
  rmSync(root, { recursive: true, force: true });
});

test("output TOKENS are not an answer either — tool calls burn them too", () => {
  const root = fixture(); const { m } = mgr(root); const s = session(m);
  m._onEvent("k", { kind: "result", isError: true, subtype: "error_during_execution",
    errors: DIAG, usage: { output_tokens: 21039 } });
  assert.equal(rows(s, "turnError").length, 1,
    "a token count says work happened, not that the reader got anything — same loophole, same lie");
  rmSync(root, { recursive: true, force: true });
});

test("an empty assistant frame is not an answer", () => {
  const root = fixture(); const { m } = mgr(root); const s = session(m);
  m._onEvent("k", { kind: "assistant", text: "   " });
  m._onEvent("k", { kind: "result", isError: true, subtype: "error_during_execution", errors: DIAG });
  assert.equal(rows(s, "turnError").length, 1, "whitespace is not something the reader got");
  rmSync(root, { recursive: true, force: true });
});

test("a turn that actually ANSWERED still gets the quiet note, not a red bar", () => {
  // The behaviour this classification was built to protect: 21,039 tokens streamed, turn finished,
  // SDK remarked on it. Shouting TURN FAILED across a working conversation is the opposite lie.
  const root = fixture(); const { m, sends } = mgr(root); const s = session(m);
  m._onEvent("k", { kind: "assistant", text: "here is the answer" });
  m._onEvent("k", { kind: "result", isError: true, subtype: "error_during_execution", errors: DIAG });
  assert.equal(rows(s, "turnError").length, 0, "it answered — nothing failed");
  const warn = sends.find((x) => x.data && x.data.kind === "warning");
  assert.match(warn.data.message, /ede_diagnostic/, "…but the SDK's words are not swallowed");
  rmSync(root, { recursive: true, force: true });
});

test("the verdict is per turn — a previous answer cannot absolve the next failure", () => {
  const root = fixture(); const { m } = mgr(root); const s = session(m);
  m._onEvent("k", { kind: "assistant", text: "first answer" });
  m._onEvent("k", { kind: "result", usage: {} });                      // turn 1 ends cleanly
  m._onEvent("k", { kind: "tool_use", tools: [{ name: "Bash" }] });    // turn 2: tools only
  m._onEvent("k", { kind: "result", isError: true, subtype: "error_during_execution", errors: DIAG });
  assert.equal(rows(s, "turnError").length, 1,
    "the reply flag must be cleared when a turn ends, or one good answer silences every later stall");
  rmSync(root, { recursive: true, force: true });
});
