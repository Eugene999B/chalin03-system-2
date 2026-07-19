const crypto = require("node:crypto");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");

const HEALTH_PATHS = new Set(["/", "/api/health"]);
const ORIGIN_SECRET_HEADER = "x-chalin-origin-key";

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

function getTrustedApiHosts() {
  const configuredHosts = String(process.env.TRUSTED_API_HOSTS || "")
    .split(",")
    .map(normalizeHost)
    .filter(Boolean);

  return new Set([
    "api.chalin03.com",
    "localhost",
    "127.0.0.1",
    "::1",
    ...configuredHosts,
  ]);
}

function isTrustedApiHost(host, trustedHosts = getTrustedApiHosts()) {
  return trustedHosts.has(normalizeHost(host));
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

function trustedHostMiddleware(req, res, next) {
  const enforcementDisabled =
    String(process.env.ENFORCE_TRUSTED_API_HOSTS || "true").toLowerCase() ===
    "false";

  if (
    !isProductionEnvironment() ||
    enforcementDisabled ||
    shouldSkipOriginProtection(req)
  ) {
    return next();
  }

  const requestHost = req.headers.host;

  if (isTrustedApiHost(requestHost)) {
    return next();
  }

  return res.status(421).json({
    status: "error",
    code: "UNTRUSTED_API_HOST",
    message: "This API request must use the official Chalin 03 API domain.",
  });
}

function cloudflareOriginSecretMiddleware(req, res, next) {
  const configuredSecret = String(
    process.env.CLOUDFLARE_ORIGIN_SECRET || ""
  ).trim();

  if (
    !isProductionEnvironment() ||
    !configuredSecret ||
    shouldSkipOriginProtection(req)
  ) {
    return next();
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
  ORIGIN_SECRET_HEADER,
  additionalSecurityHeaders,
  buildSecurityMiddleware,
  buildRateLimiter,
  cloudflareOriginSecretMiddleware,
  getTrustedApiHosts,
  isTrustedApiHost,
  loginLimiter,
  normalizeHost,
  safeSecretEquals,
  sensitiveAdminLimiter,
  trustedHostMiddleware,
};
