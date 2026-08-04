// Claudstermind service worker — the MINIMUM needed to make the site installable as a PWA
// ("add to home screen" → standalone app), plus an offline fallback. Deliberately NETWORK-FIRST:
// when online it ALWAYS serves the freshest response and never a cached one, so it can't
// reintroduce the stale-version / black-screen problems we fought earlier (see the CHANGELOG's
// typing-lag saga). The cache is only ever consulted as a fallback when the network fails.
const CACHE = "cm-shell-v1";
// Only truly-static, rarely-changing assets are worth pre-caching for a fast/offline first paint.
// NOT app.js / styles.css / index.html — those must always come from the network so a deploy is
// picked up instantly (they're served `no-cache` by the server for the same reason).
const PRECACHE = ["/brand/claudstermind-mark.png?v=2", "/brand/claudstermind-glow.png", "/brand/favicon.png?v=2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {}));
  self.skipWaiting();   // a new SW takes over immediately, no "close all tabs" limbo
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // Drop any older cache versions, then claim open pages so this SW controls them right away.
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // Only handle same-origin GETs; never touch API calls, the event stream, or cross-origin (the
  // LocalHost mirror, the relay). Let those go straight to the network untouched.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/mirror/")) return;

  // Network-first: try the network (always freshest), fall back to cache only if offline. Cache
  // successful responses in the background so a later offline load has something to show.
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      // Last resort for a navigation with nothing cached: the app shell if we have it.
      if (req.mode === "navigate") { const shell = await caches.match("/"); if (shell) return shell; }
      throw new Error("offline and uncached");
    }
  })());
});
