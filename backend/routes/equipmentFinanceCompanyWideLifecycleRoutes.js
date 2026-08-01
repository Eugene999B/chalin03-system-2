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
  "equipment_finance_case_documents",
  "fleet_assets",
  "hire_contract_assets",
  "hire_customers",
]);

class LifecycleError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_FINANCE_LIFECYCLE_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanText(value, maximum = 1000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function nullableText(value, maximum = 1000) {
  return cleanText(value, maximum) || null;
}

function positiveId(value, label = "ID") {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new LifecycleError(400, `${label} must be a positive whole number.`, "INVALID_IDENTIFIER");
  }
  return id;
}

function optionalPositiveId(value) {
  if (value === undefined || value === null || value === "") return null;
  return positiveId(value);
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
    throw new LifecycleError(
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

function requireFinanceRole(allowedRoles, label) {
  return (req, res, next) => {
    if (roleAllowed(req, allowedRoles)) return next();
    return res.status(403).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_ROLE_REQUIRED",
      message: `${label} is restricted to authorised Installment Finance staff.`,
    });
  };
}

function sendError(res, error, fallback) {
  if (error?.errno === 1644 || error?.sqlState === "45000") {
    return res.status(409).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_DATABASE_GATE_REJECTED",
      message: cleanText(error.sqlMessage || error.message, 500),
    });
  }
  const statusCode = Number(error.statusCode || 500);
  if (statusCode >= 500) console.error(fallback, error);
  return res.status(statusCode).json({
    status: "error",
    code: error.code || "EQUIPMENT_FINANCE_LIFECYCLE_ERROR",
    message: statusCode >= 500 ? fallback : error.message,
    ...(error.readiness ? { readiness: error.readiness } : {}),
  });
}

async function schemaStatus(connection = pool) {
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
    migration: "20260801_equipment_finance_company_wide_stabilization",
    missing_tables: missing,
  };
}

async function assertSchemaReady(connection = pool) {
  const readiness = await schemaStatus(connection);
  if (!readiness.ready) {
    const error = new LifecycleError(
      503,
      "The company-wide Finance lifecycle is being prepared. Try again after deployment completes.",
      "EQUIPMENT_FINANCE_STABILIZATION_REQUIRED"
    );
    error.readiness = readiness;
    throw error;
  }
  return readiness;
}

function accountSql({ one = false, lock = false } = {}) {
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
    LEFT JOIN equipment_deliveries delivery ON delivery.agreement_id = agreement.id
    LEFT JOIN equipment_ownership_transfers ownership ON ownership.agreement_id = agreement.id
    WHERE agreement.sale_type = 'installment'
      AND agreement.activation_source = 'approved_credit_application'
      ${one ? "AND agreement.id = ?" : ""}
    ${one ? "LIMIT 1" : "ORDER BY agreement.created_at DESC LIMIT 500"}
    ${lock ? "FOR UPDATE" : ""}`;
}

async function getAccount(connection, agreementId, { lock = false } = {}) {
  const [rows] = await connection.query(accountSql({ one: true, lock }), [agreementId]);
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
    total_amount: Number(account.total_amount || 0),
    deposit_required: Number(account.deposit_required || 0),
    deposit_received: Number(account.deposit_received || 0),
    financed_amount: Number(account.financed_amount || 0),
    amount_paid: Number(account.amount_paid || 0),
    outstanding_balance: Number(account.outstanding_balance || 0),
    overdue_amount: Number(account.overdue_amount || 0),
    payment_frequency: account.payment_frequency,
    payment_interval_days: account.payment_interval_days || null,
    non_working_day_rule: account.non_working_day_rule || "exact",
    installment_count: Number(account.installment_count || 0),
    first_due_date: account.first_due_date,
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
    company_wide_finance: true,
    hire_location_id: null,
  };
}

async function nextFinanceNumber(sequence, prefix, actor) {
  try {
    return await nextDocumentNumber(sequence, { userId: actor || null });
  } catch (_error) {
    return `${prefix}-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${String(
      crypto.randomInt(0, 1000000)
    ).padStart(6, "0")}`;
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
       AND schedule_status NOT IN ('paid','cancelled','waived')
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
    const balance = Number(Math.max(lineTotal - Number(row.amount_paid || 0), 0).toFixed(2));
    if (balance <= 0) continue;
    const allocated = Number(Math.min(remaining, balance).toFixed(2));
    await connection.query(
      `INSERT INTO equipment_sale_payment_allocations
         (payment_id, schedule_id, allocated_amount)
       VALUES (?, ?, ?)`,
      [paymentId, row.id, allocated]
    );
    const paid = Number((Number(row.amount_paid || 0) + allocated).toFixed(2));
    const status = paid + 0.01 >= lineTotal ? "paid" : "partial";
    await connection.query(
      `UPDATE equipment_installment_schedule
       SET amount_paid = ?, schedule_status = ?,
           fully_paid_at = CASE WHEN ? = 'paid' THEN COALESCE(fully_paid_at, NOW()) ELSE fully_paid_at END
       WHERE id = ?`,
      [paid, status, status, row.id]
    );
    allocations.push({
      schedule_id: row.id,
      sequence_number: row.sequence_number,
      due_date: row.due_date,
      allocated_amount: allocated,
      schedule_status: status,
    });
    remaining = Number((remaining - allocated).toFixed(2));
  }
  if (remaining > 0.01) {
    throw new LifecycleError(
      409,
      "The collection could not be allocated completely. No payment was saved.",
      "FINANCE_COLLECTION_ALLOCATION_INCOMPLETE"
    );
  }
  return allocations;
}

async function refreshAgreement(connection, agreementId) {
  const [paymentRows] = await connection.query(
    `SELECT COALESCE(SUM(amount), 0) AS paid
     FROM equipment_sale_payments
     WHERE agreement_id = ? AND is_voided = FALSE`,
    [agreementId]
  );
  const [agreementRows] = await connection.query(
    `SELECT total_amount FROM equipment_sale_agreements WHERE id = ? LIMIT 1 FOR UPDATE`,
    [agreementId]
  );
  const total = Number(agreementRows[0]?.total_amount || 0);
  const paid = Number(paymentRows[0]?.paid || 0);
  const balance = Number(Math.max(total - paid, 0).toFixed(2));
  const [nextRows] = await connection.query(
    `SELECT due_date FROM equipment_installment_schedule
     WHERE agreement_id = ? AND schedule_status NOT IN ('paid','cancelled','waived')
     ORDER BY due_date, sequence_number LIMIT 1`,
    [agreementId]
  );
  const [overdueRows] = await connection.query(
    `SELECT COALESCE(SUM(GREATEST(
       scheduled_amount + late_charge_amount - waived_charge_amount - amount_paid, 0
     )), 0) AS overdue
     FROM equipment_installment_schedule
     WHERE agreement_id = ? AND due_date < CURDATE()
       AND schedule_status NOT IN ('paid','cancelled','waived')`,
    [agreementId]
  );
  const overdue = Number(overdueRows[0]?.overdue || 0);
  const status =
    balance <= 0.01
      ? "completed"
      : overdue > 0.01
        ? "overdue"
        : nextRows[0]?.due_date
          ? "active"
          : "payment_due";
  await connection.query(
    `UPDATE equipment_sale_agreements
     SET hire_location_id = NULL, amount_paid = ?, outstanding_balance = ?, overdue_amount = ?,
         next_due_date = ?, agreement_status = ?,
         completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
         updated_at = NOW()
     WHERE id = ?`,
    [paid, balance, overdue, nextRows[0]?.due_date || null, status, status, agreementId]
  );
  return { paid, balance, overdue, status, next_due_date: nextRows[0]?.due_date || null };
}

async function verifiedCaseDocument(connection, documentId, account, allowedCategories) {
  const id = optionalPositiveId(documentId);
  if (!id) return null;
  const [rows] = await connection.query(
    `SELECT id, application_id, agreement_id, document_category, document_label,
            original_file_name, stored_mime_type, checksum_sha256, document_status
     FROM equipment_finance_case_documents
     WHERE id = ?
       AND document_status = 'verified'
       AND (agreement_id = ? OR application_id = ?)
     LIMIT 1 FOR UPDATE`,
    [id, account.id, account.credit_application_id]
  );
  const document = rows[0];
  if (!document || !allowedCategories.has(document.document_category)) {
    throw new LifecycleError(
      409,
      "Choose a verified protected document from this Finance case.",
      "FINANCE_VERIFIED_CASE_DOCUMENT_REQUIRED"
    );
  }
  return document;
}

function protectedDocumentUrl(document) {
  return document
    ? `/api/equipment-catalogue/sales/operational-polish/documents/${document.id}/download`
    : null;
}

async function audit(req, connection, action, entityType, entityId, details, metadata = {}) {
  await writeAuditEvent({
    connection,
    req,
    action,
    actionType: action,
    details,
    workspaceCode: "equipment_installment_finance",
    hireLocationId: null,
    entityType,
    entityId,
    severity: "notice",
    outcome: "success",
    metadata: {
      finance_scope: "company_wide",
      hire_location_id: null,
      ...metadata,
    },
  });
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
    const [rows] = await pool.query(accountSql());
    return res.json({
      status: "success",
      count: rows.length,
      accounts: rows.map(publicAccount),
      scope: "company_wide_finance",
      policy: {
        hire_location_selection_required: false,
        collection_allocation: "oldest_due_first_then_future_schedule",
        partial_payments_allowed: true,
        payment_above_period_allowed: true,
        overpayment_above_account_balance_allowed: false,
        lifecycle_evidence: "verified_private_case_documents",
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
    if (!account) throw new LifecycleError(404, "Finance agreement was not found.");
    const [[schedule], [payments], [allocations], [deliveries], [ownership], [documents]] =
      await Promise.all([
        pool.query(
          "SELECT * FROM equipment_installment_schedule WHERE agreement_id = ? ORDER BY sequence_number",
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
        pool.query("SELECT * FROM equipment_deliveries WHERE agreement_id = ? ORDER BY id DESC", [agreementId]),
        pool.query("SELECT * FROM equipment_ownership_transfers WHERE agreement_id = ? ORDER BY id DESC", [agreementId]),
        pool.query(
          `SELECT id, document_category, document_label, original_file_name,
                  stored_mime_type, checksum_sha256, document_status, created_at
           FROM equipment_finance_case_documents
           WHERE agreement_id = ? OR application_id = ?
           ORDER BY created_at DESC, id DESC`,
          [agreementId, account.credit_application_id]
        ),
      ]);
    return res.json({
      status: "success",
      account: publicAccount(account),
      schedule,
      payments: payments.map((payment) => ({ ...payment, hire_location_id: null })),
      payment_allocations: allocations,
      deliveries: deliveries.map((delivery) => ({ ...delivery, hire_location_id: null })),
      ownership_transfers: ownership.map((transfer) => ({ ...transfer, hire_location_id: null })),
      case_documents: documents,
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
        throw new LifecycleError(400, "Enter a valid collection amount and payment method.");
      }

      await connection.beginTransaction();
      const [replayRows] = await connection.query(
        `SELECT id, receipt_number, agreement_id, amount, payment_stage
         FROM equipment_sale_payments WHERE idempotency_key = ? LIMIT 1 FOR UPDATE`,
        [key]
      );
      if (replayRows.length) {
        const replay = replayRows[0];
        if (Number(replay.agreement_id) !== agreementId || Math.abs(Number(replay.amount) - amount) > 0.01) {
          throw new LifecycleError(409, "This request key was already used for different collection details.", "FINANCE_IDEMPOTENCY_CONFLICT");
        }
        await connection.commit();
        return res.json({
          status: "success",
          replayed: true,
          message: "This collection was already recorded. The original receipt is returned.",
          payment_id: replay.id,
          receipt_number: replay.receipt_number,
          account: publicAccount(await getAccount(pool, agreementId)),
        });
      }

      const account = await getAccount(connection, agreementId, { lock: true });
      if (!account) throw new LifecycleError(404, "Finance agreement was not found.");
      if (account.equipment_commitment_status !== "reserved") {
        throw new LifecycleError(409, "Complete the opening deposit and machine reservation before collections.");
      }
      if (Number(account.deposit_received || 0) + 0.01 < Number(account.deposit_required || 0)) {
        throw new LifecycleError(409, "The required opening deposit is not complete.");
      }
      if (!account.asset_is_active || Number(account.active_hire_count || 0) > 0) {
        throw new LifecycleError(409, "The exact financed machine is inactive or currently committed to Hire.", "EQUIPMENT_ACTIVE_ON_HIRE");
      }
      const outstanding = Number(account.outstanding_balance || 0);
      if (amount > outstanding + 0.01) {
        throw new LifecycleError(400, `Payment exceeds the final account balance of GHS ${outstanding.toFixed(2)}.`, "FINANCE_COLLECTION_EXCEEDS_ACCOUNT_BALANCE");
      }
      const settlement = amount + 0.01 >= outstanding;
      const paymentStage = settlement ? "settlement" : "installment_collection";
      const paymentCategory = settlement ? "settlement" : "installment";
      const paymentNumber = await nextFinanceNumber("EQUIPMENT_SALE_PAYMENT", "ESP", userId(req));
      const receiptNumber = await nextFinanceNumber("EQUIPMENT_SALE_RECEIPT", "ESR", userId(req));
      const [insert] = await connection.query(
        `INSERT INTO equipment_sale_payments SET ?`,
        {
          payment_number: paymentNumber,
          receipt_number: receiptNumber,
          idempotency_key: key,
          hire_location_id: null,
          agreement_id: account.id,
          credit_application_id: account.credit_application_id,
          customer_id: account.customer_id,
          payment_date: new Date(),
          payment_category: paymentCategory,
          payment_stage: paymentStage,
          reservation_effect: "none",
          amount,
          payment_method: method,
          reference_number: nullableText(req.body?.reference_number, 150),
          notes: nullableText(req.body?.notes, 1000),
          received_by: userId(req),
        }
      );
      const allocations = await allocateCollection(connection, insert.insertId, account.id, amount);
      const refreshed = await refreshAgreement(connection, account.id);
      await audit(
        req,
        connection,
        "EQUIPMENT_FINANCE_COLLECTION_RECORDED",
        "equipment_sale_payment",
        insert.insertId,
        `Recorded ${paymentStage} of GHS ${amount.toFixed(2)} for ${account.agreement_number}.`,
        {
          agreement_id: account.id,
          credit_application_id: account.credit_application_id,
          receipt_number: receiptNumber,
          payment_method: method,
          allocations,
          outstanding_balance: refreshed.balance,
        }
      );
      await connection.commit();

      const bossAlert = await sendBossPaymentAlert({
        paymentId: insert.insertId,
        agreementId: account.id,
        userId: userId(req),
      });
      return res.status(201).json({
        status: "success",
        message: settlement
          ? "Final settlement recorded. The account is ready for ownership completion after delivery evidence."
          : "Installment collection recorded and allocated across the oldest due and future schedule lines.",
        payment_id: insert.insertId,
        receipt_number: receiptNumber,
        payment_stage: paymentStage,
        allocations,
        account: publicAccount(await getAccount(pool, account.id)),
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
        throw new LifecycleError(400, "Enter the receiving person, machine condition, meter reading and fuel level.");
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
      const account = await getAccount(connection, agreementId, { lock: true });
      if (!account) throw new LifecycleError(404, "Finance agreement was not found.");
      if (Number(account.active_hire_count || 0) > 0) {
        throw new LifecycleError(409, "The financed machine is active on Hire and cannot be handed over.", "EQUIPMENT_ACTIVE_ON_HIRE");
      }
      if (account.equipment_commitment_status !== "reserved") {
        throw new LifecycleError(409, "The exact machine must be reserved before delivery.");
      }
      if (!deliveryAllowed(account)) {
        throw new LifecycleError(409, "The approved payment threshold for delivery has not been reached.", "DELIVERY_PAYMENT_THRESHOLD_NOT_MET");
      }
      const [existing] = await connection.query(
        "SELECT id FROM equipment_deliveries WHERE agreement_id = ? LIMIT 1 FOR UPDATE",
        [agreementId]
      );
      if (existing.length) throw new LifecycleError(409, "Delivery was already recorded.");

      const signatureDocument = await verifiedCaseDocument(
        connection,
        req.body?.customer_signature_document_id,
        account,
        new Set(["customer_signature", "buyer_signature", "signed_handover"])
      );
      const deliveryDocument = await verifiedCaseDocument(
        connection,
        req.body?.delivery_note_document_id,
        account,
        new Set(["delivery_note", "delivery_evidence", "signed_handover"])
      );
      if (!signatureDocument || !deliveryDocument) {
        throw new LifecycleError(
          409,
          "Upload and verify the customer signature and delivery-note evidence in Case Operations first.",
          "FINANCE_DELIVERY_DOCUMENTS_REQUIRED"
        );
      }

      const deliveryNumber = await nextFinanceNumber("EQUIPMENT_SALE_DELIVERY", "ESD", userId(req));
      const [insert] = await connection.query(
        `INSERT INTO equipment_deliveries SET ?`,
        {
          delivery_number: deliveryNumber,
          idempotency_key: key,
          hire_location_id: null,
          agreement_id: account.id,
          credit_application_id: account.credit_application_id,
          handover_stage: "finance_controlled",
          customer_id: account.customer_id,
          asset_id: account.asset_id,
          delivery_datetime: new Date(),
          destination: nullableText(req.body?.destination, 255),
          meter_reading: meterReading,
          fuel_level_percent: fuelLevel,
          condition_status: condition,
          attachments_tools: nullableText(req.body?.attachments_tools, 3000),
          receiving_person: receivingPerson,
          receiving_phone: nullableText(req.body?.receiving_phone, 40),
          customer_signature_url: protectedDocumentUrl(signatureDocument),
          delivery_note_url: protectedDocumentUrl(deliveryDocument),
          notes: nullableText(req.body?.notes, 3000),
          status: "delivered",
          created_by: userId(req),
          approved_by: userId(req),
          approved_at: new Date(),
        }
      );
      await connection.query(
        `UPDATE equipment_sale_agreements
         SET hire_location_id = NULL, delivery_status = 'delivered', delivered_at = NOW(),
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
      await audit(
        req,
        connection,
        "EQUIPMENT_FINANCE_DELIVERY_COMPLETED",
        "equipment_delivery",
        insert.insertId,
        `Completed controlled Finance delivery ${deliveryNumber}.`,
        {
          agreement_id: account.id,
          asset_id: account.asset_id,
          handover_stage: "finance_controlled",
          customer_signature_document_id: signatureDocument.id,
          delivery_note_document_id: deliveryDocument.id,
        }
      );
      await connection.commit();
      return res.status(201).json({
        status: "success",
        message: "Controlled Finance delivery and verified handover evidence recorded.",
        delivery_id: insert.insertId,
        delivery_number: deliveryNumber,
        automatic_sms_sent: false,
        sms: { sent: false, automatic: false },
      });
    } catch (error) {
      try {
        await connection.rollback();
      } catch (_rollbackError) {
        // Preserve the original error.
      }
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
        throw new LifecycleError(400, "Enter a valid ownership-transfer date.");
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
      const account = await getAccount(connection, agreementId, { lock: true });
      if (!account) throw new LifecycleError(404, "Finance agreement was not found.");
      if (Number(account.active_hire_count || 0) > 0) {
        throw new LifecycleError(409, "The financed machine is active on Hire and ownership cannot transfer.", "EQUIPMENT_ACTIVE_ON_HIRE");
      }
      if (Number(account.outstanding_balance || 0) > 0.01) {
        throw new LifecycleError(409, `Ownership cannot transfer while GHS ${Number(account.outstanding_balance).toFixed(2)} remains.`, "OWNERSHIP_BALANCE_REMAINS");
      }
      if (!account.controlled_delivery_completed_at || account.delivery_status_record !== "delivered") {
        throw new LifecycleError(409, "Complete the controlled delivery handover before ownership transfer.");
      }
      const [existing] = await connection.query(
        "SELECT id FROM equipment_ownership_transfers WHERE agreement_id = ? LIMIT 1 FOR UPDATE",
        [agreementId]
      );
      if (existing.length) throw new LifecycleError(409, "Ownership was already transferred.");

      const ownershipDocument = await verifiedCaseDocument(
        connection,
        req.body?.ownership_document_id,
        account,
        new Set(["ownership_document", "ownership_transfer", "registration_transfer"])
      );
      if (!ownershipDocument) {
        throw new LifecycleError(
          409,
          "Upload and verify the ownership-transfer document in Case Operations first.",
          "FINANCE_OWNERSHIP_DOCUMENT_REQUIRED"
        );
      }

      const transferNumber = await nextFinanceNumber("EQUIPMENT_OWNERSHIP_TRANSFER", "EOT", userId(req));
      const [insert] = await connection.query(
        `INSERT INTO equipment_ownership_transfers SET ?`,
        {
          transfer_number: transferNumber,
          idempotency_key: key,
          hire_location_id: null,
          agreement_id: account.id,
          credit_application_id: account.credit_application_id,
          transfer_stage: "finance_controlled",
          customer_id: account.customer_id,
          asset_id: account.asset_id,
          transfer_date: transferDate,
          ownership_document_url: protectedDocumentUrl(ownershipDocument),
          registration_transfer_reference: nullableText(
            req.body?.registration_transfer_reference,
            150
          ),
          notes: nullableText(req.body?.notes, 3000),
          status: "issued",
          issued_by: userId(req),
          issued_at: new Date(),
        }
      );
      await connection.query(
        `UPDATE equipment_sale_agreements
         SET hire_location_id = NULL, ownership_status = 'transferred',
             agreement_status = 'completed', completed_at = COALESCE(completed_at, NOW()),
             controlled_ownership_completed_at = NOW(),
             controlled_ownership_completed_by = ?
         WHERE id = ?`,
        [userId(req), account.id]
      );
      await connection.query(
        `UPDATE equipment_asset_sale_locks
         SET hire_location_id = NULL, lock_status = 'sold', expires_at = NULL
         WHERE agreement_id = ? AND released_at IS NULL`,
        [account.id]
      );
      await connection.query(
        `UPDATE fleet_assets
         SET sale_status = 'sold', current_status = 'sold', sold_at = NOW(), updated_by = ?
         WHERE id = ?`,
        [userId(req), account.asset_id]
      );
      await audit(
        req,
        connection,
        "EQUIPMENT_FINANCE_OWNERSHIP_TRANSFERRED",
        "equipment_ownership_transfer",
        insert.insertId,
        `Completed controlled ownership transfer ${transferNumber}.`,
        {
          agreement_id: account.id,
          asset_id: account.asset_id,
          transfer_stage: "finance_controlled",
          ownership_document_id: ownershipDocument.id,
        }
      );
      await connection.commit();
      return res.status(201).json({
        status: "success",
        message: "Ownership transfer completed and the exact machine was marked sold.",
        transfer_id: insert.insertId,
        transfer_number: transferNumber,
        automatic_sms_sent: false,
        sms: { sent: false, automatic: false },
      });
    } catch (error) {
      try {
        await connection.rollback();
      } catch (_rollbackError) {
        // Preserve the original error.
      }
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
module.exports.publicAccount = publicAccount;
module.exports.schemaStatus = schemaStatus;
