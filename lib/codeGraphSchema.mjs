// codeGraphSchema.mjs — Ch.3.1, the {nodes, edges} schema + confidence tags + the real
// "validate before build" gate. Written design doc: docs/work/exocortex/code-graph-schema.md.
//
// Pipeline shape (detect -> extract -> build -> cluster -> analyze -> report -> export), the
// node-type vocabulary (file | function | class | module | concept), and the confidence-tag idea
// itself are all borrowed from Graphify, per docs/work/exocortex/HANDOFF.md — Graphify's own scar
// (a `_GO_PREDECLARED_FUNCS` blocklist born from treating every extracted edge as equally
// certain) is exactly why `confidence` is REQUIRED on every edge here, never defaulted.
//
// ESM. Every exported function is pure and never throws — a malformed input produces a
// `{ok:false, errors:[...]}` result, not an exception.

export const NODE_TYPES = Object.freeze(["file", "function", "class", "module", "concept"]);

// Only the kinds Ch.3.2's extractor actually emits are validated against — see
// docs/work/exocortex/code-graph-schema.md's Edge kinds table for the full reserved vocabulary
// (extends/implements/reads/writes/tested-by/references) that isn't emitted yet. Keeping the
// VALIDATED set narrow is what makes "validate before build" a real gate rather than a formality
// that accepts anything with a string in it.
export const EDGE_KINDS = Object.freeze(["contains", "imports", "calls"]);

export const CONFIDENCE_TAGS = Object.freeze(["EXTRACTED", "INFERRED", "AMBIGUOUS"]);

const NODE_TYPE_SET = new Set(NODE_TYPES);
const EDGE_KIND_SET = new Set(EDGE_KINDS);
const CONFIDENCE_SET = new Set(CONFIDENCE_TAGS);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * validateNode(node) → { ok: boolean, errors: string[] }
 * Required: `id` (non-empty string), `type` (one of NODE_TYPES). Everything else is optional
 * metadata — not checked here (this schema deliberately doesn't constrain `path`/`name`/line
 * numbers beyond "if present, don't lie about your id/type").
 */
export function validateNode(node) {
  const errors = [];
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return { ok: false, errors: ["node must be an object"] };
  }
  if (!isNonEmptyString(node.id)) errors.push("node.id must be a non-empty string");
  if (!NODE_TYPE_SET.has(node.type)) errors.push(`node.type must be one of ${NODE_TYPES.join("|")}, got ${JSON.stringify(node.type)}`);
  return { ok: errors.length === 0, errors };
}

/**
 * validateEdge(edge) → { ok: boolean, errors: string[] }
 * Required: `source`, `target` (non-empty strings — node ids), `kind` (one of EDGE_KINDS),
 * `confidence` (one of CONFIDENCE_TAGS — REQUIRED, never defaulted; a missing confidence is a
 * validation failure, not an implicit EXTRACTED).
 */
export function validateEdge(edge) {
  const errors = [];
  if (!edge || typeof edge !== "object" || Array.isArray(edge)) {
    return { ok: false, errors: ["edge must be an object"] };
  }
  if (!isNonEmptyString(edge.source)) errors.push("edge.source must be a non-empty string");
  if (!isNonEmptyString(edge.target)) errors.push("edge.target must be a non-empty string");
  if (!EDGE_KIND_SET.has(edge.kind)) errors.push(`edge.kind must be one of ${EDGE_KINDS.join("|")}, got ${JSON.stringify(edge.kind)}`);
  if (!CONFIDENCE_SET.has(edge.confidence)) errors.push(`edge.confidence must be one of ${CONFIDENCE_TAGS.join("|")}, got ${JSON.stringify(edge.confidence)}`);
  return { ok: errors.length === 0, errors };
}

/**
 * validateBatch({ nodes, edges }) → { ok, errors, nodeErrors, edgeErrors }
 *
 * ALL-OR-NOTHING, by design (plan.md 3.1: "a batch of extracted nodes/edges that fails validation
 * never reaches the graph-build stage"): one malformed node or edge fails the WHOLE batch, rather
 * than silently building a partial graph from whatever happened to validate. `nodeErrors`/
 * `edgeErrors` are arrays aligned by index (empty array at an index means that entry was valid),
 * so a caller can report exactly which entries were wrong without re-validating anything.
 */
export function validateBatch(batch) {
  const b = batch && typeof batch === "object" ? batch : {};
  const nodes = Array.isArray(b.nodes) ? b.nodes : null;
  const edges = Array.isArray(b.edges) ? b.edges : null;
  const errors = [];
  if (!nodes) errors.push("batch.nodes must be an array");
  if (!edges) errors.push("batch.edges must be an array");

  const nodeErrors = (nodes || []).map((n) => validateNode(n).errors);
  const edgeErrors = (edges || []).map((e) => validateEdge(e).errors);

  const anyNodeInvalid = nodeErrors.some((e) => e.length > 0);
  const anyEdgeInvalid = edgeErrors.some((e) => e.length > 0);
  if (anyNodeInvalid) errors.push("one or more nodes failed validation — see nodeErrors");
  if (anyEdgeInvalid) errors.push("one or more edges failed validation — see edgeErrors");

  return { ok: errors.length === 0, errors, nodeErrors, edgeErrors };
}
