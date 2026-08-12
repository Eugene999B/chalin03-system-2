const UPSTREAM_API_ORIGIN = "https://api.chalin03.com";
const STAGING_UPSTREAM_API_ORIGIN = "https://chalin03-system-2-staging.up.railway.app";
const STAGING_PAGES_HOST = "chalin-one-staging-preview.pages.dev";
const NO_BODY_METHODS = new Set(["GET", "HEAD"]);
const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const CLOUDFLARE_HOP_REQUEST_HEADERS = new Set([
  "cdn-loop",
  "cf-connecting-ip",
  "cf-ew-via",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cf-worker",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
]);
const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function isApprovedStagingHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  return host === STAGING_PAGES_HOST || host.endsWith(`.${STAGING_PAGES_HOST}`);
}

function upstreamUrlFor(requestUrl) {
  const incoming = new URL(requestUrl);
  const upstream = new URL(
    isApprovedStagingHost(incoming.hostname)
      ? STAGING_UPSTREAM_API_ORIGIN
      : UPSTREAM_API_ORIGIN
  );
  upstream.pathname = incoming.pathname;
  upstream.search = incoming.search;
  return upstream;
}

function upstreamHeadersFor(request) {
  const headers = new Headers(request.headers);
  for (const header of HOP_BY_HOP_REQUEST_HEADERS) {
    headers.delete(header);
  }
  for (const header of CLOUDFLARE_HOP_REQUEST_HEADERS) {
    headers.delete(header);
  }

  const hostname = new URL(request.url).hostname;
  if (isApprovedStagingHost(hostname)) {
    headers.delete("origin");
    headers.delete("referer");
    headers.set("X-Chalin-One-Staging-Gateway", "cloudflare-pages-v2");
  }
  headers.set("X-Chalin03-Same-Origin-Proxy", "cloudflare-pages-v2");
  return headers;
}

function responseHeadersFor(upstreamResponse) {
  const headers = new Headers(upstreamResponse.headers);
  for (const header of HOP_BY_HOP_RESPONSE_HEADERS) {
    headers.delete(header);
  }

  // The browser-to-Pages hop is same-origin. CORS belongs only to the internal
  // Pages-to-API hop and must not leak back as contradictory browser policy.
  headers.delete("access-control-allow-origin");
  headers.delete("access-control-allow-credentials");
  headers.delete("access-control-allow-headers");
  headers.delete("access-control-allow-methods");
  headers.delete("access-control-max-age");

  headers.set("X-Chalin03-API-Path", "same-origin-pages-proxy-v2");
  headers.set("X-Chalin-One-API-Path", "same-origin-pages-gateway-v2");
  headers.set("Cache-Control", "no-store, max-age=0");
  return headers;
}

function jsonError(status, code, message, diagnostic = "") {
  const headers = {
    "Content-Type": "application/json; charset=UTF-8",
    "Cache-Control": "no-store, max-age=0",
    "X-Chalin03-API-Path": "same-origin-pages-proxy-v2",
    "X-Chalin-One-API-Path": "same-origin-pages-gateway-v2",
  };
  if (diagnostic) {
    headers["X-Chalin03-Gateway-Diagnostic"] = diagnostic;
  }

  return new Response(
    JSON.stringify({
      status: "error",
      code,
      message,
    }),
    { status, headers }
  );
}

function classifyFetchFailure(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (message.includes("1042") || message.includes("another worker")) {
    return "same-zone-worker-route";
  }
  if (message.includes("1019") || message.includes("loop")) {
    return "worker-loop-protection";
  }
  if (message.includes("dns") || message.includes("resolve")) {
    return "upstream-dns";
  }
  return "upstream-fetch";
}

export async function onRequest({ request }) {
  const incoming = new URL(request.url);
  const host = String(incoming.hostname || "").toLowerCase();
  if (host.endsWith(".pages.dev") && !isApprovedStagingHost(host)) {
    return jsonError(403, "API_PROXY_HOST_BLOCKED", "This Pages API gateway is not approved for CHALIN ONE staging.");
  }
  if (!incoming.pathname.startsWith("/api")) {
    return jsonError(404, "API_PROXY_PATH_INVALID", "The API proxy path is invalid.");
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        Allow: "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
        "Cache-Control": "no-store, max-age=0",
        "X-Chalin03-API-Path": "same-origin-pages-proxy-v2",
      },
    });
  }

  const upstreamUrl = upstreamUrlFor(request.url);
  const init = {
    method: request.method,
    headers: upstreamHeadersFor(request),
    redirect: "manual",
  };

  if (!NO_BODY_METHODS.has(request.method)) {
    init.body = request.body;
  }

  try {
    const upstreamResponse = await fetch(upstreamUrl.toString(), init);
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeadersFor(upstreamResponse),
    });
  } catch (error) {
    const diagnostic = classifyFetchFailure(error);
    console.error("Chalin 03 same-origin API proxy failed", {
      path: incoming.pathname,
      method: request.method,
      staging: isApprovedStagingHost(incoming.hostname),
      diagnostic,
      message: error?.message || String(error),
    });
    return jsonError(
      502,
      "API_PROXY_UPSTREAM_UNAVAILABLE",
      "The Chalin 03 API gateway could not reach the upstream service.",
      diagnostic
    );
  }
}

export {
  CLOUDFLARE_HOP_REQUEST_HEADERS,
  NO_BODY_METHODS,
  STAGING_PAGES_HOST,
  STAGING_UPSTREAM_API_ORIGIN,
  UPSTREAM_API_ORIGIN,
  classifyFetchFailure,
  isApprovedStagingHost,
  responseHeadersFor,
  upstreamHeadersFor,
  upstreamUrlFor,
};
