# The code graph schema — Ch.3.1

Written schema doc for the `{nodes, edges}` shape every Wave-3 stage (extract → build → cluster →
analyze → report → export) produces and consumes. Pipeline shape, the schema itself, and the
confidence-tag vocabulary are all borrowed free from Graphify (per `docs/work/exocortex/HANDOFF.md`)
— the pipeline is `detect → extract → build → cluster → analyze → report → export`; what's built
here is `extract` (Ch.3.2) and `build` (Ch.3.3) first, since those are the smallest slice that
produces a real, loadable graph.

## Node

```jsonc
{
  "id": "function:lib/foo.mjs#bar",   // caller-chosen, globally unique within one graph
  "type": "function",                 // required — see Node types below
  "path": "lib/foo.mjs",               // optional — the file this node belongs to/is
  "name": "bar",                       // optional — display name
  "startLine": 12,                     // optional, 1-based
  "endLine": 18                        // optional, 1-based, inclusive
}
```

Required: `id` (non-empty string), `type` (one of **Node types** below). Everything else is
optional metadata — a node with only `id`/`type` is valid (e.g. a `module`/`concept` node that
has no single file/line to point at).

### Node types

Per `docs/EXOCORTEX-VISION.md` §3 / HANDOFF's Graphify verdict:

| Type | What | Emitted by |
|---|---|---|
| `file` | one source file | Ch.3.2 extractor |
| `function` | a function/method declaration | Ch.3.2 extractor |
| `class` | a class declaration | Ch.3.2 extractor |
| `module` | a higher-level grouping (a package, a directory) | not yet emitted — reserved for a later clustering pass (Ch.3.1's `cluster` pipeline stage) |
| `concept` | a piece of Ch.2 knowledge (a fact/decision/skill) joined onto the SAME graph | not yet emitted — this is what lets the brain and the code graph share one graph later; reserved, not built in this wave |

## Edge

```jsonc
{
  "source": "file:lib/foo.mjs",
  "target": "file:lib/bar.mjs",
  "kind": "imports",                   // required — see Edge kinds below
  "confidence": "EXTRACTED"            // required on EVERY edge, no default
}
```

Required: `source`, `target` (both non-empty strings — node ids; this schema does NOT require the
referenced node to already exist in the same batch, since an extractor may emit an edge to a node
it hasn't visited yet within one file-at-a-time walk — `lib/codeGraph.mjs`'s build step adds any
node ids only ever seen as an edge endpoint as a bare placeholder, so nothing is silently
dropped), `kind` (one of **Edge kinds** below), `confidence` (one of **Confidence tags** below —
**required, never optional, never defaulted**: Graphify's own scar is a `_GO_PREDECLARED_FUNCS`
blocklist born from treating every match as equally certain; tagging confidence at the point of
extraction is the fix, not a doc note added after the fact).

### Edge kinds

Borrowed from understand-anything's taxonomy (per HANDOFF) as the vocabulary, grouped by
category. Only the ones marked **emitted** are produced by Ch.3.2's extractor today — the rest are
named now so a later extractor pass has a slot to land in without a schema migration (same
"reserve the name, don't build the behavior yet" move as `facts.scope`'s `'team'` value in Ch.1.3).

| Kind | Category | Emitted? |
|---|---|---|
| `contains` | structural | ✅ Ch.3.2 (a file contains its top-level functions/classes) |
| `imports` | dependency | ✅ Ch.3.2 (an `import`/`require`/dynamic `import()`) |
| `calls` | behavioral | ✅ Ch.3.2 (a direct call expression naming a known function) |
| `extends` | structural | reserved |
| `implements` | structural | reserved |
| `reads` / `writes` | data-flow | reserved |
| `tested-by` | semantic | reserved |
| `references` | semantic | reserved — this is the slot a future `concept` node's edges to code would use |

### Confidence tags

| Tag | Meaning |
|---|---|
| `EXTRACTED` | a direct AST match — the parser saw exactly this (e.g. a `call_expression` naming a locally-declared function) |
| `INFERRED` | derived, not directly observed (e.g. a call resolved through a re-export, or a dynamic `import()` whose target is a literal string) |
| `AMBIGUOUS` | the extractor could not be confident (e.g. a call to a name that collides with more than one in-scope declaration, or a method name that collides with a JS builtin like `then`/`constructor`) |

## Validate-before-build

`lib/codeGraphSchema.mjs`'s `validateBatch({nodes, edges})` is the real gate named above: a batch
containing even ONE malformed node or edge fails whole — none of it reaches `lib/codeGraph.mjs`'s
`buildGraph`. This is deliberately all-or-nothing (not "skip the bad ones and build the rest") so
a malformed batch can never silently produce a partial graph that looks complete. See
`lib/codeGraphSchema.test.mjs` for the pinning tests, including the batch-rejection case.
