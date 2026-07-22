import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conversationDigest, heuristicRepoMarkdown, runHeuristicDistill, claudePrompt, runClaudeDistill,
  readDistillConfig, writeDistillConfig, readDistillUsage, addDistillUsage } from "./distill.mjs";

function fx() {
  const root = mkdtempSync(join(tmpdir(), "distill-"));
  const td = join(root, ".claude", "workspace"); mkdirSync(td, { recursive: true });
  const brain = join(root, "brain"); mkdirSync(brain, { recursive: true });
  const claudeDir = join(root, ".claude");
  writeFileSync(join(td, "a.json"), JSON.stringify({ sessionKey: "a", repo: "AncientPantheon/constructors/Codex", updatedAt: 100, transcript: [{ role: "user", text: "add rekeyCodex" }, { role: "assistant", text: "Added rekeyCodex + tests. Bumped to v0.6.0." }] }));
  writeFileSync(join(td, "b.json"), JSON.stringify({ sessionKey: "b", repo: "AncientPantheon/constructors/Codex", updatedAt: 200, transcript: [{ role: "user", text: "document it" }, { role: "assistant", text: "Documented under Password rotation." }] }));
  return { root, td, brain, claudeDir };
}

test("conversationDigest splits requests + conclusions", () => {
  const d = conversationDigest({ sessionKey: "a", transcript: [{ role: "user", text: "do x" }, { role: "assistant", text: "done x" }] });
  assert.deepEqual(d.requests, ["do x"]); assert.deepEqual(d.conclusions, ["done x"]);
});

test("heuristicRepoMarkdown includes asks + outcomes", () => {
  const md = heuristicRepoMarkdown("Codex", [{ sessionKey: "a", updatedAt: 100, transcript: [{ role: "user", text: "add rekeyCodex" }, { role: "assistant", text: "Added rekeyCodex" }] }]);
  assert.match(md, /Distilled knowledge — Codex/);
  assert.match(md, /add rekeyCodex/);
  assert.match(md, /Added rekeyCodex/);
});

test("runHeuristicDistill writes brain/<key>/_distilled.md per repo", () => {
  const f = fx();
  const r = runHeuristicDistill({ transcriptDir: f.td, brainDir: f.brain });
  assert.equal(r.repos.length, 1);
  assert.equal(r.repos[0].key, "Codex");
  assert.equal(r.repos[0].conversations, 2);
  assert.ok(existsSync(join(f.brain, "Codex", "_distilled.md")));
  assert.match(readFileSync(join(f.brain, "Codex", "_distilled.md"), "utf8"), /rekeyCodex/);
  rmSync(f.root, { recursive: true, force: true });
});

test("config + usage persist", () => {
  const f = fx();
  assert.equal(readDistillConfig(f.claudeDir).claudeEnabled, false);
  writeDistillConfig(f.claudeDir, { claudeEnabled: true });
  assert.equal(readDistillConfig(f.claudeDir).claudeEnabled, true);
  addDistillUsage(f.claudeDir, { input_tokens: 100, output_tokens: 50 }, 0.01);
  const u = readDistillUsage(f.claudeDir);
  assert.equal(u.runs, 1); assert.equal(u.inputTokens, 100); assert.equal(u.costUsd, 0.01);
  rmSync(f.root, { recursive: true, force: true });
});

test("claudePrompt embeds the conversations + asks for skills", () => {
  const p = claudePrompt("Codex", [{ transcript: [{ role: "user", text: "add rekeyCodex" }] }]);
  assert.match(p, /rekeyCodex/); assert.match(p, /Skills/);
});

test("runClaudeDistill (mock SDK) writes a distilled file + records usage", async () => {
  const f = fx();
  const mockQuery = ({ prompt }) => (async function* () {
    const it = prompt[Symbol.asyncIterator](); await it.next();
    yield { type: "assistant", message: { content: [{ type: "text", text: "## Facts\n- Codex signs things." }] } };
    yield { type: "result", subtype: "success", usage: { input_tokens: 500, output_tokens: 60 }, total_cost_usd: 0.02 };
  })();
  const r = await runClaudeDistill({ transcriptDir: f.td, brainDir: f.brain, claudeDir: f.claudeDir, root: f.root, token: "t", sdkQuery: mockQuery });
  assert.equal(r.mode, "claude");
  assert.ok(r.repos.some((x) => x.key === "Codex" && x.wrote));
  assert.match(readFileSync(join(f.brain, "Codex", "_distilled.md"), "utf8"), /Codex signs things/);
  assert.ok(readDistillUsage(f.claudeDir).costUsd >= 0.02);
  rmSync(f.root, { recursive: true, force: true });
});
