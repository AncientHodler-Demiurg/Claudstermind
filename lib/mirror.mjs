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

import { createHash } from "node:crypto";

export const MIRROR_COOKIE = "cm_mirror";

// The fixed GUID every WebSocket handshake concatenates onto the client's Sec-WebSocket-Key
// before hashing (RFC 6455 §1.3) — not a secret, just part of the protocol's fixed wire format.
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * The Sec-WebSocket-Accept value for a given Sec-WebSocket-Key — what a server hands back to
 * complete a WebSocket handshake by hand. Needed because the relay answers the browser's
 * upgrade directly (raw socket, no `ws` library involved) so the WHOLE mirror connection — relay
 * to browser, and separately agent to the real dev server — stays a byte-for-byte transparent
 * pipe end to end; see relay/server.mjs's `server.on("upgrade", …)` and agent/agent.mjs's
 * mirror-ws-open handler for the two ends this joins.
 */
export function websocketAccept(key) {
  return createHash("sha1").update(String(key) + WEBSOCKET_GUID).digest("base64");
}

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

/**
 * The `X-Forwarded-*` headers to add on top of forwardRequestHeaders() when proxying to a
 * mirrored dev server — so an app that's smart enough to build its own absolute URLs from the
 * request (an OAuth `redirect_uri`, a "return home" link) gets the ACTUAL browser-facing
 * address, not this proxy's own loopback one, plus the `/mirror/<port>` prefix it's being
 * served under. `X-Forwarded-Host`/`X-Forwarded-Proto` are the standard pair for the first part;
 * neither carries a PATH, which is the whole reason `/mirror/<port>` is invisible to an app
 * using only those — `X-Forwarded-Prefix` is the de-facto convention several proxies (and now
 * this one) use to close that gap.
 *
 * Confirmed in production: without this, Mnemosyne's own login route (which already derives its
 * OAuth `redirect_uri` from the request rather than a hard-coded value, precisely to be portable)
 * saw this proxy's own address, built a `redirect_uri` missing the mirror's prefix, and the hub
 * correctly refused it as a `redirect_uri` it had never registered for that client — "clicking
 * Login with AncientHub" landed on the hub's own `{"error":"invalid_request"}`.
 */
export function mirrorForwardedHeaders(headers = {}, port) {
  const get = (n) => headers[n] ?? headers[n.toLowerCase()];
  const host = get("x-forwarded-host") || get("host") || "";
  const proto = get("x-forwarded-proto") || "http";
  return {
    "x-forwarded-host": String(host),
    "x-forwarded-proto": String(proto),
    "x-forwarded-prefix": `/mirror/${port}`,
  };
}

// A WebSocket upgrade is a DIFFERENT shape of request than the regular HTTP proxying above —
// `connection`/`upgrade`/`sec-websocket-*` ARE the handshake itself here, not hop-by-hop noise
// to strip (DROP_REQUEST above drops exactly those, which is right for a normal request and
// would break this one). `host` still gets rewritten (the dev server must see itself, not the
// dashboard).
//
// `cookie`, unlike a regular request, is NOT dropped wholesale here — confirmed by direct
// reproduction against a real Next.js dev server: its HMR upgrade handshake completes at the
// raw-socket level either way (a 101 either way, no visible error), but SILENTLY never finishes
// whatever handoff unblocks Client Component hydration when the cookie header is stripped
// entirely. With it present (in that reproduction, just this project's own `cm_mirror` sticky
// cookie — the dev server itself set none), hydration completes normally. The exact reason
// wasn't isolated further (dev-server-internal), but the fix generalizes safely: forward
// whatever cookies exist EXCEPT the dashboard's own session cookie(s), named by the caller —
// same "never hand the dashboard's session to a site being merely displayed" rule as
// forwardRequestHeaders, just applied by filtering a name out instead of dropping the whole
// header, since (for this handshake specifically) dropping the whole thing turned out to break
// real functionality, not just live-reload.
const DROP_UPGRADE_REQUEST = new Set(["host", "authorization"]);

/** A `cookie` header with specific named cookies removed, everything else kept intact. */
export function stripNamedCookies(cookieHeader, names = []) {
  if (!cookieHeader) return cookieHeader;
  const drop = new Set(names.map((n) => String(n).toLowerCase()));
  if (!drop.size) return cookieHeader;
  const kept = String(cookieHeader)
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && !drop.has(p.slice(0, p.indexOf("=") === -1 ? p.length : p.indexOf("=")).trim().toLowerCase()));
  return kept.length ? kept.join("; ") : undefined;
}

/** Request headers worth forwarding on a WebSocket upgrade — keeps the handshake headers
 *  regular HTTP forwarding would (correctly) drop, and keeps the cookie jar too (see the
 *  comment above) minus whichever cookie names the caller says are the dashboard's own
 *  session — `dropCookieNames` is empty by default, since this module doesn't know the
 *  dashboard's session cookie name(s) itself; the caller (dashboard/server.mjs) supplies it. */
export function forwardUpgradeHeaders(headers = {}, { dropCookieNames = [] } = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || v === null) continue;
    const key = String(k).toLowerCase();
    if (DROP_UPGRADE_REQUEST.has(key)) continue;
    if (key === "cookie" && dropCookieNames.length) {
      const filtered = stripNamedCookies(Array.isArray(v) ? v.join("; ") : String(v), dropCookieNames);
      if (filtered === undefined) continue;
      out[k] = filtered;
      continue;
    }
    out[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

/**
 * The raw HTTP/1.1 request text for a WebSocket upgrade, handshake headers and all — for
 * writing directly to a raw TCP socket to the mirrored dev server. This bypasses `http.request`
 * entirely (see mirror-having-no-live-reload's follow-up: dashboard/server.mjs's own
 * `server.on("upgrade", …)` wants the RAW SOCKET, before any response is parsed, so it can pipe
 * bytes bidirectionally once the upstream's own 101 response arrives) — same wire format any
 * HTTP/1.1 client uses to open a connection, just written by hand.
 */
export function buildUpgradeRequest({ method, path, headers, host, port, dropCookieNames }) {
  const h = { ...forwardUpgradeHeaders(headers, { dropCookieNames }), host: `${host}:${port}` };
  const lines = [`${method} ${path} HTTP/1.1`];
  for (const [k, v] of Object.entries(h)) lines.push(`${k}: ${v}`);
  return lines.join("\r\n") + "\r\n\r\n";
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
 * Root-absolute `fetch()`/`XMLHttpRequest` calls a mirrored page's OWN script makes — e.g.
 * `fetch("/api/me")` — outrun provenance routing (mirrorFromReferer/mirrorFromCookie, below) the
 * moment a client-side router first moves the address bar to some OTHER root-absolute path (a
 * framework's `<Link>`, or Next's own RSC navigation): the request's Referer no longer looks like
 * `/mirror/<port>/…`, and the cookie can't fill the gap either — it can't tell "a second-hop
 * mirrored request" apart from the DASHBOARD's own subsequent traffic, since a stale
 * `cm_mirror` cookie rides along on that too (see mirrorFromCookie's comment: it's a WEAKER
 * signal precisely because of this). Confirmed in production: this is exactly why a mirrored
 * Mnemosyne's own `/api/me` — a path Claudstermind ALSO happens to define — got answered by
 * Claudstermind's own `/api/me` instead of Mnemosyne's, hiding the "Login with AncientHub"
 * button (the header read as already signed in, with an empty name/role, not signed OUT).
 *
 * No request header proves a call came from script running inside the `/mirror/<port>/`
 * document rather than the dashboard's own page, so server-side provenance can't reach this
 * case. Tell the browser directly instead: patch `fetch` and `XMLHttpRequest.open` inside the
 * mirrored document itself, so any root-absolute URL is rewritten to `/mirror/<port>/…` before
 * it ever leaves the browser — landing on the explicit `/mirror/<port>/` route (parseMirrorPath),
 * no provenance guessing needed. This only touches the OUTGOING request target, never
 * `history`/`location`, so it can't confuse a framework's own client-side router — that tracks
 * navigation state independently of whatever URL `fetch()` actually hits over the wire.
 *
 * `WebSocket` gets the same treatment, for a reason that goes well beyond losing live-reload as
 * a nicety. Confirmed by direct reproduction against a real Next.js (App Router, dev mode) site:
 * a Client Component's effects — including a plain `fetch("/api/me")` a header component makes
 * on mount — never ran at all when the page was reached from any origin other than the dev
 * server's own, with byte-IDENTICAL HTML and JS either way. The dev-mode HMR WebSocket actually
 * connecting turned out to be the gate: some framework client runtimes hold hydration open on
 * it, so a dev server mirrored without a working WebSocket can silently leave real functionality
 * inert, not just lose auto-refresh. `WebSocket` URLs are absolute (never root-relative), built
 * from `location`'s own host — same rewrite idea as above, keyed off "is this talking to MY
 * OWN origin" instead of "is this root-absolute", since a same-origin websocket URL is exactly
 * the mirrored page trying to reach itself. The server side of this (actually relaying the
 * upgrade to the dev server) is dashboard/server.mjs's `server.on("upgrade", …)`.
 */
export function mirrorRuntimeScript(port) {
  const prefix = `/mirror/${port}`;
  const body = `(function(){var P=${JSON.stringify(prefix)};` +
    `function rw(u){if(typeof u!=="string")return u;if(u.charAt(0)!=="/")return u;` +
    `if(u===P||u.indexOf(P+"/")===0)return u;return P+u;}` +
    `if(window.fetch){var _f=window.fetch;window.fetch=function(input,init){try{` +
    `if(typeof input==="string"){input=rw(input);}` +
    `else if(input&&typeof input.url==="string"){var r=rw(input.url);` +
    `if(r!==input.url&&typeof Request!=="undefined")input=new Request(r,input);}` +
    `}catch(e){}return _f.call(this,input,init);};}` +
    `if(window.XMLHttpRequest){var _o=window.XMLHttpRequest.prototype.open;` +
    `window.XMLHttpRequest.prototype.open=function(method,url){try{arguments[1]=rw(url);}catch(e){}` +
    `return _o.apply(this,arguments);};}` +
    `if(window.WebSocket){var _WS=window.WebSocket;` +
    `function rwWs(u){try{var a=new URL(u,location.href);` +
    `if(a.host!==location.host)return u;` +
    `if(a.pathname===P||a.pathname.indexOf(P+"/")===0)return u;` +
    `a.pathname=P+a.pathname;return a.toString();}catch(e){return u;}}` +
    `var MWS=function(url,protocols){` +
    `return protocols===undefined?new _WS(rwWs(url)):new _WS(rwWs(url),protocols);};` +
    `MWS.prototype=_WS.prototype;` +
    `MWS.CONNECTING=_WS.CONNECTING;MWS.OPEN=_WS.OPEN;MWS.CLOSING=_WS.CLOSING;MWS.CLOSED=_WS.CLOSED;` +
    `window.WebSocket=MWS;}})();`;
  return `<script>${body}</script>`;
}

/**
 * Inject `<base href="/mirror/<port>/">` (so *relative* URLs resolve) and the fetch/XHR runtime
 * patch above (so *root-absolute* script-issued requests resolve too, including after the page
 * has client-side-navigated away from looking mirrored). Together they cover every URL shape a
 * mirrored page's own script can produce; a full top-level navigation after the address bar has
 * already moved away from `/mirror/<port>/` is the one gap left, and that's provenance routing's
 * job on the first hop only (see the comment above mirrorFromReferer/mirrorFromCookie).
 */
export function injectBase(html, port) {
  const hasBase = /<base\b/i.test(html);               // the page sets its own — don't fight it
  const tag = (hasBase ? "" : `<base href="/mirror/${port}/">`) + mirrorRuntimeScript(port);
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
