// node --test lib/modelIdentity.test.mjs
// The MODEL IDENTITY helpers live in the browser monolith (dashboard/public/app.js); we slice the
// sentinel-marked pure block and eval just that (same pattern as chatModelLabel.test.mjs).
//
// WHY THIS EXISTS: the model selector used to render the catalogue's marketing label — "Default",
// "Opus", sometimes "(recommended)" — which does not tell you which wire model you are actually
// reasoning with and being billed for. The SDK exposed the answer the whole time (ModelInfo
// `resolvedModel`) and we were dropping it on the floor in modelOptionGroups.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");
const begin = "// ===== MODEL IDENTITY — pure helpers";
const end = "// ===== end MODEL IDENTITY pure helpers =====";
const a = src.indexOf(begin), b = src.indexOf(end);
assert.ok(a >= 0 && b > a, "model-identity block markers must exist in app.js");
// chatModelReadout calls omniProviderTag, which lives in the neighbouring CHAT MODEL LABEL block.
const cb = "// ===== CHAT MODEL LABEL — pure resolved-model helpers";
const ce = "// ===== end CHAT MODEL LABEL pure helper =====";
const ca = src.indexOf(cb), cbEnd = src.indexOf(ce);
const block = src.slice(a, b + end.length) + "\n" + src.slice(ca, cbEnd + ce.length);
// eslint-disable-next-line no-new-func
const H = new Function(block + "\nreturn { modelExactId, modelShortId, modelRowLabel, modelRowTitle, resolveModelExact, chatModelReadout, modelSwitchWarning };")();

const OPUS = { value: "opus", displayName: "Opus", resolvedModel: "claude-opus-4-5-20250929", description: "Most capable" };
const DEFAULT_ROW = { value: "default", displayName: "Default (recommended)", resolvedModel: "claude-sonnet-4-5-20250929" };
const ALIAS_NO_RESOLVE = { value: "opus", displayName: "Opus" };
const EXPLICIT = { value: "claude-haiku-4-5-20251001", displayName: "claude-haiku-4-5-20251001" };

test("modelExactId prefers resolvedModel, and refuses to call a bare alias 'exact'", () => {
  assert.equal(H.modelExactId(OPUS), "claude-opus-4-5-20250929");
  assert.equal(H.modelExactId(EXPLICIT), "claude-haiku-4-5-20251001");
  // THE POINT: "opus" is a family, not a build. Answering "opus" to "which opus?" is the non-answer.
  assert.equal(H.modelExactId(ALIAS_NO_RESOLVE), "");
  assert.equal(H.modelExactId({ value: "default", displayName: "Default" }), "");
  assert.equal(H.modelExactId(null), "");
});

test("modelShortId keeps the DATE — that is the bit that distinguishes two builds", () => {
  assert.equal(H.modelShortId("claude-opus-4-5-20250929"), "opus-4-5-20250929");
  assert.equal(H.modelShortId("omni/cc/claude-sonnet-4-5"), "cc/claude-sonnet-4-5");
  assert.equal(H.modelShortId(""), "");
});

test("modelRowLabel never renders a bare 'Default' or 'Opus'", () => {
  assert.equal(H.modelRowLabel(OPUS), "Opus — opus-4-5-20250929");
  // the exact complaint: "Default (recommended)" told you nothing
  assert.equal(H.modelRowLabel(DEFAULT_ROW), "Default (recommended) — sonnet-4-5-20250929");
  // an alias the engine could not resolve says so OUT LOUD rather than pretending
  assert.equal(H.modelRowLabel(ALIAS_NO_RESOLVE), "Opus — exact model unknown");
  // no stuttering when the name already IS the id
  assert.equal(H.modelRowLabel(EXPLICIT), "claude-haiku-4-5-20251001");
});

test("modelRowTitle exposes the FULL wire id plus how it was selected", () => {
  const t = H.modelRowTitle(OPUS);
  assert.match(t, /Wire model id: claude-opus-4-5-20250929/);
  assert.match(t, /Selected as: opus/);
  assert.match(t, /Most capable/);
  assert.match(H.modelRowTitle(ALIAS_NO_RESOLVE), /ALIAS/);
});

test("resolveModelExact: the OBSERVED running model beats the catalogue", () => {
  const list = [OPUS, DEFAULT_ROW];
  // the subprocess reported what it really spawned as — that wins over any lookup
  assert.equal(H.resolveModelExact(list, "default", "claude-opus-4-5-20250929"), "claude-opus-4-5-20250929");
  // no live report yet → resolve the pick through the catalogue
  assert.equal(H.resolveModelExact(list, "opus", ""), "claude-opus-4-5-20250929");
  assert.equal(H.resolveModelExact(list, "default", ""), "claude-sonnet-4-5-20250929");
  // an ALIAS arriving as the "active" model is not an answer — fall through, don't echo it
  assert.equal(H.resolveModelExact(list, "opus", "opus"), "claude-opus-4-5-20250929");
  // unknown, uncatalogued, but explicit → pass it through rather than losing it
  assert.equal(H.resolveModelExact([], "claude-future-9", ""), "claude-future-9");
  assert.equal(H.resolveModelExact([], "default", ""), "");
});

test("chatModelReadout: exact build, and an honest 'unknown' that cannot read as a model name", () => {
  const r = H.chatModelReadout([OPUS], "opus", "claude-opus-4-5-20250929");
  assert.equal(r.text, "opus-4-5-20250929");
  assert.match(r.title, /Running exactly: claude-opus-4-5-20250929/);
  assert.match(r.title, /Direct Anthropic/);
  const unknown = H.chatModelReadout([], "default", "");
  assert.equal(unknown.text, "", "unknown must be EMPTY, never a guessed name");
  assert.match(unknown.title, /has not reported/);
  // routed models still name the account
  const routed = H.chatModelReadout([], "omni/groq/llama", "");
  assert.match(routed.text, /via OmniRoute · Groq/);
});

test("modelSwitchWarning: warns about the prompt-cache invalidation, and stays quiet when pointless", () => {
  const w = H.modelSwitchWarning("claude-opus-4-5-20250929", "claude-opus-5-20260101", 104183);
  assert.match(w, /opus-4-5-20250929 → opus-5-20260101/);
  assert.match(w, /invalidates this conversation's prompt cache/);
  assert.match(w, /104,183 tokens/);
  assert.match(w, /The switch still applies/, "must not imply the switch was blocked");
  // same model, or nothing to compare → no noise
  assert.equal(H.modelSwitchWarning("claude-opus-5", "claude-opus-5", 10), null);
  assert.equal(H.modelSwitchWarning("", "claude-opus-5", 10), null);
  assert.equal(H.modelSwitchWarning("claude-opus-4-5", "", 10), null);
  // unknown token count → still warns, just without a fabricated number
  const noTok = H.modelSwitchWarning("claude-a", "claude-b", null);
  assert.match(noTok, /context gets re-read/);
  assert.doesNotMatch(noTok, /~/);
});
