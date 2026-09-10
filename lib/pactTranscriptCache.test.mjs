// node --test lib/pactTranscriptCache.test.mjs
//
// "Why does it always take time to load conversation, when I come back to a workspace, from mobile on
//  remote, I am always show that loading bar. Can't you cache it or something?"
//
// Leaving a workspace tears PACT_CHAT down; returning rebuilds it from an empty object. So every tab
// started with NO messages and had to pull its transcript back through the tunnel before it could
// show anything — worst exactly where it hurts most, a phone on the relay. The rows were in memory a
// moment earlier; nothing but the rebuild threw them away.
//
// Measured on localhost, returning to a workspace:
//   before — +300ms: loader visible, 0 bubbles;  +600ms: 50 bubbles
//   after  — +300ms: 50 bubbles, no loader
// The tunnel makes that gap much larger, which is the wait being reported.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dir, "..", "dashboard", "public", "app.js"), "utf8");

test("the transcript survives the view rebuild that used to discard it", () => {
  assert.match(app, /const PACT_MSG_CACHE = new Map\(\)/,
    "something has to outlive PACT_CHAT, which is replaced wholesale on every return");
  assert.match(app, /if \(PACT_CHAT\) \{ pactCacheTabs\(\); pactChatStop\(\); \}/,
    "the snapshot must be taken BEFORE the object is replaced — afterwards the rows are already gone");
  assert.match(app, /msgs: \(PACT_MSG_CACHE\.get\(key\) \|\| \{\}\)\.msgs \|\| \[\]/,
    "…and a restored tab must be seeded from it, keyed by conversation so it gets ITS own history");
});

test("the loader is for an empty box, not for a refresh", () => {
  assert.match(app, /if \(!\(t\.msgs && t\.msgs\.length\)\) pactChatSetLoading\(t, true\)/,
    "covering a conversation you can already read with a loading bar is strictly worse than showing it");
});

test("the cache is a render cache, never a source of truth", () => {
  // The authoritative copy still arrives and replaces it. If this ever became the thing the client
  // trusts, a stale tab would quietly outlive the conversation it came from.
  const at = app.indexOf("function pactCacheTabs");
  const body = app.slice(at, app.indexOf("\n}", at));
  assert.match(body, /t\.msgs\.length/, "only a tab that actually has rows is worth caching");
  assert.ok(!/localStorage|sessionStorage|indexedDB/i.test(body),
    "in memory for the life of the page only — persisting transcripts is a different decision, with " +
    "different privacy and size consequences, and is not what was asked for");
});

test("the cache is bounded", () => {
  // Transcripts are the largest thing this app holds; keyed by conversation, an unbounded map would
  // accumulate every chat ever opened for the life of the page.
  assert.match(app, /while \(PACT_MSG_CACHE\.size > \d+\) PACT_MSG_CACHE\.delete\(PACT_MSG_CACHE\.keys\(\)\.next\(\)\.value\)/,
    "an unbounded transcript cache is a memory leak with a friendly name");
});
