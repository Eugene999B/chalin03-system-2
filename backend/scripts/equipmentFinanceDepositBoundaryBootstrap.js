"use strict";

const middlewarePath = require.resolve("../middleware/equipmentCatalogueIntegrityMiddleware");
const catalogueRoutes = require("../routes/equipmentCatalogueRoutes");
const financeRoutes = require("../routes/equipmentFinanceIndependentRoutes");
const { ensureEquipmentSalesSchema } = require("../services/equipmentSalesSchemaService");

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

    try {
      // Opening Deposit has its own exact Finance schema gate. Require only
      // the shared catalogue core here so unrelated legacy/commercial tables
      // cannot block the Finance deposit request before its safeguards run.
      await ensureEquipmentSalesSchema({ requireFull: false });
    } catch (error) {
      console.error(
        "Equipment Sales core foundation preparation failed for Finance Deposit:",
        error
      );
      return res.status(503).json({
        status: "error",
        code: "EQUIPMENT_SALES_FOUNDATION_STARTUP_FAILED",
        message:
          "The Finance deposit service could not verify the shared equipment foundation safely.",
        request_id: req.requestId || null,
      });
    }

    // Continue through the normal Equipment Catalogue router. The approved
    // Finance router is mounted above on /sales/deposit-reservations, so Express
    // retains its normal route lifecycle and error handling.
    return next();
  };

  Object.defineProperty(middleware, "__chalin03DepositBoundaryInstalled", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}
