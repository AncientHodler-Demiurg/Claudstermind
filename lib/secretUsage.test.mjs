// node --test lib/secretUsage.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { workflowSecretRefs, buildUsageIndex, secretUsage } from "./secretUsage.mjs";

function repoWithWorkflow(files) {
  const dir = mkdtempSync(join(tmpdir(), "wf-"));
  const wf = join(dir, ".github", "workflows");
  mkdirSync(wf, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(wf, name), body);
  return dir;
}

test("workflowSecretRefs finds every secrets.NAME and which file uses it", () => {
  const dir = repoWithWorkflow({
    "publish.yml": "run: echo ${{ secrets.NPM_PUBLISHER }} and ${{ secrets.RELEASE_TOKEN }}",
    "deploy.yml": "run: ssh ${{ secrets.DEPLOY_HOST }} key ${{ secrets.NPM_PUBLISHER }}",
  });
  const refs = workflowSecretRefs(dir);
  assert.deepEqual(refs.NPM_PUBLISHER.sort(), ["deploy.yml", "publish.yml"]);
  assert.deepEqual(refs.RELEASE_TOKEN, ["publish.yml"]);
  assert.deepEqual(refs.DEPLOY_HOST, ["deploy.yml"]);
  rmSync(dir, { recursive: true, force: true });
});

test("a repo with no workflows yields no refs (not a crash)", () => {
  const dir = mkdtempSync(join(tmpdir(), "nowf-"));
  assert.deepEqual(workflowSecretRefs(dir), {});
  rmSync(dir, { recursive: true, force: true });
});

test("secretUsage: repo secret used only if that repo references it", () => {
  const a = repoWithWorkflow({ "ci.yml": "${{ secrets.USED_HERE }}" });
  const b = repoWithWorkflow({ "ci.yml": "${{ secrets.SOMETHING_ELSE }}" });
  const index = buildUsageIndex([
    { owner: "org", repo: "a", abs: a },
    { owner: "org", repo: "b", abs: b },
  ]);
  assert.equal(secretUsage(index, "repo", "org/a", "USED_HERE").used, true);
  assert.equal(secretUsage(index, "repo", "org/a", "NEVER").used, false);
  assert.equal(secretUsage(index, "repo", "org/b", "USED_HERE").used, false); // not in b
  rmSync(a, { recursive: true, force: true });
  rmSync(b, { recursive: true, force: true });
});

test("secretUsage: org secret used if ANY repo in the org references it", () => {
  const a = repoWithWorkflow({ "ci.yml": "${{ secrets.NPM_PUBLISHER }}" });
  const b = repoWithWorkflow({ "ci.yml": "no secrets here" });
  const index = buildUsageIndex([
    { owner: "StoaChain", repo: "a", abs: a },
    { owner: "StoaChain", repo: "b", abs: b },
    { owner: "Other", repo: "c", abs: b },
  ]);
  const u = secretUsage(index, "org", "StoaChain", "NPM_PUBLISHER");
  assert.equal(u.used, true);
  assert.deepEqual(u.usedBy, ["StoaChain/a"]);
  // an org secret nothing in the org uses:
  assert.equal(secretUsage(index, "org", "StoaChain", "GHOST").used, false);
  rmSync(a, { recursive: true, force: true });
  rmSync(b, { recursive: true, force: true });
});
