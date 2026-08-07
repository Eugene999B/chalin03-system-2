const OFFICIAL_FRONTEND_HOSTS = new Set([
  "chalin03.com",
  "www.chalin03.com",
]);

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

function resolveApiBaseUrl({
  hostname = browserHostname(),
  configured = configuredApiUrl(),
  developmentFallback = "http://localhost:5000/api",
} = {}) {
  const normalizedHostname = normalizeHost(hostname);

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
  OFFICIAL_FRONTEND_HOSTS,
  normalizeApiBaseUrl,
  normalizeHost,
  resolveApiBaseUrl,
};
