// Read-only filesystem access for the Pact IDE view, CONFINED to the Ouronet Pact repo.
//
// The Pact IDE's folder tree + file viewer read from the Ouronet repository on disk. Every path a
// browser sends is repo-relative and is resolved *under* the pinned root — a resolved path that
// escapes the root (via `..`, an absolute path, etc.) is refused. Nothing here writes; editing lands
// in a later phase behind a local-only + canExecute gate.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";

// The Pact repo relative to the workspace master root (…/ClaudeWS). Kept here so the server and the
// tests agree on one definition.
export function pactRoot(masterRoot) {
  return resolve(masterRoot, "OuroborosNetwork", "_onchain", "Ouronet");
}

// Directories that are noise in a source tree — hidden from the IDE tree entirely.
const SKIP = new Set([".git", "node_modules", ".next", "dist", "build", ".turbo", ".vite", ".pnpm-store", ".DS_Store"]);
// A file bigger than this isn't opened into the viewer (it would freeze the browser); the IDE shows a
// "too large" notice instead.
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Resolve a repo-relative path under `root`, or null if it escapes. Leading slashes/backslashes are
 * stripped so an absolute-looking path is still treated as repo-relative; a `..` that climbs above
 * the root resolves outside it and is rejected by the containment check.
 */
export function safeResolve(root, rel) {
  const base = resolve(root);
  const clean = String(rel || "").replace(/^[/\\]+/, "");
  const abs = resolve(base, clean);
  if (abs !== base && !abs.startsWith(base + sep)) return null;
  return abs;
}

/** One directory's immediate children (dirs first, then files, each alphabetical). Lazy — the tree
 *  expands a node by calling this for that node's path, so a huge repo never loads all at once. */
export function listDir(root, rel = "") {
  const abs = safeResolve(root, rel);
  if (!abs) return { ok: false, error: "path escapes the Pact root" };
  if (!existsSync(abs)) return { ok: false, error: "not found" };
  const base = resolve(root);
  let ents;
  try { ents = readdirSync(abs, { withFileTypes: true }); }
  catch (e) { return { ok: false, error: e.message }; }
  const items = ents
    .filter((e) => !SKIP.has(e.name))
    .map((e) => {
      const childAbs = join(abs, e.name);
      const isDir = e.isDirectory();
      let size = 0;
      if (!isDir) { try { size = statSync(childAbs).size; } catch { /* unreadable — size stays 0 */ } }
      return { name: e.name, path: relative(base, childAbs), type: isDir ? "dir" : "file", size };
    })
    .sort((a, b) => (a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name)));
  return { ok: true, dir: relative(base, abs), items };
}

/** A single text file's contents, refusing directories, over-large files, and binaries (NUL sniff).
 *  Returned as UTF-8 text for the viewer. */
export function readTextFile(root, rel) {
  const abs = safeResolve(root, rel);
  if (!abs) return { ok: false, error: "path escapes the Pact root" };
  let st;
  try { st = statSync(abs); } catch { return { ok: false, error: "not found" }; }
  if (st.isDirectory()) return { ok: false, error: "is a directory" };
  if (st.size > MAX_FILE_BYTES) return { ok: false, error: "file too large to view", size: st.size, tooLarge: true };
  let buf;
  try { buf = readFileSync(abs); } catch (e) { return { ok: false, error: e.message }; }
  if (buf.subarray(0, 8192).includes(0)) return { ok: false, error: "binary file", binary: true };
  return { ok: true, path: relative(resolve(root), abs), size: st.size, content: buf.toString("utf8") };
}

/** Write UTF-8 text back to a repo file (the IDE's Save). Repo-confined via safeResolve; refuses a
 *  directory target and content over the view cap. Behind a local-only + canExecute gate at the HTTP
 *  layer — this function itself only enforces containment + size. */
export function writeTextFile(root, rel, content) {
  const abs = safeResolve(root, rel);
  if (!abs) return { ok: false, error: "path escapes the Pact root" };
  const text = String(content == null ? "" : content);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_FILE_BYTES) return { ok: false, error: "content too large to save", size: bytes, tooLarge: true };
  try {
    if (existsSync(abs) && statSync(abs).isDirectory()) return { ok: false, error: "is a directory" };
    writeFileSync(abs, text, "utf8");
    return { ok: true, path: relative(resolve(root), abs), size: bytes };
  } catch (e) { return { ok: false, error: e.message }; }
}

