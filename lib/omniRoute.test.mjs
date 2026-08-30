// node --test lib/omniRoute.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { omniRouteFor, omniModelChoices, OMNI_DEFAULT_URL } from "./omniRoute.mjs";

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
