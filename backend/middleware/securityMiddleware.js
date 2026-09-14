const crypto = require("node:crypto");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");

const HEALTH_PATHS = new Set(["/", "/api/health"]);
const ORIGIN_SECRET_HEADER = "x-chalin-origin-key";
const OFFICIAL_FRONTEND_ORIGINS = new Set([
  "https://chalin03.com",
  "https://www.chalin03.com",
]);
const TRUSTED_BROWSER_METHODS = "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS";
const INTERNAL_APPROVAL_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const INTERNAL_APPROVAL_REQUEST_ID_PATTERN = /^\d+$/;

function isProductionEnvironment() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

function normalizeHost(value) {
  const firstValue = String(value || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];

  if (firstValue.startsWith("[")) {
    const closingBracket = firstValue.indexOf("]");
    return closingBracket >= 0
      ? firstValue.slice(1, closingBracket)
      : firstValue;
  }

  return firstValue.replace(/:\d+$/, "");
}

function normalizeOrigin(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return "";
  }
}

function getTrustedApiHosts() {
  const configuredHosts = String(process.env.TRUSTED_API_HOSTS || "")
    .split(",")
    .map(normalizeHost)
    .filter(Boolean);
  const defaults = ["api.chalin03.com"];
  if (!isProductionEnvironment()) {
    defaults.push("localhost", "127.0.0.1", "::1");
  }
  return new Set([...defaults, ...configuredHosts]);
}

function getTrustedFrontendOrigins() {
  const configured = [process.env.FRONTEND_URL, process.env.FRONTEND_URL_ALT]
    .map(normalizeOrigin)
    .filter(Boolean);
  const origins = new Set([...OFFICIAL_FRONTEND_ORIGINS, ...configured]);
  if (!isProductionEnvironment()) {
    origins.add("http://localhost:5173");
    origins.add("http://localhost:3000");
  }
  return origins;
}

function isTrustedApiHost(host, trustedHosts = getTrustedApiHosts()) {
  return trustedHosts.has(normalizeHost(host));
}

function isTrustedFrontendOrigin(
  origin,
  trustedOrigins = getTrustedFrontendOrigins()
) {
  const normalized = normalizeOrigin(origin);
  return Boolean(normalized && trustedOrigins.has(normalized));
}

function isInternalOperationalApprovalExecution(req) {
  const host = normalizeHost(req?.headers?.host);
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) return false;

  const requestId = String(
    typeof req?.get === "function"
      ? req.get("x-chalin-approval-request-id") || ""
      : req?.headers?.["x-chalin-approval-request-id"] || ""
  ).trim();
  const executionToken = String(
    typeof req?.get === "function"
      ? req.get("x-chalin-approval-execution") || ""
      : req?.headers?.["x-chalin-approval-execution"] || ""
  ).trim();

  if (
    !INTERNAL_APPROVAL_REQUEST_ID_PATTERN.test(requestId) ||
    !INTERNAL_APPROVAL_TOKEN_PATTERN.test(executionToken)
  ) {
    return false;
  }

  const method = String(req?.method || "").toUpperCase();
  const path = String(req?.path || "").replace(/\/$/, "");

  if (method === "POST" && path === "/api/returns") return true;
  if (method === "PUT" && /^\/api\/sales\/\d+$/.test(path)) return true;
  if (method === "PATCH" && /^\/api\/sales\/\d+\/void$/.test(path)) return true;
  return false;
}

function shouldSkipOriginProtection(req) {
  return req.method === "OPTIONS" || HEALTH_PATHS.has(req.path);
}

function safeSecretEquals(expectedValue, suppliedValue) {
  const expected = Buffer.from(String(expectedValue || ""));
  const supplied = Buffer.from(String(suppliedValue || ""));
  if (expected.length === 0 || expected.length !== supplied.length) {
    return false;
  }
  return crypto.timingSafeEqual(expected, supplied);
}

function trustedBrowserCorsBoundary(req, res, next) {
  const suppliedOrigin = req.get("origin");
  if (!suppliedOrigin || !isTrustedFrontendOrigin(suppliedOrigin)) {
    return next();
  }

  const normalizedOrigin = normalizeOrigin(suppliedOrigin);
  res.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (typeof res.vary === "function") {
    res.vary("Origin");
  } else {
    res.setHeader("Vary", "Origin");
  }

  if (req.method !== "OPTIONS") {
    return next();
  }

  const requestedHeaders = req.get("access-control-request-headers");
  res.setHeader("Access-Control-Allow-Methods", TRUSTED_BROWSER_METHODS);
  if (requestedHeaders) {
    res.setHeader("Access-Control-Allow-Headers", requestedHeaders);
  }
  res.setHeader("Access-Control-Max-Age", "86400");
  return res.status(204).end();
}

function trustedFrontendOriginMiddleware(req, res, next) {
  if (!isProductionEnvironment() || shouldSkipOriginProtection(req)) {
    return next();
  }
  const suppliedOrigin = req.get("origin");
  if (!suppliedOrigin || isTrustedFrontendOrigin(suppliedOrigin)) {
    return next();
  }
  return res.status(403).json({
    status: "error",
    code: "UNTRUSTED_FRONTEND_ORIGIN",
    message: "This browser request must come from an approved Chalin 03 website.",
  });
}

function trustedHostMiddleware(req, res, next) {
  if (!isProductionEnvironment() || shouldSkipOriginProtection(req)) {
    return next();
  }
  const requestHost = req.headers.host;
  if (
    isTrustedApiHost(requestHost) ||
    isInternalOperationalApprovalExecution(req)
  ) {
    return next();
  }
  return res.status(421).json({
    status: "error",
    code: "UNTRUSTED_API_HOST",
    message: "This API request must use the official Chalin 03 API domain.",
  });
}

function cloudflareOriginSecretMiddleware(req, res, next) {
  if (
    !isProductionEnvironment() ||
    shouldSkipOriginProtection(req) ||
    isInternalOperationalApprovalExecution(req)
  ) {
    return next();
  }

  const configuredSecret = String(
    process.env.CLOUDFLARE_ORIGIN_SECRET || ""
  ).trim();
  if (configuredSecret.length < 64) {
    return res.status(503).json({
      status: "error",
      code: "ORIGIN_PROTECTION_NOT_CONFIGURED",
      message: "Production origin protection is not configured.",
    });
  }

  const suppliedSecret = req.get(ORIGIN_SECRET_HEADER);
  if (safeSecretEquals(configuredSecret, suppliedSecret)) {
    return next();
  }

  return res.status(403).json({
    status: "error",
    code: "ORIGIN_PROTECTION_REQUIRED",
    message: "The request could not be verified through the approved edge.",
  });
}

function additionalSecurityHeaders(req, res, next) {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self), payment=(), usb=()"
  );
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");

  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
  }

  next();
}

function buildSecurityMiddleware() {
  const production = isProductionEnvironment();

  return [
    trustedBrowserCorsBoundary,
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          baseUri: ["'none'"],
          connectSrc: ["'self'"],
          fontSrc: ["'none'"],
          formAction: ["'none'"],
          frameAncestors: ["'none'"],
          imgSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: "same-origin" },
      crossOriginResourcePolicy: { policy: "same-site" },
      frameguard: { action: "deny" },
      referrerPolicy: { policy: "no-referrer" },
      strictTransportSecurity: production
        ? {
            maxAge: 31_536_000,
            includeSubDomains: true,
            preload: true,
          }
        : false,
    }),
    additionalSecurityHeaders,
    trustedFrontendOriginMiddleware,
    trustedHostMiddleware,
    cloudflareOriginSecretMiddleware,
  ];
}

function buildRateLimiter({ windowMinutes = 15, max = 100, message }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      status: "error",
      code: "RATE_LIMITED",
      message: message || "Too many requests. Please wait and try again.",
    },
  });
}

const loginLimiter = buildRateLimiter({
  windowMinutes: 15,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 20),
  message: "Too many login attempts. Please wait and try again.",
});

const sensitiveAdminLimiter = buildRateLimiter({
  windowMinutes: 10,
  max: Number(process.env.SENSITIVE_ADMIN_RATE_LIMIT_MAX || 80),
  message: "Too many sensitive administration requests. Please wait and try again.",
});

module.exports = {
  OFFICIAL_FRONTEND_ORIGINS,
  ORIGIN_SECRET_HEADER,
  TRUSTED_BROWSER_METHODS,
  additionalSecurityHeaders,
  buildSecurityMiddleware,
  buildRateLimiter,
  cloudflareOriginSecretMiddleware,
  getTrustedApiHosts,
  getTrustedFrontendOrigins,
  isInternalOperationalApprovalExecution,
  isTrustedApiHost,
  isTrustedFrontendOrigin,
  loginLimiter,
  normalizeHost,
  normalizeOrigin,
  safeSecretEquals,
  sensitiveAdminLimiter,
  trustedBrowserCorsBoundary,
  trustedFrontendOriginMiddleware,
  trustedHostMiddleware,
};
