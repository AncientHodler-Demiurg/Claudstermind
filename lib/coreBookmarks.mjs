// Server-side store for the Core cockpit's response bookmarks, so a ★ set on one device shows on every
// device. Like the Pact IDE-state (lib/pactIdeState.mjs), the source of truth lives on the WORK MACHINE —
// localStorage can't sync two origins (localhost + remote website). One JSON file beside the conversation
// history holds the whole map:
//
//     .claude/workspace/_core-bookmarks.json   →   { "<workspaceId>": [<responseAt>, …], … }
//
// Keyed by workspaceId (repo@worktree — the conversation identity), each value is the list of bookmarked
// response `at` timestamps. Object-only, size-capped, never throws (a missing/corrupt file just reads as no
// bookmarks). Node builtins only; runs the same under the local dashboard and, tunnelled, under the bridge.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CORE_BOOKMARKS_FILE = "_core-bookmarks.json";
// The whole map is a few `at` numbers per conversation — a few KB even for heavy use. 512 KB bounds a
// runaway/hostile write with orders of magnitude of headroom.
export const MAX_CORE_BOOKMARKS_BYTES = 512 * 1024;

const filePath = (dir) => join(dir, CORE_BOOKMARKS_FILE);

/** Keep only string keys → arrays of finite numbers (deduped); drop empty lists. Pure. */
export function sanitizeBookmarkMap(map) {
  const out = {};
  if (!map || typeof map !== "object" || Array.isArray(map)) return out;
  for (const [k, v] of Object.entries(map)) {
    if (typeof k !== "string" || !k || !Array.isArray(v)) continue;
    const nums = [...new Set(v.filter((x) => typeof x === "number" && Number.isFinite(x)))];
    if (nums.length) out[k] = nums;
  }
  return out;
}

/** The whole { workspaceId: number[] } map, or `{}` when absent/corrupt/not-an-object. Never throws. */
export function readCoreBookmarks(dir) {
  if (!dir) return {};
  try { return sanitizeBookmarkMap(JSON.parse(readFileSync(filePath(dir), "utf8"))); }
  catch { return {}; }
}

/** Set ONE workspace's bookmark list (an empty/absent list deletes the key). Returns `{ ok, map }` or
 *  `{ ok:false, error }` — never throws. The dir is created if absent. */
export function setCoreBookmarks(dir, workspaceId, list) {
  if (!dir) return { ok: false, error: "no dir" };
  if (typeof workspaceId !== "string" || !workspaceId) return { ok: false, error: "workspaceId required" };
  // Read the base map, distinguishing MISSING (fine — start fresh) from CORRUPT (an existing file that won't
  // parse). A corrupt base must NOT be treated as {} here: a single-workspace update written onto {} would
  // silently DROP every other workspace's bookmarks. Back it up and refuse instead. (readCoreBookmarks still
  // returns {} on corrupt for read-only/display callers — only this WRITER path needs the distinction.)
  let map = {};
  let raw = null;
  try { raw = readFileSync(filePath(dir), "utf8"); } catch (e) { if (e.code !== "ENOENT") return { ok: false, error: e.message }; }
  if (raw != null) {
    try { map = sanitizeBookmarkMap(JSON.parse(raw)); }
    catch { try { writeFileSync(filePath(dir) + ".corrupt.bak", raw); } catch {} return { ok: false, error: "bookmark store is corrupt — refusing to overwrite (backed up to .corrupt.bak)", corrupt: true }; }
  }
  const nums = Array.isArray(list) ? [...new Set(list.filter((x) => typeof x === "number" && Number.isFinite(x)))] : [];
  if (nums.length) map[workspaceId] = nums; else delete map[workspaceId];
  let text; try { text = JSON.stringify(map); } catch (e) { return { ok: false, error: "unserialisable: " + e.message }; }
  if (Buffer.byteLength(text, "utf8") > MAX_CORE_BOOKMARKS_BYTES) return { ok: false, error: "bookmark store too large", tooLarge: true };
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath(dir), text, "utf8");
    return { ok: true, map };
  } catch (e) { return { ok: false, error: e.message }; }
}
