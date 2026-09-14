const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  advisoryAssessment,
  nextAction,
} = require("./equipmentCreditOptionalDecisionRoutes");
const { acquireConnection } = require("./equipmentFinanceCriticalEntryRoutes");

const router = express.Router();

const CONNECTION_TIMEOUT_MS = 7000;
const QUERY_TIMEOUT_MS = 8000;
const AUDIT_TIMEOUT_MS = 3000;
const ADMIN_ROLES = new Set([
  "admin",
  "administrator",
  "system_admin",
  "system_administrator",
  "super_admin",
]);

class AdministratorApprovalError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanText(value, maximum = 2000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function assignedRoles(req) {
  return [req.user?.workspace_role, req.user?.access_role, req.user?.role]
    .map((value) => cleanText(value, 80).toLowerCase())
    .filter(Boolean);
}

function isAdministrator(req) {
  return assignedRoles(req).some((role) => ADMIN_ROLES.has(role));
}

function actorId(req) {
  const id = positiveId(req.user?.id);
  if (!id) {
    throw new AdministratorApprovalError(
      401,
      "A signed-in administrator is required.",
      "FINANCE_ADMINISTRATOR_REQUIRED"
    );
  }
  return id;
}

function query(connection, sql, params = [], timeout = QUERY_TIMEOUT_MS) {
  return connection.query({ sql, timeout }, params);
}

async function withDeadline(promise, timeoutMs, fallback = null) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function assertKnownVersion(body, application) {
  if (
    body?.known_version === undefined ||
    body?.known_version === null ||
    body?.known_version === ""
  ) {
    return;
  }
  const known = Number(body.known_version);
  const current = Number(application.decision_version || 0);
  if (!Number.isInteger(known) || known !== current) {
    throw new AdministratorApprovalError(
      409,
      "This application changed after it was opened. Reload it before approving.",
      "EQUIPMENT_CREDIT_DECISION_VERSION_CONFLICT"
    );
  }
}

async function loadApplication(connection, applicationId, lock = false) {
  const [rows] = await query(
    connection,
    `SELECT application.id, application.application_number,
            application.customer_id, application.quotation_id, application.asset_id,
            application.application_date, application.application_status,
            application.kyc_status, application.affordability_status,
            application.risk_band, application.risk_score,
            application.quoted_total, application.proposed_deposit,
            application.financed_amount, application.proposed_frequency,
            application.proposed_interval_days,
            application.proposed_non_working_day_rule,
            application.proposed_installment_count,
            application.proposed_installment_amount,
            application.proposed_periodic_amount,
            application.monthly_salary_income,
            application.monthly_business_income,
            application.monthly_other_income,
            application.monthly_business_costs,
            application.monthly_household_expenses,
            application.existing_monthly_debt,
            application.total_monthly_income,
            application.total_monthly_commitments,
            application.net_monthly_surplus,
            application.debt_service_ratio_percent,
            application.total_commitment_ratio_percent,
            application.deposit_ratio_percent,
            application.assessment_recommendation,
            application.assessment_notes,
            application.customer_consent_at,
            application.submitted_by, application.submitted_at,
            application.reviewed_by, application.reviewed_at,
            application.decision_reason, application.decision_version,
            application.created_at, application.updated_at
       FROM equipment_credit_applications application
      WHERE application.id = ?
      LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [applicationId]
  );
  return rows[0] || null;
}

async function loadKyc(connection, applicationId, lock = false) {
  const [rows] = await query(
    connection,
    `SELECT * FROM equipment_credit_application_kyc
      WHERE application_id = ? LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [applicationId]
  );
  return rows[0] || null;
}

async function persistAssessment(connection, application, assessment, userId) {
  await query(
    connection,
    `UPDATE equipment_credit_applications
        SET kyc_status = ?, affordability_status = ?, risk_band = ?, risk_score = ?,
            debt_service_ratio_percent = ?, total_commitment_ratio_percent = ?,
            net_monthly_surplus = ?, assessment_recommendation = ?, updated_by = ?
      WHERE id = ?`,
    [
      assessment.kyc_status,
      assessment.affordability_status,
      assessment.risk_band,
      assessment.risk_score,
      assessment.debt_service_ratio_percent,
      assessment.total_commitment_ratio_percent,
      assessment.net_monthly_surplus,
      assessment.assessment_recommendation,
      userId,
      application.id,
    ]
  );
  Object.assign(application, {
    kyc_status: assessment.kyc_status,
    affordability_status: assessment.affordability_status,
    risk_band: assessment.risk_band,
    risk_score: assessment.risk_score,
    debt_service_ratio_percent: assessment.debt_service_ratio_percent,
    total_commitment_ratio_percent: assessment.total_commitment_ratio_percent,
    net_monthly_surplus: assessment.net_monthly_surplus,
    assessment_recommendation: assessment.assessment_recommendation,
  });
}

async function recordApproval(
  connection,
  application,
  fromStatus,
  assessment,
  notes,
  userId
) {
  const version = Number(application.decision_version || 0) + 1;
  await query(
    connection,
    `UPDATE equipment_credit_applications
        SET decision_version = ?, updated_by = ?
      WHERE id = ?`,
    [version, userId, application.id]
  );
  await query(
    connection,
    `INSERT INTO equipment_credit_application_decisions (
       application_id, decision_version, action_type, from_status, to_status,
       affordability_status, risk_band, risk_score,
       debt_service_ratio_percent, net_monthly_surplus,
       notes, snapshot_json, decided_by
     ) VALUES (?, ?, 'approved', ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      application.id,
      version,
      fromStatus,
      assessment?.affordability_status || application.affordability_status || null,
      assessment?.risk_band || application.risk_band || null,
      assessment?.risk_score ?? application.risk_score ?? null,
      assessment?.debt_service_ratio_percent ??
        application.debt_service_ratio_percent ??
        null,
      assessment?.net_monthly_surplus ?? application.net_monthly_surplus ?? null,
      notes,
      JSON.stringify({
        phase: 3,
        finance_scope: "company_wide",
        administrator_override: true,
        separate_manager_review_required: false,
        optional_customer_information: true,
        assessment: assessment || null,
      }),
      userId,
    ]
  );
  application.decision_version = version;
}

async function writeApprovalAudit(req, application, fromStatus, reason) {
  try {
    await withDeadline(
      writeAuditEvent({
        req,
        action: "EQUIPMENT_CREDIT_APPLICATION_ADMIN_APPROVED",
        actionType: "EQUIPMENT_CREDIT_APPLICATION_ADMIN_APPROVED",
        entityType: "equipment_credit_application",
        entityId: application.id,
        workspaceCode: "equipment_installment_finance",
        hireLocationId: null,
        severity: "notice",
        outcome: "success",
        details: `Administrator approved ${application.application_number} directly from ${fromStatus}.`,
        metadata: {
          phase: 3,
          finance_scope: "company_wide",
          application_number: application.application_number,
          administrator_override: true,
          separate_manager_review_required: false,
          reason,
        },
      }).catch(() => null),
      AUDIT_TIMEOUT_MS,
      null
    );
  } catch {
    // A committed administrator approval must never be rolled back by audit failure.
  }
}

function sendError(req, res, error) {
  if (error instanceof AdministratorApprovalError) {
    return res.status(error.statusCode).json({
      status: "error",
      code: error.code,
      message: error.message,
      request_id: req.requestId || null,
      retryable: false,
    });
  }

  const code = cleanText(error?.code, 100);
  const message = cleanText(error?.message, 1000);
  console.error("Administrator Finance approval failed", {
    request_id: req.requestId || null,
    code: code || null,
    message: message || null,
  });
  const schemaFailure = ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(code);
  return res.status(schemaFailure ? 503 : 500).json({
    status: "error",
    code: schemaFailure
      ? "FINANCE_ADMIN_APPROVAL_SCHEMA_NOT_READY"
      : "FINANCE_ADMIN_APPROVAL_FAILED",
    message: schemaFailure
      ? "The Finance approval foundation is not ready for administrator approval."
      : "The administrator approval could not be completed safely.",
    request_id: req.requestId || null,
    retryable: true,
  });
}

router.post(
  "/credit-applications/:id/submit",
  requirePermission("fleet.assets.manage"),
  async (req, res, next) => {
    if (!isAdministrator(req)) return next();

    const applicationId = positiveId(req.params.id);
    let connection;
    let transactionActive = false;
    try {
      if (!applicationId) {
        throw new AdministratorApprovalError(
          400,
          "Invalid installment application ID.",
          "INVALID_FINANCE_APPLICATION_ID"
        );
      }
      const userId = actorId(req);
      connection = await acquireConnection(CONNECTION_TIMEOUT_MS);
      await connection.beginTransaction();
      transactionActive = true;

      const application = await loadApplication(connection, applicationId, true);
      if (!application) {
        throw new AdministratorApprovalError(
          404,
          "Installment application was not found.",
          "FINANCE_APPLICATION_NOT_FOUND"
        );
      }
      if (application.application_status === "approved") {
        await connection.commit();
        transactionActive = false;
        return res.json({
          status: "success",
          message: "This application is already approved; no duplicate decision was created.",
          request_id: req.requestId || null,
          application,
          next_action: nextAction("approved"),
          idempotent_replay: true,
          administrator_override: true,
        });
      }

      assertKnownVersion(req.body, application);
      if (!["draft", "changes_requested"].includes(application.application_status)) {
        throw new AdministratorApprovalError(
          409,
          "Administrator direct approval is available from a draft or changes-requested application. Open submitted applications and use Approve.",
          "FINANCE_ADMIN_APPROVAL_INVALID_TRANSITION"
        );
      }

      const kyc = await loadKyc(connection, application.id, true);
      const assessment = advisoryAssessment(application, kyc || {});
      await persistAssessment(connection, application, assessment, userId);

      const fromStatus = application.application_status;
      const reason =
        cleanText(req.body?.notes || req.body?.reason, 1500) ||
        "Approved directly by an administrator. A separate manager review was not required.";

      await query(
        connection,
        `UPDATE equipment_credit_applications
            SET application_status = 'approved',
                submitted_by = COALESCE(submitted_by, ?),
                submitted_at = COALESCE(submitted_at, NOW()),
                reviewed_by = ?, reviewed_at = NOW(),
                decision_reason = ?, updated_by = ?
          WHERE id = ?`,
        [userId, userId, reason, userId, application.id]
      );
      application.application_status = "approved";
      application.submitted_by = application.submitted_by || userId;
      application.reviewed_by = userId;
      application.decision_reason = reason;

      await recordApproval(
        connection,
        application,
        fromStatus,
        assessment,
        reason,
        userId
      );
      await connection.commit();
      transactionActive = false;

      void writeApprovalAudit(req, application, fromStatus, reason);
      return res.json({
        status: "success",
        message:
          "Installment application approved directly by the administrator. No separate manager review is required.",
        request_id: req.requestId || null,
        application,
        next_action: nextAction("approved"),
        idempotent_replay: false,
        administrator_override: true,
      });
    } catch (error) {
      if (transactionActive && connection) {
        try {
          await connection.rollback();
        } catch {
          // Preserve the original error.
        }
      }
      return sendError(req, res, error);
    } finally {
      connection?.release();
    }
  }
);

module.exports = router;
module.exports.ADMIN_ROLES = ADMIN_ROLES;
module.exports.isAdministrator = isAdministrator;
