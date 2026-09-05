// Model-routing preferences: which "paths" are available and which is the default a NEW chat starts on.
//
// Two paths, by design:
//   • Direct Claude Code (Anthropic OAuth) — BUILT-IN, always on, cannot be disabled. The reliable base;
//     you can never lock yourself out of Claude.
//   • OmniRoute — optional. Enable it to surface its live catalog (your Claude abo via cc/*, plus free/other
//     models & auto/* combos) in the selector, and optionally make it the default path for new chats.
//
// This is a per-installation preference stored next to the other dashboard config (dashboard/data/routing.json,
// gitignored, not secret). Applied CLIENT-SIDE (filter the selector + pick a new chat's default model), so no
// engine restart is needed to flip it. The OmniRoute LANE still requires OMNIROUTE_KEY on the engine to
// actually route — enabling it here without a key just shows models that won't answer, so the UI should gate on
// key presence too.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_FILE = "routing.json";
export const OMNI_MODEL_PREFIX = "omni/";
// The permission modes a new chat can start in (mirrors the client's WS_MODES). "default" = ask before tools;
// "bypassPermissions" = run tools without prompting (best for long autonomous runs).
export const PERMISSION_MODES = Object.freeze(["default", "acceptEdits", "plan", "auto", "bypassPermissions"]);
export const DEFAULTS = Object.freeze({ omniEnabled: false, defaultPath: "claude", omniDefaultModel: "omni/auto", defaultPermissionMode: "default" });

export function readRoutingConfig(dataDir) {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, CONFIG_FILE), "utf8"));
    return normalizeRoutingConfig(raw);
  } catch { return { ...DEFAULTS }; }
}

/** Coerce arbitrary input into a valid config — defaultPath can only be "omni" when OmniRoute is enabled. */
export function normalizeRoutingConfig(raw = {}) {
  const omniEnabled = Boolean(raw.omniEnabled);
  let defaultPath = raw.defaultPath === "omni" ? "omni" : "claude";
  if (defaultPath === "omni" && !omniEnabled) defaultPath = "claude";   // can't default to a disabled path
  let omniDefaultModel = typeof raw.omniDefaultModel === "string" && raw.omniDefaultModel.startsWith(OMNI_MODEL_PREFIX)
    ? raw.omniDefaultModel : DEFAULTS.omniDefaultModel;
  const defaultPermissionMode = PERMISSION_MODES.includes(raw.defaultPermissionMode) ? raw.defaultPermissionMode : DEFAULTS.defaultPermissionMode;
  return { omniEnabled, defaultPath, omniDefaultModel, defaultPermissionMode };
}

export function writeRoutingConfig(dataDir, patch = {}) {
  const path = join(dataDir, CONFIG_FILE);
  // Read-merge, but NEVER merge a partial patch onto DEFAULTS just because the existing file was CORRUPT — that
  // silently resets the untouched fields. Missing file = fresh install (DEFAULTS base is correct); a present-but-
  // unparseable file → back it up and throw, so the caller reports an error rather than clobbering the config.
  let base = { ...DEFAULTS }, raw = null;
  try { raw = readFileSync(path, "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (raw != null) {
    try { base = normalizeRoutingConfig(JSON.parse(raw)); }
    catch { try { writeFileSync(path + ".corrupt.bak", raw); } catch {} throw new Error("routing.json is corrupt — refusing to overwrite (backed up to routing.json.corrupt.bak)"); }
  }
  const next = normalizeRoutingConfig({ ...base, ...patch });
  writeFileSync(path, JSON.stringify(next, null, 2));
  return next;
}

/** The model id a NEW chat should default to: null (⇒ Claude "Default") unless the default path is OmniRoute
 *  and it's enabled, in which case the configured omni default model. Pure. */
export function routingDefaultModel(cfg = DEFAULTS) {
  const c = normalizeRoutingConfig(cfg);
  return c.defaultPath === "omni" && c.omniEnabled ? c.omniDefaultModel : null;
}

/** Filter a selector catalog by the config: hide omni/* entries when OmniRoute is disabled. Pure. Direct
 *  Claude models are never touched (built-in, always available). */
export function routingFilterModels(models = [], cfg = DEFAULTS) {
  const c = normalizeRoutingConfig(cfg);
  if (c.omniEnabled) return models.slice();
  return models.filter((m) => !(m && typeof m.value === "string" && m.value.startsWith(OMNI_MODEL_PREFIX)));
}
