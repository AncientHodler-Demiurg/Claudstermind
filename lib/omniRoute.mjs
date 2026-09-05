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

// Built-in virtual combos worth surfacing (OmniRoute ships ~38 `auto/*`; these are the useful ones). A combo
// routes, per request, to the best CONNECTED provider that is HEALTHY RIGHT NOW for that category — self-healing,
// so it's the "just works" pick and the answer to "only show models that work". Order here = dropdown order.
const OMNI_COMBOS = [
  ["auto/best-coding", "Auto · best coding"],
  ["auto/best-reasoning", "Auto · best reasoning"],
  ["auto/best-chat", "Auto · best chat"],
  ["auto/best-fast", "Auto · best fast"],
  ["auto/best-vision", "Auto · best vision"],
  ["auto/best-free", "Auto · best free"],
  ["auto/cheap", "Auto · cheap"],
  ["auto/smart", "Auto · smart"],
  ["auto/claude-opus", "Auto · Claude Opus"],
  ["auto/claude-sonnet", "Auto · Claude Sonnet"],
];
const OMNI_COMBO_SET = new Set(OMNI_COMBOS.map((c) => c[0]));
const OMNI_COMBO_RANK = new Map(OMNI_COMBOS.map((c, i) => [c[0], i]));

/** Provider identity for an OmniRoute model id, derived from its prefix. Mirrors your 5 connected accounts:
 *  claude(bica.mihai.g) · cursor · groq(main) · kimi-coding · openrouter(OmniRouteMain). `auto/*` is dynamic —
 *  the concrete provider is chosen per request (surfaced live in the `x-omniroute-provider` response header). */
export function omniProviderOf(id) {
  const raw = String(id || "").replace(/^omni\//, "");
  if (/^auto(\/|$)/.test(raw)) return { key: "auto", label: "Auto", account: "best available" };
  if (/^cc\/claude-/.test(raw)) return { key: "claude", label: "Claude", account: "bica.mihai.g" };
  if (/^groq\//.test(raw)) return { key: "groq", label: "Groq", account: "main" };
  if (/^cursor\//.test(raw)) return { key: "cursor", label: "Cursor", account: "cursor" };
  if (/^(kimi|moonshot|km)\//.test(raw)) return { key: "kimi", label: "Kimi", account: "kimi-coding" };
  if (/:free$/.test(raw) || /^openrouter\//.test(raw)) return { key: "openrouter", label: "OpenRouter", account: "OmniRouteMain" };
  return { key: "omni", label: "OmniRoute", account: "" };
}

/** Friendly dropdown label for an OmniRoute id: "<Provider> · <short model>", combos get their curated name. */
export function omniDisplayName(id) {
  if (OMNI_COMBO_SET.has(id)) return OMNI_COMBOS[OMNI_COMBO_RANK.get(id)][1];
  const p = omniProviderOf(id);
  const short = String(id).replace(/^cc\//, "").replace(/^groq\//, "").replace(/^claude-/, "").replace(/:free$/, "");
  return p.label + " · " + short;
}

// Static fallback for the selector when the live catalog can't be fetched: the combos only (always valid,
// self-healing). Labelled so nobody mistakes them for a pinned Claude model.
const OMNI_CHOICES = OMNI_COMBOS.map((c) => ({ id: "omni/" + c[0], name: c[1] }));

/** Selector entries to append to the live model catalog — empty unless OMNIROUTE_KEY is set. Shape matches the
 *  SDK's ModelInfo enough for fillModelSelect (`value` + `displayName`). The static fallback used when the live
 *  catalog can't be fetched. */
export function omniModelChoices(env = {}) {
  if (!env.OMNIROUTE_KEY) return [];
  return OMNI_CHOICES.map((c) => {
    const p = omniProviderOf(c.id);
    return {
      value: c.id,
      displayName: c.name,
      provider: p.key, providerLabel: p.label, account: p.account,
      combo: true,   // the selector's default OmniRoute view — see `combo` on fetchOmniModels's entries
      description: "Built-in OmniRoute combo — auto-routes to the best connected provider that is healthy right now.",
      supportsEffort: false,
      supportsFastMode: false,
    };
  });
}

// Which live-catalog ids are worth surfacing at all: the curated `auto/*` combos (self-healing) plus every
// individual model from a CONNECTED account — claude(bica.mihai.g) via cc/*, groq(main), cursor, kimi-coding,
// openrouter(OmniRouteMain) — mirrors omniProviderOf's 5 accounts. Individual models are NOT meant for the
// selector's default view (that's `combo`, below) — they exist so the "more models" expansion and the model
// test box can see (and test) the FULL exposed catalog, unfiltered by curation. We still drop true non-chat
// noise (audio/moderation) and unrecognized provider prefixes (neither a combo nor a known connected account).
function keepOmniId(id) {
  if (/^auto(\/|$)/.test(id)) return OMNI_COMBO_SET.has(id);   // only the curated combos, not all ~38
  if (/^cc\/claude-/.test(id)) return !/-(none|low|medium|high|xhigh)$/.test(id);   // base models only — CM owns effort
  if (/^groq\//.test(id)) return !/whisper|tts|guard/.test(id);   // chat models only — drop audio/moderation
  if (/^cursor\//.test(id)) return true;   // your Cursor account — surfaced in full; "more models" is exactly where an unvetted 220-model catalog belongs
  if (/^(kimi|moonshot|km)\//.test(id)) return true;   // your Kimi account
  return /^openrouter\//.test(id) || /:free$/.test(id);   // OpenRouter — paid AND the free tail; `auto/best-free` stays the curated "just works" pick, this is for testing individually
}
// Group order for a navigable dropdown: combos first (the "just works" picks), then Claude, Groq, Cursor, Kimi, OpenRouter.
function omniRank(id) {
  if (OMNI_COMBO_SET.has(id)) return OMNI_COMBO_RANK.get(id);        // 0..N-1, preserves curated combo order
  return /^cc\/claude-/.test(id) ? 100 : /^groq\//.test(id) ? 200 : /^cursor\//.test(id) ? 300 : /^(kimi|moonshot|km)\//.test(id) ? 400 : 500;
}

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
  const cap = opts.cap ?? 500;   // wide enough for a single connected account's full catalog (e.g. Cursor's ~220) plus the rest, now that individual models are surfaced too — see keepOmniId
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
    const models = keep.map((id) => {
      const p = omniProviderOf(id);
      return {
        value: "omni/" + id,
        displayName: omniDisplayName(id),
        provider: p.key, providerLabel: p.label, account: p.account,
        combo: OMNI_COMBO_SET.has(id),   // the selector's default OmniRoute view shows combo:true only; the rest is the "more models" expansion
        description: p.key === "auto"
          ? "Built-in OmniRoute combo — auto-routes to the best " + id.replace(/^auto\//, "").replace(/-/g, " ") + " provider that is healthy right now."
          : p.key === "claude"
            ? "Your Claude abo (" + p.account + "), routed through OmniRoute"
            : p.label + " (" + p.account + "), routed through OmniRoute — NOT Claude",
        supportsEffort: false,
        supportsFastMode: false,
      };
    });
    if (models.length) _catalogCache = { at: t, models };
    return models.length ? models : (_catalogCache.models || omniModelChoices(env));
  } catch {
    return _catalogCache.models || omniModelChoices(env);
  }
}
