const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  resolveHireLocationScope,
  appendHireLocationFilter,
  sendHireLocationScopeError,
} = require("../services/hireLocationScope");
const { writeAuditEvent } = require("../services/auditTrailService");
const { nextDocumentNumber } = require("../services/groupConfigurationService");
const { sendSmsAlertToPhone } = require("../services/smsAlertService");

const router = express.Router();

const ENQUIRY_STATUSES = new Set(["open", "quoted", "won", "lost", "cancelled"]);
const PURCHASE_METHODS = new Set(["cash", "installment", "undecided"]);
const CONDITION_PREFERENCES = new Set(["new", "used", "either"]);
const QUOTATION_STATUSES = new Set([
  "draft",
  "pending_approval",
  "approved",
  "accepted",
  "rejected",
  "expired",
  "converted",
  "cancelled",
]);
const AGREEMENT_STATUSES = new Set([
  "draft",
  "pending_approval",
  "approved",
  "active",
  "due_soon",
  "payment_due",
  "overdue",
  "completed",
  "cancelled",
  "defaulted",
]);
const SALE_TYPES = new Set(["cash", "installment"]);
const PAYMENT_FREQUENCIES = new Set(["weekly", "fortnightly", "monthly", "custom"]);
const PAYMENT_METHODS = new Set(["cash", "momo", "bank", "cheque", "other"]);
const PAYMENT_CATEGORIES = new Set(["deposit", "installment", "settlement", "adjustment", "refund"]);
const DELIVERY_POLICIES = new Set([
  "immediate",
  "after_deposit",
  "after_percentage",
  "after_full_payment",
]);
const DELIVERY_CONDITIONS = new Set(["new", "excellent", "good", "fair", "poor", "damaged"]);
const SMS_TYPES = new Set([
  "quotation_ready",
  "quotation_expiring",
  "agreement_created",
  "deposit_received",
  "due_soon",
  "due_today",
  "overdue",
  "payment_receipt",
  "delivery_scheduled",
  "delivered",
  "completed",
  "ownership_ready",
  "manual",
]);

class HttpError extends Error {
  constructor(statusCode, message, code = null) {
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

function wholeNumber(value, fallback = null, maximum = 1000000) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= maximum
    ? number
    : undefined;
}

function money(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Number(number.toFixed(2))
    : undefined;
}

function percent(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100
    ? Number(number.toFixed(4))
    : undefined;
}

function dateOnly(value, fallback = null) {
  const text = cleanText(value, 20);
  if (!text) return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

function dateTime(value, fallback = null) {
  const text = cleanText(value, 60);
  if (!text) return fallback;
  const date = new Date(text);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toISOString().slice(0, 19).replace("T", " ");
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
  return new Date().toISOString().slice(0, 10);
}

function fallbackNumber(prefix) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const random = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `${prefix}-${stamp}-${random}`;
}

async function documentNumber(sequenceCode, prefix, userId) {
  try {
    return await nextDocumentNumber(sequenceCode, { userId });
  } catch (_error) {
    return fallbackNumber(prefix);
  }
}

function addSchedulePeriod(dateText, frequency, periods) {
  const base = new Date(`${dateText}T00:00:00Z`);
  if (frequency === "weekly") base.setUTCDate(base.getUTCDate() + periods * 7);
  else if (frequency === "fortnightly") base.setUTCDate(base.getUTCDate() + periods * 14);
  else if (frequency === "monthly") {
    const originalDay = base.getUTCDate();
    base.setUTCDate(1);
    base.setUTCMonth(base.getUTCMonth() + periods);
    const lastDay = new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)
    ).getUTCDate();
    base.setUTCDate(Math.min(originalDay, lastDay));
  } else base.setUTCDate(base.getUTCDate() + periods * 30);
  return base.toISOString().slice(0, 10);
}

function buildSchedule(totalAmount, count, firstDueDate, frequency) {
  const totalCents = Math.round(Number(totalAmount || 0) * 100);
  const baseCents = Math.floor(totalCents / count);
  let assignedCents = 0;
  const rows = [];

  for (let index = 0; index < count; index += 1) {
    const cents = index === count - 1 ? totalCents - assignedCents : baseCents;
    assignedCents += cents;
    rows.push({
      sequence_number: index + 1,
      due_date: addSchedulePeriod(firstDueDate, frequency, index),
      scheduled_amount: Number((cents / 100).toFixed(2)),
    });
  }
  return rows;
}

function isFoundationError(error) {
  return ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR", "ER_SP_DOES_NOT_EXIST"].includes(
    error?.code
  );
}

function sendError(res, error, fallbackMessage) {
  if (sendHireLocationScopeError(res, error)) return;
  if (error instanceof HttpError) {
    return res.status(error.statusCode).json({
      status: "error",
      code: error.code || undefined,
      message: error.message,
    });
  }
  if (isFoundationError(error)) {
    return res.status(503).json({
      status: "error",
      code: "EQUIPMENT_SALES_FOUNDATION_REQUIRED",
      message: "Equipment Sales is being prepared. The approved database foundation is not available yet.",
    });
  }
  if (error?.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      status: "error",
      code: "DUPLICATE_EQUIPMENT_SALES_RECORD",
      message: "That Equipment Sales document has already been recorded.",
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
    severity: /PAYMENT|APPROV|DELIVER|OWNERSHIP|CANCEL|DEFAULT/.test(action)
      ? "notice"
      : "info",
    outcome: "success",
    details,
    metadata,
  });
}

async function customerById(connection, customerId, lock = false) {
  const [rows] = await connection.query(
    `SELECT id, customer_name, phone, email, address, customer_type, is_active
     FROM hire_customers
     WHERE id = ?
     LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [customerId]
  );
  return rows[0] || null;
}

async function saleAsset(connection, assetId, locationId, lock = false) {
  const [rows] = await connection.query(
    `SELECT fa.*,
            (SELECT COUNT(*) FROM hire_contract_assets hca
             WHERE hca.asset_id = fa.id
               AND hca.status IN ('assigned','dispatched','active')) AS active_hire_count,
            easl.lock_status AS active_sale_lock_status,
            easl.agreement_id AS active_sale_agreement_id
     FROM fleet_assets fa
     LEFT JOIN equipment_asset_sale_locks easl
       ON easl.asset_id = fa.id AND easl.released_at IS NULL
     WHERE fa.id = ? AND fa.hire_location_id = ? AND fa.is_active = TRUE
     LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [assetId, locationId]
  );
  return rows[0] || null;
}

function assertAssetCanBeSold(asset) {
  if (!asset) throw new HttpError(404, "Equipment was not found at the selected location.");
  if (!["sale_only", "sale_or_hire"].includes(asset.operational_purpose)) {
    throw new HttpError(409, "This equipment is not marked for sale.", "EQUIPMENT_NOT_FOR_SALE");
  }
  if (!["available"].includes(asset.sale_status)) {
    throw new HttpError(409, "This equipment is not currently available for sale.", "EQUIPMENT_NOT_AVAILABLE_FOR_SALE");
  }
  if (Number(asset.active_hire_count || 0) > 0) {
    throw new HttpError(409, "This equipment is active on Hire and cannot be sold.", "EQUIPMENT_ACTIVE_ON_HIRE");
  }
  if (asset.active_sale_lock_status) {
    throw new HttpError(409, "This equipment already has an active sale agreement.", "EQUIPMENT_ALREADY_RESERVED");
  }
}

async function agreementRecord(connection, agreementId, locationId, lock = false) {
  const [rows] = await connection.query(
    `SELECT esa.*, hc.customer_name, hc.phone AS customer_phone,
            hc.address AS customer_address, fa.asset_code, fa.asset_name,
            fa.main_image_url, bl.name AS hire_location_name,
            easl.lock_status AS active_lock_status
     FROM equipment_sale_agreements esa
     INNER JOIN hire_customers hc ON hc.id = esa.customer_id
     INNER JOIN fleet_assets fa ON fa.id = esa.asset_id
     INNER JOIN business_locations bl ON bl.id = esa.hire_location_id
     LEFT JOIN equipment_asset_sale_locks easl
       ON easl.agreement_id = esa.id AND easl.released_at IS NULL
     WHERE esa.id = ? AND esa.hire_location_id = ?
     LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [agreementId, locationId]
  );
  return rows[0] || null;
}

function assertLegacyCommercialAgreement(agreement) {
  if (agreement?.activation_source === "approved_credit_application") {
    throw new HttpError(
      409,
      "Use the controlled Equipment Installment Finance workflow for approved-credit payments, delivery, ownership and customer messages.",
      "EQUIPMENT_FINANCE_CONTROLLED_WORKFLOW_REQUIRED"
    );
  }
}

async function refreshAgreement(connection, agreementId) {
  const [paymentRows] = await connection.query(
    `SELECT COALESCE(SUM(amount), 0) AS paid
     FROM equipment_sale_payments
     WHERE agreement_id = ? AND is_voided = FALSE
       AND payment_category <> 'refund'`,
    [agreementId]
  );
  const [scheduleRows] = await connection.query(
    `SELECT
       MIN(CASE WHEN schedule_status NOT IN ('paid','cancelled','waived') THEN due_date END) AS next_due_date,
       MAX(due_date) AS final_due_date,
       COALESCE(SUM(CASE WHEN schedule_status = 'overdue'
         THEN GREATEST(scheduled_amount + late_charge_amount - waived_charge_amount - amount_paid, 0)
         ELSE 0 END), 0) AS overdue_amount
     FROM equipment_installment_schedule
     WHERE agreement_id = ?`,
    [agreementId]
  );
  const [agreementRows] = await connection.query(
    "SELECT total_amount, sale_type FROM equipment_sale_agreements WHERE id = ? LIMIT 1",
    [agreementId]
  );
  const paid = Number(paymentRows[0]?.paid || 0);
  const total = Number(agreementRows[0]?.total_amount || 0);
  const balance = Number(Math.max(total - paid, 0).toFixed(2));
  const nextDueDate = scheduleRows[0]?.next_due_date || null;
  const overdueAmount = Number(scheduleRows[0]?.overdue_amount || 0);
  let status = balance <= 0.01 ? "completed" : agreementRows[0]?.sale_type === "cash" ? "payment_due" : "active";
  if (balance > 0.01 && overdueAmount > 0) status = "overdue";
  else if (balance > 0.01 && nextDueDate === today()) status = "payment_due";

  await connection.query(
    `UPDATE equipment_sale_agreements
     SET amount_paid = ?, outstanding_balance = ?, overdue_amount = ?,
         next_due_date = ?, final_due_date = ?, agreement_status = ?,
         completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, NOW()) ELSE completed_at END
     WHERE id = ?`,
    [
      paid,
      balance,
      overdueAmount,
      nextDueDate,
      scheduleRows[0]?.final_due_date || null,
      status,
      status,
      agreementId,
    ]
  );
  return { paid, balance, overdueAmount, nextDueDate, status };
}

function deliveryAllowed(agreement) {
  const paid = Number(agreement.amount_paid || 0);
  const total = Number(agreement.total_amount || 0);
  if (agreement.delivery_policy === "immediate") return true;
  if (agreement.delivery_policy === "after_deposit") {
    return paid + 0.01 >= Number(agreement.deposit_required || 0);
  }
  if (agreement.delivery_policy === "after_percentage") {
    return total > 0 && (paid / total) * 100 + 0.0001 >= Number(agreement.delivery_threshold_percent || 0);
  }
  return Number(agreement.outstanding_balance || 0) <= 0.01;
}

function smsMessage(type, record, customMessage = "") {
  const company = "Chalin 03 Company Limited";
  const name = record.customer_name || record.customer_name_snapshot || "Customer";
  const number = record.agreement_number || record.quotation_number || "";
  const balance = Number(record.outstanding_balance || 0).toFixed(2);
  const nextDue = record.next_due_date ? ` Next due: ${String(record.next_due_date).slice(0, 10)}.` : "";
  const messages = {
    quotation_ready: `${company}: Hello ${name}, your equipment quotation ${record.quotation_number} is ready. Total GHS ${Number(record.total_amount || 0).toFixed(2)}.`,
    quotation_expiring: `${company}: Quotation ${record.quotation_number} expires on ${String(record.validity_date || "soon").slice(0, 10)}. Contact us if you wish to proceed.`,
    agreement_created: `${company}: Your equipment ${record.sale_type} agreement ${number} has been created. Total GHS ${Number(record.total_amount || 0).toFixed(2)}.${nextDue}`,
    deposit_received: `${company}: Deposit received for agreement ${number}. Balance GHS ${balance}.${nextDue}`,
    due_soon: `${company}: Reminder for agreement ${number}. GHS ${balance} remains.${nextDue}`,
    due_today: `${company}: Payment for agreement ${number} is due today. Outstanding GHS ${balance}.`,
    overdue: `${company}: Agreement ${number} is overdue. Outstanding GHS ${balance}. Please contact Chalin 03.`,
    payment_receipt: `${company}: Payment received for agreement ${number}. Remaining balance GHS ${balance}.${nextDue}`,
    delivery_scheduled: `${company}: Delivery for agreement ${number} has been scheduled.`,
    delivered: `${company}: Equipment under agreement ${number} has been delivered. Thank you.`,
    completed: `${company}: Agreement ${number} is fully paid. Ownership-transfer processing can now be completed.`,
    ownership_ready: `${company}: Ownership transfer for agreement ${number} is complete. Thank you for choosing Chalin 03.`,
    manual: cleanText(customMessage, 480),
  };
  return messages[type] || messages.manual;
}

async function sendAgreementSms(req, record, reminderType, customMessage = "") {
  if (!record?.customer_phone) {
    return { ok: false, skipped: true, reason: "Customer phone is missing." };
  }
  const message = smsMessage(reminderType, record, customMessage);
  if (!message) throw new HttpError(400, "Enter an SMS message.");
  const sourceReference = `equipment-sale:${record.id}:${reminderType}`;
  const result = await sendSmsAlertToPhone({
    branchId: Number(req.user?.branch_id || req.user?.default_branch_id || 1),
    phone: record.customer_phone,
    message,
    logMessage: message,
    smsType: "equipment_sales",
    sentBy: req.user?.id || null,
    sourceReference,
  });

  const reminderKey = `${record.id}:${reminderType}:${new Date().toISOString().slice(0, 13)}`;
  try {
    await pool.query(
      `INSERT INTO equipment_sales_reminder_log (
         hire_location_id, agreement_id, schedule_id, reminder_key,
         reminder_type, recipient_phone, sms_log_id, delivery_status,
         message_preview, sent_by, sent_at
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE delivery_status = VALUES(delivery_status),
         sms_log_id = COALESCE(VALUES(sms_log_id), sms_log_id), sent_at = NOW()`,
      [
        record.hire_location_id,
        record.id,
        reminderKey,
        reminderType,
        record.customer_phone,
        result.log_id || null,
        result.status || (result.ok ? "accepted" : "failed"),
        message.slice(0, 500),
        req.user?.id || null,
      ]
    );
    if (result.log_id) {
      await pool.query(
        `UPDATE sms_log SET workspace_code = 'equipment_hire',
           hire_location_id = ?, entity_type = 'equipment_sale_agreement',
           entity_id = ?, template_code = ?
         WHERE id = ?`,
        [record.hire_location_id, String(record.id), reminderType, result.log_id]
      );
    }
  } catch (error) {
    console.warn("Equipment Sales SMS context logging skipped:", error.message);
  }
  return result;
}

router.use(async (req, res, next) => {
  try {
    req.hireLocationScope = await resolveHireLocationScope(req, {
      requireSelection: req.method !== "GET",
    });
    return next();
  } catch (error) {
    if (sendHireLocationScopeError(res, error)) return;
    return next(error);
  }
});

router.get("/summary", requirePermission("fleet.assets.view"), async (req, res) => {
  try {
    const where = ["1 = 1"];
    const params = [];
    appendHireLocationFilter(where, params, "esa", req.hireLocationScope);
    const [rows] = await pool.query(
      `SELECT
         COUNT(*) AS agreements,
         SUM(esa.sale_type = 'cash') AS cash_sales,
         SUM(esa.sale_type = 'installment') AS installment_sales,
         SUM(esa.agreement_status IN ('active','due_soon','payment_due','overdue')) AS active_agreements,
         SUM(esa.agreement_status = 'overdue') AS overdue_agreements,
         COALESCE(SUM(esa.total_amount), 0) AS total_sales_value,
         COALESCE(SUM(esa.amount_paid), 0) AS collected_amount,
         COALESCE(SUM(esa.outstanding_balance), 0) AS outstanding_amount,
         COALESCE(SUM(esa.overdue_amount), 0) AS overdue_amount,
         (SELECT COUNT(*) FROM equipment_sales_enquiries e
           WHERE e.hire_location_id = COALESCE(?, e.hire_location_id)
             AND e.status IN ('open','quoted')) AS active_enquiries,
         (SELECT COUNT(*) FROM equipment_sales_quotations q
           WHERE q.hire_location_id = COALESCE(?, q.hire_location_id)
             AND q.status IN ('draft','pending_approval','approved','accepted')) AS active_quotations
       FROM equipment_sale_agreements esa
       WHERE ${where.join(" AND ")}`,
      [
        req.hireLocationScope?.locationId || null,
        req.hireLocationScope?.locationId || null,
        ...params,
      ]
    );
    return res.json({ status: "success", summary: rows[0] || {} });
  } catch (error) {
    return sendError(res, error, "Could not load Equipment Sales summary.");
  }
});

router.get("/reference", requirePermission("fleet.assets.view"), async (req, res) => {
  try {
    const locationId = req.hireLocationScope?.locationId || null;
    const [customers] = await pool.query(
      `SELECT id, customer_name, phone, email, address, customer_type
       FROM hire_customers WHERE is_active = TRUE ORDER BY customer_name`
    );
    const params = [];
    const where = ["fa.is_active = TRUE", "fa.operational_purpose IN ('sale_only','sale_or_hire')", "fa.sale_status = 'available'"];
    appendHireLocationFilter(where, params, "fa", req.hireLocationScope);
    const [assets] = await pool.query(
      `SELECT fa.id, fa.asset_code, fa.asset_name, fa.asset_type, fa.make, fa.model,
              fa.model_year, fa.serial_number, fa.condition_status,
              fa.target_selling_price, fa.main_image_url, fa.hire_location_id
       FROM fleet_assets fa
       WHERE ${where.join(" AND ")}
         AND NOT EXISTS (SELECT 1 FROM hire_contract_assets hca
           WHERE hca.asset_id = fa.id AND hca.status IN ('assigned','dispatched','active'))
         AND NOT EXISTS (SELECT 1 FROM equipment_asset_sale_locks easl
           WHERE easl.asset_id = fa.id AND easl.released_at IS NULL)
       ORDER BY fa.asset_name, fa.asset_code`,
      params
    );
    return res.json({
      status: "success",
      hire_location_id: locationId,
      customers,
      assets,
      payment_frequencies: [...PAYMENT_FREQUENCIES],
      delivery_policies: [...DELIVERY_POLICIES],
    });
  } catch (error) {
    return sendError(res, error, "Could not load Equipment Sales reference data.");
  }
});

router.get("/enquiries", requirePermission("fleet.assets.view"), async (req, res) => {
  try {
    const where = ["1 = 1"];
    const params = [];
    appendHireLocationFilter(where, params, "e", req.hireLocationScope);
    const status = enumValue(req.query.status, ENQUIRY_STATUSES, null);
    if (req.query.status && status === undefined) throw new HttpError(400, "Invalid enquiry status.");
    if (status) {
      where.push("e.status = ?");
      params.push(status);
    }
    const [rows] = await pool.query(
      `SELECT e.*, hc.customer_name, hc.phone AS customer_phone, hc.address AS customer_address,
              bl.name AS hire_location_name
       FROM equipment_sales_enquiries e
       INNER JOIN hire_customers hc ON hc.id = e.customer_id
       INNER JOIN business_locations bl ON bl.id = e.hire_location_id
       WHERE ${where.join(" AND ")}
       ORDER BY e.created_at DESC LIMIT 300`,
      params
    );
    return res.json({ status: "success", enquiries: rows });
  } catch (error) {
    return sendError(res, error, "Could not load equipment sales enquiries.");
  }
});

router.post("/enquiries", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    const customerId = positiveId(req.body.customer_id);
    const enquiryDate = dateOnly(req.body.enquiry_date, today());
    const purchaseMethod = enumValue(req.body.purchase_method, PURCHASE_METHODS, "undecided");
    const conditionPreference = enumValue(req.body.condition_preference, CONDITION_PREFERENCES, "either");
    const budget = money(req.body.budget_amount, 0);
    const expectedDate = dateOnly(req.body.expected_purchase_date, null);
    const assetType = cleanText(req.body.asset_type || "Excavator", 100);
    if (!customerId || !enquiryDate || !assetType || purchaseMethod === undefined || conditionPreference === undefined || budget === undefined || expectedDate === undefined) {
      throw new HttpError(400, "Check the enquiry customer, date, equipment and payment preference.");
    }
    const number = await documentNumber("EQUIPMENT_SALES_ENQUIRY", "ESE", req.user?.id);
    const enquiryId = await withTransaction(async (connection) => {
      const customer = await customerById(connection, customerId, true);
      if (!customer?.is_active) throw new HttpError(404, "Active customer was not found.");
      const [result] = await connection.query(
        `INSERT INTO equipment_sales_enquiries (
           enquiry_number, hire_location_id, customer_id, enquiry_date,
           asset_type, preferred_make, preferred_model, condition_preference,
           budget_amount, purchase_method, expected_purchase_date,
           source_channel, status, notes, created_by, updated_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
        [
          number,
          req.hireLocationScope.locationId,
          customerId,
          enquiryDate,
          assetType,
          nullableText(req.body.preferred_make, 100),
          nullableText(req.body.preferred_model, 100),
          conditionPreference,
          budget,
          purchaseMethod,
          expectedDate,
          nullableText(req.body.source_channel, 80),
          nullableText(req.body.notes, 3000),
          req.user?.id || null,
          req.user?.id || null,
        ]
      );
      await audit(req, connection, "EQUIPMENT_SALES_ENQUIRY_CREATED", "equipment_sales_enquiry", result.insertId, `Created enquiry ${number} for ${customer.customer_name}.`);
      return result.insertId;
    });
    return res.status(201).json({ status: "success", message: "Sales enquiry created.", id: enquiryId, enquiry_number: number });
  } catch (error) {
    return sendError(res, error, "Could not create equipment sales enquiry.");
  }
});

router.patch("/enquiries/:id/status", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    const enquiryId = positiveId(req.params.id);
    const status = enumValue(req.body.status, ENQUIRY_STATUSES, undefined);
    if (!enquiryId || status === undefined) throw new HttpError(400, "Invalid enquiry status change.");
    await withTransaction(async (connection) => {
      const [rows] = await connection.query(
        "SELECT * FROM equipment_sales_enquiries WHERE id = ? AND hire_location_id = ? LIMIT 1 FOR UPDATE",
        [enquiryId, req.hireLocationScope.locationId]
      );
      if (!rows.length) throw new HttpError(404, "Enquiry was not found.");
      await connection.query(
        "UPDATE equipment_sales_enquiries SET status = ?, notes = COALESCE(?, notes), updated_by = ? WHERE id = ?",
        [status, nullableText(req.body.notes, 3000), req.user?.id || null, enquiryId]
      );
      await audit(req, connection, "EQUIPMENT_SALES_ENQUIRY_STATUS_CHANGED", "equipment_sales_enquiry", enquiryId, `Enquiry ${rows[0].enquiry_number} changed to ${status}.`);
    });
    return res.json({ status: "success", message: "Enquiry status updated." });
  } catch (error) {
    return sendError(res, error, "Could not update enquiry status.");
  }
});

router.get("/quotations", requirePermission("fleet.assets.view"), async (req, res) => {
  try {
    const where = ["1 = 1"];
    const params = [];
    appendHireLocationFilter(where, params, "q", req.hireLocationScope);
    const [rows] = await pool.query(
      `SELECT q.*, hc.customer_name, hc.phone AS customer_phone,
              qi.id AS quotation_item_id, qi.asset_id, qi.asset_code_snapshot,
              qi.asset_name_snapshot, qi.make_snapshot, qi.model_snapshot,
              qi.model_year_snapshot, qi.serial_number_snapshot,
              qi.main_image_url_snapshot, qi.unit_price,
              bl.name AS hire_location_name
       FROM equipment_sales_quotations q
       INNER JOIN hire_customers hc ON hc.id = q.customer_id
       INNER JOIN equipment_sales_quotation_items qi ON qi.quotation_id = q.id
       INNER JOIN business_locations bl ON bl.id = q.hire_location_id
       WHERE ${where.join(" AND ")}
       ORDER BY q.created_at DESC LIMIT 300`,
      params
    );
    return res.json({ status: "success", quotations: rows });
  } catch (error) {
    return sendError(res, error, "Could not load equipment sales quotations.");
  }
});

router.post("/quotations", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    const customerId = positiveId(req.body.customer_id);
    const enquiryId = positiveId(req.body.enquiry_id);
    const assetId = positiveId(req.body.asset_id);
    const quotationDate = dateOnly(req.body.quotation_date, today());
    const validityDate = dateOnly(req.body.validity_date, addSchedulePeriod(today(), "weekly", 2));
    const unitPrice = money(req.body.unit_price, undefined);
    const discount = money(req.body.discount_amount, 0);
    const taxRate = percent(req.body.tax_rate_percent, 0);
    const depositRequired = money(req.body.deposit_required, 0);
    const proposedFrequency = enumValue(req.body.proposed_frequency, PAYMENT_FREQUENCIES, null);
    const proposedCount = wholeNumber(req.body.proposed_installment_count, null, 120);
    const proposedFirstDue = dateOnly(req.body.proposed_first_due_date, null);
    const deliveryPolicy = enumValue(req.body.delivery_policy, DELIVERY_POLICIES, "after_deposit");
    const deliveryThreshold = percent(req.body.delivery_threshold_percent, 0);
    if (!customerId || !assetId || !quotationDate || !validityDate || unitPrice === undefined || discount === undefined || taxRate === undefined || depositRequired === undefined || deliveryPolicy === undefined || deliveryThreshold === undefined) {
      throw new HttpError(400, "Check the quotation customer, equipment, dates and amounts.");
    }
    if (discount > unitPrice) throw new HttpError(400, "Discount cannot exceed the equipment price.");
    const taxable = unitPrice - discount;
    const taxAmount = Number((taxable * (taxRate / 100)).toFixed(2));
    const total = Number((taxable + taxAmount).toFixed(2));
    if (depositRequired > total) throw new HttpError(400, "Required deposit cannot exceed the quotation total.");
    if ((proposedCount || proposedFirstDue || proposedFrequency) && (!proposedCount || !proposedFirstDue || !proposedFrequency)) {
      throw new HttpError(400, "Installment quotations require frequency, count and first due date.");
    }
    const quotationNumber = await documentNumber("EQUIPMENT_SALES_QUOTATION", "ESQ", req.user?.id);
    const quotationId = await withTransaction(async (connection) => {
      const customer = await customerById(connection, customerId, true);
      if (!customer?.is_active) throw new HttpError(404, "Active customer was not found.");
      const asset = await saleAsset(connection, assetId, req.hireLocationScope.locationId, true);
      assertAssetCanBeSold(asset);
      if (enquiryId) {
        const [enquiryRows] = await connection.query(
          "SELECT id FROM equipment_sales_enquiries WHERE id = ? AND hire_location_id = ? AND customer_id = ? LIMIT 1 FOR UPDATE",
          [enquiryId, req.hireLocationScope.locationId, customerId]
        );
        if (!enquiryRows.length) throw new HttpError(404, "Matching sales enquiry was not found.");
      }
      const needsApproval = discount > 0 || (proposedCount && proposedCount > 12) || (proposedCount && total > 0 && depositRequired / total < 0.2);
      const status = needsApproval ? "pending_approval" : "approved";
      const [result] = await connection.query(
        `INSERT INTO equipment_sales_quotations (
           quotation_number, hire_location_id, enquiry_id, customer_id,
           quotation_date, validity_date, status, subtotal, discount_amount,
           tax_rate_percent, tax_amount, total_amount, deposit_required,
           proposed_frequency, proposed_installment_count, proposed_first_due_date,
           delivery_policy, delivery_threshold_percent, terms, notes,
           approval_reason, created_by, approved_by, approved_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          quotationNumber,
          req.hireLocationScope.locationId,
          enquiryId || null,
          customerId,
          quotationDate,
          validityDate,
          status,
          unitPrice,
          discount,
          taxRate,
          taxAmount,
          total,
          depositRequired,
          proposedFrequency,
          proposedCount,
          proposedFirstDue,
          deliveryPolicy,
          deliveryThreshold,
          nullableText(req.body.terms, 5000),
          nullableText(req.body.notes, 3000),
          needsApproval ? "Discount, low deposit or extended term requires approval." : "Within standard commercial controls.",
          req.user?.id || null,
          needsApproval ? null : req.user?.id || null,
          needsApproval ? null : new Date(),
        ]
      );
      await connection.query(
        `INSERT INTO equipment_sales_quotation_items (
           quotation_id, hire_location_id, line_number, asset_id,
           asset_code_snapshot, asset_name_snapshot, asset_type_snapshot,
           make_snapshot, model_snapshot, model_year_snapshot,
           serial_number_snapshot, main_image_url_snapshot, description,
           quantity, unit_price, discount_amount, tax_amount, line_total
         ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [
          result.insertId,
          req.hireLocationScope.locationId,
          asset.id,
          asset.asset_code,
          asset.asset_name,
          asset.asset_type,
          asset.make,
          asset.model,
          asset.model_year,
          asset.serial_number,
          asset.main_image_url,
          nullableText(req.body.description, 500),
          unitPrice,
          discount,
          taxAmount,
          total,
        ]
      );
      if (enquiryId) {
        await connection.query("UPDATE equipment_sales_enquiries SET status = 'quoted', updated_by = ? WHERE id = ?", [req.user?.id || null, enquiryId]);
      }
      await audit(req, connection, "EQUIPMENT_SALES_QUOTATION_CREATED", "equipment_sales_quotation", result.insertId, `Created quotation ${quotationNumber} for ${asset.asset_code}.`, { total_amount: total, status });
      return result.insertId;
    });
    return res.status(201).json({ status: "success", message: "Equipment sales quotation created.", id: quotationId, quotation_number: quotationNumber });
  } catch (error) {
    return sendError(res, error, "Could not create equipment sales quotation.");
  }
});

router.patch("/quotations/:id/status", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    const quotationId = positiveId(req.params.id);
    const status = enumValue(req.body.status, QUOTATION_STATUSES, undefined);
    if (!quotationId || !["approved", "accepted", "rejected", "cancelled"].includes(status)) {
      throw new HttpError(400, "Choose approved, accepted, rejected or cancelled.");
    }
    await withTransaction(async (connection) => {
      const [rows] = await connection.query(
        "SELECT * FROM equipment_sales_quotations WHERE id = ? AND hire_location_id = ? LIMIT 1 FOR UPDATE",
        [quotationId, req.hireLocationScope.locationId]
      );
      const quote = rows[0];
      if (!quote) throw new HttpError(404, "Quotation was not found.");
      if (["converted", "expired"].includes(quote.status)) throw new HttpError(409, "This quotation can no longer be changed.");
      await connection.query(
        `UPDATE equipment_sales_quotations SET status = ?, approval_reason = COALESCE(?, approval_reason),
           approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
           approved_at = CASE WHEN ? = 'approved' THEN NOW() ELSE approved_at END
         WHERE id = ?`,
        [status, nullableText(req.body.reason, 500), status, req.user?.id || null, status, quotationId]
      );
      await audit(req, connection, "EQUIPMENT_SALES_QUOTATION_STATUS_CHANGED", "equipment_sales_quotation", quotationId, `Quotation ${quote.quotation_number} changed to ${status}.`);
    });
    return res.json({ status: "success", message: "Quotation status updated." });
  } catch (error) {
    return sendError(res, error, "Could not update quotation status.");
  }
});

router.get("/agreements", requirePermission("fleet.assets.view"), async (req, res) => {
  try {
    const where = ["1 = 1"];
    const params = [];
    appendHireLocationFilter(where, params, "esa", req.hireLocationScope);
    const status = enumValue(req.query.status, AGREEMENT_STATUSES, null);
    if (req.query.status && status === undefined) throw new HttpError(400, "Invalid agreement status.");
    if (status) {
      where.push("esa.agreement_status = ?");
      params.push(status);
    }
    const [rows] = await pool.query(
      `SELECT esa.*, hc.customer_name, hc.phone AS customer_phone,
              fa.asset_code, fa.asset_name, fa.main_image_url,
              bl.name AS hire_location_name
       FROM equipment_sale_agreements esa
       INNER JOIN hire_customers hc ON hc.id = esa.customer_id
       INNER JOIN fleet_assets fa ON fa.id = esa.asset_id
       INNER JOIN business_locations bl ON bl.id = esa.hire_location_id
       WHERE ${where.join(" AND ")}
       ORDER BY esa.created_at DESC LIMIT 300`,
      params
    );
    return res.json({ status: "success", agreements: rows });
  } catch (error) {
    return sendError(res, error, "Could not load equipment sale agreements.");
  }
});

router.get("/agreements/:id", requirePermission("fleet.assets.view"), async (req, res) => {
  try {
    const agreementId = positiveId(req.params.id);
    if (!agreementId) throw new HttpError(400, "Invalid agreement ID.");
    const agreement = await agreementRecord(pool, agreementId, req.hireLocationScope.locationId);
    if (!agreement) throw new HttpError(404, "Agreement was not found.");
    const [[schedule], [payments], [deliveries], [transfers]] = await Promise.all([
      pool.query("SELECT * FROM equipment_installment_schedule WHERE agreement_id = ? ORDER BY sequence_number", [agreementId]),
      pool.query("SELECT esp.*, u.full_name AS received_by_name FROM equipment_sale_payments esp LEFT JOIN users u ON u.id = esp.received_by WHERE esp.agreement_id = ? ORDER BY esp.payment_date DESC", [agreementId]),
      pool.query("SELECT * FROM equipment_deliveries WHERE agreement_id = ? ORDER BY id DESC", [agreementId]),
      pool.query("SELECT * FROM equipment_ownership_transfers WHERE agreement_id = ? ORDER BY id DESC", [agreementId]),
    ]);
    return res.json({ status: "success", agreement, schedule, payments, deliveries, ownership_transfers: transfers, safeguards: { delivery_allowed: deliveryAllowed(agreement), ownership_allowed: Number(agreement.outstanding_balance || 0) <= 0.01 && agreement.delivery_status === "delivered" } });
  } catch (error) {
    return sendError(res, error, "Could not load equipment sale agreement.");
  }
});

router.post("/agreements", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    const quotationId = positiveId(req.body.quotation_id);
    const saleType = enumValue(req.body.sale_type, SALE_TYPES, undefined);
    const depositReceived = money(req.body.deposit_received, 0);
    const paymentMethod = enumValue(req.body.payment_method, PAYMENT_METHODS, "cash");
    const frequency = enumValue(req.body.payment_frequency, PAYMENT_FREQUENCIES, null);
    const count = wholeNumber(req.body.installment_count, null, 120);
    const firstDueDate = dateOnly(req.body.first_due_date, null);
    const graceDays = wholeNumber(req.body.grace_days, 0, 90);
    if (!quotationId || saleType === undefined || depositReceived === undefined || paymentMethod === undefined || graceDays === undefined) {
      throw new HttpError(400, "Check the quotation, sale type and deposit details.");
    }
    if (saleType === "installment" && (!frequency || !count || !firstDueDate)) {
      throw new HttpError(400, "Installment agreements require frequency, count and first due date.");
    }
    const agreementNumber = await documentNumber("EQUIPMENT_SALE_AGREEMENT", "ESA", req.user?.id);
    const resultData = await withTransaction(async (connection) => {
      const [quoteRows] = await connection.query(
        `SELECT q.*, qi.id AS quotation_item_id, qi.asset_id, qi.asset_code_snapshot,
                qi.asset_name_snapshot, qi.asset_type_snapshot, qi.make_snapshot,
                qi.model_snapshot, qi.model_year_snapshot, qi.serial_number_snapshot,
                qi.main_image_url_snapshot
         FROM equipment_sales_quotations q
         INNER JOIN equipment_sales_quotation_items qi ON qi.quotation_id = q.id
         WHERE q.id = ? AND q.hire_location_id = ?
         LIMIT 1 FOR UPDATE`,
        [quotationId, req.hireLocationScope.locationId]
      );
      const quote = quoteRows[0];
      if (!quote) throw new HttpError(404, "Approved quotation was not found.");
      if (!["approved", "accepted"].includes(quote.status)) throw new HttpError(409, "Approve or accept the quotation before creating an agreement.");
      const customer = await customerById(connection, quote.customer_id, true);
      const asset = await saleAsset(connection, quote.asset_id, req.hireLocationScope.locationId, true);
      assertAssetCanBeSold(asset);
      if (depositReceived > Number(quote.total_amount)) throw new HttpError(400, "Deposit cannot exceed the sale total.");
      const financed = Number(Math.max(Number(quote.total_amount) - depositReceived, 0).toFixed(2));
      const schedule = saleType === "installment" ? buildSchedule(financed, count, firstDueDate, frequency) : [];
      const agreementStatus = financed <= 0.01 ? "completed" : saleType === "installment" ? "active" : "payment_due";
      const approvalStatus = quote.status === "approved" ? "approved" : "not_required";
      const [agreementResult] = await connection.query(
        `INSERT INTO equipment_sale_agreements (
           agreement_number, hire_location_id, quotation_id, quotation_item_id,
           enquiry_id, customer_id, asset_id, sale_type, agreement_status,
           approval_status, customer_name_snapshot, customer_phone_snapshot,
           customer_location_snapshot, customer_id_type, customer_id_number,
           asset_code_snapshot, asset_name_snapshot, asset_type_snapshot,
           make_snapshot, model_snapshot, model_year_snapshot,
           serial_number_snapshot, main_image_url_snapshot,
           sale_price, discount_amount, tax_amount, total_amount,
           deposit_required, deposit_received, financed_amount, scheduled_total,
           amount_paid, outstanding_balance, payment_frequency, installment_count,
           first_due_date, next_due_date, final_due_date, grace_days,
           delivery_policy, delivery_threshold_percent, guarantor_name,
           guarantor_phone, guarantor_location, guarantor_id_type,
           guarantor_id_number, terms_accepted, agreement_notes,
           created_by, approved_by, approved_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          agreementNumber,
          req.hireLocationScope.locationId,
          quote.id,
          quote.quotation_item_id,
          quote.enquiry_id,
          quote.customer_id,
          quote.asset_id,
          saleType,
          agreementStatus,
          approvalStatus,
          customer.customer_name,
          customer.phone,
          customer.address,
          nullableText(req.body.customer_id_type, 60),
          nullableText(req.body.customer_id_number, 120),
          quote.asset_code_snapshot,
          quote.asset_name_snapshot,
          quote.asset_type_snapshot,
          quote.make_snapshot,
          quote.model_snapshot,
          quote.model_year_snapshot,
          quote.serial_number_snapshot,
          quote.main_image_url_snapshot,
          quote.subtotal,
          quote.discount_amount,
          quote.tax_amount,
          quote.total_amount,
          quote.deposit_required,
          depositReceived,
          financed,
          saleType === "installment" ? financed : 0,
          depositReceived,
          financed,
          saleType === "installment" ? frequency : null,
          saleType === "installment" ? count : null,
          saleType === "installment" ? firstDueDate : null,
          schedule[0]?.due_date || null,
          schedule.at(-1)?.due_date || null,
          graceDays,
          quote.delivery_policy,
          quote.delivery_threshold_percent,
          nullableText(req.body.guarantor_name, 150),
          nullableText(req.body.guarantor_phone, 30),
          nullableText(req.body.guarantor_location, 180),
          nullableText(req.body.guarantor_id_type, 60),
          nullableText(req.body.guarantor_id_number, 120),
          boolValue(req.body.terms_accepted, false),
          nullableText(req.body.agreement_notes, 5000),
          req.user?.id || null,
          req.user?.id || null,
          new Date(),
          agreementStatus === "completed" ? new Date() : null,
        ]
      );
      for (const row of schedule) {
        await connection.query(
          `INSERT INTO equipment_installment_schedule (
             agreement_id, sequence_number, due_date, scheduled_amount, schedule_status
           ) VALUES (?, ?, ?, ?, CASE WHEN ? < CURDATE() THEN 'overdue' WHEN ? = CURDATE() THEN 'due' ELSE 'upcoming' END)`,
          [agreementResult.insertId, row.sequence_number, row.due_date, row.scheduled_amount, row.due_date, row.due_date]
        );
      }
      if (depositReceived > 0) {
        const paymentNumber = await documentNumber("EQUIPMENT_SALE_PAYMENT", "ESP", req.user?.id);
        const receiptNumber = await documentNumber("EQUIPMENT_SALE_RECEIPT", "ESR", req.user?.id);
        await connection.query(
          `INSERT INTO equipment_sale_payments (
             payment_number, receipt_number, hire_location_id, agreement_id,
             customer_id, payment_date, payment_category, amount,
             payment_method, reference_number, notes, received_by
           ) VALUES (?, ?, ?, ?, ?, NOW(), 'deposit', ?, ?, ?, ?, ?)`,
          [paymentNumber, receiptNumber, req.hireLocationScope.locationId, agreementResult.insertId, quote.customer_id, depositReceived, paymentMethod, nullableText(req.body.reference_number, 150), "Opening deposit received with agreement.", req.user?.id || null]
        );
      }
      const lockStatus = saleType === "installment" ? "installment_active" : "reserved";
      await connection.query(
        `INSERT INTO equipment_asset_sale_locks (
           asset_id, agreement_id, hire_location_id, lock_status,
           lock_reason, created_by
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [asset.id, agreementResult.insertId, req.hireLocationScope.locationId, lockStatus, `Reserved under ${agreementNumber}`, req.user?.id || null]
      );
      await connection.query(
        "UPDATE fleet_assets SET sale_status = ?, sale_reserved_until = NULL, updated_by = ? WHERE id = ?",
        [lockStatus === "installment_active" ? "installment_active" : "reserved", req.user?.id || null, asset.id]
      );
      await connection.query("UPDATE equipment_sales_quotations SET status = 'converted' WHERE id = ?", [quote.id]);
      if (quote.enquiry_id) await connection.query("UPDATE equipment_sales_enquiries SET status = 'won', updated_by = ? WHERE id = ?", [req.user?.id || null, quote.enquiry_id]);
      await audit(req, connection, "EQUIPMENT_SALE_AGREEMENT_CREATED", "equipment_sale_agreement", agreementResult.insertId, `Created ${saleType} agreement ${agreementNumber} for ${asset.asset_code}.`, { total_amount: quote.total_amount, deposit_received: depositReceived });
      return { id: agreementResult.insertId, customer_phone: customer.phone };
    });
    const agreement = await agreementRecord(pool, resultData.id, req.hireLocationScope.locationId);
    const sms = await sendAgreementSms(req, agreement, "agreement_created");
    return res.status(201).json({ status: "success", message: "Equipment sale agreement created and equipment reserved.", agreement, sms });
  } catch (error) {
    return sendError(res, error, "Could not create equipment sale agreement.");
  }
});

router.post("/agreements/:id/payments", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    const agreementId = positiveId(req.params.id);
    const amount = money(req.body.amount, undefined);
    const method = enumValue(req.body.payment_method, PAYMENT_METHODS, undefined);
    let category = enumValue(req.body.payment_category, PAYMENT_CATEGORIES, "installment");
    if (!agreementId || amount === undefined || amount <= 0 || method === undefined || category === undefined) {
      throw new HttpError(400, "Enter a valid payment amount and method.");
    }
    const paymentData = await withTransaction(async (connection) => {
      const agreement = await agreementRecord(connection, agreementId, req.hireLocationScope.locationId, true);
      if (!agreement) throw new HttpError(404, "Agreement was not found.");
      assertLegacyCommercialAgreement(agreement);
      if (["cancelled", "defaulted"].includes(agreement.agreement_status)) throw new HttpError(409, "Payments cannot be added to this agreement.");
      if (amount > Number(agreement.outstanding_balance || 0) + 0.01) throw new HttpError(400, "Payment exceeds the outstanding balance.");
      if (Number(agreement.outstanding_balance || 0) - amount <= 0.01) category = "settlement";
      const paymentNumber = await documentNumber("EQUIPMENT_SALE_PAYMENT", "ESP", req.user?.id);
      const receiptNumber = await documentNumber("EQUIPMENT_SALE_RECEIPT", "ESR", req.user?.id);
      const [result] = await connection.query(
        `INSERT INTO equipment_sale_payments (
           payment_number, receipt_number, hire_location_id, agreement_id,
           customer_id, payment_date, payment_category, amount, payment_method,
           reference_number, notes, received_by
         ) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?)`,
        [paymentNumber, receiptNumber, agreement.hire_location_id, agreement.id, agreement.customer_id, category, amount, method, nullableText(req.body.reference_number, 150), nullableText(req.body.notes, 500), req.user?.id || null]
      );
      if (agreement.sale_type === "installment" && ["installment", "settlement"].includes(category)) {
        let remaining = amount;
        const [schedule] = await connection.query(
          `SELECT * FROM equipment_installment_schedule
           WHERE agreement_id = ? AND schedule_status NOT IN ('paid','cancelled','waived')
           ORDER BY due_date, sequence_number FOR UPDATE`,
          [agreement.id]
        );
        for (const row of schedule) {
          if (remaining <= 0.001) break;
          const lineBalance = Math.max(Number(row.scheduled_amount) + Number(row.late_charge_amount || 0) - Number(row.waived_charge_amount || 0) - Number(row.amount_paid || 0), 0);
          const allocated = Number(Math.min(remaining, lineBalance).toFixed(2));
          if (allocated <= 0) continue;
          await connection.query("INSERT INTO equipment_sale_payment_allocations (payment_id, schedule_id, allocated_amount) VALUES (?, ?, ?)", [result.insertId, row.id, allocated]);
          const newPaid = Number((Number(row.amount_paid || 0) + allocated).toFixed(2));
          const totalLine = Number((Number(row.scheduled_amount) + Number(row.late_charge_amount || 0) - Number(row.waived_charge_amount || 0)).toFixed(2));
          const lineStatus = newPaid + 0.01 >= totalLine ? "paid" : "partial";
          await connection.query(
            `UPDATE equipment_installment_schedule SET amount_paid = ?, schedule_status = ?,
             fully_paid_at = CASE WHEN ? = 'paid' THEN NOW() ELSE fully_paid_at END WHERE id = ?`,
            [newPaid, lineStatus, lineStatus, row.id]
          );
          remaining = Number((remaining - allocated).toFixed(2));
        }
      }
      await connection.query(
        `UPDATE equipment_installment_schedule
         SET schedule_status = CASE
           WHEN amount_paid + 0.01 >= scheduled_amount + late_charge_amount - waived_charge_amount THEN 'paid'
           WHEN due_date < CURDATE() THEN 'overdue'
           WHEN due_date = CURDATE() THEN 'due'
           WHEN amount_paid > 0 THEN 'partial'
           ELSE 'upcoming' END
         WHERE agreement_id = ? AND schedule_status NOT IN ('cancelled','waived')`,
        [agreement.id]
      );
      const refreshed = await refreshAgreement(connection, agreement.id);
      await audit(req, connection, "EQUIPMENT_SALE_PAYMENT_RECORDED", "equipment_sale_payment", result.insertId, `Recorded GHS ${amount.toFixed(2)} against ${agreement.agreement_number}.`, { receipt_number: receiptNumber, payment_method: method, outstanding_balance: refreshed.balance });
      return { payment_id: result.insertId, receipt_number: receiptNumber, refreshed };
    });
    const agreement = await agreementRecord(pool, agreementId, req.hireLocationScope.locationId);
    const sms = await sendAgreementSms(req, agreement, paymentData.refreshed.balance <= 0.01 ? "completed" : "payment_receipt");
    return res.status(201).json({ status: "success", message: "Payment recorded and receipt created.", ...paymentData, agreement, sms });
  } catch (error) {
    return sendError(res, error, "Could not record equipment sale payment.");
  }
});

router.post("/agreements/:id/delivery", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    const agreementId = positiveId(req.params.id);
    const deliveryDate = dateTime(req.body.delivery_datetime, new Date().toISOString());
    const condition = enumValue(req.body.condition_status, DELIVERY_CONDITIONS, undefined);
    const meter = money(req.body.meter_reading, null);
    const fuel = percent(req.body.fuel_level_percent, null);
    const receiver = cleanText(req.body.receiving_person, 150);
    if (!agreementId || !deliveryDate || condition === undefined || meter === undefined || fuel === undefined || !receiver) {
      throw new HttpError(400, "Check delivery date, condition, meter and receiving person.");
    }
    const deliveryNumber = await documentNumber("EQUIPMENT_SALE_DELIVERY", "ESD", req.user?.id);
    const deliveryId = await withTransaction(async (connection) => {
      const agreement = await agreementRecord(connection, agreementId, req.hireLocationScope.locationId, true);
      if (!agreement) throw new HttpError(404, "Agreement was not found.");
      assertLegacyCommercialAgreement(agreement);
      if (!deliveryAllowed(agreement)) throw new HttpError(409, "The payment threshold for delivery has not been reached.", "DELIVERY_PAYMENT_THRESHOLD_NOT_MET");
      const [existing] = await connection.query("SELECT id FROM equipment_deliveries WHERE agreement_id = ? LIMIT 1 FOR UPDATE", [agreement.id]);
      if (existing.length) throw new HttpError(409, "Delivery has already been recorded for this agreement.");
      const [result] = await connection.query(
        `INSERT INTO equipment_deliveries (
           delivery_number, hire_location_id, agreement_id, customer_id, asset_id,
           delivery_datetime, destination, meter_reading, fuel_level_percent,
           condition_status, attachments_tools, receiving_person, receiving_phone,
           customer_signature_url, delivery_note_url, notes, status,
           created_by, approved_by, approved_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'delivered', ?, ?, NOW())`,
        [deliveryNumber, agreement.hire_location_id, agreement.id, agreement.customer_id, agreement.asset_id, deliveryDate, nullableText(req.body.destination, 255), meter, fuel, condition, nullableText(req.body.attachments_tools, 3000), receiver, nullableText(req.body.receiving_phone, 30), nullableText(req.body.customer_signature_url, 3000), nullableText(req.body.delivery_note_url, 3000), nullableText(req.body.notes, 3000), req.user?.id || null, req.user?.id || null]
      );
      await connection.query("UPDATE equipment_sale_agreements SET delivery_status = 'delivered', delivered_at = ? WHERE id = ?", [deliveryDate, agreement.id]);
      if (meter !== null && meter > Number(agreement.current_meter || 0)) {
        await connection.query("UPDATE fleet_assets SET current_meter = ?, updated_by = ? WHERE id = ?", [meter, req.user?.id || null, agreement.asset_id]);
      }
      await audit(req, connection, "EQUIPMENT_SALE_DELIVERED", "equipment_delivery", result.insertId, `Delivered equipment for ${agreement.agreement_number}.`, { delivery_number: deliveryNumber });
      return result.insertId;
    });
    const agreement = await agreementRecord(pool, agreementId, req.hireLocationScope.locationId);
    const sms = await sendAgreementSms(req, agreement, "delivered");
    return res.status(201).json({ status: "success", message: "Equipment delivery recorded.", delivery_id: deliveryId, delivery_number: deliveryNumber, sms });
  } catch (error) {
    return sendError(res, error, "Could not record equipment delivery.");
  }
});

router.post("/agreements/:id/ownership-transfer", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    const agreementId = positiveId(req.params.id);
    const transferDate = dateOnly(req.body.transfer_date, today());
    if (!agreementId || !transferDate) throw new HttpError(400, "Enter a valid ownership-transfer date.");
    const transferNumber = await documentNumber("EQUIPMENT_OWNERSHIP_TRANSFER", "EOT", req.user?.id);
    const transferId = await withTransaction(async (connection) => {
      const agreement = await agreementRecord(connection, agreementId, req.hireLocationScope.locationId, true);
      if (!agreement) throw new HttpError(404, "Agreement was not found.");
      assertLegacyCommercialAgreement(agreement);
      if (Number(agreement.outstanding_balance || 0) > 0.01) throw new HttpError(409, "Ownership cannot transfer while a balance remains.", "OWNERSHIP_BALANCE_REMAINS");
      if (agreement.delivery_status !== "delivered") throw new HttpError(409, "Record equipment delivery before ownership transfer.");
      const [existing] = await connection.query("SELECT id FROM equipment_ownership_transfers WHERE agreement_id = ? LIMIT 1 FOR UPDATE", [agreement.id]);
      if (existing.length) throw new HttpError(409, "Ownership has already been transferred.");
      const [result] = await connection.query(
        `INSERT INTO equipment_ownership_transfers (
           transfer_number, hire_location_id, agreement_id, customer_id,
           asset_id, transfer_date, ownership_document_url,
           registration_transfer_reference, notes, status, issued_by, issued_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, NOW())`,
        [transferNumber, agreement.hire_location_id, agreement.id, agreement.customer_id, agreement.asset_id, transferDate, nullableText(req.body.ownership_document_url, 3000), nullableText(req.body.registration_transfer_reference, 150), nullableText(req.body.notes, 3000), req.user?.id || null]
      );
      await connection.query("UPDATE equipment_sale_agreements SET ownership_status = 'transferred', agreement_status = 'completed', completed_at = COALESCE(completed_at, NOW()) WHERE id = ?", [agreement.id]);
      await connection.query("UPDATE equipment_asset_sale_locks SET lock_status = 'sold', expires_at = NULL WHERE agreement_id = ? AND released_at IS NULL", [agreement.id]);
      await connection.query("UPDATE fleet_assets SET sale_status = 'sold', current_status = 'sold', sold_at = NOW(), updated_by = ? WHERE id = ?", [req.user?.id || null, agreement.asset_id]);
      await audit(req, connection, "EQUIPMENT_OWNERSHIP_TRANSFERRED", "equipment_ownership_transfer", result.insertId, `Ownership transferred under ${agreement.agreement_number}.`, { transfer_number: transferNumber });
      return result.insertId;
    });
    const agreement = await agreementRecord(pool, agreementId, req.hireLocationScope.locationId);
    const sms = await sendAgreementSms(req, agreement, "ownership_ready");
    return res.status(201).json({ status: "success", message: "Ownership transfer completed and equipment marked sold.", transfer_id: transferId, transfer_number: transferNumber, sms });
  } catch (error) {
    return sendError(res, error, "Could not complete ownership transfer.");
  }
});

router.post("/agreements/:id/sms", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    const agreementId = positiveId(req.params.id);
    const reminderType = enumValue(req.body.reminder_type, SMS_TYPES, undefined);
    if (!agreementId || reminderType === undefined) throw new HttpError(400, "Choose a valid Equipment Sales SMS type.");
    const agreement = await agreementRecord(pool, agreementId, req.hireLocationScope.locationId);
    if (!agreement) throw new HttpError(404, "Agreement was not found.");
    assertLegacyCommercialAgreement(agreement);
    const result = await sendAgreementSms(req, agreement, reminderType, req.body.message);
    return res.status(result.ok ? 200 : 202).json({ status: result.ok ? "success" : "warning", message: result.ok ? "Equipment Sales SMS submitted." : result.reason || result.message || "SMS delivery could not be confirmed.", sms: result });
  } catch (error) {
    return sendError(res, error, "Could not send Equipment Sales SMS.");
  }
});

module.exports = router;
