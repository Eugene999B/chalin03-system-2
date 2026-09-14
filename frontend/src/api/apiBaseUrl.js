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

function officialApiBaseUrl(hostname) {
  const normalizedHostname = normalizeHost(hostname);
  if (!OFFICIAL_FRONTEND_HOSTS.has(normalizedHostname)) return "";

  // Derive the production API host from the official browser host at runtime.
  // This keeps the dedicated CHALIN ONE staging bundle free of any embedded
  // production API origin while still resolving chalin03.com/www.chalin03.com
  // to the official api.<root-domain> endpoint in production.
  const rootDomain = normalizedHostname.replace(/^www\./, "");
  return normalizeApiBaseUrl(`https://api.${rootDomain}/api`);
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

  // Official production frontend hosts use the official API domain directly,
  // derived from the browser hostname rather than hard-coded into the bundle.
  if (OFFICIAL_FRONTEND_HOSTS.has(normalizedHostname)) {
    return officialApiBaseUrl(normalizedHostname);
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
  officialApiBaseUrl,
  resolveApiBaseUrl,
};
