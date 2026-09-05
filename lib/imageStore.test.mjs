// lib/imageStore.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import {
  imageStoreDir,
  storeImage,
  loadImage,
  isImageRef,
  externalizeContent,
  backfillRows,
} from "./imageStore.mjs";

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "imgstore-"));
}
function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
// A deterministic non-trivial PNG-ish byte payload.
function makeBytes(seed, n = 256) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 0xff;
  return b;
}

test("imageStoreDir creates <baseDir>/_images on demand", () => {
  const base = mkTmp();
  try {
    const dir = imageStoreDir(base);
    assert.equal(dir, path.join(base, "_images"));
    assert.ok(fs.statSync(dir).isDirectory());
  } finally {
    cleanup(base);
  }
});

test("isImageRef recognizes imgref: strings only", () => {
  assert.equal(isImageRef("imgref:abc.png"), true);
  assert.equal(isImageRef("imgref:"), false);
  assert.equal(isImageRef("notaref"), false);
  assert.equal(isImageRef(123), false);
  assert.equal(isImageRef(null), false);
  assert.equal(isImageRef(undefined), false);
});

test("store -> load round-trips the exact bytes", () => {
  const base = mkTmp();
  try {
    const bytes = makeBytes(7);
    const base64Data = bytes.toString("base64");
    const stored = storeImage(base, { workspaceId: "w1", turn: 3, mediaType: "image/png", base64Data });
    assert.ok(stored);
    assert.match(stored.ref, /^imgref:[0-9a-f]{64}\.png$/);
    assert.equal(stored.mediaType, "image/png");
    assert.equal(stored.bytes, bytes.length);
    assert.equal(stored.sha, crypto.createHash("sha256").update(bytes).digest("hex"));

    const loaded = loadImage(base, stored.ref);
    assert.ok(loaded);
    assert.equal(loaded.mediaType, "image/png");
    assert.deepEqual(Buffer.from(loaded.base64Data, "base64"), bytes);
  } finally {
    cleanup(base);
  }
});

test("identical bytes dedupe to a single blob", () => {
  const base = mkTmp();
  try {
    const base64Data = makeBytes(11).toString("base64");
    const a = storeImage(base, { mediaType: "image/jpeg", base64Data });
    const b = storeImage(base, { mediaType: "image/jpeg", base64Data });
    assert.equal(a.ref, b.ref);
    const files = fs.readdirSync(imageStoreDir(base));
    assert.equal(files.length, 1);
  } finally {
    cleanup(base);
  }
});

test("loadImage returns null on missing/invalid ref", () => {
  const base = mkTmp();
  try {
    assert.equal(loadImage(base, "not-a-ref"), null);
    assert.equal(loadImage(base, "imgref:../etc/passwd.png"), null);
    const fakeSha = "0".repeat(64);
    assert.equal(loadImage(base, `imgref:${fakeSha}.png`), null); // valid form, no blob
  } finally {
    cleanup(base);
  }
});

test("externalizeContent replaces image blocks with refs and preserves text", () => {
  const base = mkTmp();
  try {
    const base64Data = makeBytes(21).toString("base64");
    const content = [
      { type: "text", text: "hello" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: base64Data } },
      { type: "text", text: "world" },
    ];
    const { content: out, moved } = externalizeContent(base, { workspaceId: "w", turn: 1 }, content);
    assert.equal(moved, 1);
    assert.deepEqual(out[0], { type: "text", text: "hello" });
    assert.equal(out[1].type, "image_ref");
    assert.ok(isImageRef(out[1].ref));
    assert.equal(out[1].mediaType, "image/png");
    assert.deepEqual(out[2], { type: "text", text: "world" });

    // ref actually loads back
    const loaded = loadImage(base, out[1].ref);
    assert.deepEqual(Buffer.from(loaded.base64Data, "base64"), Buffer.from(base64Data, "base64"));
  } finally {
    cleanup(base);
  }
});

test("externalizeContent passes strings through untouched", () => {
  const base = mkTmp();
  try {
    const r = externalizeContent(base, {}, "just a string");
    assert.equal(r.moved, 0);
    assert.equal(r.content, "just a string");
  } finally {
    cleanup(base);
  }
});

test("backfillRows frees bytes and is idempotent", () => {
  const base = mkTmp();
  try {
    const png = makeBytes(33).toString("base64");
    const gif = makeBytes(34).toString("base64");
    const rows = [
      { turn: 1, message: { role: "user", content: [
        { type: "text", text: "look" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
      ] } },
      { turn: 2, content: [
        { type: "image", source: { type: "base64", media_type: "image/gif", data: gif } },
      ] },
      { turn: 3, images: [{ media_type: "image/png", data: png }] }, // same bytes as turn 1 -> dedupe
      { turn: 4, message: { role: "assistant", content: "plain text only" } },
    ];

    const first = backfillRows(base, rows, { workspaceId: "w" });
    assert.equal(first.moved, 3);
    assert.ok(first.freedBytes > 0);

    // Verify rewrites
    assert.equal(first.rows[0].message.content[1].type, "image_ref");
    assert.equal(first.rows[1].content[0].type, "image_ref");
    assert.ok(isImageRef(first.rows[2].images[0].ref));
    assert.equal(first.rows[3].message.content, "plain text only");

    // Dedupe: png stored once, gif once -> 2 blobs
    assert.equal(fs.readdirSync(imageStoreDir(base)).length, 2);

    // Idempotent second pass moves 0
    const second = backfillRows(base, first.rows, { workspaceId: "w" });
    assert.equal(second.moved, 0);
    assert.equal(second.freedBytes, 0);
    assert.deepEqual(second.rows, first.rows);
  } finally {
    cleanup(base);
  }
});

test("malformed input does not throw", () => {
  const base = mkTmp();
  try {
    assert.equal(storeImage(base, null), null);
    assert.equal(storeImage(base, { mediaType: "image/png", base64Data: "" }), null);
    assert.equal(storeImage(base, {}), null);

    const r1 = externalizeContent(base, null, null);
    assert.equal(r1.moved, 0);

    const r2 = externalizeContent(base, {}, [
      null,
      42,
      { type: "image" }, // no source
      { type: "image", source: {} }, // no data
      { type: "text", text: "ok" },
    ]);
    assert.equal(r2.moved, 0);
    assert.equal(r2.content[4].text, "ok");

    const r3 = backfillRows(base, [null, 5, "str", {}, { message: null }, { content: "x" }], {});
    assert.equal(r3.moved, 0);

    // non-array rows
    assert.deepEqual(backfillRows(base, null, {}), { rows: null, moved: 0, freedBytes: 0 });
  } finally {
    cleanup(base);
  }
});
