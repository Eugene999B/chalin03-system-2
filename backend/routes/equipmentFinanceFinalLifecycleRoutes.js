const crypto = require("crypto");
const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { nextDocumentNumber } = require("../services/groupConfigurationService");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { workspaceRoleFor } = require("../security/equipmentDivisionAccess");

const router = express.Router();

const COLLECTION_ROLES = new Set([
  "finance_manager",
  "finance_accountant",
  "collections_officer",
]);
const FINALISATION_ROLES = new Set(["finance_manager", "finance_accountant"]);
const PAYMENT_METHODS = new Set(["cash", "momo", "bank", "cheque", "other"]);
const DELIVERY_CONDITIONS = new Set([
  "new",
  "excellent",
  "good",
  "fair",
  "poor",
  "damaged",
]);

const REQUIRED_COLUMNS = Object.freeze({
  equipment_sale_agreements: [
    "credit_application_id",
    "activation_source",
    "equipment_commitment_status",
    "controlled_delivery_completed_at",
    "controlled_delivery_completed_by",
    "controlled_ownership_completed_at",
    "controlled_ownership_completed_by",
  ],
  equipment_sale_payments: [
    "credit_application_id",
    "payment_stage",
    "reservation_effect",
    "idempotency_key",
  ],
  equipment_deliveries: [
    "credit_application_id",
    "handover_stage",
    "idempotency_key",
  ],
  equipment_ownership_transfers: [
    "credit_application_id",
    "transfer_stage",
    "idempotency_key",
  ],
});

const REQUIRED_TRIGGERS = Object.freeze([
  "trg_equipment_finance_payment_gate_before_insert",
  "trg_equipment_finance_delivery_gate_before_insert",
  "trg_equipment_finance_ownership_gate_before_insert",
  "trg_equipment_finance_lifecycle_agreement_before_update",
]);

class LifecycleError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_FINANCE_LIFECYCLE_ERROR") {
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
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Number(number.toFixed(2))
    : undefined;
}

function percent(value, fallback = undefined) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100
    ? Number(number.toFixed(4))
    : undefined;
}

function enumValue(value, allowed, fallback = undefined) {
  const text = cleanText(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
  if (!text) return fallback;
  return allowed.has(text) ? text : undefined;
}

function dateOnly(value, fallback = null) {
  const text = cleanText(value, 20);
  if (!text) return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

function dateTime(value, fallback = null) {
  const text = cleanText(value, 60);
  if (!text) return fallback;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

function selectedLocationId(req) {
  const id = positiveId(req.hireLocationScope?.locationId);
  if (!id) {
    throw new LifecycleError(
      400,
      "Choose a specific Finance location before changing lifecycle records.",
      "EQUIPMENT_FINANCE_LOCATION_REQUIRED"
    );
  }
  return id;
}

function assertCollectionOfficer(req) {
  if (isOriginalSystemAdministrator(req.user)) return;
  if (!COLLECTION_ROLES.has(workspaceRoleFor(req.user))) {
    throw new LifecycleError(
      403,
      "Only the Finance Manager, Finance Accountant or Collections Officer can record installment collections.",
      "EQUIPMENT_FINANCE_COLLECTION_PERMISSION_REQUIRED"
    );
  }
}

function assertFinalisationOfficer(req, action) {
  if (isOriginalSystemAdministrator(req.user)) return;
  if (!FINALISATION_ROLES.has(workspaceRoleFor(req.user))) {
    throw new LifecycleError(
      403,
      `Only the Finance Manager or Finance Accountant can ${action}.`,
      "EQUIPMENT_FINANCE_FINALISATION_PERMISSION_REQUIRED"
    );
  }
}

function secureIdempotencyKey(value, prefix, agreementId) {
  const key = cleanText(value, 191);
  if (!key || key.length < 20 || !key.startsWith(`${prefix}:${agreementId}:`)) {
    throw new LifecycleError(
      400,
      "Refresh the Finance action and submit it again with its secure request key.",
      "EQUIPMENT_FINANCE_IDEMPOTENCY_REQUIRED"
    );
  }
  return key;
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
  const installed = new Set(triggerRows.map((row) => row.TRIGGER_NAME));
  const missingTriggers = REQUIRED_TRIGGERS.filter((name) => !installed.has(name));

  return {
    ready: missingColumns.length === 0 && missingTriggers.length === 0,
    missing_columns: missingColumns,
    missing_triggers: missingTriggers,
    automatic_sms_enabled: false,
    automatic_sms_reason:
      "Automatic installment SMS remains disabled until a separate approved release.",
  };
}

async function assertSchemaReady(connection = pool) {
  const status = await schemaStatus(connection);
  if (!status.ready) {
    const error = new LifecycleError(
      503,
      "The final Finance lifecycle is being prepared. Apply and verify the approved lifecycle migration first.",
      "EQUIPMENT_FINANCE_FINAL_LIFECYCLE_FOUNDATION_REQUIRED"
    );
    error.readiness = status;
    throw error;
  }
  return status;
}

function sendError(res, error, fallbackMessage) {
  if (error instanceof LifecycleError) {
    return res.status(error.statusCode).json({
      status: "error",
      code: error.code,
      message: error.message,
      readiness: error.readiness,
    });
  }
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return res.status(503).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_FINAL_LIFECYCLE_FOUNDATION_REQUIRED",
      message:
        "The final Finance lifecycle is being prepared. Apply and verify the approved lifecycle migration first.",
    });
  }
  if (error?.errno === 1644 || error?.sqlState === "45000") {
    return res.status(409).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_LIFECYCLE_GATE_REJECTED",
      message: cleanText(error.sqlMessage || error.message, 500),
    });
  }
  if (error?.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      status: "error",
      code: "EQUIPMENT_FINANCE_LIFECYCLE_DUPLICATE",
      message: "This Finance lifecycle action has already been recorded.",
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
      // Preserve the original failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function loadAgreement(connection, agreementId, locationId, lock = false) {
  const [rows] = await connection.query(
    `SELECT
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
       asset.main_image_url,
       asset.current_meter,
       asset.sale_status AS asset_sale_status,
       asset.operational_purpose,
       asset.is_active AS asset_is_active,
       location.name AS finance_location_name,
       sale_lock.id AS active_lock_id,
       sale_lock.lock_status AS active_lock_status,
       delivery.id AS delivery_id,
       delivery.delivery_number,
       delivery.delivery_datetime,
       delivery.handover_stage,
       ownership.id AS ownership_id,
       ownership.transfer_number,
       ownership.transfer_date,
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
     INNER JOIN hire_customers customer
       ON customer.id = agreement.customer_id
     INNER JOIN fleet_assets asset
       ON asset.id = agreement.asset_id
     INNER JOIN business_locations location
       ON location.id = agreement.hire_location_id
     LEFT JOIN equipment_asset_sale_locks sale_lock
       ON sale_lock.agreement_id = agreement.id
      AND sale_lock.released_at IS NULL
     LEFT JOIN equipment_deliveries delivery
       ON delivery.agreement_id = agreement.id
     LEFT JOIN equipment_ownership_transfers ownership
       ON ownership.agreement_id = agreement.id
     WHERE agreement.id = ?
       AND agreement.hire_location_id = ?
     LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [agreementId, locationId]
  );
  return rows[0] || null;
}

function assertControlledAgreement(agreement) {
  if (!agreement) {
    throw new LifecycleError(404, "Finance agreement was not found.");
  }
  if (
    agreement.sale_type !== "installment" ||
    agreement.activation_source !== "approved_credit_application" ||
    !agreement.credit_application_id
  ) {
    throw new LifecycleError(
      409,
      "This is a legacy agreement. Continue managing it through the existing legacy account workflow.",
      "EQUIPMENT_FINANCE_LEGACY_AGREEMENT"
    );
  }
  if (
    agreement.application_status !== "approved" ||
    agreement.kyc_status !== "verified" ||
    !["eligible", "manual_review"].includes(agreement.affordability_status)
  ) {
    throw new LifecycleError(
      409,
      "The linked credit application no longer satisfies the approved Finance gate."
    );
  }
}

function assertReservedMachine(agreement) {
  if (agreement.equipment_commitment_status !== "reserved") {
    throw new LifecycleError(
      409,
      "Complete the required deposit and machine reservation before continuing.",
      "EQUIPMENT_FINANCE_MACHINE_NOT_RESERVED"
    );
  }
  if (!agreement.asset_is_active) {
    throw new LifecycleError(409, "The equipment is not active in the shared machine register.");
  }
  if (!["sale_only", "sale_or_hire"].includes(agreement.operational_purpose)) {
    throw new LifecycleError(409, "The equipment is not authorised for sale.");
  }
  if (Number(agreement.active_hire_count || 0) > 0) {
    throw new LifecycleError(
      409,
      "The equipment is active on a Hire contract and cannot continue through Finance.",
      "EQUIPMENT_ACTIVE_ON_HIRE"
    );
  }
  if (
    agreement.active_lock_status !== "installment_active" ||
    agreement.asset_sale_status !== "installment_active"
  ) {
    throw new LifecycleError(
      409,
      "The controlled Finance reservation is not active for this machine."
    );
  }
}

function deliveryAllowed(agreement) {
  const paid = Number(agreement.amount_paid || 0);
  const total = Number(agreement.total_amount || 0);
  if (agreement.delivery_policy === "immediate") return true;
  if (agreement.delivery_policy === "after_deposit") {
    return paid + 0.01 >= Number(agreement.deposit_required || 0);
  }
  if (agreement.delivery_policy === "after_percentage") {
    return (
      total > 0 &&
      (paid / total) * 100 + 0.0001 >=
        Number(agreement.delivery_threshold_percent || 0)
    );
  }
  return Number(agreement.outstanding_balance || 0) <= 0.01;
}

function accountShape(agreement) {
  return {
    agreement_id: agreement.id,
    agreement_number: agreement.agreement_number,
    agreement_status: agreement.agreement_status,
    application_id: agreement.credit_application_id,
    application_number: agreement.application_number,
    customer_id: agreement.customer_id,
    customer_name: agreement.customer_name,
    customer_phone: agreement.customer_phone,
    customer_address: agreement.customer_address,
    asset_id: agreement.asset_id,
    asset_code: agreement.asset_code,
    asset_name: agreement.asset_name,
    main_image_url: agreement.main_image_url,
    finance_location_name: agreement.finance_location_name,
    total_amount: Number(agreement.total_amount || 0),
    deposit_required: Number(agreement.deposit_required || 0),
    deposit_received: Number(agreement.deposit_received || 0),
    amount_paid: Number(agreement.amount_paid || 0),
    outstanding_balance: Number(agreement.outstanding_balance || 0),
    overdue_amount: Number(agreement.overdue_amount || 0),
    next_due_date: agreement.next_due_date,
    last_payment_at: agreement.last_payment_at,
    delivery_policy: agreement.delivery_policy,
    delivery_threshold_percent: Number(agreement.delivery_threshold_percent || 0),
    delivery_eligible: deliveryAllowed(agreement),
    equipment_commitment_status: agreement.equipment_commitment_status,
    reserved: agreement.equipment_commitment_status === "reserved",
    delivery_id: agreement.delivery_id,
    delivery_number: agreement.delivery_number,
    delivery_datetime: agreement.delivery_datetime,
    delivery_status: agreement.delivery_status,
    handover_stage: agreement.handover_stage,
    ownership_id: agreement.ownership_id,
    transfer_number: agreement.transfer_number,
    transfer_date: agreement.transfer_date,
    ownership_status: agreement.ownership_status,
    transfer_stage: agreement.transfer_stage,
    fully_paid: Number(agreement.outstanding_balance || 0) <= 0.01,
    active_hire_count: Number(agreement.active_hire_count || 0),
  };
}

async function loadAccountDetail(connection, agreement) {
  const [[schedule], [payments]] = await Promise.all([
    connection.query(
      `SELECT id, sequence_number, due_date, scheduled_amount, amount_paid,
              late_charge_amount, waived_charge_amount, schedule_status, fully_paid_at
       FROM equipment_installment_schedule
       WHERE agreement_id = ?
       ORDER BY sequence_number`,
      [agreement.id]
    ),
    connection.query(
      `SELECT id, payment_number, receipt_number, payment_date, payment_category,
              payment_stage, amount, payment_method, reference_number, notes
       FROM equipment_sale_payments
       WHERE agreement_id = ? AND is_voided = FALSE
       ORDER BY payment_date DESC, id DESC`,
      [agreement.id]
    ),
  ]);
  return { account: accountShape(agreement), schedule, payments };
}

async function audit(req, connection, action, entityType, entityId, details, metadata = {}) {
  await writeAuditEvent({
    connection,
    req,
    action,
    actionType: action,
    entityType,
    entityId,
    workspaceCode: "equipment_hire",
    hireLocationId: req.hireLocationScope?.locationId || null,
    severity: "notice",
    outcome: "success",
    details,
    metadata: {
      division: "installment_finance",
      automatic_sms_sent: false,
      ...metadata,
    },
  });
}

async function allocateCollection(connection, agreementId, paymentId, amount) {
  let remaining = amount;
  const [schedule] = await connection.query(
    `SELECT *
     FROM equipment_installment_schedule
     WHERE agreement_id = ?
       AND schedule_status NOT IN ('paid','cancelled','waived')
     ORDER BY due_date, sequence_number
     FOR UPDATE`,
    [agreementId]
  );

  for (const row of schedule) {
    if (remaining <= 0.001) break;
    const lineTotal =
      Number(row.scheduled_amount || 0) +
      Number(row.late_charge_amount || 0) -
      Number(row.waived_charge_amount || 0);
    const lineBalance = Math.max(lineTotal - Number(row.amount_paid || 0), 0);
    const allocated = Number(Math.min(remaining, lineBalance).toFixed(2));
    if (allocated <= 0) continue;

    await connection.query(
      `INSERT INTO equipment_sale_payment_allocations
         (payment_id, schedule_id, allocated_amount)
       VALUES (?, ?, ?)`,
      [paymentId, row.id, allocated]
    );

    const newPaid = Number((Number(row.amount_paid || 0) + allocated).toFixed(2));
    const status = newPaid + 0.01 >= lineTotal ? "paid" : "partial";
    await connection.query(
      `UPDATE equipment_installment_schedule
       SET amount_paid = ?,
           schedule_status = ?,
           fully_paid_at = CASE
             WHEN ? = 'paid' THEN COALESCE(fully_paid_at, NOW())
             ELSE fully_paid_at
           END
       WHERE id = ?`,
      [newPaid, status, status, row.id]
    );
    remaining = Number((remaining - allocated).toFixed(2));
  }

  if (remaining > 0.01) {
    throw new LifecycleError(
      409,
      "The installment schedule could not accept the full collection amount."
    );
  }

  await connection.query(
    `UPDATE equipment_installment_schedule
     SET schedule_status = CASE
       WHEN amount_paid + 0.01 >=
         scheduled_amount + late_charge_amount - waived_charge_amount THEN 'paid'
       WHEN due_date < CURDATE() THEN 'overdue'
       WHEN due_date = CURDATE() THEN 'due'
       WHEN amount_paid > 0 THEN 'partial'
       ELSE 'upcoming'
     END
     WHERE agreement_id = ?
       AND schedule_status NOT IN ('cancelled','waived')`,
    [agreementId]
  );
}

async function refreshAgreement(connection, agreementId) {
  const [[payment], [schedule], [agreementRows]] = await Promise.all([
    connection.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid
       FROM equipment_sale_payments
       WHERE agreement_id = ?
         AND is_voided = FALSE
         AND payment_category <> 'refund'`,
      [agreementId]
    ),
    connection.query(
      `SELECT
         MIN(CASE
           WHEN schedule_status NOT IN ('paid','cancelled','waived') THEN due_date
         END) AS next_due_date,
         MAX(due_date) AS final_due_date,
         COALESCE(SUM(CASE
           WHEN schedule_status = 'overdue'
           THEN GREATEST(
             scheduled_amount + late_charge_amount - waived_charge_amount - amount_paid,
             0
           )
           ELSE 0
         END), 0) AS overdue_amount
       FROM equipment_installment_schedule
       WHERE agreement_id = ?`,
      [agreementId]
    ),
    connection.query(
      `SELECT total_amount
       FROM equipment_sale_agreements
       WHERE id = ?
       LIMIT 1`,
      [agreementId]
    ),
  ]);

  const paid = Number(payment[0]?.paid || 0);
  const total = Number(agreementRows[0]?.total_amount || 0);
  const balance = Number(Math.max(total - paid, 0).toFixed(2));
  const overdueAmount = Number(schedule[0]?.overdue_amount || 0);
  const nextDueDate = schedule[0]?.next_due_date || null;
  let status = balance <= 0.01 ? "completed" : "active";
  if (balance > 0.01 && overdueAmount > 0) status = "overdue";
  else if (
    balance > 0.01 &&
    nextDueDate &&
    String(nextDueDate).slice(0, 10) === new Date().toISOString().slice(0, 10)
  ) {
    status = "payment_due";
  }

  await connection.query(
    `UPDATE equipment_sale_agreements
     SET amount_paid = ?,
         outstanding_balance = ?,
         overdue_amount = ?,
         next_due_date = ?,
         final_due_date = ?,
         agreement_status = ?,
         completed_at = CASE
           WHEN ? = 'completed' THEN COALESCE(completed_at, NOW())
           ELSE completed_at
         END
     WHERE id = ?`,
    [
      paid,
      balance,
      overdueAmount,
      nextDueDate,
      schedule[0]?.final_due_date || null,
      status,
      status,
      agreementId,
    ]
  );

  return { paid, balance, overdueAmount, nextDueDate, status };
}

router.get("/readiness", requirePermission("fleet.assets.view"), async (_req, res) => {
  try {
    const readiness = await schemaStatus();
    return res.status(readiness.ready ? 200 : 503).json({
      status: readiness.ready ? "success" : "warning",
      readiness,
    });
  } catch (error) {
    return sendError(res, error, "Could not check the Finance lifecycle foundation.");
  }
});

router.get("/accounts", requirePermission("fleet.assets.view"), async (req, res) => {
  try {
    await assertSchemaReady();
    const locationId = selectedLocationId(req);
    const [rows] = await pool.query(
      `SELECT agreement.id
       FROM equipment_sale_agreements agreement
       WHERE agreement.hire_location_id = ?
         AND agreement.sale_type = 'installment'
         AND agreement.activation_source = 'approved_credit_application'
       ORDER BY agreement.created_at DESC
       LIMIT 400`,
      [locationId]
    );
    const accounts = [];
    for (const row of rows) {
      const agreement = await loadAgreement(pool, row.id, locationId);
      if (agreement) accounts.push(accountShape(agreement));
    }
    return res.json({
      status: "success",
      count: accounts.length,
      accounts,
      policy: {
        division: "installment_finance",
        hire_workflow_access: false,
        automatic_sms_enabled: false,
      },
    });
  } catch (error) {
    return sendError(res, error, "Could not load Finance lifecycle accounts.");
  }
});

router.get(
  "/accounts/:agreementId",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      await assertSchemaReady();
      const locationId = selectedLocationId(req);
      const agreementId = positiveId(req.params.agreementId);
      if (!agreementId) {
        throw new LifecycleError(400, "Choose a valid Finance agreement.");
      }
      const agreement = await loadAgreement(pool, agreementId, locationId);
      assertControlledAgreement(agreement);
      return res.json({
        status: "success",
        ...(await loadAccountDetail(pool, agreement)),
      });
    } catch (error) {
      return sendError(res, error, "Could not load the Finance lifecycle account.");
    }
  }
);

router.post(
  "/accounts/:agreementId/collections",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      await assertSchemaReady();
      assertCollectionOfficer(req);
      const locationId = selectedLocationId(req);
      const agreementId = positiveId(req.params.agreementId);
      const amount = money(req.body.amount, undefined);
      const method = enumValue(req.body.payment_method, PAYMENT_METHODS, undefined);
      const idempotencyKey = secureIdempotencyKey(
        req.body.idempotency_key,
        "finance-collection",
        agreementId
      );
      if (!agreementId || amount === undefined || amount <= 0 || method === undefined) {
        throw new LifecycleError(400, "Enter a valid collection amount and payment method.");
      }

      const result = await withTransaction(async (connection) => {
        const [existing] = await connection.query(
          `SELECT id, receipt_number
           FROM equipment_sale_payments
           WHERE idempotency_key = ?
           LIMIT 1
           FOR UPDATE`,
          [idempotencyKey]
        );
        if (existing[0]) {
          return {
            replayed: true,
            payment_id: existing[0].id,
            receipt_number: existing[0].receipt_number,
          };
        }

        const agreement = await loadAgreement(connection, agreementId, locationId, true);
        assertControlledAgreement(agreement);
        assertReservedMachine(agreement);
        if (
          !["active", "due_soon", "payment_due", "overdue"].includes(
            agreement.agreement_status
          )
        ) {
          throw new LifecycleError(409, "Collections are closed for this agreement status.");
        }

        const outstanding = Number(agreement.outstanding_balance || 0);
        if (outstanding <= 0.01) {
          throw new LifecycleError(409, "This Finance agreement is already fully paid.");
        }
        if (amount > outstanding + 0.01) {
          throw new LifecycleError(
            400,
            "The collection amount cannot exceed the outstanding balance."
          );
        }

        const settlement = amount + 0.01 >= outstanding;
        const paymentStage = settlement ? "settlement" : "installment_collection";
        const paymentCategory = settlement ? "settlement" : "installment";
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

        const [payment] = await connection.query(
          `INSERT INTO equipment_sale_payments (
             payment_number, receipt_number, idempotency_key, hire_location_id,
             agreement_id, credit_application_id, customer_id, payment_date,
             payment_category, payment_stage, reservation_effect, amount,
             payment_method, reference_number, notes, received_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, 'none', ?, ?, ?, ?, ?)`,
          [
            paymentNumber,
            receiptNumber,
            idempotencyKey,
            agreement.hire_location_id,
            agreement.id,
            agreement.credit_application_id,
            agreement.customer_id,
            paymentCategory,
            paymentStage,
            amount,
            method,
            nullableText(req.body.reference_number, 150),
            nullableText(req.body.notes, 1000),
            req.user?.id || null,
          ]
        );

        await allocateCollection(connection, agreement.id, payment.insertId, amount);
        const refreshed = await refreshAgreement(connection, agreement.id);
        await audit(
          req,
          connection,
          "EQUIPMENT_FINANCE_COLLECTION_RECORDED",
          "equipment_sale_payment",
          payment.insertId,
          `Recorded a controlled Finance collection for ${agreement.agreement_number}.`,
          {
            receipt_number: receiptNumber,
            payment_stage: paymentStage,
            amount,
            outstanding_balance: refreshed.balance,
          }
        );
        return {
          replayed: false,
          payment_id: payment.insertId,
          payment_number: paymentNumber,
          receipt_number: receiptNumber,
          refreshed,
        };
      });

      const agreement = await loadAgreement(pool, agreementId, locationId);
      return res.status(result.replayed ? 200 : 201).json({
        status: "success",
        message: result.replayed
          ? "This collection was already recorded; the original receipt has been returned."
          : "Finance collection recorded and allocated without sending SMS.",
        ...result,
        account: accountShape(agreement),
        sms: { sent: false, automatic: false },
      });
    } catch (error) {
      return sendError(res, error, "Could not record the Finance collection.");
    }
  }
);

router.post(
  "/accounts/:agreementId/delivery",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      await assertSchemaReady();
      assertFinalisationOfficer(req, "record equipment handover");
      const locationId = selectedLocationId(req);
      const agreementId = positiveId(req.params.agreementId);
      const idempotencyKey = secureIdempotencyKey(
        req.body.idempotency_key,
        "finance-delivery",
        agreementId
      );
      const deliveredAt = dateTime(req.body.delivery_datetime, new Date().toISOString());
      const condition = enumValue(
        req.body.condition_status,
        DELIVERY_CONDITIONS,
        undefined
      );
      const meter = money(req.body.meter_reading, null);
      const fuel = percent(req.body.fuel_level_percent, null);
      const receiver = cleanText(req.body.receiving_person, 150);
      if (
        !agreementId ||
        !deliveredAt ||
        condition === undefined ||
        meter === undefined ||
        fuel === undefined ||
        !receiver
      ) {
        throw new LifecycleError(
          400,
          "Check the handover date, machine condition, meter and receiving person."
        );
      }

      const result = await withTransaction(async (connection) => {
        const [existingByKey] = await connection.query(
          `SELECT id, delivery_number
           FROM equipment_deliveries
           WHERE idempotency_key = ?
           LIMIT 1
           FOR UPDATE`,
          [idempotencyKey]
        );
        if (existingByKey[0]) {
          return {
            replayed: true,
            delivery_id: existingByKey[0].id,
            delivery_number: existingByKey[0].delivery_number,
          };
        }

        const agreement = await loadAgreement(connection, agreementId, locationId, true);
        assertControlledAgreement(agreement);
        assertReservedMachine(agreement);
        if (!deliveryAllowed(agreement)) {
          throw new LifecycleError(
            409,
            "The approved payment threshold for equipment handover has not been reached.",
            "EQUIPMENT_FINANCE_DELIVERY_THRESHOLD_NOT_MET"
          );
        }
        if (agreement.delivery_id || agreement.delivery_status === "delivered") {
          throw new LifecycleError(409, "Equipment handover has already been recorded.");
        }

        const deliveryNumber = await documentNumber(
          "EQUIPMENT_SALE_DELIVERY",
          "ESD",
          req.user?.id
        );
        const [delivery] = await connection.query(
          `INSERT INTO equipment_deliveries (
             delivery_number, idempotency_key, hire_location_id, agreement_id,
             credit_application_id, handover_stage, customer_id, asset_id,
             delivery_datetime, destination, meter_reading, fuel_level_percent,
             condition_status, attachments_tools, receiving_person, receiving_phone,
             customer_signature_url, delivery_note_url, notes, status,
             created_by, approved_by, approved_at
           ) VALUES (?, ?, ?, ?, ?, 'finance_controlled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'delivered', ?, ?, NOW())`,
          [
            deliveryNumber,
            idempotencyKey,
            agreement.hire_location_id,
            agreement.id,
            agreement.credit_application_id,
            agreement.customer_id,
            agreement.asset_id,
            deliveredAt,
            nullableText(req.body.destination, 255),
            meter,
            fuel,
            condition,
            nullableText(req.body.attachments_tools, 3000),
            receiver,
            nullableText(req.body.receiving_phone, 30),
            nullableText(req.body.customer_signature_url, 3000),
            nullableText(req.body.delivery_note_url, 3000),
            nullableText(req.body.notes, 3000),
            req.user?.id || null,
            req.user?.id || null,
          ]
        );

        await connection.query(
          `UPDATE equipment_sale_agreements
           SET delivery_status = 'delivered',
               delivered_at = ?,
               controlled_delivery_completed_at = NOW(),
               controlled_delivery_completed_by = ?
           WHERE id = ?`,
          [deliveredAt, req.user?.id || null, agreement.id]
        );
        if (meter !== null && meter > Number(agreement.current_meter || 0)) {
          await connection.query(
            `UPDATE fleet_assets
             SET current_meter = ?, updated_by = ?
             WHERE id = ?`,
            [meter, req.user?.id || null, agreement.asset_id]
          );
        }
        await audit(
          req,
          connection,
          "EQUIPMENT_FINANCE_DELIVERY_COMPLETED",
          "equipment_delivery",
          delivery.insertId,
          `Recorded controlled Finance handover for ${agreement.agreement_number}.`,
          { delivery_number: deliveryNumber }
        );
        return {
          replayed: false,
          delivery_id: delivery.insertId,
          delivery_number: deliveryNumber,
        };
      });

      const agreement = await loadAgreement(pool, agreementId, locationId);
      return res.status(result.replayed ? 200 : 201).json({
        status: "success",
        message: result.replayed
          ? "This equipment handover was already recorded."
          : "Equipment handover recorded without creating Hire work or sending SMS.",
        ...result,
        account: accountShape(agreement),
        sms: { sent: false, automatic: false },
      });
    } catch (error) {
      return sendError(res, error, "Could not record the Finance equipment handover.");
    }
  }
);

router.post(
  "/accounts/:agreementId/ownership-transfer",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      await assertSchemaReady();
      assertFinalisationOfficer(req, "complete ownership transfer");
      const locationId = selectedLocationId(req);
      const agreementId = positiveId(req.params.agreementId);
      const idempotencyKey = secureIdempotencyKey(
        req.body.idempotency_key,
        "finance-ownership",
        agreementId
      );
      const transferDate = dateOnly(
        req.body.transfer_date,
        new Date().toISOString().slice(0, 10)
      );
      if (!agreementId || !transferDate) {
        throw new LifecycleError(400, "Enter a valid ownership-transfer date.");
      }

      const result = await withTransaction(async (connection) => {
        const [existingByKey] = await connection.query(
          `SELECT id, transfer_number
           FROM equipment_ownership_transfers
           WHERE idempotency_key = ?
           LIMIT 1
           FOR UPDATE`,
          [idempotencyKey]
        );
        if (existingByKey[0]) {
          return {
            replayed: true,
            transfer_id: existingByKey[0].id,
            transfer_number: existingByKey[0].transfer_number,
          };
        }

        const agreement = await loadAgreement(connection, agreementId, locationId, true);
        assertControlledAgreement(agreement);
        assertReservedMachine(agreement);
        if (Number(agreement.outstanding_balance || 0) > 0.01) {
          throw new LifecycleError(
            409,
            "Ownership cannot transfer while a Finance balance remains.",
            "EQUIPMENT_FINANCE_OWNERSHIP_BALANCE_REMAINS"
          );
        }
        if (
          agreement.delivery_status !== "delivered" ||
          agreement.handover_stage !== "finance_controlled"
        ) {
          throw new LifecycleError(
            409,
            "Complete the controlled Finance equipment handover before ownership transfer."
          );
        }
        if (agreement.ownership_id || agreement.ownership_status === "transferred") {
          throw new LifecycleError(409, "Ownership has already been transferred.");
        }

        const transferNumber = await documentNumber(
          "EQUIPMENT_OWNERSHIP_TRANSFER",
          "EOT",
          req.user?.id
        );
        const [transfer] = await connection.query(
          `INSERT INTO equipment_ownership_transfers (
             transfer_number, idempotency_key, hire_location_id, agreement_id,
             credit_application_id, transfer_stage, customer_id, asset_id,
             transfer_date, ownership_document_url,
             registration_transfer_reference, notes, status, issued_by, issued_at
           ) VALUES (?, ?, ?, ?, ?, 'finance_controlled', ?, ?, ?, ?, ?, ?, 'issued', ?, NOW())`,
          [
            transferNumber,
            idempotencyKey,
            agreement.hire_location_id,
            agreement.id,
            agreement.credit_application_id,
            agreement.customer_id,
            agreement.asset_id,
            transferDate,
            nullableText(req.body.ownership_document_url, 3000),
            nullableText(req.body.registration_transfer_reference, 150),
            nullableText(req.body.notes, 3000),
            req.user?.id || null,
          ]
        );

        await connection.query(
          `UPDATE equipment_sale_agreements
           SET ownership_status = 'transferred',
               agreement_status = 'completed',
               completed_at = COALESCE(completed_at, NOW()),
               controlled_ownership_completed_at = NOW(),
               controlled_ownership_completed_by = ?
           WHERE id = ?`,
          [req.user?.id || null, agreement.id]
        );
        await connection.query(
          `UPDATE equipment_asset_sale_locks
           SET lock_status = 'sold', expires_at = NULL
           WHERE agreement_id = ? AND released_at IS NULL`,
          [agreement.id]
        );
        await connection.query(
          `UPDATE fleet_assets
           SET sale_status = 'sold',
               current_status = 'sold',
               sold_at = NOW(),
               updated_by = ?
           WHERE id = ?`,
          [req.user?.id || null, agreement.asset_id]
        );
        await audit(
          req,
          connection,
          "EQUIPMENT_FINANCE_OWNERSHIP_TRANSFERRED",
          "equipment_ownership_transfer",
          transfer.insertId,
          `Completed controlled Finance ownership transfer for ${agreement.agreement_number}.`,
          { transfer_number: transferNumber }
        );
        return {
          replayed: false,
          transfer_id: transfer.insertId,
          transfer_number: transferNumber,
        };
      });

      const agreement = await loadAgreement(pool, agreementId, locationId);
      return res.status(result.replayed ? 200 : 201).json({
        status: "success",
        message: result.replayed
          ? "This ownership transfer was already recorded."
          : "Ownership transferred and the machine marked sold without sending SMS.",
        ...result,
        account: accountShape(agreement),
        sms: { sent: false, automatic: false },
      });
    } catch (error) {
      return sendError(res, error, "Could not complete the Finance ownership transfer.");
    }
  }
);

module.exports = router;
module.exports.schemaStatus = schemaStatus;
