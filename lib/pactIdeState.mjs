// Shared, server-side IDE-state store for the Pact workspace.
//
// The Pact IDE (Workspace › Pact) must reopen exactly where it was left — same open files, same
// editor boxes, same chat tabs — AND that state must be identical whether you reach it from
// localhost or from the remote website. Browser localStorage can't do the second half (two
// different origins, two different stores), so the layout snapshot lives on the WORK MACHINE, in
// one JSON file beside the Pact workspace's conversation history:
//
//     .claude/workspace/OuroborosNetwork~2f~_onchain~2f~Ouronet@main/_ide-state.json
//
// The blob is OPAQUE to the backend — the frontend authors and interprets it (open file paths, box
// weights/fonts, chat tab names + drafts, collapse state, chat-session names). This module only
// reads/writes it safely: object-only, size-capped, and never throwing on a missing or corrupt
// file (a fresh default view is always recoverable). Node builtins only; runs the same under the
// local dashboard and, tunnelled, under the work-machine bridge.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { slugFor, workspaceId } from "./workspaceStore.mjs";

// The one Pact workspace whose IDE state this persists — the same repo@worktree id lib/workspace.mjs
// derives for every embedded Pact chat prompt (PACT_REPO + the "main" worktree). Kept here so the
// store, the endpoints, and the tests all agree on one definition.
export const PACT_REPO = "OuroborosNetwork/_onchain/Ouronet";
export const PACT_WORKSPACE_ID = workspaceId(PACT_REPO, "main");
export const IDE_STATE_FILE = "_ide-state.json";

// Cap on the persisted blob. It is a compact layout snapshot — file PATHS, box weights/fonts, chat
// tab names + drafts — never file contents, so a sane state is a few KB. 512 KB is orders of
// magnitude more headroom than that and still bounds a runaway or hostile write.
export const MAX_IDE_STATE_BYTES = 512 * 1024;

/** Absolute path to the Pact workspace's IDE-state file under a `.claude/workspace` transcript dir. */
export function ideStatePath(transcriptDir) {
  return join(transcriptDir, slugFor(PACT_WORKSPACE_ID), IDE_STATE_FILE);
}

/** The saved IDE state, or `{}` when it's absent, unreadable, corrupt, or not a plain object — a
 *  fresh default view must ALWAYS be recoverable, so this never throws. Returns a plain object. */
export function readIdeState(transcriptDir) {
  if (!transcriptDir) return {};
  let raw;
  try { raw = readFileSync(ideStatePath(transcriptDir), "utf8"); } catch { return {}; }
  let obj; try { obj = JSON.parse(raw); } catch { return {}; }
  return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
}

/** Persist the opaque layout blob the frontend authored. Guards, mirroring pactFs.writeTextFile's
 *  shape: object-only, serialisable, under the size cap; the workspace dir is created if absent.
 *  Returns `{ ok, size }` or `{ ok: false, error }` — never throws. */
export function writeIdeState(transcriptDir, state) {
  if (!transcriptDir) return { ok: false, error: "no transcript dir" };
  if (!state || typeof state !== "object" || Array.isArray(state)) return { ok: false, error: "state must be an object" };
  let text; try { text = JSON.stringify(state); } catch (e) { return { ok: false, error: "unserialisable state: " + e.message }; }
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_IDE_STATE_BYTES) return { ok: false, error: "state too large to save", size: bytes, tooLarge: true };
  try {
    const dir = join(transcriptDir, slugFor(PACT_WORKSPACE_ID));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(ideStatePath(transcriptDir), text, "utf8");
    return { ok: true, size: bytes };
  } catch (e) { return { ok: false, error: e.message }; }
}
