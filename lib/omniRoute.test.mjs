// node --test lib/omniRoute.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { omniRouteFor, omniModelChoices, fetchOmniModels, OMNI_DEFAULT_URL } from "./omniRoute.mjs";

const fakeFetch = (data) => async () => ({ ok: true, json: async () => ({ data: data.map((id) => ({ id })) }) });

test("fetchOmniModels: no key → empty", async () => {
  assert.deepEqual(await fetchOmniModels({}, { fetchImpl: fakeFetch([]) }), []);
});

test("fetchOmniModels: keeps cc/claude, auto, groq, :free; drops noise; prefixes omni/", async () => {
  const ids = ["cc/claude-opus-4-8", "auto", "auto/best-free", "groq/openai/gpt-oss-120b",
    "openrouter/z-ai/glm-5.2:free", "dva/whatever", "cfp/nvidia/x", "felo-web"];
  const r = await fetchOmniModels({ OMNIROUTE_KEY: "sk-x" }, { fetchImpl: fakeFetch(ids), ttlMs: 0, now: () => 1 });
  const vals = r.map((m) => m.value);
  assert.ok(vals.includes("omni/cc/claude-opus-4-8"));
  assert.ok(vals.includes("omni/auto"));
  assert.ok(vals.includes("omni/groq/openai/gpt-oss-120b"));
  assert.ok(vals.includes("omni/openrouter/z-ai/glm-5.2:free"));
  assert.ok(!vals.some((v) => /dva|cfp|felo-web/.test(v)), "noise providers dropped");
  assert.equal(vals[0], "omni/cc/claude-opus-4-8", "claude ranked first");
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

test("omniModelChoices: empty without a key, populated with one", () => {
  assert.deepEqual(omniModelChoices({}), []);
  const c = omniModelChoices({ OMNIROUTE_KEY: "sk-x" });
  assert.ok(c.length >= 3);
  assert.ok(c.every((m) => m.value.startsWith("omni/") && typeof m.displayName === "string"));
  assert.ok(c.some((m) => m.value === "omni/auto"));
});
