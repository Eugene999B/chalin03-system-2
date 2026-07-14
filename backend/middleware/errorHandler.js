const { pool } = require("../config/db");

class AppError extends Error {
  constructor(statusCode, message, code = "APP_ERROR", details = null) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function sanitizeMessage(error) {
  const message = String(error?.message || "").trim();

  if (!message) {
    return "Something went wrong on the server.";
  }

  const lower = message.toLowerCase();
  if (
    lower.includes("sql") ||
    lower.includes("mysql") ||
    lower.includes("password") ||
    lower.includes("jwt") ||
    lower.includes("token") ||
    lower.includes("connection string")
  ) {
    return "The request could not be completed safely.";
  }

  return message.slice(0, 240);
}

function statusCodeForError(error) {
  if (Number.isInteger(error?.statusCode)) {
    return error.statusCode;
  }

  if (Number.isInteger(error?.status)) {
    return error.status;
  }

  if (error?.code === "ER_DUP_ENTRY") return 409;
  if (error?.code === "ER_NO_REFERENCED_ROW_2") return 409;
  if (error?.code === "ER_ROW_IS_REFERENCED_2") return 409;
  if (error?.code === "ER_NO_SUCH_TABLE") return 503;

  return 500;
}

function publicCodeForStatus(statusCode, error) {
  if (error?.code && String(error.code).startsWith("CHALIN03_")) {
    return error.code;
  }

  if (statusCode === 400) return "VALIDATION_ERROR";
  if (statusCode === 401) return "AUTHENTICATION_REQUIRED";
  if (statusCode === 403) return "AUTHORIZATION_DENIED";
  if (statusCode === 404) return "NOT_FOUND";
  if (statusCode === 409) return "CONFLICT";
  if (statusCode === 429) return "RATE_LIMITED";
  if (statusCode === 503) return "SERVICE_UNAVAILABLE";
  return "INTERNAL_ERROR";
}

async function recordApplicationError(req, error, statusCode) {
  try {
    await pool.query(
      `INSERT INTO application_error_log (
         request_id,
         user_id,
         route,
         method,
         status_code,
         error_code,
         safe_message,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        req.requestId || null,
        req.user?.id || null,
        String(req.originalUrl || req.url || "").slice(0, 500),
        String(req.method || "").slice(0, 12),
        statusCode,
        publicCodeForStatus(statusCode, error),
        sanitizeMessage(error),
      ]
    );
  } catch {
    // Error logging must never make the original request fail harder.
  }
}

function notFoundHandler(req, res) {
  res.status(404).json({
    status: "error",
    code: "NOT_FOUND",
    message: "API route not found.",
    path: req.originalUrl,
    request_id: req.requestId || null,
  });
}

function safeErrorResponseMiddleware(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = (payload) => {
    if (
      payload &&
      typeof payload === "object" &&
      (payload.status === "error" || res.statusCode >= 400)
    ) {
      const safePayload = { ...payload };
      const statusCode = res.statusCode || statusCodeForError(payload);

      delete safePayload.technical_message;
      delete safePayload.stack;
      if (statusCode >= 500) {
        delete safePayload.details;
        safePayload.message = "The request could not be completed safely.";
      } else if (safePayload.message) {
        safePayload.message = sanitizeMessage({ message: safePayload.message });
      }

      if (!safePayload.request_id) {
        safePayload.request_id = req.requestId || null;
      }

      return originalJson(safePayload);
    }

    return originalJson(payload);
  };

  next();
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const statusCode = statusCodeForError(error);
  const code = publicCodeForStatus(statusCode, error);
  const isProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const message =
    statusCode >= 500
      ? isProduction
        ? "Something went wrong on the server."
        : sanitizeMessage(error)
      : sanitizeMessage(error);

  if (statusCode >= 500) {
    console.error("Unhandled server error:", {
      request_id: req.requestId,
      route: req.originalUrl,
      code,
      message: error?.message,
    });
  }

  recordApplicationError(req, error, statusCode);

  return res.status(statusCode).json({
    status: "error",
    code,
    message,
    request_id: req.requestId || null,
  });
}

module.exports = {
  AppError,
  notFoundHandler,
  safeErrorResponseMiddleware,
  errorHandler,
  sanitizeMessage,
};
