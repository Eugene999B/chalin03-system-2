const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { normalizeCategory } = require("../services/categoryIsolationService");
const { writeAuditEvent } = require("../services/auditTrailService");
const { PayrollFoundationError } = require("../services/payrollFoundationService");
const {
  getPayslip,
  issuePayslip,
  listEntryPayslips,
  revokePayslip,
} = require("../services/payrollPayslipService");
const { buildPayslipPdf } = require("../services/payrollPayslipPdfService");

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch((error) => {
    if (error instanceof PayrollFoundationError || error?.statusCode) {
      return res.status(Number(error.statusCode || 400)).json({
        status: "error",
        code: error.code || "PAYROLL_PAYSLIP_ERROR",
        message: error.message,
        ...(error.readiness ? { readiness: error.readiness } : {}),
      });
    }
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        status: "error",
        code: "PAYROLL_PAYSLIP_DUPLICATE",
        message: "That payslip version or verification reference already exists.",
      });
    }
    return next(error);
  });
}

function activeWorkspace(req) {
  const sessionWorkspace = normalizeCategory(req.user?.workspace_code);
  if (sessionWorkspace) return sessionWorkspace;
  if (isOriginalSystemAdministrator(req.user)) {
    return normalizeCategory(req.body?.workspace_code || req.query?.workspace_code);
  }
  return null;
}

function requirePayrollWorkspace(req) {
  const workspaceCode = activeWorkspace(req);
  if (!workspaceCode) {
    throw new PayrollFoundationError(400, "Choose a valid payroll business category.", "PAYROLL_WORKSPACE_REQUIRED");
  }
  return workspaceCode;
}

async function audit(req, action, entityId, details, metadata = {}) {
  await writeAuditEvent({
    req,
    action,
    actionType: action,
    entityType: "payroll_payslip",
    entityId,
    workspaceCode: requirePayrollWorkspace(req),
    details,
    severity: "warning",
    metadata,
  });
}

function safeFilename(value) {
  return String(value || "payslip")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 140) || "payslip";
}

router.post(
  "/payslips/entries/:entryId/issue",
  requirePermission("payroll.payslip.issue"),
  asyncHandler(async (req, res) => {
    const result = await issuePayslip({
      entryId: req.params.entryId,
      workspaceCode: requirePayrollWorkspace(req),
      actorId: req.user?.id || null,
    });
    if (!result.replayed) {
      await audit(
        req,
        "PAYROLL_PAYSLIP_ISSUED",
        result.payslip.id,
        `Professional payslip ${result.payslip.payslip_number} version ${result.payslip.issue_version} was issued from reconciled payroll evidence.`,
        {
          payroll_entry_id: result.payslip.payroll_entry_id,
          worker_id: result.payslip.worker_id,
          checksum_sha256: result.payslip.checksum_sha256,
        }
      );
    }
    return res.status(result.replayed ? 200 : 201).json({
      status: "success",
      replayed: result.replayed,
      message: result.replayed
        ? "The current immutable payslip already exists for this reconciled payroll entry."
        : "Professional payslip issued from the reconciled payroll snapshot and payment evidence.",
      payslip: result.payslip,
    });
  })
);

router.get(
  "/payslips/entries/:entryId",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const result = await listEntryPayslips({
      entryId: req.params.entryId,
      workspaceCode: requirePayrollWorkspace(req),
    });
    return res.json({ status: "success", ...result });
  })
);

router.get(
  "/payslips/:payslipId",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const payslip = await getPayslip({
      payslipId: req.params.payslipId,
      workspaceCode: requirePayrollWorkspace(req),
    });
    return res.json({ status: "success", payslip });
  })
);

router.get(
  "/payslips/:payslipId/pdf",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const payslip = await getPayslip({
      payslipId: req.params.payslipId,
      workspaceCode: requirePayrollWorkspace(req),
    });
    const pdf = await buildPayslipPdf(payslip);
    const filename = `${safeFilename(payslip.payslip_number)}-v${payslip.issue_version}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(pdf);
  })
);

router.post(
  "/payslips/:payslipId/revoke",
  requirePermission("payroll.payslip.issue"),
  requirePermission("payroll.adjust"),
  asyncHandler(async (req, res) => {
    const payslip = await revokePayslip({
      payslipId: req.params.payslipId,
      workspaceCode: requirePayrollWorkspace(req),
      actorId: req.user?.id || null,
      reason: req.body?.reason,
    });
    await audit(
      req,
      "PAYROLL_PAYSLIP_REVOKED",
      payslip.id,
      `Professional payslip ${payslip.payslip_number} version ${payslip.issue_version} was revoked without deleting its preserved snapshot.`,
      { reason: payslip.revocation_reason }
    );
    return res.json({
      status: "success",
      message: "Payslip revoked. Its immutable snapshot remains preserved and public verification now reports the revoked state.",
      payslip,
    });
  })
);

module.exports = router;
