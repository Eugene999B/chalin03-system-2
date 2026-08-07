const crypto = require("crypto");
const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { nextDocumentNumber } = require("../services/groupConfigurationService");
const {
  evaluateCreditApplication,
} = require("../services/equipmentCreditApplicationPolicy");
const {
  buildFinanceSchedule,
  FinanceScheduleError,
  monthlyEquivalent,
} = require("../services/equipmentFinanceScheduleService");
const {
  assertProfessionalSchema,
  getProfessionalSettings,
  listProfessionalMachines,
} = require("../services/equipmentFinanceProfessionalService");

const router = express.Router();

const CUSTOMER_TYPES = new Set(["individual", "company", "contractor", "government"]);
const EMPLOYMENT_TYPES = new Set([
  "salaried",
  "self_employed",
  "contractor",
  "pensioner",
  "farmer",
  "other",
]);

class PhaseOneError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_FINANCE_PHASE_ONE_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 500) {
  return cleanText(value, maxLength) || null;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function moneyValue(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(number) && number >= 0
    ? Number(number.toFixed(2))
    : undefined;
}

function integerValue(value, fallback = 0, maximum = 520) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= maximum
    ? number
    : undefined;
}

function dateValue(value, fallback = null) {
  const text = cleanText(value, 20);
  if (!text) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : text;
}

function booleanValue(value, fallback = false) {
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

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function normalizePhone(value) {
  const digits = cleanText(value, 40).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00233")) return `0${digits.slice(5)}`;
  if (digits.startsWith("233")) return `0${digits.slice(3)}`;
  return digits;
}

function fallbackNumber(prefix) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `${prefix}-${stamp}-${String(crypto.randomInt(0, 1000000)).padStart(6, "0")}`;
}

async function documentNumber(sequence, prefix, actorId) {
  try {
    return await nextDocumentNumber(sequence, { userId: actorId });
  } catch (_error) {
    return fallbackNumber(prefix);
  }
}

function userId(req) {
  return positiveId(req.user?.id);
}

function sendError(res, error, fallback) {
  if (error instanceof PhaseOneError || error instanceof FinanceScheduleError) {
    return res.status(Number(error.statusCode || 400)).json({
      status: "error",
      code: error.code,
      message: error.message,
    });
  }
  if (error?.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      status: "error",
      code: "DUPLICATE_FINANCE_RECORD",
      message: "That customer, Installment Offer or application already exists.",
    });
  }
  if (["ER_BAD_FIELD_ERROR", "ER_NO_SUCH_TABLE"].includes(error?.code)) {
    return res.status(503).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_STABILIZATION_REQUIRED",
      message: "The company-wide Finance update is still being prepared. Try again after the deployment completes.",
    });
  }
  console.error(fallback, error);
  return res.status(500).json({
    status: "error",
    code: "EQUIPMENT_FINANCE_START_FAILED",
    message: fallback,
  });
}

async function withTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const value = await work(connection);
    await connection.commit();
    return value;
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

async function audit(req, connection, action, entityType, entityId, details, metadata = {}) {
  await writeAuditEvent({
    connection,
    req,
    action,
    actionType: action,
    entityType,
    entityId,
    workspaceCode: "equipment_installment_finance",
    hireLocationId: null,
    severity: /CREATED|UPDATED|OFFER|APPLICATION|STARTED/.test(action) ? "notice" : "info",
    outcome: "success",
    details,
    metadata: {
      finance_division: "installment_finance",
      finance_scope: "company_wide",
      hire_location_id: null,
      hire_location_selection_required: false,
      ...metadata,
    },
  });
}

function normalizeCustomer(body = {}) {
  const customerName = cleanText(body.customer_name, 180);
  const customerType = cleanText(body.customer_type || "individual", 30).toLowerCase();
  const phone = normalizePhone(body.phone);
  if (!customerName || !CUSTOMER_TYPES.has(customerType)) {
    throw new PhaseOneError(400, "Enter the customer name and choose a valid customer type.");
  }
  if (!phone) {
    throw new PhaseOneError(400, "Enter the customer phone number.");
  }
  return {
    customer_name: customerName,
    customer_type: customerType,
    phone,
    whatsapp_phone: normalizePhone(body.whatsapp_phone) || phone,
    email: nullableText(body.email, 150),
    address: nullableText(body.address, 1000),
    contact_person: nullableText(body.contact_person, 150),
    risk_notes: nullableText(body.risk_notes, 3000),
    is_active: body.is_active === false ? 0 : 1,
  };
}

async function findDuplicateCustomer(connection, customer, exceptId = null) {
  const params = [customer.phone, customer.customer_name];
  let except = "";
  if (exceptId) {
    except = "AND id <> ?";
    params.push(exceptId);
  }
  const [rows] = await connection.query(
    `SELECT id, customer_code, customer_name, phone, email, address, is_active
     FROM hire_customers
     WHERE (
       REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', ''), '233', '0') = ?
       OR LOWER(customer_name) = LOWER(?)
     ) ${except}
     ORDER BY is_active DESC, id DESC
     LIMIT 5`,
    params
  );
  return rows;
}

async function createCustomer(connection, body, actorId, confirmDuplicate = false) {
  const customer = normalizeCustomer(body);
  const duplicates = await findDuplicateCustomer(connection, customer);
  if (duplicates.length && !confirmDuplicate) {
    const error = new PhaseOneError(
      409,
      "A customer with this phone number or name already exists. Select the existing customer or confirm that this is a different person.",
      "POSSIBLE_DUPLICATE_FINANCE_CUSTOMER"
    );
    error.duplicates = duplicates;
    throw error;
  }
  const customerCode =
    cleanText(body.customer_code, 50).toUpperCase() ||
    (await documentNumber("EQUIPMENT_FINANCE_CUSTOMER", "FCUS", actorId));
  const [result] = await connection.query(
    `INSERT INTO hire_customers (
       customer_code, customer_name, customer_type, phone, whatsapp_phone,
       email, address, contact_person, payment_terms_days, credit_limit,
       risk_notes, is_active, created_by, updated_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
    [
      customerCode,
      customer.customer_name,
      customer.customer_type,
      customer.phone,
      customer.whatsapp_phone,
      customer.email,
      customer.address,
      customer.contact_person,
      customer.risk_notes,
      customer.is_active,
      actorId,
      actorId,
    ]
  );
  return { id: result.insertId, customer_code: customerCode, ...customer };
}

async function customerRecord(connection, customerId, lock = false) {
  const [rows] = await connection.query(
    `SELECT * FROM hire_customers
     WHERE id = ? AND is_active = TRUE
     LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [customerId]
  );
  return rows[0] || null;
}

async function financeMachine(connection, assetId) {
  const [rows] = await connection.query(
    `SELECT asset.*,
            (SELECT COUNT(*) FROM hire_contract_assets hire_asset
             WHERE hire_asset.asset_id = asset.id
               AND hire_asset.status IN ('assigned','dispatched','active')) AS active_hire_count,
            (SELECT COUNT(*) FROM equipment_asset_sale_locks sale_lock
             WHERE sale_lock.asset_id = asset.id AND sale_lock.released_at IS NULL) AS active_sale_lock_count,
            (SELECT COUNT(*) FROM equipment_credit_applications application
             WHERE application.asset_id = asset.id
               AND application.application_status IN ('draft','submitted','under_review','changes_requested','approved')) AS active_application_count,
            (SELECT application.id FROM equipment_credit_applications application
             WHERE application.asset_id = asset.id
               AND application.application_status IN ('draft','submitted','under_review','changes_requested','approved')
             ORDER BY application.updated_at DESC, application.id DESC LIMIT 1) AS blocking_application_id,
            (SELECT application.application_number FROM equipment_credit_applications application
             WHERE application.asset_id = asset.id
               AND application.application_status IN ('draft','submitted','under_review','changes_requested','approved')
             ORDER BY application.updated_at DESC, application.id DESC LIMIT 1) AS blocking_application_number,
            (SELECT agreement.agreement_number
             FROM equipment_asset_sale_locks sale_lock
             INNER JOIN equipment_sale_agreements agreement ON agreement.id = sale_lock.agreement_id
             WHERE sale_lock.asset_id = asset.id AND sale_lock.released_at IS NULL
             ORDER BY sale_lock.created_at DESC, sale_lock.id DESC LIMIT 1) AS blocking_agreement_number
     FROM fleet_assets asset
     WHERE asset.id = ? AND asset.is_active = TRUE
     LIMIT 1 FOR UPDATE`,
    [assetId]
  );
  return rows[0] || null;
}

function assertMachineAvailable(machine) {
  if (!machine) throw new PhaseOneError(404, "The selected excavator was not found.");
  if (!["sale_only", "sale_or_hire"].includes(machine.operational_purpose)) {
    throw new PhaseOneError(409, "The selected excavator is not approved for sale.");
  }
  if (machine.sale_status !== "available") {
    throw new PhaseOneError(409, "The selected excavator is not currently available for a new installment.");
  }
  if (Number(machine.active_hire_count || 0) > 0) {
    throw new PhaseOneError(409, "The selected excavator is active on Hire and cannot enter an installment.");
  }
  if (Number(machine.active_sale_lock_count || 0) > 0) {
    throw new PhaseOneError(
      409,
      `The selected excavator is reserved by Finance agreement ${machine.blocking_agreement_number || "on record"}.`,
      "FINANCE_ASSET_HELD_BY_AGREEMENT"
    );
  }
  if (Number(machine.active_application_count || 0) > 0) {
    throw new PhaseOneError(
      409,
      `The selected excavator is held by application ${machine.blocking_application_number || "on record"}.`,
      "FINANCE_ASSET_HELD_BY_APPLICATION"
    );
  }
}

function normalizeKyc(body = {}, customer = {}) {
  const employmentType = cleanText(body.employment_type, 80).toLowerCase().replace(/[\s-]+/g, "_");
  if (employmentType && !EMPLOYMENT_TYPES.has(employmentType)) {
    throw new PhaseOneError(400, "Choose a valid employment or business type.");
  }
  const kyc = {
    customer_name_snapshot: cleanText(body.customer_name_snapshot || customer.customer_name, 180),
    customer_phone_snapshot: nullableText(body.customer_phone_snapshot || customer.phone, 40),
    customer_email_snapshot: nullableText(body.customer_email_snapshot || customer.email, 180),
    customer_address_snapshot: nullableText(body.customer_address_snapshot || customer.address, 3000),
    id_type: nullableText(body.id_type, 80),
    id_number: nullableText(body.id_number, 150),
    date_of_birth: dateValue(body.date_of_birth, null),
    nationality: cleanText(body.nationality || "Ghana", 100),
    employment_type: employmentType || null,
    occupation: nullableText(body.occupation, 150),
    employer_business_name: nullableText(body.employer_business_name, 180),
    business_registration_number: nullableText(body.business_registration_number, 150),
    residential_address: nullableText(body.residential_address || customer.address, 3000),
    work_address: nullableText(body.work_address, 3000),
    years_at_residence: integerValue(body.years_at_residence, null, 200),
    years_in_employment_business: integerValue(body.years_in_employment_business, null, 200),
    emergency_contact_name: nullableText(body.emergency_contact_name, 180),
    emergency_contact_phone: normalizePhone(body.emergency_contact_phone),
    emergency_contact_relationship: nullableText(body.emergency_contact_relationship, 100),
    guarantor_name: nullableText(body.guarantor_name, 180),
    guarantor_phone: normalizePhone(body.guarantor_phone),
    guarantor_address: nullableText(body.guarantor_address, 3000),
    guarantor_id_type: nullableText(body.guarantor_id_type, 80),
    guarantor_id_number: nullableText(body.guarantor_id_number, 150),
    guarantor_relationship: nullableText(body.guarantor_relationship, 100),
    identity_document_url: nullableText(body.identity_document_url, 10000),
    address_evidence_url: nullableText(body.address_evidence_url, 10000),
    income_evidence_url: nullableText(body.income_evidence_url, 10000),
    bank_statement_url: nullableText(body.bank_statement_url, 10000),
    business_registration_url: nullableText(body.business_registration_url, 10000),
    guarantor_document_url: nullableText(body.guarantor_document_url, 10000),
    identity_verified: false,
    address_verified: false,
    income_verified: false,
    guarantor_verified: false,
    customer_consent_confirmed: booleanValue(body.customer_consent_confirmed, false),
    credit_assessment_consent_confirmed: booleanValue(
      body.credit_assessment_consent_confirmed,
      false
    ),
    verification_notes: nullableText(body.verification_notes, 3000),
  };
  if (
    kyc.date_of_birth === undefined ||
    kyc.years_at_residence === undefined ||
    kyc.years_in_employment_business === undefined ||
    kyc.customer_consent_confirmed === undefined ||
    kyc.credit_assessment_consent_confirmed === undefined
  ) {
    throw new PhaseOneError(400, "Check the optional KYC dates, years and consent values entered.");
  }
  return kyc;
}

function normalizeOffer(body = {}, machine, settings = {}) {
  const schedule = buildFinanceSchedule({
    selling_price: body.selling_price ?? Number(machine.target_selling_price || 0),
    deposit: body.deposit ?? 0,
    payment_frequency:
      body.payment_frequency || settings.default_payment_frequency || "monthly",
    custom_interval_days:
      body.custom_interval_days ?? body.payment_interval_days ?? body.proposed_interval_days,
    installment_count: body.installment_count ?? 12,
    first_due_date:
      body.first_due_date || addDays(today(), Number(settings.default_first_due_days || 30)),
    non_working_day_rule: body.non_working_day_rule || "exact",
  });

  if (
    Number(machine.minimum_selling_price || 0) > 0 &&
    schedule.selling_price < Number(machine.minimum_selling_price)
  ) {
    throw new PhaseOneError(
      409,
      "The selling price is below the protected minimum price for this excavator.",
      "FINANCE_OFFER_BELOW_MINIMUM_PRICE"
    );
  }

  const validityDate = dateValue(body.validity_date, addDays(today(), 14));
  if (validityDate === undefined) {
    throw new PhaseOneError(400, "Check the Installment Offer validity date.");
  }

  return {
    ...schedule,
    validity_date: validityDate,
    delivery_policy: cleanText(
      body.delivery_policy || settings.delivery_policy || "after_deposit",
      50
    ),
    delivery_threshold_percent: moneyValue(
      body.delivery_threshold_percent,
      Number(settings.delivery_threshold_percent || 0)
    ),
    terms: nullableText(body.terms || settings.agreement_terms, 30000),
    notes: nullableText(body.notes, 3000),
  };
}

function normalizeAffordability(body = {}) {
  const values = {
    monthly_salary_income: moneyValue(body.monthly_salary_income, 0),
    monthly_business_income: moneyValue(body.monthly_business_income, 0),
    monthly_other_income: moneyValue(body.monthly_other_income, 0),
    monthly_business_costs: moneyValue(body.monthly_business_costs, 0),
    monthly_household_expenses: moneyValue(body.monthly_household_expenses, 0),
    existing_monthly_debt: moneyValue(body.existing_monthly_debt, 0),
  };
  if (Object.values(values).some((value) => value === undefined)) {
    throw new PhaseOneError(400, "Check the optional affordability amounts entered.");
  }
  const provided = Object.values(values).some((value) => Number(value || 0) > 0);
  return {
    ...values,
    assessment_notes: nullableText(body.assessment_notes, 4000),
    provided,
  };
}

async function insertKyc(connection, applicationId, kyc, actorId) {
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
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?, ?
     )`,
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
      kyc.customer_consent_confirmed ? 1 : 0,
      kyc.credit_assessment_consent_confirmed ? 1 : 0,
      kyc.verification_notes,
      actorId,
      actorId,
    ]
  );
}

async function customerList(search = "") {
  const params = [];
  let searchSql = "";
  const term = cleanText(search, 120);
  if (term) {
    searchSql = "AND (customer.customer_name LIKE ? OR customer.phone LIKE ? OR customer.customer_code LIKE ? OR customer.email LIKE ?)";
    const like = `%${term}%`;
    params.push(like, like, like, like);
  }
  const [rows] = await pool.query(
    `SELECT customer.*,
            (SELECT COUNT(*) FROM equipment_credit_applications application
             WHERE application.customer_id = customer.id) AS finance_application_count,
            (SELECT COUNT(*) FROM equipment_sale_agreements agreement
             WHERE agreement.customer_id = customer.id AND agreement.sale_type = 'installment') AS finance_agreement_count,
            (SELECT COALESCE(SUM(agreement.outstanding_balance), 0)
             FROM equipment_sale_agreements agreement
             WHERE agreement.customer_id = customer.id
               AND agreement.sale_type = 'installment'
               AND agreement.agreement_status NOT IN ('completed','cancelled')) AS outstanding_balance
     FROM hire_customers customer
     WHERE customer.is_active = TRUE ${searchSql}
     ORDER BY customer.updated_at DESC, customer.customer_name ASC
     LIMIT 250`,
    params
  );
  return rows.map((row) => ({
    ...row,
    is_active: Boolean(row.is_active),
    finance_application_count: Number(row.finance_application_count || 0),
    finance_agreement_count: Number(row.finance_agreement_count || 0),
    outstanding_balance: Number(row.outstanding_balance || 0),
  }));
}

async function machinesWithEditability() {
  const machines = await listProfessionalMachines({ limit: 250 });
  if (!machines.length) return [];
  const ids = machines.map((machine) => machine.id);
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await pool.query(
    `SELECT asset.id,
            (SELECT COUNT(*) FROM equipment_credit_applications application
             WHERE application.asset_id = asset.id
               AND application.application_status IN ('draft','submitted','under_review','changes_requested','approved')) AS active_application_count,
            (SELECT COUNT(*) FROM equipment_asset_sale_locks sale_lock
             WHERE sale_lock.asset_id = asset.id AND sale_lock.released_at IS NULL) AS active_sale_lock_count,
            (SELECT application.id FROM equipment_credit_applications application
             WHERE application.asset_id = asset.id
               AND application.application_status IN ('draft','submitted','under_review','changes_requested','approved')
             ORDER BY application.updated_at DESC, application.id DESC LIMIT 1) AS blocking_application_id,
            (SELECT application.application_number FROM equipment_credit_applications application
             WHERE application.asset_id = asset.id
               AND application.application_status IN ('draft','submitted','under_review','changes_requested','approved')
             ORDER BY application.updated_at DESC, application.id DESC LIMIT 1) AS blocking_application_number,
            (SELECT agreement.id
             FROM equipment_asset_sale_locks sale_lock
             INNER JOIN equipment_sale_agreements agreement ON agreement.id = sale_lock.agreement_id
             WHERE sale_lock.asset_id = asset.id AND sale_lock.released_at IS NULL
             ORDER BY sale_lock.created_at DESC, sale_lock.id DESC LIMIT 1) AS blocking_agreement_id,
            (SELECT agreement.agreement_number
             FROM equipment_asset_sale_locks sale_lock
             INNER JOIN equipment_sale_agreements agreement ON agreement.id = sale_lock.agreement_id
             WHERE sale_lock.asset_id = asset.id AND sale_lock.released_at IS NULL
             ORDER BY sale_lock.created_at DESC, sale_lock.id DESC LIMIT 1) AS blocking_agreement_number
     FROM fleet_assets asset WHERE asset.id IN (${placeholders})`,
    ids
  );
  const counts = new Map(rows.map((row) => [Number(row.id), row]));
  return machines.map((machine) => {
    const row = counts.get(Number(machine.id)) || {};
    const activeApplications = Number(row.active_application_count || 0);
    const activeLocks = Number(row.active_sale_lock_count || 0);
    const editable =
      machine.sale_status === "available" &&
      activeApplications === 0 &&
      activeLocks === 0;
    return {
      ...machine,
      has_image: Boolean(machine.main_image_url),
      main_image_url: null,
      active_application_count: activeApplications,
      active_sale_lock_count: activeLocks,
      blocking_application_id: row.blocking_application_id || null,
      blocking_application_number: row.blocking_application_number || null,
      blocking_agreement_id: row.blocking_agreement_id || null,
      blocking_agreement_number: row.blocking_agreement_number || null,
      editability: {
        editable,
        reason: editable
          ? "This excavator has not entered an installment workflow."
          : row.blocking_application_number
            ? `Held by Finance application ${row.blocking_application_number}.`
            : row.blocking_agreement_number
              ? `Reserved by Finance agreement ${row.blocking_agreement_number}.`
              : "This excavator is linked to an active reservation, agreement or final sale status.",
      },
    };
  });
}

router.get(
  "/phase-one/bootstrap",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      await assertProfessionalSchema();
      const [customers, machines, settings] = await Promise.all([
        customerList(req.query.search),
        machinesWithEditability(),
        getProfessionalSettings(),
      ]);
      return res.json({
        status: "success",
        customers,
        machines,
        settings,
        policy: {
          scope: "company_wide",
          hire_location_id: null,
          hire_location_selection_required: false,
          installment_offer_created_automatically: true,
          exact_schedule_preview_enabled: true,
          optional_draft_kyc_and_affordability: true,
          list_contains_image_bytes: false,
        },
      });
    } catch (error) {
      return sendError(res, error, "Could not prepare the Start New Installment workspace.");
    }
  }
);

router.post(
  "/phase-one/schedule-preview",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const schedule = buildFinanceSchedule(req.body?.offer || req.body || {});
      return res.json({
        status: "success",
        message: "Exact installment dates calculated. No application or account was changed.",
        schedule,
      });
    } catch (error) {
      return sendError(res, error, "Could not calculate the installment schedule.");
    }
  }
);

router.get(
  "/phase-one/customers",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      return res.json({
        status: "success",
        customers: await customerList(req.query.search),
        policy: { scope: "company_wide", hire_location_selection_required: false },
      });
    } catch (error) {
      return sendError(res, error, "Could not load Finance customers.");
    }
  }
);

router.post(
  "/phase-one/customers",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const customer = await withTransaction(async (connection) => {
        const created = await createCustomer(
          connection,
          req.body || {},
          userId(req),
          booleanValue(req.body?.confirm_duplicate, false)
        );
        await audit(
          req,
          connection,
          "EQUIPMENT_FINANCE_CUSTOMER_CREATED",
          "finance_customer",
          created.id,
          `Created Finance customer ${created.customer_code} — ${created.customer_name}.`
        );
        return created;
      });
      return res.status(201).json({
        status: "success",
        message: "Finance customer created. You can start an installment immediately.",
        customer,
      });
    } catch (error) {
      if (error instanceof PhaseOneError && error.duplicates) {
        return res.status(error.statusCode).json({
          status: "error",
          code: error.code,
          message: error.message,
          duplicates: error.duplicates,
        });
      }
      return sendError(res, error, "Could not create the Finance customer.");
    }
  }
);

router.put(
  "/phase-one/customers/:customerId",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const customerId = positiveId(req.params.customerId);
      if (!customerId) throw new PhaseOneError(400, "Choose a valid customer.");
      const customer = normalizeCustomer(req.body || {});
      await withTransaction(async (connection) => {
        const existing = await customerRecord(connection, customerId, true);
        if (!existing) throw new PhaseOneError(404, "Finance customer was not found.");
        const duplicates = await findDuplicateCustomer(connection, customer, customerId);
        if (duplicates.length && !booleanValue(req.body?.confirm_duplicate, false)) {
          const error = new PhaseOneError(
            409,
            "Another customer already uses this phone number or name.",
            "POSSIBLE_DUPLICATE_FINANCE_CUSTOMER"
          );
          error.duplicates = duplicates;
          throw error;
        }
        await connection.query(
          `UPDATE hire_customers
           SET customer_name = ?, customer_type = ?, phone = ?, whatsapp_phone = ?,
               email = ?, address = ?, contact_person = ?, risk_notes = ?,
               is_active = ?, updated_by = ?
           WHERE id = ?`,
          [
            customer.customer_name,
            customer.customer_type,
            customer.phone,
            customer.whatsapp_phone,
            customer.email,
            customer.address,
            customer.contact_person,
            customer.risk_notes,
            customer.is_active,
            userId(req),
            customerId,
          ]
        );
        await audit(
          req,
          connection,
          "EQUIPMENT_FINANCE_CUSTOMER_UPDATED",
          "finance_customer",
          customerId,
          `Updated Finance customer ${existing.customer_code}.`
        );
      });
      return res.json({ status: "success", message: "Finance customer updated." });
    } catch (error) {
      if (error instanceof PhaseOneError && error.duplicates) {
        return res.status(error.statusCode).json({
          status: "error",
          code: error.code,
          message: error.message,
          duplicates: error.duplicates,
        });
      }
      return sendError(res, error, "Could not update the Finance customer.");
    }
  }
);

router.post(
  "/phase-one/start-installment",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      await assertProfessionalSchema();
      const actorId = userId(req);
      const assetId = positiveId(req.body?.asset_id);
      if (!assetId) throw new PhaseOneError(400, "Choose an available excavator.");
      const settings = await getProfessionalSettings();
      const applicationNumber = await documentNumber(
        "EQUIPMENT_CREDIT_APPLICATION",
        "ECAPP",
        actorId
      );
      const offerNumber = await documentNumber(
        "EQUIPMENT_SALES_QUOTATION",
        "EIO",
        actorId
      );

      const result = await withTransaction(async (connection) => {
        const machine = await financeMachine(connection, assetId);
        assertMachineAvailable(machine);

        let customer;
        const requestedCustomerId = positiveId(req.body?.customer_id);
        if (requestedCustomerId) {
          customer = await customerRecord(connection, requestedCustomerId, true);
          if (!customer) throw new PhaseOneError(404, "The selected Finance customer was not found.");
        } else {
          customer = await createCustomer(
            connection,
            req.body?.customer || {},
            actorId,
            booleanValue(req.body?.confirm_duplicate_customer, false)
          );
        }

        const offer = normalizeOffer(req.body?.offer || {}, machine, settings);
        const kyc = normalizeKyc(req.body?.kyc || {}, customer);
        const affordability = normalizeAffordability(req.body?.affordability || {});
        const assessmentInput = {
          quoted_total: offer.selling_price,
          proposed_deposit: offer.deposit,
          proposed_frequency: offer.payment_frequency,
          proposed_interval_days: offer.custom_interval_days,
          proposed_installment_count: offer.installment_count,
          ...affordability,
        };
        const calculatedAssessment = evaluateCreditApplication(assessmentInput, kyc);
        const assessment = affordability.provided
          ? calculatedAssessment
          : {
              ...calculatedAssessment,
              affordability_status: "not_assessed",
              risk_score: Math.min(Number(calculatedAssessment.risk_score || 0), 50),
              risk_band: "medium",
              assessment_recommendation:
                "Draft created. Complete customer affordability before submitting this application for approval.",
              reasons: [],
              warnings: ["Affordability information has not been completed yet."],
            };
        const periodicAmount = offer.periodic_amount;
        const monthlyAmount = monthlyEquivalent(
          periodicAmount,
          offer.payment_frequency,
          offer.custom_interval_days
        );

        const [quotationInsert] = await connection.query(
          `INSERT INTO equipment_sales_quotations SET ?`,
          {
            quotation_number: offerNumber,
            hire_location_id: null,
            enquiry_id: null,
            customer_id: customer.id,
            quotation_date: today(),
            validity_date: offer.validity_date,
            status: "approved",
            subtotal: offer.selling_price,
            discount_amount: 0,
            tax_rate_percent: 0,
            tax_amount: 0,
            total_amount: offer.selling_price,
            deposit_required: offer.deposit,
            proposed_frequency: offer.payment_frequency,
            proposed_interval_days: offer.custom_interval_days,
            proposed_non_working_day_rule: offer.non_working_day_rule,
            proposed_installment_count: offer.installment_count,
            proposed_first_due_date: offer.first_due_date,
            delivery_policy: offer.delivery_policy,
            delivery_threshold_percent: offer.delivery_threshold_percent,
            terms: offer.terms,
            notes: offer.notes,
            approval_reason:
              "Automatically approved as the commercial Installment Offer inside Start New Installment.",
            created_by: actorId,
            approved_by: actorId,
            approved_at: new Date(),
          }
        );

        const [itemInsert] = await connection.query(
          `INSERT INTO equipment_sales_quotation_items SET ?`,
          {
            quotation_id: quotationInsert.insertId,
            hire_location_id: null,
            line_number: 1,
            asset_id: machine.id,
            asset_code_snapshot: machine.asset_code,
            asset_name_snapshot: machine.asset_name,
            asset_type_snapshot: machine.asset_type,
            make_snapshot: machine.make,
            model_snapshot: machine.model,
            model_year_snapshot: machine.model_year,
            serial_number_snapshot: machine.serial_number,
            main_image_url_snapshot: machine.main_image_url,
            description:
              `${machine.make || ""} ${machine.model || ""}`.trim() || machine.asset_name,
            quantity: 1,
            unit_price: offer.selling_price,
            discount_amount: 0,
            tax_amount: 0,
            line_total: offer.selling_price,
          }
        );

        const consentAt = kyc.customer_consent_confirmed ? new Date() : null;
        const [applicationInsert] = await connection.query(
          `INSERT INTO equipment_credit_applications SET ?`,
          {
            application_number: applicationNumber,
            hire_location_id: null,
            customer_id: customer.id,
            enquiry_id: null,
            quotation_id: quotationInsert.insertId,
            asset_id: machine.id,
            application_date: today(),
            application_status: "draft",
            kyc_status: assessment.kyc_status,
            affordability_status: assessment.affordability_status,
            risk_band: assessment.risk_band,
            risk_score: assessment.risk_score,
            quoted_total: assessment.quoted_total,
            proposed_deposit: assessment.proposed_deposit,
            financed_amount: assessment.financed_amount,
            proposed_frequency: offer.payment_frequency,
            proposed_interval_days: offer.custom_interval_days,
            proposed_non_working_day_rule: offer.non_working_day_rule,
            proposed_installment_count: offer.installment_count,
            proposed_installment_amount: monthlyAmount,
            proposed_periodic_amount: periodicAmount,
            monthly_salary_income: assessment.monthly_salary_income,
            monthly_business_income: assessment.monthly_business_income,
            monthly_other_income: assessment.monthly_other_income,
            monthly_business_costs: assessment.monthly_business_costs,
            monthly_household_expenses: assessment.monthly_household_expenses,
            existing_monthly_debt: assessment.existing_monthly_debt,
            total_monthly_income: assessment.total_monthly_income,
            total_monthly_commitments: assessment.total_monthly_commitments,
            net_monthly_surplus: assessment.net_monthly_surplus,
            debt_service_ratio_percent: assessment.debt_service_ratio_percent,
            total_commitment_ratio_percent: assessment.total_commitment_ratio_percent,
            deposit_ratio_percent: assessment.deposit_ratio_percent,
            assessment_recommendation: assessment.assessment_recommendation,
            assessment_notes: affordability.assessment_notes,
            customer_consent_at: consentAt,
            decision_version: 1,
            created_by: actorId,
            updated_by: actorId,
          }
        );

        await insertKyc(connection, applicationInsert.insertId, kyc, actorId);
        await connection.query(
          `INSERT INTO equipment_credit_application_decisions SET ?`,
          {
            application_id: applicationInsert.insertId,
            decision_version: 1,
            action_type: "created",
            from_status: null,
            to_status: "draft",
            affordability_status: assessment.affordability_status,
            risk_band: assessment.risk_band,
            risk_score: assessment.risk_score,
            debt_service_ratio_percent: assessment.debt_service_ratio_percent,
            net_monthly_surplus: assessment.net_monthly_surplus,
            notes:
              "Created through the company-wide guided Start New Installment workflow. Optional KYC and affordability may be completed before submission.",
            snapshot_json: JSON.stringify({
              installment_offer_number: offerNumber,
              quotation_item_id: itemInsert.insertId,
              machine: { id: machine.id, code: machine.asset_code, name: machine.asset_name },
              exact_schedule: offer.schedule,
              assessment,
            }),
            decided_by: actorId,
          }
        );

        await audit(
          req,
          connection,
          "EQUIPMENT_FINANCE_INSTALLMENT_STARTED",
          "equipment_credit_application",
          applicationInsert.insertId,
          `Started ${applicationNumber} for ${customer.customer_name} and ${machine.asset_code}.`,
          {
            customer_id: customer.id,
            asset_id: machine.id,
            automatic_installment_offer_id: quotationInsert.insertId,
            automatic_installment_offer_number: offerNumber,
            quoted_total: assessment.quoted_total,
            financed_amount: assessment.financed_amount,
            payment_frequency: offer.payment_frequency,
            payment_interval_days: offer.custom_interval_days,
            first_due_date: offer.first_due_date,
            final_due_date: offer.final_due_date,
            optional_assessment_outstanding: !affordability.provided,
          }
        );

        return {
          customer: {
            id: customer.id,
            customer_code: customer.customer_code,
            customer_name: customer.customer_name,
          },
          installment_offer: {
            id: quotationInsert.insertId,
            number: offerNumber,
            status: "approved",
            created_automatically: true,
            exact_schedule: offer.schedule,
          },
          application: {
            id: applicationInsert.insertId,
            application_number: applicationNumber,
            application_status: "draft",
            kyc_status: assessment.kyc_status,
            affordability_status: assessment.affordability_status,
            risk_band: assessment.risk_band,
            risk_score: assessment.risk_score,
          },
          next_path: `/equipment-installment-finance/applications?application=${applicationInsert.insertId}`,
        };
      });

      return res.status(201).json({
        status: "success",
        message:
          "Installment Offer and draft credit application created. Complete any missing KYC or affordability before submission for approval.",
        ...result,
      });
    } catch (error) {
      if (error instanceof PhaseOneError && error.duplicates) {
        return res.status(error.statusCode).json({
          status: "error",
          code: error.code,
          message: error.message,
          duplicates: error.duplicates,
        });
      }
      return sendError(res, error, "Could not start the new installment.");
    }
  }
);

module.exports = router;
module.exports.PhaseOneError = PhaseOneError;
module.exports.normalizeAffordability = normalizeAffordability;
module.exports.normalizeKyc = normalizeKyc;
module.exports.normalizeOffer = normalizeOffer;
