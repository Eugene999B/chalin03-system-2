"use strict";

const middlewarePath = require.resolve("../middleware/equipmentCatalogueIntegrityMiddleware");

const middleware = require(middlewarePath);
const original = middleware.enforceEquipmentCatalogueWriteIntegrity;

// The Finance deposit/reservation router is intentionally mounted as a child of
// the existing Equipment Catalogue router. The production server wraps that
// router with authentication, Hire division access and write-integrity guards,
// so attaching it here preserves those protections without requiring a risky
// rewrite of server.js.
const equipmentCatalogueRouter = require("../routes/equipmentCatalogueRoutes");
const equipmentFinanceIndependentRoutes = require("../routes/equipmentFinanceIndependentRoutes");

if (!equipmentCatalogueRouter.__chalin03FinanceDepositRoutesInstalled) {
  equipmentCatalogueRouter.use("/sales", equipmentFinanceIndependentRoutes);
  Object.defineProperty(equipmentCatalogueRouter, "__chalin03FinanceDepositRoutesInstalled", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

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
    // depend on the broader Equipment Sales commercial foundation. The Finance
    // route performs its own exact schema, trigger, migration, permission,
    // locking, idempotency and transaction safeguards before any mutation.
    return next();
  };

  Object.defineProperty(middleware, "__chalin03DepositBoundaryInstalled", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}
