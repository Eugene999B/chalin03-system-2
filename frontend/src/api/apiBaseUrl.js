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

  // Production uses the official Chalin 03 API hostname directly. This avoids
  // the Cloudflare same-origin Pages proxy becoming a second failure point while
  // keeping Railway's API host/origin protections authoritative.
  if (OFFICIAL_FRONTEND_HOSTS.has(normalizedHostname)) {
    return "https://api.chalin03.com/api";
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
