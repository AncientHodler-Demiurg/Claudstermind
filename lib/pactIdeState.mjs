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

// Pre-seeded friendly names for known-important saved chats, merged into `chatNames` on read (never
// overwriting a name the user has since set). This is what makes the recovered large "Ouronet Pact
// audit" conversation — safe on disk but nameless (its first stored turn is the skill preamble) —
// show up in the history panel with a readable name from the very first load, on localhost AND the
// remote site, without the user having to rename it. Keyed by the saved session-file id.
export const SEED_CHAT_NAMES = Object.freeze({
  "9b41003b-b616-4ac3-9b2b-780f3b229662": "Ouronet Pact audit",
});

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
  let obj = {};
  if (transcriptDir) {
    try {
      const parsed = JSON.parse(readFileSync(ideStatePath(transcriptDir), "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) obj = parsed;
    } catch { /* missing / corrupt / not-an-object — fall through to defaults + seeds */ }
  }
  return withSeedNames(obj);
}

// Merge the pre-seeded chat names into a state blob's `chatNames`, without clobbering a name the user
// already set. Applied on every read so a seed shows even when the store file doesn't exist yet.
function withSeedNames(obj) {
  const names = (obj.chatNames && typeof obj.chatNames === "object" && !Array.isArray(obj.chatNames)) ? { ...obj.chatNames } : {};
  for (const [k, v] of Object.entries(SEED_CHAT_NAMES)) if (!(k in names)) names[k] = v;
  return { ...obj, chatNames: names };
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
