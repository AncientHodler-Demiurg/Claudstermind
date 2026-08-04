// Claudstermind service worker — the MINIMUM needed to make the site installable as a PWA
// ("add to home screen" → standalone app), plus an offline fallback. Deliberately NETWORK-FIRST
// and, for the app shell, network-ONLY-with-bypass: it can never serve a stale build. This matters
// because a stale cached shell showed the OLD desktop layout on phones ("what did you build?").
const CACHE = "cm-shell-v2";   // bumped: v1 caches (which may hold a pre-mobile shell) are dropped on activate
// Only truly-static, rarely-changing assets are pre-cached. NEVER the html/js/css shell — those must
// always be fresh from the network (a deploy has to show up immediately), and the server sends them
// `no-store` for the same reason.
const PRECACHE = ["/brand/claudstermind-mark.png?v=2", "/brand/claudstermind-glow.png", "/brand/favicon.png?v=2"];
const SHELL_RE = /\.(html|js|css|webmanifest)$/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {}));
  self.skipWaiting();   // a new SW takes over immediately, no "close all tabs" limbo
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // Drop ALL older cache versions (v1 may hold a pre-mobile shell), then claim open pages.
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never touch cross-origin, API, or the event stream — straight to network.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/mirror/")) return;

  const isShell = req.mode === "navigate" || SHELL_RE.test(url.pathname);

  e.respondWith((async () => {
    try {
      // For the shell, force a real network trip that BYPASSES the browser HTTP cache
      // (`cache: "reload"`) so a stale HTTP-cached copy can never sneak through. Static assets
      // (images) use the normal cache — they're versioned by query string.
      const res = isShell ? await fetch(req, { cache: "reload" }) : await fetch(req);
      if (res && res.ok && res.type === "basic" && !isShell) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch {
      // Offline: fall back to whatever we have (static assets, or a cached shell for navigations).
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === "navigate") { const shell = await caches.match("/"); if (shell) return shell; }
      throw new Error("offline and uncached");
    }
  })());
});
