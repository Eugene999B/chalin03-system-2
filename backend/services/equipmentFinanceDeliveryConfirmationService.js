const crypto = require("node:crypto");

const { pool } = require("../config/db");
const { nextDocumentNumber } = require("./groupConfigurationService");
const { writeAuditEvent } = require("./auditTrailService");
const {
  assertFinanceMutationSafe,
  refreshFinanceAgreementFromEvidence,
} = require("./equipmentFinanceReconciliationService");
const {
  FinancePrivateDocumentError,
  recordActivity,
} = require("./equipmentFinancePrivateDocumentsService");
const {
  getReviewPolicy,
  listReviewDocuments,
  requiredDocumentStatus,
} = require("./equipmentFinanceDocumentReviewService");
const {
  assertAuthorizationSchema,
  assertDeliveryEligibility,
  buildSnapshot,
  getAuthorizationPolicy,
  loadAuthorizationCase,
  snapshotChecksum,
} = require("./equipmentFinanceDeliveryAuthorizationService");

const DELIVERY_CONDITIONS = new Set([
  "excellent",
  "good",
  "fair",
  "damaged",
  "under_inspection",
]);

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 1000) {
  return cleanText(value, maxLength) || null;
}

function positiveId(value, label = "ID") {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new FinancePrivateDocumentError(
      400,
      `${label} must be a positive whole number.`,
      "INVALID_IDENTIFIER"
    );
  }
  return number;
}

function actorId(value) {
  const number = Number(value || 0);
  if (!Number.isInteger(number) || number <= 0) {
    throw new FinancePrivateDocumentError(
      401,
      "An authenticated delivery confirmer is required.",
      "FINANCE_DELIVERY_CONFIRMER_REQUIRED"
    );
  }
  return number;
}

function decimal(value, { minimum = 0, maximum = 1000000000 } = {}) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return undefined;
  const number = Number(text);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    return undefined;
  }
  return Number(number.toFixed(2));
}

function percentage(value) {
  return decimal(value, { minimum: 0, maximum: 100 });
}

function idempotencyKey(value) {
  const key = cleanText(value, 191);
  if (key.length < 20 || !key.startsWith("finance-delivery-")) {
    throw new FinancePrivateDocumentError(
      400,
      "A secure finance-delivery idempotency key is required.",
      "FINANCE_DELIVERY_IDEMPOTENCY_KEY_REQUIRED"
    );
  }
  return key;
}

async function assertConfirmationSchema(connection = pool) {
  await assertAuthorizationSchema(connection);
  const [[table]] = await connection.query(
    `SELECT COUNT(*) AS present
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'equipment_finance_delivery_confirmations'`
  );
  const [columns] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND (
          (TABLE_NAME = 'equipment_finance_document_delivery_policy'
           AND COLUMN_NAME IN ('delivery_confirmation_policy_version','independent_delivery_confirmation_required'))
          OR
          (TABLE_NAME = 'equipment_sale_agreements'
           AND COLUMN_NAME IN ('controlled_delivery_completed_at','controlled_delivery_completed_by'))
        )`
  );
  if (Number(table?.present || 0) !== 1 || columns.length !== 4) {
    throw new FinancePrivateDocumentError(
      503,
      "Finance delivery confirmation is awaiting the approved additive Phase 5D migration.",
      "EQUIPMENT_FINANCE_PHASE5D_MIGRATION_REQUIRED"
    );
  }
}

async function confirmationPolicy(connection = pool) {
  await assertConfirmationSchema(connection);
  const [rows] = await connection.query(
    `SELECT delivery_confirmation_policy_version,
            independent_delivery_confirmation_required
       FROM equipment_finance_document_delivery_policy
      WHERE id = 1 LIMIT 1`
  );
  const row = rows[0];
  if (
    !row ||
    Number(row.independent_delivery_confirmation_required || 0) !== 1
  ) {
    throw new FinancePrivateDocumentError(
      503,
      "The independent delivery confirmation policy is invalid.",
      "FINANCE_DELIVERY_CONFIRMATION_POLICY_INVALID"
    );
  }
  return {
    policy_version: row.delivery_confirmation_policy_version,
    independent_delivery_confirmation_required: true,
  };
}

async function nextFinanceNumber(sequence, prefix, actor) {
  try {
    return await nextDocumentNumber(sequence, { userId: actor });
  } catch {
    return `${prefix}-${new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, "")
      .slice(0, 14)}-${crypto
      .randomInt(0, 1000000)
      .toString()
      .padStart(6, "0")}`;
  }
}

async function loadLiveAuthorization(connection, agreementId) {
  await connection.query(
    `UPDATE equipment_finance_delivery_authorizations
        SET authorization_status = 'expired'
      WHERE agreement_id = ?
        AND authorization_status = 'authorized'
        AND expires_at <= NOW()`,
    [positiveId(agreementId, "Agreement ID")]
  );
  const [rows] = await connection.query(
    `SELECT *
       FROM equipment_finance_delivery_authorizations
      WHERE agreement_id = ?
        AND authorization_status = 'authorized'
        AND expires_at > NOW()
      ORDER BY decided_at DESC, id DESC
      LIMIT 2 FOR UPDATE`,
    [agreementId]
  );
  if (rows.length !== 1) {
    throw new FinancePrivateDocumentError(
      409,
      rows.length
        ? "More than one live authorization exists; delivery is blocked for review."
        : "A live independent delivery authorization is required.",
      rows.length
        ? "FINANCE_DELIVERY_MULTIPLE_AUTHORIZATIONS"
        : "FINANCE_DELIVERY_AUTHORIZATION_REQUIRED"
    );
  }
  return rows[0];
}

function confirmationInput(input) {
  const condition = cleanText(input?.condition_status, 40).toLowerCase();
  const receivingPerson = cleanText(input?.receiving_person, 180);
  const meterReading = decimal(input?.meter_reading);
  const fuelLevel = percentage(input?.fuel_level_percent);
  if (
    !DELIVERY_CONDITIONS.has(condition) ||
    !receivingPerson ||
    meterReading === undefined ||
    fuelLevel === undefined
  ) {
    throw new FinancePrivateDocumentError(
      400,
      "Enter the receiving person, machine condition, meter reading and fuel level.",
      "FINANCE_DELIVERY_CONFIRMATION_INPUT_INVALID"
    );
  }
  return {
    condition_status: condition,
    receiving_person: receivingPerson,
    receiving_phone: nullableText(input?.receiving_phone, 40),
    destination: nullableText(input?.destination, 255),
    meter_reading: meterReading,
    fuel_level_percent: fuelLevel,
    attachments_tools: nullableText(input?.attachments_tools, 3000),
    customer_signature_document_id: input?.customer_signature_document_id
      ? positiveId(input.customer_signature_document_id, "Signature document ID")
      : null,
    delivery_note_document_id: input?.delivery_note_document_id
      ? positiveId(input.delivery_note_document_id, "Delivery note document ID")
      : null,
    notes: nullableText(input?.notes, 3000),
  };
}

function storedAuthorizationSnapshot(authorization, policy) {
  let documents;
  let financial;
  try {
    documents = JSON.parse(authorization.document_snapshot_json);
    financial = JSON.parse(authorization.financial_snapshot_json);
  } catch {
    throw new FinancePrivateDocumentError(
      409,
      "The delivery authorization snapshot is unreadable.",
      "FINANCE_DELIVERY_AUTHORIZATION_SNAPSHOT_INVALID"
    );
  }
  return {
    policy,
    documents,
    financial,
  };
}

async function assertCurrentAuthorizationSnapshot({
  connection,
  authorization,
  financeCase,
}) {
  if (
    Number(authorization.application_id) !== financeCase.application_id ||
    Number(authorization.asset_id) !== financeCase.asset_id ||
    Number(authorization.customer_id) !== financeCase.customer_id
  ) {
    throw new FinancePrivateDocumentError(
      409,
      "The agreement, customer or exact equipment linkage changed after authorization.",
      "FINANCE_DELIVERY_AUTHORIZATION_LINKAGE_STALE"
    );
  }
  const authorizationPolicy = await getAuthorizationPolicy(connection);
  const reviewPolicy = await getReviewPolicy(connection);
  const documents = await listReviewDocuments(
    connection,
    financeCase.agreement_id,
    { lock: true }
  );
  const readiness = requiredDocumentStatus(reviewPolicy, documents);
  if (!readiness.complete) {
    throw new FinancePrivateDocumentError(
      409,
      "Required documents are no longer fully approved.",
      "FINANCE_DELIVERY_DOCUMENTS_INCOMPLETE"
    );
  }
  assertDeliveryEligibility(financeCase);
  const current = buildSnapshot({
    authorizationPolicy,
    financeCase,
    documents,
  });
  const stored = storedAuthorizationSnapshot(
    authorization,
    authorizationPolicy
  );
  if (
    current.checksum !== authorization.snapshot_checksum ||
    snapshotChecksum(stored) !== authorization.snapshot_checksum
  ) {
    throw new FinancePrivateDocumentError(
      409,
      "The approved documents, balance, reservation or delivery policy changed after authorization.",
      "FINANCE_DELIVERY_AUTHORIZATION_STALE"
    );
  }
}

async function confirmAuthorizedDelivery({ agreementId, input, actor, req }) {
  const confirmer = actorId(actor);
  const key = idempotencyKey(input?.idempotency_key);
  const details = confirmationInput(input);
  const connection = await pool.getConnection();
  try {
    await assertConfirmationSchema(connection);
    await connection.beginTransaction();

    const [replays] = await connection.query(
      `SELECT delivery.*
         FROM equipment_deliveries delivery
        WHERE delivery.idempotency_key = ?
        LIMIT 1 FOR UPDATE`,
      [key]
    );
    if (replays.length) {
      const [confirmations] = await connection.query(
        `SELECT * FROM equipment_finance_delivery_confirmations
          WHERE delivery_id = ? LIMIT 1`,
        [replays[0].id]
      );
      await connection.commit();
      return {
        replayed: true,
        delivery: replays[0],
        confirmation: confirmations[0] || null,
      };
    }

    const financeCase = await loadAuthorizationCase(connection, agreementId, {
      lock: true,
    });
    await assertFinanceMutationSafe(financeCase.agreement_id, {
      connection,
      lock: false,
    });
    const [existing] = await connection.query(
      `SELECT id FROM equipment_deliveries
        WHERE agreement_id = ? LIMIT 1 FOR UPDATE`,
      [financeCase.agreement_id]
    );
    if (existing.length) {
      throw new FinancePrivateDocumentError(
        409,
        "Delivery was already recorded for this agreement.",
        "FINANCE_DELIVERY_ALREADY_RECORDED"
      );
    }

    const authorization = await loadLiveAuthorization(
      connection,
      financeCase.agreement_id
    );
    if (
      input?.authorization_number &&
      cleanText(input.authorization_number, 120) !==
        authorization.authorization_number
    ) {
      throw new FinancePrivateDocumentError(
        409,
        "The supplied authorization reference does not match the server-selected live authorization.",
        "FINANCE_DELIVERY_AUTHORIZATION_REFERENCE_MISMATCH"
      );
    }
    if (Number(authorization.decided_by) === confirmer) {
      throw new FinancePrivateDocumentError(
        409,
        "The manager who authorized delivery cannot also confirm physical handover.",
        "FINANCE_DELIVERY_INDEPENDENT_CONFIRMATION_REQUIRED"
      );
    }
    await assertCurrentAuthorizationSnapshot({
      connection,
      authorization,
      financeCase,
    });
    const policy = await confirmationPolicy(connection);
    const deliveryNumber = await nextFinanceNumber(
      "EQUIPMENT_SALE_DELIVERY",
      "ESD",
      confirmer
    );
    const confirmationNumber = await nextFinanceNumber(
      "EQUIPMENT_FINANCE_DELIVERY_CONFIRMATION",
      "FDC",
      confirmer
    );

    const [deliveryResult] = await connection.query(
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
        financeCase.hire_location_id || null,
        financeCase.agreement_id,
        financeCase.application_id,
        financeCase.customer_id,
        financeCase.asset_id,
        details.destination,
        details.meter_reading,
        details.fuel_level_percent,
        details.condition_status,
        details.attachments_tools,
        details.receiving_person,
        details.receiving_phone,
        details.notes,
        confirmer,
        authorization.decided_by,
      ]
    );

    const confirmationSnapshot = {
      policy_version: policy.policy_version,
      authorization_number: authorization.authorization_number,
      authorization_snapshot_checksum: authorization.snapshot_checksum,
      agreement_id: financeCase.agreement_id,
      application_id: financeCase.application_id,
      asset_id: financeCase.asset_id,
      customer_id: financeCase.customer_id,
      delivery_number: deliveryNumber,
      ...details,
      confirmed_by: confirmer,
    };
    const confirmationChecksum = snapshotChecksum(confirmationSnapshot);
    const [confirmationResult] = await connection.query(
      `INSERT INTO equipment_finance_delivery_confirmations (
         confirmation_number, authorization_id, delivery_id, agreement_id,
         application_id, asset_id, customer_id, receiving_person,
         receiving_phone, destination, condition_status, meter_reading,
         fuel_level_percent, attachments_tools,
         customer_signature_document_id, delivery_note_document_id,
         confirmation_snapshot_json, confirmation_checksum, notes, confirmed_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        confirmationNumber,
        authorization.id,
        deliveryResult.insertId,
        financeCase.agreement_id,
        financeCase.application_id,
        financeCase.asset_id,
        financeCase.customer_id,
        details.receiving_person,
        details.receiving_phone,
        details.destination,
        details.condition_status,
        details.meter_reading,
        details.fuel_level_percent,
        details.attachments_tools,
        details.customer_signature_document_id,
        details.delivery_note_document_id,
        JSON.stringify(confirmationSnapshot),
        confirmationChecksum,
        details.notes,
        confirmer,
      ]
    );

    await connection.query(
      `UPDATE equipment_finance_delivery_authorizations
          SET authorization_status = 'consumed', consumed_by = ?,
              consumed_at = NOW(), delivery_id = ?
        WHERE id = ? AND authorization_status = 'authorized'`,
      [confirmer, deliveryResult.insertId, authorization.id]
    );
    await connection.query(
      `UPDATE equipment_sale_agreements
          SET delivery_status = 'delivered', delivered_at = NOW(),
              controlled_delivery_completed_at = NOW(),
              controlled_delivery_completed_by = ?
        WHERE id = ?`,
      [confirmer, financeCase.agreement_id]
    );
    await refreshFinanceAgreementFromEvidence(connection, financeCase.agreement_id);
    if (details.meter_reading > Number(financeCase.current_meter || 0)) {
      await connection.query(
        `UPDATE fleet_assets SET current_meter = ?, updated_by = ? WHERE id = ?`,
        [details.meter_reading, confirmer, financeCase.asset_id]
      );
    }

    await recordActivity({
      connection,
      req,
      actionType: "delivery_confirmed",
      actor: confirmer,
      description: `Confirmed authorized physical delivery ${confirmationNumber} for ${financeCase.agreement_number}.`,
      applicationId: financeCase.application_id,
      agreementId: financeCase.agreement_id,
      metadata: {
        authorization_id: authorization.id,
        authorization_number: authorization.authorization_number,
        delivery_id: deliveryResult.insertId,
        delivery_number: deliveryNumber,
        confirmation_id: confirmationResult.insertId,
        confirmation_number: confirmationNumber,
        confirmation_checksum: confirmationChecksum,
      },
    });
    await writeAuditEvent({
      connection,
      req,
      action: "EQUIPMENT_FINANCE_DELIVERY_COMPLETED",
      details: `Completed authorized Finance delivery ${deliveryNumber}.`,
      workspaceCode: "equipment_installment_finance",
      hireLocationId: financeCase.hire_location_id || null,
      entityType: "equipment_delivery",
      entityId: deliveryResult.insertId,
      metadata: {
        agreement_id: financeCase.agreement_id,
        asset_id: financeCase.asset_id,
        authorization_number: authorization.authorization_number,
        confirmation_number: confirmationNumber,
        handover_stage: "finance_controlled",
      },
    });
    await connection.commit();
    return {
      replayed: false,
      delivery_id: deliveryResult.insertId,
      delivery_number: deliveryNumber,
      authorization_id: authorization.id,
      authorization_number: authorization.authorization_number,
      confirmation_id: confirmationResult.insertId,
      confirmation_number: confirmationNumber,
      confirmation_checksum: confirmationChecksum,
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

module.exports = {
  DELIVERY_CONDITIONS,
  assertConfirmationSchema,
  assertCurrentAuthorizationSnapshot,
  confirmationInput,
  confirmationPolicy,
  confirmAuthorizedDelivery,
  idempotencyKey,
  loadLiveAuthorization,
  storedAuthorizationSnapshot,
};
