const rateLimit = require("express-rate-limit");
const helmet = require("helmet");

function buildSecurityMiddleware() {
  return helmet({
    crossOriginResourcePolicy: { policy: "same-site" },
    contentSecurityPolicy: false,
  });
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
  buildSecurityMiddleware,
  buildRateLimiter,
  loginLimiter,
  sensitiveAdminLimiter,
};
