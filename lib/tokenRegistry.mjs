// The token registry: a single, organised model of every token you hold.
//
// Two ideas kept deliberately separate:
//   • the REGISTRY (data/tokens.json, gitignored) — metadata ONLY: name, entity
//     (github/npm), kind, scope (account/org/repo), expiry, where to manage it, and
//     which local file holds its value. Never a value.
//   • the STORE (.secrets/<file>.txt at the workspace root) — the actual values, one
//     file per token, in one place for the whole workspace.
//
// The dashboard reads the registry, checks which store files exist (present/missing —
// it never reads a value), computes expiry status, and groups everything by
// entity × scope so you can see where each token lives at a glance.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Days until expiry, or null when the token never expires. */
function daysUntil(expires, today) {
  if (!expires) return null;
  const ms = new Date(expires + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime();
  return Math.round(ms / 86_400_000);
}

/** Classify expiry into a status the UI colours. */
export function expiryStatus(expires, today, warnDays = 30) {
  if (!expires) return { status: "none", daysLeft: null };
  const d = daysUntil(expires, today);
  if (d < 0) return { status: "expired", daysLeft: d };
  if (d <= warnDays) return { status: "expiring", daysLeft: d };
  return { status: "active", daysLeft: d };
}

export function readRegistry(dataDir) {
  try { return JSON.parse(readFileSync(join(dataDir, "tokens.json"), "utf8")); }
  catch { return { tokens: [] }; }
}

/** Enrich each token with store presence + expiry status (values never touched). */
export function enrich(tokens, secretsDir, today) {
  return (tokens || []).map((t) => ({
    ...t,
    ...expiryStatus(t.expires, today),
    stored: t.secretFile ? existsSync(join(secretsDir, t.secretFile)) : null,
  }));
}

/** Group enriched tokens as entity → scope → [tokens], in a stable order. */
export function groupTokens(tokens) {
  const entities = ["github", "npm"];
  const scopes = ["account", "org", "repo"];
  const out = {};
  for (const e of entities) {
    out[e] = {};
    for (const s of scopes) {
      out[e][s] = tokens
        .filter((t) => (t.entity || "github") === e && (t.scope || "account") === s)
        .sort((a, b) => (a.target || "").localeCompare(b.target || "") || (a.label || a.id).localeCompare(b.label || b.id));
    }
  }
  return out;
}

/** Rollup counts for the header. */
export function tokenTotals(tokens) {
  const by = (s) => tokens.filter((t) => t.status === s).length;
  return {
    total: tokens.length,
    expired: by("expired"),
    expiring: by("expiring"),
    active: by("active"),
    stored: tokens.filter((t) => t.stored === true).length,
    missing: tokens.filter((t) => t.secretFile && t.stored === false).length,
  };
}

// A store filename must be a plain `<name>.txt` — no directories, no traversal.
const SAFE_FILE = /^[A-Za-z0-9._-]+\.txt$/;
export function isSafeSecretFile(name) {
  return typeof name === "string" && SAFE_FILE.test(name) && !name.includes("..");
}

/**
 * Save a token value into .secrets/<file>. Only files DECLARED in the registry may be
 * written — you can renew a known token, not create an arbitrary file. The value is
 * written and never returned or logged by callers.
 * @returns {ok, file} or {ok:false, message}
 */
export function saveSecret(secretsDir, dataDir, file, value) {
  if (!isSafeSecretFile(file)) return { ok: false, message: "Invalid secret filename." };
  const declared = new Set((readRegistry(dataDir).tokens || []).map((t) => t.secretFile).filter(Boolean));
  if (!declared.has(file)) return { ok: false, message: `"${file}" is not a registered token file.` };
  if (typeof value !== "string" || !value.trim()) return { ok: false, message: "Empty token value." };
  try {
    writeFileSync(join(secretsDir, file), value.trim() + "\n", { mode: 0o600 });
    return { ok: true, file };
  } catch (e) { return { ok: false, message: `Could not write ${file}: ${e.message}` }; }
}
