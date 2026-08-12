const OFFICIAL_FRONTEND_HOSTS = new Set([
  "chalin03.com",
  "www.chalin03.com",
]);

const CHALIN_ONE_STAGING_FRONTEND_HOSTS = new Set([
  "chalin-one-staging-preview.pages.dev",
  "chalin-one.chalin03-system-2.pages.dev",
]);

const CHALIN_ONE_STAGING_API_URL =
  "https://chalin03-system-2-staging.up.railway.app/api";

function normalizeHost(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

function normalizeApiBaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function browserHostname() {
  if (typeof window === "undefined") return "";
  return normalizeHost(window.location?.hostname);
}

function configuredApiUrl() {
  return normalizeApiBaseUrl(import.meta.env?.VITE_API_URL || "");
}

function isChalinOneStagingFrontend(hostname) {
  const normalizedHostname = normalizeHost(hostname);
  return (
    CHALIN_ONE_STAGING_FRONTEND_HOSTS.has(normalizedHostname) ||
    normalizedHostname.endsWith(".chalin-one-staging-preview.pages.dev")
  );
}

function resolveApiBaseUrl({
  hostname = browserHostname(),
  configured = configuredApiUrl(),
  developmentFallback = "http://localhost:5000/api",
} = {}) {
  const normalizedHostname = normalizeHost(hostname);

  // CHALIN ONE staging must always talk to the isolated Railway staging API.
  // This deliberately does not depend on a Cloudflare build variable because
  // the dedicated staging Pages project can retain an older environment when
  // a deployment fails. Host identity is stable and keeps recovery testing
  // isolated from the production API.
  if (isChalinOneStagingFrontend(normalizedHostname)) {
    return CHALIN_ONE_STAGING_API_URL;
  }

  // Production browser traffic intentionally stays on the same origin. Cloudflare
  // Pages Functions then proxies /api/* server-side to api.chalin03.com. This
  // removes browser CORS/preflight as a production dependency while keeping the
  // Railway API, authentication and origin-protection controls authoritative.
  if (OFFICIAL_FRONTEND_HOSTS.has(normalizedHostname)) {
    return "/api";
  }

  return normalizeApiBaseUrl(configured || developmentFallback);
}

const API_BASE_URL = resolveApiBaseUrl();

export {
  API_BASE_URL,
  CHALIN_ONE_STAGING_API_URL,
  CHALIN_ONE_STAGING_FRONTEND_HOSTS,
  OFFICIAL_FRONTEND_HOSTS,
  isChalinOneStagingFrontend,
  normalizeApiBaseUrl,
  normalizeHost,
  resolveApiBaseUrl,
};
