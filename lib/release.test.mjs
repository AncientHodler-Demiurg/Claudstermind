import test from "node:test";
import assert from "node:assert/strict";
import { nextVersion, changelogEntry, insertChangelog } from "./release.mjs";
import { deploySteps } from "./deploy.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));

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

/* ================= the tar must contain everything the image copies =============================
 *
 * The deploy died on the box with:
 *
 *   #14 ERROR: failed to calculate checksum of ref …: "/packages/claude-chat-shell/src": not found
 *   > [10/11] COPY packages/claude-chat-shell/src/ ./packages/claude-chat-shell/src/
 *
 * The Dockerfile had learned to ship the chat-shell package (1.13.5, the fix for a phone that could
 * not open the Workspace at all); the tarball that carries the build context to the box had not. Two
 * lists of "what the relay needs", in two files, and only one of them was updated — the build context
 * is assembled HERE and consumed THERE, so nothing local could notice.
 *
 * Derived from the Dockerfile rather than restated, so the next COPY is covered the day it is added.
 */
test("every path the relay Dockerfile COPYs is inside the tarball the deploy ships", () => {
  const dockerfile = readFileSync(join(__dir, "..", "relay", "Dockerfile"), "utf8");
  const copied = [...dockerfile.matchAll(/^COPY\s+(\S+)\s/gm)].map((m) => m[1].replace(/\/$/, ""));
  const tar = deploySteps({ repoRoot: "/repo" })[0];
  // The tar's operands are everything after the flags — the paths it descends into.
  const shipped = tar.args.filter((a) => !a.startsWith("-") && a !== "czf" && a !== "cm-deploy.tgz");
  const missing = copied.filter((src) => !shipped.some((p) => src === p || src.startsWith(p + "/")));
  assert.deepEqual(missing, [],
    "a COPY of something the tarball does not carry fails the remote build — the deploy cannot even start the new container");
});

test("the chat-shell package specifically — the one the phone needs — is in the tar", () => {
  const tar = deploySteps({ repoRoot: "/repo" })[0];
  assert.ok(tar.args.some((a) => a.startsWith("packages/claude-chat-shell")),
    "index.html loads /chat-shell/* and the relay serves it from this directory (relay/staticAssets.test.mjs)");
});
