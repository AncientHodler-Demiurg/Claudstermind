// Tests for lib/codeGraphSchema.mjs — Ch.3.1's {nodes, edges} schema, confidence tags, and the
// validate-before-build gate.

import test from "node:test";
import assert from "node:assert/strict";
import { validateNode, validateEdge, validateBatch, NODE_TYPES, EDGE_KINDS, CONFIDENCE_TAGS } from "./codeGraphSchema.mjs";

test("validateNode: requires id and a known type", () => {
  assert.equal(validateNode({ id: "file:a.js", type: "file" }).ok, true);
  assert.equal(validateNode({ id: "", type: "file" }).ok, false);
  assert.equal(validateNode({ type: "file" }).ok, false, "missing id");
  assert.equal(validateNode({ id: "a" }).ok, false, "missing type");
  assert.equal(validateNode({ id: "a", type: "widget" }).ok, false, "unknown type");
  assert.equal(validateNode(null).ok, false);
  assert.equal(validateNode([]).ok, false);
  assert.equal(validateNode("a").ok, false);
});

test("validateNode: accepts every documented node type, and only those", () => {
  for (const type of NODE_TYPES) assert.equal(validateNode({ id: "x", type }).ok, true, type);
  assert.deepEqual(NODE_TYPES, ["file", "function", "class", "module", "concept"]);
});

test("validateNode: optional metadata (path/name/lines) never required", () => {
  const r = validateNode({ id: "function:a.js#foo", type: "function", name: "foo", path: "a.js", startLine: 1, endLine: 3 });
  assert.equal(r.ok, true);
});

test("validateEdge: requires source, target, a known kind, and a confidence tag — confidence is never defaulted", () => {
  assert.equal(validateEdge({ source: "a", target: "b", kind: "calls", confidence: "EXTRACTED" }).ok, true);
  assert.equal(validateEdge({ source: "a", target: "b", kind: "calls" }).ok, false, "missing confidence");
  assert.equal(validateEdge({ source: "a", target: "b", confidence: "EXTRACTED" }).ok, false, "missing kind");
  assert.equal(validateEdge({ target: "b", kind: "calls", confidence: "EXTRACTED" }).ok, false, "missing source");
  assert.equal(validateEdge({ source: "a", kind: "calls", confidence: "EXTRACTED" }).ok, false, "missing target");
  assert.equal(validateEdge({ source: "a", target: "b", kind: "calls", confidence: "SURE" }).ok, false, "unknown confidence value");
  assert.equal(validateEdge({ source: "a", target: "b", kind: "flies", confidence: "EXTRACTED" }).ok, false, "unknown kind");
  assert.equal(validateEdge(null).ok, false);
});

test("validateEdge: accepts every documented edge kind and confidence tag", () => {
  for (const kind of EDGE_KINDS) {
    for (const confidence of CONFIDENCE_TAGS) {
      assert.equal(validateEdge({ source: "a", target: "b", kind, confidence }).ok, true, `${kind}/${confidence}`);
    }
  }
  assert.deepEqual(EDGE_KINDS, ["contains", "imports", "calls"]);
  assert.deepEqual(CONFIDENCE_TAGS, ["EXTRACTED", "INFERRED", "AMBIGUOUS"]);
});

test("validateBatch: a fully valid batch passes, with empty per-entry error arrays", () => {
  const batch = {
    nodes: [{ id: "file:a.js", type: "file" }, { id: "function:a.js#foo", type: "function" }],
    edges: [{ source: "file:a.js", target: "function:a.js#foo", kind: "contains", confidence: "EXTRACTED" }],
  };
  const r = validateBatch(batch);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.nodeErrors, [[], []]);
  assert.deepEqual(r.edgeErrors, [[]]);
});

test("validateBatch: ALL-OR-NOTHING — one bad node or edge fails the WHOLE batch, never a partial accept", () => {
  const batch = {
    nodes: [{ id: "file:a.js", type: "file" }, { id: "", type: "function" }],   // second node invalid
    edges: [{ source: "file:a.js", target: "x", kind: "contains", confidence: "EXTRACTED" }],
  };
  const r = validateBatch(batch);
  assert.equal(r.ok, false);
  assert.equal(r.nodeErrors[0].length, 0);
  assert.ok(r.nodeErrors[1].length > 0, "the actually-bad node's errors are reported, aligned by index");
  assert.equal(r.edgeErrors[0].length, 0, "the valid edge is still reported as valid — this is diagnostic, not a short-circuit");
});

test("validateBatch: missing nodes/edges arrays entirely is also a rejection, not a crash", () => {
  assert.equal(validateBatch({}).ok, false);
  assert.equal(validateBatch({ nodes: [] }).ok, false, "edges missing");
  assert.equal(validateBatch(null).ok, false);
  assert.deepEqual(validateBatch({ nodes: [], edges: [] }), { ok: true, errors: [], nodeErrors: [], edgeErrors: [] });
});

test("validateBatch: an edge referencing a node id not present in THIS batch is still schema-valid — cross-batch refs are a build-time concern, not a schema one", () => {
  const batch = {
    nodes: [{ id: "file:a.js", type: "file" }],
    edges: [{ source: "file:a.js", target: "file:b.js", kind: "imports", confidence: "EXTRACTED" }],
  };
  assert.equal(validateBatch(batch).ok, true);
});
