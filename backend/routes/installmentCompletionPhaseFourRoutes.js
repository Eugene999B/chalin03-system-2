const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { getInstallmentCompletionReadiness } = require("../services/installmentCompletionPhaseFourService");
const { recover } = require("./installmentLegacyRecoveryMiddlewareV13");
const authoritativeInstallmentRoutes = require("./installmentDeepDeleteRoutesV10");

const router = express.Router();

function sendError(res, error, fallback) {
  console.error("Installment Finance readiness request failed", {
    code: error?.code,
    statusCode: error?.statusCode,
    message: error?.message,
    stack: error?.stack,
  });
  return res.status(Number(error.statusCode || 500)).json({
    status: "error",
    code: error.code || "INSTALLMENT_FINANCE_READINESS_ERROR",
    message: error.message || fallback,
  });
}

router.get(
  "/completion-phase-four/readiness",
  requirePermission("fleet.assets.view"),
  async (_req, res) => {
    try {
      return res.json({
        status: "success",
        readiness: await getInstallmentCompletionReadiness(),
      });
    } catch (error) {
      return sendError(res, error, "Could not verify final Finance readiness.");
    }
  }
);

// The reset/delete endpoints below are deliberately delegated to the same
// authoritative route used by the complete Installment purge. This eliminates
// the old duplicate Phase Four handlers that could report a different scope or
// block legacy trial customers after their child Finance rows were removed.
// Legacy ownership recovery runs before impact/delete/reset and is idempotent.
router.use(recover);
router.use(authoritativeInstallmentRoutes);

module.exports = router;
