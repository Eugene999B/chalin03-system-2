const CACHE_NAME = "chalin03-group-login-mobile-admin-v3";

const CORE_ASSETS = [
  "/",
  "/site.webmanifest",
  "/favicon-192x192.png",
  "/favicon-512x512.png",
  "/chalin03-logo.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    return;
  }

  // The Chalin service worker must never proxy, fetch or cache Cloudflare
  // Analytics, the API host, or any other third-party origin. External requests
  // continue through the browser under their own CSP directives.
  if (url.origin !== self.location.origin) {
    return;
  }

  if (!/^https?:$/.test(url.protocol)) {
    return;
  }

  if (url.pathname.startsWith("/api")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put("/", responseClone);
          });

          return response;
        })
        .catch(() => caches.match("/"))
    );

    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      return (
        cachedResponse ||
        fetch(request).then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }

          const responseClone = networkResponse.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });

          return networkResponse;
        })
      );
    })
  );
});
