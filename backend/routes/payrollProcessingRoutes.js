const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { normalizeCategory } = require("../services/categoryIsolationService");
const { writeAuditEvent } = require("../services/auditTrailService");
const { PayrollFoundationError } = require("../services/payrollFoundationService");
const { revokeCurrentPayslipsForEntry } = require("../services/payrollPayslipService");
const payrollPayslipRoutes = require("./payrollPayslipRoutes");
const {
  approvePayrollPeriod,
  approveStatutoryRule,
  decideAdjustment,
  lockPayrollPeriod,
  payrollPeriodDetail,
  preparePayrollPeriod,
  reconcilePayrollPeriod,
  recordSalaryPayment,
  requestPaymentReversal,
  submitStatutoryRule,
  validatePayrollPeriod,
} = require("../services/payrollProcessingService");

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch((error) => {
    if (error instanceof PayrollFoundationError || error?.statusCode) {
      return res.status(Number(error.statusCode || 400)).json({
        status: "error",
        code: error.code || "PAYROLL_PROCESSING_ERROR",
        message: error.message,
        ...(error.readiness ? { readiness: error.readiness } : {}),
        ...(error.details ? { details: error.details } : {}),
      });
    }
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        status: "error",
        code: "PAYROLL_PROCESSING_DUPLICATE",
        message: "That payroll entry, payment, adjustment or external reference is already recorded.",
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

async function audit(req, action, entityType, entityId, details, metadata = {}) {
  await writeAuditEvent({
    req,
    action,
    actionType: action,
    entityType,
    entityId,
    workspaceCode: requirePayrollWorkspace(req),
    details,
    severity: "warning",
    metadata,
  });
}

router.get(
  "/processing/periods/:periodId",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const result = await payrollPeriodDetail({
      periodId: req.params.periodId,
      workspaceCode: requirePayrollWorkspace(req),
    });
    return res.json({ status: "success", ...result });
  })
);

router.post(
  "/processing/periods/:periodId/validate",
  requirePermission("payroll.prepare"),
  asyncHandler(async (req, res) => {
    const result = await validatePayrollPeriod({
      periodId: req.params.periodId,
      workspaceCode: requirePayrollWorkspace(req),
    });
    return res.status(result.valid ? 200 : 409).json({
      status: result.valid ? "success" : "warning",
      message: result.valid
        ? "Payroll validation passed. The draft can be prepared for independent review."
        : "Payroll validation found exceptions that must be resolved before review.",
      validation: result,
    });
  })
);

router.post(
  "/processing/periods/:periodId/prepare",
  requirePermission("payroll.prepare"),
  asyncHandler(async (req, res) => {
    const result = await preparePayrollPeriod({
      periodId: req.params.periodId,
      workspaceCode: requirePayrollWorkspace(req),
      actorId: req.user?.id || null,
    });
    await audit(
      req,
      "PAYROLL_PERIOD_PREPARED_FOR_REVIEW",
      "payroll_period",
      result.period_id,
      "Payroll calculations were snapshotted and submitted for independent approval.",
      { entry_count: result.entry_count, totals: result.totals }
    );
    return res.json({
      status: "success",
      message: "Payroll was prepared from approved compensation and statutory-rule data. A different authorised reviewer must approve it.",
      result,
    });
  })
);

router.post(
  "/processing/periods/:periodId/approve",
  requirePermission("payroll.approve"),
  asyncHandler(async (req, res) => {
    const result = await approvePayrollPeriod({
      periodId: req.params.periodId,
      workspaceCode: requirePayrollWorkspace(req),
      actorId: req.user?.id || null,
    });
    await audit(
      req,
      "PAYROLL_PERIOD_APPROVED",
      "payroll_period",
      result.period_id,
      "An independent payroll reviewer approved the preserved worker calculations.",
      { entry_count: result.entry_count }
    );
    return res.json({ status: "success", message: "Payroll approved. Lock it before salary payments begin.", result });
  })
);

router.post(
  "/processing/periods/:periodId/lock",
  requirePermission("payroll.approve"),
  asyncHandler(async (req, res) => {
    const result = await lockPayrollPeriod({
      periodId: req.params.periodId,
      workspaceCode: requirePayrollWorkspace(req),
      actorId: req.user?.id || null,
    });
    await audit(
      req,
      "PAYROLL_PERIOD_LOCKED_FOR_PAYMENT",
      "payroll_period",
      result.period_id,
      "Approved payroll snapshots were locked for salary payment."
    );
    return res.json({ status: "success", message: "Payroll locked. Approved worker balances are now payment-ready.", result });
  })
);

router.post(
  "/processing/entries/:entryId/payments",
  requirePermission("payroll.pay"),
  asyncHandler(async (req, res) => {
    const workspaceCode = requirePayrollWorkspace(req);
    const result = await recordSalaryPayment({
      entryId: req.params.entryId,
      workspaceCode,
      input: req.body || {},
      actorId: req.user?.id || null,
    });
    if (!result.replayed) {
      await audit(
        req,
        "PAYROLL_SALARY_PAYMENT_POSTED",
        "payroll_salary_payment",
        result.payment.id,
        `Salary payment ${result.payment.payment_number} was posted against a locked payroll entry.`,
        { entry_id: Number(req.params.entryId), amount: result.payment.amount, payment_reference: result.payment.payment_reference }
      );
    }
    return res.status(result.replayed ? 200 : 201).json({
      status: "success",
      replayed: result.replayed,
      message: result.replayed ? "The original salary payment is returned for this request key." : "Salary payment posted and the worker balance was recalculated from preserved payment evidence.",
      ...result,
    });
  })
);

router.post(
  "/processing/payments/:paymentId/reversal-request",
  requirePermission("payroll.adjust"),
  asyncHandler(async (req, res) => {
    const result = await requestPaymentReversal({
      paymentId: req.params.paymentId,
      workspaceCode: requirePayrollWorkspace(req),
      input: req.body || {},
      actorId: req.user?.id || null,
    });
    await audit(
      req,
      "PAYROLL_PAYMENT_REVERSAL_REQUESTED",
      "payroll_adjustment_request",
      result.request_id,
      "A salary-payment reversal request was recorded for independent review.",
      { payment_id: result.payment_id }
    );
    return res.status(201).json({
      status: "success",
      message: "Payment reversal requested. The original payment remains preserved and a different authorised reviewer must decide it.",
      result,
    });
  })
);

router.post(
  "/processing/adjustments/:requestId/decision",
  requirePermission("payroll.approve"),
  asyncHandler(async (req, res) => {
    const workspaceCode = requirePayrollWorkspace(req);
    const result = await decideAdjustment({
      requestId: req.params.requestId,
      workspaceCode,
      input: req.body || {},
      actorId: req.user?.id || null,
    });
    if (result.status === "executed" && result.entry?.id) {
      await revokeCurrentPayslipsForEntry({
        entryId: result.entry.id,
        actorId: req.user?.id || null,
        reason: `Automatically revoked after approved salary payment reversal ${result.request_id}.`,
      });
    }
    await audit(
      req,
      "PAYROLL_ADJUSTMENT_DECIDED",
      "payroll_adjustment_request",
      result.request_id,
      `Payroll adjustment decision completed with status ${result.status}.`,
      { decision: req.body?.decision, reversal_payment_id: result.reversal_payment_id || null }
    );
    return res.json({
      status: "success",
      message: result.status === "executed"
        ? "Approved reversal executed through preserved payment evidence and the worker balance was recalculated. Any current payslip for the affected entry was revoked."
        : "Payroll adjustment request rejected; the original salary payment remains active.",
      result,
    });
  })
);

router.post(
  "/processing/periods/:periodId/reconcile",
  requirePermission("payroll.audit"),
  asyncHandler(async (req, res) => {
    const result = await reconcilePayrollPeriod({
      periodId: req.params.periodId,
      workspaceCode: requirePayrollWorkspace(req),
    });
    await audit(
      req,
      "PAYROLL_PERIOD_RECONCILED",
      "payroll_period",
      result.period_id,
      result.status === "reconciled"
        ? "All worker salary balances reconciled to preserved posted payments."
        : "Payroll reconciliation completed with outstanding worker salary balances.",
      result
    );
    return res.json({
      status: "success",
      message: result.status === "reconciled"
        ? "Payroll fully reconciled. Every worker entry is paid from preserved payment evidence."
        : "Reconciliation completed. Outstanding or part-paid worker balances remain visible for follow-up.",
      result,
    });
  })
);

router.post(
  "/processing/statutory-rules/:ruleId/submit",
  requirePermission("payroll.prepare"),
  asyncHandler(async (req, res) => {
    const result = await submitStatutoryRule({
      ruleId: req.params.ruleId,
      workspaceCode: requirePayrollWorkspace(req),
      actorId: req.user?.id || null,
      allowGroup: isOriginalSystemAdministrator(req.user),
    });
    await audit(
      req,
      "PAYROLL_STATUTORY_RULE_SUBMITTED",
      "payroll_statutory_rule_version",
      result.id,
      `Statutory payroll rule ${result.rule_code} was submitted for independent approval.`
    );
    return res.json({ status: "success", message: "Statutory rule submitted for independent approval.", rule: result });
  })
);

router.post(
  "/processing/statutory-rules/:ruleId/approve",
  requirePermission("payroll.approve"),
  asyncHandler(async (req, res) => {
    const result = await approveStatutoryRule({
      ruleId: req.params.ruleId,
      workspaceCode: requirePayrollWorkspace(req),
      actorId: req.user?.id || null,
      allowGroup: isOriginalSystemAdministrator(req.user),
    });
    await audit(
      req,
      "PAYROLL_STATUTORY_RULE_APPROVED",
      "payroll_statutory_rule_version",
      result.id,
      `Statutory payroll rule ${result.rule_code} became authoritative for its effective period.`
    );
    return res.json({ status: "success", message: "Statutory rule approved. Future payroll validation will use the effective version as data.", rule: result });
  })
);

router.use(payrollPayslipRoutes);

module.exports = router;
module.exports.activeWorkspace = activeWorkspace;