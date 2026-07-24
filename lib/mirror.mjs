// Mirror — viewing a dev server that runs on the work machine.
//
// The hard part isn't the proxying, it's the URLs. A mirrored page is served at
// `/mirror/<port>/`, but the site inside it was written assuming it owns the origin,
// so it asks for `/assets/index.js` and `fetch("/api/status")` — root-absolute paths
// that land on the DASHBOARD, not on the mirrored server. `<base href>` doesn't help:
// it only rewrites *relative* URLs.
//
// So instead of rewriting HTML (fragile, and impossible for URLs built at runtime in
// JS), we route by provenance: a request that matches no dashboard route, but whose
// Referer is a mirrored page, belongs to that mirror. A cookie backs this up for the
// nested cases Referer can't reach — a stylesheet's `@import`, a module's static
// import — where the Referer is the sub-resource, not the page.
//
// Everything here is pure so both transports can share it: the local dashboard (direct
// fetch to 127.0.0.1) and the live relay (the same request tunneled to the bridge).

export const MIRROR_COOKIE = "cm_mirror";

/** `/mirror/3002/a/b` → `{ port: 3002, sub: "/a/b" }`; anything else → null. */
export function parseMirrorPath(pathname) {
  const m = /^\/mirror\/(\d+)(\/.*)?$/.exec(pathname || "");
  if (!m) return null;
  return { port: Number(m[1]), sub: m[2] || "/" };
}

/** The port a mirrored page was served from, read out of a Referer header. */
export function mirrorPortFromReferer(referer) {
  if (!referer) return null;
  let pathname;
  try { pathname = new URL(referer).pathname; } catch { return null; }
  const m = /^\/mirror\/(\d+)(\/|$)/.exec(pathname);
  return m ? Number(m[1]) : null;
}

/** The sticky mirror port, for sub-resources of sub-resources. */
export function mirrorPortFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  for (const part of String(cookieHeader).split(";")) {
    const [k, v] = part.split("=");
    if (k && k.trim() === MIRROR_COOKIE) {
      const n = Number(String(v || "").trim());
      return Number.isInteger(n) && n > 0 ? n : null;
    }
  }
  return null;
}

// Hop-by-hop headers are meaningless to forward — they describe THIS connection, not
// the message. `host` must go too, or the dev server sees the dashboard's hostname.
const DROP_REQUEST = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "content-length",
  // Never hand the dashboard's session to a dev server we're merely displaying.
  "cookie", "authorization",
]);

const DROP_RESPONSE = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
  // fetch() already decoded the body; passing the original encoding/length through
  // makes the browser try to gunzip plain bytes, or truncate at the wrong offset.
  "content-encoding", "content-length",
  // A mirrored site must not be able to set cookies on the dashboard's origin —
  // it could clobber the session cookie.
  "set-cookie",
  // Its framing/security policy is about ITS origin; applied here it can break the
  // iframe or the dashboard around it.
  "x-frame-options", "content-security-policy", "content-security-policy-report-only",
  "strict-transport-security",
]);

/** Request headers worth forwarding to the mirrored server. */
export function forwardRequestHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || v === null) continue;
    if (DROP_REQUEST.has(String(k).toLowerCase())) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

/** Response headers worth handing back to the browser. */
export function forwardResponseHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || v === null) continue;
    if (DROP_RESPONSE.has(String(k).toLowerCase())) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

/**
 * Keep a redirect inside the mirror. A dev server answering `/` with a 302 to `/login`
 * would otherwise bounce the iframe to the DASHBOARD's `/login`.
 */
export function rewriteLocation(location, port) {
  if (!location) return location;
  if (/^https?:\/\//i.test(location)) {
    // Absolute, but pointing back at the mirrored server itself — re-root it.
    try {
      const u = new URL(location);
      if (u.port && Number(u.port) === Number(port)) return `/mirror/${port}${u.pathname}${u.search}${u.hash}`;
    } catch {}
    return location;                                   // genuinely elsewhere: leave it alone
  }
  if (location.startsWith("/")) return `/mirror/${port}${location}`;
  return location;                                     // relative: <base> already handles it
}

const isHtml = (contentType) => /text\/html/i.test(contentType || "");

/**
 * Inject `<base href="/mirror/<port>/">` so *relative* URLs resolve. Root-absolute ones
 * are handled by referer/cookie routing instead — deliberately not rewritten here,
 * because a regex over HTML can't see URLs that JavaScript builds at runtime.
 */
export function injectBase(html, port) {
  const tag = `<base href="/mirror/${port}/">`;
  if (/<base\b/i.test(html)) return html;              // the page sets its own — don't fight it
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1>${tag}`);
  return tag + html;
}

/**
 * Shape a proxied response for the browser: filtered headers, a mirror-scoped redirect,
 * a `<base>` in HTML, and the sticky-mirror cookie so nested sub-resources can be routed.
 *
 * @param {{status:number, headers:object, body:Buffer}} upstream
 * @returns {{status:number, headers:object, body:Buffer}}
 */
export function buildMirrorResponse(upstream, port) {
  const headers = forwardResponseHeaders(upstream.headers || {});
  const ct = Object.entries(upstream.headers || {}).find(([k]) => k.toLowerCase() === "content-type")?.[1] || "";
  let body = upstream.body ?? Buffer.alloc(0);

  const loc = Object.entries(upstream.headers || {}).find(([k]) => k.toLowerCase() === "location")?.[1];
  if (loc) headers.location = rewriteLocation(Array.isArray(loc) ? loc[0] : loc, port);

  if (isHtml(ct)) body = Buffer.from(injectBase(body.toString("utf8"), port), "utf8");

  headers["content-type"] = ct || "application/octet-stream";
  headers["cache-control"] = "no-store";
  // Path=/ because the whole point is to catch requests that land OUTSIDE /mirror/.
  // SameSite=Lax keeps it off cross-site requests; it carries no authority anyway.
  headers["set-cookie"] = `${MIRROR_COOKIE}=${port}; Path=/; SameSite=Lax`;
  return { status: upstream.status || 200, headers, body };
}

// The two signals are deliberately SEPARATE, because they belong at different points in
// the route table:
//
//   mirrorFromReferer — proof. This request was made BY a mirrored page, so it belongs to
//     that mirror even if the dashboard also has something at that path. Checked FIRST,
//     ahead of the dashboard's own routes: a mirrored SPA asking for /styles.css must get
//     the mirrored site's stylesheet, not the dashboard's.
//
//   mirrorFromCookie — a guess. It only says "this browser looked at a mirror recently",
//     which is true of every subsequent dashboard request too. Checked LAST, after the
//     dashboard's routes and static files have had their say, so it can only ever claim
//     paths the dashboard doesn't serve. Getting this order wrong means the dashboard
//     serves a mirrored site's app.js in place of its own — silently, with a 200.
//
// Navigations USED to be excluded from both, on the theory that a mistyped dashboard URL
// should 404 on the dashboard rather than turn into the mirrored site. In practice this broke
// the single most common real interaction with a mirrored SPA: clicking an internal link. A
// framework router (Next.js's <Link>, or a plain <a href="/foo">) navigates the IFRAME using a
// ROOT-ABSOLUTE path, because the mirrored app has no idea it's being displayed inside
// /mirror/<port>/ — so the resulting request is a `sec-fetch-mode: navigate` GET for `/foo`,
// which the old exclusion handed straight to the dashboard's own routes, 404ing every time
// (confirmed in production: every in-app navigation inside a mirrored Next.js app 404'd).
//
// The "mistyped URL" risk this guarded against turns out to be structurally already covered by
// two things that don't depend on excluding navigations at all: (1) the dashboard's OWN
// protected routes (/auth/*, and callers now check mirror-referer before any colliding route
// name) are matched before this can ever run, so they can never be shadowed; (2) mirrorFromCookie
// is only ever consulted as the LAST resort, after every real dashboard route AND static file
// (index.html, app.js, …) has already had first refusal via sendFile-then-fallback — so it can
// only ever claim a path that would otherwise be a bare 404 regardless. mirrorFromReferer needs
// a genuine Referer proof (you must have actually just been served a /mirror/<port>/… page) —
// exactly the signal that separates "clicked a link inside the mirror" from "typed a random URL".
const allow = (port, allowedPorts) =>
  !port ? null : (allowedPorts && !allowedPorts.includes(port) ? null : port);

/** The mirror this request demonstrably came from, per its Referer — including navigations
 *  (clicking a link inside a mirrored SPA), which is the whole point; see the comment above. */
export function mirrorFromReferer(headers = {}, { allowedPorts = null } = {}) {
  const get = (n) => headers[n] ?? headers[n.toLowerCase()];
  return allow(mirrorPortFromReferer(get("referer")), allowedPorts);
}

/**
 * The mirror this browser was last looking at. For nested resources whose Referer is a
 * sub-resource rather than the page — a stylesheet's `@import`, a module's static import — AND
 * for a navigation that landed on a root-absolute path with no mirror-shaped Referer of its own
 * (a second hop: the framework's router already rewrote the address bar once, so this request's
 * OWN Referer no longer looks like /mirror/<port>/…, only the cookie remembers). Only safe once
 * nothing else has claimed the path — see the comment above for why that's true even here.
 */
export function mirrorFromCookie(headers = {}, { allowedPorts = null } = {}) {
  const get = (n) => headers[n] ?? headers[n.toLowerCase()];
  // A Referer that points at a real mirror is handled earlier; if one points somewhere
  // else entirely we still allow the cookie, since that's exactly the nested case.
  return allow(mirrorPortFromCookie(get("cookie")), allowedPorts);
}
