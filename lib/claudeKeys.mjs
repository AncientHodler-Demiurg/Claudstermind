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

// ===== List-editing helpers (pure — each returns a NEW array, never mutates its input) =============
// The Admin "Claude Tokens Rollup" page's add/remove/rename/reorder actions all reduce to one of these,
// then a `serializeClaudeKeys` + write. Kept separate from parse/serialize so each editing INTENT (add
// vs. rename vs. reorder) is its own small, individually testable function, matching the convention the
// rest of this codebase uses for list-editing (see wsRemoveConvSlotEntry / wsAddConvSlotEntry in app.js).

/** Append a key. Refuses a duplicate TOKEN (same rule parseClaudeKeys already enforces on load) so two
 *  rows can never silently point at the same account — the caller gets `null` back to report that. */
export function addClaudeKey(keys, token, name) {
  const list = Array.isArray(keys) ? keys : [];
  const t = String(token || "").trim();
  if (!t || list.some((k) => k.token === t)) return null;
  return [...list, { token: t, name: (name || "").trim() || ("Key " + (list.length + 1)) }];
}

/** Remove the key at `index`. Out-of-range is a no-op (returns the SAME array reference, so a caller
 *  can tell "nothing changed" apart from "removed the last remaining element" without a length check). */
export function removeClaudeKeyAt(keys, index) {
  const list = Array.isArray(keys) ? keys : [];
  if (index < 0 || index >= list.length) return list;
  return list.filter((_, i) => i !== index);
}

/** Rename the key at `index` (display name only — never the token). Out-of-range is a no-op. */
export function renameClaudeKeyAt(keys, index, name) {
  const list = Array.isArray(keys) ? keys : [];
  if (index < 0 || index >= list.length) return list;
  return list.map((k, i) => (i === index ? { ...k, name: (name || "").trim() || k.name } : k));
}

/** Replace the TOKEN at `index` — e.g. the account's OAuth token was re-minted but the slot/name/
 *  position should stay put. Refuses a duplicate of another row's token, same as addClaudeKey. */
export function replaceClaudeKeyTokenAt(keys, index, token) {
  const list = Array.isArray(keys) ? keys : [];
  const t = String(token || "").trim();
  if (index < 0 || index >= list.length || !t) return null;
  if (list.some((k, i) => i !== index && k.token === t)) return null;
  return list.map((k, i) => (i === index ? { ...k, token: t } : k));
}

/** Move the key at `from` to sit at `to` (priority order IS the array order — this is how a human
 *  re-prioritizes fallback mode: drag the preferred key to the top). Out-of-range is a no-op. */
export function reorderClaudeKey(keys, from, to) {
  const list = Array.isArray(keys) ? keys : [];
  const n = list.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
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

export const KEY_MODES = ["fallback", "equal"];

/** EQUAL-USAGE MODE: pick the key at-or-after `cursor`, wrapping, skipping any currently exhausted —
 *  this is the round-robin that spreads load across every key instead of draining one before touching
 *  the next. Returns `{ index, nextCursor }`: `nextCursor` is where the FOLLOWING pick should start
 *  (one past the one just chosen), so the rotation actually advances one-key-per-call rather than
 *  re-picking the same key from a cursor that never moved. On a genuine pick, `nextCursor` is only
 *  returned — the CALLER decides whether/when to persist it (see claudeKeyMode.mjs): advancing the
 *  cursor is a real state change and must happen exactly once per thing-that-actually-consumed-a-slot
 *  (a new session spawning), never as a side effect of merely checking status.
 *
 *  All-exhausted falls back to the same "frees up soonest" choice pickActiveKeyIndex makes — and the
 *  cursor is reported UNCHANGED in that case: nothing was actually allocated to rotate past. */
export function pickRoundRobinKeyIndex(keys, usage, now, cursor) {
  if (!Array.isArray(keys) || !keys.length) return { index: -1, nextCursor: 0 };
  const n = keys.length;
  const start = ((Number(cursor) || 0) % n + n) % n;   // normalize (handles negative/NaN/out-of-range)
  const blockedUntil = (k) => { const u = usage && usage[k.name]; return (u && u.exhaustedUntil) || 0; };
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n;
    if (blockedUntil(keys[idx]) <= now) return { index: idx, nextCursor: (idx + 1) % n };
  }
  let best = 0, bestAt = Infinity;
  keys.forEach((k, i) => { const at = blockedUntil(k); if (at < bestAt) { bestAt = at; best = i; } });
  return { index: best, nextCursor: start };   // all exhausted — nothing rotated, cursor holds its place
}

/** The one entry point both call sites (a fresh spawn, and re-checking a live session's key) should
 *  use: dispatches to fallback or round-robin by `mode`, always returning the `{ index, nextCursor }`
 *  shape so callers don't need an if/else on mode themselves. `mode` defaults to "fallback" for any
 *  unrecognized value — today's behavior if the persisted mode file is ever missing/corrupt. */
export function pickKeyIndex(keys, usage, now, mode, cursor) {
  if (mode === "equal") return pickRoundRobinKeyIndex(keys, usage, now, cursor);
  return { index: pickActiveKeyIndex(keys, usage, now), nextCursor: Number(cursor) || 0 };
}
