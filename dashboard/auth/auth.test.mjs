// Security tests for the AncientHub login.
// Every case here is an auth BYPASS if it regresses — the whole point of pinning
// issuer/audience/alg/nonce is that a token that fails any one of them is rejected.
//   node --test dashboard/auth/
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from "jose";

import { createLoginChallenge, deriveCodeChallenge } from "./pkce.mjs";
import { verifyIdToken, hasAncientRole, hasModernRole } from "./idToken.mjs";
import {
  signLoginState, readLoginState, signSession, readSession,
  parseCookies, cookie, clearCookie,
} from "./session.mjs";
import { readOidcConfig } from "./oidcConfig.mjs";

const ISSUER = "https://ancientholdings.eu";
const CLIENT_ID = "claudstermind-dashboard";
const NONCE = "the-nonce-we-sent";

// A local JWKS standing in for the hub's published keys.
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = await exportJWK(publicKey);
jwk.kid = "test-key";
jwk.alg = "RS256";
const jwks = createLocalJWKSet({ keys: [jwk] });

function idToken(claims = {}, { alg = "RS256", key = privateKey } = {}) {
  return new SignJWT({ nonce: NONCE, roles: ["ancient"], email: "a@b.c", ...claims })
    .setProtectedHeader({ alg, kid: "test-key" })
    .setIssuer(claims.iss ?? ISSUER)
    .setAudience(claims.aud ?? CLIENT_ID)
    .setSubject(claims.sub ?? "user-sub-123")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

const opts = { jwks, issuer: ISSUER, clientId: CLIENT_ID, expectedNonce: NONCE };

test("valid id_token is accepted and keyed on sub", async () => {
  const identity = await verifyIdToken(await idToken(), opts);
  assert.equal(identity.sub, "user-sub-123");
  assert.deepEqual(identity.roles, ["ancient"]);
  assert.equal(identity.email, "a@b.c");
});

test("HS256 forgery signed with the public key is rejected", async () => {
  // The classic confusion attack: attacker takes the PUBLISHED RSA public key,
  // uses it as an HMAC secret, and signs their own token. Pinning
  // algorithms:["RS256"] is what stops it.
  const pubPem = Buffer.from(JSON.stringify(jwk));
  const forged = await new SignJWT({ nonce: NONCE, roles: ["ancient"] })
    .setProtectedHeader({ alg: "HS256", kid: "test-key" })
    .setIssuer(ISSUER).setAudience(CLIENT_ID).setSubject("attacker")
    .setIssuedAt().setExpirationTime("5m")
    .sign(pubPem.subarray(0, 32));
  await assert.rejects(() => verifyIdToken(forged, opts));
});

test("issuer mismatch is rejected", async () => {
  const t = await idToken({ iss: "https://evil.example" });
  await assert.rejects(() => verifyIdToken(t, opts), /"iss" claim/);
});

test("audience mismatch is rejected (token minted for another client)", async () => {
  const t = await idToken({ aud: "some-other-client" });
  await assert.rejects(() => verifyIdToken(t, opts), /"aud" claim/);
});

test("nonce mismatch is rejected (replay of an older id_token)", async () => {
  const t = await idToken({ nonce: "a-stale-nonce" });
  await assert.rejects(() => verifyIdToken(t, opts), /nonce/i);
});

test("missing nonce is rejected", async () => {
  const t = await new SignJWT({ roles: ["ancient"] })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER).setAudience(CLIENT_ID).setSubject("s")
    .setIssuedAt().setExpirationTime("5m").sign(privateKey);
  await assert.rejects(() => verifyIdToken(t, opts), /nonce/i);
});

test("expired token is rejected", async () => {
  const t = await new SignJWT({ nonce: NONCE, roles: ["ancient"] })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER).setAudience(CLIENT_ID).setSubject("s")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 600) // well past clockTolerance
    .sign(privateKey);
  await assert.rejects(() => verifyIdToken(t, opts));
});

test("a token signed by an unknown key is rejected", async () => {
  const other = await generateKeyPair("RS256");
  const t = await idToken({}, { key: other.privateKey });
  await assert.rejects(() => verifyIdToken(t, opts));
});

test("roles gate: ancient executes, modern is read-only, operator is neither", async () => {
  assert.equal(hasAncientRole(["ancient"]), true);
  assert.equal(hasAncientRole(["modern"]), false);
  assert.equal(hasAncientRole(["operator", "baron"]), false);
  assert.equal(hasAncientRole(undefined), false);

  assert.equal(hasModernRole(["modern"]), true);
  assert.equal(hasModernRole(["ancient"]), true); // ancient supersedes modern
  assert.equal(hasModernRole(["operator"]), false);
});

test("non-string entries in roles are dropped", async () => {
  const t = await idToken({ roles: ["ancient", 42, null] });
  const identity = await verifyIdToken(t, opts);
  assert.deepEqual(identity.roles, ["ancient"]);
});

test("PKCE: the challenge is the S256 digest of the verifier", () => {
  const c = createLoginChallenge();
  assert.equal(deriveCodeChallenge(c.codeVerifier), c.codeChallenge);
  assert.notEqual(c.state, c.nonce);
  assert.match(c.codeChallenge, /^[A-Za-z0-9_-]+$/); // base64url, no padding
  assert.notEqual(createLoginChallenge().codeVerifier, c.codeVerifier); // fresh each call
});

const SECRET = "x".repeat(40);

test("cookies: the login cookie cannot be used as a session cookie", async () => {
  const login = await signLoginState({ state: "s", nonce: "n", codeVerifier: "v" }, SECRET);
  assert.equal(await readSession(login, SECRET), null); // purpose separation
  const state = await readLoginState(login, SECRET);
  assert.equal(state.codeVerifier, "v");
});

test("cookies: the session cookie cannot be used as a login cookie", async () => {
  const sess = await signSession({ sub: "s", roles: ["ancient"] }, SECRET);
  assert.equal(await readLoginState(sess, SECRET), null);
  assert.equal((await readSession(sess, SECRET)).sub, "s");
});

test("cookies: a session signed with a different secret is rejected", async () => {
  const sess = await signSession({ sub: "s", roles: ["ancient"] }, "y".repeat(40));
  assert.equal(await readSession(sess, SECRET), null);
});

test("cookies: garbage and empty tokens are rejected, not thrown", async () => {
  assert.equal(await readSession("not.a.jwt", SECRET), null);
  assert.equal(await readSession("", SECRET), null);
  assert.equal(await readSession(undefined, SECRET), null);
});

test("cookie helpers set HttpOnly/Secure/SameSite and clear correctly", () => {
  const c = cookie("cm_admin_session", "abc", { maxAge: 60 });
  assert.match(c, /HttpOnly/);
  assert.match(c, /Secure/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Max-Age=60/);
  assert.match(clearCookie("cm_admin_session"), /Max-Age=0/);
  assert.deepEqual(parseCookies("a=1; cm_admin_session=xyz"), { a: "1", cm_admin_session: "xyz" });
});

test("config: no OIDC env => null => local mode, auth disabled", () => {
  assert.equal(readOidcConfig({}), null);
});

test("config: a PARTIAL OIDC env throws rather than silently disabling auth", () => {
  assert.throws(
    () => readOidcConfig({ OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: CLIENT_ID }),
    /partially configured/i,
  );
});

test("config: a full OIDC env yields live config; a short SESSION_SECRET is refused", () => {
  const env = {
    OIDC_ISSUER: `${ISSUER}/`,
    OIDC_CLIENT_ID: CLIENT_ID,
    OIDC_CLIENT_SECRET: "shh",
    OIDC_REDIRECT_URI: "https://dash.example/auth/callback",
    SESSION_SECRET: SECRET,
  };
  const cfg = readOidcConfig(env);
  assert.equal(cfg.issuer, ISSUER); // trailing slash normalised away
  assert.equal(cfg.scope, "openid profile email roles");
  assert.throws(() => readOidcConfig({ ...env, SESSION_SECRET: "short" }), /at least 32/);
});
