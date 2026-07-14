// id_token verification — EVERY pin the AncientHub contract mandates.
// Ported from Pythia/apps/pythia/src/admin/idToken.ts.
// A partial verify IS an auth bypass — do not weaken any of these.
import { jwtVerify } from "jose";

/** The top admin tier. Execute-actions require exactly this. */
export const ANCIENT_ROLE = "ancient";
/** Read-only admin tier. */
export const MODERN_ROLE = "modern";

function pickDisplayName(payload, sub) {
  for (const claim of ["display_name", "preferred_username", "name"]) {
    const v = payload[claim];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return sub.length > 10 ? `${sub.slice(0, 10)}…` : sub;
}

/**
 * Verify a hub id_token. All pins enforced here:
 *  - algorithms:["RS256"] — never trusts the token's own `alg`; excludes alg:none
 *    and an HS256 forgery signed with the published RSA public key.
 *  - issuer + audience pinned — rejects a token minted for a different client.
 *  - nonce must equal what we sent on /authorize (jwtVerify does NOT check this).
 *  - clockTolerance 60s for skew.
 * Keys the user on `sub` (opaque, stable). email/name are display-only.
 * @throws on any failed pin — callers treat a throw as auth denial.
 */
export async function verifyIdToken(idToken, { jwks, issuer, clientId, expectedNonce }) {
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer,
    audience: clientId,
    algorithms: ["RS256"],
    clockTolerance: 60,
  });

  if (typeof payload.nonce !== "string" || payload.nonce !== expectedNonce) {
    throw new Error("id_token nonce mismatch");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("id_token missing sub");
  }

  // `roles` is an ARRAY — treat as a set, ignore non-string entries.
  const roles = Array.isArray(payload.roles) ? payload.roles.filter((r) => typeof r === "string") : [];

  const identity = { sub: payload.sub, roles, displayName: pickDisplayName(payload, payload.sub) };
  if (typeof payload.email === "string") identity.email = payload.email;
  return identity;
}

/** Execute tier: only `ancient`. `operator`/`baron` are NOT admins. */
export function hasAncientRole(roles) {
  return Array.isArray(roles) && roles.includes(ANCIENT_ROLE);
}

/** Read-only tier: `modern` (or `ancient`, which supersedes it). */
export function hasModernRole(roles) {
  return Array.isArray(roles) && (roles.includes(MODERN_ROLE) || roles.includes(ANCIENT_ROLE));
}
