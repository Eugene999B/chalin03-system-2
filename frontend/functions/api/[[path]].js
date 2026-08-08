const UPSTREAM_API_ORIGIN = "https://chalin03-system-2-staging.up.railway.app";
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
  return (
    host === STAGING_PAGES_HOST ||
    host.endsWith(`.${STAGING_PAGES_HOST}`)
  );
}

function upstreamUrlFor(requestUrl) {
  const incoming = new URL(requestUrl);
  const upstream = new URL(UPSTREAM_API_ORIGIN);
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

  // This is now a server-to-server request. Do not forward the browser Origin
  // header and accidentally invoke browser CORS policy on the Railway hop.
  headers.delete("origin");
  headers.delete("referer");
  headers.set("X-Chalin-One-Staging-Gateway", "cloudflare-pages-v1");
  return headers;
}

function responseHeadersFor(upstreamResponse) {
  const headers = new Headers(upstreamResponse.headers);
  for (const header of HOP_BY_HOP_RESPONSE_HEADERS) {
    headers.delete(header);
  }

  headers.delete("access-control-allow-origin");
  headers.delete("access-control-allow-credentials");
  headers.delete("access-control-allow-headers");
  headers.delete("access-control-allow-methods");
  headers.delete("access-control-max-age");

  headers.set("X-Chalin-One-API-Path", "same-origin-pages-gateway-v1");
  headers.set("Cache-Control", "no-store, max-age=0");
  return headers;
}

function jsonError(status, code, message) {
  return new Response(
    JSON.stringify({ status: "error", code, message }),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Cache-Control": "no-store, max-age=0",
        "X-Chalin-One-API-Path": "same-origin-pages-gateway-v1",
      },
    }
  );
}

export async function onRequest({ request }) {
  const incoming = new URL(request.url);

  if (!isApprovedStagingHost(incoming.hostname)) {
    return jsonError(
      403,
      "CHALIN_ONE_STAGING_GATEWAY_HOST_BLOCKED",
      "This staging API gateway is available only on the CHALIN ONE staging Pages host."
    );
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
        "X-Chalin-One-API-Path": "same-origin-pages-gateway-v1",
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
    console.error("CHALIN ONE staging same-origin API gateway failed", {
      path: incoming.pathname,
      method: request.method,
      message: error?.message || String(error),
    });

    return jsonError(
      502,
      "CHALIN_ONE_STAGING_UPSTREAM_UNAVAILABLE",
      "The staging API gateway could not reach the Railway staging service."
    );
  }
}

export {
  STAGING_PAGES_HOST,
  UPSTREAM_API_ORIGIN,
  isApprovedStagingHost,
  responseHeadersFor,
  upstreamHeadersFor,
  upstreamUrlFor,
};
