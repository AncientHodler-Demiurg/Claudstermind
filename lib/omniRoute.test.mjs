// node --test lib/omniRoute.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { omniRouteFor, omniModelChoices, fetchOmniModels, OMNI_DEFAULT_URL } from "./omniRoute.mjs";

const fakeFetch = (data) => async () => ({ ok: true, json: async () => ({ data: data.map((id) => ({ id })) }) });

test("fetchOmniModels: no key → empty", async () => {
  assert.deepEqual(await fetchOmniModels({}, { fetchImpl: fakeFetch([]) }), []);
});

test("fetchOmniModels: curated combos + every connected account's individual models; drops bare auto, effort variants, unknown-provider noise", async () => {
  const ids = ["cc/claude-opus-4-8", "cc/claude-opus-4-8-high", "auto", "auto/best-free", "auto/best-coding",
    "groq/openai/gpt-oss-120b", "groq/whisper-large-v3", "openrouter/z-ai/glm-5.2:free", "cursor/gpt-5", "kimi/k2",
    "dva/whatever", "cfp/nvidia/x", "felo-web"];
  const r = await fetchOmniModels({ OMNIROUTE_KEY: "sk-x" }, { fetchImpl: fakeFetch(ids), ttlMs: 0, now: () => 1 });
  const vals = r.map((m) => m.value);
  assert.ok(vals.includes("omni/cc/claude-opus-4-8"));
  assert.ok(vals.includes("omni/auto/best-coding"), "curated combo kept");
  assert.ok(vals.includes("omni/groq/openai/gpt-oss-120b"));
  assert.ok(!vals.includes("omni/auto"), "bare auto dropped — only curated combos");
  assert.ok(vals.includes("omni/openrouter/z-ai/glm-5.2:free"), ":free tail now kept — the 'more models' list is meant to show everything exposed, for testing what actually works");
  assert.ok(vals.includes("omni/cursor/gpt-5"), "Cursor account's individual models are surfaced (previously silently dropped — no branch for `cursor/*` existed at all)");
  assert.ok(vals.includes("omni/kimi/k2"), "Kimi account's individual models are surfaced");
  assert.ok(!vals.some((v) => /-high$/.test(v)), "effort-tier variants dropped (CM owns effort)");
  assert.ok(!vals.some((v) => /whisper/.test(v)), "groq audio models dropped");
  assert.ok(!vals.some((v) => /dva|cfp|felo-web/.test(v)), "unrecognized-provider noise still dropped");
  assert.equal(vals[0], "omni/auto/best-coding", "curated combos ranked first (best-coding before best-free)");
  const claude = r.find((m) => m.value === "omni/cc/claude-opus-4-8");
  assert.equal(claude.providerLabel, "Claude");
  assert.equal(claude.account, "bica.mihai.g");
  assert.equal(claude.displayName, "Claude · opus-4-8");
  assert.equal(claude.combo, false, "an individual model is not a combo");
  const combo = r.find((m) => m.value === "omni/auto/best-coding");
  assert.equal(combo.combo, true, "a curated combo is tagged combo:true — the selector's default OmniRoute view uses this to hide the individual-model flood");
});

test("fetchOmniModels: fetch failure → static fallback (non-empty with key)", async () => {
  const r = await fetchOmniModels({ OMNIROUTE_KEY: "sk-x" }, { fetchImpl: async () => { throw new Error("down"); }, ttlMs: 0, now: () => 2 });
  assert.ok(r.length >= 1 && r.every((m) => m.value.startsWith("omni/")));
});

test("omniRouteFor: omni/ model + key → routing bundle (default url)", () => {
  const r = omniRouteFor("omni/auto", { OMNIROUTE_KEY: "sk-x" });
  assert.deepEqual(r, { baseUrl: OMNI_DEFAULT_URL, authToken: "sk-x", model: "auto" });
});

test("omniRouteFor: keeps the full id incl. slashes/colons", () => {
  const r = omniRouteFor("omni/z-ai/glm-5.2:free", { OMNIROUTE_KEY: "sk-x", OMNIROUTE_URL: "http://host:20128" });
  assert.equal(r.model, "z-ai/glm-5.2:free");
  assert.equal(r.baseUrl, "http://host:20128");
});

test("omniRouteFor: no key → null (falls back to Claude)", () => {
  assert.equal(omniRouteFor("omni/auto", {}), null);
});

test("omniRouteFor: non-omni model → null", () => {
  assert.equal(omniRouteFor("claude-opus-4-1", { OMNIROUTE_KEY: "sk-x" }), null);
  assert.equal(omniRouteFor(undefined, { OMNIROUTE_KEY: "sk-x" }), null);
  assert.equal(omniRouteFor("omni/", { OMNIROUTE_KEY: "sk-x" }), null);   // prefix only, no id
});

test("omniModelChoices: empty without a key, combos with one", () => {
  assert.deepEqual(omniModelChoices({}), []);
  const c = omniModelChoices({ OMNIROUTE_KEY: "sk-x" });
  assert.ok(c.length >= 3);
  assert.ok(c.every((m) => m.value.startsWith("omni/") && typeof m.displayName === "string" && typeof m.providerLabel === "string" && m.combo === true));
  assert.ok(c.some((m) => m.value === "omni/auto/best-coding"));
});
