const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { evaluateCreditApplication } = require("../services/equipmentCreditApplicationPolicy");
const {
  buildFinanceSchedule,
  FinanceScheduleError,
  monthlyEquivalent,
} = require("../services/equipmentFinanceScheduleService");

const router = express.Router();

const ACTIVE_APPLICATION_STATUSES = Object.freeze([
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
]);
const FILTER_STATUSES = new Set([
  ...ACTIVE_APPLICATION_STATUSES,
  "declined",
  "withdrawn",
]);
const PAYMENT_FREQUENCIES = new Set(["weekly", "fortnightly", "monthly", "custom"]);
const NON_WORKING_DAY_RULES = new Set(["exact", "next_weekday", "previous_weekday"]);
const EDITABLE_STATUSES = new Set(["draft", "changes_requested"]);
const WITHDRAWABLE_STATUSES = new Set(["draft", "changes_requested", "submitted"]);
const KYC_TEXT_FIELDS = Object.freeze([
  "customer_name_snapshot",
  "customer_phone_snapshot",
  "customer_email_snapshot",
  "customer_address_snapshot",
  "id_type",
  "id_number",
  "date_of_birth",
  "nationality",
  "employment_type",
  "occupation",
  "employer_business_name",
  "business_registration_number",
  "residential_address",
  "work_address",
  "years_at_residence",
  "years_in_employment_business",
  "emergency_contact_name",
  "emergency_contact_phone",
  "emergency_contact_relationship",
  "guarantor_name",
  "guarantor_phone",
  "guarantor_address",
  "guarantor_id_type",
  "guarantor_id_number",
  "guarantor_relationship",
  "verification_notes",
]);
const KYC_BOOLEAN_FIELDS = Object.freeze([
  "customer_consent_confirmed",
  "credit_assessment_consent_confirmed",
]);
const AFFORDABILITY_FIELDS = Object.freeze([
  "monthly_salary_income",
  "monthly_business_income",
  "monthly_other_income",
  "monthly_business_costs",
  "monthly_household_expenses",
  "existing_monthly_debt",
]);

class FinanceDraftError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_FINANCE_DRAFT_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanText(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function nullableText(value, maximum = 500) {
  return cleanText(value, maximum) || null;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function integer(value, fallback, maximum = 520) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= maximum
    ? number
    : undefined;
}

function money(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(number) && number >= 0
    ? Number(number.toFixed(2))
    : undefined;
}

function dateOnly(value, fallback = null) {
  const text = cleanText(value, 20);
  if (!text) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  return Number.isNaN(new Date(`${text}T00:00:00Z`).getTime()) ? undefined : text;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if ([true, 1, "1", "true", "yes", "on"].includes(value)) return true;
  if ([false, 0, "0", "false", "no", "off"].includes(value)) return false;
  return undefined;
}

function userId(req) {
  return positiveId(req.user?.id);
}

function sendError(res, error, fallback) {
  if (error instanceof FinanceDraftError || error instanceof FinanceScheduleError) {
    return res.status(Number(error.statusCode || 400)).json({
      status: "error",
      code: error.code,
      message: error.message,
      ...(error.current_application
        ? { current_application: error.current_application }
        : {}),
    });
  }
  if (["ER_BAD_FIELD_ERROR", "ER_NO_SUCH_TABLE"].includes(error?.code)) {
    return res.status(503).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_SCHEMA_NOT_READY",
      message: "The Finance application register is not ready yet.",
    });
  }
  console.error(fallback, error);
  return res.status(500).json({
    status: "error",
    code: "EQUIPMENT_FINANCE_DRAFT_FAILED",
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
    severity: "notice",
    outcome: "success",
    details,
    metadata: {
      finance_scope: "company_wide",
      application_number: application.application_number,
      asset_id: application.asset_id,
      ...metadata,
    },
  });
}

function normalizePage(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(10, Number.parseInt(query.page_size || query.limit, 10) || 25)
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function listWhere(query = {}) {
  const where = [];
  const params = [];
  const status = cleanText(query.status, 40).toLowerCase();
  if (status && status !== "all") {
    if (!FILTER_STATUSES.has(status)) {
      throw new FinanceDraftError(400, "Choose a valid application status.");
    }
    where.push("application.application_status = ?");
    params.push(status);
  }
  const search = cleanText(query.search, 120);
  if (search) {
    const term = `%${search}%`;
    where.push(`(
      application.application_number LIKE ?
      OR customer.customer_name LIKE ?
      OR customer.phone LIKE ?
      OR quotation.quotation_number LIKE ?
      OR asset.asset_code LIKE ?
      OR asset.asset_name LIKE ?
      OR asset.serial_number LIKE ?
    )`);
    params.push(term, term, term, term, term, term, term);
  }
  const dateFrom = dateOnly(query.date_from, null);
  const dateTo = dateOnly(query.date_to, null);
  if (query.date_from && dateFrom === undefined) {
    throw new FinanceDraftError(400, "Choose a valid From date.");
  }
  if (query.date_to && dateTo === undefined) {
    throw new FinanceDraftError(400, "Choose a valid To date.");
  }
  if (dateFrom) {
    where.push("application.application_date >= ?");
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push("application.application_date <= ?");
    params.push(dateTo);
  }
  return {
    sql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

const LIST_JOINS = `
  INNER JOIN hire_customers customer ON customer.id = application.customer_id
  INNER JOIN equipment_sales_quotations quotation ON quotation.id = application.quotation_id
  INNER JOIN fleet_assets asset ON asset.id = application.asset_id
  LEFT JOIN equipment_credit_application_kyc kyc ON kyc.application_id = application.id
  LEFT JOIN equipment_sale_agreements agreement
    ON agreement.credit_application_id = application.id
  LEFT JOIN business_locations origin
    ON origin.id = asset.hire_location_id
`;

async function listApplications(query = {}) {
  const { page, pageSize, offset } = normalizePage(query);
  const filter = listWhere(query);
  const [[countRow], [rows], [summaryRows]] = await Promise.all([
    pool.query(
      `SELECT COUNT(DISTINCT application.id) AS total
       FROM equipment_credit_applications application
       ${LIST_JOINS}
       ${filter.sql}`,
      filter.params
    ),
    pool.query(
      `SELECT
         application.id,
         application.application_number,
         application.application_date,
         application.application_status,
         application.kyc_status,
         application.affordability_status,
         application.risk_band,
         application.risk_score,
         application.quoted_total,
         application.proposed_deposit,
         application.financed_amount,
         application.proposed_frequency,
         application.proposed_interval_days,
         application.proposed_installment_count,
         application.proposed_installment_amount,
         application.net_monthly_surplus,
         application.decision_version,
         application.created_at,
         application.updated_at,
         customer.id AS customer_id,
         COALESCE(kyc.customer_name_snapshot, customer.customer_name) AS customer_name,
         COALESCE(kyc.customer_phone_snapshot, customer.phone) AS customer_phone,
         quotation.id AS quotation_id,
         quotation.quotation_number,
         quotation.proposed_first_due_date,
         asset.id AS asset_id,
         asset.asset_code,
         asset.asset_name,
         asset.make,
         asset.model,
         asset.serial_number,
         origin.name AS equipment_origin_name,
         CASE WHEN COALESCE(asset.main_image_url, '') <> '' THEN 1 ELSE 0 END AS has_image,
         agreement.id AS agreement_id,
         agreement.agreement_number,
         agreement.agreement_status
       FROM equipment_credit_applications application
       ${LIST_JOINS}
       ${filter.sql}
       ORDER BY application.updated_at DESC, application.id DESC
       LIMIT ? OFFSET ?`,
      [...filter.params, pageSize, offset]
    ),
    pool.query(
      `SELECT
         SUM(application.application_status IN ('draft','changes_requested')) AS drafts,
         SUM(application.application_status IN ('submitted','under_review')) AS awaiting_review,
         SUM(application.application_status = 'approved') AS approved,
         COALESCE(SUM(
           CASE WHEN application.application_status IN ('draft','submitted','under_review','changes_requested','approved')
             THEN application.financed_amount ELSE 0 END
         ), 0) AS proposed_exposure
       FROM equipment_credit_applications application`
    ),
  ]);
  const total = Number(countRow[0]?.total || 0);
  return {
    applications: rows,
    pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
      has_next_page: offset + rows.length < total,
      has_previous_page: page > 1,
    },
    summary: summaryRows[0] || {},
    policy: {
      scope: "company_wide",
      hire_location_selection_required: false,
      list_contains_image_bytes: false,
      detail_loaded_separately: true,
    },
  };
}

async function loadApplication(connection, applicationId, { lock = false } = {}) {
  const [rows] = await connection.query(
    `SELECT application.*, quotation.status AS quotation_status,
            quotation.total_amount AS quotation_total,
            quotation.deposit_required AS quotation_deposit,
            quotation.proposed_first_due_date,
            quotation.proposed_interval_days AS quotation_interval_days,
            quotation.proposed_non_working_day_rule,
            quotation.terms AS quotation_terms,
            quotation.notes AS quotation_notes,
            customer.customer_code, customer.customer_name, customer.phone AS customer_phone,
            customer.email AS customer_email, customer.address AS customer_address,
            asset.asset_code, asset.asset_name, asset.asset_type, asset.make, asset.model,
            asset.model_year, asset.serial_number, asset.chassis_number,
            asset.main_image_url, asset.hire_location_id AS equipment_origin_location_id,
            origin.name AS equipment_origin_name,
            agreement.id AS agreement_id, agreement.agreement_number,
            agreement.agreement_status, agreement.equipment_commitment_status
     FROM equipment_credit_applications application
     INNER JOIN equipment_sales_quotations quotation ON quotation.id = application.quotation_id
     INNER JOIN hire_customers customer ON customer.id = application.customer_id
     INNER JOIN fleet_assets asset ON asset.id = application.asset_id
     LEFT JOIN business_locations origin ON origin.id = asset.hire_location_id
     LEFT JOIN equipment_sale_agreements agreement
       ON agreement.credit_application_id = application.id
     WHERE application.id = ?
     LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [applicationId]
  );
  return rows[0] || null;
}

async function applicationDetail(connection, applicationId) {
  const application = await loadApplication(connection, applicationId);
  if (!application) {
    throw new FinanceDraftError(404, "Installment application was not found.");
  }
  const [kycRows, decisionRows, lockRows] = await Promise.all([
    connection.query(
      `SELECT * FROM equipment_credit_application_kyc
       WHERE application_id = ? LIMIT 1`,
      [applicationId]
    ),
    connection.query(
      `SELECT decision.*, user.name AS decided_by_name
       FROM equipment_credit_application_decisions decision
       LEFT JOIN users user ON user.id = decision.decided_by
       WHERE decision.application_id = ?
       ORDER BY decision.decision_version DESC, decision.id DESC
       LIMIT 100`,
      [applicationId]
    ),
    connection.query(
      `SELECT sale_lock.id, sale_lock.lock_status, sale_lock.agreement_id,
              agreement.agreement_number, sale_lock.created_at, sale_lock.released_at
       FROM equipment_asset_sale_locks sale_lock
       LEFT JOIN equipment_sale_agreements agreement ON agreement.id = sale_lock.agreement_id
       WHERE sale_lock.asset_id = ? AND sale_lock.released_at IS NULL
       ORDER BY sale_lock.created_at DESC, sale_lock.id DESC`,
      [application.asset_id]
    ),
  ]);
  const hasImage = Boolean(application.main_image_url);
  return {
    application: {
      ...application,
      hire_location_id: null,
      has_image: hasImage,
      main_image_url: null,
      image_path: hasImage ? `/equipment-catalogue/sales/credit-applications/${application.id}/image` : null,
    },
    kyc: kycRows[0][0] || null,
    decisions: decisionRows[0],
    active_asset_locks: lockRows[0],
    editable: EDITABLE_STATUSES.has(application.application_status),
    withdrawable: WITHDRAWABLE_STATUSES.has(application.application_status),
    policy: {
      scope: "company_wide",
      hire_location_selection_required: false,
      equipment_origin_is_metadata_only: true,
    },
  };
}

function affordabilityInput(body = {}, current = {}) {
  const values = {};
  for (const field of AFFORDABILITY_FIELDS) {
    const value = money(body[field], Number(current[field] || 0));
    if (value === undefined) {
      throw new FinanceDraftError(400, "Check the affordability amounts entered.");
    }
    values[field] = value;
  }
  return values;
}

function kycUpdate(body = {}, current = {}) {
  const update = {};
  for (const field of KYC_TEXT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    if (field === "date_of_birth") {
      const value = dateOnly(body[field], null);
      if (value === undefined) {
        throw new FinanceDraftError(400, "Check the customer date of birth.");
      }
      update[field] = value;
    } else if (["years_at_residence", "years_in_employment_business"].includes(field)) {
      const value =
        body[field] === "" || body[field] === null || body[field] === undefined
          ? null
          : Number(body[field]);
      if (value !== null && (!Number.isInteger(value) || value < 0 || value > 200)) {
        throw new FinanceDraftError(400, "Check the customer profile years entered.");
      }
      update[field] = value;
    } else {
      update[field] = nullableText(body[field], field === "verification_notes" ? 3000 : 1000);
    }
  }
  for (const field of KYC_BOOLEAN_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const value = booleanValue(body[field], Boolean(current[field]));
    if (value === undefined) {
      throw new FinanceDraftError(400, "Check the optional consent values entered.");
    }
    update[field] = value ? 1 : 0;
  }
  return update;
}

function offerInput(body = {}, application = {}) {
  const sellingPrice = money(body.selling_price, Number(application.quoted_total || 0));
  const deposit = money(body.deposit, Number(application.proposed_deposit || 0));
  const frequency = cleanText(
    body.payment_frequency || application.proposed_frequency || "monthly",
    30
  ).toLowerCase();
  const intervalDays = integer(
    body.custom_interval_days ?? body.payment_interval_days,
    Number(application.proposed_interval_days || 30),
    365
  );
  const installmentCount = integer(
    body.installment_count,
    Number(application.proposed_installment_count || 12),
    520
  );
  const firstDueDate = dateOnly(
    body.first_due_date,
    application.proposed_first_due_date
  );
  const nonWorkingDayRule = cleanText(
    body.non_working_day_rule ||
      application.proposed_non_working_day_rule ||
      "exact",
    40
  ).toLowerCase();

  if (sellingPrice === undefined || sellingPrice <= 0) {
    throw new FinanceDraftError(400, "Enter a valid selling price.");
  }
  if (deposit === undefined || deposit > sellingPrice) {
    throw new FinanceDraftError(400, "Enter a deposit between zero and the selling price.");
  }
  if (!PAYMENT_FREQUENCIES.has(frequency)) {
    throw new FinanceDraftError(400, "Choose a valid payment frequency.");
  }
  if (intervalDays === undefined || installmentCount === undefined) {
    throw new FinanceDraftError(400, "Check the payment interval and installment count.");
  }
  if (firstDueDate === undefined || !firstDueDate) {
    throw new FinanceDraftError(400, "Choose a valid first payment date.");
  }
  if (!NON_WORKING_DAY_RULES.has(nonWorkingDayRule)) {
    throw new FinanceDraftError(400, "Choose a valid non-working-day rule.");
  }

  const schedule = buildFinanceSchedule({
    selling_price: sellingPrice,
    deposit,
    payment_frequency: frequency,
    custom_interval_days: intervalDays,
    installment_count: installmentCount,
    first_due_date: firstDueDate,
    non_working_day_rule: nonWorkingDayRule,
  });

  return {
    sellingPrice,
    deposit,
    frequency,
    intervalDays,
    installmentCount,
    firstDueDate,
    nonWorkingDayRule,
    schedule,
    terms: Object.prototype.hasOwnProperty.call(body, "terms")
      ? nullableText(body.terms, 30000)
      : application.quotation_terms,
    notes: Object.prototype.hasOwnProperty.call(body, "notes")
      ? nullableText(body.notes, 3000)
      : application.quotation_notes,
  };
}

router.get("/readiness", (_req, _res, next) => next());

router.get("/", requirePermission("fleet.assets.view"), async (req, res) => {
  try {
    return res.json({ status: "success", ...(await listApplications(req.query)) });
  } catch (error) {
    return sendError(res, error, "Could not load Finance applications.");
  }
});

router.get(
  "/:id/image",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const applicationId = positiveId(req.params.id);
      if (!applicationId) {
        throw new FinanceDraftError(400, "Choose a valid installment application.");
      }
      const [rows] = await pool.query(
        `SELECT asset.main_image_url
         FROM equipment_credit_applications application
         INNER JOIN fleet_assets asset ON asset.id = application.asset_id
         WHERE application.id = ? LIMIT 1`,
        [applicationId]
      );
      const value = String(rows[0]?.main_image_url || "");
      const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
      if (!match) {
        return res.status(404).json({
          status: "error",
          code: "FINANCE_APPLICATION_IMAGE_NOT_FOUND",
          message: "No protected excavator image is stored for this application.",
        });
      }
      const buffer = Buffer.from(match[2], "base64");
      res.setHeader("Content-Type", match[1].toLowerCase());
      res.setHeader("Content-Length", String(buffer.length));
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.send(buffer);
    } catch (error) {
      return sendError(res, error, "Could not load the excavator image.");
    }
  }
);

router.get("/:id", requirePermission("fleet.assets.view"), async (req, res) => {
  try {
    const applicationId = positiveId(req.params.id);
    if (!applicationId) {
      throw new FinanceDraftError(400, "Choose a valid installment application.");
    }
    return res.json({
      status: "success",
      ...(await applicationDetail(pool, applicationId)),
    });
  } catch (error) {
    return sendError(res, error, "Could not open the Finance application.");
  }
});

router.put("/:id", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    const applicationId = positiveId(req.params.id);
    if (!applicationId) {
      throw new FinanceDraftError(400, "Choose a valid installment application.");
    }
    const result = await withTransaction(async (connection) => {
      const application = await loadApplication(connection, applicationId, { lock: true });
      if (!application) {
        throw new FinanceDraftError(404, "Installment application was not found.");
      }
      if (!EDITABLE_STATUSES.has(application.application_status)) {
        throw new FinanceDraftError(
          409,
          "Only a draft or changes-requested application can be edited.",
          "FINANCE_APPLICATION_NOT_EDITABLE"
        );
      }
      const knownVersion = Number(req.body?.known_version);
      if (
        Number.isInteger(knownVersion) &&
        knownVersion >= 0 &&
        knownVersion !== Number(application.decision_version || 0)
      ) {
        const conflict = new FinanceDraftError(
          409,
          "This draft changed after it was opened. Reload it before saving.",
          "FINANCE_APPLICATION_VERSION_CONFLICT"
        );
        conflict.current_application = {
          id: application.id,
          decision_version: application.decision_version,
          updated_at: application.updated_at,
        };
        throw conflict;
      }

      const [kycRows] = await connection.query(
        "SELECT * FROM equipment_credit_application_kyc WHERE application_id = ? LIMIT 1 FOR UPDATE",
        [application.id]
      );
      const currentKyc = kycRows[0] || {};
      const kyc = kycUpdate(req.body?.kyc || {}, currentKyc);
      const affordability = affordabilityInput(
        req.body?.affordability || {},
        application
      );
      const offer = offerInput(req.body?.offer || {}, application);
      const periodicAmount = offer.schedule.periodic_amount;
      const monthlyAmount = monthlyEquivalent(
        periodicAmount,
        offer.frequency,
        offer.intervalDays
      );
      const assessmentInput = {
        quoted_total: offer.sellingPrice,
        proposed_deposit: offer.deposit,
        proposed_frequency: offer.frequency,
        proposed_interval_days: offer.intervalDays,
        proposed_installment_count: offer.installmentCount,
        ...affordability,
      };
      const currentSnapshot = { ...currentKyc, ...kyc };
      const hasAffordability = Object.values(affordability).some(
        (value) => Number(value || 0) > 0
      );
      const calculated = evaluateCreditApplication(assessmentInput, currentSnapshot);
      const assessment = hasAffordability
        ? calculated
        : {
            ...calculated,
            affordability_status: "not_assessed",
            assessment_recommendation:
              "Affordability details are optional and have not been recorded. This does not block submission or approval.",
          };
      const nextVersion = Number(application.decision_version || 0) + 1;

      await connection.query(
        `UPDATE equipment_sales_quotations
         SET total_amount = ?, subtotal = ?, deposit_required = ?,
             proposed_frequency = ?, proposed_interval_days = ?,
             proposed_non_working_day_rule = ?, proposed_installment_count = ?,
             proposed_first_due_date = ?, terms = ?, notes = ?
         WHERE id = ?`,
        [
          offer.sellingPrice,
          offer.sellingPrice,
          offer.deposit,
          offer.frequency,
          offer.intervalDays,
          offer.nonWorkingDayRule,
          offer.installmentCount,
          offer.firstDueDate,
          offer.terms,
          offer.notes,
          application.quotation_id,
        ]
      );
      await connection.query(
        `UPDATE equipment_sales_quotation_items
         SET unit_price = ?, line_total = ?
         WHERE quotation_id = ? AND asset_id = ?`,
        [
          offer.sellingPrice,
          offer.sellingPrice,
          application.quotation_id,
          application.asset_id,
        ]
      );
      await connection.query(
        `UPDATE equipment_credit_applications
         SET hire_location_id = NULL,
             quoted_total = ?, proposed_deposit = ?, financed_amount = ?,
             proposed_frequency = ?, proposed_interval_days = ?,
             proposed_non_working_day_rule = ?, proposed_installment_count = ?,
             proposed_installment_amount = ?, proposed_periodic_amount = ?,
             monthly_salary_income = ?, monthly_business_income = ?,
             monthly_other_income = ?, monthly_business_costs = ?,
             monthly_household_expenses = ?, existing_monthly_debt = ?,
             total_monthly_income = ?, total_monthly_commitments = ?,
             net_monthly_surplus = ?, debt_service_ratio_percent = ?,
             total_commitment_ratio_percent = ?, deposit_ratio_percent = ?,
             affordability_status = ?, risk_band = ?, risk_score = ?,
             assessment_recommendation = ?, decision_version = ?, updated_by = ?
         WHERE id = ?`,
        [
          offer.sellingPrice,
          offer.deposit,
          offer.schedule.financed_amount,
          offer.frequency,
          offer.intervalDays,
          offer.nonWorkingDayRule,
          offer.installmentCount,
          monthlyAmount,
          periodicAmount,
          affordability.monthly_salary_income,
          affordability.monthly_business_income,
          affordability.monthly_other_income,
          affordability.monthly_business_costs,
          affordability.monthly_household_expenses,
          affordability.existing_monthly_debt,
          assessment.total_monthly_income,
          assessment.total_monthly_commitments,
          assessment.net_monthly_surplus,
          assessment.debt_service_ratio_percent,
          assessment.total_commitment_ratio_percent,
          assessment.deposit_ratio_percent,
          assessment.affordability_status,
          assessment.risk_band,
          assessment.risk_score,
          assessment.assessment_recommendation,
          nextVersion,
          userId(req),
          application.id,
        ]
      );
      if (Object.keys(kyc).length) {
        await connection.query(
          "UPDATE equipment_credit_application_kyc SET ?, updated_by = ? WHERE application_id = ?",
          [kyc, userId(req), application.id]
        );
      }
      await connection.query(
        `INSERT INTO equipment_credit_application_decisions (
           application_id, decision_version, action_type, from_status, to_status,
           affordability_status, risk_band, risk_score,
           debt_service_ratio_percent, net_monthly_surplus,
           notes, snapshot_json, decided_by
         ) VALUES (?, ?, 'updated', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          application.id,
          nextVersion,
          application.application_status,
          application.application_status,
          assessment.affordability_status,
          assessment.risk_band,
          assessment.risk_score,
          assessment.debt_service_ratio_percent,
          assessment.net_monthly_surplus,
          nullableText(req.body?.notes, 2000) || "Draft details saved.",
          JSON.stringify({
            exact_schedule: offer.schedule,
            optional_customer_information: true,
            finance_scope: "company_wide",
          }),
          userId(req),
        ]
      );
      await audit(
        req,
        connection,
        "EQUIPMENT_FINANCE_DRAFT_SAVED",
        application,
        `Saved draft ${application.application_number} without creating a duplicate application.`,
        { decision_version: nextVersion }
      );
      return { id: application.id, decision_version: nextVersion };
    });

    return res.json({
      status: "success",
      message: "Draft saved. The same application can be resumed later.",
      ...(await applicationDetail(pool, result.id)),
    });
  } catch (error) {
    return sendError(res, error, "Could not save the Finance draft.");
  }
});

async function withdraw(req, res, action) {
  try {
    const applicationId = positiveId(req.params.id);
    if (!applicationId) {
      throw new FinanceDraftError(400, "Choose a valid installment application.");
    }
    await withTransaction(async (connection) => {
      const application = await loadApplication(connection, applicationId, { lock: true });
      if (!application) {
        throw new FinanceDraftError(404, "Installment application was not found.");
      }
      if (!WITHDRAWABLE_STATUSES.has(application.application_status)) {
        throw new FinanceDraftError(
          409,
          "Only a draft, changes-requested or submitted application can be withdrawn.",
          "FINANCE_APPLICATION_NOT_WITHDRAWABLE"
        );
      }
      if (action === "cancel" && !EDITABLE_STATUSES.has(application.application_status)) {
        throw new FinanceDraftError(
          409,
          "Cancel Draft is available only before submission.",
          "FINANCE_APPLICATION_NOT_CANCELLABLE"
        );
      }
      const fromStatus = application.application_status;
      const nextVersion = Number(application.decision_version || 0) + 1;
      const reason =
        nullableText(req.body?.reason, 1500) ||
        (action === "cancel" ? "Draft cancelled by authorised staff." : "Application withdrawn by authorised staff.");
      await connection.query(
        `UPDATE equipment_credit_applications
         SET application_status = 'withdrawn', decision_reason = ?,
             decision_version = ?, updated_by = ?
         WHERE id = ?`,
        [reason, nextVersion, userId(req), application.id]
      );
      await connection.query(
        `INSERT INTO equipment_credit_application_decisions (
           application_id, decision_version, action_type, from_status, to_status,
           affordability_status, risk_band, risk_score,
           debt_service_ratio_percent, net_monthly_surplus,
           notes, snapshot_json, decided_by
         ) VALUES (?, ?, 'withdrawn', ?, 'withdrawn', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          application.id,
          nextVersion,
          fromStatus,
          application.affordability_status,
          application.risk_band,
          application.risk_score,
          application.debt_service_ratio_percent,
          application.net_monthly_surplus,
          reason,
          JSON.stringify({
            requested_action: action,
            asset_lock_released_by_inactive_status: true,
            finance_scope: "company_wide",
          }),
          userId(req),
        ]
      );
      await audit(
        req,
        connection,
        action === "cancel"
          ? "EQUIPMENT_FINANCE_DRAFT_CANCELLED"
          : "EQUIPMENT_FINANCE_APPLICATION_WITHDRAWN",
        application,
        `${action === "cancel" ? "Cancelled draft" : "Withdrew application"} ${application.application_number}; the excavator is no longer blocked by this application.`,
        { from_status: fromStatus, to_status: "withdrawn", reason }
      );
    });
    return res.json({
      status: "success",
      message:
        action === "cancel"
          ? "Draft cancelled. The excavator is available to Finance again."
          : "Application withdrawn. The excavator lock was released.",
    });
  } catch (error) {
    return sendError(res, error, "Could not update the Finance application.");
  }
}

router.post("/:id/withdraw", requirePermission("fleet.assets.manage"), (req, res) =>
  withdraw(req, res, "withdraw")
);
router.post("/:id/cancel", requirePermission("fleet.assets.manage"), (req, res) =>
  withdraw(req, res, "cancel")
);

module.exports = router;
module.exports.ACTIVE_APPLICATION_STATUSES = ACTIVE_APPLICATION_STATUSES;
module.exports.listApplications = listApplications;
