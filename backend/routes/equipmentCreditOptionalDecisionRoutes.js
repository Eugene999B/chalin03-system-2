const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  evaluateCreditApplication,
} = require("../services/equipmentCreditApplicationPolicy");

const router = express.Router();

const REVIEW_ACTIONS = new Set([
  "start_review",
  "request_changes",
  "approve",
  "decline",
]);
const REVIEWER_ROLES = new Set([
  "admin",
  "administrator",
  "manager",
  "system_administrator",
  "super_admin",
]);
const FINAL_STATUSES = new Set(["approved", "declined", "withdrawn"]);

class OptionalDecisionError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_FINANCE_OPTIONAL_DECISION_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanText(value, maxLength = 2000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 2000) {
  return cleanText(value, maxLength) || null;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function userId(req) {
  return positiveId(req.user?.id);
}

function boolValue(value) {
  return [true, 1, "1", "true", "yes", "on"].includes(value);
}

function isReviewer(req) {
  return REVIEWER_ROLES.has(cleanText(req.user?.role, 80).toLowerCase());
}

function assertReviewer(req) {
  if (!isReviewer(req)) {
    throw new OptionalDecisionError(
      403,
      "Only an authorised manager or administrator can review installment applications.",
      "EQUIPMENT_CREDIT_REVIEW_PERMISSION_REQUIRED"
    );
  }
}

function normalizeAction(value) {
  const action = cleanText(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
  return REVIEW_ACTIONS.has(action) ? action : null;
}

function hasAffordabilityInformation(application = {}) {
  return [
    "monthly_salary_income",
    "monthly_business_income",
    "monthly_other_income",
    "monthly_business_costs",
    "monthly_household_expenses",
    "existing_monthly_debt",
  ].some((key) => Number(application[key] || 0) > 0);
}

function advisoryAssessment(application = {}, kyc = {}) {
  const assessment = evaluateCreditApplication(application, kyc || {});
  const hasCoreIdentity = Boolean(
    cleanText(kyc?.customer_name_snapshot, 180) &&
      cleanText(kyc?.customer_phone_snapshot, 40)
  );
  const identityReviewed = boolValue(kyc?.identity_verified);
  const affordabilityRecorded = hasAffordabilityInformation(application);

  let affordabilityStatus = assessment.affordability_status;
  let recommendation = assessment.assessment_recommendation;
  const warnings = [...(assessment.warnings || [])];

  if (!affordabilityRecorded) {
    affordabilityStatus = "not_assessed";
    recommendation =
      "Affordability details are optional and have not been recorded. This does not block submission or approval.";
    warnings.push(
      "Optional affordability details were not supplied; the authorised manager remains responsible for the decision."
    );
  } else if (affordabilityStatus === "ineligible") {
    recommendation =
      "Advisory high-risk assessment. An authorised manager may still approve and the decision will be audited.";
  }

  return {
    ...assessment,
    kyc_status: hasCoreIdentity
      ? identityReviewed
        ? "verified"
        : "complete"
      : "incomplete",
    affordability_status: affordabilityStatus,
    assessment_recommendation: recommendation,
    warnings,
  };
}

async function withTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (_rollbackError) {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

function locationScope(req, alias = "") {
  const locationId = positiveId(req.hireLocationScope?.locationId);
  if (!locationId) return { sql: "", params: [] };
  const prefix = alias ? `${alias}.` : "";
  return { sql: ` AND ${prefix}hire_location_id = ?`, params: [locationId] };
}

async function loadApplication(connection, applicationId, req, lock = false) {
  const scope = locationScope(req);
  const [rows] = await connection.query(
    `SELECT *
     FROM equipment_credit_applications
     WHERE id = ?${scope.sql}
     LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [applicationId, ...scope.params]
  );
  return rows[0] || null;
}

async function loadKyc(connection, applicationId, lock = false) {
  const [rows] = await connection.query(
    `SELECT *
     FROM equipment_credit_application_kyc
     WHERE application_id = ?
     LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [applicationId]
  );
  return rows[0] || null;
}

async function persistAssessment(connection, application, assessment, actorId) {
  await connection.query(
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
      actorId,
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

async function recordDecision(
  connection,
  application,
  actionType,
  fromStatus,
  toStatus,
  assessment,
  notes,
  actorId,
  snapshot = {}
) {
  const nextVersion = Number(application.decision_version || 0) + 1;
  await connection.query(
    `UPDATE equipment_credit_applications
     SET decision_version = ?, updated_by = ?
     WHERE id = ?`,
    [nextVersion, actorId, application.id]
  );
  await connection.query(
    `INSERT INTO equipment_credit_application_decisions (
       application_id, decision_version, action_type, from_status, to_status,
       affordability_status, risk_band, risk_score,
       debt_service_ratio_percent, net_monthly_surplus,
       notes, snapshot_json, decided_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      application.id,
      nextVersion,
      actionType,
      fromStatus || null,
      toStatus || null,
      assessment?.affordability_status || application.affordability_status || null,
      assessment?.risk_band || application.risk_band || null,
      assessment?.risk_score ?? application.risk_score ?? null,
      assessment?.debt_service_ratio_percent ??
        application.debt_service_ratio_percent ??
        null,
      assessment?.net_monthly_surplus ?? application.net_monthly_surplus ?? null,
      nullableText(notes, 2000),
      JSON.stringify({
        optional_customer_information: true,
        optional_information_never_blocks_decision: true,
        ...snapshot,
        assessment: assessment || null,
      }),
      actorId,
    ]
  );
  application.decision_version = nextVersion;
}

async function audit(req, connection, action, application, details, metadata = {}) {
  await writeAuditEvent({
    connection,
    req,
    action,
    actionType: action,
    entityType: "equipment_credit_application",
    entityId: application.id,
    workspaceCode: "equipment_installment_finance",
    hireLocationId: application.hire_location_id || null,
    severity: "notice",
    outcome: "success",
    details,
    metadata: {
      optional_customer_information: true,
      optional_information_never_blocks_decision: true,
      ...metadata,
    },
  });
}

function sendError(res, error, fallbackMessage) {
  if (error instanceof OptionalDecisionError) {
    return res.status(error.statusCode).json({
      status: "error",
      code: error.code,
      message: error.message,
    });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ status: "error", message: fallbackMessage });
}

router.post(
  "/:id/submit",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const applicationId = positiveId(req.params.id);
      if (!applicationId) {
        throw new OptionalDecisionError(400, "Invalid installment application ID.");
      }

      const submitted = await withTransaction(async (connection) => {
        const application = await loadApplication(connection, applicationId, req, true);
        if (!application) {
          throw new OptionalDecisionError(404, "Installment application was not found.");
        }
        if (!["draft", "changes_requested"].includes(application.application_status)) {
          throw new OptionalDecisionError(
            409,
            "Only a draft or changes-requested application can be submitted."
          );
        }

        const kyc = await loadKyc(connection, application.id, true);
        const assessment = advisoryAssessment(application, kyc || {});
        await persistAssessment(connection, application, assessment, userId(req));

        const fromStatus = application.application_status;
        await connection.query(
          `UPDATE equipment_credit_applications
           SET application_status = 'submitted', submitted_by = ?, submitted_at = NOW(),
               reviewed_by = NULL, reviewed_at = NULL, decision_reason = NULL,
               updated_by = ?
           WHERE id = ?`,
          [userId(req), userId(req), application.id]
        );
        application.application_status = "submitted";

        await recordDecision(
          connection,
          application,
          "submitted",
          fromStatus,
          "submitted",
          assessment,
          nullableText(req.body?.notes, 2000) ||
            "Submitted for independent review. Optional customer details may remain blank.",
          userId(req)
        );
        await audit(
          req,
          connection,
          "EQUIPMENT_CREDIT_APPLICATION_SUBMITTED",
          application,
          `Submitted installment application ${application.application_number} for review without forcing optional customer information.`,
          {
            affordability_status: assessment.affordability_status,
            kyc_status: assessment.kyc_status,
          }
        );
        return application;
      });

      return res.json({
        status: "success",
        message:
          "Installment application submitted. Blank optional customer, KYC, guarantor or affordability fields did not block submission.",
        application: submitted,
      });
    } catch (error) {
      return sendError(res, error, "Could not submit the installment application.");
    }
  }
);

router.post(
  "/:id/kyc/verify",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      assertReviewer(req);
      const applicationId = positiveId(req.params.id);
      const verificationStatus = cleanText(req.body?.verification_status, 30).toLowerCase();
      const reason = nullableText(req.body?.reason, 1500);
      if (!applicationId || !["verified", "rejected"].includes(verificationStatus)) {
        throw new OptionalDecisionError(400, "Choose verified or rejected for the KYC review.");
      }
      if (verificationStatus === "rejected" && !reason) {
        throw new OptionalDecisionError(400, "Enter the reason for rejecting the available KYC evidence.");
      }

      const result = await withTransaction(async (connection) => {
        const application = await loadApplication(connection, applicationId, req, true);
        if (!application) {
          throw new OptionalDecisionError(404, "Installment application was not found.");
        }
        if (FINAL_STATUSES.has(application.application_status)) {
          throw new OptionalDecisionError(409, "This application already has a final decision.");
        }

        const currentKyc = await loadKyc(connection, application.id, true);
        if (!currentKyc) {
          return {
            application,
            message:
              "No optional KYC information was recorded. This does not block submission or approval.",
          };
        }

        if (verificationStatus === "verified") {
          const nextKyc = {
            ...currentKyc,
            identity_verified:
              boolValue(currentKyc.identity_verified) ||
              Boolean(currentKyc.id_type || currentKyc.id_number),
            address_verified:
              boolValue(currentKyc.address_verified) ||
              Boolean(
                currentKyc.residential_address || currentKyc.customer_address_snapshot
              ),
            income_verified:
              boolValue(currentKyc.income_verified) ||
              hasAffordabilityInformation(application),
            guarantor_verified:
              boolValue(currentKyc.guarantor_verified) ||
              Boolean(currentKyc.guarantor_name || currentKyc.guarantor_phone),
          };
          await connection.query(
            `UPDATE equipment_credit_application_kyc
             SET identity_verified = ?, address_verified = ?, income_verified = ?,
                 guarantor_verified = ?, verified_by = ?, verified_at = NOW(),
                 verification_notes = COALESCE(?, verification_notes), updated_by = ?
             WHERE application_id = ?`,
            [
              nextKyc.identity_verified ? 1 : 0,
              nextKyc.address_verified ? 1 : 0,
              nextKyc.income_verified ? 1 : 0,
              nextKyc.guarantor_verified ? 1 : 0,
              userId(req),
              reason,
              userId(req),
              application.id,
            ]
          );
          const assessment = advisoryAssessment(application, nextKyc);
          await persistAssessment(connection, application, assessment, userId(req));
          await recordDecision(
            connection,
            application,
            "kyc_verified",
            application.application_status,
            application.application_status,
            assessment,
            reason ||
              "Available KYC information reviewed. Missing optional fields were not treated as approval blockers.",
            userId(req),
            { verification_status: verificationStatus }
          );
          await audit(
            req,
            connection,
            "EQUIPMENT_CREDIT_KYC_REVIEWED",
            application,
            `Reviewed the available KYC information for ${application.application_number}.`
          );
          return {
            application,
            message:
              "Available KYC information reviewed. Missing optional fields do not block approval.",
          };
        }

        const fromStatus = application.application_status;
        await connection.query(
          `UPDATE equipment_credit_applications
           SET kyc_status = 'rejected', application_status = 'changes_requested',
               decision_reason = ?, reviewed_by = ?, reviewed_at = NOW(), updated_by = ?
           WHERE id = ?`,
          [reason, userId(req), userId(req), application.id]
        );
        application.kyc_status = "rejected";
        application.application_status = "changes_requested";
        await recordDecision(
          connection,
          application,
          "changes_requested",
          fromStatus,
          "changes_requested",
          null,
          reason,
          userId(req),
          { verification_status: verificationStatus }
        );
        await audit(
          req,
          connection,
          "EQUIPMENT_CREDIT_KYC_ISSUE_RECORDED",
          application,
          `Recorded a manager-identified KYC issue for ${application.application_number}.`,
          { reason }
        );
        return {
          application,
          message: "KYC issue recorded and changes requested by the manager.",
        };
      });

      return res.json({
        status: "success",
        message: result.message,
        application: result.application,
      });
    } catch (error) {
      return sendError(res, error, "Could not record the optional KYC review.");
    }
  }
);

router.post(
  "/:id/review",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      assertReviewer(req);
      const applicationId = positiveId(req.params.id);
      const action = normalizeAction(req.body?.action);
      const reason = nullableText(req.body?.reason, 1500);
      if (!applicationId || !action) {
        throw new OptionalDecisionError(400, "Choose a valid installment review action.");
      }
      if (["request_changes", "decline"].includes(action) && !reason) {
        throw new OptionalDecisionError(400, "Enter the reason for this review decision.");
      }

      const reviewed = await withTransaction(async (connection) => {
        const application = await loadApplication(connection, applicationId, req, true);
        if (!application) {
          throw new OptionalDecisionError(404, "Installment application was not found.");
        }
        if (FINAL_STATUSES.has(application.application_status)) {
          throw new OptionalDecisionError(409, "This application already has a final decision.");
        }
        if (!["submitted", "under_review"].includes(application.application_status)) {
          throw new OptionalDecisionError(
            409,
            "Submit the installment application before recording a manager decision."
          );
        }

        const kyc = await loadKyc(connection, application.id, true);
        const assessment = advisoryAssessment(application, kyc || {});
        await persistAssessment(connection, application, assessment, userId(req));

        let nextStatus = application.application_status;
        let actionType = "review_started";
        if (action === "start_review") nextStatus = "under_review";
        if (action === "request_changes") {
          nextStatus = "changes_requested";
          actionType = "changes_requested";
        }
        if (action === "decline") {
          nextStatus = "declined";
          actionType = "declined";
        }
        if (action === "approve") {
          nextStatus = "approved";
          actionType = "approved";
        }

        const fromStatus = application.application_status;
        await connection.query(
          `UPDATE equipment_credit_applications
           SET application_status = ?, reviewed_by = ?, reviewed_at = NOW(),
               decision_reason = ?, updated_by = ?
           WHERE id = ?`,
          [nextStatus, userId(req), reason, userId(req), application.id]
        );
        application.application_status = nextStatus;

        await recordDecision(
          connection,
          application,
          actionType,
          fromStatus,
          nextStatus,
          assessment,
          reason ||
            (action === "approve"
              ? "Approved by an authorised manager. Optional customer information was not forced."
              : "Manager review started."),
          userId(req),
          { review_action: action }
        );
        await audit(
          req,
          connection,
          `EQUIPMENT_CREDIT_APPLICATION_${actionType.toUpperCase()}`,
          application,
          `Installment application ${application.application_number} changed from ${fromStatus} to ${nextStatus}.`,
          {
            reason,
            affordability_status: assessment.affordability_status,
            kyc_status: assessment.kyc_status,
          }
        );
        return application;
      });

      return res.json({
        status: "success",
        message:
          reviewed.application_status === "approved"
            ? "Installment application approved. Optional customer, KYC, guarantor and affordability fields were not required."
            : `Installment application review recorded as ${reviewed.application_status.replaceAll("_", " ")}.`,
        application: reviewed,
      });
    } catch (error) {
      return sendError(res, error, "Could not review the installment application.");
    }
  }
);

module.exports = router;
module.exports.REVIEWER_ROLES = REVIEWER_ROLES;
module.exports.advisoryAssessment = advisoryAssessment;
module.exports.hasAffordabilityInformation = hasAffordabilityInformation;
