import test from "node:test";
import assert from "node:assert/strict";
import { nextVersion, changelogEntry, insertChangelog } from "./release.mjs";
import { deploySteps } from "./deploy.mjs";

test("nextVersion bumps patch/minor/major", () => {
  assert.equal(nextVersion("0.2.0", "patch"), "0.2.1");
  assert.equal(nextVersion("0.2.0", "minor"), "0.3.0");
  assert.equal(nextVersion("0.2.9", "major"), "1.0.0");
  assert.throws(() => nextVersion("x", "patch"));
  assert.throws(() => nextVersion("0.2.0", "nope"));
});

test("insertChangelog puts the new entry above the newest existing version", () => {
  const md = "# Changelog\n\nintro\n\n## [0.2.0] - 2026-07-22\n\nold\n";
  const out = insertChangelog(md, changelogEntry("0.3.0", "2026-07-23", "new stuff"));
  assert.match(out, /## \[0\.3\.0\][\s\S]*## \[0\.2\.0\]/);
  assert.ok(out.indexOf("0.3.0") < out.indexOf("0.2.0"), "new entry comes first");
});

test("deploySteps yields package → ship → rebuild(relay-only) → cleanup, no .env in the tar", () => {
  const steps = deploySteps({ repoRoot: "/repo", version: "0.3.0", gitSha: "abc1234" });
  assert.deepEqual(steps.map((s) => s.label), ["Package", "Ship", "Rebuild", "Cleanup"]);
  const tar = steps[0];
  assert.equal(tar.cmd, "tar");
  assert.ok(tar.args.includes("--exclude=relay/.env"), "must never overwrite the box .env");
  assert.ok(tar.args.includes("--exclude=relay/docker-compose.override.yml"), "must preserve the port override");
  const rebuild = steps[2].args.at(-1);
  assert.match(rebuild, /docker build -f relay\/Dockerfile/, "builds the image directly (no compose → no caddy)");
  assert.match(rebuild, /--build-arg CM_VERSION=0\.3\.0/, "stamps the version into the build");
  assert.match(rebuild, /upstream cm_relay \{ server 127\.0\.0\.1:\$TPORT/, "blue-green: flips the nginx upstream");
  assert.match(rebuild, /nginx -t/, "gates the reload on nginx -t");
  assert.match(rebuild, /green unhealthy — aborting, nginx untouched/, "aborts safely before touching nginx");
});
