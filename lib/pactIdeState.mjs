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
import { workspaceId, workspaceDir } from "./storage.mjs";

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
  return join(workspaceDir(transcriptDir, PACT_WORKSPACE_ID), IDE_STATE_FILE);
}

/** The raw stored blob with no seed-name merge — what's actually on disk right now, `{}` if absent,
 *  unreadable, corrupt, or not a plain object. Never throws. Used both by readIdeState (below) and by
 *  writeIdeState's own pre-write read (the merge guard needs the CURRENT truth, not the seeded view). */
function readRawIdeState(transcriptDir) {
  if (!transcriptDir) return {};
  try {
    const parsed = JSON.parse(readFileSync(ideStatePath(transcriptDir), "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch { /* missing / corrupt / not-an-object — fall through to {} */ }
  return {};
}

/** The saved IDE state, or `{}` when it's absent, unreadable, corrupt, or not a plain object — a
 *  fresh default view must ALWAYS be recoverable, so this never throws. Returns a plain object. */
export function readIdeState(transcriptDir) {
  return withSeedNames(readRawIdeState(transcriptDir));
}

// ===== PACT IDE-STATE FOREIGN-TAB GUARD — pure helper (sliced for lib/pactIdeState.test.mjs) =====
// THE BUG: the ide-state blob is ONE shared file across every device/browser-tab viewing the Pact
// workspace, written with a blind full-replace PUT. Two clients open at once — one that just created
// a second/third chat tab, and an older one that has been sitting open since BEFORE those tabs
// existed — both eventually PUT their own `chat.tabs` snapshot (any keystroke, drag, or periodic
// resync triggers a save). The older client's snapshot still only has ONE tab, and since a PUT is a
// full replace, writing it OVERWRITES the richer file straight back down to one tab — silently
// discarding real, live conversations with no "× closed" anywhere in the trail. (Caught live: a
// workspace's `_ide-state.json` was directly observed going from 3 tabs — Master, Chat 2, Explorer —
// to 1 — Master only — between two reads taken two minutes apart, with no deliberate close in
// between. Matches the user's report: "if i have two chats opened on pact workspace, and i reload
// the page, only the master chat is kept, the other one is closed.")
//
// THE FIX must tell "I never heard of this tab" (an older client — protect it) apart from "I heard of
// this tab and deliberately closed it" (any client, any time — a real close must still work). Only the
// writer itself knows which tabs it has ever seen, so it sends `knownKeys` — every tab key its own
// restore/creation flow has ever shown it. A tab key that exists on disk right now but is in NEITHER
// the incoming tabs NOR `knownKeys` can only mean "created by some other client since I last synced" —
// never a deliberate close, because closing requires having seen the tab first (which would put its key
// in knownKeys). Such a tab is spliced back onto the END of the incoming list (never auto-selected —
// activeIndex is recomputed to keep pointing at the tab the writer actually meant to focus).
/** `knownKeys` must be an array (or any iterable) of tab keys; anything else (including `undefined`)
 *  is treated as empty — so EVERY tab missing from `incoming` looks foreign and gets protected. Pure;
 *  never throws. Whether this guard runs AT ALL for a given write is writeIdeState's call, not this
 *  function's — see its own doc comment for why an explicitly-absent `knownKeys` must skip the guard
 *  entirely rather than call this with an empty Set. */
export function mergeForeignTabs(current, incoming, knownKeys) {
  const incomingTabs = Array.isArray(incoming && incoming.chat && incoming.chat.tabs) ? incoming.chat.tabs : null;
  const currentTabs = Array.isArray(current && current.chat && current.chat.tabs) ? current.chat.tabs : null;
  if (!incomingTabs || !currentTabs) return { state: incoming, merged: false, recoveredTabs: [] };
  let known;
  try { known = new Set(Array.from(knownKeys || []).filter((k) => typeof k === "string")); } catch { known = new Set(); }
  const incomingKeys = new Set(incomingTabs.map((t) => t && t.key).filter(Boolean));
  const foreign = currentTabs.filter((t) => t && typeof t.key === "string" && !incomingKeys.has(t.key) && !known.has(t.key));
  if (!foreign.length) return { state: incoming, merged: false, recoveredTabs: [] };
  const ai = Number.isInteger(incoming.chat.activeIndex) ? incoming.chat.activeIndex : 0;
  const activeKey = incomingTabs[ai] ? incomingTabs[ai].key : null;
  const tabs = [...incomingTabs, ...foreign];
  const foundIdx = activeKey ? tabs.findIndex((t) => t && t.key === activeKey) : -1;
  const activeIndex = foundIdx >= 0 ? foundIdx : ai;
  return { state: { ...incoming, chat: { ...incoming.chat, tabs, activeIndex } }, merged: true, recoveredTabs: foreign };
}
// ===== end PACT IDE-STATE FOREIGN-TAB GUARD pure helper =====

// Merge the pre-seeded chat names into a state blob's `chatNames`, without clobbering a name the user
// already set. Applied on every read so a seed shows even when the store file doesn't exist yet.
function withSeedNames(obj) {
  const names = (obj.chatNames && typeof obj.chatNames === "object" && !Array.isArray(obj.chatNames)) ? { ...obj.chatNames } : {};
  for (const [k, v] of Object.entries(SEED_CHAT_NAMES)) if (!(k in names)) names[k] = v;
  return { ...obj, chatNames: names };
}

/** Persist the opaque layout blob the frontend authored. Guards, mirroring pactFs.writeTextFile's
 *  shape: object-only, serialisable, under the size cap; the workspace dir is created if absent.
 *
 *  `opts.knownKeys`, when an ARRAY (an explicit, up-to-date writer), arms the foreign-tab guard above:
 *  any chat tab currently on disk that this write would otherwise drop, and that isn't in knownKeys
 *  either, survives the write instead of being silently discarded. When `opts.knownKeys` is omitted
 *  entirely (every writer before this fix, and anything that hasn't picked up the matching frontend
 *  change yet), the guard is skipped outright — a plain full-replace, byte-for-byte the pre-fix
 *  behaviour — rather than running it with an empty Set, which would make it treat every missing tab
 *  as foreign and block every ordinary, correct tab close until every open client reloads.
 *
 *  Returns `{ ok, size, merged, recoveredTabs }` (merged/recoveredTabs only meaningfully set when the
 *  guard actually recovered something) or `{ ok: false, error }` — never throws. */
export function writeIdeState(transcriptDir, state, opts = {}) {
  if (!transcriptDir) return { ok: false, error: "no transcript dir" };
  if (!state || typeof state !== "object" || Array.isArray(state)) return { ok: false, error: "state must be an object" };
  let toWrite = state, merged = false, recoveredTabs = [];
  if (Array.isArray(opts.knownKeys)) {
    const current = readRawIdeState(transcriptDir);
    const m = mergeForeignTabs(current, state, opts.knownKeys);
    toWrite = m.state; merged = m.merged; recoveredTabs = m.recoveredTabs;
  }
  let text; try { text = JSON.stringify(toWrite); } catch (e) { return { ok: false, error: "unserialisable state: " + e.message }; }
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_IDE_STATE_BYTES) return { ok: false, error: "state too large to save", size: bytes, tooLarge: true };
  try {
    const dir = workspaceDir(transcriptDir, PACT_WORKSPACE_ID);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(ideStatePath(transcriptDir), text, "utf8");
    return { ok: true, size: bytes, merged, recoveredTabs };
  } catch (e) { return { ok: false, error: e.message }; }
}
