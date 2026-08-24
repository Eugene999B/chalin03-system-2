"use strict";

const middlewarePath = require.resolve("../middleware/equipmentCatalogueIntegrityMiddleware");
const financeRoutes = require("../routes/equipmentFinanceIndependentRoutes");
const { ensureEquipmentSalesSchema } = require("../services/equipmentSalesSchemaService");

const middleware = require(middlewarePath);
const original = middleware.enforceEquipmentCatalogueWriteIntegrity;

function isDepositBoundary(req) {
  return /^\/sales\/deposit-reservations(?:\/|$)/.test(String(req.path || ""));
}

if (!middleware.__chalin03DepositBoundaryInstalled) {
  middleware.enforceEquipmentCatalogueWriteIntegrity = async function depositBoundary(req, res, next) {
    if (!isDepositBoundary(req)) return original(req, res, next);

    try {
      // The deposit route has its own exact finance schema gate. Require only the
      // catalogue core here so an unrelated legacy/commercial foundation cannot
      // block Opening Deposit before its finance safeguards run.
      await ensureEquipmentSalesSchema({ requireFull: false });
    } catch (error) {
      console.error("Equipment Sales core foundation preparation failed for Finance Deposit:", error);
      return res.status(503).json({
        status: "error",
        code: "EQUIPMENT_SALES_FOUNDATION_STARTUP_FAILED",
        message: "The Finance deposit service could not verify the shared equipment foundation safely.",
        request_id: req.requestId || null,
      });
    }

    const originalUrl = req.url;
    req.url = req.url.replace(/^\/sales(?=\/|\?|$)/, "") || "/";
    return financeRoutes(req, res, (error) => {
      req.url = originalUrl;
      return next(error);
    });
  };

  Object.defineProperty(middleware, "__chalin03DepositBoundaryInstalled", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}
