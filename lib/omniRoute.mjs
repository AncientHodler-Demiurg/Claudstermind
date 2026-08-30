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
 *  SDK's ModelInfo enough for fillModelSelect (`value` + `displayName`). The static fallback used when the live
 *  catalog can't be fetched. */
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

// Which live-catalog ids are worth surfacing: your connected providers' useful models, not the 400+ catalog of
// unconnected/web-scraper providers. cc/claude-* (your abo through OmniRoute), auto* (self-routing), groq/*
// (fast free), and any *:free (OpenRouter free tier). Everything else is reachable via `auto` but not listed.
function keepOmniId(id) {
  return /^cc\/claude-/.test(id) || /^auto(\/|$)/.test(id) || /^groq\//.test(id) || /:free$/.test(id);
}
// Group order for a navigable dropdown: Claude first, then auto, groq, then the rest.
function omniRank(id) { return /^cc\/claude-/.test(id) ? 0 : /^auto/.test(id) ? 1 : /^groq\//.test(id) ? 2 : 3; }

let _catalogCache = { at: 0, models: null };
/**
 * Fetch OmniRoute's LIVE /v1/models and turn the useful ones into selector entries ("omni/<id>"). Cached
 * (TTL) so the engine's _models handler can call it cheaply; on any failure/timeout it falls back to the
 * static omniModelChoices so the selector never breaks. Empty without a key. Injectable for tests.
 */
export async function fetchOmniModels(env = {}, opts = {}) {
  if (!env.OMNIROUTE_KEY) return [];
  const fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
  const now = opts.now || Date.now;
  const ttlMs = opts.ttlMs ?? 300000;   // 5 min — providers/availability churn, but not second-to-second
  const cap = opts.cap ?? 200;
  const t = now();
  if (_catalogCache.models && (t - _catalogCache.at) < ttlMs) return _catalogCache.models;
  if (!fetchImpl) return omniModelChoices(env);
  try {
    const url = (env.OMNIROUTE_URL || OMNI_DEFAULT_URL).replace(/\/$/, "") + "/v1/models";
    const res = await fetchImpl(url, { headers: { authorization: "Bearer " + env.OMNIROUTE_KEY }, signal: AbortSignal.timeout(opts.timeoutMs ?? 4000) });
    if (!res || !res.ok) return _catalogCache.models || omniModelChoices(env);
    const j = await res.json();
    const ids = (Array.isArray(j?.data) ? j.data : []).map((x) => x && x.id).filter((s) => typeof s === "string");
    const keep = ids.filter(keepOmniId).sort((a, b) => omniRank(a) - omniRank(b) || a.localeCompare(b)).slice(0, cap);
    const models = keep.map((id) => ({
      value: "omni/" + id,
      displayName: "OmniRoute · " + id,
      description: /^cc\/claude-/.test(id) ? "Your Claude abo, routed through OmniRoute" : "Routed through OmniRoute — free/other model, not Claude",
      supportsEffort: false,
      supportsFastMode: false,
    }));
    if (models.length) _catalogCache = { at: t, models };
    return models.length ? models : (_catalogCache.models || omniModelChoices(env));
  } catch {
    return _catalogCache.models || omniModelChoices(env);
  }
}
