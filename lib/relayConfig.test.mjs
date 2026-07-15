// node --test lib/relayConfig.test.mjs — the local dashboard's relay (bridge) settings.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeRelayUrl, readRelayConfig, writeRelayConfig, saveDeviceSecret, readDeviceSecret } from "./relayConfig.mjs";

test("normalizeRelayUrl accepts a bare domain and builds a wss /agent url", () => {
  assert.equal(normalizeRelayUrl("brain.ancientholdings.eu"), "wss://brain.ancientholdings.eu/agent");
  assert.equal(normalizeRelayUrl("  brain.ancientholdings.eu  "), "wss://brain.ancientholdings.eu/agent");
  assert.equal(normalizeRelayUrl("https://brain.ancientholdings.eu"), "wss://brain.ancientholdings.eu/agent");
  assert.equal(normalizeRelayUrl("https://brain.ancientholdings.eu/"), "wss://brain.ancientholdings.eu/agent");
});

test("normalizeRelayUrl preserves an explicit ws(s) url and defaults its path to /agent", () => {
  assert.equal(normalizeRelayUrl("wss://brain.ancientholdings.eu/agent"), "wss://brain.ancientholdings.eu/agent");
  assert.equal(normalizeRelayUrl("wss://brain.ancientholdings.eu"), "wss://brain.ancientholdings.eu/agent");
  assert.equal(normalizeRelayUrl("ws://127.0.0.1:8092/agent"), "ws://127.0.0.1:8092/agent");
  assert.equal(normalizeRelayUrl("ws://127.0.0.1:8092"), "ws://127.0.0.1:8092/agent");
});

test("normalizeRelayUrl rejects empties/garbage", () => {
  assert.equal(normalizeRelayUrl(""), null);
  assert.equal(normalizeRelayUrl("   "), null);
  assert.equal(normalizeRelayUrl(null), null);
});

test("read/write relay config round-trips and normalizes the stored url", () => {
  const dir = mkdtempSync(join(tmpdir(), "relaycfg-")); mkdirSync(join(dir, "data"));
  const dataDir = join(dir, "data");
  assert.deepEqual(readRelayConfig(dataDir), { enabled: false, url: "" });   // defaults
  const cfg = writeRelayConfig(dataDir, { enabled: true, url: "brain.ancientholdings.eu" });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.url, "wss://brain.ancientholdings.eu/agent");
  assert.deepEqual(readRelayConfig(dataDir), { enabled: true, url: "wss://brain.ancientholdings.eu/agent" });
  // partial patch keeps the other field
  assert.equal(writeRelayConfig(dataDir, { enabled: false }).url, "wss://brain.ancientholdings.eu/agent");
  rmSync(dir, { recursive: true, force: true });
});

test("device secret saves to .secrets (mode-guarded), reads back, and enforces length", () => {
  const dir = mkdtempSync(join(tmpdir(), "relaysec-")); const secretsDir = join(dir, ".secrets"); mkdirSync(secretsDir);
  assert.equal(readDeviceSecret(secretsDir), "");                        // none yet
  assert.equal(saveDeviceSecret(secretsDir, "short").ok, false);        // too short
  const secret = "54a00e5580a7d84f3c09de1d43c592bde9d935e9a974c0db29aa8f035fce239d";
  assert.equal(saveDeviceSecret(secretsDir, secret).ok, true);
  assert.equal(readDeviceSecret(secretsDir), secret);
  assert.ok(existsSync(join(secretsDir, "relay-device-secret.txt")));
  rmSync(dir, { recursive: true, force: true });
});
