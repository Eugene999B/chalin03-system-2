const { pool } = require("../config/db");
const {
  evaluateCreditApplication,
} = require("../services/equipmentCreditApplicationPolicy");
const {
  dateValue,
} = require("../services/equipmentFinanceScheduleService");

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function ghanaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function reject(res, code, message, details = null) {
  return res.status(409).json({
    status: "error",
    code,
    message,
    ...(details ? { details } : {}),
  });
}

async function loadActivationEvidence(applicationId) {
  const [[applications], [kycRows]] = await Promise.all([
    pool.query(
      `SELECT application.*,
              quotation.total_amount AS quotation_total_amount,
              quotation.proposed_first_due_date AS quotation_first_due_date
         FROM equipment_credit_applications application
         INNER JOIN equipment_sales_quotations quotation
           ON quotation.id = application.quotation_id
        WHERE application.id = ?
        LIMIT 1`,
      [applicationId]
    ),
    pool.query(
      `SELECT *
         FROM equipment_credit_application_kyc
        WHERE application_id = ?
        LIMIT 1`,
      [applicationId]
    ),
  ]);
  return {
    application: applications[0] || null,
    kyc: kycRows[0] || {},
  };
}

function assessmentInput(application) {
  return {
    ...application,
    quoted_total:
      application.quoted_total ??
      application.quotation_total_amount ??
      application.total_amount,
  };
}

async function equipmentFinanceActivationIntegrityGuard(req, res, next) {
  if (req.method !== "POST") return next();
  const match = /^\/(\d+)\/?$/.exec(req.path);
  if (!match) return next();

  const applicationId = positiveId(match[1]);
  if (!applicationId) return next();

  try {
    const { application, kyc } = await loadActivationEvidence(applicationId);
    if (!application) return next();

    // Replays of a previously activated agreement must remain idempotent. The
    // existing activation route validates the historical agreement link.
    if (application.agreement_id) return next();

    if (application.application_status !== "approved") return next();

    const assessment = evaluateCreditApplication(
      assessmentInput(application),
      kyc
    );

    if (assessment.kyc_status === "incomplete") {
      return reject(
        res,
        "EQUIPMENT_FINANCE_ACTIVATION_KYC_RECHECK_FAILED",
        "The approved application can no longer be activated because required KYC, consent or guarantor information is incomplete. Correct the application and review it again.",
        {
          recorded_kyc_status: application.kyc_status || null,
          current_kyc_status: assessment.kyc_status,
          risk_band: assessment.risk_band,
          reasons: assessment.reasons,
        }
      );
    }

    if (assessment.affordability_status === "ineligible") {
      return reject(
        res,
        "EQUIPMENT_FINANCE_ACTIVATION_AFFORDABILITY_RECHECK_FAILED",
        "The approved application can no longer be activated because the current affordability evidence fails Finance policy. Reassess the application before creating an agreement.",
        {
          recorded_affordability_status: application.affordability_status || null,
          current_affordability_status: assessment.affordability_status,
          risk_band: assessment.risk_band,
          reasons: assessment.reasons,
          warnings: assessment.warnings,
        }
      );
    }

    const firstDueDate = dateValue(
      application.proposed_first_due_date || application.quotation_first_due_date
    );
    const today = ghanaToday();
    if (!firstDueDate) {
      return reject(
        res,
        "EQUIPMENT_FINANCE_ACTIVATION_FIRST_DUE_DATE_INVALID",
        "The approved first installment due date is invalid. Correct the application before agreement activation."
      );
    }
    if (firstDueDate < today) {
      return reject(
        res,
        "EQUIPMENT_FINANCE_ACTIVATION_FIRST_DUE_DATE_PASSED",
        `The approved first installment due date ${firstDueDate} has already passed. Review and approve a current payment plan before activation.`,
        { first_due_date: firstDueDate, minimum_first_due_date: today }
      );
    }

    req.financeActivationIntegrity = {
      rechecked: true,
      kyc_status: assessment.kyc_status,
      affordability_status: assessment.affordability_status,
      risk_band: assessment.risk_band,
      first_due_date: firstDueDate,
      minimum_first_due_date: today,
    };
    return next();
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
      return next();
    }
    return next(error);
  }
}

module.exports = {
  assessmentInput,
  equipmentFinanceActivationIntegrityGuard,
  ghanaToday,
  loadActivationEvidence,
};
