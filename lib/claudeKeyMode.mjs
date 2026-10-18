// lib/claudeKeyMode.mjs — the PERSISTED choice between the two OAuth key-selection modes
// (fallback | equal), plus the equal-mode rotation cursor, read directly by the ENGINE.
//
// This deliberately does NOT live in dashboard/data/routing.json the way other admin settings do:
// routing.json is applied CLIENT-SIDE only (see lib/routing.mjs's own header) — WorkspaceManager is
// constructed without a dataDir and never reads it. Key SELECTION happens entirely inside the engine
// (lib/workspace.mjs's _activeKey/_pickKeyForSpawn), so the mode has to be something the engine itself
// can read, survive a restart, and react to live via a control message — not something only the
// browser knows about. `secretsDir` is already wired into every WorkspaceManager (it's where the keys
// themselves live), so this file rides alongside them rather than requiring a second constructor wire.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { KEY_MODES } from "./claudeKeys.mjs";

export const KEY_MODE_FILE = "claude-key-mode.json";

/** `{ mode: "fallback"|"equal", cursor: non-negative int }`. Missing/corrupt/unrecognized → the safe
 *  default (fallback, cursor 0) — today's only behavior, so a machine that never configured this gets
 *  byte-identical selection to before this feature existed. */
export function readKeyMode(secretsDir) {
  try {
    if (!existsSync(join(secretsDir, KEY_MODE_FILE))) return { mode: "fallback", cursor: 0 };
    const raw = JSON.parse(readFileSync(join(secretsDir, KEY_MODE_FILE), "utf8"));
    const mode = KEY_MODES.includes(raw && raw.mode) ? raw.mode : "fallback";
    const cursor = Number.isInteger(raw && raw.cursor) && raw.cursor >= 0 ? raw.cursor : 0;
    return { mode, cursor };
  } catch { return { mode: "fallback", cursor: 0 }; }
}

/** Write back `{ mode, cursor }`, validating both the same way the reader does so a bad in-memory
 *  value (a future bug upstream) can never corrupt the file into something `readKeyMode` would then
 *  also reject on the NEXT restart — self-healing on write, not just on read. `0o600`: same secrecy
 *  posture as the keys file it sits beside (this file holds no token, but the mode is still something
 *  only this machine's operator should be able to flip). */
export function writeKeyMode(secretsDir, { mode, cursor } = {}) {
  const safe = { mode: KEY_MODES.includes(mode) ? mode : "fallback", cursor: Number.isInteger(cursor) && cursor >= 0 ? cursor : 0 };
  writeFileSync(join(secretsDir, KEY_MODE_FILE), JSON.stringify(safe, null, 2) + "\n", { mode: 0o600 });
  return safe;
}
