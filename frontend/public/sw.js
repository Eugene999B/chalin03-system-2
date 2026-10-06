const CACHE_PREFIX = "chalin03-";

async function retireOfflineWorker() {
  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => String(name).startsWith(CACHE_PREFIX))
        .map((name) => caches.delete(name))
    );
  } catch {}

  try {
    await self.registration.unregister();
  } catch {}
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(retireOfflineWorker());
});

// Intentionally no fetch handler.
// This temporary worker removes the cached Chalin03 offline shell so that
// when the public DNS host is disconnected, navigation fails natively in
// the browser instead of returning a Chalin03-generated offline page.
