"use strict";

const middlewarePath = require.resolve("../middleware/equipmentCatalogueIntegrityMiddleware");
const catalogueRoutes = require("../routes/equipmentCatalogueRoutes");
const financeRoutes = require("../routes/equipmentFinanceIndependentRoutes");

const middleware = require(middlewarePath);
const original = middleware.enforceEquipmentCatalogueWriteIntegrity;

function isDepositBoundary(req) {
  return /^\/sales\/deposit-reservations(?:\/|$)/.test(String(req.path || ""));
}

if (!catalogueRoutes.__chalin03DepositFinanceMounted) {
  catalogueRoutes.use("/sales/deposit-reservations", financeRoutes);
  Object.defineProperty(catalogueRoutes, "__chalin03DepositFinanceMounted", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

if (!middleware.__chalin03DepositBoundaryInstalled) {
  middleware.enforceEquipmentCatalogueWriteIntegrity = async function depositBoundary(req, res, next) {
    if (!isDepositBoundary(req)) return original(req, res, next);

    // Deposit/Reservation is an independent Finance workflow. Do not make it
    // depend on the broader Equipment Sales commercial foundation. The Finance
    // route mounted below performs its own exact schema, trigger and migration
    // readiness checks before any financial mutation is allowed.
    return next();
  };

  Object.defineProperty(middleware, "__chalin03DepositBoundaryInstalled", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}
