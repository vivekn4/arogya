/* ==========================================================================
   Arogya service worker
   Crafted by Vivek Nair (VN) — https://github.com/vivekn4
   - Precache the app shell on install (each asset added individually so one
     missing file can't fail the whole install).
   - Cache-first for same-origin static assets.
   - Network-only for /api/* (never cache chat traffic).
   - Navigation requests fall back to the cached app shell when offline.
   ========================================================================== */

const CACHE = "arogya-v2";

const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./config.js",
  "./sfx.js",
  "./particles.js",
  "./app.js",
  "./manifest.json",
  "./icons/favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.allSettled(PRECACHE.map((url) => cache.add(url).catch(() => null)))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept non-GET or cross-origin traffic, and never cache API calls.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;

  // Navigations: network first, fall back to the cached shell offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Static assets: cache first, then network (and populate the cache).
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
    )
  );
});
