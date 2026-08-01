const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { workspaceRoleFor } = require("../security/equipmentDivisionAccess");
const {
  determineKycStatus,
  evaluateCreditApplication,
} = require("../services/equipmentCreditApplicationPolicy");
const {
  buildFinanceSchedule,
  FinanceScheduleError,
  monthlyEquivalent,
} = require("../services/equipmentFinanceScheduleService");

const router = express.Router();

const REQUIRED_TABLES = Object.freeze([
  "equipment_credit_applications",
  "equipment_credit_application_kyc",
  "equipment_credit_application_decisions",
  "equipment_sales_quotations",
  "equipment_sales_quotation_items",
]);
const APPLICATION_STATUSES = new Set([
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
  "declined",
  "withdrawn",
]);
const REVIEW_ACTIONS = new Set([
  "start_review",
  "request_changes",
  "approve",
  "decline",
]);
const REVIEWER_ROLES = new Set([
  "finance_manager",
  "finance_accountant",
  "admin",
  "administrator",
  "manager",
  "system_administrator",
  "super_admin",
]);
const EMPLOYMENT_TYPES = new Set([
  "salaried",
  "self_employed",
  "contractor",
  "pensioner",
  "farmer",
  "other",
]);

class ApplicationError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_FINANCE_APPLICATION_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 1000) {
  return cleanText(value, maxLength) || null;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function money(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(number) && number >= 0
    ? Number(number.toFixed(2))
    : undefined;
}

function decimal(value, fallback = null, maximum = 200) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= maximum
    ? Number(number.toFixed(2))
    : undefined;
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if ([true, 1, "1", "true", "yes", "on"].includes(value)) return true;
  if ([false, 0, "0", "false", "no", "off"].includes(value)) return false;
  return undefined;
}

function dateOnly(value, fallback = null) {
  const text = cleanText(value, 20);
  if (!text) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : text;
}

function enumValue(value, allowed, fallback = null) {
  const text = cleanText(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
  if (!text) return fallback;
  return allowed.has(text) ? text : undefined;
}

function actorId(req) {
  return positiveId(req.user?.id);
}

function assertReviewer(req) {
  if (isOriginalSystemAdministrator(req.user)) return;
  const role = workspaceRoleFor(req.user) || cleanText(req.user?.role, 80).toLowerCase();
  if (!REVIEWER_ROLES.has(role)) {
    throw new ApplicationError(
      403,
      "Only an authorised Finance reviewer can make credit decisions.",
      "EQUIPMENT_FINANCE_REVIEW_PERMISSION_REQUIRED"
    );
  }
}

function assertIndependentReviewer(req, application) {
  if (isOriginalSystemAdministrator(req.user)) return;
  const reviewerId = actorId(req);
  if (
    reviewerId &&
    [application.created_by, application.submitted_by]
      .map(Number)
      .filter(Number.isInteger)
      .includes(reviewerId)
  ) {
    throw new ApplicationError(
      409,
      "The person who created or submitted this application cannot independently review it. Assign another authorised Finance reviewer.",
      "EQUIPMENT_FINANCE_INDEPENDENT_REVIEW_REQUIRED"
    );
  }
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
      // Preserve the original error.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function schemaStatus(connection = pool) {
  const placeholders = REQUIRED_TABLES.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
       AND TABLE_NAME IN (${placeholders})`,
    REQUIRED_TABLES
  );
  const found = new Set(rows.map((row) => row.TABLE_NAME));
  const missing = REQUIRED_TABLES.filter((tableName) => !found.has(tableName));
  return { ready: missing.length === 0, missing_tables: missing };
}

async function assertSchemaReady(connection = pool) {
  const status = await schemaStatus(connection);
  if (!status.ready) {
    const error = new ApplicationError(
      503,
      "Equipment Finance applications are being prepared. Try again after deployment completes.",
      "EQUIPMENT_FINANCE_STABILIZATION_REQUIRED"
    );
    error.readiness = status;
    throw error;
  }
  return status;
}

function sendError(res, error, fallback) {
  if (error instanceof ApplicationError || error instanceof FinanceScheduleError) {
    return res.status(Number(error.statusCode || 400)).json({
      status: "error",
      code: error.code,
      message: error.message,
      ...(error.readiness ? { readiness: error.readiness } : {}),
    });
  }
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return res.status(503).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_STABILIZATION_REQUIRED",
      message: "Equipment Finance applications are being prepared. Try again after deployment completes.",
    });
  }
  console.error(fallback, error);
  return res.status(500).json({ status: "error", message: fallback });
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
    hireLocationId: null,
    severity: /APPROV|DECLIN|SUBMIT|KYC|CHANGE/.test(action) ? "notice" : "info",
    outcome: "success",
    details,
    metadata: {
      finance_scope: "company_wide",
      hire_location_id: null,
      ...metadata,
    },
  });
}

async function loadApplication(connection, applicationId, lock = false) {
  const [rows] = await connection.query(
    `SELECT * FROM equipment_credit_applications
     WHERE id = ?
     LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [applicationId]
  );
  return rows[0] || null;
}

async function loadKyc(connection, applicationId, lock = false) {
  const [rows] = await connection.query(
    `SELECT * FROM equipment_credit_application_kyc
     WHERE application_id = ?
     LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [applicationId]
  );
  return rows[0] || null;
}

async function loadDetail(connection, applicationId) {
  const [applicationRows] = await connection.query(
    `SELECT
       application.*,
       customer.customer_name,
       customer.phone AS customer_phone,
       customer.email AS customer_email,
       customer.address AS customer_address,
       quotation.quotation_number,
       quotation.status AS quotation_status,
       quotation.proposed_first_due_date,
       quotation.proposed_interval_days AS quotation_interval_days,
       quotation.proposed_non_working_day_rule AS quotation_non_working_day_rule,
       asset.asset_code,
       asset.asset_name,
       asset.make,
       asset.model,
       asset.model_year,
       asset.serial_number,
       asset.chassis_number,
       asset.main_image_url,
       creator.full_name AS created_by_name,
       submitter.full_name AS submitted_by_name,
       reviewer.full_name AS reviewed_by_name
     FROM equipment_credit_applications application
     INNER JOIN hire_customers customer ON customer.id = application.customer_id
     INNER JOIN equipment_sales_quotations quotation ON quotation.id = application.quotation_id
     INNER JOIN fleet_assets asset ON asset.id = application.asset_id
     LEFT JOIN users creator ON creator.id = application.created_by
     LEFT JOIN users submitter ON submitter.id = application.submitted_by
     LEFT JOIN users reviewer ON reviewer.id = application.reviewed_by
     WHERE application.id = ?
     LIMIT 1`,
    [applicationId]
  );
  const application = applicationRows[0];
  if (!application) return null;

  const [kycRows, decisionRows, documentRows, taskRows, eventRows] = await Promise.all([
    connection.query(
      `SELECT * FROM equipment_credit_application_kyc WHERE application_id = ? LIMIT 1`,
      [applicationId]
    ),
    connection.query(
      `SELECT decision.*, user.full_name AS decided_by_name
       FROM equipment_credit_application_decisions decision
       LEFT JOIN users user ON user.id = decision.decided_by
       WHERE decision.application_id = ?
       ORDER BY decision.decision_version DESC, decision.id DESC`,
      [applicationId]
    ),
    connection.query(
      `SELECT id, document_category, document_label, original_file_name,
              stored_mime_type, byte_size, checksum_sha256, document_status,
              notes, uploaded_by, verified_by, verified_at, rejected_reason, created_at
       FROM equipment_finance_case_documents
       WHERE application_id = ? AND document_status <> 'superseded'
       ORDER BY created_at DESC, id DESC`,
      [applicationId]
    ),
    connection.query(
      `SELECT id, task_type, task_status, priority, title, description,
              assigned_role, assigned_to, due_at, approval_required,
              approval_status, created_at
       FROM equipment_finance_case_tasks
       WHERE application_id = ? AND task_status IN ('open','in_progress')
       ORDER BY FIELD(priority, 'critical','high','normal','low'), due_at, id`,
      [applicationId]
    ),
    connection.query(
      `SELECT id, event_type, event_title, event_description, event_time,
              actor_name, source_type, source_id
       FROM equipment_finance_case_events
       WHERE application_id = ?
       ORDER BY event_time DESC, id DESC
       LIMIT 100`,
      [applicationId]
    ),
  ]);

  let exactSchedule = null;
  try {
    exactSchedule = buildFinanceSchedule({
      selling_price: application.financed_amount,
      deposit: 0,
      installment_count: application.proposed_installment_count,
      first_due_date: application.proposed_first_due_date,
      payment_frequency: application.proposed_frequency,
      custom_interval_days:
        application.proposed_interval_days ?? application.quotation_interval_days,
      non_working_day_rule:
        application.proposed_non_working_day_rule ||
        application.quotation_non_working_day_rule ||
        "exact",
    });
  } catch (_error) {
    exactSchedule = null;
  }

  return {
    application: { ...application, hire_location_id: null },
    kyc: kycRows[0][0] || null,
    decisions: decisionRows[0],
    documents: documentRows[0],
    tasks: taskRows[0],
    timeline: eventRows[0],
    exact_schedule: exactSchedule,
    completeness: buildCompleteness(application, kycRows[0][0] || {}, documentRows[0]),
  };
}

function buildCompleteness(application, kyc, documents = []) {
  const categories = new Set(
    documents
      .filter((item) => item.document_status === "verified")
      .map((item) => item.document_category)
  );
  const financedAmount = Number(application.financed_amount || 0);
  const checks = [
    { code: "customer", label: "Customer name and phone", complete: Boolean(kyc.customer_name_snapshot && kyc.customer_phone_snapshot) },
    { code: "identity", label: "Customer ID details", complete: Boolean(kyc.id_type && kyc.id_number) },
    { code: "address", label: "Residential address", complete: Boolean(kyc.residential_address || kyc.customer_address_snapshot) },
    { code: "employment", label: "Employment or business details", complete: Boolean(kyc.employment_type && kyc.occupation) },
    { code: "income", label: "Positive affordability income", complete: Number(application.total_monthly_income || 0) > 0 },
    { code: "consent", label: "Customer and assessment consent", complete: Boolean(kyc.customer_consent_confirmed && kyc.credit_assessment_consent_confirmed) },
    { code: "buyer_id_document", label: "Verified buyer ID document", complete: categories.has("buyer_id") || Boolean(kyc.identity_document_url) },
    { code: "income_document", label: "Verified income evidence", complete: categories.has("income_evidence") || Boolean(kyc.income_evidence_url || kyc.bank_statement_url) },
    {
      code: "guarantor",
      label: financedAmount >= 100000 ? "Guarantor information" : "Guarantor not required",
      complete:
        financedAmount < 100000 ||
        Boolean(kyc.guarantor_name && kyc.guarantor_phone && kyc.guarantor_id_number),
    },
  ];
  return {
    checks,
    complete_count: checks.filter((item) => item.complete).length,
    total_count: checks.length,
    ready_for_submission: checks.every((item) => item.complete),
  };
}

function kycInput(body = {}, current = {}) {
  const input = body.kyc || body;
  const employmentType = enumValue(
    input.employment_type,
    EMPLOYMENT_TYPES,
    current.employment_type || null
  );
  const values = {
    customer_name_snapshot: cleanText(
      input.customer_name_snapshot ?? current.customer_name_snapshot,
      180
    ),
    customer_phone_snapshot: nullableText(
      input.customer_phone_snapshot ?? current.customer_phone_snapshot,
      40
    ),
    customer_email_snapshot: nullableText(
      input.customer_email_snapshot ?? current.customer_email_snapshot,
      180
    ),
    customer_address_snapshot: nullableText(
      input.customer_address_snapshot ?? current.customer_address_snapshot,
      3000
    ),
    id_type: nullableText(input.id_type ?? current.id_type, 80),
    id_number: nullableText(input.id_number ?? current.id_number, 150),
    date_of_birth: dateOnly(input.date_of_birth, current.date_of_birth || null),
    nationality: cleanText(input.nationality || current.nationality || "Ghana", 100),
    employment_type: employmentType,
    occupation: nullableText(input.occupation ?? current.occupation, 150),
    employer_business_name: nullableText(
      input.employer_business_name ?? current.employer_business_name,
      200
    ),
    business_registration_number: nullableText(
      input.business_registration_number ?? current.business_registration_number,
      150
    ),
    residential_address: nullableText(
      input.residential_address ?? current.residential_address,
      3000
    ),
    work_address: nullableText(input.work_address ?? current.work_address, 3000),
    years_at_residence: decimal(
      input.years_at_residence,
      current.years_at_residence ?? null,
      100
    ),
    years_in_employment_business: decimal(
      input.years_in_employment_business,
      current.years_in_employment_business ?? null,
      100
    ),
    emergency_contact_name: nullableText(
      input.emergency_contact_name ?? current.emergency_contact_name,
      180
    ),
    emergency_contact_phone: nullableText(
      input.emergency_contact_phone ?? current.emergency_contact_phone,
      40
    ),
    emergency_contact_relationship: nullableText(
      input.emergency_contact_relationship ?? current.emergency_contact_relationship,
      100
    ),
    guarantor_name: nullableText(input.guarantor_name ?? current.guarantor_name, 180),
    guarantor_phone: nullableText(input.guarantor_phone ?? current.guarantor_phone, 40),
    guarantor_address: nullableText(input.guarantor_address ?? current.guarantor_address, 3000),
    guarantor_id_type: nullableText(input.guarantor_id_type ?? current.guarantor_id_type, 80),
    guarantor_id_number: nullableText(input.guarantor_id_number ?? current.guarantor_id_number, 150),
    guarantor_relationship: nullableText(
      input.guarantor_relationship ?? current.guarantor_relationship,
      100
    ),
    identity_document_url: nullableText(input.identity_document_url ?? current.identity_document_url, 10000),
    address_evidence_url: nullableText(input.address_evidence_url ?? current.address_evidence_url, 10000),
    income_evidence_url: nullableText(input.income_evidence_url ?? current.income_evidence_url, 10000),
    bank_statement_url: nullableText(input.bank_statement_url ?? current.bank_statement_url, 10000),
    business_registration_url: nullableText(
      input.business_registration_url ?? current.business_registration_url,
      10000
    ),
    guarantor_document_url: nullableText(
      input.guarantor_document_url ?? current.guarantor_document_url,
      10000
    ),
    identity_verified: boolValue(input.identity_verified, Boolean(current.identity_verified)),
    address_verified: boolValue(input.address_verified, Boolean(current.address_verified)),
    income_verified: boolValue(input.income_verified, Boolean(current.income_verified)),
    guarantor_verified: boolValue(input.guarantor_verified, Boolean(current.guarantor_verified)),
    customer_consent_confirmed: boolValue(
      input.customer_consent_confirmed,
      Boolean(current.customer_consent_confirmed)
    ),
    credit_assessment_consent_confirmed: boolValue(
      input.credit_assessment_consent_confirmed,
      Boolean(current.credit_assessment_consent_confirmed)
    ),
    verification_notes: nullableText(input.verification_notes ?? current.verification_notes, 4000),
  };
  if (
    values.date_of_birth === undefined ||
    values.employment_type === undefined ||
    values.years_at_residence === undefined ||
    values.years_in_employment_business === undefined ||
    [
      values.identity_verified,
      values.address_verified,
      values.income_verified,
      values.guarantor_verified,
      values.customer_consent_confirmed,
      values.credit_assessment_consent_confirmed,
    ].includes(undefined)
  ) {
    throw new ApplicationError(400, "Check the KYC values entered.");
  }
  return values;
}

function affordabilityInput(body = {}, current = {}) {
  const input = body.affordability || body;
  const values = {
    monthly_salary_income: money(input.monthly_salary_income, Number(current.monthly_salary_income || 0)),
    monthly_business_income: money(input.monthly_business_income, Number(current.monthly_business_income || 0)),
    monthly_other_income: money(input.monthly_other_income, Number(current.monthly_other_income || 0)),
    monthly_business_costs: money(input.monthly_business_costs, Number(current.monthly_business_costs || 0)),
    monthly_household_expenses: money(input.monthly_household_expenses, Number(current.monthly_household_expenses || 0)),
    existing_monthly_debt: money(input.existing_monthly_debt, Number(current.existing_monthly_debt || 0)),
    assessment_notes: nullableText(input.assessment_notes ?? current.assessment_notes, 4000),
  };
  if (Object.values(values).some((value) => value === undefined)) {
    throw new ApplicationError(400, "Check the affordability amounts entered.");
  }
  return values;
}

async function upsertKyc(connection, applicationId, kyc, userId) {
  await connection.query(
    `INSERT INTO equipment_credit_application_kyc SET ?
     ON DUPLICATE KEY UPDATE
       customer_name_snapshot = VALUES(customer_name_snapshot),
       customer_phone_snapshot = VALUES(customer_phone_snapshot),
       customer_email_snapshot = VALUES(customer_email_snapshot),
       customer_address_snapshot = VALUES(customer_address_snapshot),
       id_type = VALUES(id_type), id_number = VALUES(id_number),
       date_of_birth = VALUES(date_of_birth), nationality = VALUES(nationality),
       employment_type = VALUES(employment_type), occupation = VALUES(occupation),
       employer_business_name = VALUES(employer_business_name),
       business_registration_number = VALUES(business_registration_number),
       residential_address = VALUES(residential_address), work_address = VALUES(work_address),
       years_at_residence = VALUES(years_at_residence),
       years_in_employment_business = VALUES(years_in_employment_business),
       emergency_contact_name = VALUES(emergency_contact_name),
       emergency_contact_phone = VALUES(emergency_contact_phone),
       emergency_contact_relationship = VALUES(emergency_contact_relationship),
       guarantor_name = VALUES(guarantor_name), guarantor_phone = VALUES(guarantor_phone),
       guarantor_address = VALUES(guarantor_address),
       guarantor_id_type = VALUES(guarantor_id_type),
       guarantor_id_number = VALUES(guarantor_id_number),
       guarantor_relationship = VALUES(guarantor_relationship),
       identity_document_url = VALUES(identity_document_url),
       address_evidence_url = VALUES(address_evidence_url),
       income_evidence_url = VALUES(income_evidence_url),
       bank_statement_url = VALUES(bank_statement_url),
       business_registration_url = VALUES(business_registration_url),
       guarantor_document_url = VALUES(guarantor_document_url),
       identity_verified = VALUES(identity_verified),
       address_verified = VALUES(address_verified), income_verified = VALUES(income_verified),
       guarantor_verified = VALUES(guarantor_verified),
       customer_consent_confirmed = VALUES(customer_consent_confirmed),
       credit_assessment_consent_confirmed = VALUES(credit_assessment_consent_confirmed),
       verification_notes = VALUES(verification_notes), updated_by = VALUES(updated_by),
       updated_at = NOW()`,
    {
      application_id: applicationId,
      ...kyc,
      created_by: userId,
      updated_by: userId,
    }
  );
}

function assessmentFor(application, kyc, affordability = application) {
  return evaluateCreditApplication(
    {
      quoted_total: application.quoted_total,
      proposed_deposit: application.proposed_deposit,
      proposed_frequency: application.proposed_frequency,
      proposed_interval_days: application.proposed_interval_days,
      proposed_installment_count: application.proposed_installment_count,
      ...affordability,
    },
    kyc
  );
}

async function applyAssessment(connection, application, assessment, notes, userId) {
  const periodicAmount = Number(assessment.periodic_installment_amount || 0);
  const monthlyAmount = monthlyEquivalent(
    periodicAmount,
    assessment.proposed_frequency,
    assessment.proposed_interval_days
  );
  await connection.query(
    `UPDATE equipment_credit_applications
     SET hire_location_id = NULL,
         proposed_deposit = ?, financed_amount = ?, proposed_frequency = ?,
         proposed_interval_days = ?, proposed_installment_count = ?,
         proposed_installment_amount = ?, proposed_periodic_amount = ?,
         monthly_salary_income = ?, monthly_business_income = ?, monthly_other_income = ?,
         monthly_business_costs = ?, monthly_household_expenses = ?, existing_monthly_debt = ?,
         total_monthly_income = ?, total_monthly_commitments = ?, net_monthly_surplus = ?,
         debt_service_ratio_percent = ?, total_commitment_ratio_percent = ?,
         deposit_ratio_percent = ?, kyc_status = ?, affordability_status = ?,
         risk_band = ?, risk_score = ?, assessment_recommendation = ?,
         assessment_notes = ?, updated_by = ?
     WHERE id = ?`,
    [
      assessment.proposed_deposit,
      assessment.financed_amount,
      assessment.proposed_frequency,
      assessment.proposed_interval_days,
      assessment.proposed_installment_count,
      monthlyAmount,
      periodicAmount,
      assessment.monthly_salary_income,
      assessment.monthly_business_income,
      assessment.monthly_other_income,
      assessment.monthly_business_costs,
      assessment.monthly_household_expenses,
      assessment.existing_monthly_debt,
      assessment.total_monthly_income,
      assessment.total_monthly_commitments,
      assessment.net_monthly_surplus,
      assessment.debt_service_ratio_percent,
      assessment.total_commitment_ratio_percent,
      assessment.deposit_ratio_percent,
      assessment.kyc_status,
      assessment.affordability_status,
      assessment.risk_band,
      assessment.risk_score,
      assessment.assessment_recommendation,
      notes,
      userId,
      application.id,
    ]
  );
  Object.assign(application, assessment, {
    proposed_periodic_amount: periodicAmount,
    proposed_installment_amount: monthlyAmount,
    assessment_notes: notes,
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
  userId,
  snapshot = {}
) {
  const nextVersion = Number(application.decision_version || 0) + 1;
  await connection.query(
    `UPDATE equipment_credit_applications
     SET decision_version = ?, updated_by = ? WHERE id = ?`,
    [nextVersion, userId, application.id]
  );
  await connection.query(
    `INSERT INTO equipment_credit_application_decisions SET ?`,
    {
      application_id: application.id,
      decision_version: nextVersion,
      action_type: actionType,
      from_status: fromStatus || null,
      to_status: toStatus || null,
      affordability_status: assessment?.affordability_status || application.affordability_status,
      risk_band: assessment?.risk_band || application.risk_band,
      risk_score: assessment?.risk_score ?? application.risk_score,
      debt_service_ratio_percent:
        assessment?.debt_service_ratio_percent ?? application.debt_service_ratio_percent,
      net_monthly_surplus: assessment?.net_monthly_surplus ?? application.net_monthly_surplus,
      notes: nullableText(notes, 2000),
      snapshot_json: JSON.stringify({
        application_number: application.application_number,
        finance_scope: "company_wide",
        ...snapshot,
        assessment: assessment || null,
      }),
      decided_by: userId,
    }
  );
  application.decision_version = nextVersion;
}

router.get("/readiness", requirePermission("fleet.assets.view"), async (_req, res) => {
  try {
    const readiness = await schemaStatus(pool);
    return res.status(readiness.ready ? 200 : 503).json({
      status: readiness.ready ? "success" : "error",
      readiness,
      policy: { scope: "company_wide", hire_location_selection_required: false },
    });
  } catch (error) {
    return sendError(res, error, "Could not check Finance application readiness.");
  }
});

router.get("/", requirePermission("fleet.assets.view"), async (req, res) => {
  try {
    await assertSchemaReady(pool);
    const where = ["1 = 1"];
    const params = [];
    const status = enumValue(req.query.status, APPLICATION_STATUSES, null);
    if (req.query.status && status === undefined) {
      throw new ApplicationError(400, "Invalid credit application status.");
    }
    if (status) {
      where.push("application.application_status = ?");
      params.push(status);
    }
    const search = cleanText(req.query.search, 150);
    if (search) {
      where.push(
        `(application.application_number LIKE ? OR customer.customer_name LIKE ?
          OR customer.phone LIKE ? OR quotation.quotation_number LIKE ?
          OR asset.asset_code LIKE ? OR asset.asset_name LIKE ?)`
      );
      const like = `%${search}%`;
      params.push(like, like, like, like, like, like);
    }
    const [rows] = await pool.query(
      `SELECT
         application.*,
         customer.customer_name,
         customer.phone AS customer_phone,
         quotation.quotation_number,
         quotation.proposed_first_due_date,
         asset.asset_code,
         asset.asset_name,
         asset.make,
         asset.model,
         asset.main_image_url
       FROM equipment_credit_applications application
       INNER JOIN hire_customers customer ON customer.id = application.customer_id
       INNER JOIN equipment_sales_quotations quotation ON quotation.id = application.quotation_id
       INNER JOIN fleet_assets asset ON asset.id = application.asset_id
       WHERE ${where.join(" AND ")}
       ORDER BY application.created_at DESC
       LIMIT 500`,
      params
    );
    return res.json({
      status: "success",
      count: rows.length,
      applications: rows.map((row) => ({ ...row, hire_location_id: null })),
      policy: { scope: "company_wide", hire_location_selection_required: false },
    });
  } catch (error) {
    return sendError(res, error, "Could not load Finance credit applications.");
  }
});

router.get("/:id", requirePermission("fleet.assets.view"), async (req, res) => {
  try {
    await assertSchemaReady(pool);
    const applicationId = positiveId(req.params.id);
    if (!applicationId) throw new ApplicationError(400, "Invalid credit application ID.");
    const detail = await loadDetail(pool, applicationId);
    if (!detail) throw new ApplicationError(404, "Credit application was not found.");
    return res.json({ status: "success", ...detail });
  } catch (error) {
    return sendError(res, error, "Could not load the Finance credit application.");
  }
});

router.post("/", requirePermission("fleet.assets.manage"), (_req, res) => {
  return res.status(409).json({
    status: "error",
    code: "USE_GUIDED_FINANCE_START",
    message: "Use Start New Installment. It creates the Installment Offer and draft application together without a Hire location.",
  });
});

router.put("/:id", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    await assertSchemaReady(pool);
    const applicationId = positiveId(req.params.id);
    if (!applicationId) throw new ApplicationError(400, "Invalid credit application ID.");
    const updated = await withTransaction(async (connection) => {
      const application = await loadApplication(connection, applicationId, true);
      if (!application) throw new ApplicationError(404, "Credit application was not found.");
      if (!["draft", "changes_requested"].includes(application.application_status)) {
        throw new ApplicationError(409, "Only a draft or changes-requested application can be edited.");
      }
      const currentKyc = (await loadKyc(connection, applicationId, true)) || {};
      const kyc = kycInput(req.body, currentKyc);
      const affordability = affordabilityInput(req.body, application);

      let schedule = null;
      if (req.body.offer || req.body.payment_plan) {
        const plan = req.body.offer || req.body.payment_plan;
        schedule = buildFinanceSchedule({
          selling_price: money(plan.selling_price, application.quoted_total),
          deposit: money(plan.deposit, application.proposed_deposit),
          payment_frequency: plan.payment_frequency || application.proposed_frequency,
          custom_interval_days:
            plan.custom_interval_days ?? application.proposed_interval_days,
          installment_count:
            Number(plan.installment_count || application.proposed_installment_count),
          first_due_date:
            plan.first_due_date || req.body.first_due_date,
          non_working_day_rule:
            plan.non_working_day_rule || application.proposed_non_working_day_rule || "exact",
        });
        await connection.query(
          `UPDATE equipment_credit_applications
           SET quoted_total = ?, proposed_deposit = ?, financed_amount = ?,
               proposed_frequency = ?, proposed_interval_days = ?,
               proposed_non_working_day_rule = ?, proposed_installment_count = ?,
               proposed_periodic_amount = ?, updated_by = ?
           WHERE id = ?`,
          [
            schedule.selling_price,
            schedule.deposit,
            schedule.financed_amount,
            schedule.payment_frequency,
            schedule.custom_interval_days,
            schedule.non_working_day_rule,
            schedule.installment_count,
            schedule.periodic_amount,
            actorId(req),
            application.id,
          ]
        );
        await connection.query(
          `UPDATE equipment_sales_quotations
           SET total_amount = ?, subtotal = ?, deposit_required = ?,
               proposed_frequency = ?, proposed_interval_days = ?,
               proposed_non_working_day_rule = ?, proposed_installment_count = ?,
               proposed_first_due_date = ?, hire_location_id = NULL
           WHERE id = ?`,
          [
            schedule.selling_price,
            schedule.selling_price,
            schedule.deposit,
            schedule.payment_frequency,
            schedule.custom_interval_days,
            schedule.non_working_day_rule,
            schedule.installment_count,
            schedule.first_due_date,
            application.quotation_id,
          ]
        );
        Object.assign(application, {
          quoted_total: schedule.selling_price,
          proposed_deposit: schedule.deposit,
          financed_amount: schedule.financed_amount,
          proposed_frequency: schedule.payment_frequency,
          proposed_interval_days: schedule.custom_interval_days,
          proposed_non_working_day_rule: schedule.non_working_day_rule,
          proposed_installment_count: schedule.installment_count,
          proposed_first_due_date: schedule.first_due_date,
        });
      }

      await upsertKyc(connection, application.id, kyc, actorId(req));
      const assessment = assessmentFor(application, kyc, affordability);
      const affordabilityProvided =
        assessment.total_monthly_income > 0 ||
        Number(affordability.monthly_business_costs || 0) > 0 ||
        Number(affordability.monthly_household_expenses || 0) > 0 ||
        Number(affordability.existing_monthly_debt || 0) > 0;
      if (!affordabilityProvided) {
        assessment.affordability_status = "not_assessed";
        assessment.assessment_recommendation =
          "Complete customer affordability before submitting this application for approval.";
      }
      await applyAssessment(
        connection,
        application,
        assessment,
        affordability.assessment_notes,
        actorId(req)
      );
      await recordDecision(
        connection,
        application,
        "updated",
        application.application_status,
        application.application_status,
        assessment,
        nullableText(req.body.notes, 2000) || "Draft application details updated.",
        actorId(req),
        { exact_schedule: schedule?.schedule || null }
      );
      await audit(
        req,
        connection,
        "EQUIPMENT_FINANCE_APPLICATION_UPDATED",
        application,
        `Updated draft Finance application ${application.application_number}.`
      );
      return application;
    });
    return res.json({
      status: "success",
      message: "Draft Finance application updated. Original decision history was preserved.",
      application: updated,
    });
  } catch (error) {
    return sendError(res, error, "Could not update the Finance credit application.");
  }
});

router.post("/:id/assess", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    await assertSchemaReady(pool);
    const applicationId = positiveId(req.params.id);
    if (!applicationId) throw new ApplicationError(400, "Invalid credit application ID.");
    const assessed = await withTransaction(async (connection) => {
      const application = await loadApplication(connection, applicationId, true);
      if (!application) throw new ApplicationError(404, "Credit application was not found.");
      if (["approved", "declined", "withdrawn"].includes(application.application_status)) {
        throw new ApplicationError(409, "A final application cannot be reassessed without a controlled amendment.");
      }
      const kyc = (await loadKyc(connection, application.id, true)) || {};
      const assessment = assessmentFor(application, kyc);
      await applyAssessment(connection, application, assessment, application.assessment_notes, actorId(req));
      await recordDecision(
        connection,
        application,
        "assessed",
        application.application_status,
        application.application_status,
        assessment,
        "Affordability and risk recalculated.",
        actorId(req)
      );
      await audit(
        req,
        connection,
        "EQUIPMENT_FINANCE_APPLICATION_ASSESSED",
        application,
        `Reassessed Finance application ${application.application_number}.`,
        { affordability_status: assessment.affordability_status, risk_score: assessment.risk_score }
      );
      return application;
    });
    return res.json({
      status: "success",
      message: "Affordability and risk assessment recalculated.",
      application: assessed,
    });
  } catch (error) {
    return sendError(res, error, "Could not assess the Finance credit application.");
  }
});

router.post("/:id/submit", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    await assertSchemaReady(pool);
    const applicationId = positiveId(req.params.id);
    if (!applicationId) throw new ApplicationError(400, "Invalid credit application ID.");
    const submitted = await withTransaction(async (connection) => {
      const application = await loadApplication(connection, applicationId, true);
      if (!application) throw new ApplicationError(404, "Credit application was not found.");
      if (!["draft", "changes_requested"].includes(application.application_status)) {
        throw new ApplicationError(409, "Only a draft or changes-requested application can be submitted.");
      }
      const kyc = (await loadKyc(connection, application.id, true)) || {};
      const assessment = assessmentFor(application, kyc);
      if (!["complete", "verified"].includes(assessment.kyc_status)) {
        throw new ApplicationError(
          409,
          "Complete the required customer identity, address, employment, consent and guarantor information before submission.",
          "EQUIPMENT_FINANCE_KYC_INCOMPLETE"
        );
      }
      if (assessment.total_monthly_income <= 0) {
        throw new ApplicationError(
          409,
          "Complete the customer affordability income before submission.",
          "EQUIPMENT_FINANCE_AFFORDABILITY_NOT_ASSESSED"
        );
      }
      if (assessment.affordability_status === "ineligible") {
        throw new ApplicationError(
          409,
          "The current affordability assessment is ineligible. Correct the failed conditions before submission.",
          "EQUIPMENT_FINANCE_AFFORDABILITY_FAILED"
        );
      }
      await applyAssessment(connection, application, assessment, application.assessment_notes, actorId(req));
      const fromStatus = application.application_status;
      await connection.query(
        `UPDATE equipment_credit_applications
         SET application_status = 'submitted', submitted_by = ?, submitted_at = NOW(),
             reviewed_by = NULL, reviewed_at = NULL, decision_reason = NULL,
             updated_by = ?
         WHERE id = ?`,
        [actorId(req), actorId(req), application.id]
      );
      application.application_status = "submitted";
      application.submitted_by = actorId(req);
      await recordDecision(
        connection,
        application,
        "submitted",
        fromStatus,
        "submitted",
        assessment,
        nullableText(req.body.notes, 2000) || "Submitted for independent review.",
        actorId(req)
      );
      await audit(
        req,
        connection,
        "EQUIPMENT_FINANCE_APPLICATION_SUBMITTED",
        application,
        `Submitted Finance application ${application.application_number} for independent review.`
      );
      return application;
    });
    return res.json({
      status: "success",
      message: "Finance application submitted for independent review.",
      application: submitted,
    });
  } catch (error) {
    return sendError(res, error, "Could not submit the Finance credit application.");
  }
});

router.post("/:id/kyc/verify", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    assertReviewer(req);
    await assertSchemaReady(pool);
    const applicationId = positiveId(req.params.id);
    const verificationStatus = enumValue(
      req.body.verification_status,
      new Set(["verified", "rejected"]),
      undefined
    );
    const reason = nullableText(req.body.reason, 1500);
    if (!applicationId || verificationStatus === undefined) {
      throw new ApplicationError(400, "Choose verified or rejected for the KYC decision.");
    }
    if (verificationStatus === "rejected" && !reason) {
      throw new ApplicationError(400, "Enter the reason for rejecting the KYC evidence.");
    }
    const result = await withTransaction(async (connection) => {
      const application = await loadApplication(connection, applicationId, true);
      if (!application) throw new ApplicationError(404, "Credit application was not found.");
      assertIndependentReviewer(req, application);
      if (["approved", "declined", "withdrawn"].includes(application.application_status)) {
        throw new ApplicationError(409, "This application already has a final decision.");
      }
      const currentKyc = await loadKyc(connection, application.id, true);
      if (!currentKyc) throw new ApplicationError(409, "KYC information has not been recorded.");
      const kyc = kycInput(
        {
          ...currentKyc,
          identity_verified: verificationStatus === "verified",
          address_verified: verificationStatus === "verified",
          income_verified: verificationStatus === "verified",
          guarantor_verified:
            verificationStatus === "verified" && Boolean(currentKyc.guarantor_name),
          verification_notes: reason || currentKyc.verification_notes,
        },
        currentKyc
      );
      const assessment = assessmentFor(application, kyc);
      if (verificationStatus === "verified" && determineKycStatus(kyc, application.financed_amount) !== "verified") {
        throw new ApplicationError(
          409,
          "Required identity, consent or guarantor information is incomplete and cannot be verified."
        );
      }
      await upsertKyc(connection, application.id, kyc, actorId(req));
      await connection.query(
        `UPDATE equipment_credit_application_kyc
         SET verified_by = ?, verified_at = NOW(), verification_notes = ?
         WHERE application_id = ?`,
        [actorId(req), reason, application.id]
      );
      await applyAssessment(connection, application, assessment, application.assessment_notes, actorId(req));
      const fromStatus = application.application_status;
      if (verificationStatus === "rejected") {
        await connection.query(
          `UPDATE equipment_credit_applications
           SET kyc_status = 'rejected', application_status = 'changes_requested',
               decision_reason = ?, reviewed_by = ?, reviewed_at = NOW(), updated_by = ?
           WHERE id = ?`,
          [reason, actorId(req), actorId(req), application.id]
        );
        application.kyc_status = "rejected";
        application.application_status = "changes_requested";
      }
      await recordDecision(
        connection,
        application,
        verificationStatus === "verified" ? "kyc_verified" : "changes_requested",
        fromStatus,
        application.application_status,
        assessment,
        reason || "KYC evidence verified.",
        actorId(req),
        { verification_status: verificationStatus }
      );
      await audit(
        req,
        connection,
        verificationStatus === "verified"
          ? "EQUIPMENT_FINANCE_KYC_VERIFIED"
          : "EQUIPMENT_FINANCE_KYC_REJECTED",
        application,
        `${verificationStatus === "verified" ? "Verified" : "Rejected"} KYC evidence for ${application.application_number}.`
      );
      return application;
    });
    return res.json({
      status: "success",
      message:
        verificationStatus === "verified"
          ? "KYC evidence verified."
          : "KYC evidence rejected and changes requested.",
      application: result,
    });
  } catch (error) {
    return sendError(res, error, "Could not verify the Finance application KYC.");
  }
});

router.post("/:id/review", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    assertReviewer(req);
    await assertSchemaReady(pool);
    const applicationId = positiveId(req.params.id);
    const action = enumValue(req.body.action, REVIEW_ACTIONS, undefined);
    const reason = nullableText(req.body.reason, 1500);
    if (!applicationId || action === undefined) {
      throw new ApplicationError(400, "Choose a valid credit review action.");
    }
    if (["request_changes", "decline"].includes(action) && !reason) {
      throw new ApplicationError(400, "Enter the reason for the review decision.");
    }
    const reviewed = await withTransaction(async (connection) => {
      const application = await loadApplication(connection, applicationId, true);
      if (!application) throw new ApplicationError(404, "Credit application was not found.");
      assertIndependentReviewer(req, application);
      if (["approved", "declined", "withdrawn"].includes(application.application_status)) {
        throw new ApplicationError(409, "This application already has a final decision.");
      }
      if (!["submitted", "under_review"].includes(application.application_status)) {
        throw new ApplicationError(409, "Submit the application before a review decision.");
      }
      const kyc = (await loadKyc(connection, application.id, true)) || {};
      const assessment = assessmentFor(application, kyc);
      await applyAssessment(connection, application, assessment, application.assessment_notes, actorId(req));

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
        if (assessment.kyc_status !== "verified") {
          throw new ApplicationError(
            409,
            "Verify the required KYC evidence before approving the application.",
            "EQUIPMENT_FINANCE_KYC_VERIFICATION_REQUIRED"
          );
        }
        if (!["eligible", "manual_review"].includes(assessment.affordability_status)) {
          throw new ApplicationError(
            409,
            "Only an eligible or senior-manual-review affordability result can be approved.",
            "EQUIPMENT_FINANCE_APPROVAL_BLOCKED"
          );
        }
        if (assessment.affordability_status === "manual_review" && !reason) {
          throw new ApplicationError(
            400,
            "Record the manager's reason for approving a manual-review application."
          );
        }
        nextStatus = "approved";
        actionType = "approved";
      }

      const fromStatus = application.application_status;
      await connection.query(
        `UPDATE equipment_credit_applications
         SET application_status = ?, reviewed_by = ?, reviewed_at = NOW(),
             decision_reason = ?, updated_by = ?
         WHERE id = ?`,
        [nextStatus, actorId(req), reason, actorId(req), application.id]
      );
      application.application_status = nextStatus;
      await recordDecision(
        connection,
        application,
        actionType,
        fromStatus,
        nextStatus,
        assessment,
        reason || "Independent Finance review started.",
        actorId(req),
        { review_action: action }
      );
      await audit(
        req,
        connection,
        `EQUIPMENT_FINANCE_APPLICATION_${actionType.toUpperCase()}`,
        application,
        `Finance application ${application.application_number} changed from ${fromStatus} to ${nextStatus}.`,
        { reason, affordability_status: assessment.affordability_status, risk_band: assessment.risk_band }
      );
      return application;
    });
    return res.json({
      status: "success",
      message: `Finance application review recorded as ${reviewed.application_status.replaceAll("_", " ")}.`,
      application: reviewed,
    });
  } catch (error) {
    return sendError(res, error, "Could not review the Finance credit application.");
  }
});

module.exports = router;
module.exports.REQUIRED_TABLES = REQUIRED_TABLES;
module.exports.REVIEWER_ROLES = REVIEWER_ROLES;
module.exports.buildCompleteness = buildCompleteness;
module.exports.schemaStatus = schemaStatus;
