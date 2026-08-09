const UPSTREAM_API_ORIGIN = "https://chalin03-system-2-staging.up.railway.app";
const STAGING_PAGES_HOST = "chalin-one-staging-preview.pages.dev";
const SEO_INVENTORY_PATH = "/api/public/redirects/seo/inventory";
const TECHNICAL_SEO_PATHS = new Set(["/robots.txt", "/sitemap.xml"]);
const REDIRECT_STATUS_CODES = new Set([301, 302, 307, 308]);
const SAFE_METHODS = new Set(["GET", "HEAD"]);
const STATIC_ASSET_EXTENSION = /\.(?:avif|bmp|css|csv|eot|gif|ico|jpe?g|js|json|map|mjs|mp3|mp4|ogg|otf|pdf|png|svg|ttf|txt|webm|webp|woff2?|xml)$/i;
const KNOWN_STATIC_PUBLIC_PATHS = new Set([
  "/",
  "/about",
  "/businesses",
  "/projects",
  "/equipment",
  "/news",
  "/leadership",
  "/media",
  "/careers",
  "/locations",
  "/contact",
  "/faqs",
  "/tenders",
  "/testimonials",
]);
const RESERVED_PLATFORM_PREFIXES = new Set([
  "api",
  "login",
  "owner-recovery",
  "content-studio",
  "intelligence",
  "staff",
  "products",
  "new-sale",
  "sales-history",
  "installments",
  "debts",
  "change-password",
  "help",
  "notifications",
  "shared-controls",
  "customer-statement",
  "reports",
  "audit-accounting",
  "audit-signoffs",
  "advanced-accounting-intelligence",
  "exports",
  "audit-unlock-requests",
  "low-stock",
  "stock-transfers",
  "expenses",
  "purchases",
  "returns",
  "daily-closing",
  "sms",
  "users-settings",
  "user-permissions",
  "activity-log",
  "backup",
  "security-centre",
  "professional-backups",
  "workers",
  "employment-documents",
  "document-signature-settings",
  "system-operations",
  "backup-restore",
  "maintenance",
  "mining",
  "mining-operations",
  "equipment-hire",
  "equipment-hire-operations",
  "equipment-installment-finance",
  "group-executive-control",
  "fleet-assets",
  "operations-documents-accounting",
]);

function isApprovedStagingHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  return host === STAGING_PAGES_HOST || host.endsWith(`.${STAGING_PAGES_HOST}`);
}

function firstPathSegment(pathname) {
  return String(pathname || "").replace(/^\/+/, "").split("/")[0] || "";
}

function isReservedPlatformPath(pathname) {
  return RESERVED_PLATFORM_PREFIXES.has(firstPathSegment(pathname));
}

function shouldBypass(pathname, method) {
  if (!SAFE_METHODS.has(String(method || "").toUpperCase())) return true;
  if (KNOWN_STATIC_PUBLIC_PATHS.has(pathname)) return true;
  if (isReservedPlatformPath(pathname)) return true;
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

function seoInventoryUrl() {
  return new URL(SEO_INVENTORY_PATH, UPSTREAM_API_ORIGIN).toString();
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

async function loadSeoInventory() {
  const response = await fetch(seoInventoryUrl(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Chalin-One-Staging-Gateway": "cloudflare-pages-seo-v1",
    },
    redirect: "manual",
  });
  if (!response.ok) {
    throw new Error(`SEO inventory upstream returned ${response.status}.`);
  }
  const body = await response.json();
  const data = body?.data;
  if (!data || !Array.isArray(data.items)) {
    throw new Error("SEO inventory response is invalid.");
  }
  return data;
}

function safeSitemapPath(value) {
  const raw = String(value || "").trim();
  if (!/^\/(?!\/)/.test(raw) || raw.includes("?") || raw.includes("#")) return "";
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

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeLastModified(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function buildSitemapXml(items = [], origin = "") {
  let safeOrigin;
  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.protocol !== "https:" || parsedOrigin.username || parsedOrigin.password) {
      return "";
    }
    safeOrigin = parsedOrigin.origin;
  } catch {
    return "";
  }

  const urls = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const pathname = safeSitemapPath(item?.path);
    if (!pathname || seen.has(pathname)) continue;
    seen.add(pathname);
    const absolute = new URL(pathname, safeOrigin).toString();
    const lastModified = safeLastModified(item?.last_modified);
    urls.push(
      `  <url><loc>${escapeXml(absolute)}</loc>${lastModified ? `<lastmod>${escapeXml(lastModified)}</lastmod>` : ""}</url>`
    );
    if (urls.length >= 50000) break;
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

function stagingRobotsResponse(method = "GET") {
  const body = [
    "# CHALIN ONE staging preview - indexing disabled",
    "User-agent: *",
    "Disallow: /",
    "",
  ].join("\n");
  return new Response(String(method).toUpperCase() === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=UTF-8",
      "Cache-Control": "public, max-age=300",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

function stagingSitemapResponse(xml, method = "GET") {
  if (!xml) {
    return new Response(
      String(method).toUpperCase() === "HEAD"
        ? null
        : "CHALIN ONE staging sitemap is temporarily unavailable.\n",
      {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=UTF-8",
          "Cache-Control": "no-store, max-age=0",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
      }
    );
  }
  return new Response(String(method).toUpperCase() === "HEAD" ? null : xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=UTF-8",
      "Cache-Control": "public, max-age=120, stale-while-revalidate=300",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

async function handleTechnicalSeoRequest(pathname, method, origin) {
  const normalizedMethod = String(method || "").toUpperCase();
  if (!SAFE_METHODS.has(normalizedMethod)) return null;
  if (pathname === "/robots.txt") return stagingRobotsResponse(normalizedMethod);
  if (pathname !== "/sitemap.xml") return null;

  try {
    const inventory = await loadSeoInventory();
    const xml = buildSitemapXml(inventory.items, origin);
    return stagingSitemapResponse(xml, normalizedMethod);
  } catch {
    return stagingSitemapResponse("", normalizedMethod);
  }
}

function governedRedirectResponse(redirect, pathname) {
  if (!redirect || normalizeSourcePath(redirect.source_path) !== pathname) return null;
  if (isReservedPlatformPath(pathname) || KNOWN_STATIC_PUBLIC_PATHS.has(pathname)) return null;
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

  if (TECHNICAL_SEO_PATHS.has(incoming.pathname)) {
    const technicalSeoResponse = await handleTechnicalSeoRequest(
      incoming.pathname,
      context.request.method,
      incoming.origin
    );
    if (technicalSeoResponse) return technicalSeoResponse;
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
  KNOWN_STATIC_PUBLIC_PATHS,
  REDIRECT_STATUS_CODES,
  RESERVED_PLATFORM_PREFIXES,
  SAFE_METHODS,
  SEO_INVENTORY_PATH,
  STAGING_PAGES_HOST,
  TECHNICAL_SEO_PATHS,
  UPSTREAM_API_ORIGIN,
  buildSitemapXml,
  escapeXml,
  firstPathSegment,
  governedRedirectResponse,
  handleTechnicalSeoRequest,
  isApprovedStagingHost,
  isReservedPlatformPath,
  normalizeSourcePath,
  resolverUrl,
  safeLastModified,
  safeRedirectDestination,
  safeSitemapPath,
  seoInventoryUrl,
  shouldBypass,
  stagingRobotsResponse,
  stagingSitemapResponse,
};
