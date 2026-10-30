// Tests for lib/oneShotQuery.mjs — Ch.2.5b's minimal text-in/text-out SDK query wrapper.

import test from "node:test";
import assert from "node:assert/strict";
import { oneShotQuery } from "./oneShotQuery.mjs";

function fakeSdkQuery(assistantTexts, { denyToolUse = true } = {}) {
  const calls = [];
  const fn = ({ prompt, options }) => {
    calls.push({ options });
    return (async function* () {
      const it = prompt[Symbol.asyncIterator]();
      const first = await it.next();
      calls[calls.length - 1].userContent = first.value.message.content;
      if (denyToolUse) {
        const decision = await options.canUseTool("Bash", { command: "ls" });
        calls[calls.length - 1].toolDecision = decision;
      }
      for (const text of assistantTexts) {
        yield { type: "assistant", message: { content: [{ type: "text", text }] } };
      }
      yield { type: "result", subtype: "success", is_error: false, result: "done" };
    })();
  };
  fn.calls = calls;
  return fn;
}

test("oneShotQuery: collects and concatenates every assistant text block, in order", async () => {
  const sdkQuery = fakeSdkQuery(["Hello ", "world"]);
  const out = await oneShotQuery(sdkQuery, { prompt: "draft this", cwd: "/tmp" });
  assert.equal(out, "Hello world");
});

test("oneShotQuery: always denies tool use", async () => {
  const sdkQuery = fakeSdkQuery(["ok"]);
  await oneShotQuery(sdkQuery, { prompt: "draft this" });
  assert.equal(sdkQuery.calls[0].toolDecision.behavior, "deny");
});

test("oneShotQuery: sends the prompt text as the single user turn", async () => {
  const sdkQuery = fakeSdkQuery(["ok"]);
  await oneShotQuery(sdkQuery, { prompt: "draft THIS exact text" });
  assert.equal(sdkQuery.calls[0].userContent, "draft THIS exact text");
});

test("oneShotQuery: passes model/cwd/fastMode through to options", async () => {
  const sdkQuery = fakeSdkQuery(["ok"]);
  await oneShotQuery(sdkQuery, { prompt: "x", cwd: "/repo", model: "cheap-model", fastMode: true });
  const { options } = sdkQuery.calls[0];
  assert.equal(options.cwd, "/repo");
  assert.equal(options.model, "cheap-model");
  assert.equal(options.settings.fastMode, true);
});

test("oneShotQuery: returns null (not '') when nothing was produced", async () => {
  const sdkQuery = fakeSdkQuery([]);
  const out = await oneShotQuery(sdkQuery, { prompt: "x" });
  assert.equal(out, null);
});

test("oneShotQuery: returns null for missing/blank prompt or non-function sdkQuery, never throws", async () => {
  const sdkQuery = fakeSdkQuery(["ok"]);
  assert.equal(await oneShotQuery(sdkQuery, { prompt: "" }), null);
  assert.equal(await oneShotQuery(sdkQuery, { prompt: "   " }), null);
  assert.equal(await oneShotQuery(sdkQuery, {}), null);
  assert.equal(await oneShotQuery(null, { prompt: "x" }), null);
  assert.equal(await oneShotQuery("not a function", { prompt: "x" }), null);
});

test("oneShotQuery: a throwing sdkQuery degrades to null, never rejects", async () => {
  const sdkQuery = () => { throw new Error("subprocess died"); };
  const out = await oneShotQuery(sdkQuery, { prompt: "x" });
  assert.equal(out, null);
});

test("oneShotQuery: an async generator that throws mid-stream degrades to null", async () => {
  const sdkQuery = () => (async function* () {
    yield { type: "assistant", message: { content: [{ type: "text", text: "partial" }] } };
    throw new Error("stream broke");
  })();
  const out = await oneShotQuery(sdkQuery, { prompt: "x" });
  assert.equal(out, null);
});
