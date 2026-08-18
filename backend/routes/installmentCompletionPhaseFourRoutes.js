const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { getInstallmentCompletionReadiness } = require("../services/installmentCompletionPhaseFourService");
const authoritativeInstallmentRoutes = require("./installmentDeepDeleteRoutesV13");

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

// One authoritative Phase Four delete/reset engine. No request-time schema
// migration or separate legacy-recovery middleware is required.
router.use(authoritativeInstallmentRoutes);

module.exports = router;
