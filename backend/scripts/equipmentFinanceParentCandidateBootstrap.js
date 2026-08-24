"use strict";

const independentRoutes = require("../routes/equipmentFinanceIndependentRoutes");
const candidateRoutes = require("../routes/equipmentFinanceOpeningDepositCandidateCompatibilityRoutes");
const depositRoutes = require("../routes/equipmentFinanceDepositReservationRoutes");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  runEquipmentFinanceOpeningDepositFoundationRepair,
} = require("./runEquipmentFinanceOpeningDepositFoundationRepair");
const {
  runEquipmentFinancePhaseFourStartup,
} = require("./runEquipmentFinancePhaseFourStartup");

function installRouteFirst(router, path, middleware, handler) {
  if (router.stack.some((layer) => layer?.route?.path === path)) return;
  const before = router.stack.length;
  router.get(path, middleware, handler);
  const layer = router.stack.splice(before, 1)[0];
  if (layer) router.stack.unshift(layer);
}

if (!independentRoutes.__chalin03ParentDepositRepairInstalled) {
  installRouteFirst(
    independentRoutes,
    "/deposit-reservations/readiness",
    requirePermission("fleet.assets.view"),
    async (_req, res) => {
      try {
        await runEquipmentFinanceOpeningDepositFoundationRepair();
        await runEquipmentFinancePhaseFourStartup();
        const readiness = await depositRoutes.schemaStatus();
        return res.status(readiness.ready ? 200 : 503).json({
          status: readiness.ready ? "success" : "error",
          code: readiness.ready
            ? undefined
            : "EQUIPMENT_FINANCE_DEPOSIT_FOUNDATION_REQUIRED",
          message: readiness.ready
            ? "Finance deposit and reservation controls are ready."
            : "Finance deposit and reservation controls are not ready after the approved production repair.",
          readiness,
        });
      } catch (error) {
        console.error("Finance Deposit readiness bootstrap failed.", error);
        return res.status(503).json({
          status: "error",
          code: "EQUIPMENT_FINANCE_DEPOSIT_FOUNDATION_REQUIRED",
          message:
            "Finance deposit and reservation controls could not be verified after the approved production repair.",
          details: String(error?.message || "Unknown readiness verification failure.").slice(0, 500),
        });
      }
    }
  );

  const candidateLayer = candidateRoutes.stack.find(
    (layer) => layer?.route?.path === "/deposit-reservations/candidates"
  );

  if (candidateLayer) {
    const existing = independentRoutes.stack.some(
      (layer) => layer === candidateLayer || layer?.route?.path === "/deposit-reservations/candidates"
    );
    if (!existing) independentRoutes.stack.unshift(candidateLayer);
  } else {
    throw new Error(
      "Opening Deposit candidate route was not available while installing the Finance parent candidate boundary."
    );
  }

  Object.defineProperty(independentRoutes, "__chalin03ParentDepositRepairInstalled", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}
