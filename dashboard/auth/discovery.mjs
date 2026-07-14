// OIDC discovery + JWKS — feature-detected, never hardcoded.
// Ported from Pythia/apps/pythia/src/admin/discovery.ts, INCLUDING the jwks 308 fix.
import { createRemoteJWKSet } from "jose";

const DISCOVERY_TTL_MS = 60 * 60 * 1000; // re-fetch hourly; jose caches JWKS itself (≤5min)
const cacheByIssuer = new Map();

/**
 * jose's createRemoteJWKSet fetches with redirect:"manual" (a security default —
 * it won't chase a key-set to a redirected location). The hub's Next.js
 * trailingSlash 308 on /api/oidc/jwks → /api/oidc/jwks/ therefore makes jose see
 * a non-200 and throw. Follow the redirect ONCE here and hand jose the final 200
 * URL. No-op when the endpoint doesn't redirect.
 */
async function resolveJwksUri(jwksUri) {
  try {
    const res = await fetch(jwksUri, { method: "GET", redirect: "follow" });
    const finalUrl = res.url;
    await res.text().catch(() => undefined); // drain
    if (res.ok && finalUrl) return finalUrl;
  } catch { /* fall through — jose will surface any real failure */ }
  return jwksUri;
}

/** Resolve + memoise the hub's discovery doc and a JWKS key resolver. */
export async function getDiscovery(issuer, clock = Date.now) {
  const cached = cacheByIssuer.get(issuer);
  if (cached && clock() - cached.fetchedAtMs < DISCOVERY_TTL_MS) return cached;

  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status} ${res.statusText}`);
  const discovery = await res.json();

  for (const k of ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"]) {
    if (!discovery[k]) throw new Error(`OIDC discovery missing required field: ${k}`);
  }

  const entry = {
    discovery,
    jwks: createRemoteJWKSet(new URL(await resolveJwksUri(discovery.jwks_uri))),
    fetchedAtMs: clock(),
  };
  cacheByIssuer.set(issuer, entry);
  return entry;
}

export function clearDiscoveryCache() { cacheByIssuer.clear(); }
