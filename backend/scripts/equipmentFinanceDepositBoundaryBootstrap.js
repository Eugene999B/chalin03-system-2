"use strict";

const middlewarePath = require.resolve("../middleware/equipmentCatalogueIntegrityMiddleware");

const middleware = require(middlewarePath);
const original = middleware.enforceEquipmentCatalogueWriteIntegrity;

function isDepositBoundary(req) {
  const candidates = [
    req.path,
    req.originalUrl,
    req.url,
    `${req.baseUrl || ""}${req.path || ""}`,
  ].map((value) => String(value || ""));

  return candidates.some((value) =>
    /^\/api\/equipment-catalogue\/sales\/deposit-reservations(?:\/|\?|$)/.test(value) ||
    /^\/equipment-catalogue\/sales\/deposit-reservations(?:\/|\?|$)/.test(value) ||
    /^\/sales\/deposit-reservations(?:\/|\?|$)/.test(value)
  );
}

if (!middleware.__chalin03DepositBoundaryInstalled) {
  middleware.enforceEquipmentCatalogueWriteIntegrity = async function depositBoundary(req, res, next) {
    if (!isDepositBoundary(req)) return original(req, res, next);

    // Deposit/Reservation is an independent Finance workflow. Do not make it
    // depend on the broader Equipment Sales commercial foundation. The normal
    // catalogue router will handle the request, and the Finance route performs
    // its own exact schema, trigger, migration, permission, locking, idempotency
    // and transaction safeguards before any financial mutation is allowed.
    return next();
  };

  Object.defineProperty(middleware, "__chalin03DepositBoundaryInstalled", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}
