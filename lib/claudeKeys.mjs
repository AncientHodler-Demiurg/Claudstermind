// lib/claudeKeys.mjs — the OAuth key store. Holds ONE OR MORE claude.ai subscription tokens, each
// optionally NAMED, so the workspace can carry several accounts and fail over between them when one's
// 5-hour / weekly usage runs out. Storage is a simple CSV-ish file, `token ; name` per line.
//
// Files (under .secrets/):
//   • claude-oauth-keys.csv   — the multi-key store (new). One key per line: `token ; name`.
//   • claude-oauth-token.txt  — the legacy single-token file (still honored as one unnamed key).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const KEYS_FILE = "claude-oauth-keys.csv";
export const TOKEN_FILE = "claude-oauth-token.txt";

/** Parse the key store text. One key per line: `token ; name` — separator `;` or `,`, name OPTIONAL.
 *  `#` comments and blank lines are skipped; a bare token line (the legacy .txt shape) is accepted too.
 *  Tokens are de-duplicated (first wins) so an accidental repeat can't create a phantom account; a
 *  missing name defaults to `Key N`. Pure — no I/O, so it's unit-testable. */
export function parseClaudeKeys(text) {
  const out = [], seen = new Set();
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const si = line.indexOf(";"), ci = line.indexOf(",");
    const sep = si >= 0 ? si : ci;   // prefer `;`; fall back to `,`
    let token, name;
    if (sep >= 0) { token = line.slice(0, sep).trim(); name = line.slice(sep + 1).trim(); }
    else { token = line; name = ""; }
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push({ token, name: name || ("Key " + (out.length + 1)) });
  }
  return out;
}

/** Serialize a key list back to the CSV store text (round-trips parseClaudeKeys). A header comment is
 *  written so a human editing the file knows the format. */
export function serializeClaudeKeys(keys) {
  const header = "# Claude OAuth keys — one per line: <token> ; <name>. Blank lines and #comments ignored.\n";
  return header + (keys || []).map((k) => `${k.token} ; ${k.name || ""}`).join("\n") + "\n";
}

/** Read the key store from `secretsDir`: the new CSV file if present, else the legacy single-token file
 *  (as one key named "Key 1"), else []. */
export function readClaudeKeys(secretsDir) {
  try { if (existsSync(join(secretsDir, KEYS_FILE))) return parseClaudeKeys(readFileSync(join(secretsDir, KEYS_FILE), "utf8")); } catch { /* unreadable → fall through */ }
  try { const t = readFileSync(join(secretsDir, TOKEN_FILE), "utf8").trim(); if (t) return [{ token: t, name: "Key 1" }]; } catch { /* none */ }
  return [];
}

/** A display-only fingerprint of a token — enough to tell keys apart in the UI, NEVER the raw secret. */
export function keyFingerprint(token) {
  const t = String(token || "");
  if (t.length <= 14) return "…" + t.slice(-4);
  return t.slice(0, 10) + "…" + t.slice(-4);
}

/** From a usage_EXPERIMENTAL `rate_limits` payload, is this key's account exhausted, and until when?
 *  Exhausted = the 5-hour OR 7-day rolling window is at/over 100% utilization. `until` is the LATEST
 *  reset among the exhausted windows (the key is unusable until every blocked window has reset). Pure. */
export function usageExhaustion(rateLimits) {
  if (!rateLimits) return { exhausted: false, until: null };
  const at = (x) => (x && x.resets_at) ? new Date(x.resets_at).getTime() : null;
  const over = (x) => x && typeof x.utilization === "number" && x.utilization >= 100;
  const untils = [];
  if (over(rateLimits.five_hour)) untils.push(at(rateLimits.five_hour));
  if (over(rateLimits.seven_day)) untils.push(at(rateLimits.seven_day));
  const real = untils.filter((v) => v != null);
  if (!untils.length) return { exhausted: false, until: null };
  return { exhausted: true, until: real.length ? Math.max(...real) : null };
}

/** Pick the active key index: the FIRST key not currently exhausted (this is the automatic fall-through
 *  to the next line when one's 5h/weekly limit runs out). `usage` maps key name → { exhaustedUntil }.
 *  If every key is exhausted, return the one that frees up soonest (least bad). -1 for an empty list. */
export function pickActiveKeyIndex(keys, usage, now) {
  if (!Array.isArray(keys) || !keys.length) return -1;
  const blockedUntil = (k) => { const u = usage && usage[k.name]; return (u && u.exhaustedUntil) || 0; };
  const free = keys.findIndex((k) => blockedUntil(k) <= now);
  if (free >= 0) return free;
  let best = 0, bestAt = Infinity;
  keys.forEach((k, i) => { const at = blockedUntil(k); if (at < bestAt) { bestAt = at; best = i; } });
  return best;
}
