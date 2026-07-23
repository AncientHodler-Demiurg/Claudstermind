// node --test relay/bodySize.test.mjs
//
// CONFIRMED-HIGH (vision-input review): readBody() had NO size cap at all — a chunked-encoding
// client (no Content-Length, or a lying one) could force the relay to buffer an unbounded body
// via `body += c` before ever reaching JSON.parse, and this ran BEFORE the canExecute check.
// The cap must be enforced as bytes actually ARRIVE, not from a pre-check on a header a client
// fully controls, so these drive the request with raw chunked writes and no Content-Length.
//
// Kept as its own file (not folded into integration.test.mjs) so it never shares a process with
// that file's heavier git+bridge fixture — a real WS bridge left mid-teardown was observed to
// perturb this test's tight write/response timing and produce a flaky ECONNRESET.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRelay } from "./server.mjs";
import { signSession, SESSION_COOKIE } from "../dashboard/auth/session.mjs";

const DEVICE = "device-secret-at-least-32-chars-long!!";
const OIDC = {
  issuer: "https://hub.test", clientId: "c", clientSecret: "s",
  redirectUri: "https://brain.test/auth/callback",
  sessionSecret: "test-session-secret-at-least-32-chars!!", scope: "openid",
};

// Drips `totalBytes` at the workspace/attach route (ancient-only, but needs no connected bridge)
// via raw chunked writes — no content-length header is ever sent, so the server cannot be
// relying on a header pre-check to reject an oversized body.
function postChunked(port, cookie, totalBytes) {
  return new Promise((resolvePromise, reject) => {
    const req = http.request({
      hostname: "127.0.0.1", port, method: "POST", path: "/api/workspace/attach",
      headers: { cookie, "content-type": "application/json" },
    }, (res) => {
      let body = ""; res.on("data", (c) => { body += c; }); res.on("end", () => resolvePromise({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    const chunk = Buffer.alloc(256 * 1024, "a");
    let sent = 0;
    const pump = () => {
      if (sent >= totalBytes) { req.end(); return; }
      sent += chunk.length;
      const ok = req.write(chunk);
      if (ok) setImmediate(pump); else req.once("drain", pump);
    };
    pump();
  });
}

test("HIGH: a POST body that crosses the size cap DURING chunked streaming is rejected 413, not JSON.parsed; a normal-sized body is unaffected", async () => {
  const relay = createRelay({ oidc: OIDC, deviceSecret: DEVICE });
  await new Promise((r) => relay.server.listen(0, "127.0.0.1", r));
  const port = relay.server.address().port;
  const ancient = `${SESSION_COOKIE}=${await signSession({ sub: "a", roles: ["ancient"], name: "Anc" }, OIDC.sessionSecret)}`;

  const oversized = await postChunked(port, ancient, 9 * 1024 * 1024);   // over the relay's cap
  assert.equal(oversized.status, 413, `an oversized streamed body must be rejected with 413, got ${oversized.status}: ${oversized.body}`);
  assert.doesNotMatch(oversized.body, /"ok":true/, "the oversized body must never be JSON.parsed and acted on");

  const normal = await postChunked(port, ancient, 1024);                // well under the cap — must be unaffected
  assert.equal(normal.status, 200, `a normal-sized request must be unaffected, got ${normal.status}: ${normal.body}`);

  await new Promise((r) => relay.server.close(r));
});
