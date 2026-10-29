// Tests for lib/priorArt.mjs — Ch.2.3b, the "you already solved this" prior-art check composed
// from Ch.2.0 (conversation recall) + Ch.2.3a (knowledge retrieval), over a real workspace dir.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { archiveSegment } from "./conversationArchive.mjs";
import { openDb as openKnowledgeDb, addFact } from "./knowledgeStore.mjs";
import { workspaceDir } from "./storage.mjs";
import { buildPriorArtContext } from "./priorArt.mjs";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "priorart-"));
}

const PROV = { conversationId: "c1", turnKind: "prompt", turnNumber: 1, at: 1700000000000 };

test("buildPriorArtContext: null on missing transcriptDir/workspaceId/query", () => {
  assert.equal(buildPriorArtContext({}), null);
  assert.equal(buildPriorArtContext({ transcriptDir: "/x", workspaceId: "w" }), null, "no query");
  assert.equal(buildPriorArtContext({ transcriptDir: "/x", query: "q" }), null, "no workspaceId");
  assert.equal(buildPriorArtContext({ workspaceId: "w", query: "q" }), null, "no transcriptDir");
  assert.equal(buildPriorArtContext({ transcriptDir: "/x", workspaceId: "w", query: "   " }), null, "blank query");
});

test("buildPriorArtContext: null for a brand-new workspace with nothing archived or known", () => {
  const transcriptDir = tmp();
  const r = buildPriorArtContext({ transcriptDir, workspaceId: "repo@main", query: "anything at all" });
  assert.equal(r, null);
  fs.rmSync(transcriptDir, { recursive: true, force: true });
});

test("buildPriorArtContext: surfaces a matching archived turn from the SAME workspace, any conversation", () => {
  const transcriptDir = tmp();
  const wsDir = workspaceDir(transcriptDir, "repo@main");
  fs.mkdirSync(wsDir, { recursive: true });
  archiveSegment(wsDir, {
    conversationId: "some-other-conversation", n: 0, promptOffset: 0, responseOffset: 0, summary: "s0",
    rows: [
      { role: "user", text: "how do we deploy the staging box" },
      { role: "assistant", text: "run the deploy script with --staging" },
    ],
  });
  const r = buildPriorArtContext({ transcriptDir, workspaceId: "repo@main", query: "deploy" });
  assert.ok(r);
  assert.ok(r.hits.length >= 1);
  assert.match(r.text, /deploy/i);
  fs.rmSync(transcriptDir, { recursive: true, force: true });
});

test("buildPriorArtContext: surfaces durable knowledge (facts) alongside recall", () => {
  const transcriptDir = tmp();
  const wsDir = workspaceDir(transcriptDir, "repo@main");
  fs.mkdirSync(wsDir, { recursive: true });
  const kdb = openKnowledgeDb(wsDir);
  addFact(kdb, { text: "This repo deploys via ./deploy.sh, never manually.", confidence: 0.9, ...PROV });
  kdb.close();

  const r = buildPriorArtContext({ transcriptDir, workspaceId: "repo@main", query: "how do I deploy this" });
  assert.ok(r);
  assert.equal(r.knowledgeCount, 1);
  assert.match(r.text, /deploy\.sh/);
  fs.rmSync(transcriptDir, { recursive: true, force: true });
});

test("buildPriorArtContext: a workspace's data never leaks into a DIFFERENT workspaceId's prior art", () => {
  const transcriptDir = tmp();
  const wsA = workspaceDir(transcriptDir, "repoA@main");
  fs.mkdirSync(wsA, { recursive: true });
  const kdb = openKnowledgeDb(wsA);
  addFact(kdb, { text: "repoA-only secret convention", confidence: 0.9, ...PROV });
  kdb.close();

  const r = buildPriorArtContext({ transcriptDir, workspaceId: "repoB@main", query: "secret convention" });
  assert.equal(r, null);
  fs.rmSync(transcriptDir, { recursive: true, force: true });
});

test("buildPriorArtContext: never throws on a corrupt knowledge.sqlite3 — degrades to recall-only or null", () => {
  const transcriptDir = tmp();
  const wsDir = workspaceDir(transcriptDir, "repo@main");
  fs.mkdirSync(wsDir, { recursive: true });
  fs.writeFileSync(path.join(wsDir, "knowledge.sqlite3"), "not a real db");
  archiveSegment(wsDir, {
    conversationId: "c0", n: 0, promptOffset: 0, responseOffset: 0, summary: "s0",
    rows: [{ role: "user", text: "widget rollout plan" }, { role: "assistant", text: "widget rollout done" }],
  });
  const r = buildPriorArtContext({ transcriptDir, workspaceId: "repo@main", query: "widget" });
  assert.ok(r, "recall half still works despite the corrupt knowledge db");
  assert.equal(r.knowledgeCount, 0);
  fs.rmSync(transcriptDir, { recursive: true, force: true });
});
