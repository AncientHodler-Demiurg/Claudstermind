// Tests for lib/storage.mjs — Ch.1.1, the single choke point for "root + workspace id -> where
// does that workspace's state live." Pure path computation, ported verbatim from
// lib/workspaceStore.mjs (which now re-exports the id<->slug primitives from here) plus new
// workspaceDir/segmentsDir/imagesDir/documentsDir helpers.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  workspaceId,
  parseWorkspaceId,
  slugFor,
  idFromSlug,
  workspaceDir,
  segmentsDir,
  imagesDir,
  documentsDir,
  SEGMENTS_SUBDIR,
  IMAGES_SUBDIR,
  DOCUMENTS_SUBDIR,
  ZONE,
  isInsideRepo,
  assertZoneRoot,
} from "./storage.mjs";

test("workspaceId joins repo@worktree, defaulting worktree to main", () => {
  assert.equal(workspaceId("Repo", "feature-x"), "Repo@feature-x");
  assert.equal(workspaceId("Repo"), "Repo@main");
  assert.equal(workspaceId("Repo", ""), "Repo@main");
  assert.equal(workspaceId("Repo", null), "Repo@main");
});

test("parseWorkspaceId is workspaceId's inverse, splitting on the LAST @", () => {
  assert.deepEqual(parseWorkspaceId("Repo@main"), { repo: "Repo", worktree: "main" });
  assert.deepEqual(parseWorkspaceId("Org/Repo@feature-x"), { repo: "Org/Repo", worktree: "feature-x" });
  assert.deepEqual(parseWorkspaceId("no-at-sign"), { repo: "no-at-sign", worktree: "main" });
  assert.deepEqual(parseWorkspaceId("Repo@"), { repo: "Repo", worktree: "main" }, "trailing @ with nothing after still defaults");
  assert.deepEqual(parseWorkspaceId(""), { repo: "", worktree: "main" });
  assert.deepEqual(parseWorkspaceId(null), { repo: "", worktree: "main" });
});

test("slugFor/idFromSlug round-trip exactly, including characters outside the kept set", () => {
  const id = "OuroborosNetwork/daimons/OuronetUI@main";
  const slug = slugFor(id);
  assert.equal(slug.includes("/"), false, "path separators must not survive into a slug");
  assert.equal(idFromSlug(slug), id);

  // The historical bug this guards against: `-` is a KEPT character, so a key containing it must
  // not be mistaken for an escape sequence on the way back.
  const withDash = "rc-1-2";
  assert.equal(idFromSlug(slugFor(withDash)), withDash);

  // `~` itself, if it ever appeared in an id, must escape losslessly too.
  const withTilde = "weird~name";
  assert.equal(idFromSlug(slugFor(withTilde)), withTilde);
});

test("workspaceDir is the ONE place root+id becomes a directory — matches join(root, slugFor(id)) exactly", () => {
  const root = "/tmp/some-transcript-root";
  const id = "OuroborosNetwork/daimons/OuronetUI@main";
  assert.equal(workspaceDir(root, id), path.join(root, slugFor(id)));
});

test("workspaceDir coerces a non-string root without throwing", () => {
  assert.equal(workspaceDir(null, "x"), path.join("null", slugFor("x")));
  assert.doesNotThrow(() => workspaceDir(undefined, "x"));
});

test("segmentsDir/imagesDir/documentsDir append the documented subdir name, sourced from the exported constants", () => {
  const wsDir = "/tmp/some-workspace-dir";
  assert.equal(segmentsDir(wsDir), path.join(wsDir, SEGMENTS_SUBDIR));
  assert.equal(imagesDir(wsDir), path.join(wsDir, IMAGES_SUBDIR));
  assert.equal(documentsDir(wsDir), path.join(wsDir, DOCUMENTS_SUBDIR));
  // Pin the actual literal values too — these are the ON-DISK names real installs already have;
  // silently changing them would orphan every existing image/document/segment on a real install.
  assert.equal(SEGMENTS_SUBDIR, "_segments");
  assert.equal(IMAGES_SUBDIR, "images");
  assert.equal(DOCUMENTS_SUBDIR, "documents");
});

test("chaining workspaceDir -> imagesDir/segmentsDir/documentsDir produces the exact real on-disk shape", () => {
  const root = "/tmp/transcript-root";
  const id = "Repo@main";
  const ws = workspaceDir(root, id);
  assert.equal(imagesDir(ws), path.join(root, slugFor(id), "images"));
  assert.equal(segmentsDir(ws), path.join(root, slugFor(id), "_segments"));
  assert.equal(documentsDir(ws), path.join(root, slugFor(id), "documents"));
});

// ---------------------------------------------------------------------------
// Ch.1.3b — zone as part of the interface (docs/work/exocortex/three-zone-model.md)
// ---------------------------------------------------------------------------

test("ZONE is a real, frozen enum with exactly the three documented values", () => {
  assert.deepEqual(ZONE, { SHELL: "shell", PRIVATE: "private", BRAIN: "brain" });
  assert.throws(() => { ZONE.SHELL = "mutated"; }, /Cannot assign/, "frozen — a typo elsewhere can't silently redefine a zone");
});

test("isInsideRepo: true for the repo itself and anything under it, false for a sibling or parent path", () => {
  const repo = "/home/user/ClaudeWS/Claudstermind";
  assert.equal(isInsideRepo(repo, repo), true, "the repo root itself counts as inside");
  assert.equal(isInsideRepo(path.join(repo, "brain"), repo), true);
  assert.equal(isInsideRepo(path.join(repo, "dashboard", "data", "map.json"), repo), true);
  assert.equal(isInsideRepo("/home/user/ClaudeWS/.claude/workspace", repo), false, "a sibling of the repo, not under it");
  assert.equal(isInsideRepo("/home/user/ClaudeWS", repo), false, "the repo's OWN parent is not inside it");
  // A path that merely shares a string prefix with the repo path (but isn't actually nested)
  // must not be misclassified — path.relative, not startsWith, is what makes this correct.
  assert.equal(isInsideRepo("/home/user/ClaudeWS/Claudstermind-other-repo", repo), false);
});

test("assertZoneRoot never throws for ZONE.SHELL, regardless of location — Zone 1 is SUPPOSED to be inside the repo", () => {
  const repo = "/home/user/ClaudeWS/Claudstermind";
  assert.equal(assertZoneRoot(ZONE.SHELL, path.join(repo, "lib"), repo), path.join(repo, "lib"));
  assert.equal(assertZoneRoot(ZONE.SHELL, "/anywhere/else", repo), "/anywhere/else");
});

test("assertZoneRoot throws for PRIVATE/BRAIN roots that resolve inside the repo, passes when outside", () => {
  const repo = "/home/user/ClaudeWS/Claudstermind";
  const outside = "/home/user/ClaudeWS/.claude/workspace";
  assert.equal(assertZoneRoot(ZONE.PRIVATE, outside, repo), outside);
  assert.equal(assertZoneRoot(ZONE.BRAIN, path.join("/home/user/ClaudeWS", "brain"), repo), path.join("/home/user/ClaudeWS", "brain"));

  assert.throws(() => assertZoneRoot(ZONE.PRIVATE, path.join(repo, ".secrets"), repo), /must not be inside the repo/);
  assert.throws(() => assertZoneRoot(ZONE.BRAIN, path.join(repo, "brain"), repo), /must not be inside the repo/);
});

test("assertZoneRoot catches the EXACT real brainDir bug shape (1.2a/1.3a's finding), and accepts the fix", () => {
  // Mirrors dashboard/server.mjs's actual anchors: __dir is dashboard/'s own directory (one level
  // under the repo root); MASTER_ROOT is resolve(__dir, "..", "..") — one level further up again,
  // the repo's PARENT — the same anchor transcriptDir/secretsDir already use correctly.
  const repoRoot = "/home/user/ClaudeWS/Claudstermind";
  const dashboardDir = path.join(repoRoot, "dashboard");
  const masterRoot = path.resolve(dashboardDir, "..", ".."); // = repoRoot's parent

  // THE BUG (as shipped): resolve(__dir, "..", "brain") — one level up from dashboard/ is the
  // REPO ROOT, not MASTER_ROOT. This is a Zone-3 root landing on a Zone-1 path.
  const buggyBrainDir = path.resolve(dashboardDir, "..", "brain");
  assert.equal(buggyBrainDir, path.join(repoRoot, "brain"), "confirms this reproduces the real on-disk path found in the audit");
  assert.throws(() => assertZoneRoot(ZONE.BRAIN, buggyBrainDir, repoRoot), /must not be inside the repo/);

  // THE FIX (1.4's job to actually apply): anchor to MASTER_ROOT instead, same convention
  // transcriptDir/secretsDir already use.
  const fixedBrainDir = path.resolve(masterRoot, "brain");
  assert.equal(assertZoneRoot(ZONE.BRAIN, fixedBrainDir, repoRoot), fixedBrainDir);
});
