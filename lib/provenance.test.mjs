// Tests for lib/provenance.mjs — the shared write/read contract for "where did this brain entry
// come from", used identically by lib/knowledgeStore.mjs and lib/skillStore.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProvenance, provenanceOf } from "./provenance.mjs";

test("normalizeProvenance accepts a valid shape, trims conversationId, floors turnNumber/at", () => {
  const p = normalizeProvenance({ conversationId: "  c1  ", turnKind: "prompt", turnNumber: 3.9, at: 1700000000123.7 });
  assert.deepEqual(p, { conversationId: "c1", turnKind: "prompt", turnNumber: 3, at: 1700000000123 });
});

test("normalizeProvenance omits `at` gracefully — nullable, not required", () => {
  const p = normalizeProvenance({ conversationId: "c1", turnKind: "response", turnNumber: 1 });
  assert.deepEqual(p, { conversationId: "c1", turnKind: "response", turnNumber: 1, at: null });
});

test("normalizeProvenance rejects every invalid shape, never throws", () => {
  assert.equal(normalizeProvenance({}), null, "nothing at all");
  assert.equal(normalizeProvenance({ conversationId: "", turnKind: "prompt", turnNumber: 1 }), null, "blank conversationId");
  assert.equal(normalizeProvenance({ conversationId: "  ", turnKind: "prompt", turnNumber: 1 }), null, "whitespace-only conversationId");
  assert.equal(normalizeProvenance({ conversationId: "c1", turnKind: "bogus", turnNumber: 1 }), null, "invalid turnKind");
  assert.equal(normalizeProvenance({ conversationId: "c1", turnNumber: 1 }), null, "missing turnKind");
  assert.equal(normalizeProvenance({ conversationId: "c1", turnKind: "prompt", turnNumber: 0 }), null, "turnNumber below 1");
  assert.equal(normalizeProvenance({ conversationId: "c1", turnKind: "prompt", turnNumber: NaN }), null, "NaN turnNumber");
  assert.equal(normalizeProvenance({ conversationId: "c1", turnKind: "prompt" }), null, "missing turnNumber entirely");
  assert.equal(normalizeProvenance(null), null);
  assert.equal(normalizeProvenance(undefined), null);
  assert.equal(normalizeProvenance("not an object"), null);
});

test("provenanceOf mirrors normalizeProvenance on the READ side, over an already-persisted row shape", () => {
  const row = { id: 42, conversationId: "c1", turnKind: "prompt", turnNumber: 5, at: 1700000000000, text: "irrelevant extra field" };
  assert.deepEqual(provenanceOf(row), { conversationId: "c1", turnKind: "prompt", turnNumber: 5, at: 1700000000000 });
});

test("provenanceOf handles a row with no `at` (nullable) and rejects junk", () => {
  assert.deepEqual(
    provenanceOf({ conversationId: "c1", turnKind: "response", turnNumber: 2 }),
    { conversationId: "c1", turnKind: "response", turnNumber: 2, at: null },
  );
  assert.equal(provenanceOf({}), null);
  assert.equal(provenanceOf({ conversationId: "c1" }), null, "missing turnKind/turnNumber");
  assert.equal(provenanceOf(null), null);
  assert.equal(provenanceOf(undefined), null);
  assert.equal(provenanceOf(42), null);
});
