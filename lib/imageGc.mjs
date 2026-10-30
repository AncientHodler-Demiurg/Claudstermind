// imageGc.mjs — Wave 0.1 (ROADMAP-2.0.md 4.13): a reference-counted sweep for orphaned image
// blobs. `workspaceStore.saveImage` writes content-addressed bytes to
// `<workspace>/images/<sha256-24>.<ext>` and nothing has ever deleted them: `deleteSession`
// removed only a conversation's JSONL, so deleting a chat orphaned its images, and a roll/wrap
// never touched them either. Content-addressing limited the damage (the same picture pasted
// twice is stored once) but the store grew monotonically forever.
//
// An image is DEAD iff no live transcript row and no archived-segment row references its hash —
// "live" here means every session .jsonl file still sitting in the workspace's own directory
// (there can be more than one — a Core pane's own file plus any number of Pact-tab conversations,
// all sharing that ONE workspace's `images/` directory) PLUS every row ever archived to that same
// workspace's `_segments/` (lib/conversationArchive.mjs). Checking both is what makes "referenced
// by two live sessions sharing a dir survives deleting one of them" and "referenced by an
// archived segment survives" both true by construction, not by a special case.
//
// `computeImageGc` is PURE — no disk access, takes rows/hashes already read, unit-testable
// without a filesystem. `sweepImages` is the impure driver: it does the actual reading (of a
// workspace's own live session files + its archive, via conversationArchive.readAllArchivedRows)
// and the actual deleting. It operates on ONE workspace's own directory at a time and never
// reaches outside it — the "never remove on a false negative" guarantee is structural: a hash is
// only ever compared against references gathered from that exact same directory's own sessions
// and archive, nothing borrowed or assumed from elsewhere.
//
// ESM, node builtins only. Never throws.

import fs from "node:fs";
import path from "node:path";
import { readAllArchivedRows } from "./conversationArchive.mjs";
import { IMAGES_SUBDIR } from "./storage.mjs";

// Exactly the shape workspaceStore.saveImage ever produces (see its own IMAGE_PATH_RE) — a
// 24-hex-char sha256 prefix followed by one of the three accepted extensions.
const IMAGE_FILE_RE = /^([0-9a-f]{24})\.(png|jpg|webp)$/;

/**
 * computeImageGc({ liveRows, archivedRows, existingHashes }) → { dead: string[], live: Set<string> }
 *
 * `liveRows`/`archivedRows` — arrays of transcript rows (each optionally carrying an
 * `images: [{ hash, ... }]` array, exactly the shape `conversationWindow`/`conversationArchive`
 * rows use). `existingHashes` — every hash actually present on disk right now (an iterable of
 * strings). `dead` = `existingHashes` minus every hash referenced by `liveRows` or `archivedRows`.
 * Pure, deterministic, never throws.
 */
export function computeImageGc(opts) {
  const { liveRows, archivedRows, existingHashes } = opts && typeof opts === "object" ? opts : {};
  const live = new Set();
  const collect = (rows) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || !Array.isArray(row.images)) continue;
      for (const im of row.images) {
        if (im && typeof im.hash === "string" && im.hash) live.add(im.hash);
      }
    }
  };
  collect(liveRows);
  collect(archivedRows);

  const existing = existingHashes && typeof existingHashes[Symbol.iterator] === "function"
    ? Array.from(existingHashes)
    : [];
  const dead = existing.filter((h) => typeof h === "string" && h && !live.has(h));
  return { dead, live };
}

// Every row of every `.jsonl` file directly inside `wsDir` (NOT recursive — a workspace
// directory's own session files live flat at its top level; `_segments/`, `images/`, and
// `documents/` are subdirectories, never `.jsonl` files themselves, so nothing here needs to
// exclude them by name). One corrupt line is skipped, never fatal to the rest.
function readLiveWorkspaceRows(wsDir) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(wsDir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith(".jsonl")) continue;
    let raw = "";
    try { raw = fs.readFileSync(path.join(wsDir, ent.name), "utf8"); } catch { continue; }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { out.push(JSON.parse(trimmed)); } catch { /* skip corrupt line */ }
    }
  }
  return out;
}

/**
 * sweepImages(wsDir) → { deleted: string[], kept: number, error?: string }
 *
 * `wsDir` is a WORKSPACE'S OWN directory (i.e. `storage.workspaceDir(transcriptDir, workspaceId)` —
 * exactly what `workspaceStore.saveImage`/`deleteSession` already resolve to), not the transcript
 * root. Reads every live session file + the full archive under `wsDir`, computes which of the
 * hashes actually present in `wsDir/images/` are unreferenced, and deletes those. `deleted` lists
 * the hashes actually removed (best-effort per file — one failed delete doesn't abort the rest);
 * `kept` is how many image files remain. A missing `images/` directory (nothing ever attached) is
 * not an error — just nothing to do. Never throws.
 */
export function sweepImages(wsDir) {
  try {
    if (!wsDir) return { deleted: [], kept: 0, error: "missing workspace directory" };
    const imagesDir = path.join(String(wsDir), IMAGES_SUBDIR);
    if (!fs.existsSync(imagesDir)) return { deleted: [], kept: 0 };

    const fileByHash = new Map();
    let files = [];
    try { files = fs.readdirSync(imagesDir); } catch { files = []; }
    for (const f of files) {
      const m = IMAGE_FILE_RE.exec(f);
      if (m) fileByHash.set(m[1], f);
    }
    if (!fileByHash.size) return { deleted: [], kept: 0 };

    const liveRows = readLiveWorkspaceRows(wsDir);
    const archivedRows = readAllArchivedRows(wsDir);
    const { dead } = computeImageGc({ liveRows, archivedRows, existingHashes: fileByHash.keys() });

    const deleted = [];
    for (const hash of dead) {
      const file = fileByHash.get(hash);
      if (!file) continue;
      try {
        fs.rmSync(path.join(imagesDir, file));
        deleted.push(hash);
      } catch { /* best effort — one failed delete must not abort the rest */ }
    }
    return { deleted, kept: fileByHash.size - deleted.length };
  } catch {
    return { deleted: [], kept: 0, error: "sweep failed" };
  }
}
