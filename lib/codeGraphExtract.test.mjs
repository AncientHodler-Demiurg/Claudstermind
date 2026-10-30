// Tests for lib/codeGraphExtract.mjs — Ch.3.2's tree-sitter JS/TS extractor. Fixture SOURCE
// STRINGS inline, not this repo's own lib/ — per plan.md 3.2, so this suite does not rot as lib/
// changes.

import test from "node:test";
import assert from "node:assert/strict";
import { createExtractor } from "./codeGraphExtract.mjs";
import { validateBatch } from "./codeGraphSchema.mjs";

let extractor;
test.before(async () => { extractor = await createExtractor(); });

function node(nodes, id) { return nodes.find((n) => n.id === id); }
function edge(edges, source, target, kind) { return edges.find((e) => e.source === source && e.target === target && e.kind === kind); }

test("extractFile: an unsupported extension returns an empty batch, not an error", () => {
  const r = extractor.extractFile("a.py", "def foo(): pass");
  assert.deepEqual(r, { nodes: [], edges: [] });
});

test("extractFile: emits a file node, function nodes, class nodes — the minimum per plan.md 3.2", () => {
  const src = `
function foo(a) { return a; }
class Bar {
  method() { return 1; }
}
const baz = () => 1;
`;
  const { nodes, edges } = extractor.extractFile("lib/a.mjs", src);
  assert.ok(validateBatch({ nodes, edges }).ok, "extractor output must itself be schema-valid");
  assert.ok(node(nodes, "file:lib/a.mjs"));
  assert.ok(node(nodes, "function:lib/a.mjs#foo"));
  assert.ok(node(nodes, "class:lib/a.mjs#Bar"));
  assert.ok(node(nodes, "function:lib/a.mjs#Bar.method"));
  assert.ok(node(nodes, "function:lib/a.mjs#baz"), "a const-bound arrow function is a function node too");
  assert.ok(edge(edges, "file:lib/a.mjs", "function:lib/a.mjs#foo", "contains"));
  assert.ok(edge(edges, "file:lib/a.mjs", "class:lib/a.mjs#Bar", "contains"));
  assert.ok(edge(edges, "class:lib/a.mjs#Bar", "function:lib/a.mjs#Bar.method", "contains"));
});

test("extractFile: contains/calls/imports edge kinds, all EXTRACTED for a direct AST match", () => {
  const src = `
import { helper } from "./helper.mjs";
function useIt() { return helper() + inner(); }
function inner() { return 1; }
`;
  const { nodes, edges } = extractor.extractFile("lib/b.mjs", src);
  assert.ok(validateBatch({ nodes, edges }).ok);
  const imp = edge(edges, "file:lib/b.mjs", "file:lib/helper.mjs", "imports");
  assert.ok(imp);
  assert.equal(imp.confidence, "EXTRACTED");
  const call = edge(edges, "function:lib/b.mjs#useIt", "function:lib/b.mjs#inner", "calls");
  assert.ok(call);
  assert.equal(call.confidence, "EXTRACTED");
});

test("extractFile: an external (non-relative) import target is a module: id, with no node emitted for it", () => {
  const { nodes, edges } = extractor.extractFile("lib/c.mjs", `import x from "lodash";\n`);
  const imp = edge(edges, "file:lib/c.mjs", "module:lodash", "imports");
  assert.ok(imp);
  assert.ok(!node(nodes, "module:lodash"), "no node is emitted for an external module — only the edge target id");
});

test("extractFile: require(...) is an import edge too", () => {
  const { edges } = extractor.extractFile("lib/d.mjs", `const x = require("./util.mjs");\n`);
  assert.ok(edge(edges, "file:lib/d.mjs", "file:lib/util.mjs", "imports"));
});

// --- the tricky cases named explicitly in plan.md 3.2 --------------------------------------

test("TRICKY: a re-exported name produces an import edge, and the re-exported name is NOT mistaken for a local declaration", () => {
  const { nodes, edges } = extractor.extractFile("lib/e.mjs", `export { foo } from "./other.mjs";\n`);
  assert.ok(edge(edges, "file:lib/e.mjs", "file:lib/other.mjs", "imports"));
  assert.ok(!node(nodes, "function:lib/e.mjs#foo"), "foo is not declared in THIS file — must not be emitted as a function node here");
});

test("TRICKY: export * from \"...\" is also an import edge", () => {
  const { edges } = extractor.extractFile("lib/f.mjs", `export * from "./all.mjs";\n`);
  assert.ok(edge(edges, "file:lib/f.mjs", "file:lib/all.mjs", "imports"));
});

test("TRICKY: a dynamic import() with a literal string is an INFERRED import edge", () => {
  const { edges } = extractor.extractFile("lib/g.mjs", `const mod = import("./dyn.mjs");\n`);
  const imp = edge(edges, "file:lib/g.mjs", "file:lib/dyn.mjs", "imports");
  assert.ok(imp);
  assert.equal(imp.confidence, "INFERRED");
});

test("TRICKY: a dynamic import() with a NON-literal argument is skipped — nothing to point at, not a guess", () => {
  const { edges } = extractor.extractFile("lib/h.mjs", `const path = computePath();\nconst mod = import(path);\n`);
  assert.equal(edges.filter((e) => e.kind === "imports").length, 0);
});

test("TRICKY: a method named 'then' never collides with a top-level function named 'then' (Graphify's _GO_PREDECLARED_FUNCS scar, avoided by construction)", () => {
  const src = `
function then() { return "top-level"; }
class Thenable {
  then() { return then(); }      // bare call inside the method — correctly resolves to the TOP-LEVEL then
  other() { return this.then(); } // member-expression call — must NEVER be resolved as a calls edge
}
`;
  const { nodes, edges } = extractor.extractFile("lib/i.mjs", src);
  assert.ok(node(nodes, "function:lib/i.mjs#then"), "the top-level function");
  assert.ok(node(nodes, "function:lib/i.mjs#Thenable.then"), "the method, under its OWN qualified id — never the bare 'then'");
  // The bare call inside Thenable.then() resolves to the TOP-LEVEL then — a real, correct edge.
  assert.ok(edge(edges, "function:lib/i.mjs#Thenable.then", "function:lib/i.mjs#then", "calls"));
  // this.then() is a member-expression call — NEVER resolved, regardless of the name collision.
  const callsFromOther = edges.filter((e) => e.kind === "calls" && e.source === "function:lib/i.mjs#Thenable.other");
  assert.deepEqual(callsFromOther, [], "this.then() must never produce a calls edge");
});

test("TRICKY: a method named 'constructor' is just another qualified method id, no special handling needed", () => {
  const src = `class K { constructor() { this.x = helper(); } }\nfunction helper() { return 1; }\n`;
  const { nodes, edges } = extractor.extractFile("lib/j.mjs", src);
  assert.ok(node(nodes, "function:lib/j.mjs#K.constructor"));
  assert.ok(edge(edges, "function:lib/j.mjs#K.constructor", "function:lib/j.mjs#helper", "calls"));
});

test("a loop calling the same function repeatedly still produces exactly ONE calls edge", () => {
  const src = `function helper() { return 1; }\nfunction caller() { for (let i=0;i<3;i++) helper(); return helper(); }\n`;
  const { edges } = extractor.extractFile("lib/k.mjs", src);
  const calls = edges.filter((e) => e.kind === "calls" && e.source === "function:lib/k.mjs#caller" && e.target === "function:lib/k.mjs#helper");
  assert.equal(calls.length, 1);
});

test("direct recursion (foo calling foo) produces a real self-edge", () => {
  const { edges } = extractor.extractFile("lib/l.mjs", `function foo(n) { return n <= 0 ? 0 : foo(n-1); }\n`);
  assert.ok(edge(edges, "function:lib/l.mjs#foo", "function:lib/l.mjs#foo", "calls"));
});

test("TypeScript: classes/functions/imports extract the same way under the typescript grammar", () => {
  const src = `
import { Thing } from "./thing";
export class Widget {
  render(): string { return this.helper(); }
  helper(): string { return "x"; }
}
function build(): Widget { return new Widget(); }
`;
  const { nodes, edges } = extractor.extractFile("lib/m.ts", src);
  assert.ok(validateBatch({ nodes, edges }).ok);
  assert.ok(node(nodes, "class:lib/m.ts#Widget"));
  assert.ok(node(nodes, "function:lib/m.ts#build"));
  assert.ok(edge(edges, "file:lib/m.ts", "file:lib/thing", "imports"));
});

test("TSX: a .tsx file parses under its own grammar without error", () => {
  const src = `
import React from "react";
export function App() { return <div>hi</div>; }
`;
  const { nodes } = extractor.extractFile("lib/n.tsx", src);
  assert.ok(node(nodes, "function:lib/n.tsx#App"));
});

test("a syntactically broken file never throws — tree-sitter always produces SOME tree, error nodes just contribute nothing extra", () => {
  assert.doesNotThrow(() => extractor.extractFile("lib/broken.mjs", "function foo( { this is not valid js"));
});

test("relative import specifiers resolve against the IMPORTING file's own directory, not the repo root", () => {
  const { edges } = extractor.extractFile("lib/sub/deep.mjs", `import x from "../sibling.mjs";\n`);
  assert.ok(edge(edges, "file:lib/sub/deep.mjs", "file:lib/sibling.mjs", "imports"));
});
