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
const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const STATUSES = new Set([
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
  "declined",
  "withdrawn",
]);
const REVIEWER_ROLES = new Set([
  "admin",
  "administrator",
  "manager",
  "system_admin",
  "system_administrator",
  "super_admin",
  "finance_manager",
  "equipment_business_manager",
]);
const REVIEW_TRANSITIONS = Object.freeze({
  start_review: { from: new Set(["submitted"]), to: "under_review", action: "review_started" },
  request_changes: {
    from: new Set(["submitted", "under_review"]),
    to: "changes_requested",
    action: "changes_requested",
  },
  approve: {
    from: new Set(["submitted", "under_review"]),
    to: "approved",
    action: "approved",
  },
  decline: {
    from: new Set(["submitted", "under_review"]),
    to: "declined",
    action: "declined",
  },
});
const REQUIRED_SCHEMA = Object.freeze({
  equipment_credit_applications: [
    "id",
    "application_number",
    "customer_id",
    "quotation_id",
    "asset_id",
    "application_date",
    "application_status",
    "kyc_status",
    "affordability_status",
    "risk_band",
    "risk_score",
    "quoted_total",
    "proposed_deposit",
    "financed_amount",
    "proposed_frequency",
    "proposed_interval_days",
    "proposed_non_working_day_rule",
    "proposed_installment_count",
    "proposed_installment_amount",
    "proposed_periodic_amount",
    "decision_version",
    "submitted_by",
    "submitted_at",
    "reviewed_by",
    "reviewed_at",
    "decision_reason",
    "created_by",
    "updated_by",
    "created_at",
    "updated_at",
  ],
  equipment_sales_quotations: [
    "id",
    "quotation_number",
    "customer_id",
    "status",
    "total_amount",
    "deposit_required",
  ],
  equipment_sales_quotation_items: [
    "id",
    "quotation_id",
    "asset_id",
    "asset_code_snapshot",
    "asset_name_snapshot",
  ],
  equipment_credit_application_kyc: ["id", "application_id"],
  equipment_credit_application_decisions: [
    "id",
    "application_id",
    "decision_version",
    "action_type",
    "from_status",
    "to_status",
    "notes",
    "snapshot_json",
    "decided_by",
    "decided_at",
  ],
  hire_customers: ["id", "customer_name"],
  fleet_assets: ["id", "asset_code", "asset_name"],
});

class FinanceWorkflowError extends Error {
  constructor(statusCode, message, code, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function cleanText(value, maximum = 2000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number) || number < 1) return fallback;
  return Math.min(number, maximum);
}

function actorId(req) {
  const id = positiveId(req.user?.id);
  if (!id) {
    throw new FinanceWorkflowError(
      401,
      "A signed-in Finance user is required.",
      "FINANCE_USER_REQUIRED"
    );
  }
  return id;
}

function normalizedStatus(value) {
  const status = cleanText(value, 50).toLowerCase().replace(/[\s-]+/g, "_");
  if (!status || status === "all") return null;
  if (!STATUSES.has(status)) {
    throw new FinanceWorkflowError(
      400,
      "Choose a valid installment application status.",
      "INVALID_FINANCE_APPLICATION_STATUS"
    );
  }
  return status;
}

function dateOnly(value, label) {
  const text = cleanText(value, 20);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new FinanceWorkflowError(
      400,
      `Choose a valid ${label} date.`,
      "INVALID_FINANCE_APPLICATION_DATE"
    );
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new FinanceWorkflowError(
      400,
      `Choose a valid ${label} date.`,
      "INVALID_FINANCE_APPLICATION_DATE"
    );
  }
  return text;
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

function assignedRoles(req) {
  return [req.user?.workspace_role, req.user?.access_role, req.user?.role]
    .map((value) => cleanText(value, 80).toLowerCase())
    .filter(Boolean);
}

function assertReviewer(req) {
  if (!assignedRoles(req).some((role) => REVIEWER_ROLES.has(role))) {
    throw new FinanceWorkflowError(
      403,
      "Only an authorised manager or administrator can review installment applications.",
      "EQUIPMENT_CREDIT_REVIEW_PERMISSION_REQUIRED"
    );
  }
}

function assertKnownVersion(body, application) {
  if (body?.known_version === undefined || body?.known_version === null || body?.known_version === "") {
    return;
  }
  const known = Number(body.known_version);
  const current = Number(application.decision_version || 0);
  if (!Number.isInteger(known) || known !== current) {
    throw new FinanceWorkflowError(
      409,
      "This application changed after it was opened. Reload it before continuing.",
      "EQUIPMENT_CREDIT_DECISION_VERSION_CONFLICT",
      {
        application_id: application.id,
        application_status: application.application_status,
        decision_version: current,
      }
    );
  }
}

function classifyFinanceWorkflowError(error) {
  if (error instanceof FinanceWorkflowError) return error;
  const code = cleanText(error?.code, 100);
  const message = cleanText(error?.message, 1000);

  if (["ER_NO_SUCH_TABLE"].includes(code)) {
    return new FinanceWorkflowError(
      503,
      "A required Finance application table is missing from the production database.",
      "FINANCE_APPLICATION_TABLE_MISSING"
    );
  }
  if (["ER_BAD_FIELD_ERROR"].includes(code)) {
    return new FinanceWorkflowError(
      503,
      "A required Finance application column is missing from the production database.",
      "FINANCE_APPLICATION_COLUMN_MISSING"
    );
  }
  if (code === "ER_BAD_NULL_ERROR") {
    const locationFailure = /hire_location_id/i.test(message);
    return new FinanceWorkflowError(
      503,
      locationFailure
        ? "The production Finance location column still rejects company-wide records."
        : "A required Finance database value rejected NULL.",
      locationFailure
        ? "FINANCE_LOCATION_NULLABILITY_REQUIRED"
        : "FINANCE_REQUIRED_DATABASE_VALUE_MISSING"
    );
  }
  if (["ER_NO_REFERENCED_ROW_2", "ER_ROW_IS_REFERENCED_2"].includes(code)) {
    return new FinanceWorkflowError(
      409,
      "A linked Finance customer, quotation, excavator or application record is missing or no longer valid.",
      "FINANCE_FOREIGN_KEY_CONFLICT"
    );
  }
  if (code === "ER_DUP_ENTRY") {
    return new FinanceWorkflowError(
      409,
      "A Finance application number, quotation number or decision version already exists.",
      "DUPLICATE_FINANCE_WORKFLOW_RECORD"
    );
  }
  if (["WARN_DATA_TRUNCATED", "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD"].includes(code)) {
    return new FinanceWorkflowError(
      503,
      "The production database does not accept one of the required Finance workflow status values.",
      "FINANCE_WORKFLOW_ENUM_REQUIRED"
    );
  }
  if (
    [
      "ETIMEDOUT",
      "PROTOCOL_SEQUENCE_TIMEOUT",
      "FINANCE_CRITICAL_CONNECTION_TIMEOUT",
      "POOL_CONNECTION_TIMEOUT",
    ].includes(code) || /timeout|timed out/i.test(message)
  ) {
    return new FinanceWorkflowError(
      503,
      "The Finance database did not finish before the safety deadline. No partial decision was committed.",
      "FINANCE_WORKFLOW_TIMEOUT"
    );
  }
  return new FinanceWorkflowError(
    503,
    "The Finance application workflow could not be completed safely.",
    code || "FINANCE_WORKFLOW_UNAVAILABLE"
  );
}

function sendError(req, res, error, context) {
  const failure = classifyFinanceWorkflowError(error);
  console.error(context, {
    request_id: req.requestId || null,
    code: error?.code || null,
    errno: error?.errno || null,
    sql_state: error?.sqlState || null,
    message: error?.message || null,
    classified_as: failure.code,
  });
  return res.status(failure.statusCode).json({
    status: "error",
    code: failure.code,
    message: failure.message,
    request_id: req.requestId || null,
    retryable: failure.statusCode >= 500,
    ...(failure.details ? { current_application: failure.details } : {}),
  });
}

async function inspectWorkflowSchema(connection) {
  const tables = Object.keys(REQUIRED_SCHEMA);
  const placeholders = tables.map(() => "?").join(",");
  const [rows] = await query(
    connection,
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, IS_NULLABLE AS is_nullable,
            COLUMN_TYPE AS column_type
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${placeholders})`,
    tables
  );
  const columns = new Map(tables.map((table) => [table, new Map()]));
  for (const row of rows) {
    if (!columns.has(row.table_name)) columns.set(row.table_name, new Map());
    columns.get(row.table_name).set(row.column_name, row);
  }
  const missingTables = tables.filter((table) => !columns.get(table)?.size);
  const missingColumns = [];
  for (const [table, required] of Object.entries(REQUIRED_SCHEMA)) {
    if (missingTables.includes(table)) continue;
    for (const column of required) {
      if (!columns.get(table)?.has(column)) missingColumns.push({ table, column });
    }
  }
  const invalidNullability = [];
  for (const table of [
    "equipment_credit_applications",
    "equipment_sales_quotations",
    "equipment_sales_quotation_items",
  ]) {
    const location = columns.get(table)?.get("hire_location_id");
    if (location && String(location.is_nullable).toUpperCase() !== "YES") {
      invalidNullability.push({ table, column: "hire_location_id" });
    }
  }
  let registerQueryCompiles = false;
  if (!missingTables.length && !missingColumns.length) {
    try {
      await query(
        connection,
        `SELECT application.id
           FROM equipment_credit_applications application
           LEFT JOIN hire_customers customer ON customer.id = application.customer_id
           LEFT JOIN equipment_sales_quotations quotation ON quotation.id = application.quotation_id
           LEFT JOIN fleet_assets asset ON asset.id = application.asset_id
          WHERE 1 = 0`
      );
      registerQueryCompiles = true;
    } catch {
      registerQueryCompiles = false;
    }
  }
  const ready =
    !missingTables.length &&
    !missingColumns.length &&
    !invalidNullability.length &&
    registerQueryCompiles;
  return {
    ready,
    checked_at: new Date().toISOString(),
    scope: "company_wide",
    hire_location_selection_required: false,
    missing_tables: missingTables,
    missing_columns: missingColumns,
    invalid_nullability: invalidNullability,
    invalid_enums: [],
    capabilities: {
      window_functions_required: false,
      register_query_compiles: registerQueryCompiles,
      separate_count_summary_page_queries: true,
    },
  };
}

function listFilters(req) {
  const status = normalizedStatus(req.query.status);
  const search = cleanText(req.query.search, 150);
  const dateFrom = dateOnly(req.query.date_from, "from");
  const dateTo = dateOnly(req.query.date_to, "to");
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new FinanceWorkflowError(
      400,
      "The from date cannot be after the to date.",
      "INVALID_FINANCE_APPLICATION_DATE_RANGE"
    );
  }
  const where = ["1 = 1"];
  const params = [];
  if (search) {
    where.push(`(
      application.application_number LIKE ? OR
      customer.customer_name LIKE ? OR customer.phone LIKE ? OR
      quotation.quotation_number LIKE ? OR
      asset.asset_code LIKE ? OR asset.asset_name LIKE ?
    )`);
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like);
  }
  if (dateFrom) {
    where.push("application.application_date >= ?");
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push("application.application_date <= ?");
    params.push(dateTo);
  }
  const listWhere = [...where];
  const listParams = [...params];
  if (status) {
    listWhere.push("application.application_status = ?");
    listParams.push(status);
  }
  return { baseWhere: where, baseParams: params, listWhere, listParams };
}

const LIST_JOINS = `
  LEFT JOIN hire_customers customer ON customer.id = application.customer_id
  LEFT JOIN equipment_sales_quotations quotation ON quotation.id = application.quotation_id
  LEFT JOIN fleet_assets asset ON asset.id = application.asset_id
`;

async function loadApplicationRecord(connection, applicationId, lock = false) {
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
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      application.id,
      version,
      actionType,
      fromStatus || null,
      toStatus || null,
      assessment?.affordability_status || application.affordability_status || null,
      assessment?.risk_band || application.risk_band || null,
      assessment?.risk_score ?? application.risk_score ?? null,
      assessment?.debt_service_ratio_percent ?? application.debt_service_ratio_percent ?? null,
      assessment?.net_monthly_surplus ?? application.net_monthly_surplus ?? null,
      cleanText(notes, 2000) || null,
      JSON.stringify({
        phase: 3,
        finance_scope: "company_wide",
        optional_customer_information: true,
        ...snapshot,
        assessment: assessment || null,
      }),
      userId,
    ]
  );
  application.decision_version = version;
}

async function writeWorkflowAudit(req, application, action, details, metadata = {}) {
  try {
    await withDeadline(
      writeAuditEvent({
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
          phase: 3,
          finance_scope: "company_wide",
          application_number: application.application_number,
          ...metadata,
        },
      }).catch(() => null),
      AUDIT_TIMEOUT_MS,
      null
    );
  } catch {
    // A committed application decision must never be rolled back by audit failure.
  }
}

router.get(
  "/credit-applications/readiness",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    let connection;
    try {
      connection = await acquireConnection(CONNECTION_TIMEOUT_MS);
      const readiness = await inspectWorkflowSchema(connection);
      return res.status(readiness.ready ? 200 : 503).json({
        status: readiness.ready ? "success" : "error",
        code: readiness.ready ? undefined : "FINANCE_PHASE3_SCHEMA_REQUIRED",
        message: readiness.ready
          ? "The complete Finance application and approval pipeline is ready."
          : "The complete Finance application and approval pipeline needs its additive migration.",
        request_id: req.requestId || null,
        readiness: { ...readiness, request_id: req.requestId || null },
      });
    } catch (error) {
      return sendError(req, res, error, "Phase 3 Finance readiness failed");
    } finally {
      connection?.release();
    }
  }
);

router.get(
  "/credit-applications",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    let connection;
    try {
      const requestedPage = positiveInteger(req.query.page, 1);
      const pageSize = positiveInteger(req.query.page_size, PAGE_SIZE, MAX_PAGE_SIZE);
      const filters = listFilters(req);
      connection = await acquireConnection(CONNECTION_TIMEOUT_MS);

      const [countRows] = await query(
        connection,
        `SELECT COUNT(application.id) AS total
           FROM equipment_credit_applications application
           ${LIST_JOINS}
          WHERE ${filters.listWhere.join(" AND ")}`,
        filters.listParams
      );
      const total = Number(countRows[0]?.total || 0);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(requestedPage, totalPages);
      const offset = (page - 1) * pageSize;

      const [summaryRows] = await query(
        connection,
        `SELECT
           SUM(application.application_status IN ('draft','changes_requested')) AS drafts,
           SUM(application.application_status IN ('submitted','under_review')) AS awaiting_review,
           SUM(application.application_status = 'approved') AS approved,
           COALESCE(SUM(CASE
             WHEN application.application_status IN ('draft','submitted','under_review','changes_requested','approved')
             THEN COALESCE(application.financed_amount, 0) ELSE 0 END), 0) AS proposed_exposure
           FROM equipment_credit_applications application
           ${LIST_JOINS}
          WHERE ${filters.baseWhere.join(" AND ")}`,
        filters.baseParams
      );

      const [rows] = await query(
        connection,
        `SELECT application.id, application.application_number,
                application.application_date, application.application_status,
                application.kyc_status, application.affordability_status,
                application.risk_band, application.risk_score,
                application.quoted_total, application.proposed_deposit,
                application.financed_amount, application.proposed_frequency,
                application.proposed_interval_days,
                application.proposed_installment_count,
                application.proposed_installment_amount,
                application.decision_version, application.submitted_at,
                application.reviewed_at, application.created_at,
                application.updated_at,
                application.customer_id, application.quotation_id, application.asset_id,
                COALESCE(customer.customer_name, CONCAT('Missing customer #', application.customer_id)) AS customer_name,
                customer.phone AS customer_phone,
                COALESCE(quotation.quotation_number, CONCAT('Missing offer #', application.quotation_id)) AS quotation_number,
                quotation.status AS quotation_status,
                COALESCE(asset.asset_code, CONCAT('Missing asset #', application.asset_id)) AS asset_code,
                COALESCE(asset.asset_name, 'Excavator reference unavailable') AS asset_name,
                asset.make, asset.model,
                CASE WHEN COALESCE(asset.main_image_url, '') <> '' OR EXISTS (
                  SELECT 1 FROM equipment_media media
                   WHERE media.asset_id = application.asset_id
                     AND media.archived_at IS NULL
                   LIMIT 1
                ) THEN 1 ELSE 0 END AS has_image
           FROM equipment_credit_applications application
           ${LIST_JOINS}
          WHERE ${filters.listWhere.join(" AND ")}
          ORDER BY application.updated_at DESC, application.id DESC
          LIMIT ? OFFSET ?`,
        [...filters.listParams, pageSize, offset]
      );
      const summary = summaryRows[0] || {};
      return res.json({
        status: "success",
        request_id: req.requestId || null,
        applications: rows.map((row) => ({
          ...row,
          has_image: Boolean(Number(row.has_image || 0)),
          risk_score: Number(row.risk_score || 0),
          quoted_total: Number(row.quoted_total || 0),
          proposed_deposit: Number(row.proposed_deposit || 0),
          financed_amount: Number(row.financed_amount || 0),
          proposed_interval_days: Number(row.proposed_interval_days || 0),
          proposed_installment_count: Number(row.proposed_installment_count || 0),
          proposed_installment_amount: Number(row.proposed_installment_amount || 0),
          decision_version: Number(row.decision_version || 0),
        })),
        pagination: { page, page_size: pageSize, total, total_pages: totalPages },
        summary: {
          drafts: Number(summary.drafts || 0),
          awaiting_review: Number(summary.awaiting_review || 0),
          approved: Number(summary.approved || 0),
          proposed_exposure: Number(summary.proposed_exposure || 0),
        },
        policy: {
          scope: "company_wide",
          hire_location_selection_required: false,
          list_contains_image_bytes: false,
          window_functions_required: false,
          orphaned_join_records_remain_visible: true,
          query_plan: ["count", "summary", "page"],
        },
      });
    } catch (error) {
      return sendError(req, res, error, "Phase 3 Finance register failed");
    } finally {
      connection?.release();
    }
  }
);

router.get(
  "/credit-applications/:id",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    const applicationId = positiveId(req.params.id);
    if (!applicationId) {
      return sendError(
        req,
        res,
        new FinanceWorkflowError(400, "Invalid installment application ID.", "INVALID_FINANCE_APPLICATION_ID"),
        "Phase 3 Finance detail rejected invalid ID"
      );
    }
    let connection;
    try {
      connection = await acquireConnection(CONNECTION_TIMEOUT_MS);
      const [applicationRows] = await query(
        connection,
        `SELECT application.*,
                customer.customer_code,
                COALESCE(customer.customer_name, CONCAT('Missing customer #', application.customer_id)) AS customer_name,
                customer.phone AS customer_phone, customer.email AS customer_email,
                customer.address AS customer_address,
                COALESCE(quotation.quotation_number, CONCAT('Missing offer #', application.quotation_id)) AS quotation_number,
                quotation.status AS quotation_status,
                quotation.total_amount AS quotation_total,
                quotation.deposit_required AS quotation_deposit,
                quotation.proposed_first_due_date,
                quotation.proposed_interval_days AS quotation_interval_days,
                quotation.proposed_non_working_day_rule,
                quotation.terms AS quotation_terms,
                quotation.notes AS quotation_notes,
                COALESCE(asset.asset_code, CONCAT('Missing asset #', application.asset_id)) AS asset_code,
                COALESCE(asset.asset_name, 'Excavator reference unavailable') AS asset_name,
                asset.asset_type, asset.make, asset.model, asset.model_year,
                asset.serial_number, asset.chassis_number,
                CASE WHEN COALESCE(asset.main_image_url, '') <> '' OR EXISTS (
                  SELECT 1 FROM equipment_media media
                   WHERE media.asset_id = application.asset_id
                     AND media.archived_at IS NULL LIMIT 1
                ) THEN 1 ELSE 0 END AS has_image
           FROM equipment_credit_applications application
           LEFT JOIN hire_customers customer ON customer.id = application.customer_id
           LEFT JOIN equipment_sales_quotations quotation ON quotation.id = application.quotation_id
           LEFT JOIN fleet_assets asset ON asset.id = application.asset_id
          WHERE application.id = ? LIMIT 1`,
        [applicationId]
      );
      const application = applicationRows[0];
      if (!application) {
        throw new FinanceWorkflowError(
          404,
          "Installment application was not found.",
          "FINANCE_APPLICATION_NOT_FOUND"
        );
      }
      const [kycRows] = await query(
        connection,
        "SELECT * FROM equipment_credit_application_kyc WHERE application_id = ? LIMIT 1",
        [applicationId]
      );
      const [decisions] = await query(
        connection,
        `SELECT id, application_id, decision_version, action_type,
                from_status, to_status, affordability_status, risk_band,
                risk_score, debt_service_ratio_percent, net_monthly_surplus,
                notes, snapshot_json, decided_by, decided_at
           FROM equipment_credit_application_decisions
          WHERE application_id = ?
          ORDER BY decision_version DESC, id DESC LIMIT 100`,
        [applicationId]
      );
      const hasImage = Boolean(Number(application.has_image || 0));
      return res.json({
        status: "success",
        request_id: req.requestId || null,
        application: {
          ...application,
          has_image: hasImage,
          main_image_url: null,
          image_path: hasImage
            ? `/equipment-catalogue/sales/credit-applications/${application.id}/image`
            : null,
          decision_version: Number(application.decision_version || 0),
        },
        kyc: kycRows[0] || null,
        decisions,
        active_asset_locks: [],
        editable: ["draft", "changes_requested"].includes(application.application_status),
        withdrawable: ["draft", "changes_requested", "submitted"].includes(
          application.application_status
        ),
        next_action: nextAction(application.application_status),
        policy: {
          scope: "company_wide",
          hire_location_selection_required: false,
          detail_contains_image_bytes: false,
          missing_joined_details_never_hide_application: true,
        },
      });
    } catch (error) {
      return sendError(req, res, error, "Phase 3 Finance detail failed");
    } finally {
      connection?.release();
    }
  }
);

router.post(
  "/credit-applications/:id/submit",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    const applicationId = positiveId(req.params.id);
    let connection;
    let transactionActive = false;
    try {
      if (!applicationId) {
        throw new FinanceWorkflowError(400, "Invalid installment application ID.", "INVALID_FINANCE_APPLICATION_ID");
      }
      const userId = actorId(req);
      connection = await acquireConnection(CONNECTION_TIMEOUT_MS);
      await connection.beginTransaction();
      transactionActive = true;
      const application = await loadApplicationRecord(connection, applicationId, true);
      if (!application) {
        throw new FinanceWorkflowError(404, "Installment application was not found.", "FINANCE_APPLICATION_NOT_FOUND");
      }
      if (application.application_status === "submitted") {
        await connection.commit();
        transactionActive = false;
        return res.json({
          status: "success",
          message: "This application was already submitted; no duplicate decision was created.",
          request_id: req.requestId || null,
          application,
          next_action: nextAction("submitted"),
          idempotent_replay: true,
        });
      }
      assertKnownVersion(req.body, application);
      if (!["draft", "changes_requested"].includes(application.application_status)) {
        throw new FinanceWorkflowError(
          409,
          "Only a draft or changes-requested application can be submitted.",
          "EQUIPMENT_CREDIT_INVALID_SUBMIT_TRANSITION"
        );
      }
      const kyc = await loadKyc(connection, application.id, true);
      const assessment = advisoryAssessment(application, kyc || {});
      await persistAssessment(connection, application, assessment, userId);
      const fromStatus = application.application_status;
      await query(
        connection,
        `UPDATE equipment_credit_applications
            SET application_status = 'submitted', submitted_by = ?, submitted_at = NOW(),
                reviewed_by = NULL, reviewed_at = NULL, decision_reason = NULL,
                updated_by = ?
          WHERE id = ?`,
        [userId, userId, application.id]
      );
      application.application_status = "submitted";
      await recordDecision(
        connection,
        application,
        "submitted",
        fromStatus,
        "submitted",
        assessment,
        req.body?.notes || "Submitted for manager review.",
        userId
      );
      await connection.commit();
      transactionActive = false;
      void writeWorkflowAudit(
        req,
        application,
        "EQUIPMENT_CREDIT_APPLICATION_SUBMITTED",
        `Submitted ${application.application_number} for manager review.`
      );
      return res.json({
        status: "success",
        message: "Installment application submitted for manager review.",
        request_id: req.requestId || null,
        application,
        next_action: nextAction("submitted"),
        idempotent_replay: false,
      });
    } catch (error) {
      if (transactionActive && connection) {
        try { await connection.rollback(); } catch { /* preserve original error */ }
      }
      return sendError(req, res, error, "Phase 3 Finance submission failed");
    } finally {
      connection?.release();
    }
  }
);

router.post(
  "/credit-applications/:id/review",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    const applicationId = positiveId(req.params.id);
    let connection;
    let transactionActive = false;
    try {
      assertReviewer(req);
      if (!applicationId) {
        throw new FinanceWorkflowError(400, "Invalid installment application ID.", "INVALID_FINANCE_APPLICATION_ID");
      }
      const action = cleanText(req.body?.action, 80).toLowerCase().replace(/[\s-]+/g, "_");
      const transition = REVIEW_TRANSITIONS[action];
      const reason = cleanText(req.body?.reason, 1500) || null;
      if (!transition) {
        throw new FinanceWorkflowError(400, "Choose a valid installment review action.", "INVALID_FINANCE_REVIEW_ACTION");
      }
      if (["request_changes", "decline"].includes(action) && !reason) {
        throw new FinanceWorkflowError(400, "Enter the exact reason for this review decision.", "FINANCE_REVIEW_REASON_REQUIRED");
      }
      const userId = actorId(req);
      connection = await acquireConnection(CONNECTION_TIMEOUT_MS);
      await connection.beginTransaction();
      transactionActive = true;
      const application = await loadApplicationRecord(connection, applicationId, true);
      if (!application) {
        throw new FinanceWorkflowError(404, "Installment application was not found.", "FINANCE_APPLICATION_NOT_FOUND");
      }
      if (application.application_status === transition.to) {
        await connection.commit();
        transactionActive = false;
        return res.json({
          status: "success",
          message: `This application is already ${transition.to.replaceAll("_", " ")}; no duplicate decision was created.`,
          request_id: req.requestId || null,
          application,
          next_action: nextAction(transition.to),
          idempotent_replay: true,
        });
      }
      assertKnownVersion(req.body, application);
      if (["approved", "declined", "withdrawn"].includes(application.application_status)) {
        throw new FinanceWorkflowError(
          409,
          "This application already has a final decision.",
          "EQUIPMENT_CREDIT_FINAL_DECISION_RECORDED"
        );
      }
      if (!transition.from.has(application.application_status)) {
        throw new FinanceWorkflowError(
          409,
          `The ${action.replaceAll("_", " ")} action is not valid from ${application.application_status.replaceAll("_", " ")}.`,
          "EQUIPMENT_CREDIT_INVALID_REVIEW_TRANSITION"
        );
      }
      const kyc = await loadKyc(connection, application.id, true);
      const assessment = advisoryAssessment(application, kyc || {});
      await persistAssessment(connection, application, assessment, userId);
      const fromStatus = application.application_status;
      await query(
        connection,
        `UPDATE equipment_credit_applications
            SET application_status = ?, reviewed_by = ?, reviewed_at = NOW(),
                decision_reason = ?, updated_by = ?
          WHERE id = ?`,
        [transition.to, userId, reason, userId, application.id]
      );
      application.application_status = transition.to;
      await recordDecision(
        connection,
        application,
        transition.action,
        fromStatus,
        transition.to,
        assessment,
        reason || (action === "approve" ? "Approved by an authorised manager." : "Manager review started."),
        userId,
        { review_action: action }
      );
      await connection.commit();
      transactionActive = false;
      void writeWorkflowAudit(
        req,
        application,
        `EQUIPMENT_CREDIT_APPLICATION_${transition.action.toUpperCase()}`,
        `${application.application_number} changed from ${fromStatus} to ${transition.to}.`,
        { reason }
      );
      return res.json({
        status: "success",
        message:
          transition.to === "approved"
            ? "Installment application approved by the authorised manager."
            : `Installment application recorded as ${transition.to.replaceAll("_", " ")}.`,
        request_id: req.requestId || null,
        application,
        next_action: nextAction(transition.to),
        idempotent_replay: false,
      });
    } catch (error) {
      if (transactionActive && connection) {
        try { await connection.rollback(); } catch { /* preserve original error */ }
      }
      return sendError(req, res, error, "Phase 3 Finance review failed");
    } finally {
      connection?.release();
    }
  }
);

module.exports = router;
module.exports.FinanceWorkflowError = FinanceWorkflowError;
module.exports.REVIEW_TRANSITIONS = REVIEW_TRANSITIONS;
module.exports.classifyFinanceWorkflowError = classifyFinanceWorkflowError;
module.exports.inspectWorkflowSchema = inspectWorkflowSchema;
module.exports.listFilters = listFilters;
