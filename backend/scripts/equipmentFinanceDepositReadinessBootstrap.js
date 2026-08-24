"use strict";

const { pool } = require("../config/db");
const financeDepositRoutes = require("../routes/equipmentFinanceDepositReservationRoutes");
const { runEquipmentFinanceOpeningDepositFoundationRepair } = require("./runEquipmentFinanceOpeningDepositFoundationRepair");
const { runEquipmentFinancePhaseFourStartup } = require("./runEquipmentFinancePhaseFourStartup");
const middleware = require("../middleware/equipmentCatalogueIntegrityMiddleware");

let repairPromise = null;

function isReadinessRequest(req) {
  const path = String(req.path || "").replace(/\/+$/, "");
  return String(req.method || "GET").toUpperCase() === "GET" && path === "/sales/deposit-reservations/readiness";
}

async function verifyReady() {
  const status = await financeDepositRoutes.schemaStatus(pool);
  if (status.ready) return status;

  if (!repairPromise) {
    repairPromise = (async () => {
      await runEquipmentFinanceOpeningDepositFoundationRepair();
      await runEquipmentFinancePhaseFourStartup();
      return financeDepositRoutes.schemaStatus(pool);
    })().finally(() => {
      repairPromise = null;
    });
  }

  return repairPromise;
}

if (!middleware.__chalin03DepositReadinessBootstrapInstalled) {
  const original = middleware.enforceEquipmentCatalogueWriteIntegrity;
  middleware.enforceEquipmentCatalogueWriteIntegrity = async function depositReadinessBootstrap(
    req,
    res,
    next
  ) {
    if (!isReadinessRequest(req)) return original(req, res, next);

    res.set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    try {
      const readiness = await verifyReady();
      return res.status(readiness.ready ? 200 : 503).json({
        status: readiness.ready ? "success" : "error",
        code: readiness.ready
          ? undefined
          : "EQUIPMENT_FINANCE_DEPOSIT_FOUNDATION_REQUIRED",
        message: readiness.ready
          ? "Finance deposit and reservation controls are ready."
          : "Finance deposit and reservation controls are not ready.",
        readiness,
      });
    } catch (error) {
      console.error("Finance deposit readiness bootstrap failed:", error);
      return res.status(503).json({
        status: "error",
        code: error.code || "EQUIPMENT_FINANCE_DEPOSIT_FOUNDATION_REQUIRED",
        message: "Finance deposit and reservation controls could not be verified safely.",
        request_id: req.requestId || null,
        readiness: error.readiness || null,
      });
    }
  };

  Object.defineProperty(middleware, "__chalin03DepositReadinessBootstrapInstalled", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

module.exports = { verifyReady };
