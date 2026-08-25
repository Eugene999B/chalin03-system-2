const crypto = require("crypto");

function createRequestId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return crypto.randomBytes(16).toString("hex");
}

function requestContext(req, res, next) {
  const inboundRequestId =
    req.headers["x-request-id"] || req.headers["x-correlation-id"];
  const requestId = String(inboundRequestId || createRequestId())
    .trim()
    .slice(0, 80);

  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);

  // The legacy /api/installments stack belongs to the retired branch-based
  // installment implementation. Equipment Installment Finance must use the
  // company-wide equipment-catalogue Finance lifecycle only. Keep the old
  // route physically present for historical data/recovery scripts, but make
  // it unavailable to live callers so two financial ledgers cannot be used
  // accidentally at the same time.
  if (req.path === "/api/installments" || req.path.startsWith("/api/installments/")) {
    return res.status(410).json({
      status: "error",
      code: "LEGACY_INSTALLMENT_API_RETIRED",
      message:
        "The legacy installment API has been retired. Use the Equipment Installment Finance workspace.",
      request_id: requestId,
    });
  }

  next();
}

module.exports = {
  requestContext,
  createRequestId,
};
