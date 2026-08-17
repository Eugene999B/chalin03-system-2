const express = require("express");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  FINANCE_WORKSPACE,
  buildFinanceResetDryRun,
  executeFinanceTestReset,
  getInstallmentCompletionReadiness,
} = require("../services/installmentCompletionPhaseFourService");

const router = express.Router();

function sendError(res, error, fallback) {
  return res.status(Number(error.statusCode || 500)).json({
    status: "error",
    code: error.code || "INSTALLMENT_COMPLETION_PHASE_FOUR_ERROR",
    message: error.message || fallback,
  });
}

function requireOriginalAdministrator(req, res, next) {
  if (isOriginalSystemAdministrator(req.user)) return next();
  return res.status(403).json({
    status: "error",
    code: "ORIGINAL_SYSTEM_ADMINISTRATOR_REQUIRED",
    message: "Only the original System Administrator can reset Installment Finance data.",
  });
}

router.get("/completion-phase-four/readiness", requirePermission("fleet.assets.view"), async (_req, res) => {
  try {
    return res.json({ status: "success", readiness: await getInstallmentCompletionReadiness() });
  } catch (error) {
    return sendError(res, error, "Could not verify final Finance readiness.");
  }
});

router.post("/completion-phase-four/reset/dry-run", requirePermission("fleet.assets.manage"), requireOriginalAdministrator, async (req, res) => {
  try {
    const dryRun = await buildFinanceResetDryRun();
    await writeAuditEvent({
      req,
      userId: req.user?.id,
      workspaceCode: FINANCE_WORKSPACE,
      action: "EQUIPMENT_FINANCE_RESET_DRY_RUN",
      actionType: "EQUIPMENT_FINANCE_RESET_DRY_RUN",
      entityType: "equipment_installment_reset",
      entityId: dryRun.fingerprint,
      outcome: "reviewed",
      severity: "warning",
      details: "Reviewed the read-only Installment Finance reset impact. No business data was changed.",
      metadata: { fingerprint: dryRun.fingerprint, read_only: true },
    });
    return res.json({ status: "success", dry_run: dryRun });
  } catch (error) {
    return sendError(res, error, "Could not prepare the Installment Finance reset dry run.");
  }
});

router.post("/completion-phase-four/reset/execute", requirePermission("fleet.assets.manage"), requireOriginalAdministrator, async (req, res) => {
  try {
    const result = await executeFinanceTestReset({
      userId: req.user?.id,
      password: req.body?.password,
      confirmation: req.body?.confirmation,
    });
    await writeAuditEvent({
      req,
      userId: req.user?.id,
      workspaceCode: FINANCE_WORKSPACE,
      action: "EQUIPMENT_FINANCE_RESET_EXECUTED",
      actionType: "EQUIPMENT_FINANCE_RESET_EXECUTED",
      entityType: "equipment_installment_reset",
      entityId: result.dry_run_fingerprint,
      outcome: "completed",
      severity: "critical",
      details: "Reset Installment Finance transactional data after password re-authentication and exact confirmation.",
      metadata: { database: result.database, deleted: result.deleted, production_reset_executed: true },
    });
    return res.json(result);
  } catch (error) {
    return sendError(res, error, "Installment Finance reset was blocked.");
  }
});

module.exports = router;
module.exports.requireOriginalAdministrator = requireOriginalAdministrator;
