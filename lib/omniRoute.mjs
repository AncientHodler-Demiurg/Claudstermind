// OmniRoute integration — let a session run a NON-Claude model through the local OmniRoute gateway
// (OpenRouter free tiers, etc.) instead of Anthropic. Claude Code honours ANTHROPIC_BASE_URL +
// ANTHROPIC_AUTH_TOKEN, and OmniRoute exposes an Anthropic-compatible /v1/messages surface — so pointing
// a spawned `claude` at OmniRoute with the gateway key routes that session's turns to the chosen model.
// Proven end-to-end (the real claude binary completed a turn via OmniRoute on a free model).
//
// Convention: a model id of the form "omni/<omniroute-model-id>" means "route through OmniRoute". The rest
// after the first "omni/" is the OmniRoute model id verbatim (which itself may contain "/" and ":", e.g.
// "omni/z-ai/glm-5.2:free" → OmniRoute model "z-ai/glm-5.2:free"; "omni/auto" → "auto").
//
// Config comes from the engine's own environment (set OMNIROUTE_KEY + optional OMNIROUTE_URL on the sessiond
// service). No key configured ⇒ the feature is simply absent (no omni models offered, no routing).

export const OMNI_PREFIX = "omni/";
export const OMNI_DEFAULT_URL = "http://127.0.0.1:20128";

/**
 * If `model` names an OmniRoute model AND a gateway key is configured in `env`, return the routing bundle to
 * apply at spawn: { baseUrl, authToken, model }. Otherwise null (normal Claude/Anthropic path). Pure.
 */
export function omniRouteFor(model, env = {}) {
  if (typeof model !== "string" || !model.startsWith(OMNI_PREFIX)) return null;
  const key = env.OMNIROUTE_KEY;
  if (!key) return null;                                   // no key ⇒ can't route; caller falls back to Claude
  const id = model.slice(OMNI_PREFIX.length).trim();
  if (!id) return null;
  return { baseUrl: env.OMNIROUTE_URL || OMNI_DEFAULT_URL, authToken: key, model: id };
}

// A small curated set surfaced in the model selector when OmniRoute is configured. Deliberately short — the
// gateway exposes 400+ ids, but a giant dropdown helps nobody. `auto` is the safe default (routes to whatever
// free provider is healthy); the rest are decent free picks for cheap/experimental turns. Labelled so nobody
// mistakes them for Claude.
const OMNI_CHOICES = [
  { id: "omni/auto", name: "OmniRoute · auto (free)" },
  { id: "omni/auto/best-free", name: "OmniRoute · best-free" },
  { id: "omni/z-ai/glm-5.2:free", name: "OmniRoute · GLM-5.2 (free)" },
  { id: "omni/minimax/minimax-m3:free", name: "OmniRoute · MiniMax-M3 (free)" },
  { id: "omni/openrouter/free", name: "OmniRoute · OpenRouter free-router" },
];

/** Selector entries to append to the live model catalog — empty unless OMNIROUTE_KEY is set. Shape matches the
 *  SDK's ModelInfo enough for fillModelSelect (`value` + `displayName`). */
export function omniModelChoices(env = {}) {
  if (!env.OMNIROUTE_KEY) return [];
  return OMNI_CHOICES.map((c) => ({
    value: c.id,
    displayName: c.name,
    description: "Routed through OmniRoute — free/experimental model, NOT Claude. Best for cheap drafts/chat.",
    supportsEffort: false,
    supportsFastMode: false,
  }));
}
