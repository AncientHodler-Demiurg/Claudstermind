// The LocalHost dashboard's Relay settings: where the online relay lives, and whether
// the bridge is on. This is what lets you point the local machine at the live website
// from the dashboard UI instead of hand-setting env vars.
//
// Two pieces, deliberately separate:
//   - config (enabled + url)  → dashboard/data/relay.json  (gitignored; not secret)
//   - device secret           → .secrets/relay-device-secret.txt  (0600, never shown)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_FILE = "relay.json";
const SECRET_FILE = "relay-device-secret.txt";
const DEFAULTS = { enabled: false, url: "" };

/**
 * Turn whatever the user typed into a canonical `ws(s)://host[:port]/agent` URL.
 *   - a bare host ("brain.ancientholdings.eu") or an https:// url → wss://host/agent
 *   - an explicit ws:// / wss:// url is preserved, its path defaulted to /agent
 * @returns {string|null} null for empty/garbage input.
 */
export function normalizeRelayUrl(input) {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s) return null;
  if (/^wss?:\/\//i.test(s)) {
    try { const u = new URL(s); if (!u.pathname || u.pathname === "/") u.pathname = "/agent"; return u.toString(); }
    catch { return null; }
  }
  const host = s.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim();
  if (!host) return null;
  return `wss://${host}/agent`;
}

export function readRelayConfig(dataDir) {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, CONFIG_FILE), "utf8"));
    return { enabled: Boolean(raw.enabled), url: typeof raw.url === "string" ? raw.url : "" };
  } catch { return { ...DEFAULTS }; }
}

/** Merge a partial update; a supplied url is normalized before storage. */
export function writeRelayConfig(dataDir, patch = {}) {
  const cur = readRelayConfig(dataDir);
  const next = { ...cur };
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  if (typeof patch.url === "string") next.url = normalizeRelayUrl(patch.url) || "";
  writeFileSync(join(dataDir, CONFIG_FILE), JSON.stringify(next, null, 2));
  return next;
}

export function deviceSecretPath(secretsDir) { return join(secretsDir, SECRET_FILE); }

export function readDeviceSecret(secretsDir) {
  try { return readFileSync(deviceSecretPath(secretsDir), "utf8").trim(); } catch { return ""; }
}

/** Persist the device secret (0600). Never returned or logged by callers. */
export function saveDeviceSecret(secretsDir, value) {
  if (typeof value !== "string" || value.trim().length < 32) {
    return { ok: false, message: "The device secret must be at least 32 characters (it must match the relay's AGENT_DEVICE_SECRET)." };
  }
  try { writeFileSync(deviceSecretPath(secretsDir), value.trim() + "\n", { mode: 0o600 }); return { ok: true }; }
  catch (e) { return { ok: false, message: `Could not save the device secret: ${e.message}` }; }
}
