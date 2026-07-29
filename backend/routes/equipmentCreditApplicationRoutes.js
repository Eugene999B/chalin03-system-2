const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { nextDocumentNumber } = require("../services/groupConfigurationService");
const {
  evaluateCreditApplication,
} = require("../services/equipmentCreditApplicationPolicy");

const router = express.Router();

const REQUIRED_TABLES = Object.freeze([
  "equipment_credit_applications",
  "equipment_credit_application_kyc",
  "equipment_credit_application_decisions",
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
const PAYMENT_FREQUENCIES = new Set([
  "weekly",
  "fortnightly",
  "monthly",
  "custom",
]);
const EMPLOYMENT_TYPES = new Set([
  "salaried",
  "self_employed",
  "contractor",
  "pensioner",
  "farmer",
  "other",
]);
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

class CreditApplicationError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_CREDIT_APPLICATION_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 500) {
  const text = cleanText(value, maxLength);
  return text || null;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function money(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return undefined;
  return Number(number.toFixed(2));
}

function wholeNumber(value, fallback = 0, maximum = 1000) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= maximum
    ? number
    : undefined;
}

function decimalNumber(value, fallback = null, maximum = 200) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= maximum
    ? Number(number.toFixed(2))
    : undefined;
}

function dateOnly(value, fallback = null) {
  const text = cleanText(value, 20);
  if (!text) return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

function enumValue(value, allowed, fallback = null) {
  const text = cleanText(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
  if (!text) return fallback;
  return allowed.has(text) ? text : undefined;
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if ([true, 1, "1", "true", "yes", "on"].includes(value)) return true;
  if ([false, 0, "0", "false", "no", "off"].includes(value)) return false;
  return undefined;
}

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function userId(req) {
  return positiveId(req.user?.id);
}

function isReviewer(req) {
  return REVIEWER_ROLES.has(cleanText(req.user?.role, 80).toLowerCase());
}

function assertReviewer(req) {
  if (!isReviewer(req)) {
    throw new CreditApplicationError(
      403,
      "Only an authorised manager or administrator can review credit applications.",
      "EQUIPMENT_CREDIT_REVIEW_PERMISSION_REQUIRED"
    );
  }
}

function locationId(req) {
  const id = positiveId(req.hireLocationScope?.locationId);
  if (!id) {
    throw new CreditApplicationError(
      400,
      "Choose a specific equipment location before changing a credit application.",
      "EQUIPMENT_CREDIT_LOCATION_REQUIRED"
    );
  }
  return id;
}

function fallbackApplicationNumber() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const random = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `ECAPP-${stamp}-${random}`;
}

async function applicationNumber(req) {
  try {
    return await nextDocumentNumber("EQUIPMENT_CREDIT_APPLICATION", {
      userId: userId(req),
    });
  } catch (_error) {
    return fallbackApplicationNumber();
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

async function creditSchemaStatus(connection = pool) {
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

async function assertCreditSchemaReady(connection = pool) {
  const status = await creditSchemaStatus(connection);
  if (!status.ready) {
    throw new CreditApplicationError(
      503,
      "Equipment credit applications are being prepared. The approved KYC and affordability foundation has not been applied yet.",
      "EQUIPMENT_CREDIT_FOUNDATION_REQUIRED"
    );
  }
  return status;
}

function isFoundationError(error) {
  return ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code);
}

function sendError(res, error, fallbackMessage) {
  if (error instanceof CreditApplicationError) {
    return res.status(error.statusCode).json({
      status: "error",
      code: error.code,
      message: error.message,
    });
  }
  if (isFoundationError(error)) {
    return res.status(503).json({
      status: "error",
      code: "EQUIPMENT_CREDIT_FOUNDATION_REQUIRED",
      message:
        "Equipment credit applications are being prepared. The approved KYC and affordability foundation has not been applied yet.",
    });
  }
  if (error?.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      status: "error",
      code: "DUPLICATE_EQUIPMENT_CREDIT_APPLICATION",
      message: "An active credit application already exists for this quotation.",
    });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ status: "error", message: fallbackMessage });
}

async function audit(req, connection, action, application, details, metadata = {}) {
  await writeAuditEvent({
    connection,
    req,
    action,
    actionType: action,
    entityType: "equipment_credit_application",
    entityId: application.id,
    workspaceCode: "equipment_hire",
    hireLocationId: application.hire_location_id,
    severity: /APPROV|DECLIN|SUBMIT|KYC|CHANGE/.test(action)
      ? "notice"
      : "info",
    outcome: "success",
    details,
    metadata,
  });
}

async function loadApplication(connection, applicationId, scope, lock = false) {
  const params = [applicationId];
  let locationSql = "";
  if (scope?.locationId) {
    locationSql = " AND hire_location_id = ?";
    params.push(scope.locationId);
  }
  const [rows] = await connection.query(
    `SELECT *
     FROM equipment_credit_applications
     WHERE id = ?${locationSql}
     LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    params
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

async function loadApplicationDetail(connection, applicationId, scope) {
  const params = [applicationId];
  let locationSql = "";
  if (scope?.locationId) {
    locationSql = " AND application.hire_location_id = ?";
    params.push(scope.locationId);
  }
  const [rows] = await connection.query(
    `SELECT
       application.*,
       customer.customer_name,
       customer.phone AS customer_phone,
       customer.email AS customer_email,
       customer.address AS customer_address,
       quotation.quotation_number,
       quotation.status AS quotation_status,
       asset.asset_code,
       asset.asset_name,
       asset.make,
       asset.model,
       asset.model_year,
       asset.serial_number,
       asset.main_image_url,
       location.name AS hire_location_name,
       creator.full_name AS created_by_name,
       reviewer.full_name AS reviewed_by_name
     FROM equipment_credit_applications application
     INNER JOIN hire_customers customer ON customer.id = application.customer_id
     INNER JOIN equipment_sales_quotations quotation ON quotation.id = application.quotation_id
     INNER JOIN fleet_assets asset ON asset.id = application.asset_id
     INNER JOIN business_locations location ON location.id = application.hire_location_id
     LEFT JOIN users creator ON creator.id = application.created_by
     LEFT JOIN users reviewer ON reviewer.id = application.reviewed_by
     WHERE application.id = ?${locationSql}
     LIMIT 1`,
    params
  );
  if (!rows.length) return null;

  const [kycRows] = await connection.query(
    `SELECT * FROM equipment_credit_application_kyc WHERE application_id = ? LIMIT 1`,
    [applicationId]
  );
  const [decisionRows] = await connection.query(
    `SELECT decision.*, user.full_name AS decided_by_name
     FROM equipment_credit_application_decisions decision
     LEFT JOIN users user ON user.id = decision.decided_by
     WHERE decision.application_id = ?
     ORDER BY decision.decision_version DESC, decision.id DESC`,
    [applicationId]
  );

  return {
    application: rows[0],
    kyc: kycRows[0] || null,
    decisions: decisionRows,
  };
}

async function quotationCandidate(connection, quotationId, selectedLocationId) {
  const [rows] = await connection.query(
    `SELECT
       quotation.*,
       item.id AS quotation_item_id,
       item.asset_id,
       item.line_total,
       asset.asset_code,
       asset.asset_name,
       asset.make,
       asset.model,
       asset.model_year,
       asset.serial_number,
       asset.main_image_url,
       customer.customer_name,
       customer.phone AS customer_phone,
       customer.email AS customer_email,
       customer.address AS customer_address,
       customer.is_active AS customer_is_active
     FROM equipment_sales_quotations quotation
     INNER JOIN equipment_sales_quotation_items item
       ON item.quotation_id = quotation.id
     INNER JOIN fleet_assets asset ON asset.id = item.asset_id
     INNER JOIN hire_customers customer ON customer.id = quotation.customer_id
     WHERE quotation.id = ?
       AND quotation.hire_location_id = ?
       AND quotation.status IN ('approved','accepted')
     ORDER BY item.line_number
     LIMIT 1
     FOR UPDATE`,
    [quotationId, selectedLocationId]
  );
  return rows[0] || null;
}

function applicationInput(body = {}, defaults = {}) {
  const input = body.application || body;
  const proposedFrequency = enumValue(
    input.proposed_frequency,
    PAYMENT_FREQUENCIES,
    defaults.proposed_frequency || "monthly"
  );
  const proposedInstallmentCount = wholeNumber(
    input.proposed_installment_count,
    defaults.proposed_installment_count || 12,
    240
  );
  const applicationDate = dateOnly(
    input.application_date,
    defaults.application_date || today()
  );
  const fields = {
    application_date: applicationDate,
    proposed_deposit: money(
      input.proposed_deposit,
      money(defaults.proposed_deposit, 0)
    ),
    proposed_frequency: proposedFrequency,
    proposed_installment_count: proposedInstallmentCount,
    monthly_salary_income: money(input.monthly_salary_income, 0),
    monthly_business_income: money(input.monthly_business_income, 0),
    monthly_other_income: money(input.monthly_other_income, 0),
    monthly_business_costs: money(input.monthly_business_costs, 0),
    monthly_household_expenses: money(input.monthly_household_expenses, 0),
    existing_monthly_debt: money(input.existing_monthly_debt, 0),
    customer_consent_at: boolValue(input.customer_consent_confirmed, false)
      ? new Date()
      : null,
    assessment_notes: nullableText(input.assessment_notes, 4000),
  };

  if (
    fields.application_date === undefined ||
    fields.proposed_deposit === undefined ||
    fields.proposed_frequency === undefined ||
    fields.proposed_installment_count === undefined ||
    fields.proposed_installment_count < 1 ||
    fields.monthly_salary_income === undefined ||
    fields.monthly_business_income === undefined ||
    fields.monthly_other_income === undefined ||
    fields.monthly_business_costs === undefined ||
    fields.monthly_household_expenses === undefined ||
    fields.existing_monthly_debt === undefined
  ) {
    throw new CreditApplicationError(
      400,
      "Check the application date, proposed installment terms, income and monthly commitments.",
      "INVALID_EQUIPMENT_CREDIT_APPLICATION"
    );
  }
  return fields;
}

function kycInput(body = {}, defaults = {}) {
  const input = body.kyc || {};
  const employmentType = enumValue(
    input.employment_type,
    EMPLOYMENT_TYPES,
    defaults.employment_type || null
  );
  const values = {
    customer_name_snapshot: cleanText(
      input.customer_name_snapshot || defaults.customer_name_snapshot,
      180
    ),
    customer_phone_snapshot: nullableText(
      input.customer_phone_snapshot ?? defaults.customer_phone_snapshot,
      40
    ),
    customer_email_snapshot: nullableText(
      input.customer_email_snapshot ?? defaults.customer_email_snapshot,
      180
    ),
    customer_address_snapshot: nullableText(
      input.customer_address_snapshot ?? defaults.customer_address_snapshot,
      3000
    ),
    id_type: nullableText(input.id_type ?? defaults.id_type, 80),
    id_number: nullableText(input.id_number ?? defaults.id_number, 150),
    date_of_birth: dateOnly(input.date_of_birth, defaults.date_of_birth || null),
    nationality: cleanText(input.nationality || defaults.nationality || "Ghana", 100),
    employment_type: employmentType,
    occupation: nullableText(input.occupation ?? defaults.occupation, 150),
    employer_business_name: nullableText(
      input.employer_business_name ?? defaults.employer_business_name,
      200
    ),
    business_registration_number: nullableText(
      input.business_registration_number ?? defaults.business_registration_number,
      150
    ),
    residential_address: nullableText(
      input.residential_address ?? defaults.residential_address,
      3000
    ),
    work_address: nullableText(input.work_address ?? defaults.work_address, 3000),
    years_at_residence: decimalNumber(
      input.years_at_residence,
      defaults.years_at_residence ?? null,
      100
    ),
    years_in_employment_business: decimalNumber(
      input.years_in_employment_business,
      defaults.years_in_employment_business ?? null,
      100
    ),
    emergency_contact_name: nullableText(
      input.emergency_contact_name ?? defaults.emergency_contact_name,
      180
    ),
    emergency_contact_phone: nullableText(
      input.emergency_contact_phone ?? defaults.emergency_contact_phone,
      40
    ),
    emergency_contact_relationship: nullableText(
      input.emergency_contact_relationship ?? defaults.emergency_contact_relationship,
      100
    ),
    guarantor_name: nullableText(input.guarantor_name ?? defaults.guarantor_name, 180),
    guarantor_phone: nullableText(
      input.guarantor_phone ?? defaults.guarantor_phone,
      40
    ),
    guarantor_address: nullableText(
      input.guarantor_address ?? defaults.guarantor_address,
      3000
    ),
    guarantor_id_type: nullableText(
      input.guarantor_id_type ?? defaults.guarantor_id_type,
      80
    ),
    guarantor_id_number: nullableText(
      input.guarantor_id_number ?? defaults.guarantor_id_number,
      150
    ),
    guarantor_relationship: nullableText(
      input.guarantor_relationship ?? defaults.guarantor_relationship,
      100
    ),
    identity_document_url: nullableText(
      input.identity_document_url ?? defaults.identity_document_url,
      10000
    ),
    address_evidence_url: nullableText(
      input.address_evidence_url ?? defaults.address_evidence_url,
      10000
    ),
    income_evidence_url: nullableText(
      input.income_evidence_url ?? defaults.income_evidence_url,
      10000
    ),
    bank_statement_url: nullableText(
      input.bank_statement_url ?? defaults.bank_statement_url,
      10000
    ),
    business_registration_url: nullableText(
      input.business_registration_url ?? defaults.business_registration_url,
      10000
    ),
    guarantor_document_url: nullableText(
      input.guarantor_document_url ?? defaults.guarantor_document_url,
      10000
    ),
    identity_verified: boolValue(
      input.identity_verified,
      Boolean(defaults.identity_verified)
    ),
    address_verified: boolValue(
      input.address_verified,
      Boolean(defaults.address_verified)
    ),
    income_verified: boolValue(
      input.income_verified,
      Boolean(defaults.income_verified)
    ),
    guarantor_verified: boolValue(
      input.guarantor_verified,
      Boolean(defaults.guarantor_verified)
    ),
    customer_consent_confirmed: boolValue(
      input.customer_consent_confirmed,
      Boolean(defaults.customer_consent_confirmed)
    ),
    credit_assessment_consent_confirmed: boolValue(
      input.credit_assessment_consent_confirmed,
      Boolean(defaults.credit_assessment_consent_confirmed)
    ),
    verification_notes: nullableText(
      input.verification_notes ?? defaults.verification_notes,
      4000
    ),
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
    throw new CreditApplicationError(
      400,
      "Check the customer identity, employment, residence and consent information.",
      "INVALID_EQUIPMENT_CREDIT_KYC"
    );
  }
  return values;
}

function assessmentNotes(assessment, additional = null) {
  const lines = [
    ...assessment.reasons.map((reason) => `Failed: ${reason}`),
    ...assessment.warnings.map((warning) => `Review: ${warning}`),
  ];
  if (additional) lines.push(additional);
  return lines.join("\n").slice(0, 4000) || null;
}

async function upsertKyc(connection, applicationId, kyc, actorId) {
  await connection.query(
    `INSERT INTO equipment_credit_application_kyc (
       application_id, customer_name_snapshot, customer_phone_snapshot,
       customer_email_snapshot, customer_address_snapshot, id_type, id_number,
       date_of_birth, nationality, employment_type, occupation,
       employer_business_name, business_registration_number,
       residential_address, work_address, years_at_residence,
       years_in_employment_business, emergency_contact_name,
       emergency_contact_phone, emergency_contact_relationship,
       guarantor_name, guarantor_phone, guarantor_address,
       guarantor_id_type, guarantor_id_number, guarantor_relationship,
       identity_document_url, address_evidence_url, income_evidence_url,
       bank_statement_url, business_registration_url, guarantor_document_url,
       identity_verified, address_verified, income_verified,
       guarantor_verified, customer_consent_confirmed,
       credit_assessment_consent_confirmed, verification_notes,
       created_by, updated_by
     ) VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     )
     ON DUPLICATE KEY UPDATE
       customer_name_snapshot = VALUES(customer_name_snapshot),
       customer_phone_snapshot = VALUES(customer_phone_snapshot),
       customer_email_snapshot = VALUES(customer_email_snapshot),
       customer_address_snapshot = VALUES(customer_address_snapshot),
       id_type = VALUES(id_type),
       id_number = VALUES(id_number),
       date_of_birth = VALUES(date_of_birth),
       nationality = VALUES(nationality),
       employment_type = VALUES(employment_type),
       occupation = VALUES(occupation),
       employer_business_name = VALUES(employer_business_name),
       business_registration_number = VALUES(business_registration_number),
       residential_address = VALUES(residential_address),
       work_address = VALUES(work_address),
       years_at_residence = VALUES(years_at_residence),
       years_in_employment_business = VALUES(years_in_employment_business),
       emergency_contact_name = VALUES(emergency_contact_name),
       emergency_contact_phone = VALUES(emergency_contact_phone),
       emergency_contact_relationship = VALUES(emergency_contact_relationship),
       guarantor_name = VALUES(guarantor_name),
       guarantor_phone = VALUES(guarantor_phone),
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
       address_verified = VALUES(address_verified),
       income_verified = VALUES(income_verified),
       guarantor_verified = VALUES(guarantor_verified),
       customer_consent_confirmed = VALUES(customer_consent_confirmed),
       credit_assessment_consent_confirmed = VALUES(credit_assessment_consent_confirmed),
       verification_notes = VALUES(verification_notes),
       updated_by = VALUES(updated_by),
       updated_at = NOW()`,
    [
      applicationId,
      kyc.customer_name_snapshot,
      kyc.customer_phone_snapshot,
      kyc.customer_email_snapshot,
      kyc.customer_address_snapshot,
      kyc.id_type,
      kyc.id_number,
      kyc.date_of_birth,
      kyc.nationality,
      kyc.employment_type,
      kyc.occupation,
      kyc.employer_business_name,
      kyc.business_registration_number,
      kyc.residential_address,
      kyc.work_address,
      kyc.years_at_residence,
      kyc.years_in_employment_business,
      kyc.emergency_contact_name,
      kyc.emergency_contact_phone,
      kyc.emergency_contact_relationship,
      kyc.guarantor_name,
      kyc.guarantor_phone,
      kyc.guarantor_address,
      kyc.guarantor_id_type,
      kyc.guarantor_id_number,
      kyc.guarantor_relationship,
      kyc.identity_document_url,
      kyc.address_evidence_url,
      kyc.income_evidence_url,
      kyc.bank_statement_url,
      kyc.business_registration_url,
      kyc.guarantor_document_url,
      kyc.identity_verified,
      kyc.address_verified,
      kyc.income_verified,
      kyc.guarantor_verified,
      kyc.customer_consent_confirmed,
      kyc.credit_assessment_consent_confirmed,
      kyc.verification_notes,
      actorId,
      actorId,
    ]
  );
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
        application_number: application.application_number,
        ...snapshot,
        assessment: assessment || null,
      }),
      actorId,
    ]
  );
  application.decision_version = nextVersion;
  return nextVersion;
}

async function applyAssessment(connection, application, kyc, assessment, actorId) {
  await connection.query(
    `UPDATE equipment_credit_applications
     SET proposed_deposit = ?, financed_amount = ?, proposed_frequency = ?,
         proposed_installment_count = ?, proposed_installment_amount = ?,
         monthly_salary_income = ?, monthly_business_income = ?,
         monthly_other_income = ?, monthly_business_costs = ?,
         monthly_household_expenses = ?, existing_monthly_debt = ?,
         total_monthly_income = ?, total_monthly_commitments = ?,
         net_monthly_surplus = ?, debt_service_ratio_percent = ?,
         total_commitment_ratio_percent = ?, deposit_ratio_percent = ?,
         kyc_status = ?, affordability_status = ?, risk_band = ?, risk_score = ?,
         assessment_recommendation = ?, assessment_notes = ?, updated_by = ?
     WHERE id = ?`,
    [
      assessment.proposed_deposit,
      assessment.financed_amount,
      assessment.proposed_frequency,
      assessment.proposed_installment_count,
      assessment.proposed_installment_amount,
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
      assessmentNotes(assessment, application.assessment_notes),
      actorId,
      application.id,
    ]
  );
  Object.assign(application, assessment, {
    kyc_status: assessment.kyc_status,
    assessment_notes: assessmentNotes(assessment, application.assessment_notes),
  });
  return application;
}

router.get(
  "/readiness",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const readiness = await creditSchemaStatus(pool);
      return res.status(readiness.ready ? 200 : 503).json({
        status: readiness.ready ? "success" : "error",
        code: readiness.ready ? undefined : "EQUIPMENT_CREDIT_FOUNDATION_REQUIRED",
        readiness,
      });
    } catch (error) {
      return sendError(res, error, "Could not check equipment credit readiness.");
    }
  }
);

router.get("/", requirePermission("fleet.assets.view"), async (req, res) => {
  try {
    await assertCreditSchemaReady(pool);
    const where = ["1 = 1"];
    const params = [];
    if (req.hireLocationScope?.locationId) {
      where.push("application.hire_location_id = ?");
      params.push(req.hireLocationScope.locationId);
    }
    const status = enumValue(req.query.status, APPLICATION_STATUSES, null);
    if (req.query.status && status === undefined) {
      throw new CreditApplicationError(400, "Invalid credit application status.");
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
         asset.asset_code,
         asset.asset_name,
         asset.make,
         asset.model,
         asset.main_image_url,
         location.name AS hire_location_name
       FROM equipment_credit_applications application
       INNER JOIN hire_customers customer ON customer.id = application.customer_id
       INNER JOIN equipment_sales_quotations quotation ON quotation.id = application.quotation_id
       INNER JOIN fleet_assets asset ON asset.id = application.asset_id
       INNER JOIN business_locations location ON location.id = application.hire_location_id
       WHERE ${where.join(" AND ")}
       ORDER BY application.created_at DESC
       LIMIT 500`,
      params
    );
    return res.json({ status: "success", count: rows.length, applications: rows });
  } catch (error) {
    return sendError(res, error, "Could not load equipment credit applications.");
  }
});

router.get("/:id", requirePermission("fleet.assets.view"), async (req, res) => {
  try {
    await assertCreditSchemaReady(pool);
    const applicationId = positiveId(req.params.id);
    if (!applicationId) {
      throw new CreditApplicationError(400, "Invalid credit application ID.");
    }
    const detail = await loadApplicationDetail(
      pool,
      applicationId,
      req.hireLocationScope
    );
    if (!detail) {
      throw new CreditApplicationError(404, "Credit application was not found.");
    }
    return res.json({ status: "success", ...detail });
  } catch (error) {
    return sendError(res, error, "Could not load the equipment credit application.");
  }
});

router.post("/", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    await assertCreditSchemaReady(pool);
    const selectedLocationId = locationId(req);
    const quotationId = positiveId(req.body.quotation_id || req.body.application?.quotation_id);
    if (!quotationId) {
      throw new CreditApplicationError(
        400,
        "Choose an approved installment quotation before creating a credit application."
      );
    }
    const number = await applicationNumber(req);
    const result = await withTransaction(async (connection) => {
      const quotation = await quotationCandidate(
        connection,
        quotationId,
        selectedLocationId
      );
      if (!quotation || !quotation.customer_is_active) {
        throw new CreditApplicationError(
          404,
          "Approved quotation, customer or equipment was not found at the selected location."
        );
      }
      if (
        !quotation.proposed_frequency ||
        !Number(quotation.proposed_installment_count || 0)
      ) {
        throw new CreditApplicationError(
          409,
          "This quotation does not contain installment terms. Prepare an installment quotation first.",
          "INSTALLMENT_QUOTATION_REQUIRED"
        );
      }
      const [existingRows] = await connection.query(
        `SELECT id, application_number
         FROM equipment_credit_applications
         WHERE quotation_id = ?
           AND application_status NOT IN ('declined','withdrawn')
         LIMIT 1 FOR UPDATE`,
        [quotationId]
      );
      if (existingRows.length) {
        throw new CreditApplicationError(
          409,
          `Active credit application ${existingRows[0].application_number} already uses this quotation.`,
          "ACTIVE_EQUIPMENT_CREDIT_APPLICATION_EXISTS"
        );
      }

      const applicationFields = applicationInput(req.body, {
        application_date: today(),
        proposed_deposit: quotation.deposit_required,
        proposed_frequency: quotation.proposed_frequency,
        proposed_installment_count: quotation.proposed_installment_count,
      });
      if (applicationFields.proposed_deposit > Number(quotation.total_amount || 0)) {
        throw new CreditApplicationError(
          400,
          "The proposed deposit cannot exceed the quotation total."
        );
      }
      const kyc = kycInput(req.body, {
        customer_name_snapshot: quotation.customer_name,
        customer_phone_snapshot: quotation.customer_phone,
        customer_email_snapshot: quotation.customer_email,
        customer_address_snapshot: quotation.customer_address,
        residential_address: quotation.customer_address,
        nationality: "Ghana",
      });
      const assessment = evaluateCreditApplication(
        {
          quoted_total: quotation.total_amount,
          ...applicationFields,
        },
        kyc
      );
      const [insert] = await connection.query(
        `INSERT INTO equipment_credit_applications (
           application_number, hire_location_id, customer_id, enquiry_id,
           quotation_id, asset_id, application_date, application_status,
           kyc_status, affordability_status, risk_band, risk_score,
           quoted_total, proposed_deposit, financed_amount,
           proposed_frequency, proposed_installment_count,
           proposed_installment_amount, monthly_salary_income,
           monthly_business_income, monthly_other_income,
           monthly_business_costs, monthly_household_expenses,
           existing_monthly_debt, total_monthly_income,
           total_monthly_commitments, net_monthly_surplus,
           debt_service_ratio_percent, total_commitment_ratio_percent,
           deposit_ratio_percent, assessment_recommendation,
           assessment_notes, customer_consent_at, decision_version,
           created_by, updated_by
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?
         )`,
        [
          number,
          selectedLocationId,
          quotation.customer_id,
          quotation.enquiry_id || null,
          quotation.id,
          quotation.asset_id,
          applicationFields.application_date,
          assessment.kyc_status,
          assessment.affordability_status,
          assessment.risk_band,
          assessment.risk_score,
          assessment.quoted_total,
          assessment.proposed_deposit,
          assessment.financed_amount,
          assessment.proposed_frequency,
          assessment.proposed_installment_count,
          assessment.proposed_installment_amount,
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
          assessment.assessment_recommendation,
          assessmentNotes(assessment, applicationFields.assessment_notes),
          applicationFields.customer_consent_at,
          userId(req),
          userId(req),
        ]
      );
      const application = {
        id: insert.insertId,
        application_number: number,
        hire_location_id: selectedLocationId,
        customer_id: quotation.customer_id,
        quotation_id: quotation.id,
        asset_id: quotation.asset_id,
        application_status: "draft",
        decision_version: 0,
        ...assessment,
      };
      await upsertKyc(connection, application.id, kyc, userId(req));
      await recordDecision(
        connection,
        application,
        "created",
        null,
        "draft",
        assessment,
        "Credit application created as a draft.",
        userId(req),
        { quotation_number: quotation.quotation_number }
      );
      await audit(
        req,
        connection,
        "EQUIPMENT_CREDIT_APPLICATION_CREATED",
        application,
        `Created credit application ${number} for ${quotation.customer_name}.`,
        {
          quotation_id: quotation.id,
          asset_id: quotation.asset_id,
          affordability_status: assessment.affordability_status,
          risk_band: assessment.risk_band,
        }
      );
      return application;
    });
    return res.status(201).json({
      status: "success",
      message: "Equipment credit application created as a draft.",
      application: result,
    });
  } catch (error) {
    return sendError(res, error, "Could not create the equipment credit application.");
  }
});

router.put("/:id", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    await assertCreditSchemaReady(pool);
    const applicationId = positiveId(req.params.id);
    if (!applicationId) {
      throw new CreditApplicationError(400, "Invalid credit application ID.");
    }
    const updated = await withTransaction(async (connection) => {
      const application = await loadApplication(
        connection,
        applicationId,
        req.hireLocationScope,
        true
      );
      if (!application) {
        throw new CreditApplicationError(404, "Credit application was not found.");
      }
      if (!["draft", "changes_requested"].includes(application.application_status)) {
        throw new CreditApplicationError(
          409,
          "Only draft or changes-requested applications can be edited.",
          "EQUIPMENT_CREDIT_APPLICATION_LOCKED"
        );
      }
      const currentKyc = await loadKyc(connection, application.id, true);
      const fields = applicationInput(req.body, application);
      if (fields.proposed_deposit > Number(application.quoted_total || 0)) {
        throw new CreditApplicationError(
          400,
          "The proposed deposit cannot exceed the quotation total."
        );
      }
      const kyc = kycInput(req.body, currentKyc || {});
      const assessment = evaluateCreditApplication(
        { quoted_total: application.quoted_total, ...fields },
        kyc
      );
      await connection.query(
        `UPDATE equipment_credit_applications
         SET application_date = ?, customer_consent_at = COALESCE(?, customer_consent_at),
             assessment_notes = ?, updated_by = ?
         WHERE id = ?`,
        [
          fields.application_date,
          fields.customer_consent_at,
          fields.assessment_notes,
          userId(req),
          application.id,
        ]
      );
      application.assessment_notes = fields.assessment_notes;
      await upsertKyc(connection, application.id, kyc, userId(req));
      await applyAssessment(connection, application, kyc, assessment, userId(req));
      await recordDecision(
        connection,
        application,
        "updated",
        application.application_status,
        application.application_status,
        assessment,
        "Application and KYC information updated.",
        userId(req)
      );
      await audit(
        req,
        connection,
        "EQUIPMENT_CREDIT_APPLICATION_UPDATED",
        application,
        `Updated credit application ${application.application_number}.`,
        {
          affordability_status: assessment.affordability_status,
          risk_band: assessment.risk_band,
        }
      );
      return application;
    });
    return res.json({
      status: "success",
      message: "Credit application and affordability assessment updated.",
      application: updated,
    });
  } catch (error) {
    return sendError(res, error, "Could not update the equipment credit application.");
  }
});

router.post(
  "/:id/assess",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      await assertCreditSchemaReady(pool);
      const applicationId = positiveId(req.params.id);
      if (!applicationId) {
        throw new CreditApplicationError(400, "Invalid credit application ID.");
      }
      const assessed = await withTransaction(async (connection) => {
        const application = await loadApplication(
          connection,
          applicationId,
          req.hireLocationScope,
          true
        );
        if (!application) {
          throw new CreditApplicationError(404, "Credit application was not found.");
        }
        if (["approved", "declined", "withdrawn"].includes(application.application_status)) {
          throw new CreditApplicationError(
            409,
            "A final credit application cannot be reassessed without a new controlled application."
          );
        }
        const kyc = await loadKyc(connection, application.id, true);
        const assessment = evaluateCreditApplication(application, kyc || {});
        await applyAssessment(connection, application, kyc || {}, assessment, userId(req));
        await recordDecision(
          connection,
          application,
          "assessed",
          application.application_status,
          application.application_status,
          assessment,
          "Affordability and risk recalculated.",
          userId(req)
        );
        await audit(
          req,
          connection,
          "EQUIPMENT_CREDIT_APPLICATION_ASSESSED",
          application,
          `Reassessed credit application ${application.application_number}.`,
          {
            affordability_status: assessment.affordability_status,
            risk_score: assessment.risk_score,
          }
        );
        return application;
      });
      return res.json({
        status: "success",
        message: "Affordability and risk assessment recalculated.",
        application: assessed,
      });
    } catch (error) {
      return sendError(res, error, "Could not assess the equipment credit application.");
    }
  }
);

router.post(
  "/:id/submit",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      await assertCreditSchemaReady(pool);
      const applicationId = positiveId(req.params.id);
      if (!applicationId) {
        throw new CreditApplicationError(400, "Invalid credit application ID.");
      }
      const submitted = await withTransaction(async (connection) => {
        const application = await loadApplication(
          connection,
          applicationId,
          req.hireLocationScope,
          true
        );
        if (!application) {
          throw new CreditApplicationError(404, "Credit application was not found.");
        }
        if (!["draft", "changes_requested"].includes(application.application_status)) {
          throw new CreditApplicationError(
            409,
            "Only a draft or changes-requested application can be submitted."
          );
        }
        const kyc = await loadKyc(connection, application.id, true);
        const assessment = evaluateCreditApplication(application, kyc || {});
        if (!["complete", "verified"].includes(assessment.kyc_status)) {
          throw new CreditApplicationError(
            409,
            "Complete the required customer, consent and guarantor KYC information before submission.",
            "EQUIPMENT_CREDIT_KYC_INCOMPLETE"
          );
        }
        if (assessment.affordability_status === "ineligible") {
          throw new CreditApplicationError(
            409,
            "The current affordability assessment is ineligible. Correct the failed conditions before submission.",
            "EQUIPMENT_CREDIT_AFFORDABILITY_FAILED"
          );
        }
        await applyAssessment(connection, application, kyc || {}, assessment, userId(req));
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
          nullableText(req.body.notes, 2000) || "Submitted for independent review.",
          userId(req)
        );
        await audit(
          req,
          connection,
          "EQUIPMENT_CREDIT_APPLICATION_SUBMITTED",
          application,
          `Submitted credit application ${application.application_number} for review.`,
          {
            affordability_status: assessment.affordability_status,
            risk_band: assessment.risk_band,
          }
        );
        return application;
      });
      return res.json({
        status: "success",
        message: "Credit application submitted for manager review.",
        application: submitted,
      });
    } catch (error) {
      return sendError(res, error, "Could not submit the equipment credit application.");
    }
  }
);

router.post(
  "/:id/kyc/verify",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      assertReviewer(req);
      await assertCreditSchemaReady(pool);
      const applicationId = positiveId(req.params.id);
      const verificationStatus = enumValue(
        req.body.verification_status,
        new Set(["verified", "rejected"]),
        undefined
      );
      const reason = nullableText(req.body.reason, 1500);
      if (!applicationId || verificationStatus === undefined) {
        throw new CreditApplicationError(
          400,
          "Choose verified or rejected for the KYC decision."
        );
      }
      if (verificationStatus === "rejected" && !reason) {
        throw new CreditApplicationError(
          400,
          "Enter the reason for rejecting the KYC evidence."
        );
      }
      const result = await withTransaction(async (connection) => {
        const application = await loadApplication(
          connection,
          applicationId,
          req.hireLocationScope,
          true
        );
        if (!application) {
          throw new CreditApplicationError(404, "Credit application was not found.");
        }
        if (["approved", "declined", "withdrawn"].includes(application.application_status)) {
          throw new CreditApplicationError(409, "This application already has a final decision.");
        }
        const currentKyc = await loadKyc(connection, application.id, true);
        if (!currentKyc) {
          throw new CreditApplicationError(409, "KYC information has not been recorded.");
        }
        const kyc = kycInput(
          {
            kyc: {
              ...currentKyc,
              identity_verified: verificationStatus === "verified",
              address_verified: verificationStatus === "verified",
              income_verified: verificationStatus === "verified",
              guarantor_verified:
                verificationStatus === "verified" &&
                Boolean(currentKyc.guarantor_name),
              verification_notes: reason || currentKyc.verification_notes,
            },
          },
          currentKyc
        );
        const assessment = evaluateCreditApplication(application, kyc);
        if (verificationStatus === "verified" && assessment.kyc_status !== "verified") {
          throw new CreditApplicationError(
            409,
            "Required identity, consent or guarantor information is incomplete and cannot be verified."
          );
        }
        await upsertKyc(connection, application.id, kyc, userId(req));
        await connection.query(
          `UPDATE equipment_credit_application_kyc
           SET verified_by = ?, verified_at = NOW(), verification_notes = ?
           WHERE application_id = ?`,
          [userId(req), reason, application.id]
        );
        await applyAssessment(connection, application, kyc, assessment, userId(req));
        const fromStatus = application.application_status;
        if (verificationStatus === "rejected") {
          await connection.query(
            `UPDATE equipment_credit_applications
             SET kyc_status = 'rejected', application_status = 'changes_requested',
                 decision_reason = ?, reviewed_by = ?, reviewed_at = NOW(), updated_by = ?
             WHERE id = ?`,
            [reason, userId(req), userId(req), application.id]
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
          userId(req),
          { verification_status: verificationStatus }
        );
        await audit(
          req,
          connection,
          verificationStatus === "verified"
            ? "EQUIPMENT_CREDIT_KYC_VERIFIED"
            : "EQUIPMENT_CREDIT_KYC_REJECTED",
          application,
          `${verificationStatus === "verified" ? "Verified" : "Rejected"} KYC evidence for ${application.application_number}.`,
          { reason }
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
      return sendError(res, error, "Could not verify the credit application KYC.");
    }
  }
);

router.post(
  "/:id/review",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      assertReviewer(req);
      await assertCreditSchemaReady(pool);
      const applicationId = positiveId(req.params.id);
      const action = enumValue(req.body.action, REVIEW_ACTIONS, undefined);
      const reason = nullableText(req.body.reason, 1500);
      if (!applicationId || action === undefined) {
        throw new CreditApplicationError(400, "Choose a valid credit review action.");
      }
      if (["request_changes", "decline"].includes(action) && !reason) {
        throw new CreditApplicationError(
          400,
          "Enter the reason for the review decision."
        );
      }
      const reviewed = await withTransaction(async (connection) => {
        const application = await loadApplication(
          connection,
          applicationId,
          req.hireLocationScope,
          true
        );
        if (!application) {
          throw new CreditApplicationError(404, "Credit application was not found.");
        }
        if (["approved", "declined", "withdrawn"].includes(application.application_status)) {
          throw new CreditApplicationError(409, "This application already has a final decision.");
        }
        if (!["submitted", "under_review"].includes(application.application_status)) {
          throw new CreditApplicationError(
            409,
            "Submit the credit application before a manager review decision."
          );
        }
        const kyc = await loadKyc(connection, application.id, true);
        const assessment = evaluateCreditApplication(application, kyc || {});
        await applyAssessment(connection, application, kyc || {}, assessment, userId(req));

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
            throw new CreditApplicationError(
              409,
              "Verify the required KYC evidence before approving the application.",
              "EQUIPMENT_CREDIT_KYC_VERIFICATION_REQUIRED"
            );
          }
          if (assessment.affordability_status === "ineligible") {
            throw new CreditApplicationError(
              409,
              "An affordability-ineligible application cannot be approved.",
              "EQUIPMENT_CREDIT_APPROVAL_BLOCKED"
            );
          }
          if (assessment.affordability_status === "manual_review" && !reason) {
            throw new CreditApplicationError(
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
          reason || "Manager review started.",
          userId(req),
          { review_action: action }
        );
        await audit(
          req,
          connection,
          `EQUIPMENT_CREDIT_APPLICATION_${actionType.toUpperCase()}`,
          application,
          `Credit application ${application.application_number} changed from ${fromStatus} to ${nextStatus}.`,
          {
            reason,
            affordability_status: assessment.affordability_status,
            risk_band: assessment.risk_band,
          }
        );
        return application;
      });
      return res.json({
        status: "success",
        message: `Credit application review recorded as ${reviewed.application_status.replaceAll("_", " ")}.`,
        application: reviewed,
      });
    } catch (error) {
      return sendError(res, error, "Could not review the equipment credit application.");
    }
  }
);

module.exports = router;
module.exports.REQUIRED_TABLES = REQUIRED_TABLES;
module.exports.REVIEWER_ROLES = REVIEWER_ROLES;
