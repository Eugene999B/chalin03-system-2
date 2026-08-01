const crypto = require("node:crypto");
const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { nextDocumentNumber } = require("../services/groupConfigurationService");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { workspaceRoleFor } = require("../security/equipmentDivisionAccess");
const {
  FinanceDocumentsDeliveryError,
  completeDeliveryAuthorization,
  validateDeliveryAuthorization,
} = require("../services/equipmentFinanceDocumentsDeliveryService");

const router = express.Router();

const DELIVERY_CONFIRMATION_ROLES = new Set([
  "finance_accountant",
  "credit_officer",
  "collections_officer",
  "finance_manager",
  "equipment_business_accountant",
  "equipment_business_manager",
]);
const DELIVERY_CONDITIONS = new Set([
  "excellent",
  "good",
  "fair",
  "damaged",
  "under_inspection",
]);

function userId(req) {
  const number = Number(req.user?.id || 0);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 1000) {
  return cleanText(value, maxLength) || null;
}

function positiveId(value, label = "ID") {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new FinanceDocumentsDeliveryError(400, `${label} must be a positive whole number.`, "INVALID_IDENTIFIER");
  }
  return number;
}

function money(value, { minimum = 0, maximum = 1000000000 } = {}) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return undefined;
  const number = Number(text);
  return Number.isFinite(number) && number >= minimum && number <= maximum
    ? Number(number.toFixed(2))
    : undefined;
}

function percentage(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100
    ? Number(number.toFixed(2))
    : undefined;
}

function idempotencyKey(value) {
  const key = cleanText(value, 191);
  if (key.length < 20 || !key.startsWith("finance-delivery")) {
    throw new FinanceDocumentsDeliveryError(400, "A secure finance-delivery request key is required.", "FINANCE_IDEMPOTENCY_KEY_REQUIRED");
  }
  return key;
}

function roleAllowed(req) {
  return isOriginalSystemAdministrator(req.user) || DELIVERY_CONFIRMATION_ROLES.has(workspaceRoleFor(req.user));
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

async function nextFinanceNumber(sequence, prefix, actor) {
  try {
    return await nextDocumentNumber(sequence, { userId: actor || null });
  } catch {
    return `${prefix}-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${crypto
      .randomInt(0, 10000)
      .toString()
      .padStart(4, "0")}`;
  }
}

async function loadAccount(connection, agreementId) {
  const [rows] = await connection.query(
    `SELECT
       agreement.id AS agreement_id,
       agreement.agreement_number,
       agreement.credit_application_id AS application_id,
       agreement.customer_id,
       agreement.asset_id,
       agreement.hire_location_id,
       agreement.total_amount,
       agreement.amount_paid,
       agreement.outstanding_balance,
       agreement.deposit_required,
       agreement.deposit_received,
       agreement.delivery_policy,
       agreement.delivery_threshold_percent,
       agreement.equipment_commitment_status,
       application.application_number,
       customer.customer_name,
       customer.phone AS customer_phone,
       asset.asset_code,
       asset.asset_name,
       asset.current_meter,
       asset.is_active AS asset_is_active,
       (SELECT COUNT(*) FROM hire_contract_assets hire_asset
        WHERE hire_asset.asset_id = agreement.asset_id
          AND hire_asset.status IN ('assigned','dispatched','active')) AS active_hire_count
     FROM equipment_sale_agreements agreement
     INNER JOIN equipment_credit_applications application
       ON application.id = agreement.credit_application_id
     INNER JOIN hire_customers customer ON customer.id = agreement.customer_id
     INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
     WHERE agreement.id = ?
       AND agreement.sale_type = 'installment'
       AND agreement.activation_source = 'approved_credit_application'
     LIMIT 1 FOR UPDATE`,
    [agreementId]
  );
  return rows[0] || null;
}

function sendError(res, error) {
  const status = Number(error.statusCode || 500);
  return res.status(status).json({
    status: "error",
    code: error.code || "EQUIPMENT_FINANCE_PHASE5_DELIVERY_ERROR",
    message: error.message || "Could not complete controlled Finance delivery.",
    ...(error.readiness ? { readiness: error.readiness } : {}),
  });
}

router.post(
  "/accounts/:agreementId/delivery",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    if (!roleAllowed(req)) {
      return res.status(403).json({
        status: "error",
        code: "EQUIPMENT_FINANCE_DELIVERY_CONFIRMATION_ROLE_REQUIRED",
        message: "Controlled delivery confirmation is restricted to authorised Finance staff.",
      });
    }

    const connection = await pool.getConnection();
    try {
      const agreementId = positiveId(req.params.agreementId, "Agreement ID");
      const key = idempotencyKey(req.body?.idempotency_key);
      const condition = cleanText(req.body?.condition_status, 40).toLowerCase();
      const receivingPerson = cleanText(req.body?.receiving_person, 180);
      const meterReading = money(req.body?.meter_reading);
      const fuelLevel = percentage(req.body?.fuel_level_percent);
      if (!DELIVERY_CONDITIONS.has(condition) || !receivingPerson || meterReading === undefined || fuelLevel === undefined) {
        throw new FinanceDocumentsDeliveryError(
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
        const [confirmationRows] = await connection.query(
          "SELECT * FROM equipment_finance_delivery_confirmations WHERE delivery_id = ? LIMIT 1",
          [replayRows[0].id]
        );
        await connection.commit();
        return res.json({
          status: "success",
          replayed: true,
          delivery: replayRows[0],
          delivery_confirmation: confirmationRows[0] || null,
        });
      }

      const account = await loadAccount(connection, agreementId);
      if (!account) throw new FinanceDocumentsDeliveryError(404, "Finance agreement was not found.");
      if (!account.asset_is_active || Number(account.active_hire_count || 0) > 0) {
        throw new FinanceDocumentsDeliveryError(409, "The financed machine is inactive or active on Hire and cannot be handed over.", "EQUIPMENT_ACTIVE_ON_HIRE");
      }
      if (account.equipment_commitment_status !== "reserved") {
        throw new FinanceDocumentsDeliveryError(409, "The exact machine must be reserved before delivery.");
      }
      if (!deliveryAllowed(account)) {
        throw new FinanceDocumentsDeliveryError(409, "The approved payment threshold for delivery has not been reached.", "DELIVERY_PAYMENT_THRESHOLD_NOT_MET");
      }
      const [existing] = await connection.query(
        "SELECT id FROM equipment_deliveries WHERE agreement_id = ? LIMIT 1 FOR UPDATE",
        [agreementId]
      );
      if (existing.length) throw new FinanceDocumentsDeliveryError(409, "Delivery was already recorded.");

      const validated = await validateDeliveryAuthorization({
        connection,
        authorizationNumber: req.body?.authorization_number,
        agreementId,
        confirmerId: userId(req),
      });
      const deliveryNumber = await nextFinanceNumber("EQUIPMENT_SALE_DELIVERY", "ESD", userId(req));
      const [result] = await connection.query(
        `INSERT INTO equipment_deliveries (
           delivery_number, idempotency_key, hire_location_id, agreement_id,
           credit_application_id, handover_stage, customer_id, asset_id,
           delivery_datetime, destination, meter_reading, fuel_level_percent,
           condition_status, attachments_tools, receiving_person, receiving_phone,
           customer_signature_url, delivery_note_url, notes, status,
           created_by, approved_by, approved_at
         ) VALUES (?, ?, ?, ?, ?, 'finance_controlled', ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'delivered', ?, ?, NOW())`,
        [
          deliveryNumber,
          key,
          account.hire_location_id,
          account.agreement_id,
          account.application_id,
          account.customer_id,
          account.asset_id,
          nullableText(req.body?.destination, 255),
          meterReading,
          fuelLevel,
          condition,
          nullableText(req.body?.attachments_tools, 3000),
          receivingPerson,
          nullableText(req.body?.receiving_phone, 40),
          nullableText(req.body?.notes, 3000),
          userId(req),
          validated.authorization.authorized_by,
        ]
      );
      await connection.query(
        `UPDATE equipment_sale_agreements
         SET delivery_status = 'delivered', delivered_at = NOW(),
             controlled_delivery_completed_at = NOW(),
             controlled_delivery_completed_by = ?
         WHERE id = ?`,
        [userId(req), account.agreement_id]
      );
      if (meterReading > Number(account.current_meter || 0)) {
        await connection.query(
          "UPDATE fleet_assets SET current_meter = ?, updated_by = ? WHERE id = ?",
          [meterReading, userId(req), account.asset_id]
        );
      }
      const confirmation = await completeDeliveryAuthorization({
        connection,
        authorization: validated.authorization,
        financeCase: validated.financeCase,
        deliveryId: result.insertId,
        confirmationInput: {
          receiving_person: receivingPerson,
          receiving_phone: req.body?.receiving_phone,
          destination: req.body?.destination,
          condition_status: condition,
          meter_reading: meterReading,
          fuel_level_percent: fuelLevel,
          customer_signature_document_id: req.body?.customer_signature_document_id,
          delivery_note_document_id: req.body?.delivery_note_document_id,
          notes: req.body?.notes,
        },
        actor: userId(req),
        req,
      });
      await writeAuditEvent({
        connection,
        req,
        action: "EQUIPMENT_FINANCE_DELIVERY_COMPLETED",
        details: `Completed authorized Finance delivery ${deliveryNumber}.`,
        workspaceCode: "equipment_hire",
        hireLocationId: account.hire_location_id,
        entityType: "equipment_delivery",
        entityId: result.insertId,
        metadata: {
          agreement_id: account.agreement_id,
          asset_id: account.asset_id,
          authorization_number: validated.authorization.authorization_number,
          confirmation_number: confirmation.confirmationNumber,
          handover_stage: "finance_controlled",
        },
      });
      await connection.commit();
      return res.status(201).json({
        status: "success",
        message: "Authorized Finance delivery and independent handover confirmation recorded.",
        delivery_id: result.insertId,
        delivery_number: deliveryNumber,
        authorization_number: validated.authorization.authorization_number,
        confirmation_id: confirmation.confirmationId,
        confirmation_number: confirmation.confirmationNumber,
        automatic_sms_sent: false,
        sms: { sent: false, automatic: false },
      });
    } catch (error) {
      try { await connection.rollback(); } catch {}
      return sendError(res, error);
    } finally {
      connection.release();
    }
  }
);

module.exports = router;
module.exports.DELIVERY_CONFIRMATION_ROLES = DELIVERY_CONFIRMATION_ROLES;
module.exports.deliveryAllowed = deliveryAllowed;
