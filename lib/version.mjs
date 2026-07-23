// The single source of Claudstermind's version — package.json, plus a build stamp.
// Shown in the header medallion (§10 versioning) and returned by GET /api/version, so the
// Deploy panel can compare Live (the box) vs Pending (local).
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));

// The git SHA + build time are computed once (shelling out to git is wasteful, and the image
// has neither .git nor git). The VERSION is re-read cheaply each call, so a release bump shows
// up immediately in the local /api/version (the Deploy panel's "Pending").
let ENV_CACHE = null;

export function readVersion() {
  // In the image the version is build-stamped (the container's package.json is the relay's, not
  // the root); locally it's read live from the root package.json.
  let version = (process.env.CM_VERSION || "").trim();
  if (!version) { try { version = JSON.parse(readFileSync(join(__dir, "..", "package.json"), "utf8")).version; } catch {} }
  if (!version) version = "0.0.0";
  if (!ENV_CACHE) {
    let gitSha = (process.env.CM_GIT_SHA || "").trim() || null;
    if (!gitSha) { try { gitSha = execSync("git rev-parse --short HEAD", { cwd: join(__dir, ".."), stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* no git */ } }
    // `runningVersion` freezes the FIRST version this process ever saw — what code is actually
    // loaded and executing right now — as opposed to `version` above, re-read live on every call
    // so it reflects whatever's on disk RIGHT NOW even if this process hasn't restarted to pick
    // it up yet. They only diverge on a long-running local process where files can change without
    // a restart; the container is a fully atomic rebuild-and-swap unit, so there they're always
    // equal. This is what lets the Admin panel show "local host: what's actually running" next to
    // "pending: what's on disk" as two honestly different numbers instead of one misleading one.
    ENV_CACHE = { gitSha: gitSha || "unknown", builtAt: (process.env.CM_BUILT_AT || "").trim() || null, runningVersion: version };
  }
  return { version, ...ENV_CACHE };
}
