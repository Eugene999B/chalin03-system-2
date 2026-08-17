const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  FINANCE_WORKSPACE,
  RESET_CONFIRMATION,
  buildDryRun,
  executeReset,
} = require("../services/installmentFinanceLiveResetService");
const { getInstallmentCompletionReadiness } = require("../services/installmentCompletionPhaseFourService");

const router = express.Router();

function sendError(res, error, fallback) {
  return res.status(Number(error.statusCode || 500)).json({
    status: "error",
    code: error.code || "INSTALLMENT_FINANCE_RESET_ERROR",
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

router.get(
  "/completion-phase-four/readiness",
  requirePermission("fleet.assets.view"),
  async (_req, res) => {
    try {
      const readiness = await getInstallmentCompletionReadiness();
      return res.json({ status: "success", readiness });
    } catch (error) {
      return sendError(res, error, "Could not verify final Finance readiness.");
    }
  }
);

router.post(
  "/completion-phase-four/reset/dry-run",
  requirePermission("fleet.assets.manage"),
  requireOriginalAdministrator,
  async (_req, res) => {
    try {
      const dryRun = await buildDryRun();
      return res.json({ status: "success", dry_run: dryRun });
    } catch (error) {
      return sendError(res, error, "Could not prepare the Installment reset dry run.");
    }
  }
);

router.post(
  "/completion-phase-four/reset/execute",
  requirePermission("fleet.assets.manage"),
  requireOriginalAdministrator,
  async (req, res) => {
    try {
      const result = await executeReset({
        userId: req.user?.id,
        password: req.body?.password,
        confirmation: req.body?.confirmation,
        dryRunFingerprint: req.body?.dry_run_fingerprint,
      });

      let auditWarning = null;
      try {
        await writeAuditEvent({
          req,
          userId: req.user?.id,
          workspaceCode: FINANCE_WORKSPACE,
          action: "EQUIPMENT_INSTALLMENT_FINANCE_RESET_EXECUTED",
          actionType: "equipment_installment_finance.reset.executed",
          entityType: "equipment_installment_finance_reset",
          entityId: result.dry_run_fingerprint,
          outcome: "completed",
          severity: "critical",
          details: "Installment Finance transactional data was reset after password re-authentication and exact confirmation.",
          metadata: {
            dry_run_fingerprint: result.dry_run_fingerprint,
            deleted: result.deleted,
            confirmation_phrase: RESET_CONFIRMATION,
          },
        });
      } catch (auditError) {
        auditWarning = "The reset completed, but the audit record could not be written.";
        console.error("Installment Finance reset audit write failed after successful commit", auditError);
      }

      return res.json({ ...result, audit_warning: auditWarning });
    } catch (error) {
      return sendError(res, error, "Installment Finance reset was blocked.");
    }
  }
);

module.exports = router;
module.exports.requireOriginalAdministrator = requireOriginalAdministrator;
