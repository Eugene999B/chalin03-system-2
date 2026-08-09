const UPSTREAM_API_ORIGIN = "https://chalin03-system-2-staging.up.railway.app";
const STAGING_PAGES_HOST = "chalin-one-staging-preview.pages.dev";
const REDIRECT_STATUS_CODES = new Set([301, 302, 307, 308]);
const SAFE_METHODS = new Set(["GET", "HEAD"]);
const STATIC_ASSET_EXTENSION = /\.(?:avif|bmp|css|csv|eot|gif|ico|jpe?g|js|json|map|mjs|mp3|mp4|ogg|otf|pdf|png|svg|ttf|txt|webm|webp|woff2?|xml)$/i;

function isApprovedStagingHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  return host === STAGING_PAGES_HOST || host.endsWith(`.${STAGING_PAGES_HOST}`);
}

function shouldBypass(pathname, method) {
  if (!SAFE_METHODS.has(String(method || "").toUpperCase())) return true;
  if (pathname === "/api" || pathname.startsWith("/api/")) return true;
  if (pathname.startsWith("/assets/") || pathname.startsWith("/.well-known/")) return true;
  return STATIC_ASSET_EXTENSION.test(pathname);
}

function normalizeSourcePath(value) {
  const raw = String(value || "").trim();
  if (!/^\/(?!\/)/.test(raw)) return "";
  try {
    const parsed = new URL(raw, "https://chalin.invalid");
    if (parsed.search || parsed.hash) return "";
    let pathname = parsed.pathname.replace(/\/{2,}/g, "/");
    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
    return pathname || "/";
  } catch {
    return "";
  }
}

function safeRedirectDestination(value) {
  const raw = String(value || "").trim();
  if (/^\/(?!\/)/.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function resolverUrl(pathname) {
  const url = new URL("/api/public/redirects/resolve", UPSTREAM_API_ORIGIN);
  url.searchParams.set("path", pathname);
  return url;
}

async function lookupRedirect(pathname) {
  const response = await fetch(resolverUrl(pathname).toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Chalin-One-Staging-Gateway": "cloudflare-pages-redirect-v1",
    },
    redirect: "manual",
  });
  if (!response.ok) return null;
  const body = await response.json();
  return body?.data ?? null;
}

function governedRedirectResponse(redirect, pathname) {
  if (!redirect || normalizeSourcePath(redirect.source_path) !== pathname) return null;
  const status = Number(redirect.redirect_status);
  if (!REDIRECT_STATUS_CODES.has(status)) return null;
  const destination = safeRedirectDestination(redirect.destination_url);
  if (!destination) return null;

  const headers = new Headers({
    Location: destination,
    "Cache-Control": "no-store, max-age=0",
    "X-Chalin-One-Redirect": "governed-edge-v1",
  });
  return new Response(null, { status, headers });
}

export async function onRequest(context) {
  const incoming = new URL(context.request.url);

  if (!isApprovedStagingHost(incoming.hostname)) {
    return context.next();
  }
  if (shouldBypass(incoming.pathname, context.request.method)) {
    return context.next();
  }

  const pathname = normalizeSourcePath(incoming.pathname);
  if (!pathname) return context.next();

  try {
    const redirect = await lookupRedirect(pathname);
    return governedRedirectResponse(redirect, pathname) || context.next();
  } catch {
    // Redirect intelligence must never make the public site unavailable.
    return context.next();
  }
}

export {
  REDIRECT_STATUS_CODES,
  SAFE_METHODS,
  STAGING_PAGES_HOST,
  UPSTREAM_API_ORIGIN,
  governedRedirectResponse,
  isApprovedStagingHost,
  normalizeSourcePath,
  resolverUrl,
  safeRedirectDestination,
  shouldBypass,
};
