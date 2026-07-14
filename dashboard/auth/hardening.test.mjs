// Regression tests for the defects the security review found. Each one names the
// finding it locks down — they are not hypotheticals, they were all real.
//   node --test dashboard/auth/hardening.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import { parseCookies } from "./session.mjs";
import { esc } from "./routes.mjs";

test("CRITICAL: a malformed cookie does not throw (it was a one-request remote server kill)", () => {
  // decodeURIComponent("%") throws URIError. parseCookies runs on /auth/callback,
  // which is UNAUTHENTICATED — so an unguarded throw let anyone kill the live
  // dashboard with: curl /auth/callback -H 'Cookie: a=%'
  assert.doesNotThrow(() => parseCookies("a=%"));
  assert.doesNotThrow(() => parseCookies("cm_admin_session=%E0%A4%A"));
  assert.doesNotThrow(() => parseCookies("x=%zz; y=100%; z=%%%"));

  // An undecodable value is kept raw — it then fails its signature check like any
  // other garbage, which is the correct outcome.
  assert.deepEqual(parseCookies("a=%"), { a: "%" });
  // ...and a well-formed neighbour is still decoded correctly.
  assert.deepEqual(parseCookies("bad=%; good=a%20b"), { bad: "%", good: "a b" });
});

test("LOW: HTML interpolated into the auth failure pages is escaped", () => {
  assert.equal(esc('<script>alert(1)</script>'), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(esc('" onload="x'), "&quot; onload=&quot;x");
  assert.equal(esc("a & b"), "a &amp; b");
});
