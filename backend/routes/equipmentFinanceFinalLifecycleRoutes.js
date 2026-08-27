const crypto = require("crypto");
const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { nextDocumentNumber } = require("../services/groupConfigurationService");
const {
  sendBossPaymentAlert,
} = require("../services/equipmentFinanceProfessionalService");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { workspaceRoleFor } = require("../security/equipmentDivisionAccess");
const {
  assertFinanceMutationSafe,
  reconcileFinanceAgreement,
  reconcileFinancePortfolio,
  refreshFinanceAgreementFromEvidence,
} = require("../services/equipmentFinanceReconciliationService");

const router = express.Router();

const COLLECTION_ROLES = new Set([
  "finance_manager",
  "finance_accountant",
  "collections_officer",
  "equipment_business_manager",
  "equipment_business_accountant",
]);
const FINALISATION_ROLES = new Set([
  "finance_manager",
  "finance_accountant",
  "equipment_business_manager",
  "equipment_business_accountant",
]);
const PAYMENT_METHODS = new Set(["cash", "momo", "bank", "cheque", "other"]);
const DELIVERY_CONDITIONS = new Set([
  "excellent",
  "good",
  "fair",
  "damaged",
  "under_inspection",
]);

const REQUIRED_TABLES = Object.freeze([
  "equipment_sale_agreements",
  "equipment_credit_applications",
  "equipment_sale_payments",
  "equipment_installment_schedule",
  "equipment_sale_payment_allocations",
  "equipment_deliveries",
  "equipment_ownership_transfers",
  "equipment_asset_sale_locks",
  "fleet_assets",
  "hire_contract_assets",
  "hire_customers",
]);

const REQUIRED_COLUMNS = Object.freeze({
  equipment_sale_agreements: [
    "activation_source",
    "credit_application_id",
    "equipment_commitment_status",
    "controlled_delivery_completed_at",
    "controlled_delivery_completed_by",
    "controlled_ownership_completed_at",
    "controlled_ownership_completed_by",
  ],
  equipment_sale_payments: [
    "idempotency_key",
    "credit_application_id",
    "payment_stage",
    "reservation_effect",
  ],
  equipment_deliveries: [
    "idempotency_key",
    "credit_application_id",
    "handover_stage",
  ],
  equipment_ownership_transfers: [
    "idempotency_key",
    "credit_application_id",
    "transfer_stage",
  ],
});

class FinanceLifecycleError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_FINANCE_LIFECYCLE_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function positiveId(value, label = "ID") {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new FinanceLifecycleError(400, `${label} must be a positive whole number.`, "INVALID_IDENTIFIER");
  }
  return id;
}

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 1000) {
  return cleanText(value, maxLength) || null;
}

function money(value, { minimum = 0.01, maximum = 10000000000 } = {}) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return undefined;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < minimum || amount > maximum) return undefined;
  return Number(amount.toFixed(2));
}

function percentage(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100
    ? Number(number.toFixed(2))
    : undefined;
}

function idempotencyKey(value, prefix) {
  const key = cleanText(value, 191);
  if (key.length < 20 || !key.startsWith(prefix)) {
    throw new FinanceLifecycleError(
      400,
      `A secure ${prefix} request key is required.`,
      "FINANCE_IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  return key;
}

function userId(req) {
  const id = Number(req.user?.id || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function roleAllowed(req, allowedRoles) {
  return isOriginalSystemAdministrator(req.user) || allowedRoles.has(workspaceRoleFor(req.user));
}

function requireFinanceRole(allowedRoles, actionLabel) {
  return (req, res, next) => {
    if (roleAllowed(req, allowedRoles)) return next();
    return res.status(403).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_ROLE_REQUIRED",
      message: `${actionLabel} is restricted to authorised Installment Finance staff.`,
    });
  };
}

function sendError(res, error, fallback) {
  const statusCode = Number(error.statusCode || 500);
  const payload = {
    status: "error",
    code: error.code || "EQUIPMENT_FINANCE_LIFECYCLE_ERROR",
    message: error.message || fallback,
  };
  if (error.readiness) payload.readiness = error.readiness;
  if (error.details) payload.details = error.details;
  return res.status(statusCode).json(payload);
}

async function schemaStatus(connection = pool) {
  const tablePlaceholders = REQUIRED_TABLES.map(() => "?").join(",");
  const [tables] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${tablePlaceholders})`,
    REQUIRED_TABLES
  );
  const existingTables = new Set(tables.map((row) => row.TABLE_NAME));
  const missingTables = REQUIRED_TABLES.filter((name) => !existingTables.has(name));

  const columnTables = Object.keys(REQUIRED_COLUMNS);
  const columnPlaceholders = columnTables.map(() => "?").join(",");
  const [columns] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${columnPlaceholders})`,
    columnTables
  );
  const found = new Map(columnTables.map((tableName) => [tableName, new Set()]));
  for (const row of columns) found.get(row.TABLE_NAME)?.add(row.COLUMN_NAME);
  const missingColumns = [];
  for (const [tableName, required] of Object.entries(REQUIRED_COLUMNS)) {
    for (const column of required) {
      if (!found.get(tableName)?.has(column)) missingColumns.push(`${tableName}.${column}`);
    }
  }

  return {
    ready: missingTables.length === 0 && missingColumns.length === 0,
    migration: "20260729_equipment_finance_final_lifecycle",
    missing_tables: missingTables,
    missing_columns: missingColumns,
  };
}

async function assertSchemaReady(connection = pool) {
  const readiness = await schemaStatus(connection);
  if (!readiness.ready) {
    const error = new FinanceLifecycleError(
      503,
      "The controlled Finance lifecycle is awaiting its approved additive database migration.",
      "EQUIPMENT_FINANCE_FINAL_LIFECYCLE_FOUNDATION_REQUIRED"
    );
    error.readiness = readiness;
    throw error;
  }
  return readiness;
}

function accountSql({ lock = false } = {}) {
  return `SELECT
      agreement.*,
      application.application_number,
      application.application_status,
      application.kyc_status,
      application.affordability_status,
      customer.customer_name,
      customer.phone AS customer_phone,
      customer.address AS customer_address,
      asset.asset_code,
      asset.asset_name,
      asset.asset_type,
      asset.make,
      asset.model,
      asset.model_year,
      asset.serial_number,
      asset.chassis_number,
      asset.engine_number,
      asset.main_image_url,
      asset.current_meter,
      asset.meter_type,
      asset.sale_status AS asset_sale_status,
      asset.is_active AS asset_is_active,
      location.name AS equipment_origin_name,
      delivery.id AS delivery_id,
      delivery.delivery_number,
      delivery.delivery_datetime,
      delivery.status AS delivery_status_record,
      delivery.handover_stage,
      ownership.id AS ownership_id,
      ownership.transfer_number,
      ownership.transfer_date,
      ownership.status AS ownership_status_record,
      ownership.transfer_stage,
      (SELECT COUNT(*)
         FROM hire_contract_assets hire_asset
        WHERE hire_asset.asset_id = agreement.asset_id
          AND hire_asset.status IN ('assigned','dispatched','active')) AS active_hire_count,
      (SELECT MAX(payment.payment_date)
         FROM equipment_sale_payments payment
        WHERE payment.agreement_id = agreement.id
          AND payment.is_voided = FALSE) AS last_payment_at
    FROM equipment_sale_agreements agreement
    INNER JOIN equipment_credit_applications application
      ON application.id = agreement.credit_application_id
    INNER JOIN hire_customers customer ON customer.id = agreement.customer_id
    INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
    LEFT JOIN business_locations location ON location.id = agreement.hire_location_id
    LEFT JOIN equipment_deliveries delivery ON delivery.agreement_id = agreement.id
    LEFT JOIN equipment_ownership_transfers ownership ON ownership.agreement_id = agreement.id
    WHERE agreement.sale_type = 'installment'
      AND agreement.activation_source = 'approved_credit_application'
      AND agreement.id = ?
    LIMIT 1
    ${lock ? "FOR UPDATE" : ""}`;
}

function accountListSql() {
  return `SELECT
      agreement.id, agreement.agreement_number, agreement.agreement_status,
      agreement.credit_application_id, agreement.customer_id, agreement.asset_id,
      agreement.hire_location_id, agreement.customer_name_snapshot,
      agreement.customer_phone_snapshot, agreement.customer_location_snapshot,
      agreement.asset_code_snapshot, agreement.asset_name_snapshot,
      agreement.asset_type_snapshot, agreement.make_snapshot,
      agreement.model_snapshot, agreement.model_year_snapshot,
      agreement.serial_number_snapshot, agreement.total_amount,
      agreement.deposit_required, agreement.deposit_received,
      agreement.financed_amount, agreement.amount_paid,
      agreement.outstanding_balance, agreement.overdue_amount,
      agreement.payment_frequency, agreement.installment_count,
      agreement.next_due_date, agreement.final_due_date,
      agreement.delivery_policy, agreement.delivery_threshold_percent,
      agreement.equipment_commitment_status, agreement.delivery_status,
      agreement.ownership_status, agreement.agreement_document_number,
      agreement.agreement_issued_at, agreement.agreement_signed_at,
      application.application_number, application.application_status,
      customer.customer_name, customer.phone AS customer_phone,
      customer.address AS customer_address,
      asset.asset_code, asset.asset_name, asset.asset_type, asset.make,
      asset.model, asset.model_year, asset.serial_number,
      asset.chassis_number, asset.engine_number,
      location.name AS equipment_origin_name,
      delivery.id AS delivery_id, delivery.delivery_number,
      delivery.delivery_datetime, delivery.status AS delivery_status_record,
      delivery.handover_stage,
      ownership.id AS ownership_id, ownership.transfer_number,
      ownership.transfer_date, ownership.status AS ownership_status_record,
      ownership.transfer_stage,
      (SELECT COUNT(*)
         FROM hire_contract_assets hire_asset
        WHERE hire_asset.asset_id = agreement.asset_id
          AND hire_asset.status IN ('assigned','dispatched','active')) AS active_hire_count,
      (SELECT MAX(payment.payment_date)
         FROM equipment_sale_payments payment
        WHERE payment.agreement_id = agreement.id
          AND payment.is_voided = FALSE) AS last_payment_at
    FROM equipment_sale_agreements agreement
    INNER JOIN equipment_credit_applications application
      ON application.id = agreement.credit_application_id
    INNER JOIN hire_customers customer ON customer.id = agreement.customer_id
    INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
    LEFT JOIN business_locations location ON location.id = agreement.hire_location_id
    LEFT JOIN equipment_deliveries delivery ON delivery.agreement_id = agreement.id
    LEFT JOIN equipment_ownership_transfers ownership ON ownership.agreement_id = agreement.id
    WHERE agreement.sale_type = 'installment'
      AND agreement.activation_source = 'approved_credit_application'
    ORDER BY agreement.created_at DESC, agreement.id DESC`;
}

async function getAccount(connection, agreementId, { lock = false } = {}) {
  const [rows] = await connection.query(accountSql({ lock }), [agreementId]);
  return rows[0] || null;
}

function deliveryAllowed(account) {
  const paid = Number(account.amount_paid || 0);
  const total = Number(account.total_amount || 0);
  if (account.delivery_policy === "immediate") return true;
  if (account.delivery_policy === "after_deposit") {
    return paid + 0.01 >= Number(account.deposit_required || 0);
  }
  if (account.delivery_policy === "after_percentage") {
    return total > 0 && (paid / total) * 100 + 0.0001 >= Number(account.delivery_threshold_percent || 0);
  }
  return Number(account.outstanding_balance || 0) <= 0.01;
}

function publicAccount(account) {
  return {
    agreement_id: account.id,
    agreement_number: account.agreement_number,
    agreement_status: account.agreement_status,
    application_id: account.credit_application_id,
    application_number: account.application_number,
    customer_id: account.customer_id,
    customer_name: account.customer_name_snapshot || account.customer_name,
    customer_phone: account.customer_phone_snapshot || account.customer_phone,
    customer_address: account.customer_location_snapshot || account.customer_address,
    asset_id: account.asset_id,
    asset_code: account.asset_code_snapshot || account.asset_code,
    asset_name: account.asset_name_snapshot || account.asset_name,
    asset_type: account.asset_type,
    make: account.make,
    model: account.model,
    model_year: account.model_year,
    serial_number: account.serial_number,
    chassis_number: account.chassis_number,
    engine_number: account.engine_number,
    main_image_url: account.main_image_url_snapshot || account.main_image_url,
    equipment_origin_name: account.equipment_origin_name,
    hire_location_id: account.hire_location_id,
    total_amount: Number(account.total_amount || 0),
    deposit_required: Number(account.deposit_required || 0),
    deposit_received: Number(account.deposit_received || 0),
    financed_amount: Number(account.financed_amount || 0),
    amount_paid: Number(account.amount_paid || 0),
    outstanding_balance: Number(account.outstanding_balance || 0),
    overdue_amount: Number(account.overdue_amount || 0),
    payment_frequency: account.payment_frequency,
    installment_count: Number(account.installment_count || 0),
    next_due_date: account.next_due_date,
    final_due_date: account.final_due_date,
    last_payment_at: account.last_payment_at,
    delivery_policy: account.delivery_policy,
    delivery_threshold_percent: Number(account.delivery_threshold_percent || 0),
    delivery_eligible: deliveryAllowed(account),
    equipment_commitment_status: account.equipment_commitment_status,
    reserved: account.equipment_commitment_status === "reserved",
    active_hire_count: Number(account.active_hire_count || 0),
    delivery_id: account.delivery_id,
    delivery_number: account.delivery_number,
    delivery_datetime: account.delivery_datetime,
    delivery_status: account.delivery_status_record || account.delivery_status,
    handover_stage: account.handover_stage,
    ownership_id: account.ownership_id,
    transfer_number: account.transfer_number,
    transfer_date: account.transfer_date,
    ownership_status: account.ownership_status_record || account.ownership_status,
    transfer_stage: account.transfer_stage,
    fully_paid: Number(account.outstanding_balance || 0) <= 0.01,
    agreement_document_number: account.agreement_document_number || null,
    agreement_issued_at: account.agreement_issued_at || null,
    agreement_signed_at: account.agreement_signed_at || null,
  };
}

async function nextFinanceNumber(sequence, prefix, user) {
  try {
    return await nextDocumentNumber(sequence, { userId: user || null });
  } catch (_error) {
    return `${prefix}-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${crypto
      .randomInt(0, 10000)
      .toString()
      .padStart(4, "0")}`;
  }
}

async function allocateCollection(connection, paymentId, agreementId, amount) {
  let remaining = Number(amount.toFixed(2));
  const allocations = [];
  const [schedule] = await connection.query(
    `SELECT id, sequence_number, due_date, scheduled_amount, amount_paid,
            late_charge_amount, waived_charge_amount, schedule_status
     FROM equipment_installment_schedule
     WHERE agreement_id = ?
       AND schedule_status NOT IN ('paid','cancelled','waived','rescheduled')
     ORDER BY due_date, sequence_number
     FOR UPDATE`,
    [agreementId]
  );

  for (const row of schedule) {
    if (remaining <= 0.001) break;
    const lineTotal = Number(
      (
        Number(row.scheduled_amount || 0) +
        Number(row.late_charge_amount || 0) -
        Number(row.waived_charge_amount || 0)
      ).toFixed(2)
    );
    const lineBalance = Number(Math.max(lineTotal - Number(row.amount_paid || 0), 0).toFixed(2));
    if (lineBalance <= 0) continue;
    const allocated = Number(Math.min(remaining, lineBalance).toFixed(2));
    await connection.query(
      `INSERT INTO equipment_sale_payment_allocations (
         payment_id, schedule_id, allocated_amount
       ) VALUES (?, ?, ?)`,
      [paymentId, row.id, allocated]
    );
    const newPaid = Number((Number(row.amount_paid || 0) + allocated).toFixed(2));
    const newStatus = newPaid + 0.01 >= lineTotal ? "paid" : "partial";
    await connection.query(
      `UPDATE equipment_installment_schedule
       SET amount_paid = ?,
           schedule_status = ?,
           fully_paid_at = CASE WHEN ? = 'paid' THEN COALESCE(fully_paid_at, NOW()) ELSE fully_paid_at END
       WHERE id = ?`,
      [newPaid, newStatus, newStatus, row.id]
    );
    allocations.push({
      schedule_id: row.id,
      sequence_number: row.sequence_number,
      due_date: row.due_date,
      allocated_amount: allocated,
      schedule_status: newStatus,
    });
    remaining = Number((remaining - allocated).toFixed(2));
  }

  if (remaining > 0.01) {
    throw new FinanceLifecycleError(
      409,
      "The collection could not be allocated completely. No payment was saved.",
      "FINANCE_COLLECTION_ALLOCATION_INCOMPLETE"
    );
  }
  return allocations;
}

async function refreshAgreement(connection, agreementId) {
  const reconciliation = await refreshFinanceAgreementFromEvidence(connection, agreementId);
  return {
    paid: reconciliation.calculated.amount_paid,
    balance: reconciliation.calculated.outstanding_balance,
    overdue: reconciliation.calculated.overdue_amount,
    status: reconciliation.calculated.agreement_status,
    next_due_date: reconciliation.calculated.next_due_date,
    reconciliation,
  };
}

router.get("/readiness", requirePermission("fleet.assets.view"), async (_req, res) => {
  try {
    const readiness = await schemaStatus();
    return res.status(readiness.ready ? 200 : 503).json({
      status: readiness.ready ? "success" : "warning",
      readiness,
      scope: "company_wide_finance",
    });
  } catch (error) {
    return sendError(res, error, "Could not check Finance lifecycle readiness.");
  }
});

router.get("/accounts", requirePermission("fleet.assets.view"), async (_req, res) => {
  try {
    await assertSchemaReady();
    const [[rows], portfolio] = await Promise.all([
      pool.query(accountListSql()),
      reconcileFinancePortfolio(),
    ]);
    const reconciliationByAgreement = new Map(
      portfolio.map((result) => [Number(result.agreement_id), result])
    );
    const accounts = rows.map((row) => {
      const reconciliation = reconciliationByAgreement.get(Number(row.id));
      return {
        ...publicAccount({ ...row, ...(reconciliation?.calculated || {}) }),
        reconciliation_consistent: reconciliation?.consistent !== false,
        reconciliation_mismatches: reconciliation?.mismatches || [],
      };
    });
    return res.json({
      status: "success",
      count: accounts.length,
      accounts,
      scope: "company_wide_finance",
      policy: {
        hire_location_selection_required: false,
        collection_allocation: "oldest_due_first_then_future_schedule",
        partial_payments_allowed: true,
        payment_above_period_allowed: true,
        overpayment_above_account_balance_allowed: false,
      },
    });
  } catch (error) {
    return sendError(res, error, "Could not load Finance lifecycle accounts.");
  }
});

router.get("/accounts/:agreementId", requirePermission("fleet.assets.view"), async (req, res) => {
  try {
    await assertSchemaReady();
    const agreementId = positiveId(req.params.agreementId, "Agreement ID");
    const account = await getAccount(pool, agreementId);
    if (!account) throw new FinanceLifecycleError(404, "Finance agreement was not found.");
    const reconciliation = await reconcileFinanceAgreement(agreementId);
    const [[schedule], [payments], [allocations], [deliveries], [ownershipTransfers]] =
      await Promise.all([
        pool.query(
          `SELECT * FROM equipment_installment_schedule
           WHERE agreement_id = ? ORDER BY sequence_number`,
          [agreementId]
        ),
        pool.query(
          `SELECT payment.*, user.full_name AS received_by_name
           FROM equipment_sale_payments payment
           LEFT JOIN users user ON user.id = payment.received_by
           WHERE payment.agreement_id = ?
           ORDER BY payment.payment_date DESC, payment.id DESC`,
          [agreementId]
        ),
        pool.query(
          `SELECT allocation.*, schedule.sequence_number, schedule.due_date,
                  payment.receipt_number
           FROM equipment_sale_payment_allocations allocation
           INNER JOIN equipment_installment_schedule schedule ON schedule.id = allocation.schedule_id
           INNER JOIN equipment_sale_payments payment ON payment.id = allocation.payment_id
           WHERE schedule.agreement_id = ?
           ORDER BY payment.payment_date, allocation.id`,
          [agreementId]
        ),
        pool.query(
          "SELECT * FROM equipment_deliveries WHERE agreement_id = ? ORDER BY id DESC",
          [agreementId]
        ),
        pool.query(
          "SELECT * FROM equipment_ownership_transfers WHERE agreement_id = ? ORDER BY id DESC",
          [agreementId]
        ),
      ]);
    return res.json({
      status: "success",
      account: publicAccount({ ...account, ...reconciliation.calculated }),
      reconciliation: {
        consistent: reconciliation.consistent,
        mismatches: reconciliation.mismatches,
        calculated: reconciliation.calculated,
      },
      schedule,
      payments,
      payment_allocations: allocations,
      deliveries,
      ownership_transfers: ownershipTransfers,
      safeguards: {
        active_hire_count: Number(account.active_hire_count || 0),
        delivery_allowed: deliveryAllowed(account),
        ownership_allowed:
          Number(account.outstanding_balance || 0) <= 0.01 &&
          Boolean(account.controlled_delivery_completed_at),
      },
    });
  } catch (error) {
    return sendError(res, error, "Could not load the Finance agreement file.");
  }
});

router.post(
  "/accounts/:agreementId/collections",
  requirePermission("fleet.assets.manage"),
  requireFinanceRole(COLLECTION_ROLES, "Installment collection"),
  async (req, res) => {
    const connection = await pool.getConnection();
    try {
      await assertSchemaReady(connection);
      const agreementId = positiveId(req.params.agreementId, "Agreement ID");
      const amount = money(req.body?.amount);
      const method = cleanText(req.body?.payment_method, 20).toLowerCase();
      const key = idempotencyKey(req.body?.idempotency_key, "finance-collection");
      if (amount === undefined || !PAYMENT_METHODS.has(method)) {
        throw new FinanceLifecycleError(400, "Enter a valid collection amount and payment method.");
      }

      await connection.beginTransaction();
      const [replayRows] = await connection.query(
        `SELECT payment.id, payment.receipt_number, payment.agreement_id,
                payment.amount, payment.payment_stage
         FROM equipment_sale_payments payment
         WHERE payment.idempotency_key = ?
         LIMIT 1 FOR UPDATE`,
        [key]
      );
      if (replayRows.length) {
        const replay = replayRows[0];
        if (Number(replay.agreement_id) !== agreementId || Math.abs(Number(replay.amount) - amount) > 0.01) {
          throw new FinanceLifecycleError(
            409,
            "This request key was already used for different collection details.",
            "FINANCE_IDEMPOTENCY_CONFLICT"
          );
        }
        await connection.commit();
        const account = await getAccount(pool, agreementId);
        return res.json({
          status: "success",
          replayed: true,
          message: "This collection was already recorded. The original receipt is returned.",
          payment_id: replay.id,
          receipt_number: replay.receipt_number,
          account: publicAccount(account),
        });
      }

      let account = await getAccount(connection, agreementId, { lock: true });
      if (!account) throw new FinanceLifecycleError(404, "Finance agreement was not found.");
      const currentReconciliation = await assertFinanceMutationSafe(account.id, {
        connection,
        lock: false,
      });
      account = { ...account, ...currentReconciliation.calculated };
      if (account.equipment_commitment_status !== "reserved") {
        throw new FinanceLifecycleError(409, "Complete the opening deposit and machine reservation before collections.");
      }
      if (Number(account.deposit_received || 0) + 0.01 < Number(account.deposit_required || 0)) {
        throw new FinanceLifecycleError(409, "The required opening deposit is not complete.");
      }
      if (!account.asset_is_active || Number(account.active_hire_count || 0) > 0) {
        throw new FinanceLifecycleError(
          409,
          "The exact financed machine is inactive or currently committed to Hire.",
          "EQUIPMENT_ACTIVE_ON_HIRE"
        );
      }
      const outstanding = Number(currentReconciliation.calculated.outstanding_balance || 0);
      if (amount > outstanding + 0.01) {
        throw new FinanceLifecycleError(
          400,
          `Payment exceeds the final account balance of GHS ${outstanding.toFixed(2)}.`,
          "FINANCE_COLLECTION_EXCEEDS_ACCOUNT_BALANCE"
        );
      }
      const settlement = amount + 0.01 >= outstanding;
      const paymentStage = settlement ? "settlement" : "installment_collection";
      const paymentCategory = settlement ? "settlement" : "installment";
      const paymentNumber = await nextFinanceNumber("EQUIPMENT_SALE_PAYMENT", "ESP", userId(req));
      const receiptNumber = await nextFinanceNumber("EQUIPMENT_SALE_RECEIPT", "ESR", userId(req));
      const [result] = await connection.query(
        `INSERT INTO equipment_sale_payments (
           payment_number, receipt_number, idempotency_key, hire_location_id,
           agreement_id, credit_application_id, customer_id, payment_date,
           payment_category, payment_stage, reservation_effect, amount,
           payment_method, reference_number, notes, received_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, 'none', ?, ?, ?, ?, ?)`,
        [
          paymentNumber,
          receiptNumber,
          key,
          account.hire_location_id,
          account.id,
          account.credit_application_id,
          account.customer_id,
          paymentCategory,
          paymentStage,
          amount,
          method,
          nullableText(req.body?.reference_number, 150),
          nullableText(req.body?.notes, 1000),
          userId(req),
        ]
      );
      const allocations = await allocateCollection(connection, result.insertId, account.id, amount);
      const refreshed = await refreshAgreement(connection, account.id);
      await writeAuditEvent({
        connection,
        req,
        action: "EQUIPMENT_FINANCE_COLLECTION_RECORDED",
        details: `Recorded ${paymentStage} of GHS ${amount.toFixed(2)} for ${account.agreement_number}.`,
        workspaceCode: "equipment_installment_finance",
        hireLocationId: account.hire_location_id,
        entityType: "equipment_sale_payment",
        entityId: result.insertId,
        metadata: {
          agreement_id: account.id,
          credit_application_id: account.credit_application_id,
          receipt_number: receiptNumber,
          payment_method: method,
          allocations,
          outstanding_balance: refreshed.balance,
        },
      });
      await connection.commit();

      // The payment is already durable before any external SMS request begins.
      const bossAlert = await sendBossPaymentAlert({
        paymentId: result.insertId,
        agreementId: account.id,
        userId: userId(req),
      });
      const finalAccount = await getAccount(pool, account.id);
      return res.status(201).json({
        status: "success",
        message: settlement
          ? "Final settlement recorded. The account is ready for controlled ownership completion after delivery evidence."
          : "Installment collection recorded and allocated across the oldest due and future schedule lines.",
        payment_id: result.insertId,
        receipt_number: receiptNumber,
        payment_stage: paymentStage,
        allocations,
        account: publicAccount(finalAccount),
        boss_payment_alert: bossAlert,
        automatic_sms_sent: Boolean(bossAlert.ok),
        sms: {
          sent: Boolean(bossAlert.ok),
          automatic: true,
          purpose: "boss_payment_alert",
          status: bossAlert.status || "skipped",
        },
      });
    } catch (error) {
      try {
        await connection.rollback();
      } catch (_rollbackError) {
        // Preserve the original error.
      }
      return sendError(res, error, "Could not record the Finance collection.");
    } finally {
      connection.release();
    }
  }
);

router.post(
  "/accounts/:agreementId/delivery",
  requirePermission("fleet.assets.manage"),
  requireFinanceRole(FINALISATION_ROLES, "Finance delivery handover"),
  async (req, res) => {
    const connection = await pool.getConnection();
    try {
      await assertSchemaReady(connection);
      const agreementId = positiveId(req.params.agreementId, "Agreement ID");
      const key = idempotencyKey(req.body?.idempotency_key, "finance-delivery");
      const condition = cleanText(req.body?.condition_status, 40).toLowerCase();
      const receivingPerson = cleanText(req.body?.receiving_person, 150);
      const meterReading = money(req.body?.meter_reading, { minimum: 0, maximum: 1000000000 });
      const fuelLevel = percentage(req.body?.fuel_level_percent, null);
      if (!DELIVERY_CONDITIONS.has(condition) || !receivingPerson || meterReading === undefined || fuelLevel === undefined) {
        throw new FinanceLifecycleError(
          400,
          "Enter the receiving person, machine condition, meter reading and fuel level."
        );
      }

      await connection.beginTransaction();
      const [replayRows] = await connection.query(
        "SELECT * FROM equipment_deliveries WHERE idempotency_key = ? LIMIT 1 FOR UPDATE",
        [key]
      );
      if (replayRows.length) {
        await connection.commit();
        return res.json({ status: "success", replayed: true, delivery: replayRows[0] });
      }
      let account = await getAccount(connection, agreementId, { lock: true });
      if (!account) throw new FinanceLifecycleError(404, "Finance agreement was not found.");
      const reconciliation = await assertFinanceMutationSafe(account.id, {
        connection,
        lock: false,
      });
      account = { ...account, ...reconciliation.calculated };
      if (Number(account.active_hire_count || 0) > 0) {
        throw new FinanceLifecycleError(409, "The financed machine is active on Hire and cannot be handed over.", "EQUIPMENT_ACTIVE_ON_HIRE");
      }
      if (account.equipment_commitment_status !== "reserved") {
        throw new FinanceLifecycleError(409, "The exact machine must be reserved before delivery.");
      }
      if (!deliveryAllowed(account)) {
        throw new FinanceLifecycleError(
          409,
          "The approved payment threshold for delivery has not been reached.",
          "DELIVERY_PAYMENT_THRESHOLD_NOT_MET"
        );
      }
      const [existing] = await connection.query(
        "SELECT id FROM equipment_deliveries WHERE agreement_id = ? LIMIT 1 FOR UPDATE",
        [agreementId]
      );
      if (existing.length) throw new FinanceLifecycleError(409, "Delivery was already recorded.");
      const deliveryNumber = await nextFinanceNumber("EQUIPMENT_SALE_DELIVERY", "ESD", userId(req));
      const [result] = await connection.query(
        `INSERT INTO equipment_deliveries (
           delivery_number, idempotency_key, hire_location_id, agreement_id,
           credit_application_id, handover_stage, customer_id, asset_id,
           delivery_datetime, destination, meter_reading, fuel_level_percent,
           condition_status, attachments_tools, receiving_person, receiving_phone,
           customer_signature_url, delivery_note_url, notes, status,
           created_by, approved_by, approved_at
         ) VALUES (?, ?, ?, ?, ?, 'finance_controlled', ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'delivered', ?, ?, NOW())`,
        [
          deliveryNumber,
          key,
          account.hire_location_id,
          account.id,
          account.credit_application_id,
          account.customer_id,
          account.asset_id,
          nullableText(req.body?.destination, 255),
          meterReading,
          fuelLevel,
          condition,
          nullableText(req.body?.attachments_tools, 3000),
          receivingPerson,
          nullableText(req.body?.receiving_phone, 40),
          nullableText(req.body?.customer_signature_url, 100000),
          nullableText(req.body?.delivery_note_url, 3000),
          nullableText(req.body?.notes, 3000),
          userId(req),
          userId(req),
        ]
      );
      await connection.query(
        `UPDATE equipment_sale_agreements
         SET delivery_status = 'delivered', delivered_at = NOW(),
             controlled_delivery_completed_at = NOW(),
             controlled_delivery_completed_by = ?
         WHERE id = ?`,
        [userId(req), account.id]
      );
      if (meterReading > Number(account.current_meter || 0)) {
        await connection.query(
          "UPDATE fleet_assets SET current_meter = ?, updated_by = ? WHERE id = ?",
          [meterReading, userId(req), account.asset_id]
        );
      }
      await writeAuditEvent({
        connection,
        req,
        action: "EQUIPMENT_FINANCE_DELIVERY_COMPLETED",
        details: `Completed controlled Finance delivery ${deliveryNumber}.`,
        workspaceCode: "equipment_installment_finance",
        hireLocationId: account.hire_location_id,
        entityType: "equipment_delivery",
        entityId: result.insertId,
        metadata: { agreement_id: account.id, asset_id: account.asset_id, handover_stage: "finance_controlled" },
      });
      await connection.commit();
      return res.status(201).json({
        status: "success",
        message: "Controlled Finance delivery and handover evidence recorded.",
        delivery_id: result.insertId,
        delivery_number: deliveryNumber,
        automatic_sms_sent: false,
        sms: { sent: false, automatic: false },
      });
    } catch (error) {
      try {
        await connection.rollback();
      } catch (_rollbackError) {}
      return sendError(res, error, "Could not complete Finance delivery.");
    } finally {
      connection.release();
    }
  }
);

router.post(
  "/accounts/:agreementId/ownership-transfer",
  requirePermission("fleet.assets.manage"),
  requireFinanceRole(FINALISATION_ROLES, "Finance ownership transfer"),
  async (req, res) => {
    const connection = await pool.getConnection();
    try {
      await assertSchemaReady(connection);
      const agreementId = positiveId(req.params.agreementId, "Agreement ID");
      const key = idempotencyKey(req.body?.idempotency_key, "finance-ownership");
      const transferDate = cleanText(req.body?.transfer_date, 20);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) {
        throw new FinanceLifecycleError(400, "Enter a valid ownership-transfer date.");
      }

      await connection.beginTransaction();
      const [replayRows] = await connection.query(
        "SELECT * FROM equipment_ownership_transfers WHERE idempotency_key = ? LIMIT 1 FOR UPDATE",
        [key]
      );
      if (replayRows.length) {
        await connection.commit();
        return res.json({ status: "success", replayed: true, ownership_transfer: replayRows[0] });
      }
      let account = await getAccount(connection, agreementId, { lock: true });
      if (!account) throw new FinanceLifecycleError(404, "Finance agreement was not found.");
      const reconciliation = await assertFinanceMutationSafe(account.id, {
        connection,
        lock: false,
      });
      account = { ...account, ...reconciliation.calculated };
      if (Number(account.active_hire_count || 0) > 0) {
        throw new FinanceLifecycleError(409, "The financed machine is active on Hire and ownership cannot transfer.", "EQUIPMENT_ACTIVE_ON_HIRE");
      }
      if (Number(account.outstanding_balance || 0) > 0.01) {
        throw new FinanceLifecycleError(
          409,
          `Ownership cannot transfer while GHS ${Number(account.outstanding_balance).toFixed(2)} remains.`,
          "OWNERSHIP_BALANCE_REMAINS"
        );
      }
      if (!account.controlled_delivery_completed_at || account.delivery_status_record !== "delivered") {
        throw new FinanceLifecycleError(409, "Complete the controlled delivery handover before ownership transfer.");
      }
      const [existing] = await connection.query(
        "SELECT id FROM equipment_ownership_transfers WHERE agreement_id = ? LIMIT 1 FOR UPDATE",
        [agreementId]
      );
      if (existing.length) throw new FinanceLifecycleError(409, "Ownership was already transferred.");
      const transferNumber = await nextFinanceNumber("EQUIPMENT_OWNERSHIP_TRANSFER", "EOT", userId(req));
      const [result] = await connection.query(
        `INSERT INTO equipment_ownership_transfers (
           transfer_number, idempotency_key, hire_location_id, agreement_id,
           credit_application_id, transfer_stage, customer_id, asset_id,
           transfer_date, ownership_document_url, registration_transfer_reference,
           notes, status, issued_by, issued_at
         ) VALUES (?, ?, ?, ?, ?, 'finance_controlled', ?, ?, ?, ?, ?, ?, 'issued', ?, NOW())`,
        [
          transferNumber,
          key,
          account.hire_location_id,
          account.id,
          account.credit_application_id,
          account.customer_id,
          account.asset_id,
          transferDate,
          nullableText(req.body?.ownership_document_url, 3000),
          nullableText(req.body?.registration_transfer_reference, 150),
          nullableText(req.body?.notes, 3000),
          userId(req),
        ]
      );
      await connection.query(
        `UPDATE equipment_sale_agreements
         SET ownership_status = 'transferred', agreement_status = 'completed',
             completed_at = COALESCE(completed_at, NOW()),
             controlled_ownership_completed_at = NOW(),
             controlled_ownership_completed_by = ?
         WHERE id = ?`,
        [userId(req), account.id]
      );
      await connection.query(
        `UPDATE equipment_asset_sale_locks
         SET lock_status = 'sold', expires_at = NULL
         WHERE agreement_id = ? AND released_at IS NULL`,
        [account.id]
      );
      await connection.query(
        `UPDATE fleet_assets
         SET sale_status = 'sold', current_status = 'sold', sold_at = NOW(), updated_by = ?
         WHERE id = ?`,
        [userId(req), account.asset_id]
      );
      await writeAuditEvent({
        connection,
        req,
        action: "EQUIPMENT_FINANCE_OWNERSHIP_TRANSFERRED",
        details: `Completed controlled ownership transfer ${transferNumber}.`,
        workspaceCode: "equipment_installment_finance",
        hireLocationId: account.hire_location_id,
        entityType: "equipment_ownership_transfer",
        entityId: result.insertId,
        metadata: { agreement_id: account.id, asset_id: account.asset_id, transfer_stage: "finance_controlled" },
      });
      await connection.commit();
      return res.status(201).json({
        status: "success",
        message: "Ownership transfer completed and the exact machine was marked sold.",
        transfer_id: result.insertId,
        transfer_number: transferNumber,
        automatic_sms_sent: false,
        sms: { sent: false, automatic: false },
      });
    } catch (error) {
      try {
        await connection.rollback();
      } catch (_rollbackError) {}
      return sendError(res, error, "Could not complete Finance ownership transfer.");
    } finally {
      connection.release();
    }
  }
);

module.exports = router;
module.exports.COLLECTION_ROLES = COLLECTION_ROLES;
module.exports.FINALISATION_ROLES = FINALISATION_ROLES;
module.exports.allocateCollection = allocateCollection;
module.exports.schemaStatus = schemaStatus;
