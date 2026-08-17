const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { writeAuditEvent } = require("../services/auditTrailService");
const { FINANCE_WORKSPACE, RESET_CONFIRMATION, buildDryRun } = require("../services/installmentFinanceResetScopeServiceV2");
const { executeReset } = require("../services/installmentFinanceResetProductionService");
const { getInstallmentCompletionReadiness } = require("../services/installmentCompletionPhaseFourService");
const { getEntityImpact, deleteEntityTransaction } = require("../services/installmentUnifiedDeletionServiceV1");

const router = express.Router();

function sendError(res, error, fallback) {
  console.error("Installment Finance reset request failed", { code: error?.code, statusCode: error?.statusCode, message: error?.message, stack: error?.stack });
  return res.status(Number(error.statusCode || 500)).json({ status: "error", code: error.code || "INSTALLMENT_FINANCE_RESET_ERROR", message: error.message || fallback });
}

function requireOriginalAdministrator(req, res, next) {
  if (isOriginalSystemAdministrator(req.user)) return next();
  return res.status(403).json({ status: "error", code: "ORIGINAL_SYSTEM_ADMINISTRATOR_REQUIRED", message: "Only the original System Administrator can perform this destructive Installment action." });
}

function parseEntityType(value) {
  return String(value || "").toLowerCase() === "asset" ? "asset" : "customer";
}

router.get("/completion-phase-four/readiness", requirePermission("fleet.assets.view"), async (_req, res) => {
  try { return res.json({ status: "success", readiness: await getInstallmentCompletionReadiness() }); }
  catch (error) { return sendError(res, error, "Could not verify final Finance readiness."); }
});

router.post("/completion-phase-four/reset/dry-run", requirePermission("fleet.assets.manage"), requireOriginalAdministrator, async (_req, res) => {
  try { return res.json({ status: "success", dry_run: await buildDryRun() }); }
  catch (error) { return sendError(res, error, "Could not prepare the Installment reset dry run."); }
});

router.post("/completion-phase-four/reset/execute", requirePermission("fleet.assets.manage"), requireOriginalAdministrator, async (req, res) => {
  try {
    const result = await executeReset({ userId: req.user?.id, password: req.body?.password, confirmation: req.body?.confirmation, dryRunFingerprint: req.body?.dry_run_fingerprint });
    let auditWarning = null;
    try {
      await writeAuditEvent({ req, userId: req.user?.id, workspaceCode: FINANCE_WORKSPACE, action: "EQUIPMENT_INSTALLMENT_FINANCE_RESET_EXECUTED", actionType: "equipment_installment_finance.reset.executed", entityType: "equipment_installment_finance_reset", entityId: result.dry_run_fingerprint, outcome: "completed", severity: "critical", details: "Installment Finance data was cleared through the unified deletion engine after password re-authentication and exact confirmation.", metadata: { dry_run_fingerprint: result.dry_run_fingerprint, deleted: result.deleted, masters: result.masters, confirmation_phrase: RESET_CONFIRMATION } });
    } catch (auditError) {
      auditWarning = "The reset completed, but the audit record could not be written.";
      console.error("Installment Finance reset audit write failed after successful commit", auditError);
    }
    return res.json({ ...result, audit_warning: auditWarning });
  } catch (error) { return sendError(res, error, "Installment Finance reset was blocked."); }
});

router.post("/completion-phase-four/entity/:entityType/:entityId/impact", requirePermission("fleet.assets.manage"), requireOriginalAdministrator, async (req, res) => {
  try {
    const entityType = parseEntityType(req.params.entityType);
    const entityId = Number(req.params.entityId);
    if (!Number.isInteger(entityId) || entityId <= 0) return res.status(400).json({ status: "error", message: "Invalid Installment customer/excavator ID." });
    return res.json({ status: "success", impact: await getEntityImpact(entityType, entityId) });
  } catch (error) { return sendError(res, error, "Could not prepare the deletion impact."); }
});

router.post("/completion-phase-four/entity/:entityType/:entityId/delete", requirePermission("fleet.assets.manage"), requireOriginalAdministrator, async (req, res) => {
  try {
    const entityType = parseEntityType(req.params.entityType);
    const entityId = Number(req.params.entityId);
    const confirmation = String(req.body?.confirmation || "").trim();
    const expected = `DELETE INSTALLMENT ${entityType === "asset" ? "EXCAVATOR" : "CUSTOMER"} ${entityId}`;
    if (confirmation !== expected) return res.status(400).json({ status: "error", code: "DELETE_CONFIRMATION_REQUIRED", message: `Type ${expected} exactly to confirm.` });
    const result = await deleteEntityTransaction(entityType, entityId);
    try {
      await writeAuditEvent({ req, userId: req.user?.id, workspaceCode: FINANCE_WORKSPACE, action: "EQUIPMENT_INSTALLMENT_ENTITY_DELETED", actionType: "equipment_installment_finance.entity.deleted", entityType: entityType === "asset" ? "fleet_asset" : "customer", entityId, outcome: "completed", severity: "critical", details: "An Installment-owned customer/excavator and its Installment integration were deleted transactionally.", metadata: { deleted: result.deleted, master: result.master } });
    } catch (auditError) { console.error("Installment entity deletion audit failed after successful commit", auditError); }
    return res.json(result);
  } catch (error) { return sendError(res, error, "The Installment record could not be deleted."); }
});

module.exports = router;
module.exports.requireOriginalAdministrator = requireOriginalAdministrator;
