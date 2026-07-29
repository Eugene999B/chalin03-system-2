const CACHE_NAME = "chalin03-installment-runtime-stability-v18";
// Previous verified cache marker: chalin03-installment-finance-separation-v17

const CORE_ASSETS = [
  "/",
  "/site.webmanifest",
  "/favicon-192x192.png",
  "/favicon-512x512.png",
  "/chalin03-logo.png"
];

function buildOfflineResponse() {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chalin 03</title>
  <style>
    body{margin:0;font-family:Arial,sans-serif;background:#f5f7fb;color:#10213b;display:grid;min-height:100vh;place-items:center;padding:24px;box-sizing:border-box}
    main{max-width:560px;background:#fff;border:1px solid #dbe3ef;border-radius:20px;padding:30px;box-shadow:0 18px 50px rgba(16,33,59,.12);text-align:center}
    h1{margin:0 0 12px;font-size:1.6rem}p{margin:0;line-height:1.6;color:#526178}
  </style>
</head>
<body><main><h1>Chalin 03 is temporarily offline</h1><p>Please reconnect, then refresh this page. Your saved business records have not been changed.</p></main></body>
</html>`,
    {
      status: 200,
      statusText: "OK",
      headers: {
        "Content-Type": "text/html; charset=UTF-8",
        "Cache-Control": "no-store",
        "X-Chalin03-Offline": "true",
      },
    }
  );
}

async function cachedResponseOrOffline(request, fallbackRequest = null) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) return cachedResponse;

  if (fallbackRequest) {
    const fallbackResponse = await caches.match(fallbackRequest);
    if (fallbackResponse) return fallbackResponse;
  }

  return buildOfflineResponse();
}

async function cacheCoreAssets() {
  const cache = await caches.open(CACHE_NAME);

  // The app shell is essential for React routes. Cache it first so one missing
  // icon or manifest cannot cause the entire service-worker install to fail.
  await cache.add(new Request("/", { cache: "reload" }));

  await Promise.allSettled(
    CORE_ASSETS.filter((asset) => asset !== "/").map((asset) =>
      cache.add(new Request(asset, { cache: "reload" }))
    )
  );
}

async function networkNavigation(request) {
  try {
    const response = await fetch(request);
    if (response?.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put("/", response.clone());
      return response;
    }

    const cachedShell = await caches.match("/");
    return cachedShell || response || buildOfflineResponse();
  } catch {
    try {
      const rootResponse = await fetch(new Request("/", { cache: "no-store" }));
      if (rootResponse?.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put("/", rootResponse.clone());
        return rootResponse;
      }
    } catch {
      // Fall through to the previously cached application shell.
    }

    return cachedResponseOrOffline("/");
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheCoreAssets());
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

  if (request.method !== "GET") return;

  // Never proxy or cache API, analytics or third-party requests.
  if (url.origin !== self.location.origin) return;
  if (!/^https?:$/.test(url.protocol)) return;
  if (url.pathname.startsWith("/api")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkNavigation(request));
    return;
  }

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse || cachedResponseOrOffline(request);
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
