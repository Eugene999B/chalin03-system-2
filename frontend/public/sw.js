const CACHE_PREFIX = "chalin03-";
const BUILD_ASSET_PREFIX = "/assets/";
const SHELL_KEY = "/__chalin03_app_shell__";
const release =
  new URL(self.location.href).searchParams.get("release") ||
  "browser-cache-integrity-v35";
const safeRelease =
  String(release).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 96) ||
  "browser-cache-integrity-v35";
const CACHE_NAME = `${CACHE_PREFIX}app-shell-${safeRelease}`;
const CORE_ASSETS = [
  "/site.webmanifest",
  "/favicon-192x192.png",
  "/favicon-512x512.png",
  "/chalin03-logo.png",
];

function responseType(response) {
  return String(response?.headers?.get("Content-Type") || "").toLowerCase();
}

function isHtml(response) {
  return /text\/html|application\/xhtml\+xml/i.test(responseType(response));
}

function isBuildAssetRequest(request, url = new URL(request.url)) {
  return (
    url.pathname.startsWith(BUILD_ASSET_PREFIX) ||
    ["script", "worker", "sharedworker", "serviceworker", "style"].includes(
      request.destination
    ) ||
    /\.(?:js|mjs|css|wasm)$/i.test(url.pathname)
  );
}

function isValidBuildAsset(request, response) {
  if (!response?.ok || response.status !== 200 || isHtml(response)) {
    return false;
  }

  const type = responseType(response);
  const pathname = new URL(request.url).pathname;

  if (request.destination === "style" || /\.css$/i.test(pathname)) {
    return type.includes("text/css");
  }

  if (/\.wasm$/i.test(pathname)) {
    return type.includes("application/wasm");
  }

  return /javascript|ecmascript/i.test(type);
}

function failedBuildAsset(request, status = 410) {
  const pathname = new URL(request.url).pathname;
  const contentType = /\.css$/i.test(pathname)
    ? "text/css; charset=UTF-8"
    : /\.wasm$/i.test(pathname)
      ? "application/wasm"
      : "text/javascript; charset=UTF-8";

  return new Response("", {
    status,
    statusText: "Retired or unavailable build asset",
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "X-Chalin03-Asset-Mismatch": "true",
      "X-Chalin03-Recovery-Owner": "page",
    },
  });
}

function offlineShell() {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chalin 03</title></head><body><main><h1>Chalin 03 is temporarily offline</h1><p>Please reconnect and refresh. Your business records have not been changed.</p></main></body></html>`,
    {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=UTF-8",
        "Cache-Control": "no-store, max-age=0",
        "X-Chalin03-Offline": "true",
      },
    }
  );
}

async function cachedShell() {
  const response = await caches.match(SHELL_KEY);
  return response && isHtml(response) ? response : null;
}

async function fetchCurrentShell() {
  const url = new URL("/", self.location.origin);
  url.searchParams.set("__chalin03_sw_release", safeRelease);
  const response = await fetch(url.toString(), { cache: "no-store" });

  if (!response.ok || !isHtml(response)) {
    throw new Error("Current Chalin 03 app shell was not valid HTML.");
  }

  const cache = await caches.open(CACHE_NAME);
  await cache.put(SHELL_KEY, response.clone());
  return response;
}

async function cacheCurrentShell() {
  await fetchCurrentShell();
}

async function cacheCoreAssets() {
  const cache = await caches.open(CACHE_NAME);

  await Promise.allSettled(
    CORE_ASSETS.map(async (asset) => {
      const response = await fetch(asset, { cache: "reload" });
      if (response?.ok && !isHtml(response)) {
        await cache.put(asset, response.clone());
      }
    })
  );
}

async function notifyClientsOfAssetMismatch(request, response) {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  const cache = await caches.open(CACHE_NAME);
  await cache.delete(SHELL_KEY);

  await Promise.allSettled(
    clients.map((client) =>
      client.postMessage({
        type: "CHALIN03_ASSET_MISMATCH",
        release: safeRelease,
        url: request.url,
        status: Number(response?.status || 0),
        receivedContentType: responseType(response) || null,
        recoveryOwner: "page",
      })
    )
  );
}

async function networkBuildAsset(request) {
  try {
    const response = await fetch(request, { cache: "no-store" });

    if (!isValidBuildAsset(request, response)) {
      await notifyClientsOfAssetMismatch(request, response);
      return failedBuildAsset(
        request,
        response?.status === 404 ? 410 : 502
      );
    }

    // Vite build files are network-only in the worker. The edge/browser may
    // cache immutable hashes, but HTML can never be stored under a .js/.css URL.
    return response;
  } catch {
    await notifyClientsOfAssetMismatch(request, null);
    return failedBuildAsset(request, 503);
  }
}

async function networkNavigation(request) {
  try {
    const response = await fetch(request, { cache: "no-store" });

    if (response?.ok && isHtml(response)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(SHELL_KEY, response.clone());
      return response;
    }
  } catch {
    // A deep route can fail during a release switch. Fetch the root shell next.
  }

  try {
    return await fetchCurrentShell();
  } catch {
    return (await cachedShell()) || offlineShell();
  }
}

async function networkCoreAsset(request) {
  try {
    const response = await fetch(request, { cache: "no-cache" });

    if (response?.ok && !isHtml(response)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
      return response;
    }
  } catch {
    // Fall through to the previously verified core asset.
  }

  return (
    (await caches.match(request)) ||
    new Response("", {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  );
}

function isTrustedClientMessage(event) {
  if (event.origin !== self.location.origin) {
    return false;
  }

  const sourceUrl = event.source?.url;
  if (!sourceUrl) {
    return false;
  }

  try {
    return new URL(sourceUrl).origin === self.location.origin;
  } catch {
    return false;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.allSettled([cacheCurrentShell(), cacheCoreAssets()])
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((names) =>
        Promise.all(
          names
            .filter(
              (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME
            )
            .map((name) => caches.delete(name))
        )
      ),
      self.clients.claim(),
    ])
  );
});

self.addEventListener("message", (event) => {
  if (!isTrustedClientMessage(event)) {
    return;
  }

  if (event.data?.type === "CHALIN03_SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (!/^https?:$/.test(url.protocol)) return;
  if (url.pathname.startsWith("/api")) return;

  if (isBuildAssetRequest(request, url)) {
    event.respondWith(networkBuildAsset(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkNavigation(request));
    return;
  }

  if (CORE_ASSETS.includes(url.pathname)) {
    event.respondWith(networkCoreAsset(request));
  }
});