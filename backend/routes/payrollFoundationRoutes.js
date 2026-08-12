const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { normalizeCategory } = require("../services/categoryIsolationService");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  PayrollFoundationError,
  approveCompensationProfile,
  compensationHistory,
  createCompensationDraft,
  createPayrollPeriod,
  createStatutoryRuleDraft,
  listPayrollPeriods,
  listStatutoryRules,
  schemaStatus,
  submitCompensationProfile,
} = require("../services/payrollFoundationService");
const { workerPayrollProfile } = require("../services/payrollWorkerProfileService");

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch((error) => {
    if (error instanceof PayrollFoundationError || error?.statusCode) {
      return res.status(Number(error.statusCode || 400)).json({
        status: "error",
        code: error.code || "PAYROLL_FOUNDATION_ERROR",
        message: error.message,
        ...(error.readiness ? { readiness: error.readiness } : {}),
      });
    }
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        status: "error",
        code: "PAYROLL_FOUNDATION_DUPLICATE",
        message: "That payroll record already exists for the selected worker, period or reference.",
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
  "/readiness",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const readiness = await schemaStatus();
    return res.status(readiness.ready ? 200 : 503).json({
      status: readiness.ready ? "success" : "warning",
      workspace_code: requirePayrollWorkspace(req),
      readiness,
      policy: {
        salary_is_separate_from_worker_profile_permissions: true,
        maker_checker_required_for_compensation_approval: true,
        statutory_rates_are_versioned_data: true,
        runtime_schema_mutation: false,
      },
    });
  })
);

router.get(
  "/workers/:workerId/profile",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const profile = await workerPayrollProfile({
      workerId: req.params.workerId,
      workspaceCode: requirePayrollWorkspace(req),
    });
    return res.json({ status: "success", ...profile });
  })
);

router.get(
  "/workers/:workerId/compensation",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const result = await compensationHistory({
      workerId: req.params.workerId,
      workspaceCode: requirePayrollWorkspace(req),
    });
    return res.json({ status: "success", ...result });
  })
);

router.post(
  "/workers/:workerId/compensation",
  requirePermission("payroll.manage"),
  asyncHandler(async (req, res) => {
    const workspaceCode = requirePayrollWorkspace(req);
    const result = await createCompensationDraft({
      workerId: req.params.workerId,
      workspaceCode,
      input: req.body || {},
      actorId: req.user?.id || null,
    });
    await audit(
      req,
      "PAYROLL_COMPENSATION_DRAFT_CREATED",
      "payroll_compensation_profile",
      result.profile_id,
      `A new effective-dated compensation draft was created for ${result.worker.employee_number}.`,
      { worker_id: result.worker.id, effective_from: req.body?.effective_from }
    );
    return res.status(201).json({
      status: "success",
      message: "Compensation draft created. Submit it for independent approval before it becomes authoritative.",
      ...result,
    });
  })
);

router.post(
  "/compensation/:profileId/submit",
  requirePermission("payroll.prepare"),
  asyncHandler(async (req, res) => {
    const result = await submitCompensationProfile({
      profileId: req.params.profileId,
      workspaceCode: requirePayrollWorkspace(req),
      actorId: req.user?.id || null,
    });
    await audit(
      req,
      "PAYROLL_COMPENSATION_SUBMITTED",
      "payroll_compensation_profile",
      result.id,
      "A compensation change was submitted for independent payroll approval."
    );
    return res.json({ status: "success", message: "Compensation change submitted for independent approval.", profile: result });
  })
);

router.post(
  "/compensation/:profileId/approve",
  requirePermission("payroll.approve"),
  asyncHandler(async (req, res) => {
    const result = await approveCompensationProfile({
      profileId: req.params.profileId,
      workspaceCode: requirePayrollWorkspace(req),
      actorId: req.user?.id || null,
    });
    await audit(
      req,
      "PAYROLL_COMPENSATION_APPROVED",
      "payroll_compensation_profile",
      result.id,
      "An independently reviewed compensation profile became authoritative.",
      { worker_id: result.worker_id, supersedes_profile_id: result.supersedes_profile_id }
    );
    return res.json({ status: "success", message: "Compensation profile approved and effective-dated history preserved.", profile: result });
  })
);

router.get(
  "/statutory-rules",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const rules = await listStatutoryRules({ workspaceCode: requirePayrollWorkspace(req) });
    return res.json({ status: "success", count: rules.length, rules });
  })
);

router.post(
  "/statutory-rules",
  requirePermission("payroll.manage"),
  asyncHandler(async (req, res) => {
    const rule = await createStatutoryRuleDraft({
      workspaceCode: requirePayrollWorkspace(req),
      input: req.body || {},
      actorId: req.user?.id || null,
      allowGroup: isOriginalSystemAdministrator(req.user),
    });
    await audit(
      req,
      "PAYROLL_STATUTORY_RULE_DRAFT_CREATED",
      "payroll_statutory_rule_version",
      rule.id,
      `A versioned statutory payroll rule draft was created for ${rule.rule_code}.`,
      { scope_code: rule.scope_code, version_label: rule.version_label }
    );
    return res.status(201).json({
      status: "success",
      message: "Statutory rule version saved as data. No tax or contribution rate was hard-coded into application logic.",
      rule,
    });
  })
);

router.get(
  "/periods",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const periods = await listPayrollPeriods({ workspaceCode: requirePayrollWorkspace(req) });
    return res.json({ status: "success", count: periods.length, periods });
  })
);

router.post(
  "/periods",
  requirePermission("payroll.prepare"),
  asyncHandler(async (req, res) => {
    const period = await createPayrollPeriod({
      workspaceCode: requirePayrollWorkspace(req),
      input: req.body || {},
      actorId: req.user?.id || null,
    });
    await audit(
      req,
      "PAYROLL_PERIOD_CREATED",
      "payroll_period",
      period.id,
      `Payroll period ${period.period_code} was created as a draft.`,
      { period_code: period.period_code }
    );
    return res.status(201).json({ status: "success", message: "Payroll period created as a draft.", period });
  })
);

module.exports = router;
module.exports.activeWorkspace = activeWorkspace;