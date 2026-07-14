// PKCE + CSRF/replay secrets for one /authorize round-trip.
// Ported 1:1 from Pythia/apps/pythia/src/admin/pkce.ts (node:crypto only).
import { randomBytes, createHash } from "node:crypto";

const b64url = (buf) => buf.toString("base64url");

/**
 * Mint the per-login transient secrets:
 *  - state        — CSRF: binds the callback to the request that started it
 *  - nonce        — replay: binds the id_token to this exact request
 *  - codeVerifier — PKCE secret; its S256 digest is sent as the challenge
 */
export function createLoginChallenge() {
  const codeVerifier = b64url(randomBytes(32));
  return {
    state: b64url(randomBytes(16)),
    nonce: b64url(randomBytes(16)),
    codeVerifier,
    codeChallenge: b64url(createHash("sha256").update(codeVerifier).digest()),
  };
}

/** Recompute the S256 challenge for a verifier — the relation the IdP checks. */
export function deriveCodeChallenge(codeVerifier) {
  return b64url(createHash("sha256").update(codeVerifier).digest());
}
