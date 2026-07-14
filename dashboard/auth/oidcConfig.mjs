// Env → OIDC config. The switch between LOCAL and LIVE mode.
//
//   LOCAL (any var unset)  → readOidcConfig() returns null → auth disabled entirely,
//                            dashboard behaves exactly as it did before auth existed,
//                            and the local-only actions (backup/restore/master-pollinate)
//                            are available.
//   LIVE  (all vars set)   → auth required; local-only actions are hidden/refused,
//                            because they only make sense on the work machine.
//
// There is deliberately no half-configured state: a partially-set env is a config
// error, not "auth off" — otherwise a typo'd var name on the live box would silently
// disable the login.

const REQUIRED = [
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_REDIRECT_URI",
  "SESSION_SECRET",
];

/**
 * @returns {null} when NONE of the OIDC vars are set (local dev).
 * @throws when SOME but not all are set (config error — fail loud).
 */
export function readOidcConfig(env = process.env) {
  const present = REQUIRED.filter((k) => typeof env[k] === "string" && env[k].length > 0);
  if (present.length === 0) return null; // local mode

  if (present.length < REQUIRED.length) {
    const missing = REQUIRED.filter((k) => !present.includes(k));
    throw new Error(
      `OIDC is partially configured — set all of ${REQUIRED.join(", ")} or none. Missing: ${missing.join(", ")}`,
    );
  }

  if (env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters (it signs the session cookie)");
  }

  return {
    issuer: env.OIDC_ISSUER.replace(/\/$/, ""),
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    redirectUri: env.OIDC_REDIRECT_URI,
    sessionSecret: env.SESSION_SECRET,
    scope: env.OIDC_SCOPE || "openid profile email roles",
  };
}

/** true when running as the live, authenticated deployment. */
export const isLive = (cfg) => cfg !== null;
