const crypto = require("crypto");
const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { nextDocumentNumber } = require("../services/groupConfigurationService");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const {
  assertFinanceMutationSafe,
  refreshFinanceAgreementFromEvidence,
} = require("../services/equipmentFinanceReconciliationService");
const {
  runEquipmentFinanceOpeningDepositFoundationRepair,
} = require("../scripts/runEquipmentFinanceOpeningDepositFoundationRepair");
const {
  runEquipmentFinancePhaseFourStartup,
} = require("../scripts/runEquipmentFinancePhaseFourStartup");

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
    `SELECT TRIGGER_NAME
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME IN (${triggerPlaceholders})`,
    REQUIRED_TRIGGERS
  );
  const installedTriggers = new Set(triggerRows.map((row) => row.TRIGGER_NAME));
  const missingTriggers = REQUIRED_TRIGGERS.filter(
    (triggerName) => !installedTriggers.has(triggerName)
  );

  let missingMigrations = [];
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

  return {
    ready:
      missingColumns.length === 0 &&
      missingTriggers.length === 0 &&
      missingMigrations.length === 0,
    missing_columns: missingColumns,
    missing_triggers: missingTriggers,
    missing_migrations: missingMigrations,
  };
}

let depositFoundationRepairPromise = null;
async function ensureDepositFoundationReady() {
  const current = await schemaStatus(pool);
  if (current.ready) return current;

  if (!depositFoundationRepairPromise) {
    depositFoundationRepairPromise = (async () => {
      await runEquipmentFinanceOpeningDepositFoundationRepair();
      await runEquipmentFinancePhaseFourStartup();
      const verified = await schemaStatus(pool);
      if (!verified.ready) {
        const error = new DepositError(
          503,
          "Finance deposit controls are not ready after the approved production repair.",
          "EQUIPMENT_FINANCE_DEPOSIT_FOUNDATION_REQUIRED"
        );
        error.readiness = verified;
        throw error;
      }
      return verified;
    })().finally(() => {
      depositFoundationRepairPromise = null;
    });
  }

  return depositFoundationRepairPromise;
}

async function assertSchemaReady(connection = pool) {
  await ensureDepositFoundationReady();
  const status = await schemaStatus(connection);
  if (!status.ready) {
    const error = new DepositError(
      503,
      "Finance deposit collection and equipment reservation are being prepared. Apply and verify the approved deposit-reservation migration first.",
      "EQUIPMENT_FINANCE_DEPOSIT_FOUNDATION_REQUIRED"
    );
    error.readiness = status;
    throw error;
  }
  return status;
}

function sendError(res, error, fallbackMessage) {
  if (error instanceof DepositError) {
    return res.status(error.statusCode).json({
      status: "error",
      code: error.code,
      message: error.message,
      readiness: error.readiness,
    });
  }
  if (Number(error?.statusCode || 0) >= 400) {
    return res.status(Number(error.statusCode)).json({
      status: "error",
      code: error.code || "EQUIPMENT_FINANCE_DEPOSIT_ERROR",
      message: error.message || fallbackMessage,
      ...(error.details ? { details: error.details } : {}),
      ...(error.readiness ? { readiness: error.readiness } : {}),
    });
  }
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return res.status(503).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_DEPOSIT_FOUNDATION_REQUIRED",
      message:
        "Finance deposit collection and equipment reservation are being prepared. Apply and verify the approved deposit-reservation migration first.",
    });
  }
  if (error?.errno === 1644 || error?.sqlState === "45000") {
    return res.status(409).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_DEPOSIT_GATE_REJECTED",
      message: cleanText(error.sqlMessage || error.message, 500),
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
       (SELECT sale_lock.id
          FROM equipment_asset_sale_locks sale_lock
         WHERE sale_lock.asset_id = agreement.asset_id
           AND sale_lock.released_at IS NULL
         ORDER BY sale_lock.id
         LIMIT 1) AS active_lock_id,
       (SELECT sale_lock.agreement_id
          FROM equipment_asset_sale_locks sale_lock
         WHERE sale_lock.asset_id = agreement.asset_id
           AND sale_lock.released_at IS NULL
         ORDER BY sale_lock.id
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
      "This is a legacy agreement. Continue managing it through the existing legacy account workflow.",
      "EQUIPMENT_FINANCE_LEGACY_AGREEMENT"
    );
  }
  if (agreement.application_status !== "approved") {
    throw new DepositError(
      409,
      "The linked credit application is no longer explicitly approved.",
      "EQUIPMENT_FINANCE_APPLICATION_APPROVAL_REQUIRED"
    );
  }
  if (!["approved", "active"].includes(agreement.agreement_status)) {
    throw new DepositError(
      409,
      "Opening deposits cannot be collected for this agreement status."
    );
  }
}

function assertAssetCanBeReserved(agreement) {
  if (!Boolean(Number(agreement.asset_is_active))) {
    throw new DepositError(409, "The equipment is not active in the fleet register.");
  }
  if (!["sale_only", "sale_or_hire"].includes(agreement.operational_purpose)) {
    throw new DepositError(409, "The equipment is not authorised for sale.");
  }
  if (Number(agreement.active_hire_count || 0) > 0) {
    throw new DepositError(
      409,
      "The equipment is active on a Hire contract and cannot be reserved for Finance."
    );
  }
  if (
    agreement.sale_status !== "available" &&
    agreement.sale_status !== "installment_active"
  ) {
    throw new DepositError(409, "The equipment is not currently available for reservation.");
  }
  if (
    agreement.active_lock_agreement_id &&
    Number(agreement.active_lock_agreement_id) !== Number(agreement.id)
  ) {
    throw new DepositError(409, "The equipment already has another active sale lock.");
  }
}

function candidateShape(agreement) {
  const requiredCents = toCents(agreement.deposit_required);
  const receivedCents = toCents(agreement.deposit_received);
  const remainingCents = Math.max(requiredCents - receivedCents, 0);
  const reserved = agreement.equipment_commitment_status === "reserved";
  const blockers = [];
  if (agreement.application_status !== "approved") {
    blockers.push("application_not_approved");
  }
  if (!Boolean(Number(agreement.asset_is_active))) blockers.push("asset_inactive");
  if (!["sale_only", "sale_or_hire"].includes(agreement.operational_purpose)) {
    blockers.push("asset_not_sale_authorised");
  }
  if (Number(agreement.active_hire_count || 0) > 0) {
    blockers.push("asset_active_on_hire");
  }
  if (
    agreement.active_lock_agreement_id &&
    Number(agreement.active_lock_agreement_id) !== Number(agreement.id)
  ) {
    blockers.push("asset_locked_to_another_agreement");
  }
  return {
    agreement_id: agreement.id,
    agreement_number: agreement.agreement_number,
    agreement_status: agreement.agreement_status,
    equipment_commitment_status: agreement.equipment_commitment_status,
    application_id: agreement.credit_application_id,
    application_number: agreement.application_number,
    customer_id: agreement.customer_id,
    customer_name: agreement.customer_name,
    customer_phone: agreement.customer_phone,
    asset_id: agreement.asset_id,
    asset_code: agreement.asset_code,
    asset_name: agreement.asset_name,
    main_image_url: agreement.main_image_url,
    asset_sale_status: agreement.sale_status,
    active_hire_count: Number(agreement.active_hire_count || 0),
    total_amount: Number(agreement.total_amount || 0),
    deposit_required: fromCents(requiredCents),
    deposit_received: fromCents(receivedCents),
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

router.get("/readiness", requirePermission("fleet.assets.view"), async (_req, res) => {
  try {
    const readiness = await schemaStatus(pool);
    return res.status(readiness.ready ? 200 : 503).json({
      status: readiness.ready ? "success" : "error",
      code: readiness.ready
        ? undefined
        : "EQUIPMENT_FINANCE_DEPOSIT_FOUNDATION_REQUIRED",
      message: readiness.ready
        ? "Finance deposit and reservation controls are ready."
        : "Apply and verify the approved Finance deposit-reservation migration first.",
      readiness,
    });
  } catch (error) {
    return sendError(res, error, "Could not check Finance deposit readiness.");
  }
});

router.get("/candidates", requirePermission("fleet.assets.view"), async (_req, res) => {
  try {
    await ensureDepositFoundationReady();
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
         (SELECT sale_lock.id
            FROM equipment_asset_sale_locks sale_lock
           WHERE sale_lock.asset_id = agreement.asset_id
             AND sale_lock.released_at IS NULL
           ORDER BY sale_lock.id
           LIMIT 1) AS active_lock_id,
         (SELECT sale_lock.agreement_id
            FROM equipment_asset_sale_locks sale_lock
           WHERE sale_lock.asset_id = agreement.asset_id
             AND sale_lock.released_at IS NULL
           ORDER BY sale_lock.id
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
    try {
      assertDepositOfficer(req);
      await ensureDepositFoundationReady();
      await assertSchemaReady(pool);
      const agreementId = positiveId(req.params.agreementId);
      const amount = money(req.body.amount, 0);
      const method = enumValue(req.body.payment_method, PAYMENT_METHODS, undefined);
      const confirmReservation = boolValue(req.body.confirm_reservation, false);
      const idempotencyKey = cleanText(req.body.idempotency_key, 191);

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
        const currentReconciliation = await assertFinanceMutationSafe(agreement.id, {
          connection,
          lock: false,
        });
        agreement = { ...agreement, ...currentReconciliation.calculated };

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
          `SELECT id, agreement_id, lock_status
             FROM equipment_asset_sale_locks
            WHERE asset_id = ?
              AND released_at IS NULL
            ORDER BY id
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
          active_lock_id: activeLockRows[0]?.id || null,
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
              nullableText(req.body.reference_number, 150),
              nullableText(req.body.notes, 500),
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
              "The machine changed status before reservation. The deposit and reservation were rolled back."
            );
          }

          await connection.query(
            `UPDATE equipment_sale_agreements
                SET agreement_status = 'active',
                    equipment_commitment_status = 'reserved',
                    reservation_activated_at =
                      COALESCE(reservation_activated_at, NOW()),
                    reservation_activated_by =
                      COALESCE(reservation_activated_by, ?)
              WHERE id = ?`,
            [positiveId(req.user?.id), agreement.id]
          );
        }

        const reconciliation = await refreshFinanceAgreementFromEvidence(
          connection,
          agreement.id
        );
        const refreshed = reconciliation.agreement;
        await writeAuditEvent({
          connection,
          req,
          action: depositComplete
            ? "EQUIPMENT_FINANCE_DEPOSIT_COMPLETED_AND_RESERVED"
            : "EQUIPMENT_FINANCE_PARTIAL_DEPOSIT_RECORDED",
          actionType: depositComplete
            ? "equipment.finance.deposit.complete_reserve"
            : "equipment.finance.deposit.partial",
          entityType: "equipment_sale_agreement",
          entityId: agreement.id,
          workspaceCode: "equipment_installment_finance",
          hireLocationId: null,
          severity: "notice",
          outcome: "success",
          details: depositComplete
            ? `Completed the required opening deposit and reserved ${agreement.asset_code} under ${agreement.agreement_number}.`
            : `Recorded a partial opening deposit under ${agreement.agreement_number}; equipment remains unreserved.`,
          metadata: {
            credit_application_id: agreement.credit_application_id,
            payment_id: payment?.id || null,
            amount: fromCents(amountCents),
            deposit_required: fromCents(requiredCents),
            deposit_received: depositAfter,
            deposit_remaining: fromCents(
              Math.max(requiredCents - depositAfterCents, 0)
            ),
            equipment_origin_location_id: agreement.hire_location_id || null,
            reservation_created: reservationCreated,
            hire_contract_created: false,
            delivery_created: false,
            ownership_transferred: false,
            sms_sent: false,
          },
        });

        return {
          agreement: candidateShape(refreshed),
          payment,
          already_recorded: false,
          reservation_created: reservationCreated,
        };
      });

      return res.status(result.already_recorded ? 200 : 201).json({
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
