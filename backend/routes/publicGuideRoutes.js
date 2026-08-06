"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");

const {
  answerPublicGuide,
  createPublicGuideHandoff,
  createPublicGuideSession,
  getPublicGuideHistory,
} = require("../services/publicGuideService");

const router = express.Router();

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function noStore(res) {
  res.set("Cache-Control", "no-store, private, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
}

function success(res, req, data, statusCode = 200) {
  noStore(res);
  return res.status(statusCode).json({
    status: "success",
    data,
    request_id: req.requestId || null,
  });
}

function asyncHandler(handler) {
  return function wrappedGuideHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function sessionToken(req) {
  return String(req.get("x-chalin-guide-session") || "").trim();
}

const sessionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: boundedInteger(
    process.env.PUBLIC_GUIDE_SESSION_RATE_LIMIT_MAX,
    10,
    1,
    100
  ),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    status: "error",
    code: "PUBLIC_GUIDE_SESSION_RATE_LIMITED",
    message: "Too many Guide sessions were requested. Please try again later.",
  },
});

const messageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: boundedInteger(
    process.env.PUBLIC_GUIDE_MESSAGE_RATE_LIMIT_MAX,
    20,
    1,
    100
  ),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    status: "error",
    code: "PUBLIC_GUIDE_MESSAGE_RATE_LIMITED",
    message: "Too many Guide messages were sent. Please try again later.",
  },
});

const handoffLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: boundedInteger(
    process.env.PUBLIC_GUIDE_HANDOFF_RATE_LIMIT_MAX,
    3,
    1,
    20
  ),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    status: "error",
    code: "PUBLIC_GUIDE_HANDOFF_RATE_LIMITED",
    message: "Too many enquiry handoffs were submitted. Please try again later.",
  },
});

router.post(
  "/sessions",
  sessionLimiter,
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await createPublicGuideSession({
        ip: req.ip,
      }),
      201
    )
  )
);

router.get(
  "/history",
  messageLimiter,
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await getPublicGuideHistory({ token: sessionToken(req) })
    )
  )
);

router.post(
  "/messages",
  messageLimiter,
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await answerPublicGuide({
        token: sessionToken(req),
        message: req.body.message,
        req,
      })
    )
  )
);

router.post(
  "/handoffs",
  handoffLimiter,
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await createPublicGuideHandoff({
        token: sessionToken(req),
        payload: req.body,
        formSlug: req.body.form_slug || "contact",
        requestContext: {
          ip: req.ip,
          userAgent: req.get("user-agent") || "",
          requestId: req.requestId || null,
        },
      }),
      202
    )
  )
);

router.use((error, req, res, next) => {
  const code = String(error?.code || "");
  if (
    !code.startsWith("PUBLIC_GUIDE_") &&
    !code.startsWith("AI_") &&
    !String(error?.name || "").startsWith("PublicGuide") &&
    !String(error?.name || "").startsWith("Ai")
  ) {
    return next(error);
  }
  noStore(res);
  return res.status(Number(error.statusCode) || 400).json({
    status: "error",
    code: code || "PUBLIC_GUIDE_REQUEST_FAILED",
    message:
      error.message ||
      "Chalin Guide could not complete the request safely.",
    request_id: req.requestId || null,
  });
});

module.exports = router;
