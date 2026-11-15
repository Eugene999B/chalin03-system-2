"use strict";

const PDFDocument = require("pdfkit");
const express = require("express");
const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { nextDocumentNumber } = require("../services/groupConfigurationService");
const { writeAuditEvent } = require("../services/auditTrailService");
const { workspaceRoleFor, isEquipmentAdministrator } = require("../security/equipmentDivisionAccess");

const router = express.Router();
const MANAGER_ROLES = new Set([
  "admin", "administrator", "manager", "system_admin", "system_administrator",
  "super_admin", "finance_manager", "equipment_business_manager",
  "finance_accountant", "equipment_business_accountant",
]);
const CONDITIONS = new Set(["new", "excellent", "good", "fair", "poor", "damaged"]);

class ReadyCashError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
function fail(status, code, message) {
  throw new ReadyCashError(status, code, message);
}
function id(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
function text(value, length = 150) {
  return String(value ?? "").trim().slice(0, length);
}
function cents(value) {
  const raw = String(value ?? "").trim();
  if (!/^[0-9]{1,12}(?:\.[0-9]{1,2})?$/.test(raw)) return null;
  const amount = Math.round(Number(raw) * 100);
  return Number.isSafeInteger(amount) ? amount : null;
}
function currency(value) {
  return Number((value / 100).toFixed(2));
}
function dateToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Accra", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = (part) => parts.find((entry) => entry.type === part)?.value;
  return value("year") + "-" + value("month") + "-" + value("day");
}
function nextDate(days) {
  const d = new Date(dateToday() + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function sendError(res, error) {
  if (error instanceof ReadyCashError) {
    return res.status(error.statusCode).json({
      status: "error", code: error.code, message: error.message,
    });
  }
  if (["ER_DUP_ENTRY", "ER_SIGNAL_EXCEPTION", "ER_CHECK_CONSTRAINT_VIOLATED"].includes(error?.code)) {
    return res.status(409).json({
      status: "error", code: "READY_CASH_CONFLICT",
      message: "The machine or payment may already be recorded. Refresh the Ready Cash register before retrying.",
    });
  }
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return res.status(503).json({
      status: "error", code: "READY_CASH_SCHEMA_NOT_READY",
      message: "Ready Cash requires verified Finance schema compatibility. No sale was recorded.",
    });
  }
  console.error("Ready Cash processing failed:", error);
  return res.status(500).json({
    status: "error", code: "READY_CASH_UNAVAILABLE",
    message: "Ready Cash could not finish. Check the transaction register before retrying.",
  });
}
async function transaction(callback) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}
async function audit(connection, req, action, agreementId, details, metadata) {
  await writeAuditEvent({
    connection, req, userId: id(req.user?.id),
    workspaceCode: "equipment_installment_finance",
    action, actionType: action, entityType: "equipment_sale_agreement",
    entityId: agreementId, details, severity: "high", metadata,
  });
}

router.get("/ready-cash/recent", requirePermission("fleet.assets.view"), async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.id, a.agreement_number, a.asset_id, a.asset_code_snapshot,
              a.asset_name_snapshot, a.customer_name_snapshot, a.total_amount,
              a.amount_paid, a.outstanding_balance, a.agreement_status,
              a.delivery_status, a.ownership_status, a.created_at,
              p.receipt_number, p.payment_method
       FROM equipment_sale_agreements a
       INNER JOIN equipment_sale_payments p ON p.agreement_id = a.id
         AND p.payment_category = 'settlement' AND p.is_voided = FALSE
       WHERE a.sale_type = 'cash'
         AND a.hire_location_id IS NULL
         AND a.agreement_notes LIKE 'READY_CASH:%'
       ORDER BY a.id DESC LIMIT 50`
    );
    return res.json({ status: "success", sales: rows });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/ready-cash/checkout", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    const customerId = id(req.body?.customer_id);
    const assetId = id(req.body?.asset_id);
    const requestKey = text(req.body?.idempotency_key, 100);
    const requestedCents = cents(req.body?.amount);
    const taxCents = cents(req.body?.tax_amount_included);
    if (req.body?.sale_option !== "ready_cash") {
      fail(400, "READY_CASH_SALE_OPTION_REQUIRED",
        "Select Ready Cash as the pay-in-full sale option.");
    }
    if (!customerId || !assetId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) {
      fail(400, "READY_CASH_INPUT_INVALID", "Choose the buyer, machine and a unique checkout reference.");
    }
    if (req.body?.customer_terms_accepted !== true) {
      fail(400, "READY_CASH_TERMS_REQUIRED",
        "The customer must accept the full payment sale terms before checkout.");
    }
    // Ready Cash describes settlement timing, NOT the tender or a payment provider.
    // An authorized operator manually confirms a received full payment. This
    // endpoint never initiates a charge, debit or payment-provider integration.
    if (req.body?.full_payment_confirmed !== true) {
      fail(400, "READY_CASH_PAYMENT_NOT_CONFIRMED",
        "Confirm that the buyer has already paid the complete agreed price.");
    }
    const paymentReference = text(req.body?.full_payment_reference, 150);
    if (!paymentReference) {
      fail(400, "READY_CASH_REFERENCE_REQUIRED",
        "Record the internal reference for the full payment that was actually received.");
    }
    if (requestedCents === null || requestedCents <= 0) {
      fail(400, "READY_CASH_AMOUNT_INVALID", "Enter the exact full selling price in GHS.");
    }
    if (taxCents === null || taxCents > requestedCents / 2 ||
        req.body?.tax_treatment_reviewed !== true) {
      fail(400, "READY_CASH_TAX_REVIEW_REQUIRED",
        "Enter the explicitly approved tax included in the full price (use 0 only for an approved zero-tax treatment), and confirm Finance review.");
    }

    const [previous] = await pool.query(
      `SELECT a.id, a.agreement_number, a.customer_id, a.asset_id,
              a.total_amount, a.tax_amount, a.delivery_status, a.ownership_status,
              p.receipt_number, p.reference_number, p.is_voided, a.outstanding_balance,
              a.agreement_notes, a.sale_type
       FROM equipment_sale_payments p
       INNER JOIN equipment_sale_agreements a ON a.id = p.agreement_id
       WHERE p.idempotency_key = ? LIMIT 1`,
      [requestKey]
    );
    if (previous.length) {
      const record = previous[0];
      if (Number(record.is_voided) === 1 ||
          record.sale_type !== "cash" ||
          !String(record.agreement_notes || "").startsWith("READY_CASH:") ||
          cents(record.outstanding_balance) !== 0) {
        fail(409, "READY_CASH_ORIGINAL_PAYMENT_REVERSED",
          "This checkout reference is not an active, settled Ready Cash receipt. Review its full transaction history.");
      }
      if (Number(record.customer_id) !== customerId ||
          Number(record.asset_id) !== assetId ||
          cents(record.total_amount) !== requestedCents ||
          cents(record.tax_amount) !== taxCents ||
          text(record.reference_number) !== paymentReference) {
        fail(409, "READY_CASH_IDEMPOTENCY_CONFLICT", "This checkout reference belongs to another sale.");
      }
      return res.json({
        status: "success", duplicate: true, paid_in_full: true,
        agreement_id: record.id, agreement_number: record.agreement_number,
        receipt_number: record.receipt_number, delivery_status: record.delivery_status,
        ownership_status: record.ownership_status,
        message: "This full payment was already recorded. No additional receipt was created.",
      });
    }

    const userId = id(req.user?.id);
    // Document sequences are allocated separately; gaps after failed transactions
    // are acceptable, but no failed checkout can persist a sale or payment.
    const [quoteNumber, agreementNumber, paymentNumber, receiptNumber] = await Promise.all([
      nextDocumentNumber("EQUIPMENT_SALES_QUOTATION", { userId }),
      nextDocumentNumber("EQUIPMENT_SALE_AGREEMENT", { userId }),
      nextDocumentNumber("EQUIPMENT_SALE_PAYMENT", { userId }),
      nextDocumentNumber("EQUIPMENT_SALE_RECEIPT", { userId }),
    ]);

    const saved = await transaction(async (connection) => {
      const [existing] = await connection.query(
        "SELECT agreement_id FROM equipment_sale_payments WHERE idempotency_key = ? LIMIT 1 FOR UPDATE",
        [requestKey]
      );
      if (existing.length) fail(409, "READY_CASH_ALREADY_RECORDED", "This receipt already exists. Refresh the Ready Cash register.");

      const [customers] = await connection.query(
        "SELECT * FROM hire_customers WHERE id = ? AND is_active = TRUE LIMIT 1 FOR UPDATE",
        [customerId]
      );
      const customer = customers[0];
      if (!customer || !text(customer.customer_name) || !text(customer.phone)) {
        fail(409, "READY_CASH_CUSTOMER_INVALID", "Select an active customer with their name and telephone number.");
      }
      const [machines] = await connection.query(
        "SELECT * FROM fleet_assets WHERE id = ? AND is_active = TRUE LIMIT 1 FOR UPDATE",
        [assetId]
      );
      const machine = machines[0];
      if (!machine || !["sale_only", "sale_or_hire"].includes(machine.operational_purpose) ||
          machine.sale_status !== "available" ||
          !text(machine.asset_code) || !text(machine.asset_name) || !text(machine.asset_type)) {
        fail(409, "READY_CASH_MACHINE_UNAVAILABLE", "This excavator is not available for sale.");
      }
      const totalCents = cents(machine.target_selling_price);
      if (!totalCents || totalCents !== requestedCents) {
        fail(409, "READY_CASH_PRICE_CHANGED",
          "The configured machine price changed. Refresh the checkout and verify the approved price.");
      }
      const [[conflict]] = await connection.query(
        `SELECT
            (SELECT COUNT(*) FROM equipment_asset_sale_locks l
              WHERE l.asset_id = ? AND l.released_at IS NULL) AS active_sale_locks,
            (SELECT COUNT(*) FROM hire_contract_assets h
              WHERE h.asset_id = ? AND h.status IN ('assigned','dispatched','active')) AS active_hires,
            (SELECT COUNT(*) FROM equipment_credit_applications a
              WHERE a.asset_id = ? AND a.application_status IN
                ('draft','submitted','under_review','changes_requested','approved')) AS active_finance_applications,
            (SELECT COUNT(*) FROM equipment_sale_agreements a
              WHERE a.asset_id = ? AND a.agreement_status NOT IN ('cancelled','defaulted')) AS existing_sales`,
        [assetId, assetId, assetId, assetId]
      );
      if (Number(conflict.active_sale_locks) || Number(conflict.active_hires) ||
          Number(conflict.active_finance_applications) || Number(conflict.existing_sales)) {
        fail(409, "READY_CASH_MACHINE_HELD", "This excavator is already held for Hire, finance or another sale.");
      }

      const money = currency(totalCents);
      const taxAmount = currency(taxCents);
      const subtotal = currency(totalCents - taxCents);
      const effectiveTaxPercent = taxCents > 0
        ? Number((taxCents / (totalCents - taxCents) * 100).toFixed(4))
        : 0;
      const [q] = await connection.query("INSERT INTO equipment_sales_quotations SET ?", {
        quotation_number: quoteNumber, hire_location_id: null, enquiry_id: null,
        customer_id: customerId, quotation_date: dateToday(), validity_date: nextDate(7),
        status: "converted", subtotal, discount_amount: 0,
        tax_rate_percent: effectiveTaxPercent,
        tax_amount: taxAmount, total_amount: money, deposit_required: money,
        delivery_policy: "after_full_payment", delivery_threshold_percent: 100,
        terms: "Ready Cash: one confirmed full payment; no installment repayment plan.",
        notes: "Ready Cash final price copied from machine register. Included tax component manually confirmed from approved invoice; effective blended percent is arithmetic only.",
        created_by: userId, approved_by: userId, approved_at: new Date(),
      });
      const [qi] = await connection.query("INSERT INTO equipment_sales_quotation_items SET ?", {
        quotation_id: q.insertId, hire_location_id: null, line_number: 1,
        asset_id: assetId, asset_code_snapshot: machine.asset_code,
        asset_name_snapshot: machine.asset_name, asset_type_snapshot: machine.asset_type,
        make_snapshot: machine.make, model_snapshot: machine.model,
        model_year_snapshot: machine.model_year,
        serial_number_snapshot: machine.serial_number,
        main_image_url_snapshot: machine.main_image_url,
        quantity: 1, unit_price: subtotal, discount_amount: 0, tax_amount: taxAmount, line_total: money,
      });
      const [agreement] = await connection.query("INSERT INTO equipment_sale_agreements SET ?", {
        agreement_number: agreementNumber, hire_location_id: null,
        quotation_id: q.insertId, quotation_item_id: qi.insertId,
        customer_id: customerId, asset_id: assetId,
        sale_type: "cash", activation_source: "legacy",
        agreement_status: "completed", approval_status: "not_required",
        customer_name_snapshot: customer.customer_name,
        customer_phone_snapshot: customer.phone,
        customer_location_snapshot: customer.address || null,
        asset_code_snapshot: machine.asset_code, asset_name_snapshot: machine.asset_name,
        asset_type_snapshot: machine.asset_type, make_snapshot: machine.make,
        model_snapshot: machine.model, model_year_snapshot: machine.model_year,
        serial_number_snapshot: machine.serial_number,
        main_image_url_snapshot: machine.main_image_url,
        sale_price: subtotal, discount_amount: 0, tax_amount: taxAmount, total_amount: money,
        deposit_required: money, deposit_received: money,
        financed_amount: 0, scheduled_total: 0,
        amount_paid: money, outstanding_balance: 0,
        delivery_policy: "after_full_payment", delivery_threshold_percent: 100,
        terms_accepted: true,
        agreement_notes: "READY_CASH: full payment manually confirmed; no payment gateway initiated. Delivery and ownership handover pending.",
        created_by: userId, completed_at: new Date(),
      });
      await connection.query("INSERT INTO equipment_sale_payments SET ?", {
        payment_number: paymentNumber, receipt_number: receiptNumber,
        idempotency_key: requestKey, hire_location_id: null,
        agreement_id: agreement.insertId, customer_id: customerId,
        payment_date: new Date(), payment_category: "settlement",
        // Existing schema requires a tender code. 'other' records a manual
        // full-payment confirmation, NOT a claim that physical cash was tendered.
        // Treasury must reconcile the actual channel before this is released.
        amount: money, payment_method: "other",
        reference_number: paymentReference,
        notes: "Ready Cash manual full-payment confirmation; payment channel not assigned by this workflow. No installment schedule.",
        received_by: userId,
      });
      await connection.query(
        `INSERT INTO equipment_asset_sale_locks
           (asset_id, agreement_id, hire_location_id, lock_status, lock_reason, created_by)
         VALUES (?, ?, NULL, 'reserved', ?, ?)`,
        [assetId, agreement.insertId,
          "Fully paid Ready Cash machine awaiting signed delivery and ownership handover.", userId]
      );
      const [updated] = await connection.query(
        `UPDATE fleet_assets
         SET sale_status = 'reserved', sale_reserved_until = NULL, updated_by = ?
         WHERE id = ? AND sale_status = 'available'`,
        [userId, assetId]
      );
      if (Number(updated.affectedRows) !== 1) {
        fail(409, "READY_CASH_MACHINE_CHANGED", "Machine availability changed during checkout.");
      }
      await audit(connection, req, "EQUIPMENT_READY_CASH_PAID_IN_FULL", agreement.insertId,
        "Ready Cash full settlement " + agreementNumber + " received for " + machine.asset_code + ".",
        { asset_id: assetId, customer_id: customerId, amount: money,
          payment_recording: "manual_full_payment", tax_amount: taxAmount, receipt_number: receiptNumber,
          idempotency_key: requestKey, delivery_pending: true, schedule_count: 0 });
      return { agreementId: agreement.insertId, amount: money, assetCode: machine.asset_code };
    });
    return res.status(201).json({
      status: "success", paid_in_full: true, outstanding_balance: 0,
      installment_schedule_created: false, agreement_id: saved.agreementId,
      agreement_number: agreementNumber, receipt_number: receiptNumber,
      delivery_status: "reserved", ownership_status: "retained",
      message: "Full payment recorded manually. The machine is reserved, not yet sold. Complete the signed handover to mark it sold.",
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/ready-cash/:agreementId/handover", requirePermission("fleet.assets.manage"), async (req, res) => {
  try {
    const agreementId = id(req.params.agreementId);
    const userId = id(req.user?.id);
    if (!agreementId) fail(400, "READY_CASH_ID_INVALID", "Select a valid Ready Cash sale.");
    const role = workspaceRoleFor(req.user);
    if (!isEquipmentAdministrator(req.user) && !MANAGER_ROLES.has(role)) {
      fail(403, "READY_CASH_HANDOVER_RESTRICTED", "Only an authorized finance manager or administrator may authorize handover.");
    }
    const receiver = text(req.body?.receiving_person, 150);
    const reference = text(req.body?.handover_reference, 150);
    const condition = text(req.body?.condition_status, 40);
    if (!receiver || !reference || !CONDITIONS.has(condition) ||
        req.body?.signed_handover_confirmed !== true) {
      fail(400, "READY_CASH_HANDOVER_EVIDENCE_REQUIRED",
        "Record the receiving person, actual condition and signed handover reference before ownership transfer.");
    }

    const [deliveryNumber, ownershipNumber] = await Promise.all([
      nextDocumentNumber("EQUIPMENT_SALE_DELIVERY", { userId }),
      nextDocumentNumber("EQUIPMENT_OWNERSHIP_TRANSFER", { userId }),
    ]);
    const saved = await transaction(async (connection) => {
      const [agreements] = await connection.query(
        `SELECT * FROM equipment_sale_agreements
         WHERE id = ? AND hire_location_id IS NULL AND sale_type = 'cash'
           AND agreement_notes LIKE 'READY_CASH:%' LIMIT 1 FOR UPDATE`,
        [agreementId]
      );
      const agreement = agreements[0];
      if (!agreement) fail(404, "READY_CASH_NOT_FOUND", "Ready Cash sale not found.");
      if (agreement.ownership_status === "transferred") {
        const [existing] = await connection.query(
          "SELECT transfer_number FROM equipment_ownership_transfers WHERE agreement_id = ? LIMIT 1",
          [agreementId]
        );
        return { duplicate: true, transferNumber: existing[0]?.transfer_number };
      }
      if (Number(agreement.created_by) === userId) {
        fail(403, "READY_CASH_INDEPENDENT_HANDOVER_REQUIRED",
          "A separate authorized manager must certify delivery and ownership transfer.");
      }
      if (cents(agreement.total_amount) !== cents(agreement.amount_paid) ||
          cents(agreement.outstanding_balance) !== 0) {
        fail(409, "READY_CASH_PAYMENT_NOT_COMPLETE", "Ownership cannot transfer until the full payment is recorded.");
      }
      const [payments] = await connection.query(
        `SELECT id FROM equipment_sale_payments
         WHERE agreement_id = ? AND payment_category = 'settlement'
           AND is_voided = FALSE LIMIT 1 FOR UPDATE`, [agreementId]
      );
      if (!payments.length) fail(409, "READY_CASH_RECEIPT_MISSING", "Confirmed full-payment evidence is missing.");
      const [paymentTotals] = await connection.query(
        `SELECT COALESCE(SUM(CASE WHEN payment_category <> 'refund'
             THEN amount ELSE -amount END), 0) AS net_collected
         FROM equipment_sale_payments
         WHERE agreement_id = ? AND is_voided = FALSE`,
        [agreementId]
      );
      if (cents(paymentTotals[0]?.net_collected) !== cents(agreement.total_amount)) {
        fail(409, "READY_CASH_LEDGER_NOT_RECONCILED",
          "The immutable payment ledger no longer matches the sale total. Reconcile before ownership transfer.");
      }
      const [prior] = await connection.query(
        "SELECT id FROM equipment_deliveries WHERE agreement_id = ? LIMIT 1 FOR UPDATE",
        [agreementId]
      );
      if (prior.length) fail(409, "READY_CASH_DELIVERY_EXISTS", "Delivery already exists. Review this case before retrying.");
      const [asset] = await connection.query(
        "SELECT id, sale_status FROM fleet_assets WHERE id = ? FOR UPDATE", [agreement.asset_id]
      );
      const [locks] = await connection.query(
        `SELECT agreement_id, lock_status FROM equipment_asset_sale_locks
         WHERE asset_id = ? AND released_at IS NULL FOR UPDATE`, [agreement.asset_id]
      );
      if (!asset[0] || asset[0].sale_status !== "reserved" ||
          locks.length !== 1 || Number(locks[0].agreement_id) !== agreementId) {
        fail(409, "READY_CASH_MACHINE_RESERVATION_CHANGED",
          "Machine reservation is no longer linked to this Ready Cash sale.");
      }
      const [delivery] = await connection.query("INSERT INTO equipment_deliveries SET ?", {
        delivery_number: deliveryNumber, hire_location_id: null, agreement_id: agreementId,
        customer_id: agreement.customer_id, asset_id: agreement.asset_id,
        delivery_datetime: new Date(), destination: text(req.body?.destination, 255) || null,
        condition_status: condition, receiving_person: receiver,
        receiving_phone: text(req.body?.receiving_phone, 30) || null,
        notes: "Signed Ready Cash delivery reference: " + reference,
        status: "delivered", created_by: userId, approved_by: userId, approved_at: new Date(),
      });
      const [transfer] = await connection.query("INSERT INTO equipment_ownership_transfers SET ?", {
        transfer_number: ownershipNumber, hire_location_id: null,
        agreement_id: agreementId, customer_id: agreement.customer_id,
        asset_id: agreement.asset_id, transfer_date: dateToday(),
        registration_transfer_reference: reference,
        notes: "Ready Cash fully paid, signed handover documented and delivered.",
        status: "issued", issued_by: userId, issued_at: new Date(),
      });
      await connection.query(
        `UPDATE equipment_sale_agreements SET delivery_status = 'delivered',
           delivered_at = NOW(), ownership_status = 'transferred',
           agreement_status = 'completed', completed_at = COALESCE(completed_at, NOW())
         WHERE id = ?`, [agreementId]
      );
      await connection.query(
        "UPDATE equipment_asset_sale_locks SET lock_status = 'sold', expires_at = NULL WHERE agreement_id = ?",
        [agreementId]
      );
      await connection.query(
        `UPDATE fleet_assets SET sale_status = 'sold', current_status = 'sold',
           sold_at = NOW(), updated_by = ? WHERE id = ?`,
        [userId, agreement.asset_id]
      );
      await audit(connection, req, "EQUIPMENT_READY_CASH_OWNERSHIP_TRANSFERRED", agreementId,
        "Signed Ready Cash delivery and ownership transfer approved by independent manager.",
        { payment_verified: true, delivery_id: delivery.insertId,
          ownership_transfer_id: transfer.insertId, handover_reference: reference,
          receiver, approved_by: userId });
      return { duplicate: false, transferNumber: ownershipNumber };
    });
    return res.status(saved.duplicate ? 200 : 201).json({
      status: "success", sold: true, ownership_status: "transferred",
      agreement_id: agreementId, transfer_number: saved.transferNumber,
      message: saved.duplicate
        ? "This Ready Cash machine was already marked sold; no duplicate transfer was recorded."
        : "Signed handover confirmed. Machine marked sold and ownership transfer recorded.",
    });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
