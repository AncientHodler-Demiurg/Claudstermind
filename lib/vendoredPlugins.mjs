// THE PLUGINS CLAUDSTERMIND SHIPS WITH.
//
// bee (spec-driven workflow), wasp (audit-to-publish) and nectar (shape/plan/build/review) are
// VENDORED into this repo under plugins/, not loaded from a marketplace. That is the whole point:
// a clone of Claudstermind has them, on any machine, with nothing to install and nothing to enable.
// Before this, they were a per-machine setting — on the work machine only nectar was switched on,
// so the same prompt behaved differently depending on which box answered it.
//
// They are SKELETON, not brain: markdown, commands and agents that describe how to work, carrying no
// conversation content. That is why they belong in the repo while `.claude/workspace/` does not.
//
// Updating is a copy, not a merge: `node scripts/sync-plugins.mjs` re-pulls from the upstream
// checkout and rewrites plugins/.vendor.json with the source commit and each plugin's version, so
// "which bee is this?" is answerable from the repo alone.
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PLUGINS_DIR = join(ROOT, "plugins");

/** The vendored set, in load order. bee first: wasp is explicitly an additive layer on top of it. */
export const VENDORED_PLUGINS = Object.freeze(["bee", "wasp", "nectar"]);

/**
 * The SDK's `plugins` option for a session — `[{ type: "local", path }]`.
 *
 * Absolute paths, because a session's cwd is the REPOSITORY IT IS WORKING ON, not this one; a
 * relative path would resolve against whichever repo the conversation happens to be about and find
 * nothing. Silently skips any plugin missing from disk rather than failing the session: a broken
 * vendor directory must not be the reason you cannot talk to your agent.
 */
export function vendoredPluginOptions(dir = PLUGINS_DIR) {
  return VENDORED_PLUGINS
    .map((name) => ({ name, path: join(dir, name) }))
    .filter((p) => existsSync(join(p.path, ".claude-plugin", "plugin.json")))
    .map((p) => ({ type: "local", path: p.path }));
}

/** What is actually vendored, for the About/Admin surface and for answering "which bee is this?". */
export function vendoredManifest(dir = PLUGINS_DIR) {
  try { return JSON.parse(readFileSync(join(dir, ".vendor.json"), "utf8")); }
  catch { return null; }
}
