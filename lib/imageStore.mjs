// lib/imageStore.mjs
//
// Externalized image store for the Agentic Chat Engine (docs/AGENTIC-CHAT-ENGINE.md §2).
//
// Uploaded images are the dominant cost in large transcripts: inline base64 image
// blocks bloat the append-only log (a 164 MB / 47k-row thread was mostly inline
// base64). This module moves image bytes OUT of the transcript into content-addressed
// blob files on disk and leaves a lightweight reference behind, so the transcript
// grows only from text.
//
// Content-addressing (sha256 of the raw bytes) makes dedupe free: identical images
// collapse to a single blob no matter how many turns reference them.
//
// ESM, Node builtins only. Guarded: never throws on a malformed row — skips it.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const REF_PREFIX = "imgref:";

// Minimal, explicit media-type <-> extension mapping. Falls back to "bin".
const MEDIA_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/tiff": "tiff",
  "image/x-icon": "ico",
  "image/avif": "avif",
  "image/heic": "heic",
};
const EXT_TO_MEDIA = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  tiff: "image/tiff",
  ico: "image/x-icon",
  avif: "image/avif",
  heic: "image/heic",
  bin: "application/octet-stream",
};

function extForMedia(mediaType) {
  const key = String(mediaType || "").toLowerCase().trim();
  return MEDIA_TO_EXT[key] || "bin";
}

function mediaForExt(ext) {
  const key = String(ext || "").toLowerCase().trim();
  return EXT_TO_MEDIA[key] || "application/octet-stream";
}

/**
 * The images subdir for a given base dir. Created on demand.
 * @param {string} baseDir
 * @returns {string} e.g. `<baseDir>/_images`
 */
export function imageStoreDir(baseDir) {
  const dir = path.join(String(baseDir), "_images");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * True if `x` is an `imgref:` reference string.
 * @param {*} x
 * @returns {boolean}
 */
export function isImageRef(x) {
  return typeof x === "string" && x.startsWith(REF_PREFIX) && x.length > REF_PREFIX.length;
}

// Parse an "imgref:<sha>.<ext>" into { sha, ext } or null.
function parseRef(ref) {
  if (!isImageRef(ref)) return null;
  const body = ref.slice(REF_PREFIX.length); // "<sha>.<ext>"
  const dot = body.lastIndexOf(".");
  if (dot <= 0 || dot >= body.length - 1) return null;
  const sha = body.slice(0, dot);
  const ext = body.slice(dot + 1);
  // sha must look like a hex digest; guard against path traversal / junk.
  if (!/^[0-9a-f]{64}$/.test(sha)) return null;
  if (!/^[0-9a-z]+$/.test(ext)) return null;
  return { sha, ext };
}

/**
 * Store decoded image bytes as a content-addressed blob. Idempotent: identical
 * bytes map to the same blob and are not rewritten.
 * @param {string} baseDir
 * @param {{workspaceId?:string, turn?:number, mediaType:string, base64Data:string}} spec
 * @returns {{ref:string, mediaType:string, bytes:number, sha:string}|null} null on invalid input
 */
export function storeImage(baseDir, spec) {
  try {
    if (!spec || typeof spec !== "object") return null;
    const { mediaType, base64Data } = spec;
    if (typeof base64Data !== "string" || base64Data.length === 0) return null;

    const buf = Buffer.from(base64Data, "base64");
    if (buf.length === 0) return null;

    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    const ext = extForMedia(mediaType);
    const ref = `${REF_PREFIX}${sha}.${ext}`;

    const dir = imageStoreDir(baseDir);
    const blobPath = path.join(dir, `${sha}.${ext}`);

    // Idempotent: only write if the blob is missing or the wrong size.
    let needWrite = true;
    try {
      const st = fs.statSync(blobPath);
      if (st.isFile() && st.size === buf.length) needWrite = false;
    } catch {
      needWrite = true;
    }
    if (needWrite) fs.writeFileSync(blobPath, buf);

    return { ref, mediaType: mediaForExt(ext), bytes: buf.length, sha };
  } catch {
    return null;
  }
}

/**
 * Load a stored blob back into a base64 image payload.
 * @param {string} baseDir
 * @param {string} ref an `imgref:<sha>.<ext>` string
 * @returns {{mediaType:string, base64Data:string}|null} null if missing/invalid
 */
export function loadImage(baseDir, ref) {
  try {
    const parsed = parseRef(ref);
    if (!parsed) return null;
    const dir = path.join(String(baseDir), "_images");
    const blobPath = path.join(dir, `${parsed.sha}.${parsed.ext}`);
    const buf = fs.readFileSync(blobPath);
    return { mediaType: mediaForExt(parsed.ext), base64Data: buf.toString("base64") };
  } catch {
    return null;
  }
}

// Is this a content block object of the given type?
function isBlock(b, type) {
  return b && typeof b === "object" && b.type === type;
}

// Extract an inline base64 image from a block, if present.
// Supports the Anthropic block shape { type:"image", source:{ type:"base64", media_type, data } }.
function inlineImageOf(block) {
  if (!isBlock(block, "image")) return null;
  const src = block.source;
  if (!src || typeof src !== "object") return null;
  if (src.type !== "base64") return null;
  if (typeof src.data !== "string" || src.data.length === 0) return null;
  return { mediaType: src.media_type, base64Data: src.data };
}

/**
 * Rewrite a message `content` (string or array of blocks), replacing each inline
 * base64 image block with a lightweight reference block
 * `{ type:"image_ref", ref, mediaType }`. Text is left untouched. Blob writes are
 * the only side effect.
 * @param {string} baseDir
 * @param {{workspaceId?:string, turn?:number}} ctx
 * @param {*} content string | Array<block>
 * @returns {{content:*, moved:number}}
 */
export function externalizeContent(baseDir, ctx, content) {
  const context = ctx && typeof ctx === "object" ? ctx : {};
  // Strings and non-arrays carry no inline images — pass through untouched.
  if (!Array.isArray(content)) return { content, moved: 0 };

  let moved = 0;
  const out = new Array(content.length);
  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    try {
      const img = inlineImageOf(block);
      if (img) {
        const stored = storeImage(baseDir, {
          workspaceId: context.workspaceId,
          turn: context.turn,
          mediaType: img.mediaType,
          base64Data: img.base64Data,
        });
        if (stored) {
          out[i] = { type: "image_ref", ref: stored.ref, mediaType: stored.mediaType };
          moved++;
          continue;
        }
      }
      out[i] = block; // text / unknown / failed-store: leave as-is
    } catch {
      out[i] = block; // never throw on a malformed block
    }
  }
  return { content: out, moved };
}

// Estimate the on-disk cost of an inline base64 payload (the decoded byte count,
// which is what externalizing actually removes from the growing transcript).
function inlineBytes(base64Data) {
  try {
    return Buffer.byteLength(String(base64Data), "base64");
  } catch {
    return 0;
  }
}

// Externalize the `.images` array shape: [{ media_type|mediaType, data|base64Data }, ...]
function externalizeImagesArray(baseDir, ctx, images) {
  if (!Array.isArray(images)) return { images, moved: 0, freedBytes: 0 };
  let moved = 0;
  let freedBytes = 0;
  const out = new Array(images.length);
  for (let i = 0; i < images.length; i++) {
    const im = images[i];
    try {
      if (im && typeof im === "object" && !isImageRef(im.ref)) {
        const base64Data = typeof im.data === "string" ? im.data : im.base64Data;
        const mediaType = im.media_type || im.mediaType;
        if (typeof base64Data === "string" && base64Data.length > 0) {
          const bytes = inlineBytes(base64Data);
          const stored = storeImage(baseDir, {
            workspaceId: ctx.workspaceId,
            turn: ctx.turn,
            mediaType,
            base64Data,
          });
          if (stored) {
            out[i] = { ref: stored.ref, mediaType: stored.mediaType };
            moved++;
            freedBytes += bytes;
            continue;
          }
        }
      }
      out[i] = im;
    } catch {
      out[i] = im;
    }
  }
  return { images: out, moved, freedBytes };
}

// Count decoded bytes of inline base64 images inside a content array (pre-rewrite).
function contentInlineBytes(content) {
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const block of content) {
    try {
      const img = inlineImageOf(block);
      if (img) total += inlineBytes(img.base64Data);
    } catch {
      // skip
    }
  }
  return total;
}

/**
 * Walk an array of transcript rows and externalize every inline base64 image found
 * in `.message.content`, `.content`, or `.images`. Non-destructive to non-image
 * data. Idempotent: rows already externalized move 0 on a second pass.
 * @param {string} baseDir
 * @param {Array<object>} rows
 * @param {{workspaceId?:string}} opts
 * @returns {{rows:Array<object>, moved:number, freedBytes:number}}
 */
export function backfillRows(baseDir, rows, opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  if (!Array.isArray(rows)) return { rows, moved: 0, freedBytes: 0 };

  let moved = 0;
  let freedBytes = 0;
  const out = new Array(rows.length);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== "object") {
      out[i] = row; // preserve malformed entries verbatim
      continue;
    }
    const ctx = { workspaceId: options.workspaceId, turn: row.turn };
    let next = row;
    let rowClonedFor = null; // lazily shallow-clone before mutating

    const ensureClone = () => {
      if (next === row) next = { ...row };
      return next;
    };

    try {
      // 1) row.message.content
      if (row.message && typeof row.message === "object" && Array.isArray(row.message.content)) {
        const before = contentInlineBytes(row.message.content);
        const r = externalizeContent(baseDir, ctx, row.message.content);
        if (r.moved > 0) {
          const clone = ensureClone();
          clone.message = { ...row.message, content: r.content };
          moved += r.moved;
          freedBytes += before;
          rowClonedFor = "message";
        }
      }

      // 2) row.content (only if not the same object as message.content already handled)
      if (
        Array.isArray(row.content) &&
        !(rowClonedFor === "message" && row.message && row.message.content === row.content)
      ) {
        const before = contentInlineBytes(row.content);
        const r = externalizeContent(baseDir, ctx, row.content);
        if (r.moved > 0) {
          const clone = ensureClone();
          clone.content = r.content;
          moved += r.moved;
          freedBytes += before;
        }
      }

      // 3) row.images
      if (Array.isArray(row.images)) {
        const r = externalizeImagesArray(baseDir, ctx, row.images);
        if (r.moved > 0) {
          const clone = ensureClone();
          clone.images = r.images;
          moved += r.moved;
          freedBytes += r.freedBytes;
        }
      }
    } catch {
      next = row; // never throw on a malformed row; keep it as-is
    }

    out[i] = next;
  }

  return { rows: out, moved, freedBytes };
}
