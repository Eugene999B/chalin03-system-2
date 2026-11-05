const crypto = require("node:crypto");

const { pool } = require("../config/db");
const {
  FinancePrivateDocumentError,
  recordActivity,
} = require("./equipmentFinancePrivateDocumentsService");
const {
  assertReviewSchema,
  getReviewPolicy,
  listReviewDocuments,
  requiredDocumentStatus,
} = require("./equipmentFinanceDocumentReviewService");

const AUTHORIZATION_DECISIONS = new Set(["authorize", "reject"]);
const AUTHORIZATION_STATUSES = new Set([
  "pending",
  "authorized",
  "rejected",
  "revoked",
  "expired",
  "consumed",
]);

function cleanText(value, maxLength = 1500) {
  return String(value ?? "").trim().slice(0, maxLength);
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
      "An authenticated staff identity is required.",
      "FINANCE_DELIVERY_AUTHENTICATED_ACTOR_REQUIRED"
    );
  }
  return number;
}

function safeJson(value, fallback) {
  try {
    return (typeof value === "string" ? JSON.parse(value) : value) ?? fallback;
  } catch {
    return fallback;
  }
}

function money(value) {
  return Number(Number(value || 0).toFixed(2));
}

function referenceNumber(prefix) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  return `${prefix}-${timestamp}-${crypto
    .randomInt(0, 1000000)
    .toString()
    .padStart(6, "0")}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function snapshotChecksum(snapshot) {
  return crypto.createHash("sha256").update(stableJson(snapshot)).digest("hex");
}

async function assertAuthorizationSchema(connection = pool) {
  await assertReviewSchema(connection);
  const [[table]] = await connection.query(
    `SELECT COUNT(*) AS present
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'equipment_finance_delivery_authorizations'`
  );
  const [columns] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'equipment_finance_document_delivery_policy'
        AND COLUMN_NAME IN (
          'delivery_authorization_policy_version',
          'independent_delivery_authorization_required',
          'delivery_authorization_valid_hours'
        )`
  );
  if (Number(table?.present || 0) !== 1 || columns.length !== 3) {
    throw new FinancePrivateDocumentError(
      503,
      "Finance delivery authorization is awaiting the approved additive Phase 5C migration.",
      "EQUIPMENT_FINANCE_PHASE5C_MIGRATION_REQUIRED"
    );
  }
}

async function getAuthorizationPolicy(connection = pool) {
  await assertAuthorizationSchema(connection);
  const [rows] = await connection.query(
    `SELECT delivery_authorization_policy_version,
            independent_delivery_authorization_required,
            delivery_authorization_valid_hours
       FROM equipment_finance_document_delivery_policy
      WHERE id = 1 LIMIT 1`
  );
  const row = rows[0];
  if (!row) {
    throw new FinancePrivateDocumentError(
      503,
      "The Finance delivery authorization policy is missing.",
      "FINANCE_DELIVERY_AUTHORIZATION_POLICY_MISSING"
    );
  }
  const validHours = Number(row.delivery_authorization_valid_hours || 0);
  if (
    Number(row.independent_delivery_authorization_required || 0) !== 1 ||
    validHours < 1 ||
    validHours > 168
  ) {
    throw new FinancePrivateDocumentError(
      503,
      "The Finance delivery authorization policy is invalid.",
      "FINANCE_DELIVERY_AUTHORIZATION_POLICY_INVALID"
    );
  }
  return {
    policy_version: row.delivery_authorization_policy_version,
    independent_delivery_authorization_required: true,
    delivery_authorization_valid_hours: validHours,
  };
}

async function loadAuthorizationCase(
  connection,
  agreementId,
  { lock = false } = {}
) {
  const [rows] = await connection.query(
    `SELECT
       agreement.id AS agreement_id,
       agreement.agreement_number,
       agreement.agreement_status,
       agreement.credit_application_id AS application_id,
       agreement.customer_id,
       agreement.asset_id,
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
       asset.sale_status AS asset_sale_status,
       asset.is_active AS asset_is_active,
       (SELECT COUNT(*)
          FROM hire_contract_assets hire_asset
         WHERE hire_asset.asset_id = agreement.asset_id
           AND hire_asset.status IN ('assigned','dispatched','active')) AS active_hire_count,
       (SELECT COUNT(*)
          FROM equipment_deliveries delivery
         WHERE delivery.agreement_id = agreement.id) AS delivery_count
     FROM equipment_sale_agreements agreement
     INNER JOIN equipment_credit_applications application
       ON application.id = agreement.credit_application_id
     INNER JOIN hire_customers customer
       ON customer.id = agreement.customer_id
     INNER JOIN fleet_assets asset
       ON asset.id = agreement.asset_id
     WHERE agreement.id = ?
       AND agreement.sale_type = 'installment'
       AND agreement.activation_source = 'approved_credit_application'
     LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [positiveId(agreementId, "Agreement ID")]
  );
  if (!rows[0]) {
    throw new FinancePrivateDocumentError(
      404,
      "Finance agreement was not found.",
      "FINANCE_CASE_NOT_FOUND"
    );
  }
  const row = rows[0];
  return {
    ...row,
    agreement_id: Number(row.agreement_id),
    application_id: Number(row.application_id),
    customer_id: Number(row.customer_id),
    asset_id: Number(row.asset_id),
    total_amount: money(row.total_amount),
    amount_paid: money(row.amount_paid),
    outstanding_balance: money(row.outstanding_balance),
    deposit_required: money(row.deposit_required),
    deposit_received: money(row.deposit_received),
    delivery_threshold_percent: Number(row.delivery_threshold_percent || 0),
    asset_is_active: Number(row.asset_is_active || 0) === 1,
    active_hire_count: Number(row.active_hire_count || 0),
    delivery_count: Number(row.delivery_count || 0),
  };
}

function financialSnapshot(financeCase) {
  return {
    agreement_id: financeCase.agreement_id,
    application_id: financeCase.application_id,
    asset_id: financeCase.asset_id,
    customer_id: financeCase.customer_id,
    agreement_status: financeCase.agreement_status,
    equipment_commitment_status: financeCase.equipment_commitment_status,
    total_amount: money(financeCase.total_amount),
    amount_paid: money(financeCase.amount_paid),
    outstanding_balance: money(financeCase.outstanding_balance),
    deposit_required: money(financeCase.deposit_required),
    deposit_received: money(financeCase.deposit_received),
    delivery_policy: financeCase.delivery_policy,
    delivery_threshold_percent: Number(
      financeCase.delivery_threshold_percent || 0
    ),
    active_hire_count: Number(financeCase.active_hire_count || 0),
    delivery_count: Number(financeCase.delivery_count || 0),
    asset_sale_status: financeCase.asset_sale_status,
    asset_is_active: Boolean(financeCase.asset_is_active),
  };
}

function approvedDocumentSnapshot(documents) {
  return documents
    .filter(
      (document) =>
        document.document_status === "active" &&
        document.review_status === "verified" &&
        document.approval_status === "approved"
    )
    .map((document) => ({
      id: Number(document.id),
      document_number: document.document_number,
      category: document.document_category,
      checksum: document.content_checksum,
      reviewed_by: Number(document.reviewed_by),
      approved_by: Number(document.approved_by),
    }))
    .sort((left, right) => left.id - right.id);
}

function deliveryThreshold(financeCase) {
  const policy = cleanText(financeCase.delivery_policy, 80).toLowerCase();
  const paidPercent =
    financeCase.total_amount > 0
      ? Number(
          ((financeCase.amount_paid / financeCase.total_amount) * 100).toFixed(2)
        )
      : 0;
  if (["after_deposit", "deposit"].includes(policy)) {
    return {
      satisfied:
        financeCase.deposit_received + 0.005 >= financeCase.deposit_required,
      explanation: "Required opening deposit must be fully received.",
      paid_percent: paidPercent,
    };
  }
  if (["after_full_payment", "full_payment"].includes(policy)) {
    return {
      satisfied: financeCase.outstanding_balance <= 0.005,
      explanation: "The agreement must be fully paid before delivery.",
      paid_percent: paidPercent,
    };
  }
  if (
    ["after_percentage", "threshold_percentage", "percentage"].includes(policy)
  ) {
    return {
      satisfied:
        paidPercent + 0.005 >=
        Number(financeCase.delivery_threshold_percent || 0),
      explanation: `At least ${Number(
        financeCase.delivery_threshold_percent || 0
      )}% must be paid before delivery.`,
      paid_percent: paidPercent,
    };
  }
  return {
    satisfied: false,
    explanation:
      "The agreement has an unsupported delivery policy and requires correction before authorization.",
    paid_percent: paidPercent,
  };
}

function assertDeliveryEligibility(financeCase) {
  if (!new Set(["active", "approved"]).has(financeCase.agreement_status)) {
    throw new FinancePrivateDocumentError(
      409,
      "Only an approved or active installment agreement can request delivery authorization.",
      "FINANCE_DELIVERY_AGREEMENT_NOT_ACTIVE"
    );
  }
  if (financeCase.equipment_commitment_status !== "reserved") {
    throw new FinancePrivateDocumentError(
      409,
      "The exact financed equipment must be reserved before delivery authorization.",
      "FINANCE_DELIVERY_ASSET_NOT_RESERVED"
    );
  }
  if (!financeCase.asset_is_active) {
    throw new FinancePrivateDocumentError(
      409,
      "The exact financed equipment is inactive.",
      "FINANCE_DELIVERY_ASSET_INACTIVE"
    );
  }
  if (financeCase.active_hire_count > 0) {
    throw new FinancePrivateDocumentError(
      409,
      "The exact financed equipment is active on a Hire contract.",
      "FINANCE_DELIVERY_ASSET_ON_HIRE"
    );
  }
  if (financeCase.delivery_count > 0) {
    throw new FinancePrivateDocumentError(
      409,
      "Delivery has already been recorded for this agreement.",
      "FINANCE_DELIVERY_ALREADY_RECORDED"
    );
  }
  const threshold = deliveryThreshold(financeCase);
  if (!threshold.satisfied) {
    throw new FinancePrivateDocumentError(
      409,
      threshold.explanation,
      "FINANCE_DELIVERY_FINANCIAL_THRESHOLD_NOT_MET"
    );
  }
  return threshold;
}

function buildSnapshot({ authorizationPolicy, financeCase, documents }) {
  const snapshot = {
    policy: authorizationPolicy,
    financial: financialSnapshot(financeCase),
    documents: approvedDocumentSnapshot(documents),
  };
  return { snapshot, checksum: snapshotChecksum(snapshot) };
}

function effectiveStatus(row) {
  if (
    row.authorization_status === "authorized" &&
    row.expires_at &&
    new Date(row.expires_at).getTime() <= Date.now()
  ) {
    return "expired";
  }
  return row.authorization_status;
}

function publicAuthorization(row) {
  const status = effectiveStatus(row);
  return {
    id: Number(row.id),
    authorization_number: row.authorization_number,
    agreement_id: Number(row.agreement_id),
    application_id: Number(row.application_id),
    asset_id: Number(row.asset_id),
    customer_id: Number(row.customer_id),
    authorization_status: row.authorization_status,
    effective_status: status,
    policy_version: row.policy_version,
    snapshot_checksum: row.snapshot_checksum,
    request_reason: row.request_reason,
    requested_by: row.requested_by,
    requested_by_name: row.requested_by_name || null,
    requested_at: row.requested_at,
    decided_by: row.decided_by,
    decided_by_name: row.decided_by_name || null,
    decided_at: row.decided_at,
    decision_reason: row.decision_reason,
    expires_at: row.expires_at,
    revoked_by: row.revoked_by,
    revoked_by_name: row.revoked_by_name || null,
    revoked_at: row.revoked_at,
    revocation_reason: row.revocation_reason,
    can_be_used_for_delivery: status === "authorized",
  };
}

async function listAuthorizations(connection, agreementId, { lock = false } = {}) {
  const [rows] = await connection.query(
    `SELECT authorization.*,
            requester.full_name AS requested_by_name,
            decider.full_name AS decided_by_name,
            revoker.full_name AS revoked_by_name
       FROM equipment_finance_delivery_authorizations authorization
       LEFT JOIN users requester ON requester.id = authorization.requested_by
       LEFT JOIN users decider ON decider.id = authorization.decided_by
       LEFT JOIN users revoker ON revoker.id = authorization.revoked_by
      WHERE authorization.agreement_id = ?
      ORDER BY authorization.requested_at DESC, authorization.id DESC
      ${lock ? "FOR UPDATE" : ""}`,
    [positiveId(agreementId, "Agreement ID")]
  );
  return rows.map(publicAuthorization);
}

async function getAuthorizationCaseFile(agreementId) {
  await assertAuthorizationSchema();
  const financeCase = await loadAuthorizationCase(pool, agreementId);
  const [authorizationPolicy, reviewPolicy, documents, authorizations] =
    await Promise.all([
      getAuthorizationPolicy(pool),
      getReviewPolicy(pool),
      listReviewDocuments(pool, agreementId),
      listAuthorizations(pool, agreementId),
    ]);
  return {
    case: financeCase,
    authorization_policy: authorizationPolicy,
    document_readiness: requiredDocumentStatus(reviewPolicy, documents),
    delivery_threshold: deliveryThreshold(financeCase),
    authorizations,
  };
}

async function requestDeliveryAuthorization({ agreementId, reason, actor, req }) {
  const requestReason = cleanText(reason);
  if (!requestReason) {
    throw new FinancePrivateDocumentError(
      400,
      "Enter the reason for requesting delivery authorization.",
      "FINANCE_DELIVERY_AUTHORIZATION_REASON_REQUIRED"
    );
  }
  const requester = actorId(actor);
  const connection = await pool.getConnection();
  try {
    await assertAuthorizationSchema(connection);
    await connection.beginTransaction();
    const financeCase = await loadAuthorizationCase(connection, agreementId, {
      lock: true,
    });
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
        `Delivery authorization requires approved documents: ${readiness.missing.join(
          ", "
        )}.`,
        "FINANCE_DELIVERY_DOCUMENTS_INCOMPLETE"
      );
    }
    assertDeliveryEligibility(financeCase);

    await connection.query(
      `UPDATE equipment_finance_delivery_authorizations
          SET authorization_status = 'expired'
        WHERE agreement_id = ?
          AND authorization_status = 'authorized'
          AND expires_at IS NOT NULL
          AND expires_at <= NOW()`,
      [financeCase.agreement_id]
    );
    const [activeRows] = await connection.query(
      `SELECT id
         FROM equipment_finance_delivery_authorizations
        WHERE agreement_id = ?
          AND authorization_status IN ('pending','authorized')
        LIMIT 1 FOR UPDATE`,
      [financeCase.agreement_id]
    );
    if (activeRows.length) {
      throw new FinancePrivateDocumentError(
        409,
        "An active delivery authorization already exists for this agreement.",
        "FINANCE_DELIVERY_AUTHORIZATION_ALREADY_ACTIVE"
      );
    }

    const authorizationNumber = referenceNumber("FDA");
    const { snapshot, checksum } = buildSnapshot({
      authorizationPolicy,
      financeCase,
      documents,
    });
    const [result] = await connection.query(
      `INSERT INTO equipment_finance_delivery_authorizations (
         authorization_number, agreement_id, application_id, asset_id,
         customer_id, policy_version, document_snapshot_json,
         financial_snapshot_json, snapshot_checksum, request_reason,
         requested_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        authorizationNumber,
        financeCase.agreement_id,
        financeCase.application_id,
        financeCase.asset_id,
        financeCase.customer_id,
        authorizationPolicy.policy_version,
        JSON.stringify(snapshot.documents),
        JSON.stringify(snapshot.financial),
        checksum,
        requestReason,
        requester,
      ]
    );
    await recordActivity({
      connection,
      req,
      actionType: "delivery_authorization_requested",
      actor: requester,
      description: `Requested delivery authorization ${authorizationNumber} for ${financeCase.agreement_number}.`,
      applicationId: financeCase.application_id,
      agreementId: financeCase.agreement_id,
      metadata: {
        authorization_id: result.insertId,
        authorization_number: authorizationNumber,
        asset_id: financeCase.asset_id,
        customer_id: financeCase.customer_id,
        snapshot_checksum: checksum,
        reason: requestReason,
      },
    });
    await connection.commit();
    return getAuthorizationCaseFile(financeCase.agreement_id);
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

async function decideDeliveryAuthorization({
  authorizationId,
  decision,
  reason,
  actor,
  req,
}) {
  const normalized = cleanText(decision, 20).toLowerCase();
  const decisionReason = cleanText(reason);
  if (!AUTHORIZATION_DECISIONS.has(normalized) || !decisionReason) {
    throw new FinancePrivateDocumentError(
      400,
      "Choose authorize or reject and enter an independent decision reason.",
      "FINANCE_DELIVERY_AUTHORIZATION_DECISION_INVALID"
    );
  }
  const decider = actorId(actor);
  const connection = await pool.getConnection();
  try {
    await assertAuthorizationSchema(connection);
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT *
         FROM equipment_finance_delivery_authorizations
        WHERE id = ? LIMIT 1 FOR UPDATE`,
      [positiveId(authorizationId, "Authorization ID")]
    );
    const authorization = rows[0];
    if (!authorization) {
      throw new FinancePrivateDocumentError(
        404,
        "Delivery authorization request was not found.",
        "FINANCE_DELIVERY_AUTHORIZATION_NOT_FOUND"
      );
    }
    if (authorization.authorization_status !== "pending") {
      throw new FinancePrivateDocumentError(
        409,
        "This delivery authorization was already decided.",
        "FINANCE_DELIVERY_AUTHORIZATION_ALREADY_DECIDED"
      );
    }
    if (Number(authorization.requested_by) === decider) {
      throw new FinancePrivateDocumentError(
        409,
        "The staff member who requested delivery cannot authorize it.",
        "FINANCE_DELIVERY_INDEPENDENT_AUTHORIZER_REQUIRED"
      );
    }

    const financeCase = await loadAuthorizationCase(
      connection,
      authorization.agreement_id,
      { lock: true }
    );
    if (
      financeCase.application_id !== Number(authorization.application_id) ||
      financeCase.asset_id !== Number(authorization.asset_id) ||
      financeCase.customer_id !== Number(authorization.customer_id)
    ) {
      throw new FinancePrivateDocumentError(
        409,
        "The agreement, customer or exact equipment linkage changed after the request.",
        "FINANCE_DELIVERY_AUTHORIZATION_LINKAGE_STALE"
      );
    }

    if (normalized === "authorize") {
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
          "Required documents are no longer fully approved. Prepare a fresh request.",
          "FINANCE_DELIVERY_DOCUMENTS_INCOMPLETE"
        );
      }
      assertDeliveryEligibility(financeCase);
      const current = buildSnapshot({
        authorizationPolicy,
        financeCase,
        documents,
      });
      const storedSnapshot = {
        policy: {
          policy_version: authorization.policy_version,
          independent_delivery_authorization_required: true,
          delivery_authorization_valid_hours:
            authorizationPolicy.delivery_authorization_valid_hours,
        },
        financial: safeJson(authorization.financial_snapshot_json, {}),
        documents: safeJson(authorization.document_snapshot_json, []),
      };
      if (
        current.checksum !== authorization.snapshot_checksum ||
        snapshotChecksum(storedSnapshot) !== authorization.snapshot_checksum
      ) {
        throw new FinancePrivateDocumentError(
          409,
          "The approved documents, Finance balance, reservation or delivery policy changed after the request. Prepare a fresh authorization.",
          "FINANCE_DELIVERY_AUTHORIZATION_STALE"
        );
      }
      await connection.query(
        `UPDATE equipment_finance_delivery_authorizations
            SET authorization_status = 'authorized',
                decided_by = ?, decided_at = NOW(), decision_reason = ?,
                expires_at = DATE_ADD(NOW(), INTERVAL ? HOUR)
          WHERE id = ?`,
        [
          decider,
          decisionReason,
          authorizationPolicy.delivery_authorization_valid_hours,
          authorization.id,
        ]
      );
    } else {
      await connection.query(
        `UPDATE equipment_finance_delivery_authorizations
            SET authorization_status = 'rejected',
                decided_by = ?, decided_at = NOW(), decision_reason = ?,
                expires_at = NULL
          WHERE id = ?`,
        [decider, decisionReason, authorization.id]
      );
    }

    await recordActivity({
      connection,
      req,
      actionType:
        normalized === "authorize"
          ? "delivery_authorized"
          : "delivery_authorization_rejected",
      actor: decider,
      description: `${
        normalized === "authorize" ? "Authorized" : "Rejected"
      } delivery request ${authorization.authorization_number}.`,
      applicationId: authorization.application_id,
      agreementId: authorization.agreement_id,
      metadata: {
        authorization_id: authorization.id,
        authorization_number: authorization.authorization_number,
        decision: normalized,
        reason: decisionReason,
      },
    });
    await connection.commit();
    return getAuthorizationCaseFile(authorization.agreement_id);
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

async function revokeDeliveryAuthorization({ authorizationId, reason, actor, req }) {
  const revocationReason = cleanText(reason);
  if (!revocationReason) {
    throw new FinancePrivateDocumentError(
      400,
      "Enter the reason for revoking delivery authorization.",
      "FINANCE_DELIVERY_AUTHORIZATION_REVOCATION_REASON_REQUIRED"
    );
  }
  const revoker = actorId(actor);
  const connection = await pool.getConnection();
  try {
    await assertAuthorizationSchema(connection);
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT *
         FROM equipment_finance_delivery_authorizations
        WHERE id = ? LIMIT 1 FOR UPDATE`,
      [positiveId(authorizationId, "Authorization ID")]
    );
    const authorization = rows[0];
    if (!authorization) {
      throw new FinancePrivateDocumentError(
        404,
        "Delivery authorization was not found.",
        "FINANCE_DELIVERY_AUTHORIZATION_NOT_FOUND"
      );
    }
    if (effectiveStatus(authorization) !== "authorized") {
      throw new FinancePrivateDocumentError(
        409,
        "Only a live authorized request can be revoked.",
        "FINANCE_DELIVERY_AUTHORIZATION_NOT_LIVE"
      );
    }
    await connection.query(
      `UPDATE equipment_finance_delivery_authorizations
          SET authorization_status = 'revoked', revoked_by = ?,
              revoked_at = NOW(), revocation_reason = ?
        WHERE id = ?`,
      [revoker, revocationReason, authorization.id]
    );
    await recordActivity({
      connection,
      req,
      actionType: "delivery_authorization_revoked",
      actor: revoker,
      description: `Revoked delivery authorization ${authorization.authorization_number}.`,
      applicationId: authorization.application_id,
      agreementId: authorization.agreement_id,
      metadata: {
        authorization_id: authorization.id,
        authorization_number: authorization.authorization_number,
        reason: revocationReason,
      },
    });
    await connection.commit();
    return getAuthorizationCaseFile(authorization.agreement_id);
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
  AUTHORIZATION_DECISIONS,
  AUTHORIZATION_STATUSES,
  approvedDocumentSnapshot,
  assertAuthorizationSchema,
  assertDeliveryEligibility,
  buildSnapshot,
  decideDeliveryAuthorization,
  deliveryThreshold,
  effectiveStatus,
  financialSnapshot,
  getAuthorizationCaseFile,
  getAuthorizationPolicy,
  listAuthorizations,
  loadAuthorizationCase,
  publicAuthorization,
  requestDeliveryAuthorization,
  revokeDeliveryAuthorization,
  snapshotChecksum,
  stableJson,
};
