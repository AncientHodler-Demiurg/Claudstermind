// node --test lib/protocol.test.mjs — the tunnel envelope validator.
import test from "node:test";
import assert from "node:assert/strict";
import { FRAME, validateFrame, isCommandType } from "./protocol.mjs";

test("valid frames of every type pass", () => {
  assert.equal(validateFrame({ t: FRAME.HELLO, deviceSecret: "s" }).ok, true);
  assert.equal(validateFrame({ t: FRAME.WELCOME }).ok, true);
  assert.equal(validateFrame({ t: FRAME.SNAPSHOT, data: { map: {} } }).ok, true);
  assert.equal(validateFrame({ t: FRAME.COMMAND, id: "abc", cmd: { type: "git.push", args: {} } }).ok, true);
  assert.equal(validateFrame({ t: FRAME.RESULT, id: "abc", result: { ok: true } }).ok, true);
  assert.equal(validateFrame({ t: FRAME.PING }).ok, true);
  assert.equal(validateFrame({ t: FRAME.PONG }).ok, true);
});

test("non-objects and unknown types are rejected", () => {
  assert.equal(validateFrame(null).ok, false);
  assert.equal(validateFrame("hello").ok, false);
  assert.equal(validateFrame(42).ok, false);
  assert.equal(validateFrame({}).ok, false);
  assert.equal(validateFrame({ t: "explode" }).ok, false);
});

test("required fields are enforced per type", () => {
  assert.equal(validateFrame({ t: FRAME.HELLO }).ok, false);                       // no secret
  assert.equal(validateFrame({ t: FRAME.HELLO, deviceSecret: 5 }).ok, false);      // wrong type
  assert.equal(validateFrame({ t: FRAME.SNAPSHOT }).ok, false);                    // no data
  assert.equal(validateFrame({ t: FRAME.SNAPSHOT, data: "x" }).ok, false);         // data not object
  assert.equal(validateFrame({ t: FRAME.COMMAND, id: "a" }).ok, false);            // no cmd
  assert.equal(validateFrame({ t: FRAME.COMMAND, cmd: { type: "git.push" } }).ok, false); // no id
  assert.equal(validateFrame({ t: FRAME.COMMAND, id: "a", cmd: { args: {} } }).ok, false); // cmd.type missing
  assert.equal(validateFrame({ t: FRAME.RESULT, result: { ok: true } }).ok, false); // no id
  assert.equal(validateFrame({ t: FRAME.RESULT, id: "a" }).ok, false);             // no result
});

test("workspace streaming frames require a kind discriminator", () => {
  assert.equal(validateFrame({ t: FRAME.WS_IN, kind: "prompt", sessionKey: "s", data: { text: "hi" } }).ok, true);
  assert.equal(validateFrame({ t: FRAME.WS_OUT, kind: "event", sessionKey: "s", data: {} }).ok, true);
  assert.equal(validateFrame({ t: FRAME.WS_IN }).ok, false);          // no kind
  assert.equal(validateFrame({ t: FRAME.WS_OUT, kind: 5 }).ok, false); // wrong type
});

test("isCommandType gates the whitelist", () => {
  assert.equal(isCommandType("git.push"), true);
  assert.equal(isCommandType("tokens.save"), true);
  assert.equal(isCommandType("pollinate.dryrun"), true);
  assert.equal(isCommandType("rm.rf"), false);
  assert.equal(isCommandType(""), false);
  assert.equal(isCommandType(null), false);
});
