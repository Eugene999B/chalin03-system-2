const CACHE_NAME = "chalin03-installment-finance-separation-v17";

const CORE_ASSETS = [
  "/",
  "/site.webmanifest",
  "/favicon-192x192.png",
  "/favicon-512x512.png",
  "/chalin03-logo.png"
];

function buildOfflineResponse() {
  return new Response(
    "Chalin 03 is temporarily offline. Please reconnect and try again.",
    {
      status: 503,
      statusText: "Service Unavailable",
      headers: {
        "Content-Type": "text/plain; charset=UTF-8",
        "Cache-Control": "no-store",
      },
    }
  );
}

async function cachedResponseOrOffline(request, fallbackRequest = null) {
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  if (fallbackRequest) {
    const fallbackResponse = await caches.match(fallbackRequest);

    if (fallbackResponse) {
      return fallbackResponse;
    }
  }

  return buildOfflineResponse();
}

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
          if (response?.ok) {
            const responseClone = response.clone();

            caches.open(CACHE_NAME).then((cache) => {
              cache.put("/", responseClone);
            });
          }

          return response;
        })
        .catch(() => cachedResponseOrOffline("/"))
    );

    return;
  }

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse || buildOfflineResponse();
        }

        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseClone);
        });
        return networkResponse;
      })
      .catch(() => cachedResponseOrOffline(request))
  );
});
