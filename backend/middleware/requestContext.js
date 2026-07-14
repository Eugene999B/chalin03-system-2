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

  next();
}

module.exports = {
  requestContext,
  createRequestId,
};
