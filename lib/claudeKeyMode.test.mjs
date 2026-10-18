// node --test lib/claudeKeyMode.test.mjs — the persisted fallback⇄equal mode choice + rotation cursor.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readKeyMode, writeKeyMode, KEY_MODE_FILE } from "./claudeKeyMode.mjs";

function tmpSecrets() {
  const dir = mkdtempSync(join(tmpdir(), "keymode-"));
  const sec = join(dir, ".secrets"); mkdirSync(sec);
  return { dir, sec };
}

test("readKeyMode: no file yet → the safe default (fallback, cursor 0) — byte-identical to pre-feature behavior", () => {
  const { dir, sec } = tmpSecrets();
  assert.deepEqual(readKeyMode(sec), { mode: "fallback", cursor: 0 });
  rmSync(dir, { recursive: true, force: true });
});

test("writeKeyMode then readKeyMode round-trips", () => {
  const { dir, sec } = tmpSecrets();
  const written = writeKeyMode(sec, { mode: "equal", cursor: 2 });
  assert.deepEqual(written, { mode: "equal", cursor: 2 });
  assert.deepEqual(readKeyMode(sec), { mode: "equal", cursor: 2 });
  rmSync(dir, { recursive: true, force: true });
});

test("writeKeyMode is written 0o600 — same secrecy posture as the keys file it sits beside", () => {
  const { dir, sec } = tmpSecrets();
  writeKeyMode(sec, { mode: "fallback", cursor: 0 });
  const path = join(sec, KEY_MODE_FILE);
  assert.ok(existsSync(path));
  const mode = statSync(path).mode & 0o777;
  assert.equal(mode, 0o600);
  rmSync(dir, { recursive: true, force: true });
});

test("readKeyMode: an unrecognized mode string in the file is rejected back to fallback", () => {
  const { dir, sec } = tmpSecrets();
  writeFileSync(join(sec, KEY_MODE_FILE), JSON.stringify({ mode: "yolo", cursor: 3 }));
  assert.deepEqual(readKeyMode(sec), { mode: "fallback", cursor: 3 }, "bad mode rejected, but a valid cursor is still honored");
  rmSync(dir, { recursive: true, force: true });
});

test("readKeyMode: a negative or non-integer cursor in the file is rejected back to 0", () => {
  const { dir, sec } = tmpSecrets();
  writeFileSync(join(sec, KEY_MODE_FILE), JSON.stringify({ mode: "equal", cursor: -5 }));
  assert.deepEqual(readKeyMode(sec), { mode: "equal", cursor: 0 });
  writeFileSync(join(sec, KEY_MODE_FILE), JSON.stringify({ mode: "equal", cursor: "3" }));
  assert.deepEqual(readKeyMode(sec), { mode: "equal", cursor: 0 }, "a stringified number is still not an integer — rejected, not coerced");
  rmSync(dir, { recursive: true, force: true });
});

test("readKeyMode: corrupt JSON or an unreadable file is swallowed, not thrown — falls back to default", () => {
  const { dir, sec } = tmpSecrets();
  writeFileSync(join(sec, KEY_MODE_FILE), "{ not json");
  assert.deepEqual(readKeyMode(sec), { mode: "fallback", cursor: 0 });
  rmSync(dir, { recursive: true, force: true });
});

test("writeKeyMode self-heals a bad in-memory value the same way the reader would reject it on the next restart", () => {
  const { dir, sec } = tmpSecrets();
  const written = writeKeyMode(sec, { mode: "bogus", cursor: -1 });
  assert.deepEqual(written, { mode: "fallback", cursor: 0 });
  assert.deepEqual(readKeyMode(sec), { mode: "fallback", cursor: 0 }, "what got persisted is exactly what a restart would read back");
  rmSync(dir, { recursive: true, force: true });
});
