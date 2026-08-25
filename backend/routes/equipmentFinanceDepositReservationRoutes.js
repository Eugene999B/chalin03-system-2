const crypto = require("crypto");
const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { nextDocumentNumber } = require("../services/groupConfigurationService");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const {
  runEquipmentFinanceOpeningDepositFoundationRepair,
} = require("../scripts/runEquipmentFinanceOpeningDepositFoundationRepair");

const router = express.Router();

const DEPOSIT_ROLES = new Set([
  "finance_manager",
  "finance_accountant",
  "equipment_business_manager",
  "equipment_business_accountant",
]);
const ADMIN_ROLES = new Set([
  "admin",
  "administrator",
  "manager",
  "system_administrator",
  "super_admin",
]);
const PAYMENT_METHODS = new Set(["cash", "momo", "bank", "cheque", "other"]);
const REQUIRED_MIGRATIONS = Object.freeze([
  "20260803_equipment_finance_phase4_deposit_reservation_integrity",
]);
const REQUIRED_COLUMNS = Object.freeze({
  equipment_sale_agreements: [
    "credit_application_id",
    "activation_source",
    "equipment_commitment_status",
    "deposit_completed_at",
    "deposit_completed_by",
    "reservation_activated_at",
    "reservation_activated_by",
  ],
  equipment_sale_payments: [
    "credit_application_id",
    "payment_stage",
    "reservation_effect",
    "idempotency_key",
  ],
});
const REQUIRED_TRIGGERS = Object.freeze([
  "trg_equipment_finance_payment_gate_before_insert",
  "trg_equipment_finance_reservation_gate_before_insert",
  "trg_equipment_finance_commitment_gate_before_update",
]);

class DepositError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_FINANCE_DEPOSIT_ERROR") {
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

function money(value, fallback = undefined) {
  if (value === undefined || value === null || value === "") return fallback;
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(Math.round(number * 100)) && number >= 0
    ? Math.round(number * 100) / 100
    : undefined;
}

function enumValue(value, allowed, fallback = undefined) {
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

function normalizeRole(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function rolesFor(user = {}) {
  const values = [
    user.workspace_role,
    user.access_role,
    user.role,
    ...(Array.isArray(user.roles) ? user.roles : []),
    ...(Array.isArray(user.workspace_roles) ? user.workspace_roles : []),
  ];
  const roles = new Set();
  for (const value of values) {
    const candidate =
      value && typeof value === "object"
        ? value.code || value.role_code || value.name || value.role
        : value;
    const normalized = normalizeRole(candidate);
    if (normalized) roles.add(normalized);
  }
  return roles;
}

function assertDepositOfficer(req) {
  if (isOriginalSystemAdministrator(req.user)) return;
  const roles = rolesFor(req.user);
  if (![...roles].some((role) => DEPOSIT_ROLES.has(role) || ADMIN_ROLES.has(role))) {
    throw new DepositError(
      403,
      "Only an authorised Finance manager or accountant can collect the opening deposit and reserve equipment.",
      "EQUIPMENT_FINANCE_DEPOSIT_PERMISSION_REQUIRED"
    );
  }
}

function toCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function fromCents(value) {
  return Number((Number(value || 0) / 100).toFixed(2));
}

function fallbackNumber(prefix) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `${prefix}-${stamp}-${String(crypto.randomInt(0, 10000)).padStart(4, "0")}`;
}

async function documentNumber(sequenceCode, prefix, userId) {
  try {
    return await nextDocumentNumber(sequenceCode, { userId: positiveId(userId) });
  } catch (_error) {
    return fallbackNumber(prefix);
  }
}

function triggerDefinitionIsValid(triggerName, actionStatement) {
  const sql = String(actionStatement || "");
  if (triggerName === "trg_equipment_finance_commitment_gate_before_update") {
    return (
      /OLD\.agreement_status\s+NOT\s+IN\s*\(/i.test(sql) &&
      /NEW\.agreement_status\s+IN\s*\(/i.test(sql) &&
      /NEW\.equipment_commitment_status\s*<>\s*['\"]reserved['\"]/i.test(sql)
    );
  }
  if (triggerName === "trg_equipment_finance_payment_gate_before_insert") {
    return /NEW\.payment_stage\s*=\s*['\"]opening_deposit['\"]/i.test(sql);
  }
  if (triggerName === "trg_equipment_finance_reservation_gate_before_insert") {
    return (
      /NEW\.lock_status\s*=\s*['\"]installment_active['\"]/i.test(sql) &&
      /v_deposit_received\s*(?:\+\s*0\.01\s*)?<\s*v_deposit_required/i.test(sql)
    );
  }
  return true;
}

async function schemaStatus(connection = pool) {
  const tableNames = Object.keys(REQUIRED_COLUMNS);
  const placeholders = tableNames.map(() => "?").join(",");
  const [columnRows] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    tableNames
  );
  const found = new Map(tableNames.map((tableName) => [tableName, new Set()]));
  for (const row of columnRows) {
    if (!found.has(row.TABLE_NAME)) found.set(row.TABLE_NAME, new Set());
    found.get(row.TABLE_NAME).add(row.COLUMN_NAME);
  }

  const missingColumns = [];
  for (const [tableName, columns] of Object.entries(REQUIRED_COLUMNS)) {
    for (const column of columns) {
      if (!(found.get(tableName) || new Set()).has(column)) {
        missingColumns.push(`${tableName}.${column}`);
      }
    }
  }

  const triggerPlaceholders = REQUIRED_TRIGGERS.map(() => "?").join(",");
  const [triggerRows] = await connection.query(
    `SELECT TRIGGER_NAME, ACTION_STATEMENT
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME IN (${triggerPlaceholders})`,
    REQUIRED_TRIGGERS
  );
  const triggerMap = new Map(triggerRows.map((row) => [row.TRIGGER_NAME, row.ACTION_STATEMENT]));
  const missingTriggers = [];
  const invalidTriggers = [];
  for (const triggerName of REQUIRED_TRIGGERS) {
    if (!triggerMap.has(triggerName)) {
      missingTriggers.push(triggerName);
    } else if (!triggerDefinitionIsValid(triggerName, triggerMap.get(triggerName))) {
      invalidTriggers.push(triggerName);
    }
  }

  let missingMigrations = [];
  try {
    const [[schemaMigrationsTable]] = await connection.query(
      `SELECT COUNT(*) AS present
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'schema_migrations'`
    );

    if (Number(schemaMigrationsTable?.present || 0) !== 1) {
      missingMigrations = [...REQUIRED_MIGRATIONS];
    } else {
      const migrationPlaceholders = REQUIRED_MIGRATIONS.map(() => "?").join(",");
      const [migrationRows] = await connection.query(
        `SELECT migration_name
         FROM schema_migrations
         WHERE migration_name IN (${migrationPlaceholders})`,
        REQUIRED_MIGRATIONS
      );
      const installedMigrations = new Set(
        migrationRows.map((row) => row.migration_name)
      );
      missingMigrations = REQUIRED_MIGRATIONS.filter(
        (migrationName) => !installedMigrations.has(migrationName)
      );
    }
  } catch (_error) {
    missingMigrations = [...REQUIRED_MIGRATIONS];
  }

  return {
    ready:
      missingColumns.length === 0 &&
      missingTriggers.length === 0,
    missing_columns: missingColumns,
    missing_triggers: missingTriggers,
    invalid_triggers: invalidTriggers,
    missing_migrations: missingMigrations,
  };
}

async function ensureDepositFoundationReady() {
  return schemaStatus(pool);
}

async function assertSchemaReady(connection = pool) {
  const status = await ensureDepositFoundationReady();
  if (!status.ready) {
    const error = new DepositError(
      503,
      "The Opening Deposit payment controls are not installed correctly on the production database.",
      "EQUIPMENT_FINANCE_DEPOSIT_SCHEMA_REQUIRED"
    );
    error.readiness = status;
    throw error;
  }
  return status;
}

function readinessDiagnostic(readiness) {
  return readiness
    ? {
        missing_columns: readiness.missing_columns || [],
        missing_triggers: readiness.missing_triggers || [],
        invalid_triggers: readiness.invalid_triggers || [],
        missing_migrations: readiness.missing_migrations || [],
        backend_revision:
          process.env.RAILWAY_GIT_COMMIT_SHA ||
          process.env.RAILWAY_GIT_COMMIT_SHA_SHORT ||
          process.env.RAILWAY_GIT_COMMIT ||
          "unknown",
      }
    : undefined;
}

function sendError(res, error, fallbackMessage) {
  if (error instanceof DepositError) {
    return res.status(error.statusCode).json({
      status: "error",
      code: error.code,
      message: error.message,
      ...(error.readiness ? { readiness: readinessDiagnostic(error.readiness) } : {}),
      ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}),
    });
  }
  if (Number(error?.statusCode || 0) >= 400) {
    return res.status(Number(error.statusCode)).json({
      status: "error",
      code: error.code || "EQUIPMENT_FINANCE_DEPOSIT_ERROR",
      message: error.message || fallbackMessage,
      ...(error.details ? { details: error.details } : {}),
      ...(error.readiness ? { readiness: readinessDiagnostic(error.readiness) } : {}),
      ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}),
    });
  }
  if (["ER_NO_SUCH_TABLE"].includes(error?.code)) {
    return res.status(503).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_DEPOSIT_SCHEMA_REQUIRED",
      message: "The Opening Deposit payment controls are not installed on the production database.",
      diagnostic: {
        mysql_code: error.code,
        mysql_message: cleanText(error.sqlMessage || error.message, 500),
        backend_revision:
          process.env.RAILWAY_GIT_COMMIT_SHA ||
          process.env.RAILWAY_GIT_COMMIT_SHA_SHORT ||
          process.env.RAILWAY_GIT_COMMIT ||
          "unknown",
      },
    });
  }
  if (["ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return res.status(500).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_DEPOSIT_QUERY_INVALID",
      message: "The Opening Deposit query referenced a field that does not exist in the live database.",
      diagnostic: {
        mysql_code: error.code,
        mysql_message: cleanText(error.sqlMessage || error.message, 500),
        backend_revision:
          process.env.RAILWAY_GIT_COMMIT_SHA ||
          process.env.RAILWAY_GIT_COMMIT_SHA_SHORT ||
          process.env.RAILWAY_GIT_COMMIT ||
          "unknown",
      },
    });
  }
  if (error?.errno === 1644 || error?.sqlState === "45000") {
    return res.status(409).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_DEPOSIT_GATE_REJECTED",
      message: cleanText(error.sqlMessage || error.message, 500),
      ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}),
    });
  }
  if (error?.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_DEPOSIT_DUPLICATE",
      message: "This deposit or machine reservation has already been recorded.",
    });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ status: "error", message: fallbackMessage });
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

async function loadAgreement(connection, agreementId) {
  const [rows] = await connection.query(
    `SELECT
       agreement.*,
       application.application_number,
       application.application_status,
       application.kyc_status,
       application.affordability_status,
       customer.customer_name,
       customer.phone AS customer_phone,
       asset.asset_code,
       asset.asset_name,
       asset.main_image_url,
       asset.operational_purpose,
       asset.sale_status,
       asset.is_active AS asset_is_active,
       location.name AS equipment_origin_name,
       (SELECT sale_lock.agreement_id
          FROM equipment_asset_sale_locks sale_lock
         WHERE sale_lock.asset_id = agreement.asset_id
           AND sale_lock.released_at IS NULL
         ORDER BY sale_lock.locked_at
         LIMIT 1) AS active_lock_agreement_id,
       (SELECT COUNT(*)
        FROM hire_contract_assets hire_asset
        WHERE hire_asset.asset_id = agreement.asset_id
          AND hire_asset.status IN ('assigned','dispatched','active')) AS active_hire_count
     FROM equipment_sale_agreements agreement
     INNER JOIN equipment_credit_applications application
       ON application.id = agreement.credit_application_id
     INNER JOIN hire_customers customer
       ON customer.id = agreement.customer_id
     INNER JOIN fleet_assets asset
       ON asset.id = agreement.asset_id
     LEFT JOIN business_locations location
       ON location.id = agreement.hire_location_id
     WHERE agreement.id = ?
     LIMIT 1`,
    [agreementId]
  );
  return rows[0] || null;
}

function assertControlledAgreement(agreement) {
  if (!agreement) throw new DepositError(404, "Finance agreement was not found.");
  if (agreement.sale_type !== "installment") {
    throw new DepositError(409, "Only installment Finance agreements use this deposit stage.");
  }
  if (
    agreement.activation_source !== "approved_credit_application" ||
    !agreement.credit_application_id
  ) {
    throw new DepositError(
      409,
      "This agreement is not a controlled approved-credit Finance agreement.",
      "EQUIPMENT_FINANCE_CONTROLLED_AGREEMENT_REQUIRED"
    );
  }
  if (agreement.application_status !== "approved") {
    throw new DepositError(
      409,
      "The linked Finance application is not explicitly approved.",
      "EQUIPMENT_FINANCE_APPLICATION_NOT_APPROVED"
    );
  }
  if (!["approved", "active"].includes(agreement.agreement_status)) {
    throw new DepositError(
      409,
      "The agreement is not in an approved or active Finance state.",
      "EQUIPMENT_FINANCE_AGREEMENT_STATE_INVALID"
    );
  }
  if (!["not_reserved", "reserved"].includes(agreement.equipment_commitment_status)) {
    throw new DepositError(
      409,
      "The equipment commitment state cannot accept an opening deposit.",
      "EQUIPMENT_FINANCE_COMMITMENT_STATE_INVALID"
    );
  }
  return true;
}

function assertAssetCanBeReserved(agreement) {
  if (Number(agreement.active_hire_count || 0) > 0) {
    throw new DepositError(
      409,
      "The exact excavator is currently active on Hire and cannot be reserved for Finance.",
      "EQUIPMENT_FINANCE_ASSET_HIRE_CONFLICT"
    );
  }
  if (!Number(agreement.asset_is_active || 0)) {
    throw new DepositError(409, "The exact excavator is inactive and cannot be reserved.");
  }
  if (!["sale_only", "sale_or_hire"].includes(String(agreement.operational_purpose || ""))) {
    throw new DepositError(
      409,
      "The exact excavator is not configured for equipment sale.",
      "EQUIPMENT_FINANCE_ASSET_PURPOSE_INVALID"
    );
  }
  if (String(agreement.sale_status || "") !== "available") {
    throw new DepositError(
      409,
      "The exact excavator is not currently available for this Finance reservation.",
      "EQUIPMENT_FINANCE_ASSET_UNAVAILABLE"
    );
  }
  const reserved = Number(agreement.active_lock_agreement_id || 0) > 0;
  if (reserved && Number(agreement.active_lock_agreement_id) !== Number(agreement.id)) {
    throw new DepositError(
      409,
      "The exact excavator is already reserved for another agreement.",
      "EQUIPMENT_FINANCE_ASSET_ALREADY_RESERVED"
    );
  }
}

function candidateShape(agreement) {
  const depositRequired = Number(agreement.deposit_required || 0);
  const depositReceived = Number(agreement.deposit_received || 0);
  const remainingCents = Math.max(toCents(depositRequired) - toCents(depositReceived), 0);
  const reserved = agreement.equipment_commitment_status === "reserved";
  const blockers = [];

  if (!["approved", "active"].includes(agreement.agreement_status)) {
    blockers.push("agreement_not_approved_or_active");
  }
  if (agreement.activation_source !== "approved_credit_application") {
    blockers.push("controlled_credit_activation_required");
  }
  if (agreement.application_status !== "approved") {
    blockers.push("credit_application_not_approved");
  }
  if (Number(agreement.active_hire_count || 0) > 0) blockers.push("equipment_active_on_hire");
  if (!Number(agreement.asset_is_active || 0)) blockers.push("equipment_inactive");
  if (!["sale_only", "sale_or_hire"].includes(String(agreement.operational_purpose || ""))) {
    blockers.push("equipment_not_for_sale");
  }
  if (String(agreement.sale_status || "") !== "available" && !reserved) {
    blockers.push("equipment_unavailable");
  }
  if (reserved) blockers.push("equipment_already_reserved");

  return {
    agreement_id: agreement.id,
    agreement_number: agreement.agreement_number,
    customer_id: agreement.customer_id,
    customer_name: agreement.customer_name,
    customer_phone: agreement.customer_phone,
    asset_id: agreement.asset_id,
    asset_code: agreement.asset_code,
    asset_name: agreement.asset_name,
    main_image_url: agreement.main_image_url,
    sale_total: Number(agreement.total_amount || 0),
    total_amount: Number(agreement.total_amount || 0),
    deposit_required: Number(agreement.deposit_required || 0),
    deposit_received: Number(agreement.deposit_received || 0),
    deposit_remaining: fromCents(remainingCents),
    financed_amount: Number(agreement.financed_amount || 0),
    outstanding_balance: Number(agreement.outstanding_balance || 0),
    payment_frequency: agreement.payment_frequency,
    installment_count: agreement.installment_count,
    first_due_date: agreement.first_due_date,
    deposit_completed_at: agreement.deposit_completed_at,
    reservation_activated_at: agreement.reservation_activated_at,
    reserved,
    equipment_origin_location_id: agreement.hire_location_id || null,
    equipment_origin_name: agreement.equipment_origin_name || null,
    optional_advisory: {
      kyc_status: agreement.kyc_status || null,
      affordability_status: agreement.affordability_status || null,
    },
    blockers,
    ready_for_deposit: !reserved && blockers.length === 0,
    next_action: reserved
      ? { code: "await_delivery_authorization", label: "Machine reserved; continue to independent delivery authorization." }
      : remainingCents > 0
        ? { code: "collect_deposit", label: "Record the remaining required opening deposit." }
        : { code: "confirm_reservation", label: "Confirm reservation of the exact machine." },
  };
}

async function loadControlledDepositEvidence(connection, agreementId) {
  const [rows] = await connection.query(
    `SELECT
       COALESCE(SUM(CASE WHEN payment.is_voided = FALSE THEN payment.amount ELSE 0 END), 0) AS total_paid,
       COALESCE(SUM(CASE WHEN payment.is_voided = FALSE
                              AND payment.payment_category = 'deposit'
                              AND payment.payment_stage = 'opening_deposit'
                         THEN payment.amount ELSE 0 END), 0) AS controlled_deposit_received
       FROM equipment_sale_payments payment
      WHERE payment.agreement_id = ?`,
    [agreementId]
  );
  return {
    total_paid: Number(Number(rows[0]?.total_paid || 0).toFixed(2)),
    controlled_deposit_received: Number(
      Number(rows[0]?.controlled_deposit_received || 0).toFixed(2)
    ),
  };
}

router.get("/readiness", requirePermission("fleet.assets.view"), async (_req, res) => {
  try {
    const readiness = await schemaStatus(pool);
    return res.status(readiness.ready ? 200 : 503).json({
      status: readiness.ready ? "success" : "error",
      code: readiness.ready ? undefined : "EQUIPMENT_FINANCE_DEPOSIT_SCHEMA_REQUIRED",
      message: readiness.ready
        ? "Finance deposit and reservation controls are ready."
        : "The Opening Deposit payment controls are not installed on the production database.",
      readiness,
    });
  } catch (error) {
    return sendError(res, error, "Could not check Finance deposit readiness.");
  }
});

router.get("/candidates", requirePermission("fleet.assets.view"), async (_req, res) => {
  try {
    const readiness = await schemaStatus(pool);
    if (!readiness.ready) {
      return res.status(503).json({
        status: "error",
        code: "EQUIPMENT_FINANCE_DEPOSIT_SCHEMA_REQUIRED",
        message: "Opening Deposit candidates are temporarily unavailable because the payment controls are not ready.",
        readiness,
      });
    }

    const [rows] = await pool.query(
      `SELECT
         agreement.*,
         application.application_number,
         application.application_status,
         application.kyc_status,
         application.affordability_status,
         customer.customer_name,
         customer.phone AS customer_phone,
         asset.asset_code,
         asset.asset_name,
         asset.main_image_url,
         asset.operational_purpose,
         asset.sale_status,
         asset.is_active AS asset_is_active,
         location.name AS equipment_origin_name,
         (SELECT sale_lock.agreement_id
            FROM equipment_asset_sale_locks sale_lock
           WHERE sale_lock.asset_id = agreement.asset_id
             AND sale_lock.released_at IS NULL
           ORDER BY sale_lock.locked_at
           LIMIT 1) AS active_lock_agreement_id,
         (SELECT COUNT(*)
          FROM hire_contract_assets hire_asset
          WHERE hire_asset.asset_id = agreement.asset_id
            AND hire_asset.status IN ('assigned','dispatched','active')) AS active_hire_count
       FROM equipment_sale_agreements agreement
       INNER JOIN equipment_credit_applications application
         ON application.id = agreement.credit_application_id
       INNER JOIN hire_customers customer ON customer.id = agreement.customer_id
       INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
       LEFT JOIN business_locations location ON location.id = agreement.hire_location_id
       WHERE agreement.sale_type = 'installment'
         AND agreement.activation_source = 'approved_credit_application'
         AND agreement.agreement_status IN ('approved','active')
       ORDER BY
         CASE WHEN agreement.equipment_commitment_status = 'reserved' THEN 1 ELSE 0 END,
         agreement.approved_at,
         agreement.id`
    );
    return res.json({
      status: "success",
      candidates: rows.map(candidateShape),
      scope: "company_wide",
      hire_location_selection_required: false,
      optional_advisory_fields: ["kyc_status", "affordability_status"],
      safeguards: {
        hire_work_created: false,
        delivery_created: false,
        ownership_transferred: false,
        sms_sent: false,
      },
    });
  } catch (error) {
    return sendError(res, error, "Could not load Finance deposit candidates.");
  }
});

router.post(
  "/:agreementId/deposit",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    let agreementId = null;
    try {
      assertDepositOfficer(req);
      const body = req.body || {};
      agreementId = positiveId(req.params.agreementId);
      const amount = money(body.amount, 0);
      const method = enumValue(body.payment_method, PAYMENT_METHODS, undefined);
      const confirmReservation = boolValue(body.confirm_reservation, false);
      const idempotencyKey = cleanText(body.idempotency_key, 191);

      if (!agreementId || amount === undefined || confirmReservation === undefined) {
        throw new DepositError(
          400,
          "Enter a valid agreement and a deposit amount with no more than two decimal places."
        );
      }
      if (amount > 0 && method === undefined) {
        throw new DepositError(400, "Choose the payment method for this deposit.");
      }
      if (amount > 0 && !idempotencyKey) {
        throw new DepositError(400, "A deposit idempotency key is required.");
      }

      const result = await withTransaction(async (connection) => {
        const [agreementLocks] = await connection.query(
          "SELECT id FROM equipment_sale_agreements WHERE id = ? LIMIT 1 FOR UPDATE",
          [agreementId]
        );
        if (!agreementLocks.length) {
          throw new DepositError(404, "Finance agreement was not found.");
        }

        let agreement = await loadAgreement(connection, agreementId);
        if (!agreement) {
          throw new DepositError(
            409,
            "The Finance agreement has an invalid application, customer or machine link.",
            "EQUIPMENT_FINANCE_AGREEMENT_LINK_INVALID"
          );
        }

        await assertSchemaReady(connection);

        if (idempotencyKey) {
          const [existingRows] = await connection.query(
            `SELECT * FROM equipment_sale_payments
             WHERE idempotency_key = ?
             LIMIT 1
             FOR UPDATE`,
            [idempotencyKey]
          );
          const existing = existingRows[0];
          if (existing) {
            if (Number(existing.agreement_id) !== Number(agreement.id)) {
              throw new DepositError(
                409,
                "That deposit request key belongs to another agreement.",
                "EQUIPMENT_FINANCE_IDEMPOTENCY_COLLISION"
              );
            }
            if (
              toCents(existing.amount) !== toCents(amount) ||
              normalizeRole(existing.payment_method) !== normalizeRole(method)
            ) {
              throw new DepositError(
                409,
                "That deposit request key was already used with a different amount or payment method.",
                "EQUIPMENT_FINANCE_IDEMPOTENCY_PAYLOAD_MISMATCH"
              );
            }
            return {
              agreement: candidateShape(agreement),
              payment: existing,
              already_recorded: true,
              reservation_created:
                agreement.equipment_commitment_status === "reserved",
            };
          }
        }

        assertControlledAgreement(agreement);

        const depositEvidence = await loadControlledDepositEvidence(connection, agreement.id);
        const storedDeposit = toCents(agreement.deposit_received);
        const evidencedDeposit = toCents(depositEvidence.controlled_deposit_received);
        if (Math.abs(storedDeposit - evidencedDeposit) > 1) {
          throw new DepositError(
            409,
            "The agreement's opening-deposit balance does not match its controlled deposit receipts. No payment was saved.",
            "EQUIPMENT_FINANCE_DEPOSIT_EVIDENCE_RECONCILIATION_REQUIRED"
          );
        }
        agreement = {
          ...agreement,
          amount_paid: depositEvidence.total_paid,
          deposit_received: depositEvidence.controlled_deposit_received,
        };

        const [assetRows] = await connection.query(
          `SELECT id, is_active, operational_purpose, sale_status
             FROM fleet_assets
            WHERE id = ?
            LIMIT 1
            FOR UPDATE`,
          [agreement.asset_id]
        );
        if (!assetRows.length) {
          throw new DepositError(409, "The agreement machine no longer exists.");
        }

        const [activeHireRows] = await connection.query(
          `SELECT id
             FROM hire_contract_assets
            WHERE asset_id = ?
              AND status IN ('assigned','dispatched','active')
            ORDER BY id
            FOR UPDATE`,
          [agreement.asset_id]
        );
        const [activeLockRows] = await connection.query(
          `SELECT agreement_id, lock_status
             FROM equipment_asset_sale_locks
            WHERE asset_id = ?
              AND released_at IS NULL
            ORDER BY locked_at
            FOR UPDATE`,
          [agreement.asset_id]
        );
        const conflictingLock = activeLockRows.find(
          (lock) => Number(lock.agreement_id) !== Number(agreement.id)
        );

        agreement = {
          ...agreement,
          asset_is_active: assetRows[0].is_active,
          operational_purpose: assetRows[0].operational_purpose,
          sale_status: assetRows[0].sale_status,
          active_hire_count: activeHireRows.length,
          active_lock_id: null,
          active_lock_agreement_id: conflictingLock?.agreement_id || null,
        };
        assertAssetCanBeReserved(agreement);

        const amountCents = toCents(amount);
        const requiredCents = toCents(agreement.deposit_required);
        const receivedCents = toCents(agreement.deposit_received);
        const remainingCents = Math.max(requiredCents - receivedCents, 0);

        if (agreement.equipment_commitment_status === "reserved") {
          if (amountCents > 0) {
            throw new DepositError(
              409,
              "The opening deposit is complete and the machine is already reserved."
            );
          }
          return {
            agreement: candidateShape(agreement),
            payment: null,
            already_recorded: true,
            reservation_created: true,
          };
        }
        if (amountCents === 0 && remainingCents > 0) {
          throw new DepositError(400, "Enter a deposit amount before reserving this machine.");
        }
        if (amountCents > remainingCents) {
          throw new DepositError(400, "The deposit exceeds the remaining required deposit.");
        }

        const depositAfterCents = receivedCents + amountCents;
        const depositComplete = depositAfterCents >= requiredCents;
        if (depositComplete && !confirmReservation) {
          throw new DepositError(
            400,
            "Confirm that the exact machine should be reserved when the required deposit is complete."
          );
        }

        let payment = null;
        if (amountCents > 0) {
          const paymentNumber = await documentNumber(
            "EQUIPMENT_SALE_PAYMENT",
            "ESP",
            req.user?.id
          );
          const receiptNumber = await documentNumber(
            "EQUIPMENT_SALE_RECEIPT",
            "ESR",
            req.user?.id
          );
          const [paymentInsert] = await connection.query(
            `INSERT INTO equipment_sale_payments (
               payment_number, receipt_number, idempotency_key,
               hire_location_id, agreement_id, credit_application_id,
               customer_id, payment_date, payment_category, payment_stage,
               reservation_effect, amount, payment_method, reference_number,
               notes, received_by, approved_by, approved_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 'deposit',
                       'opening_deposit', ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
              paymentNumber,
              receiptNumber,
              idempotencyKey,
              agreement.hire_location_id,
              agreement.id,
              agreement.credit_application_id,
              agreement.customer_id,
              depositComplete ? "reserved" : "none",
              fromCents(amountCents),
              method,
              nullableText(body.reference_number, 150),
              nullableText(body.notes, 500),
              positiveId(req.user?.id),
              positiveId(req.user?.id),
            ]
          );
          const [paymentRows] = await connection.query(
            "SELECT * FROM equipment_sale_payments WHERE id = ? LIMIT 1",
            [paymentInsert.insertId]
          );
          payment = paymentRows[0] || null;
        }

        const depositAfter = fromCents(depositAfterCents);
        const amountPaidAfter = fromCents(
          toCents(agreement.amount_paid) + amountCents
        );
        const outstandingAfter = fromCents(
          Math.max(toCents(agreement.total_amount) - toCents(amountPaidAfter), 0)
        );

        await connection.query(
          `UPDATE equipment_sale_agreements
              SET deposit_received = ?, amount_paid = ?, outstanding_balance = ?,
                  deposit_completed_at =
                    CASE WHEN ? THEN COALESCE(deposit_completed_at, NOW())
                         ELSE deposit_completed_at END,
                  deposit_completed_by =
                    CASE WHEN ? THEN COALESCE(deposit_completed_by, ?)
                         ELSE deposit_completed_by END
            WHERE id = ?`,
          [
            depositAfter,
            amountPaidAfter,
            outstandingAfter,
            depositComplete,
            depositComplete,
            positiveId(req.user?.id),
            agreement.id,
          ]
        );

        let reservationCreated = false;
        if (depositComplete) {
          const existingAgreementLock = activeLockRows.find(
            (lock) => Number(lock.agreement_id) === Number(agreement.id)
          );
          if (!existingAgreementLock) {
            await connection.query(
              `INSERT INTO equipment_asset_sale_locks (
                 asset_id, agreement_id, hire_location_id, lock_status,
                 lock_reason, created_by
               ) VALUES (?, ?, ?, 'installment_active', ?, ?)`,
              [
                agreement.asset_id,
                agreement.id,
                agreement.hire_location_id,
                `Reserved after required Finance deposit for ${agreement.agreement_number}`,
                positiveId(req.user?.id),
              ]
            );
            reservationCreated = true;
          }

          const [assetUpdate] = await connection.query(
            `UPDATE fleet_assets
                SET sale_status = 'installment_active',
                    sale_reserved_until = NULL,
                    updated_by = ?
              WHERE id = ?
                AND sale_status IN ('available','installment_active')`,
            [positiveId(req.user?.id), agreement.asset_id]
          );
          if (Number(assetUpdate.affectedRows || 0) !== 1) {
            throw new DepositError(
              409,
              "The exact excavator could not be moved into the protected Finance reservation state.",
              "EQUIPMENT_FINANCE_RESERVATION_ASSET_UPDATE_FAILED"
            );
          }

          await connection.query(
            `UPDATE equipment_sale_agreements
                SET equipment_commitment_status = 'reserved',
                    reservation_activated_at = COALESCE(reservation_activated_at, NOW()),
                    reservation_activated_by = COALESCE(reservation_activated_by, ?),
                    agreement_status = 'active'
              WHERE id = ?`,
            [positiveId(req.user?.id), agreement.id]
          );
        }

        const [updatedAgreementRows] = await connection.query(
          `SELECT * FROM equipment_sale_agreements WHERE id = ? LIMIT 1`,
          [agreement.id]
        );
        const updatedAgreement = updatedAgreementRows[0] || agreement;
        await writeAuditEvent(connection, {
          action: depositComplete ? "equipment_finance_deposit_and_reservation" : "equipment_finance_opening_deposit",
          entityType: "equipment_sale_agreement",
          entityId: agreement.id,
          actorUserId: positiveId(req.user?.id),
          metadata: {
            amount: fromCents(amountCents),
            payment_method: method,
            payment_id: payment?.id || null,
            receipt_number: payment?.receipt_number || null,
            reservation_created: reservationCreated,
            asset_id: agreement.asset_id,
            asset_code: agreement.asset_code,
          },
        });

        return {
          agreement: candidateShape(updatedAgreement),
          payment,
          already_recorded: false,
          reservation_created: reservationCreated,
        };
      });

      return res.status(200).json({
        status: "success",
        message: result.agreement.reserved
          ? "Required deposit confirmed and machine reserved for this Finance agreement. No Hire work, delivery, ownership transfer or SMS was created."
          : "Partial opening deposit recorded. The machine remains available and unreserved until the required deposit is complete.",
        ...result,
        safeguards: {
          hire_enquiry_created: false,
          hire_contract_created: false,
          hire_job_created: false,
          delivery_created: false,
          ownership_transferred: false,
          sms_sent: false,
        },
      });
    } catch (error) {
      if (agreementId && (error?.errno === 1644 || error?.sqlState === "45000")) {
        try {
          const [rows] = await pool.query(
            `SELECT
               agreement.id,
               agreement.agreement_status,
               agreement.equipment_commitment_status,
               agreement.activation_source,
               agreement.credit_application_id,
               agreement.deposit_required,
               agreement.deposit_received,
               agreement.reservation_activated_at,
               agreement.reservation_activated_by,
               asset.id AS asset_id,
               asset.asset_code,
               asset.sale_status,
               asset.is_active,
               (SELECT COUNT(*)
                  FROM equipment_asset_sale_locks lock_row
                 WHERE lock_row.agreement_id = agreement.id
                   AND lock_row.asset_id = agreement.asset_id
                   AND (lock_row.hire_location_id <=> agreement.hire_location_id)
                   AND lock_row.lock_status = 'installment_active'
                   AND lock_row.released_at IS NULL) AS matching_active_reservations,
               (SELECT COUNT(*)
                  FROM equipment_asset_sale_locks lock_row
                 WHERE lock_row.asset_id = agreement.asset_id
                   AND lock_row.released_at IS NULL) AS active_reservations_on_asset
             FROM equipment_sale_agreements agreement
             INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
             WHERE agreement.id = ?
             LIMIT 1`,
            [agreementId]
          );
          error.diagnostic = {
            ...(error.diagnostic || {}),
            mysql_code: error.code,
            mysql_message: cleanText(error.sqlMessage || error.message, 500),
            live_state: rows[0] || null,
            backend_revision:
              process.env.RAILWAY_GIT_COMMIT_SHA ||
              process.env.RAILWAY_GIT_COMMIT_SHA_SHORT ||
              process.env.RAILWAY_GIT_COMMIT ||
              "unknown",
          };
        } catch (_diagnosticError) {
          // Preserve original Finance gate error.
        }
      }
      return sendError(res, error, "Could not record the Finance opening deposit.");
    }
  }
);

module.exports = router;
module.exports.DEPOSIT_ROLES = DEPOSIT_ROLES;
module.exports.REQUIRED_COLUMNS = REQUIRED_COLUMNS;
module.exports.REQUIRED_MIGRATIONS = REQUIRED_MIGRATIONS;
module.exports.REQUIRED_TRIGGERS = REQUIRED_TRIGGERS;
module.exports.money = money;
module.exports.rolesFor = rolesFor;
module.exports.schemaStatus = schemaStatus;
