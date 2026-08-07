const crypto = require("crypto");

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const { nextDocumentNumber } = require("./groupConfigurationService");
const { sendSmsAlertToPhone } = require("./smsAlertService");
const {
  getIssuedDocument,
  getProfessionalSettings,
  sendBossPaymentAlert,
} = require("./equipmentFinanceProfessionalService");
const {
  reconcileFinanceAgreement,
} = require("./equipmentFinanceReconciliationService");

const REQUIRED_TABLES = Object.freeze([
  "equipment_finance_case_drafts",
  "equipment_finance_case_documents",
  "equipment_finance_case_tasks",
  "equipment_finance_case_amendments",
  "equipment_finance_schedule_simulations",
  "equipment_finance_document_shares",
  "equipment_finance_case_events",
]);

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const ALLOWED_DOCUMENT_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const DOCUMENT_STATUSES = new Set(["uploaded", "verified", "rejected", "superseded"]);
const TASK_STATUSES = new Set(["open", "in_progress", "completed", "cancelled"]);
const TASK_PRIORITIES = new Set(["low", "normal", "high", "critical"]);
const APPROVAL_STATUSES = new Set(["not_required", "pending", "approved", "rejected"]);
const AMENDMENT_STATUSES = new Set([
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "applied",
  "cancelled",
]);
const SHARE_CHANNELS = new Set(["sms", "whatsapp", "email", "copy", "download", "print"]);
const CASE_TYPES = new Set(["application", "agreement"]);
const SCHEDULE_FREQUENCIES = new Set(["weekly", "fortnightly", "monthly", "custom"]);
const DEFAULT_CASE_PAGE_SIZE = 25;
const DEFAULT_INBOX_PAGE_SIZE = 25;
const MAX_OPERATIONAL_PAGE_SIZE = 100;
const DIRECT_SAFE_AMENDMENT_FIELDS = new Set([
  "customer_name",
  "customer_phone",
  "customer_email",
  "customer_address",
  "guarantor_phone",
  "agreement_notes",
]);
const HIGH_RISK_AMENDMENT_FIELDS = new Set([
  "purchase_price",
  "deposit_required",
  "financed_amount",
  "payment_frequency",
  "installment_count",
  "first_due_date",
  "final_due_date",
  "schedule",
  "payment_amount",
  "payment_reference",
]);

class OperationalPolishError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_FINANCE_OPERATIONAL_POLISH_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizePagination({ page = 1, pageSize, page_size, limit } = {}, fallback) {
  const normalizedPage = Math.max(1, Number.parseInt(page, 10) || 1);
  const requestedSize = Number.parseInt(pageSize ?? page_size ?? limit, 10);
  const normalizedPageSize = Math.min(
    MAX_OPERATIONAL_PAGE_SIZE,
    Math.max(1, requestedSize || fallback)
  );
  return {
    page: normalizedPage,
    pageSize: normalizedPageSize,
    offset: (normalizedPage - 1) * normalizedPageSize,
  };
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if ([true, 1, "1", "true", "yes", "on"].includes(value)) return true;
  if ([false, 0, "0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function numberValue(value, fallback = 0) {
  const number = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(number) ? number : fallback;
}

function moneyValue(value, { minimum = 0, maximum = 10000000000 } = {}) {
  const number = numberValue(value, NaN);
  if (!Number.isFinite(number) || number < minimum || number > maximum) return undefined;
  return Number(number.toFixed(2));
}

function dateValue(value) {
  const text = cleanText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function dateTimeValue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 19).replace("T", " ");
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function checksum(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""), "utf8");
  return crypto.createHash("sha256").update(input).digest("hex");
}

function normalizeCaseType(value) {
  const type = cleanText(value, 30).toLowerCase().replace(/[\s-]+/g, "_");
  return CASE_TYPES.has(type) ? type : null;
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("233") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits;
}

function humanize(value) {
  return cleanText(value, 180)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function operationalPolishSchemaStatus(connection = pool) {
  const placeholders = REQUIRED_TABLES.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    REQUIRED_TABLES
  );
  const existing = new Set(rows.map((row) => row.TABLE_NAME));
  const missing = REQUIRED_TABLES.filter((tableName) => !existing.has(tableName));
  return {
    ready: missing.length === 0,
    migration: "20260731_equipment_finance_operational_polish",
    missing_tables: missing,
    storage: "database_private",
    maximum_document_bytes: MAX_DOCUMENT_BYTES,
  };
}

async function assertOperationalPolishSchema(connection = pool) {
  const readiness = await operationalPolishSchemaStatus(connection);
  if (!readiness.ready) {
    const error = new OperationalPolishError(
      503,
      "Finance operational polish is awaiting its approved additive database migration.",
      "EQUIPMENT_FINANCE_OPERATIONAL_POLISH_MIGRATION_REQUIRED"
    );
    error.readiness = readiness;
    throw error;
  }
  return readiness;
}

function parseProtectedDocument(input = {}) {
  const dataUrl = cleanText(input.data_url, MAX_DOCUMENT_BYTES * 2);
  const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) {
    throw new OperationalPolishError(
      400,
      "Choose a PDF, JPEG, PNG or WebP file and upload it again.",
      "FINANCE_DOCUMENT_DATA_INVALID"
    );
  }
  const mimeType = String(match[1] || "").toLowerCase();
  if (!ALLOWED_DOCUMENT_MIME.has(mimeType)) {
    throw new OperationalPolishError(
      400,
      "Only PDF, JPEG, PNG and WebP evidence files are allowed.",
      "FINANCE_DOCUMENT_TYPE_BLOCKED"
    );
  }
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_DOCUMENT_BYTES) {
    throw new OperationalPolishError(
      400,
      `Evidence files must be between 1 byte and ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB.`,
      "FINANCE_DOCUMENT_SIZE_BLOCKED"
    );
  }

  const signatures = {
    "application/pdf": () => buffer.subarray(0, 5).toString("ascii") === "%PDF-",
    "image/jpeg": () =>
      buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
    "image/png": () =>
      buffer.length > 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/webp": () =>
      buffer.length > 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP",
  };
  if (!signatures[mimeType]()) {
    throw new OperationalPolishError(
      400,
      "The file contents do not match the selected file type.",
      "FINANCE_DOCUMENT_SIGNATURE_MISMATCH"
    );
  }

  const extensionByMime = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };
  const rawName = cleanText(input.file_name || `finance-evidence${extensionByMime[mimeType]}`, 255)
    .replace(/[\\/\0\r\n]/g, "-")
    .replace(/[^A-Za-z0-9._() -]/g, "_");
  const extension = extensionByMime[mimeType];
  const fileName = rawName.toLowerCase().endsWith(extension)
    ? rawName
    : `${rawName.replace(/\.[A-Za-z0-9]+$/, "")}${extension}`;

  return {
    buffer,
    byte_size: buffer.length,
    checksum_sha256: checksum(buffer),
    mime_type: mimeType,
    file_name: fileName,
  };
}

function calculateDraftProgress(payload = {}) {
  const data = payload && typeof payload === "object" ? payload : {};
  const customerReady = Boolean(
    (data.customerMode === "existing" && positiveId(data.customer_id)) ||
      (data.customerMode === "new" && cleanText(data.customer?.customer_name) && cleanText(data.customer?.phone))
  );
  const machineReady = Boolean(positiveId(data.asset_id));
  const sellingPrice = moneyValue(data.offer?.selling_price);
  const deposit = moneyValue(data.offer?.deposit);
  const planReady = Boolean(
    sellingPrice > 0 &&
      deposit !== undefined &&
      deposit <= sellingPrice &&
      Number(data.offer?.installment_count || 0) > 0 &&
      dateValue(data.offer?.first_due_date)
  );
  const kycReady = Boolean(
    cleanText(data.kyc?.id_number) &&
      cleanText(data.kyc?.employment_type) &&
      cleanText(data.kyc?.occupation) &&
      cleanText(data.kyc?.residential_address || data.customer?.address)
  );
  const affordabilityReady =
    numberValue(data.affordability?.monthly_salary_income) +
      numberValue(data.affordability?.monthly_business_income) +
      numberValue(data.affordability?.monthly_other_income) >
    0;
  const consentReady = Boolean(
    data.kyc?.customer_consent_confirmed && data.kyc?.credit_assessment_consent_confirmed
  );
  const financedAmount = Math.max(Number(sellingPrice || 0) - Number(deposit || 0), 0);
  const guarantorRequired = financedAmount >= 100000;
  const guarantorReady =
    !guarantorRequired ||
    Boolean(
      cleanText(data.kyc?.guarantor_name) &&
        cleanText(data.kyc?.guarantor_phone) &&
        cleanText(data.kyc?.guarantor_id_number)
    );

  const checklist = [
    { code: "customer", label: "Customer selected or created", complete: customerReady },
    { code: "machine", label: "Exact excavator selected", complete: machineReady },
    { code: "plan", label: "Price and payment plan completed", complete: planReady },
    { code: "kyc", label: "KYC identity and address completed", complete: kycReady },
    { code: "affordability", label: "Affordability income entered", complete: affordabilityReady },
    { code: "consent", label: "Customer consent confirmed", complete: consentReady },
    {
      code: "guarantor",
      label: guarantorRequired ? "Required guarantor completed" : "Guarantor not required",
      complete: guarantorReady,
      required: guarantorRequired,
    },
  ];
  const required = checklist.filter((item) => item.required !== false);
  const completeCount = required.filter((item) => item.complete).length;
  return {
    checklist,
    complete_count: completeCount,
    total_count: required.length,
    completion_percent: Number(((completeCount / Math.max(required.length, 1)) * 100).toFixed(2)),
    ready_for_review: required.every((item) => item.complete),
    missing: required.filter((item) => !item.complete).map((item) => item.label),
  };
}

async function getDraft({ userId, draftKey = "start-installment" }) {
  await assertOperationalPolishSchema();
  const id = positiveId(userId);
  if (!id) throw new OperationalPolishError(401, "A signed-in user is required.");
  const [rows] = await pool.query(
    `SELECT *
     FROM equipment_finance_case_drafts
     WHERE user_id = ? AND draft_key = ? AND archived_at IS NULL
     LIMIT 1`,
    [id, cleanText(draftKey, 120)]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    draft_key: row.draft_key,
    application_id: row.application_id,
    customer_id: row.customer_id,
    asset_id: row.asset_id,
    payload: parseJson(row.payload_json, {}),
    progress: parseJson(row.progress_json, {}),
    completion_percent: Number(row.completion_percent || 0),
    version: Number(row.version_no || 1),
    last_saved_at: row.last_saved_at,
    created_at: row.created_at,
  };
}

async function saveDraft({ userId, draftKey = "start-installment", payload, knownVersion = null }) {
  await assertOperationalPolishSchema();
  const id = positiveId(userId);
  if (!id || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new OperationalPolishError(400, "A valid signed-in draft payload is required.");
  }
  const key = cleanText(draftKey, 120) || "start-installment";
  const progress = calculateDraftProgress(payload);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT * FROM equipment_finance_case_drafts
       WHERE user_id = ? AND draft_key = ?
       LIMIT 1 FOR UPDATE`,
      [id, key]
    );
    const current = rows[0];
    if (
      current &&
      knownVersion !== null &&
      knownVersion !== undefined &&
      Number(knownVersion) !== Number(current.version_no)
    ) {
      const error = new OperationalPolishError(
        409,
        "This draft changed in another session. Review the latest saved version before continuing.",
        "FINANCE_DRAFT_VERSION_CONFLICT"
      );
      error.current_draft = {
        id: current.id,
        payload: parseJson(current.payload_json, {}),
        progress: parseJson(current.progress_json, {}),
        version: Number(current.version_no),
        last_saved_at: current.last_saved_at,
      };
      throw error;
    }
    const applicationId = positiveId(payload.application_id);
    const customerId = positiveId(payload.customer_id);
    const assetId = positiveId(payload.asset_id);
    if (current) {
      await connection.query(
        `UPDATE equipment_finance_case_drafts
         SET application_id = ?, customer_id = ?, asset_id = ?,
             payload_json = ?, progress_json = ?, completion_percent = ?,
             version_no = version_no + 1, last_saved_at = NOW(),
             archived_at = NULL, submitted_at = NULL
         WHERE id = ?`,
        [
          applicationId,
          customerId,
          assetId,
          safeJson(payload),
          safeJson(progress),
          progress.completion_percent,
          current.id,
        ]
      );
    } else {
      await connection.query(
        `INSERT INTO equipment_finance_case_drafts (
           user_id, draft_key, application_id, customer_id, asset_id,
           payload_json, progress_json, completion_percent, version_no, last_saved_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
        [
          id,
          key,
          applicationId,
          customerId,
          assetId,
          safeJson(payload),
          safeJson(progress),
          progress.completion_percent,
        ]
      );
    }
    await connection.commit();
    return getDraft({ userId: id, draftKey: key });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function archiveDraft({ userId, draftKey = "start-installment", submitted = false }) {
  await assertOperationalPolishSchema();
  const id = positiveId(userId);
  if (!id) throw new OperationalPolishError(401, "A signed-in user is required.");
  const [result] = await pool.query(
    `UPDATE equipment_finance_case_drafts
     SET archived_at = NOW(), submitted_at = CASE WHEN ? THEN NOW() ELSE submitted_at END
     WHERE user_id = ? AND draft_key = ? AND archived_at IS NULL`,
    [submitted ? 1 : 0, id, cleanText(draftKey, 120)]
  );
  return { archived: Number(result.affectedRows || 0) > 0 };
}

async function resolveCaseIdentity(caseTypeValue, caseIdValue, connection = pool) {
  const caseType = normalizeCaseType(caseTypeValue);
  const caseId = positiveId(caseIdValue);
  if (!caseType || !caseId) {
    throw new OperationalPolishError(400, "Choose a valid Finance application or agreement.");
  }
  const where = caseType === "application" ? "application.id = ?" : "agreement.id = ?";
  const [rows] = await connection.query(
    `SELECT
       application.id AS application_id,
       application.application_number,
       application.application_status,
       application.kyc_status,
       application.affordability_status,
       application.customer_id,
       application.asset_id,
       application.created_at AS application_created_at,
       application.reviewed_at,
       application.decision_reason,
       application.total_monthly_income,
       application.financed_amount AS application_financed_amount,
       application.proposed_deposit,
       application.proposed_frequency,
       application.proposed_installment_count,
       kyc.customer_name_snapshot,
       kyc.customer_phone_snapshot,
       kyc.customer_email_snapshot,
       kyc.customer_address_snapshot,
       kyc.residential_address,
       kyc.id_type,
       kyc.id_number,
       kyc.employment_type,
       kyc.occupation,
       kyc.guarantor_name,
       kyc.guarantor_phone,
       kyc.guarantor_id_number,
       kyc.identity_verified,
       kyc.address_verified,
       kyc.income_verified,
       kyc.guarantor_verified,
       kyc.customer_consent_confirmed,
       kyc.credit_assessment_consent_confirmed,
       agreement.id AS agreement_id,
       agreement.agreement_number,
       agreement.agreement_status,
       agreement.total_amount,
       agreement.deposit_required,
       agreement.deposit_received,
       agreement.financed_amount,
       agreement.amount_paid,
       agreement.outstanding_balance,
       agreement.overdue_amount,
       agreement.payment_frequency,
       agreement.installment_count,
       agreement.first_due_date,
       agreement.final_due_date,
       agreement.equipment_commitment_status,
       agreement.delivery_status,
       agreement.ownership_status,
       agreement.agreement_document_number,
       agreement.agreement_issued_at,
       agreement.agreement_signed_at,
       agreement.created_at AS agreement_created_at,
       agreement.approved_at AS agreement_approved_at,
       agreement.deposit_completed_at,
       agreement.reservation_activated_at,
       agreement.delivered_at,
       agreement.controlled_ownership_completed_at,
       customer.customer_name,
       customer.phone AS customer_phone,
       customer.email AS customer_email,
       customer.address AS customer_address,
       asset.asset_code,
       asset.asset_name,
       asset.make,
       asset.model,
       asset.serial_number,
       asset.chassis_number,
       asset.main_image_url,
       asset.sale_status,
       asset.is_active AS asset_is_active
     FROM equipment_credit_applications application
     LEFT JOIN equipment_credit_application_kyc kyc ON kyc.application_id = application.id
     LEFT JOIN equipment_sale_agreements agreement
       ON agreement.credit_application_id = application.id
      AND agreement.sale_type = 'installment'
     LEFT JOIN hire_customers customer ON customer.id = application.customer_id
     LEFT JOIN fleet_assets asset ON asset.id = application.asset_id
     WHERE ${where}
     ORDER BY agreement.id DESC
     LIMIT 1`,
    [caseId]
  );
  const row = rows[0];
  if (!row) throw new OperationalPolishError(404, "Finance case was not found.");
  return {
    ...row,
    case_type: caseType,
    case_id: caseId,
    customer_name: row.customer_name_snapshot || row.customer_name || "Customer",
    customer_phone: row.customer_phone_snapshot || row.customer_phone || null,
    customer_email: row.customer_email_snapshot || row.customer_email || null,
    customer_address:
      row.residential_address || row.customer_address_snapshot || row.customer_address || null,
    case_number: row.agreement_number || row.application_number,
    case_stage: row.agreement_id ? "agreement" : "application",
  };
}

function caseListFilter(searchValue) {
  const search = cleanText(searchValue, 120);
  if (!search) return { sql: "", params: [] };
  const term = `%${search}%`;
  return {
    sql: `WHERE (
      application.application_number LIKE ?
      OR agreement.agreement_number LIKE ?
      OR customer.customer_name LIKE ?
      OR customer.phone LIKE ?
      OR kyc.customer_name_snapshot LIKE ?
      OR kyc.customer_phone_snapshot LIKE ?
      OR asset.asset_code LIKE ?
      OR asset.asset_name LIKE ?
      OR asset.serial_number LIKE ?
    )`,
    params: [term, term, term, term, term, term, term, term, term],
  };
}

function publicCaseSummary(row) {
  return {
    ...row,
    case_type: row.agreement_id ? "agreement" : "application",
    case_id: row.agreement_id || row.application_id,
    case_number: row.agreement_number || row.application_number,
    customer_name: row.customer_name_snapshot || row.customer_name || "Customer",
    customer_phone: row.customer_phone_snapshot || row.customer_phone || null,
    asset_label: [row.asset_code, row.asset_name].filter(Boolean).join(" — ") || "Excavator",
    status: row.agreement_status || row.application_status,
    outstanding_balance: Number(row.outstanding_balance || 0),
    overdue_amount: Number(row.overdue_amount || 0),
    amount_paid: Number(row.amount_paid || 0),
  };
}

async function listCasesPage(options = {}) {
  if (!options.schemaReady) await assertOperationalPolishSchema();
  const { page, pageSize, offset } = normalizePagination(
    options,
    DEFAULT_CASE_PAGE_SIZE
  );
  const filter = caseListFilter(options.search);
  const joins = `
    LEFT JOIN equipment_credit_application_kyc kyc ON kyc.application_id = application.id
    LEFT JOIN hire_customers customer ON customer.id = application.customer_id
    LEFT JOIN fleet_assets asset ON asset.id = application.asset_id
    LEFT JOIN equipment_sale_agreements agreement
      ON agreement.credit_application_id = application.id
     AND agreement.sale_type = 'installment'`;
  const [countResult, rowsResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(DISTINCT application.id) AS total
       FROM equipment_credit_applications application
       ${joins}
       ${filter.sql}`,
      filter.params
    ),
    pool.query(
      `SELECT
         application.id AS application_id,
         application.application_number,
         application.application_status,
         application.kyc_status,
         application.affordability_status,
         application.risk_band,
         application.risk_score,
         application.created_at,
         application.updated_at,
         application.reviewed_at,
         application.customer_id,
         application.asset_id,
         application.financed_amount AS application_financed_amount,
         kyc.customer_name_snapshot,
         kyc.customer_phone_snapshot,
         customer.customer_name,
         customer.phone AS customer_phone,
         asset.asset_code,
         asset.asset_name,
         asset.make,
         asset.model,
         agreement.id AS agreement_id,
         agreement.agreement_number,
         agreement.agreement_status,
         agreement.outstanding_balance,
         agreement.overdue_amount,
         agreement.next_due_date,
         agreement.amount_paid,
         agreement.agreement_issued_at,
         agreement.agreement_signed_at
       FROM equipment_credit_applications application
       ${joins}
       ${filter.sql}
       ORDER BY COALESCE(agreement.updated_at, application.updated_at, application.created_at) DESC,
                application.id DESC
       LIMIT ? OFFSET ?`,
      [...filter.params, pageSize, offset]
    ),
  ]);
  const total = Number(countResult[0][0]?.total || 0);
  const cases = rowsResult[0].map(publicCaseSummary);
  return {
    cases,
    pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
      has_next_page: offset + cases.length < total,
      has_previous_page: page > 1,
    },
    policy: {
      list_contains_image_bytes: false,
      detail_loaded_separately: true,
      maximum_page_size: MAX_OPERATIONAL_PAGE_SIZE,
    },
  };
}

async function listCases({ limit = 300, search = "", schemaReady = false } = {}) {
  const requested = Math.min(Math.max(Number(limit) || 300, 1), MAX_OPERATIONAL_PAGE_SIZE);
  const page = await listCasesPage({
    page: 1,
    pageSize: requested,
    search,
    schemaReady,
  });
  return page.cases;
}

function alertItem({ severity = "warning", code, title, message, identity, action }) {
  return {
    id: `${identity.application_id || "a"}:${identity.agreement_id || "g"}:${code}`,
    severity,
    code,
    title,
    message,
    case_type: identity.agreement_id ? "agreement" : "application",
    case_id: identity.agreement_id || identity.application_id,
    application_id: identity.application_id,
    agreement_id: identity.agreement_id,
    case_number: identity.agreement_number || identity.application_number,
    customer_name: identity.customer_name,
    recommended_action: action,
  };
}

async function loadAlertCaseFacts(caseRows) {
  const applicationIds = [
    ...new Set(caseRows.map((item) => positiveId(item.application_id)).filter(Boolean)),
  ];
  if (!applicationIds.length) return [];
  const placeholders = applicationIds.map(() => "?").join(",");
  const [rows] = await pool.query(
    `SELECT
       application.id AS application_id,
       application.application_number,
       application.application_status,
       application.customer_id,
       application.asset_id,
       application.total_monthly_income,
       application.financed_amount AS application_financed_amount,
       kyc.customer_name_snapshot,
       kyc.customer_phone_snapshot,
       kyc.customer_email_snapshot,
       kyc.customer_address_snapshot,
       kyc.residential_address,
       kyc.id_number,
       kyc.guarantor_name,
       kyc.customer_consent_confirmed,
       kyc.credit_assessment_consent_confirmed,
       agreement.id AS agreement_id,
       agreement.agreement_number,
       agreement.financed_amount,
       agreement.outstanding_balance,
       agreement.agreement_issued_at,
       agreement.agreement_signed_at,
       agreement.controlled_ownership_completed_at,
       customer.customer_name,
       customer.phone AS customer_phone,
       customer.email AS customer_email,
       customer.address AS customer_address,
       asset.asset_code,
       asset.asset_name,
       asset.serial_number,
       asset.chassis_number,
       CASE WHEN COALESCE(asset.main_image_url, '') <> '' THEN 1 ELSE 0 END AS has_main_image
     FROM equipment_credit_applications application
     LEFT JOIN equipment_credit_application_kyc kyc ON kyc.application_id = application.id
     LEFT JOIN equipment_sale_agreements agreement
       ON agreement.credit_application_id = application.id
      AND agreement.sale_type = 'installment'
     LEFT JOIN hire_customers customer ON customer.id = application.customer_id
     LEFT JOIN fleet_assets asset ON asset.id = application.asset_id
     WHERE application.id IN (${placeholders})
     ORDER BY application.id, agreement.id DESC`,
    applicationIds
  );
  const byApplication = new Map();
  for (const row of rows) {
    if (byApplication.has(Number(row.application_id))) continue;
    byApplication.set(Number(row.application_id), {
      ...row,
      case_type: row.agreement_id ? "agreement" : "application",
      case_id: row.agreement_id || row.application_id,
      case_number: row.agreement_number || row.application_number,
      customer_name: row.customer_name_snapshot || row.customer_name || "Customer",
      customer_phone: row.customer_phone_snapshot || row.customer_phone || null,
      customer_email: row.customer_email_snapshot || row.customer_email || null,
      customer_address:
        row.residential_address || row.customer_address_snapshot || row.customer_address || null,
    });
  }
  return applicationIds.map((id) => byApplication.get(id)).filter(Boolean);
}

async function getDataQualityAlerts({ cases = null, schemaReady = false } = {}) {
  if (!schemaReady) await assertOperationalPolishSchema();
  const caseRows =
    cases ||
    (await listCases({ limit: DEFAULT_CASE_PAGE_SIZE, schemaReady: true }));
  if (!caseRows.length) return [];
  const identities = await loadAlertCaseFacts(caseRows);
  const applicationIds = identities.map((item) => item.application_id).filter(Boolean);
  const documentsByApplication = new Map();
  if (applicationIds.length) {
    const applicationPlaceholders = applicationIds.map(() => "?").join(",");
    const [documents] = await pool.query(
      `SELECT application_id, document_category
       FROM equipment_finance_private_documents
       WHERE document_status = 'active'
         AND application_id IN (${applicationPlaceholders})`,
      applicationIds
    );
    for (const document of documents) {
      if (document.application_id) {
        const applicationId = Number(document.application_id);
        if (!documentsByApplication.has(applicationId)) {
          documentsByApplication.set(applicationId, new Set());
        }
        documentsByApplication.get(applicationId).add(document.document_category);
      }
    }
  }

  const alerts = [];
  for (const identity of identities) {
    const applicationDocuments =
      documentsByApplication.get(Number(identity.application_id)) || new Set();
    if (!cleanText(identity.id_number)) {
      alerts.push(
        alertItem({
          severity: "critical",
          code: "buyer_identity_missing",
          title: "Buyer ID is missing",
          message: "The application has no Ghana Card or approved identity number.",
          identity,
          action: "Complete buyer KYC before approval or document issue.",
        })
      );
    }
    if (!cleanText(identity.customer_address)) {
      alerts.push(
        alertItem({
          code: "customer_address_missing",
          title: "Residential address is missing",
          message: "The buyer file has no usable residential or digital address.",
          identity,
          action: "Record and verify the buyer address.",
        })
      );
    }
    if (!cleanText(identity.customer_phone)) {
      alerts.push(
        alertItem({
          severity: "critical",
          code: "customer_phone_missing",
          title: "Customer phone is missing",
          message: "Receipts, reminders and follow-up cannot be sent without a customer phone.",
          identity,
          action: "Record a verified customer phone number.",
        })
      );
    }
    if (Number(identity.total_monthly_income || 0) <= 0) {
      alerts.push(
        alertItem({
          code: "affordability_income_missing",
          title: "Affordability income is incomplete",
          message: "No positive monthly income is recorded for the credit assessment.",
          identity,
          action: "Complete the affordability assessment before approval.",
        })
      );
    }
    if (!identity.customer_consent_confirmed || !identity.credit_assessment_consent_confirmed) {
      alerts.push(
        alertItem({
          severity: "critical",
          code: "customer_consent_missing",
          title: "Customer consent is incomplete",
          message: "Required data-use or credit-assessment consent is not confirmed.",
          identity,
          action: "Obtain and record both customer consent declarations.",
        })
      );
    }
    if (!cleanText(identity.serial_number) && !cleanText(identity.chassis_number)) {
      alerts.push(
        alertItem({
          severity: "critical",
          code: "machine_identity_missing",
          title: "Machine serial or chassis identity is missing",
          message: "The exact excavator cannot be safely identified in documents.",
          identity,
          action: "Complete the excavator register before approval.",
        })
      );
    }
    if (!Boolean(Number(identity.has_main_image || 0))) {
      alerts.push(
        alertItem({
          code: "machine_photo_missing",
          title: "Main excavator photo is missing",
          message: "The case has no primary full-machine image.",
          identity,
          action: "Upload the full-machine evidence photo.",
        })
      );
    }

    const financed = Number(identity.financed_amount || identity.application_financed_amount || 0);
    const requiredApplicationDocuments = [
      ["kyc_identity", "Buyer identity evidence"],
      ["kyc_address", "Proof of address"],
      ["kyc_income", "Income evidence"],
    ];
    if (financed >= 100000 || cleanText(identity.guarantor_name)) {
      requiredApplicationDocuments.push(["guarantor_identity", "Guarantor ID"]);
    }
    for (const [category, label] of requiredApplicationDocuments) {
      if (!applicationDocuments.has(category)) {
        alerts.push(
          alertItem({
            code: `document_${category}_missing`,
            title: `${label} is missing`,
            message: `The protected case file does not contain ${label.toLowerCase()}.`,
            identity,
            action: `Upload ${label.toLowerCase()} in the secure Documents tab.`,
          })
        );
      }
    }

    if (identity.agreement_id) {
      if (!identity.agreement_issued_at && !applicationDocuments.has("agreement_attachment")) {
        alerts.push(
          alertItem({
            severity: "critical",
            code: "official_agreement_missing",
            title: "Official agreement is not issued",
            message: "The active account has no issued agreement snapshot or uploaded signed agreement.",
            identity,
            action: "Issue the agreement and preserve the signed copy.",
          })
        );
      }
      if (!identity.agreement_signed_at) {
        alerts.push(
          alertItem({
            code: "agreement_signatures_incomplete",
            title: "Agreement signatures are incomplete",
            message: "Required buyer, witness or guarantor signatures are not complete.",
            identity,
            action: "Complete controlled agreement signatures.",
          })
        );
      }
      if (Number(identity.outstanding_balance || 0) <= 0.01 && !identity.controlled_ownership_completed_at) {
        alerts.push(
          alertItem({
            severity: "high",
            code: "ownership_completion_pending",
            title: "Settled account needs ownership completion",
            message: "The account is settled but controlled ownership evidence is not complete.",
            identity,
            action: "Complete the ownership-transfer pack.",
          })
        );
      }
    }
  }
  return alerts;
}

async function listInbox({
  userId = null,
  workspaceRole = null,
  cases = null,
  page = 1,
  pageSize,
  page_size,
  schemaReady = false,
} = {}) {
  if (!schemaReady) await assertOperationalPolishSchema();
  const pagination = normalizePagination(
    { page, pageSize, page_size },
    DEFAULT_INBOX_PAGE_SIZE
  );
  const candidateLimit = Math.min(
    200,
    Math.max(pagination.pageSize * 2, pagination.offset + pagination.pageSize + 1)
  );
  const [storedTasks, pendingAmendments, pendingDocuments, failedAlerts] = await Promise.all([
    pool.query(
      `SELECT task.*, assignee.full_name AS assigned_to_name, creator.full_name AS created_by_name
       FROM equipment_finance_case_tasks task
       LEFT JOIN users assignee ON assignee.id = task.assigned_to
       LEFT JOIN users creator ON creator.id = task.created_by
       WHERE task.task_status IN ('open','in_progress')
         AND (task.assigned_to IS NULL OR task.assigned_to = ? OR task.assigned_role = ?)
       ORDER BY FIELD(task.priority, 'critical','high','normal','low'), task.due_at, task.id
       LIMIT ?`,
      [positiveId(userId), cleanText(workspaceRole, 80) || null, candidateLimit]
    ),
    pool.query(
      `SELECT amendment.*
       FROM equipment_finance_case_amendments amendment
       WHERE amendment.amendment_status = 'pending_approval'
       ORDER BY FIELD(amendment.risk_level, 'critical','high','medium','low'), amendment.requested_at
       LIMIT ?`,
      [candidateLimit]
    ),
    pool.query(
      `SELECT document.id, document.application_id, document.agreement_id,
              document.document_number, document.document_category,
              document.document_type, document.uploaded_at,
              document.review_status, document.approval_status
       FROM equipment_finance_private_documents document
       WHERE document.document_status = 'active'
         AND (
           document.review_status = 'pending'
           OR (document.review_status = 'verified' AND document.approval_status = 'pending')
         )
       ORDER BY document.uploaded_at, document.id
       LIMIT ?`,
      [candidateLimit]
    ),
    pool.query(
      `SELECT alert.id, alert.payment_id, alert.agreement_id, alert.alert_status,
              alert.last_error, alert.updated_at, agreement.agreement_number
       FROM equipment_finance_payment_alerts alert
       INNER JOIN equipment_sale_agreements agreement ON agreement.id = alert.agreement_id
       WHERE alert.alert_status = 'failed'
       ORDER BY alert.updated_at
       LIMIT ?`,
      [candidateLimit]
    ),
  ]);
  const items = storedTasks[0].map((task) => ({
    id: `task:${task.id}`,
    stored_task_id: task.id,
    source: "task",
    priority: task.priority,
    title: task.title,
    description: task.description,
    task_status: task.task_status,
    approval_status: task.approval_status,
    application_id: task.application_id,
    agreement_id: task.agreement_id,
    due_at: task.due_at,
    assigned_to_name: task.assigned_to_name,
    action_tab: "case",
  }));
  for (const amendment of pendingAmendments[0]) {
    items.push({
      id: `amendment:${amendment.id}`,
      source: "amendment",
      priority: ["critical", "high"].includes(amendment.risk_level) ? "critical" : "high",
      title: `Approve ${humanize(amendment.amendment_type)} amendment`,
      description: amendment.reason,
      application_id: amendment.application_id,
      agreement_id: amendment.agreement_id,
      due_at: amendment.requested_at,
      action_tab: "amendments",
      requires_manage_permission: true,
    });
  }
  for (const document of pendingDocuments[0]) {
    const awaitingApproval = document.review_status === "verified";
    items.push({
      id: `document:${document.id}`,
      source: "document",
      priority: awaitingApproval ? "high" : "normal",
      title: `${awaitingApproval ? "Approve" : "Verify"} ${document.document_type}`,
      description: `${humanize(document.document_category)} ${document.document_number} awaits independent ${awaitingApproval ? "approval" : "review"}.`,
      application_id: document.application_id,
      agreement_id: document.agreement_id,
      due_at: document.uploaded_at,
      action_tab: "documents",
      requires_manage_permission: true,
    });
  }
  for (const alert of failedAlerts[0]) {
    items.push({
      id: `boss-alert:${alert.id}`,
      source: "boss_alert",
      priority: "high",
      title: `Boss payment alert failed for ${alert.agreement_number}`,
      description: alert.last_error || "The payment was committed but the boss SMS was not accepted.",
      agreement_id: alert.agreement_id,
      payment_id: alert.payment_id,
      due_at: alert.updated_at,
      action_tab: "receipts",
      requires_manage_permission: true,
    });
  }

  const qualityCases =
    cases ||
    (await listCases({ limit: MAX_OPERATIONAL_PAGE_SIZE, schemaReady: true }));
  const dataQuality = await getDataQualityAlerts({
    cases: qualityCases,
    schemaReady: true,
  });
  for (const alert of dataQuality.filter((item) => ["critical", "high"].includes(item.severity))) {
    items.push({
      id: `quality:${alert.id}`,
      source: "data_quality",
      priority: alert.severity === "critical" ? "critical" : "high",
      title: alert.title,
      description: alert.message,
      application_id: alert.application_id,
      agreement_id: alert.agreement_id,
      due_at: null,
      action_tab: "case",
    });
  }
  items.sort((a, b) => {
    const weights = { critical: 0, high: 1, normal: 2, low: 3 };
    const priority = (weights[a.priority] ?? 2) - (weights[b.priority] ?? 2);
    if (priority !== 0) return priority;
    return String(a.due_at || "9999").localeCompare(String(b.due_at || "9999"));
  });
  const sourceWasTruncated = [
    storedTasks[0],
    pendingAmendments[0],
    pendingDocuments[0],
    failedAlerts[0],
  ].some((rows) => rows.length === candidateLimit);
  const qualityWasTruncated = !cases && qualityCases.length === MAX_OPERATIONAL_PAGE_SIZE;
  const hasMoreCandidates = sourceWasTruncated || qualityWasTruncated;
  const visibleItems = items.slice(
    pagination.offset,
    pagination.offset + pagination.pageSize
  );
  return {
    items: visibleItems,
    summary: {
      total: items.length,
      critical: items.filter((item) => item.priority === "critical").length,
      approvals: items.filter((item) => ["amendment", "document"].includes(item.source)).length,
      failed_alerts: items.filter((item) => item.source === "boss_alert").length,
      data_quality: items.filter((item) => item.source === "data_quality").length,
      total_is_lower_bound: hasMoreCandidates,
    },
    pagination: {
      page: pagination.page,
      page_size: pagination.pageSize,
      returned: visibleItems.length,
      has_previous_page: pagination.page > 1,
      has_next_page:
        visibleItems.length > 0 &&
        (pagination.offset + visibleItems.length < items.length || hasMoreCandidates),
    },
  };
}

async function recordEvent({
  connection = pool,
  applicationId = null,
  agreementId = null,
  eventType,
  title,
  description = null,
  status = null,
  metadata = null,
  sourceType = null,
  sourceId = null,
  occurredAt = null,
  userId = null,
}) {
  const [result] = await connection.query(
    `INSERT INTO equipment_finance_case_events (
       application_id, agreement_id, event_type, event_title, event_description,
       event_status, event_metadata_json, source_type, source_id, occurred_at, recorded_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), ?)`,
    [
      positiveId(applicationId),
      positiveId(agreementId),
      cleanText(eventType, 100),
      cleanText(title, 180),
      cleanText(description, 1500) || null,
      cleanText(status, 60) || null,
      metadata ? safeJson(metadata) : null,
      cleanText(sourceType, 80) || null,
      positiveId(sourceId),
      dateTimeValue(occurredAt),
      positiveId(userId),
    ]
  );
  return result.insertId;
}

async function createTask({ userId, body = {}, req = null }) {
  await assertOperationalPolishSchema();
  const caseType = normalizeCaseType(body.case_type);
  const caseId = positiveId(body.case_id);
  let identity = null;
  if (caseType && caseId) identity = await resolveCaseIdentity(caseType, caseId);
  const title = cleanText(body.title, 180);
  if (title.length < 3) throw new OperationalPolishError(400, "Task title is required.");
  const priority = TASK_PRIORITIES.has(cleanText(body.priority, 20).toLowerCase())
    ? cleanText(body.priority, 20).toLowerCase()
    : "normal";
  const approvalRequired = booleanValue(body.approval_required, false);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO equipment_finance_case_tasks (
         application_id, agreement_id, task_type, task_status, priority,
         title, description, assigned_role, assigned_to, due_at,
         approval_required, approval_status, created_by
       ) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        identity?.application_id || null,
        identity?.agreement_id || null,
        cleanText(body.task_type, 80) || "manual_follow_up",
        priority,
        title,
        cleanText(body.description, 1500) || null,
        cleanText(body.assigned_role, 80) || null,
        positiveId(body.assigned_to),
        dateTimeValue(body.due_at),
        approvalRequired ? 1 : 0,
        approvalRequired ? "pending" : "not_required",
        positiveId(userId),
      ]
    );
    await recordEvent({
      connection,
      applicationId: identity?.application_id,
      agreementId: identity?.agreement_id,
      eventType: "task_created",
      title: `Task created: ${title}`,
      description: cleanText(body.description, 1500),
      status: "open",
      sourceType: "task",
      sourceId: result.insertId,
      userId,
    });
    await writeAuditEvent({
      connection,
      req,
      action: "EQUIPMENT_FINANCE_TASK_CREATED",
      details: `Created Finance task ${title}.`,
      workspaceCode: "equipment_installment_finance",
      entityType: "equipment_finance_case_task",
      entityId: result.insertId,
      metadata: {
        application_id: identity?.application_id || null,
        agreement_id: identity?.agreement_id || null,
        priority,
      },
    });
    await connection.commit();
    return { id: result.insertId, title, priority };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function updateTask({ taskId, userId, body = {}, req = null }) {
  await assertOperationalPolishSchema();
  const id = positiveId(taskId);
  if (!id) throw new OperationalPolishError(400, "Choose a valid task.");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT * FROM equipment_finance_case_tasks WHERE id = ? LIMIT 1 FOR UPDATE",
      [id]
    );
    const task = rows[0];
    if (!task) throw new OperationalPolishError(404, "Finance task was not found.");
    const nextStatus = cleanText(body.task_status, 30).toLowerCase();
    const taskStatus = TASK_STATUSES.has(nextStatus) ? nextStatus : task.task_status;
    const decision = cleanText(body.approval_status, 30).toLowerCase();
    const approvalStatus = APPROVAL_STATUSES.has(decision) ? decision : task.approval_status;
    if (
      ["approved", "rejected"].includes(approvalStatus) &&
      cleanText(body.approval_reason, 1000).length < 4
    ) {
      throw new OperationalPolishError(400, "Record a clear approval or rejection reason.");
    }
    await connection.query(
      `UPDATE equipment_finance_case_tasks
       SET task_status = ?, assigned_role = COALESCE(?, assigned_role),
           assigned_to = COALESCE(?, assigned_to), due_at = COALESCE(?, due_at),
           approval_status = ?, approval_reason = ?,
           approved_by = CASE WHEN ? IN ('approved','rejected') THEN ? ELSE approved_by END,
           approved_at = CASE WHEN ? IN ('approved','rejected') THEN NOW() ELSE approved_at END,
           completed_by = CASE WHEN ? = 'completed' THEN ? ELSE completed_by END,
           completed_at = CASE WHEN ? = 'completed' THEN NOW() ELSE completed_at END
       WHERE id = ?`,
      [
        taskStatus,
        cleanText(body.assigned_role, 80) || null,
        positiveId(body.assigned_to),
        dateTimeValue(body.due_at),
        approvalStatus,
        cleanText(body.approval_reason, 1000) || null,
        approvalStatus,
        positiveId(userId),
        approvalStatus,
        taskStatus,
        positiveId(userId),
        taskStatus,
        id,
      ]
    );
    await recordEvent({
      connection,
      applicationId: task.application_id,
      agreementId: task.agreement_id,
      eventType: "task_updated",
      title: `Task ${taskStatus}: ${task.title}`,
      description: cleanText(body.approval_reason, 1000) || null,
      status: approvalStatus !== "not_required" ? approvalStatus : taskStatus,
      sourceType: "task",
      sourceId: id,
      userId,
    });
    await writeAuditEvent({
      connection,
      req,
      action: "EQUIPMENT_FINANCE_TASK_UPDATED",
      details: `Updated Finance task ${task.title} to ${taskStatus}/${approvalStatus}.`,
      workspaceCode: "equipment_installment_finance",
      entityType: "equipment_finance_case_task",
      entityId: id,
      metadata: { task_status: taskStatus, approval_status: approvalStatus },
    });
    await connection.commit();
    return { id, task_status: taskStatus, approval_status: approvalStatus };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function uploadCaseDocument({ caseType, caseId, userId, body = {}, req = null }) {
  await assertOperationalPolishSchema();
  const identity = await resolveCaseIdentity(caseType, caseId);
  const document = parseProtectedDocument(body);
  const category = cleanText(body.document_category, 80)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const label = cleanText(body.document_label || humanize(category), 180);
  if (!category || !label) {
    throw new OperationalPolishError(400, "Document category and label are required.");
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [duplicates] = await connection.query(
      `SELECT id, document_label
       FROM equipment_finance_case_documents
       WHERE checksum_sha256 = ?
         AND document_status <> 'superseded'
         AND ((application_id = ? AND ? IS NOT NULL) OR (agreement_id = ? AND ? IS NOT NULL))
       LIMIT 1 FOR UPDATE`,
      [
        document.checksum_sha256,
        identity.application_id,
        identity.application_id,
        identity.agreement_id,
        identity.agreement_id,
      ]
    );
    if (duplicates.length) {
      throw new OperationalPolishError(
        409,
        `This exact file is already stored as ${duplicates[0].document_label}.`,
        "FINANCE_DOCUMENT_DUPLICATE"
      );
    }
    const [result] = await connection.query(
      `INSERT INTO equipment_finance_case_documents (
         application_id, agreement_id, customer_id, asset_id,
         document_category, document_label, original_file_name,
         stored_mime_type, byte_size, checksum_sha256, file_content,
         storage_scope, document_status, is_sensitive, notes, uploaded_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'database_private', 'uploaded', ?, ?, ?)`,
      [
        identity.application_id,
        identity.agreement_id,
        identity.customer_id,
        identity.asset_id,
        category,
        label,
        document.file_name,
        document.mime_type,
        document.byte_size,
        document.checksum_sha256,
        document.buffer,
        booleanValue(body.is_sensitive, true) ? 1 : 0,
        cleanText(body.notes, 1000) || null,
        positiveId(userId),
      ]
    );
    await recordEvent({
      connection,
      applicationId: identity.application_id,
      agreementId: identity.agreement_id,
      eventType: "document_uploaded",
      title: `${label} uploaded`,
      description: `${document.file_name} · ${document.byte_size} bytes · private database storage`,
      status: "uploaded",
      metadata: {
        category,
        checksum_sha256: document.checksum_sha256,
        mime_type: document.mime_type,
      },
      sourceType: "case_document",
      sourceId: result.insertId,
      userId,
    });
    await writeAuditEvent({
      connection,
      req,
      action: "EQUIPMENT_FINANCE_CASE_DOCUMENT_UPLOADED",
      details: `Uploaded protected Finance evidence ${label}.`,
      workspaceCode: "equipment_installment_finance",
      entityType: "equipment_finance_case_document",
      entityId: result.insertId,
      metadata: {
        application_id: identity.application_id,
        agreement_id: identity.agreement_id,
        document_category: category,
        checksum_sha256: document.checksum_sha256,
        byte_size: document.byte_size,
      },
    });
    await connection.commit();
    return {
      id: result.insertId,
      document_category: category,
      document_label: label,
      original_file_name: document.file_name,
      stored_mime_type: document.mime_type,
      byte_size: document.byte_size,
      checksum_sha256: document.checksum_sha256,
      document_status: "uploaded",
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function listCaseDocuments(caseType, caseId, knownIdentity = null) {
  if (!knownIdentity) await assertOperationalPolishSchema();
  const identity = knownIdentity || (await resolveCaseIdentity(caseType, caseId));
  const [rows] = await pool.query(
    `SELECT document.id, document.application_id, document.agreement_id,
            document.document_category, document.document_label,
            document.original_file_name, document.stored_mime_type,
            document.byte_size, document.checksum_sha256,
            document.storage_scope, document.document_status,
            document.is_sensitive, document.notes, document.created_at,
            document.verified_at, document.rejected_reason,
            uploader.full_name AS uploaded_by_name,
            verifier.full_name AS verified_by_name
     FROM equipment_finance_case_documents document
     LEFT JOIN users uploader ON uploader.id = document.uploaded_by
     LEFT JOIN users verifier ON verifier.id = document.verified_by
     WHERE (document.application_id = ? OR document.agreement_id = ?)
       AND document.document_status <> 'superseded'
     ORDER BY document.created_at DESC, document.id DESC`,
    [identity.application_id, identity.agreement_id || -1]
  );
  return rows.map((row) => ({
    ...row,
    byte_size: Number(row.byte_size || 0),
    is_sensitive: Boolean(row.is_sensitive),
    download_path: `/equipment-catalogue/sales/operational-polish/documents/${row.id}/download`,
  }));
}

async function getCaseDocument(documentId) {
  await assertOperationalPolishSchema();
  const id = positiveId(documentId);
  if (!id) throw new OperationalPolishError(400, "Choose a valid case document.");
  const [rows] = await pool.query(
    `SELECT * FROM equipment_finance_case_documents
     WHERE id = ? AND document_status <> 'superseded'
     LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row) throw new OperationalPolishError(404, "Protected case document was not found.");
  const buffer = Buffer.from(row.file_content || "");
  if (!buffer.length || checksum(buffer) !== row.checksum_sha256) {
    throw new OperationalPolishError(
      409,
      "The protected case document failed its integrity check.",
      "FINANCE_CASE_DOCUMENT_INTEGRITY_FAILED"
    );
  }
  return { ...row, file_content: buffer };
}

async function reviewCaseDocument({ documentId, userId, body = {}, req = null }) {
  await assertOperationalPolishSchema();
  const id = positiveId(documentId);
  const status = cleanText(body.document_status, 30).toLowerCase();
  if (!id || !["verified", "rejected"].includes(status)) {
    throw new OperationalPolishError(400, "Choose Verify or Reject for a valid document.");
  }
  if (status === "rejected" && cleanText(body.reason, 500).length < 4) {
    throw new OperationalPolishError(400, "Record a clear document rejection reason.");
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT * FROM equipment_finance_case_documents WHERE id = ? LIMIT 1 FOR UPDATE",
      [id]
    );
    const document = rows[0];
    if (!document) throw new OperationalPolishError(404, "Case document was not found.");
    await connection.query(
      `UPDATE equipment_finance_case_documents
       SET document_status = ?, verified_by = ?, verified_at = NOW(),
           rejected_reason = ?
       WHERE id = ?`,
      [status, positiveId(userId), status === "rejected" ? cleanText(body.reason, 500) : null, id]
    );
    await recordEvent({
      connection,
      applicationId: document.application_id,
      agreementId: document.agreement_id,
      eventType: status === "verified" ? "document_verified" : "document_rejected",
      title: `${document.document_label} ${status}`,
      description: cleanText(body.reason, 500) || null,
      status,
      sourceType: "case_document",
      sourceId: id,
      userId,
    });
    await writeAuditEvent({
      connection,
      req,
      action:
        status === "verified"
          ? "EQUIPMENT_FINANCE_CASE_DOCUMENT_VERIFIED"
          : "EQUIPMENT_FINANCE_CASE_DOCUMENT_REJECTED",
      details: `${status === "verified" ? "Verified" : "Rejected"} ${document.document_label}.`,
      workspaceCode: "equipment_installment_finance",
      entityType: "equipment_finance_case_document",
      entityId: id,
      metadata: { reason: cleanText(body.reason, 500) || null },
    });
    await connection.commit();
    return { id, document_status: status };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

function pushTimeline(events, input) {
  if (!input.occurred_at) return;
  events.push({
    id: input.id || `${input.type}:${input.source_id || events.length}`,
    type: input.type,
    title: input.title,
    description: input.description || null,
    status: input.status || null,
    occurred_at: input.occurred_at,
    source_type: input.source_type || null,
    source_id: input.source_id || null,
    metadata: input.metadata || null,
  });
}

async function getCaseTimeline(caseType, caseId, knownIdentity = null) {
  if (!knownIdentity) await assertOperationalPolishSchema();
  const identity = knownIdentity || (await resolveCaseIdentity(caseType, caseId));
  const agreementId = identity.agreement_id || -1;
  const applicationId = identity.application_id;
  const [paymentsResult, scheduleResult, deliveriesResult, ownershipResult, signaturesResult,
    issuedResult, alertsResult, documentsResult, tasksResult, amendmentsResult, sharesResult,
    eventsResult] = await Promise.all([
    pool.query(
      `SELECT payment.*, user.full_name AS received_by_name
       FROM equipment_sale_payments payment
       LEFT JOIN users user ON user.id = payment.received_by
       WHERE payment.agreement_id = ? AND payment.is_voided = FALSE
       ORDER BY payment.payment_date DESC, payment.id DESC`,
      [agreementId]
    ),
    pool.query(
      `SELECT * FROM equipment_installment_schedule
       WHERE agreement_id = ? ORDER BY sequence_number`,
      [agreementId]
    ),
    pool.query(
      `SELECT * FROM equipment_deliveries WHERE agreement_id = ? ORDER BY created_at, id`,
      [agreementId]
    ),
    pool.query(
      `SELECT * FROM equipment_ownership_transfers WHERE agreement_id = ? ORDER BY created_at, id`,
      [agreementId]
    ),
    pool.query(
      `SELECT * FROM equipment_finance_document_signatures
       WHERE agreement_id = ? ORDER BY signed_at, id`,
      [agreementId]
    ),
    pool.query(
       `SELECT id, document_number, document_type, document_format, template_version,
              snapshot_checksum, issued_at, archived_at
       FROM equipment_finance_issued_documents
       WHERE agreement_id = ?
       ORDER BY issued_at DESC, id DESC`,
      [agreementId]
    ),
    pool.query(
      `SELECT * FROM equipment_finance_payment_alerts
       WHERE agreement_id = ? ORDER BY created_at, id`,
      [agreementId]
    ),
    pool.query(
      `SELECT id, document_type AS document_label, document_category,
              CASE
                WHEN review_status = 'rejected' OR approval_status = 'rejected' THEN 'rejected'
                WHEN review_status = 'verified' AND approval_status = 'approved' THEN 'verified'
                ELSE 'uploaded'
              END AS document_status,
              uploaded_at AS created_at, reviewed_at AS verified_at,
              COALESCE(review_notes, approval_notes) AS rejected_reason
       FROM equipment_finance_private_documents
       WHERE application_id = ? AND document_status = 'active'
       ORDER BY uploaded_at, id`,
      [applicationId]
    ),
    pool.query(
      `SELECT * FROM equipment_finance_case_tasks
       WHERE application_id = ? OR agreement_id = ?
       ORDER BY created_at, id`,
      [applicationId, agreementId]
    ),
    pool.query(
      `SELECT * FROM equipment_finance_case_amendments
       WHERE application_id = ? OR agreement_id = ?
       ORDER BY requested_at, id`,
      [applicationId, agreementId]
    ),
    pool.query(
      `SELECT * FROM equipment_finance_document_shares
       WHERE application_id = ? OR agreement_id = ?
       ORDER BY requested_at, id`,
      [applicationId, agreementId]
    ),
    pool.query(
      `SELECT * FROM equipment_finance_case_events
       WHERE application_id = ? OR agreement_id = ?
       ORDER BY occurred_at, id`,
      [applicationId, agreementId]
    ),
  ]);

  const events = [];
  pushTimeline(events, {
    type: "application_created",
    title: `Application ${identity.application_number} created`,
    status: identity.application_status,
    occurred_at: identity.application_created_at,
    source_type: "credit_application",
    source_id: identity.application_id,
  });
  if (identity.reviewed_at) {
    pushTimeline(events, {
      type: "application_reviewed",
      title: `Application ${humanize(identity.application_status)}`,
      description: identity.decision_reason,
      status: identity.application_status,
      occurred_at: identity.reviewed_at,
      source_type: "credit_application",
      source_id: identity.application_id,
    });
  }
  if (identity.agreement_id) {
    pushTimeline(events, {
      type: "agreement_created",
      title: `Agreement ${identity.agreement_number} created`,
      status: identity.agreement_status,
      occurred_at: identity.agreement_created_at,
      source_type: "agreement",
      source_id: identity.agreement_id,
    });
    pushTimeline(events, {
      type: "agreement_approved",
      title: "Agreement approved",
      occurred_at: identity.agreement_approved_at,
      source_type: "agreement",
      source_id: identity.agreement_id,
    });
    pushTimeline(events, {
      type: "deposit_completed",
      title: "Opening deposit completed",
      occurred_at: identity.deposit_completed_at,
      source_type: "agreement",
      source_id: identity.agreement_id,
    });
    pushTimeline(events, {
      type: "machine_reserved",
      title: "Exact excavator reserved",
      occurred_at: identity.reservation_activated_at,
      source_type: "agreement",
      source_id: identity.agreement_id,
    });
    pushTimeline(events, {
      type: "agreement_issued",
      title: `Agreement document ${identity.agreement_document_number || "issued"}`,
      occurred_at: identity.agreement_issued_at,
      source_type: "agreement",
      source_id: identity.agreement_id,
    });
    pushTimeline(events, {
      type: "agreement_signed",
      title: "Required agreement signatures completed",
      occurred_at: identity.agreement_signed_at,
      source_type: "agreement",
      source_id: identity.agreement_id,
    });
    pushTimeline(events, {
      type: "delivery_completed",
      title: "Controlled delivery completed",
      occurred_at: identity.delivered_at,
      source_type: "agreement",
      source_id: identity.agreement_id,
    });
    pushTimeline(events, {
      type: "ownership_completed",
      title: "Controlled ownership transfer completed",
      occurred_at: identity.controlled_ownership_completed_at,
      source_type: "agreement",
      source_id: identity.agreement_id,
    });
  }

  for (const payment of paymentsResult[0]) {
    pushTimeline(events, {
      id: `payment:${payment.id}`,
      type: "payment_recorded",
      title: `${humanize(payment.payment_stage || payment.payment_category)} received`,
      description: `${payment.receipt_number} · GHS ${Number(payment.amount || 0).toFixed(2)} · ${humanize(payment.payment_method)}`,
      status: payment.is_voided ? "voided" : "committed",
      occurred_at: payment.payment_date,
      source_type: "payment",
      source_id: payment.id,
      metadata: {
        receipt_number: payment.receipt_number,
        amount: Number(payment.amount || 0),
        received_by_name: payment.received_by_name,
      },
    });
  }
  for (const line of scheduleResult[0]) {
    if (!line.fully_paid_at) continue;
    pushTimeline(events, {
      id: `schedule:${line.id}`,
      type: "schedule_line_paid",
      title: `Installment ${line.sequence_number} paid`,
      description: `Scheduled GHS ${Number(line.scheduled_amount || 0).toFixed(2)} due ${String(line.due_date).slice(0, 10)}.`,
      status: line.schedule_status,
      occurred_at: line.fully_paid_at,
      source_type: "schedule",
      source_id: line.id,
    });
  }
  for (const delivery of deliveriesResult[0]) {
    pushTimeline(events, {
      id: `delivery:${delivery.id}`,
      type: "delivery_recorded",
      title: `Delivery ${delivery.delivery_number}`,
      description: `${delivery.receiving_person || "Customer"} received the machine in ${humanize(delivery.condition_status)} condition.`,
      status: delivery.status,
      occurred_at: delivery.delivery_datetime || delivery.created_at,
      source_type: "delivery",
      source_id: delivery.id,
    });
  }
  for (const ownership of ownershipResult[0]) {
    pushTimeline(events, {
      id: `ownership:${ownership.id}`,
      type: "ownership_transfer",
      title: `Ownership transfer ${ownership.transfer_number}`,
      status: ownership.status,
      occurred_at: ownership.transfer_date || ownership.created_at,
      source_type: "ownership_transfer",
      source_id: ownership.id,
    });
  }
  for (const signature of signaturesResult[0]) {
    pushTimeline(events, {
      id: `signature:${signature.id}`,
      type: "signature_captured",
      title: `${humanize(signature.signer_role)} signature captured`,
      description: signature.signer_name,
      status: "signed",
      occurred_at: signature.signed_at,
      source_type: "signature",
      source_id: signature.id,
    });
  }
  for (const document of issuedResult[0]) {
    pushTimeline(events, {
      id: `issued:${document.id}`,
      type: "document_issued",
      title: `${humanize(document.document_type)} issued`,
      description: `${document.document_number} · ${document.document_format.toUpperCase()} · ${document.template_version}`,
      status: document.archived_at ? "archived" : "issued",
      occurred_at: document.issued_at,
      source_type: "issued_document",
      source_id: document.id,
    });
  }
  for (const alert of alertsResult[0]) {
    pushTimeline(events, {
      id: `alert:${alert.id}`,
      type: "boss_payment_alert",
      title: `Boss payment alert ${humanize(alert.alert_status)}`,
      description: alert.last_error || alert.alert_message,
      status: alert.alert_status,
      occurred_at: alert.delivered_at || alert.submitted_at || alert.updated_at || alert.created_at,
      source_type: "boss_alert",
      source_id: alert.id,
      metadata: { payment_id: alert.payment_id, attempt_count: alert.attempt_count },
    });
  }
  for (const document of documentsResult[0]) {
    pushTimeline(events, {
      id: `case-document:${document.id}`,
      type: "case_document",
      title: `${document.document_label} ${humanize(document.document_status)}`,
      description: document.rejected_reason,
      status: document.document_status,
      occurred_at: document.verified_at || document.created_at,
      source_type: "case_document",
      source_id: document.id,
    });
  }
  for (const task of tasksResult[0]) {
    pushTimeline(events, {
      id: `task:${task.id}`,
      type: "task",
      title: `${task.title} · ${humanize(task.task_status)}`,
      description: task.description,
      status: task.approval_status !== "not_required" ? task.approval_status : task.task_status,
      occurred_at: task.completed_at || task.approved_at || task.updated_at || task.created_at,
      source_type: "task",
      source_id: task.id,
    });
  }
  for (const amendment of amendmentsResult[0]) {
    pushTimeline(events, {
      id: `amendment:${amendment.id}`,
      type: "amendment",
      title: `${amendment.amendment_number} · ${humanize(amendment.amendment_status)}`,
      description: amendment.reason,
      status: amendment.amendment_status,
      occurred_at: amendment.applied_at || amendment.approved_at || amendment.requested_at,
      source_type: "amendment",
      source_id: amendment.id,
    });
  }
  for (const share of sharesResult[0]) {
    pushTimeline(events, {
      id: `share:${share.id}`,
      type: "document_shared",
      title: `${humanize(share.source_type)} ${humanize(share.share_status)}`,
      description: `${humanize(share.channel)}${share.recipient ? ` · ${share.recipient}` : ""}`,
      status: share.share_status,
      occurred_at: share.delivered_at || share.sent_at || share.requested_at,
      source_type: "share",
      source_id: share.id,
    });
  }
  for (const event of eventsResult[0]) {
    pushTimeline(events, {
      id: `event:${event.id}`,
      type: event.event_type,
      title: event.event_title,
      description: event.event_description,
      status: event.event_status,
      occurred_at: event.occurred_at,
      source_type: event.source_type,
      source_id: event.source_id,
      metadata: parseJson(event.event_metadata_json, null),
    });
  }

  events.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
  return {
    case: identity,
    events,
    payments: paymentsResult[0].map((payment) => ({
      id: payment.id,
      receipt_number: payment.receipt_number,
      payment_date: payment.payment_date,
      amount: Number(payment.amount || 0),
      payment_method: payment.payment_method,
      payment_stage: payment.payment_stage,
    })),
    issued_documents: issuedResult[0].filter((document) => !document.archived_at),
    summary: {
      total_events: events.length,
      payments: paymentsResult[0].length,
      issued_documents: issuedResult[0].length,
      uploaded_documents: documentsResult[0].length,
      open_tasks: tasksResult[0].filter((item) => ["open", "in_progress"].includes(item.task_status)).length,
      pending_amendments: amendmentsResult[0].filter((item) => item.amendment_status === "pending_approval").length,
    },
  };
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date, months) {
  const originalDay = date.getUTCDate();
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(originalDay, lastDay));
  return next;
}

function simulateSchedule(input = {}) {
  const purchasePrice = moneyValue(input.purchase_price, { minimum: 0.01 });
  const deposit = moneyValue(input.deposit, { minimum: 0 });
  const financeCharge = moneyValue(input.finance_charge || 0, { minimum: 0 });
  const count = Number(input.installment_count);
  const frequency = cleanText(input.payment_frequency, 30).toLowerCase();
  const firstDueDate = dateValue(input.first_due_date);
  const customDays = Number(input.custom_interval_days || 0);
  if (
    purchasePrice === undefined ||
    deposit === undefined ||
    deposit > purchasePrice + Number(financeCharge || 0) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 520 ||
    !SCHEDULE_FREQUENCIES.has(frequency) ||
    !firstDueDate ||
    (frequency === "custom" && (!Number.isInteger(customDays) || customDays < 1 || customDays > 365))
  ) {
    throw new OperationalPolishError(
      400,
      "Enter a valid price, deposit, installment count, frequency and first due date."
    );
  }
  const totalRepayable = Number((purchasePrice + Number(financeCharge || 0)).toFixed(2));
  const financedBalance = Number((totalRepayable - deposit).toFixed(2));
  const baseCents = Math.floor((financedBalance * 100) / count);
  const firstDate = new Date(`${firstDueDate}T00:00:00Z`);
  const lines = [];
  let assignedCents = 0;
  for (let index = 0; index < count; index += 1) {
    const cents = index === count - 1 ? Math.round(financedBalance * 100) - assignedCents : baseCents;
    assignedCents += cents;
    let due = firstDate;
    if (frequency === "weekly") due = addDays(firstDate, index * 7);
    if (frequency === "fortnightly") due = addDays(firstDate, index * 14);
    if (frequency === "custom") due = addDays(firstDate, index * customDays);
    if (frequency === "monthly") due = addMonths(firstDate, index);
    lines.push({
      sequence_number: index + 1,
      due_date: due.toISOString().slice(0, 10),
      scheduled_amount: Number((cents / 100).toFixed(2)),
      simulated_paid: 0,
      simulated_balance: Number((cents / 100).toFixed(2)),
      simulated_status: "scheduled",
    });
  }
  let paymentRemaining = moneyValue(input.simulated_payment || 0, { minimum: 0 }) || 0;
  for (const line of lines) {
    if (paymentRemaining <= 0.001) break;
    const allocated = Number(Math.min(paymentRemaining, line.simulated_balance).toFixed(2));
    line.simulated_paid = allocated;
    line.simulated_balance = Number((line.scheduled_amount - allocated).toFixed(2));
    line.simulated_status = line.simulated_balance <= 0.01 ? "paid" : "partial";
    paymentRemaining = Number((paymentRemaining - allocated).toFixed(2));
  }
  const warnings = [];
  if (financedBalance <= 0) warnings.push("The deposit covers the total repayable amount.");
  if (paymentRemaining > 0.01) {
    warnings.push(`GHS ${paymentRemaining.toFixed(2)} exceeds the simulated account balance.`);
  }
  return {
    input: {
      purchase_price: purchasePrice,
      deposit,
      finance_charge: Number(financeCharge || 0),
      installment_count: count,
      payment_frequency: frequency,
      first_due_date: firstDueDate,
      custom_interval_days: frequency === "custom" ? customDays : null,
      simulated_payment: moneyValue(input.simulated_payment || 0, { minimum: 0 }) || 0,
    },
    totals: {
      total_repayable: totalRepayable,
      financed_balance: financedBalance,
      periodic_amount: lines[0]?.scheduled_amount || 0,
      final_payment_amount: lines.at(-1)?.scheduled_amount || 0,
      simulated_payment_unapplied: paymentRemaining,
    },
    schedule: lines,
    warnings,
    allocation_policy: "oldest_due_first",
    rounding_policy: "final_schedule_line_only",
  };
}

async function saveScheduleSimulation({ userId, body = {} }) {
  await assertOperationalPolishSchema();
  const result = simulateSchedule(body);
  const caseType = normalizeCaseType(body.case_type);
  const caseId = positiveId(body.case_id);
  const identity = caseType && caseId ? await resolveCaseIdentity(caseType, caseId) : null;
  const simulationName = cleanText(body.simulation_name, 180) || `Simulation ${new Date().toISOString().slice(0, 10)}`;
  const resultJson = safeJson(result);
  const [insert] = await pool.query(
    `INSERT INTO equipment_finance_schedule_simulations (
       application_id, agreement_id, simulation_name, input_json,
       result_json, result_checksum, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      identity?.application_id || null,
      identity?.agreement_id || null,
      simulationName,
      safeJson(result.input),
      resultJson,
      checksum(resultJson),
      positiveId(userId),
    ]
  );
  if (identity) {
    await recordEvent({
      applicationId: identity.application_id,
      agreementId: identity.agreement_id,
      eventType: "schedule_simulation_saved",
      title: `Schedule simulation saved: ${simulationName}`,
      status: "saved",
      sourceType: "schedule_simulation",
      sourceId: insert.insertId,
      metadata: result.totals,
      userId,
    });
  }
  return { id: insert.insertId, simulation_name: simulationName, result };
}

async function listScheduleSimulations(caseType, caseId, knownIdentity = null) {
  if (!knownIdentity) await assertOperationalPolishSchema();
  const identity = knownIdentity || (await resolveCaseIdentity(caseType, caseId));
  const [rows] = await pool.query(
    `SELECT simulation.*, user.full_name AS created_by_name
     FROM equipment_finance_schedule_simulations simulation
     LEFT JOIN users user ON user.id = simulation.created_by
     WHERE simulation.archived_at IS NULL
       AND (simulation.application_id = ? OR simulation.agreement_id = ?)
     ORDER BY simulation.created_at DESC`,
    [identity.application_id, identity.agreement_id || -1]
  );
  return rows.map((row) => {
    const result = parseJson(row.result_json, null);
    const valid = result && checksum(row.result_json) === row.result_checksum;
    return {
      id: row.id,
      simulation_name: row.simulation_name,
      created_by_name: row.created_by_name,
      created_at: row.created_at,
      integrity_valid: Boolean(valid),
      result: valid ? result : null,
    };
  });
}

async function columnSet(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function updateExistingColumns(connection, tableName, idColumn, id, changes) {
  const columns = await columnSet(connection, tableName);
  const entries = Object.entries(changes).filter(
    ([column, value]) => columns.has(column) && value !== undefined
  );
  if (!entries.length) return [];
  if (!/^[A-Za-z0-9_]+$/.test(tableName) || !/^[A-Za-z0-9_]+$/.test(idColumn)) {
    throw new OperationalPolishError(500, "Unsafe amendment target configuration.");
  }
  const assignments = entries.map(([column]) => `\`${column}\` = ?`).join(", ");
  await connection.query(
    `UPDATE \`${tableName}\` SET ${assignments} WHERE \`${idColumn}\` = ?`,
    [...entries.map(([, value]) => value), id]
  );
  return entries.map(([column]) => `${tableName}.${column}`);
}

async function amendmentNumber(userId) {
  try {
    return await nextDocumentNumber("EQUIPMENT_FINANCE_AMENDMENT", {
      userId: positiveId(userId),
    });
  } catch {
    return `EFA-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${crypto
      .randomInt(0, 10000)
      .toString()
      .padStart(4, "0")}`;
  }
}

function amendmentRisk(changes = {}) {
  const fields = Object.keys(changes);
  if (fields.some((field) => HIGH_RISK_AMENDMENT_FIELDS.has(field))) return "high";
  if (fields.some((field) => DIRECT_SAFE_AMENDMENT_FIELDS.has(field))) return "medium";
  return "low";
}

async function createAmendment({ caseType, caseId, userId, body = {}, req = null }) {
  await assertOperationalPolishSchema();
  const identity = await resolveCaseIdentity(caseType, caseId);
  const reason = cleanText(body.reason, 1000);
  const changes = body.proposed_changes;
  if (reason.length < 8 || !changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new OperationalPolishError(
      400,
      "Record a clear reason and at least one proposed correction or amendment."
    );
  }
  const entries = Object.entries(changes).filter(
    ([key, value]) => cleanText(key, 80) && value !== undefined && value !== null && String(value).trim() !== ""
  );
  if (!entries.length || entries.length > 20) {
    throw new OperationalPolishError(400, "Submit between one and twenty amendment fields.");
  }
  const proposed = Object.fromEntries(entries);
  const before = {
    application_number: identity.application_number,
    application_status: identity.application_status,
    agreement_number: identity.agreement_number,
    agreement_status: identity.agreement_status,
    customer_name: identity.customer_name,
    customer_phone: identity.customer_phone,
    customer_email: identity.customer_email,
    customer_address: identity.customer_address,
    guarantor_phone: identity.guarantor_phone,
    total_amount: identity.total_amount,
    deposit_required: identity.deposit_required,
    financed_amount: identity.financed_amount,
    payment_frequency: identity.payment_frequency,
    installment_count: identity.installment_count,
    first_due_date: identity.first_due_date,
    final_due_date: identity.final_due_date,
    outstanding_balance: identity.outstanding_balance,
  };
  const number = await amendmentNumber(userId);
  const riskLevel = amendmentRisk(proposed);
  const checksumValue = checksum(safeJson({ number, before, proposed, reason }));
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO equipment_finance_case_amendments (
         amendment_number, application_id, agreement_id, amendment_type,
         risk_level, reason, before_snapshot_json, proposed_changes_json,
         amendment_status, apply_mode, effective_date, requested_by, checksum_sha256
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', 'pending', ?, ?, ?)`,
      [
        number,
        identity.application_id,
        identity.agreement_id,
        cleanText(body.amendment_type, 80) || "case_correction",
        riskLevel,
        reason,
        safeJson(before),
        safeJson(proposed),
        dateValue(body.effective_date),
        positiveId(userId),
        checksumValue,
      ]
    );
    await recordEvent({
      connection,
      applicationId: identity.application_id,
      agreementId: identity.agreement_id,
      eventType: "amendment_requested",
      title: `${number} submitted for approval`,
      description: reason,
      status: "pending_approval",
      sourceType: "amendment",
      sourceId: result.insertId,
      metadata: { risk_level: riskLevel, fields: Object.keys(proposed) },
      userId,
    });
    await writeAuditEvent({
      connection,
      req,
      action: "EQUIPMENT_FINANCE_AMENDMENT_REQUESTED",
      details: `Requested controlled Finance amendment ${number}.`,
      workspaceCode: "equipment_installment_finance",
      entityType: "equipment_finance_case_amendment",
      entityId: result.insertId,
      metadata: {
        application_id: identity.application_id,
        agreement_id: identity.agreement_id,
        risk_level: riskLevel,
        fields: Object.keys(proposed),
      },
    });
    await connection.commit();
    return {
      id: result.insertId,
      amendment_number: number,
      amendment_status: "pending_approval",
      risk_level: riskLevel,
      checksum_sha256: checksumValue,
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function listAmendments(caseType, caseId, knownIdentity = null) {
  if (!knownIdentity) await assertOperationalPolishSchema();
  const identity = knownIdentity || (await resolveCaseIdentity(caseType, caseId));
  const [rows] = await pool.query(
    `SELECT amendment.*, requester.full_name AS requested_by_name,
            approver.full_name AS approved_by_name, applier.full_name AS applied_by_name
     FROM equipment_finance_case_amendments amendment
     LEFT JOIN users requester ON requester.id = amendment.requested_by
     LEFT JOIN users approver ON approver.id = amendment.approved_by
     LEFT JOIN users applier ON applier.id = amendment.applied_by
     WHERE amendment.application_id = ? OR amendment.agreement_id = ?
     ORDER BY amendment.requested_at DESC, amendment.id DESC`,
    [identity.application_id, identity.agreement_id || -1]
  );
  return rows.map((row) => ({
    ...row,
    before_snapshot: parseJson(row.before_snapshot_json, {}),
    proposed_changes: parseJson(row.proposed_changes_json, {}),
    applied_result: parseJson(row.applied_result_json, null),
    integrity_valid:
      checksum(
        safeJson({
          number: row.amendment_number,
          before: parseJson(row.before_snapshot_json, {}),
          proposed: parseJson(row.proposed_changes_json, {}),
          reason: row.reason,
        })
      ) === row.checksum_sha256,
  }));
}

async function decideAmendment({ amendmentId, userId, body = {}, req = null }) {
  await assertOperationalPolishSchema();
  const id = positiveId(amendmentId);
  const decision = cleanText(body.decision, 30).toLowerCase();
  const reason = cleanText(body.decision_reason, 1000);
  if (!id || !["approved", "rejected"].includes(decision) || reason.length < 4) {
    throw new OperationalPolishError(400, "Choose Approve or Reject and record the decision reason.");
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT * FROM equipment_finance_case_amendments
       WHERE id = ? LIMIT 1 FOR UPDATE`,
      [id]
    );
    const amendment = rows[0];
    if (!amendment) throw new OperationalPolishError(404, "Finance amendment was not found.");
    if (amendment.amendment_status !== "pending_approval") {
      throw new OperationalPolishError(409, "Only a pending amendment can be decided.");
    }
    await connection.query(
      `UPDATE equipment_finance_case_amendments
       SET amendment_status = ?, decision_reason = ?, approved_by = ?, approved_at = NOW(),
           apply_mode = CASE WHEN ? = 'rejected' THEN 'not_applied' ELSE apply_mode END
       WHERE id = ?`,
      [decision, reason, positiveId(userId), decision, id]
    );
    await recordEvent({
      connection,
      applicationId: amendment.application_id,
      agreementId: amendment.agreement_id,
      eventType: decision === "approved" ? "amendment_approved" : "amendment_rejected",
      title: `${amendment.amendment_number} ${decision}`,
      description: reason,
      status: decision,
      sourceType: "amendment",
      sourceId: id,
      userId,
    });
    await writeAuditEvent({
      connection,
      req,
      action:
        decision === "approved"
          ? "EQUIPMENT_FINANCE_AMENDMENT_APPROVED"
          : "EQUIPMENT_FINANCE_AMENDMENT_REJECTED",
      details: `${humanize(decision)} Finance amendment ${amendment.amendment_number}.`,
      workspaceCode: "equipment_installment_finance",
      entityType: "equipment_finance_case_amendment",
      entityId: id,
      metadata: { decision_reason: reason },
    });
    await connection.commit();
    return { id, amendment_status: decision };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function applyAmendment({ amendmentId, userId, req = null }) {
  await assertOperationalPolishSchema();
  const id = positiveId(amendmentId);
  if (!id) throw new OperationalPolishError(400, "Choose a valid amendment.");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT * FROM equipment_finance_case_amendments
       WHERE id = ? LIMIT 1 FOR UPDATE`,
      [id]
    );
    const amendment = rows[0];
    if (!amendment) throw new OperationalPolishError(404, "Finance amendment was not found.");
    if (amendment.amendment_status !== "approved") {
      throw new OperationalPolishError(409, "Only an approved amendment can be applied.");
    }
    const proposed = parseJson(amendment.proposed_changes_json, {});
    const fields = Object.keys(proposed);
    const directOnly = fields.length > 0 && fields.every((field) => DIRECT_SAFE_AMENDMENT_FIELDS.has(field));
    const changedColumns = [];
    let applyMode = "numbered_variation";
    if (directOnly) {
      const kycChanges = {
        customer_name_snapshot: proposed.customer_name,
        customer_phone_snapshot: proposed.customer_phone,
        customer_email_snapshot: proposed.customer_email,
        customer_address_snapshot: proposed.customer_address,
        residential_address: proposed.customer_address,
        guarantor_phone: proposed.guarantor_phone,
      };
      changedColumns.push(
        ...(await updateExistingColumns(
          connection,
          "equipment_credit_application_kyc",
          "application_id",
          amendment.application_id,
          kycChanges
        ))
      );
      if (amendment.agreement_id) {
        const agreementChanges = {
          customer_name_snapshot: proposed.customer_name,
          customer_phone_snapshot: proposed.customer_phone,
          customer_location_snapshot: proposed.customer_address,
          guarantor_phone: proposed.guarantor_phone,
          agreement_notes: proposed.agreement_notes,
        };
        changedColumns.push(
          ...(await updateExistingColumns(
            connection,
            "equipment_sale_agreements",
            "id",
            amendment.agreement_id,
            agreementChanges
          ))
        );
      }
      applyMode = "direct_safe_update";
    }
    const appliedResult = {
      apply_mode: applyMode,
      changed_columns: changedColumns,
      preserved_original_financial_records: true,
      numbered_variation_required: applyMode === "numbered_variation",
      proposed_changes: proposed,
    };
    await connection.query(
      `UPDATE equipment_finance_case_amendments
       SET amendment_status = 'applied', apply_mode = ?, applied_result_json = ?,
           applied_by = ?, applied_at = NOW()
       WHERE id = ?`,
      [applyMode, safeJson(appliedResult), positiveId(userId), id]
    );
    if (amendment.agreement_id) {
      const snapshot = {
        amendment_number: amendment.amendment_number,
        agreement_id: amendment.agreement_id,
        application_id: amendment.application_id,
        amendment_type: amendment.amendment_type,
        risk_level: amendment.risk_level,
        reason: amendment.reason,
        before_snapshot: parseJson(amendment.before_snapshot_json, {}),
        proposed_changes: proposed,
        decision_reason: amendment.decision_reason,
        applied_result: appliedResult,
        requested_at: amendment.requested_at,
        approved_at: amendment.approved_at,
        applied_at: new Date().toISOString(),
      };
      const snapshotText = safeJson(snapshot);
      await connection.query(
        `INSERT IGNORE INTO equipment_finance_issued_documents (
           document_number, agreement_id, document_type, document_format,
           template_version, snapshot_json, snapshot_checksum, issued_by
         ) VALUES (?, ?, 'numbered_amendment', 'json', 'FIN-AMENDMENT-1', ?, ?, ?)`,
        [
          amendment.amendment_number,
          amendment.agreement_id,
          snapshotText,
          checksum(snapshotText),
          positiveId(userId),
        ]
      );
    }
    await recordEvent({
      connection,
      applicationId: amendment.application_id,
      agreementId: amendment.agreement_id,
      eventType: "amendment_applied",
      title: `${amendment.amendment_number} applied as ${humanize(applyMode)}`,
      description:
        applyMode === "numbered_variation"
          ? "The original financial and payment records remain unchanged; the approved variation is now part of the case file."
          : "Approved safe contact or narrative fields were updated with the original snapshot preserved.",
      status: "applied",
      sourceType: "amendment",
      sourceId: id,
      metadata: appliedResult,
      userId,
    });
    await writeAuditEvent({
      connection,
      req,
      action: "EQUIPMENT_FINANCE_AMENDMENT_APPLIED",
      details: `Applied Finance amendment ${amendment.amendment_number} as ${applyMode}.`,
      workspaceCode: "equipment_installment_finance",
      entityType: "equipment_finance_case_amendment",
      entityId: id,
      metadata: appliedResult,
    });
    await connection.commit();
    return { id, amendment_status: "applied", ...appliedResult };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function getPaymentReceipt(paymentId) {
  await assertOperationalPolishSchema();
  const id = positiveId(paymentId);
  if (!id) throw new OperationalPolishError(400, "Choose a valid Finance payment.");
  const [rows] = await pool.query(
    `SELECT
       payment.*,
       agreement.agreement_number,
       agreement.customer_name_snapshot,
       agreement.customer_phone_snapshot,
       agreement.asset_code_snapshot,
       agreement.asset_name_snapshot,
       agreement.outstanding_balance,
       agreement.amount_paid AS agreement_amount_paid,
       customer.customer_name,
       customer.phone AS customer_phone,
       asset.asset_code,
       asset.asset_name,
       user.full_name AS received_by_name,
       alert.id AS boss_alert_id,
       alert.alert_status AS boss_alert_status,
       alert.attempt_count AS boss_alert_attempt_count,
       alert.last_error AS boss_alert_error,
       alert.submitted_at AS boss_alert_submitted_at,
       alert.delivered_at AS boss_alert_delivered_at
     FROM equipment_sale_payments payment
     INNER JOIN equipment_sale_agreements agreement ON agreement.id = payment.agreement_id
     INNER JOIN hire_customers customer ON customer.id = agreement.customer_id
     INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
     LEFT JOIN users user ON user.id = payment.received_by
     LEFT JOIN equipment_finance_payment_alerts alert ON alert.payment_id = payment.id
     WHERE payment.id = ? AND payment.is_voided = FALSE
       AND agreement.sale_type = 'installment'
       AND agreement.activation_source = 'approved_credit_application'
     LIMIT 1`,
    [id]
  );
  const payment = rows[0];
  if (!payment) throw new OperationalPolishError(404, "Finance payment was not found.");
  const [allocations, shares, documents] = await Promise.all([
    pool.query(
      `SELECT allocation.allocated_amount, schedule.sequence_number,
              schedule.due_date, schedule.scheduled_amount, schedule.schedule_status
       FROM equipment_sale_payment_allocations allocation
       INNER JOIN equipment_installment_schedule schedule ON schedule.id = allocation.schedule_id
       WHERE allocation.payment_id = ?
       ORDER BY schedule.sequence_number`,
      [id]
    ),
    pool.query(
      `SELECT * FROM equipment_finance_document_shares
       WHERE payment_id = ? ORDER BY requested_at DESC, id DESC`,
      [id]
    ),
    pool.query(
      `SELECT id, document_number, document_type, document_format,
              template_version, snapshot_checksum, issued_at
       FROM equipment_finance_issued_documents
       WHERE agreement_id = ? AND document_number = ? AND archived_at IS NULL
       LIMIT 1`,
      [payment.agreement_id, `FIN-${payment.receipt_number}`]
    ),
  ]);
  const thermal = {
    company_name: "CHALIN 03 COMPANY LIMITED",
    title: "INSTALLMENT PAYMENT RECEIPT",
    receipt_number: payment.receipt_number,
    payment_date: payment.payment_date,
    customer_name: payment.customer_name_snapshot || payment.customer_name,
    customer_phone: payment.customer_phone_snapshot || payment.customer_phone,
    agreement_number: payment.agreement_number,
    equipment: [
      payment.asset_code_snapshot || payment.asset_code,
      payment.asset_name_snapshot || payment.asset_name,
    ]
      .filter(Boolean)
      .join(" — "),
    amount_received: Number(payment.amount || 0),
    payment_method: payment.payment_method,
    reference_number: payment.reference_number || null,
    payment_stage: payment.payment_stage,
    allocations: allocations[0].map((item) => ({
      sequence_number: item.sequence_number,
      due_date: item.due_date,
      allocated_amount: Number(item.allocated_amount || 0),
      schedule_status: item.schedule_status,
    })),
    outstanding_balance: Number(payment.outstanding_balance || 0),
    received_by: payment.received_by_name || "Finance staff",
  };
  return {
    payment: {
      ...payment,
      amount: Number(payment.amount || 0),
      outstanding_balance: Number(payment.outstanding_balance || 0),
      boss_alert_attempt_count: Number(payment.boss_alert_attempt_count || 0),
    },
    thermal_receipt: thermal,
    receipt_checksum: checksum(safeJson(thermal)),
    issued_document: documents[0][0] || null,
    shares: shares[0],
    boss_alert: {
      id: payment.boss_alert_id || null,
      status: payment.boss_alert_status || "not_recorded",
      attempt_count: Number(payment.boss_alert_attempt_count || 0),
      error: payment.boss_alert_error || null,
      submitted_at: payment.boss_alert_submitted_at || null,
      delivered_at: payment.boss_alert_delivered_at || null,
    },
  };
}

async function issuePaymentReceipt({ paymentId, userId }) {
  const receipt = await getPaymentReceipt(paymentId);
  if (receipt.issued_document) return receipt.issued_document;
  const snapshotText = safeJson({
    template_version: "FIN-THERMAL-1",
    issued_at: new Date().toISOString(),
    payment: receipt.payment,
    thermal_receipt: receipt.thermal_receipt,
    receipt_checksum: receipt.receipt_checksum,
  });
  const [result] = await pool.query(
    `INSERT INTO equipment_finance_issued_documents (
       document_number, agreement_id, document_type, document_format,
       template_version, snapshot_json, snapshot_checksum, issued_by
     ) VALUES (?, ?, 'installment_payment_receipt', 'print', 'FIN-THERMAL-1', ?, ?, ?)`,
    [
      `FIN-${receipt.payment.receipt_number}`,
      receipt.payment.agreement_id,
      snapshotText,
      checksum(snapshotText),
      positiveId(userId),
    ]
  );
  await recordEvent({
    applicationId: receipt.payment.credit_application_id,
    agreementId: receipt.payment.agreement_id,
    eventType: "payment_receipt_issued",
    title: `Receipt ${receipt.payment.receipt_number} issued`,
    status: "issued",
    sourceType: "issued_document",
    sourceId: result.insertId,
    userId,
  });
  return {
    id: result.insertId,
    document_number: `FIN-${receipt.payment.receipt_number}`,
    document_type: "installment_payment_receipt",
    document_format: "print",
    template_version: "FIN-THERMAL-1",
    snapshot_checksum: checksum(snapshotText),
  };
}

async function shareMessage({ channel, recipient, message, userId, sourceReference }) {
  if (channel === "sms") {
    if (!normalizePhone(recipient)) {
      return { status: "failed", error: "A valid Ghana phone number is required." };
    }
    const result = await sendSmsAlertToPhone({
      branchId: null,
      phone: recipient,
      message: cleanText(message, 480),
      logMessage: `Finance controlled share ${sourceReference}.`,
      smsType: "equipment_finance_document_share",
      sentBy: positiveId(userId),
      sourceReference,
    });
    return {
      status: result.ok ? result.status || "sent" : result.skipped ? "failed" : "failed",
      provider_reference: result.provider_reference || result.log_id || null,
      error: result.error || result.reason || null,
    };
  }
  if (channel === "whatsapp") {
    const phone = normalizePhone(recipient);
    if (!phone) return { status: "failed", error: "A valid WhatsApp phone number is required." };
    return {
      status: "prepared",
      launch_url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
    };
  }
  if (channel === "email") {
    const email = cleanText(recipient, 255);
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return { status: "failed", error: "A valid email address is required." };
    }
    return {
      status: "prepared",
      launch_url: `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
        "Chalin 03 Finance document"
      )}&body=${encodeURIComponent(message)}`,
    };
  }
  return { status: "prepared" };
}

async function createPaymentShare({ paymentId, userId, body = {}, req = null }) {
  await assertOperationalPolishSchema();
  const channel = cleanText(body.channel, 30).toLowerCase();
  if (!SHARE_CHANNELS.has(channel)) {
    throw new OperationalPolishError(400, "Choose SMS, WhatsApp, email, copy, download or print.");
  }
  const receipt = await getPaymentReceipt(paymentId);
  const recipient =
    cleanText(body.recipient, 255) ||
    (channel === "email" ? cleanText(receipt.payment.customer_email, 255) : receipt.thermal_receipt.customer_phone);
  const message = cleanText(
    body.message ||
      `CHALIN03: Receipt ${receipt.thermal_receipt.receipt_number}. GHS ${receipt.thermal_receipt.amount_received.toFixed(
        2
      )} received for ${receipt.thermal_receipt.agreement_number}. Balance GHS ${receipt.thermal_receipt.outstanding_balance.toFixed(
        2
      )}.`,
    1000
  );
  const [insert] = await pool.query(
    `INSERT INTO equipment_finance_document_shares (
       source_type, source_id, issued_document_id, application_id, agreement_id,
       payment_id, channel, recipient, share_status, share_message, requested_by
     ) VALUES ('payment_receipt', ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    [
      positiveId(paymentId),
      receipt.issued_document?.id || null,
      receipt.payment.credit_application_id,
      receipt.payment.agreement_id,
      positiveId(paymentId),
      channel,
      recipient || null,
      message,
      positiveId(userId),
    ]
  );
  const outcome = await shareMessage({
    channel,
    recipient,
    message,
    userId,
    sourceReference: `equipment-finance-receipt:${paymentId}`,
  });
  await pool.query(
    `UPDATE equipment_finance_document_shares
     SET share_status = ?, provider_reference = ?, error_message = ?,
         sent_at = CASE WHEN ? IN ('sent','accepted','delivered') THEN NOW() ELSE sent_at END,
         delivered_at = CASE WHEN ? = 'delivered' THEN NOW() ELSE delivered_at END
     WHERE id = ?`,
    [
      ["accepted", "delivery_unknown"].includes(outcome.status) ? "sent" : outcome.status,
      outcome.provider_reference || null,
      outcome.error || null,
      outcome.status,
      outcome.status,
      insert.insertId,
    ]
  );
  await recordEvent({
    applicationId: receipt.payment.credit_application_id,
    agreementId: receipt.payment.agreement_id,
    eventType: "receipt_shared",
    title: `Receipt ${receipt.thermal_receipt.receipt_number} ${humanize(outcome.status)}`,
    description: `${humanize(channel)}${recipient ? ` · ${recipient}` : ""}`,
    status: outcome.status,
    sourceType: "share",
    sourceId: insert.insertId,
    userId,
  });
  await writeAuditEvent({
    req,
    action: "EQUIPMENT_FINANCE_RECEIPT_SHARED",
    details: `Prepared or sent receipt ${receipt.thermal_receipt.receipt_number} by ${channel}.`,
    workspaceCode: "equipment_installment_finance",
    entityType: "equipment_finance_document_share",
    entityId: insert.insertId,
    metadata: {
      payment_id: positiveId(paymentId),
      channel,
      share_status: outcome.status,
    },
  });
  return { id: insert.insertId, channel, recipient, ...outcome, message };
}

async function createIssuedDocumentShare({ documentId, userId, body = {}, req = null }) {
  await assertOperationalPolishSchema();
  const channel = cleanText(body.channel, 30).toLowerCase();
  if (!SHARE_CHANNELS.has(channel)) {
    throw new OperationalPolishError(400, "Choose a supported document-sharing channel.");
  }
  const document = await getIssuedDocument(documentId);
  const agreement = document.snapshot?.agreement || {};
  const recipient = cleanText(body.recipient, 255) || agreement.kyc_customer_phone || agreement.customer_phone_snapshot || "";
  const message = cleanText(
    body.message ||
      `CHALIN03 Finance document ${document.document_number} for agreement ${agreement.agreement_number || ""}. Download it securely after signing in to Chalin 03.`,
    1000
  );
  const [insert] = await pool.query(
    `INSERT INTO equipment_finance_document_shares (
       source_type, source_id, issued_document_id, application_id, agreement_id,
       channel, recipient, share_status, share_message, requested_by
     ) VALUES ('issued_document', ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    [
      positiveId(documentId),
      positiveId(documentId),
      positiveId(agreement.credit_application_id),
      positiveId(document.agreement_id),
      channel,
      recipient || null,
      message,
      positiveId(userId),
    ]
  );
  const outcome = await shareMessage({
    channel,
    recipient,
    message,
    userId,
    sourceReference: `equipment-finance-document:${documentId}`,
  });
  await pool.query(
    `UPDATE equipment_finance_document_shares
     SET share_status = ?, provider_reference = ?, error_message = ?,
         sent_at = CASE WHEN ? IN ('sent','accepted','delivered') THEN NOW() ELSE sent_at END,
         delivered_at = CASE WHEN ? = 'delivered' THEN NOW() ELSE delivered_at END
     WHERE id = ?`,
    [
      ["accepted", "delivery_unknown"].includes(outcome.status) ? "sent" : outcome.status,
      outcome.provider_reference || null,
      outcome.error || null,
      outcome.status,
      outcome.status,
      insert.insertId,
    ]
  );
  await recordEvent({
    applicationId: agreement.credit_application_id,
    agreementId: document.agreement_id,
    eventType: "issued_document_shared",
    title: `${document.document_number} ${humanize(outcome.status)}`,
    description: `${humanize(channel)}${recipient ? ` · ${recipient}` : ""}`,
    status: outcome.status,
    sourceType: "share",
    sourceId: insert.insertId,
    userId,
  });
  await writeAuditEvent({
    req,
    action: "EQUIPMENT_FINANCE_DOCUMENT_SHARED",
    details: `Prepared or sent Finance document ${document.document_number} by ${channel}.`,
    workspaceCode: "equipment_installment_finance",
    entityType: "equipment_finance_document_share",
    entityId: insert.insertId,
    metadata: { issued_document_id: positiveId(documentId), channel, share_status: outcome.status },
  });
  return {
    id: insert.insertId,
    channel,
    recipient,
    download_path: `/equipment-catalogue/sales/professional/documents/${document.id}/download`,
    ...outcome,
    message,
  };
}

async function getCaseOperations(caseType, caseId, knownIdentity = null) {
  await assertOperationalPolishSchema();
  const identity = knownIdentity || (await resolveCaseIdentity(caseType, caseId));
  const [timeline, amendments, simulations, alerts, reconciliation] = await Promise.all([
    getCaseTimeline(caseType, caseId, identity),
    listAmendments(caseType, caseId, identity),
    listScheduleSimulations(caseType, caseId, identity),
    getDataQualityAlerts({ cases: [identity], schemaReady: true }),
    identity.agreement_id
      ? reconcileFinanceAgreement(identity.agreement_id)
      : Promise.resolve(null),
  ]);
  return {
    ...timeline,
    // The route replaces this with the authoritative encrypted Phase 5 document list.
    documents: [],
    amendments,
    simulations,
    alerts,
    reconciliation: reconciliation
      ? {
          consistent: reconciliation.consistent,
          mismatches: reconciliation.mismatches,
          calculated: reconciliation.calculated,
        }
      : null,
  };
}

async function getOperationalBootstrap({
  userId = null,
  workspaceRole = null,
  page = 1,
  pageSize,
  page_size,
  search = "",
  inboxPage = 1,
  inboxPageSize,
} = {}) {
  await assertOperationalPolishSchema();
  const casePage = await listCasesPage({
    page,
    pageSize,
    page_size,
    search,
    schemaReady: true,
  });
  const [inbox, draft, settings] = await Promise.all([
    listInbox({
      userId,
      workspaceRole,
      page: inboxPage,
      pageSize: inboxPageSize,
      schemaReady: true,
    }),
    userId ? getDraft({ userId, draftKey: "start-installment" }) : null,
    getProfessionalSettings().catch(() => null),
  ]);
  return {
    cases: casePage.cases,
    pagination: casePage.pagination,
    inbox,
    alerts: inbox.items.filter((item) => item.source === "data_quality"),
    draft,
    settings: settings
      ? {
          minimum_deposit_percent: Number(settings.minimum_deposit_percent || 0),
          maximum_installment_count: Number(settings.maximum_installment_count || 0),
          maximum_term_months: Number(settings.maximum_term_months || 0),
          default_payment_frequency: settings.default_payment_frequency,
          default_first_due_days: Number(settings.default_first_due_days || 0),
        }
      : null,
    policy: {
      scope: "company_wide_finance",
      private_document_storage: true,
      public_file_urls: false,
      draft_version_conflicts_blocked: true,
      immutable_payment_corrections: true,
      financial_amendments_use_numbered_variations: true,
      boss_alert_failure_never_rolls_back_payment: true,
      receipt_template: "FIN-THERMAL-1",
      paginated_case_register: true,
      paginated_operational_inbox: true,
      list_contains_image_bytes: false,
      selected_case_loaded_separately: true,
    },
  };
}

module.exports = {
  ALLOWED_DOCUMENT_MIME,
  MAX_DOCUMENT_BYTES,
  OperationalPolishError,
  applyAmendment,
  archiveDraft,
  assertOperationalPolishSchema,
  calculateDraftProgress,
  createAmendment,
  createIssuedDocumentShare,
  createPaymentShare,
  createTask,
  decideAmendment,
  getCaseDocument,
  getCaseOperations,
  getCaseTimeline,
  getDataQualityAlerts,
  getDraft,
  getOperationalBootstrap,
  getPaymentReceipt,
  issuePaymentReceipt,
  listAmendments,
  listCaseDocuments,
  listCases,
  listCasesPage,
  listInbox,
  listScheduleSimulations,
  operationalPolishSchemaStatus,
  normalizePagination,
  parseProtectedDocument,
  resolveCaseIdentity,
  reviewCaseDocument,
  saveDraft,
  saveScheduleSimulation,
  simulateSchedule,
  updateTask,
  uploadCaseDocument,
  retryBossPaymentAlert: sendBossPaymentAlert,
};
