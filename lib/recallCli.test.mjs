// node --test lib/recallCli.test.mjs
//
// "I want to show another agent what an agent said … if agents in a chatbox can read answer R#949 of
// another agent in another chat."
//
// They can, because every agent here has a shell. `scripts/recall.mjs` turns an ADDRESS into text:
//
//     node scripts/recall.mjs 'AncientPantheon/constructors/Khronoton@main#R949'
//
// The ⧉ button on every message copies exactly that address (Alt/Shift-click), so the loop is:
// point at a turn in one chat, paste the address into another, that agent reads it itself. An
// address beats a paste the moment the answer is large, and it stays meaningful later.
//
// THE THING THAT MUST NOT DRIFT is the numbering. R#n is the n-th assistant row of the LIVE
// transcript, 1-based — wrapping never splices that file, it archives a COPY of the head — and the
// server confirms it by handing a full transcript back with `responseOffset: 0`. Counting the
// archive as well returns the wrong turn while looking entirely plausible, which is exactly the
// class of bug that made recall-by-number useless before 1.12.0.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dir, "..", "scripts", "recall.mjs");

/** A workspace on disk with one Core conversation of `n` exchanges. */
function fixture(n = 5) {
  const root = mkdtempSync(join(tmpdir(), "recall-cli-"));
  const slug = "Demo~2f~repo@main";
  const dir = join(root, slug); mkdirSync(dir, { recursive: true });
  const lines = [];
  for (let i = 1; i <= n; i++) {
    lines.push(JSON.stringify({ role: "user", text: "prompt number " + i, at: 1000 + i }));
    lines.push(JSON.stringify({ role: "assistant", text: "answer number " + i, at: 2000 + i }));
  }
  writeFileSync(join(dir, slug + ".jsonl"), lines.join("\n") + "\n");
  return { root, id: "Demo/repo@main" };
}
const run = (root, ...args) => execFileSync(process.execPath, [CLI, ...args],
  { env: { ...process.env, CM_WORKSPACE_DIR: root }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const fails = (root, ...args) => {
  try { run(root, ...args); return null; }
  catch (e) { return String(e.stderr || e.message); }
};

test("an address resolves to that turn's exact text — answers and prompts alike", () => {
  const { root, id } = fixture(5);
  assert.equal(run(root, `${id}#R3`).trim(), "answer number 3");
  assert.equal(run(root, `${id}#P1`).trim(), "prompt number 1");
  assert.equal(run(root, `${id}#R5`).trim(), "answer number 5", "the last turn is reachable");
  rmSync(root, { recursive: true, force: true });
});

test("numbering is 1-based over the live transcript — off by one returns the WRONG turn silently", () => {
  const { root, id } = fixture(5);
  assert.equal(run(root, `${id}#R1`).trim(), "answer number 1", "R#1 is the FIRST answer, not the second");
  assert.notEqual(run(root, `${id}#R2`).trim(), "answer number 1");
  rmSync(root, { recursive: true, force: true });
});

test("a fragment of the id works when it is unambiguous, and refuses when it is not", () => {
  const { root } = fixture(3);
  assert.equal(run(root, "Demo#R2").trim(), "answer number 2", "typing the whole id every time is friction");

  const slug2 = "Demo~2f~other@main";
  mkdirSync(join(root, slug2), { recursive: true });
  writeFileSync(join(root, slug2, slug2 + ".jsonl"),
    JSON.stringify({ role: "assistant", text: "elsewhere", at: 1 }) + "\n");
  const err = fails(root, "Demo#R2");
  assert.match(err, /ambiguous/i, "two matches must be refused, not guessed between");
  assert.match(err, /Demo\/repo@main/, "…and the candidates listed, so the fix is obvious");
  rmSync(root, { recursive: true, force: true });
});

test("out of range says how many there are, rather than failing blankly", () => {
  const { root, id } = fixture(4);
  const err = fails(root, `${id}#R99`);
  assert.match(err, /out of range/);
  assert.match(err, /4 answers/, "the count is the one fact that makes the error actionable");
  rmSync(root, { recursive: true, force: true });
});

test("a malformed address is rejected with the shape it wanted", () => {
  const { root, id } = fixture(2);
  for (const bad of [id, `${id}#X1`, `${id}#R`, "nonsense"]) {
    const err = fails(root, bad);
    assert.ok(err, `"${bad}" must not be accepted`);
    assert.match(err, /address|Expected|No conversation/i);
  }
  rmSync(root, { recursive: true, force: true });
});

test("the TEXT goes to stdout alone, so it can be piped or redirected cleanly", () => {
  const { root, id } = fixture(3);
  const out = run(root, `${id}#R2`);
  assert.equal(out.trim(), "answer number 2", "no header, no decoration — the header goes to stderr");
  assert.ok(!out.includes("──"), "a pipe must receive the turn and nothing else");
  rmSync(root, { recursive: true, force: true });
});

test("--json carries the address back with the text, for a caller that wants both", () => {
  const { root, id } = fixture(3);
  const j = JSON.parse(run(root, `${id}#R2`, "--json"));
  assert.equal(j.conversation, id);
  assert.equal(j.kind, "R");
  assert.equal(j.number, 2);
  assert.equal(j.text, "answer number 2");
  assert.match(j.source, /live/);
  rmSync(root, { recursive: true, force: true });
});

test("--list names every conversation with its real P#/R# range", () => {
  const { root, id } = fixture(4);
  const out = run(root, "--list");
  assert.match(out, new RegExp(id.replace(/[/@]/g, "\\$&")));
  assert.match(out, /P#1–4 · R#1–4/, "the ranges are what make an address writable without guessing");
  rmSync(root, { recursive: true, force: true });
});
