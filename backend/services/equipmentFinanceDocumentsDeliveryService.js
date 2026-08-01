const crypto = require("node:crypto");

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");

const REQUIRED_TABLES = Object.freeze([
  "equipment_finance_document_delivery_policy",
  "equipment_finance_document_delivery_policy_history",
  "equipment_finance_private_documents",
  "equipment_finance_delivery_authorizations",
  "equipment_finance_delivery_confirmations",
  "equipment_finance_case_activity",
]);
const DOCUMENT_CATEGORIES = new Set([
  "kyc_identity",
  "kyc_address",
  "kyc_income",
  "guarantor_identity",
  "guarantor_undertaking",
  "agreement_attachment",
  "delivery_evidence",
  "other",
]);
const REVIEW_DECISIONS = new Set(["verify", "reject"]);
const APPROVAL_DECISIONS = new Set(["approve", "reject"]);
const AUTHORIZATION_DECISIONS = new Set(["authorize", "reject"]);
const ENCRYPTION_VERSION = "aes-256-gcm-v1";

class FinanceDocumentsDeliveryError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_FINANCE_PHASE5_ERROR") {
    super(message);
    this.name = "FinanceDocumentsDeliveryError";
    this.statusCode = statusCode;
    this.code = code;
  }
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

function actorId(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function safeJson(value, fallback) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function publicPolicy(row) {
  if (!row) return null;
  return {
    ...row,
    maximum_file_size_bytes: Number(row.maximum_file_size_bytes || 0),
    delivery_authorization_valid_hours: Number(row.delivery_authorization_valid_hours || 0),
    independent_document_review_required: Boolean(row.independent_document_review_required),
    separate_document_approval_required: Boolean(row.separate_document_approval_required),
    independent_delivery_authorization_required: Boolean(row.independent_delivery_authorization_required),
    independent_delivery_confirmation_required: Boolean(row.independent_delivery_confirmation_required),
    required_document_categories: safeJson(row.required_document_categories_json, []),
    allowed_mime_types: safeJson(row.allowed_mime_types_json, []),
  };
}

function normalizeCategory(value) {
  const category = cleanText(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
  if (!DOCUMENT_CATEGORIES.has(category)) {
    throw new FinanceDocumentsDeliveryError(400, "Choose a supported Finance document category.", "FINANCE_DOCUMENT_CATEGORY_INVALID");
  }
  return category;
}

function encryptionKey() {
  const secret = cleanText(
    process.env.CHALIN03_FINANCE_DOCUMENT_KEY || process.env.JWT_SECRET || process.env.SESSION_SECRET,
    10000
  );
  if (secret.length < 32) {
    throw new FinanceDocumentsDeliveryError(
      503,
      "Private Finance documents are unavailable until the server encryption secret is configured.",
      "FINANCE_DOCUMENT_ENCRYPTION_KEY_REQUIRED"
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function decodeBase64(value) {
  const text = String(value || "").replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  if (!text || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) {
    throw new FinanceDocumentsDeliveryError(400, "The uploaded document content is not valid base64.", "FINANCE_DOCUMENT_CONTENT_INVALID");
  }
  const buffer = Buffer.from(text, "base64");
  if (!buffer.length) {
    throw new FinanceDocumentsDeliveryError(400, "The uploaded document is empty.", "FINANCE_DOCUMENT_EMPTY");
  }
  return buffer;
}

function encryptBuffer(buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return {
    encrypted,
    iv,
    tag: cipher.getAuthTag(),
    checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

function decryptDocument(row) {
  if (String(row.encryption_version || "") !== ENCRYPTION_VERSION) {
    throw new FinanceDocumentsDeliveryError(503, "This document uses an unsupported encryption version.", "FINANCE_DOCUMENT_ENCRYPTION_VERSION_UNSUPPORTED");
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), row.encryption_iv);
    decipher.setAuthTag(row.encryption_tag);
    const buffer = Buffer.concat([decipher.update(row.encrypted_payload), decipher.final()]);
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    if (checksum !== row.content_checksum) throw new Error("checksum mismatch");
    return buffer;
  } catch {
    throw new FinanceDocumentsDeliveryError(409, "The private document failed its integrity check.", "FINANCE_DOCUMENT_INTEGRITY_FAILED");
  }
}

function referenceNumber(prefix) {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `${prefix}-${timestamp}-${crypto.randomInt(0, 1000000).toString().padStart(6, "0")}`;
}

async function schemaStatus(connection = pool) {
  const placeholders = REQUIRED_TABLES.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})`,
    REQUIRED_TABLES
  );
  const found = new Set(rows.map((row) => row.TABLE_NAME));
  const missingTables = REQUIRED_TABLES.filter((table) => !found.has(table));
  return {
    ready: missingTables.length === 0,
    migration: "equipment_finance_phase5_documents_delivery",
    missing_tables: missingTables,
    privacy_model: "aes_256_gcm_database_vault",
    approval_model: "independent_maker_reviewer_approver_authorizer_confirmer",
  };
}

async function assertSchemaReady(connection = pool) {
  const readiness = await schemaStatus(connection);
  if (!readiness.ready) {
    const error = new FinanceDocumentsDeliveryError(
      503,
      "Finance documents and controlled delivery are awaiting the approved additive Phase 5 migration.",
      "EQUIPMENT_FINANCE_PHASE5_MIGRATION_REQUIRED"
    );
    error.readiness = readiness;
    throw error;
  }
  return readiness;
}

async function getPolicy(connection = pool) {
  await assertSchemaReady(connection);
  const [rows] = await connection.query(
    "SELECT * FROM equipment_finance_document_delivery_policy WHERE id = 1 LIMIT 1"
  );
  if (!rows[0]) throw new FinanceDocumentsDeliveryError(503, "The Phase 5 policy singleton is missing.");
  return publicPolicy(rows[0]);
}

async function updatePolicy({ input, actor, req }) {
  const connection = await pool.getConnection();
  try {
    await assertSchemaReady(connection);
    const current = await getPolicy(connection);
    const version = cleanText(input.policy_version, 80);
    const categories = Array.isArray(input.required_document_categories)
      ? [...new Set(input.required_document_categories.map(normalizeCategory))]
      : current.required_document_categories;
    const allowedMimes = Array.isArray(input.allowed_mime_types)
      ? [...new Set(input.allowed_mime_types.map((item) => cleanText(item, 120)).filter(Boolean))]
      : current.allowed_mime_types;
    const maximum = Number(input.maximum_file_size_bytes ?? current.maximum_file_size_bytes);
    const validity = Number(input.delivery_authorization_valid_hours ?? current.delivery_authorization_valid_hours);
    const reason = cleanText(input.change_reason, 1000);
    if (!version || !categories.length || !allowedMimes.length || !Number.isInteger(maximum) || maximum < 1024 || maximum > 10485760) {
      throw new FinanceDocumentsDeliveryError(400, "Enter a policy version, required categories, allowed file types and a maximum file size up to 10 MB.");
    }
    if (!Number.isInteger(validity) || validity < 1 || validity > 720 || !reason) {
      throw new FinanceDocumentsDeliveryError(400, "Delivery authorization validity must be 1–720 hours and a change reason is required.");
    }
    const booleanValue = (key) =>
      input[key] === undefined ? Boolean(current[key]) : Boolean(input[key]);
    const next = {
      policy_version: version,
      required_document_categories_json: JSON.stringify(categories),
      allowed_mime_types_json: JSON.stringify(allowedMimes),
      maximum_file_size_bytes: maximum,
      independent_document_review_required: booleanValue("independent_document_review_required"),
      separate_document_approval_required: booleanValue("separate_document_approval_required"),
      independent_delivery_authorization_required: booleanValue("independent_delivery_authorization_required"),
      independent_delivery_confirmation_required: booleanValue("independent_delivery_confirmation_required"),
      delivery_authorization_valid_hours: validity,
    };
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO equipment_finance_document_delivery_policy_history (
         policy_version, previous_snapshot_json, new_snapshot_json, change_reason,
         changed_by, request_id
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [version, JSON.stringify(current), JSON.stringify(next), reason, actorId(actor), nullableText(req?.requestId, 120)]
    );
    await connection.query(
      `UPDATE equipment_finance_document_delivery_policy
       SET policy_version = ?, required_document_categories_json = ?, allowed_mime_types_json = ?,
           maximum_file_size_bytes = ?, independent_document_review_required = ?,
           separate_document_approval_required = ?, independent_delivery_authorization_required = ?,
           independent_delivery_confirmation_required = ?, delivery_authorization_valid_hours = ?,
           updated_by = ?, updated_at = NOW()
       WHERE id = 1`,
      [
        next.policy_version,
        next.required_document_categories_json,
        next.allowed_mime_types_json,
        next.maximum_file_size_bytes,
        next.independent_document_review_required,
        next.separate_document_approval_required,
        next.independent_delivery_authorization_required,
        next.independent_delivery_confirmation_required,
        next.delivery_authorization_valid_hours,
        actorId(actor),
      ]
    );
    await recordActivity({
      connection,
      req,
      actionType: "policy_updated",
      actor,
      description: `Updated Finance document and delivery policy to ${version}.`,
      metadata: { previous_version: current.policy_version, next_version: version, reason },
    });
    await connection.commit();
    return getPolicy(pool);
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

function caseSql(one = false) {
  return `SELECT
      agreement.id AS agreement_id,
      agreement.agreement_number,
      agreement.agreement_status,
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
      agreement.controlled_delivery_completed_at,
      application.application_number,
      application.kyc_status,
      customer.customer_name,
      customer.phone AS customer_phone,
      asset.asset_code,
      asset.asset_name,
      asset.sale_status AS asset_sale_status,
      asset.is_active AS asset_is_active,
      (SELECT COUNT(*) FROM hire_contract_assets hire_asset
       WHERE hire_asset.asset_id = agreement.asset_id
         AND hire_asset.status IN ('assigned','dispatched','active')) AS active_hire_count,
      (SELECT COUNT(*) FROM equipment_deliveries delivery
       WHERE delivery.agreement_id = agreement.id) AS delivery_count
    FROM equipment_sale_agreements agreement
    INNER JOIN equipment_credit_applications application
      ON application.id = agreement.credit_application_id
    INNER JOIN hire_customers customer ON customer.id = agreement.customer_id
    INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
    WHERE agreement.sale_type = 'installment'
      AND agreement.activation_source = 'approved_credit_application'
      ${one ? "AND agreement.id = ?" : ""}
    ${one ? "LIMIT 1" : "ORDER BY agreement.created_at DESC LIMIT 500"}`;
}

async function loadCase(connection, agreementId, { lock = false } = {}) {
  const sql = `${caseSql(true)}${lock ? " FOR UPDATE" : ""}`;
  const [rows] = await connection.query(sql, [positiveId(agreementId, "Agreement ID")]);
  if (!rows[0]) throw new FinanceDocumentsDeliveryError(404, "Finance agreement was not found.", "FINANCE_CASE_NOT_FOUND");
  return rows[0];
}

function publicDocument(row) {
  return {
    id: row.id,
    document_number: row.document_number,
    application_id: row.application_id,
    agreement_id: row.agreement_id,
    customer_id: row.customer_id,
    document_category: row.document_category,
    document_type: row.document_type,
    original_file_name: row.original_file_name,
    mime_type: row.mime_type,
    file_size_bytes: Number(row.file_size_bytes || 0),
    content_checksum: row.content_checksum,
    encryption_version: row.encryption_version,
    private_access_only: true,
    review_status: row.review_status,
    reviewed_by: row.reviewed_by,
    reviewed_by_name: row.reviewed_by_name || null,
    reviewed_at: row.reviewed_at,
    review_notes: row.review_notes,
    approval_status: row.approval_status,
    approved_by: row.approved_by,
    approved_by_name: row.approved_by_name || null,
    approved_at: row.approved_at,
    approval_notes: row.approval_notes,
    uploaded_by: row.uploaded_by,
    uploaded_by_name: row.uploaded_by_name || null,
    uploaded_at: row.uploaded_at,
    archived_at: row.archived_at,
  };
}

async function loadDocuments(connection, agreementId, { includeArchived = false } = {}) {
  const [rows] = await connection.query(
    `SELECT document.*,
            uploader.full_name AS uploaded_by_name,
            reviewer.full_name AS reviewed_by_name,
            approver.full_name AS approved_by_name
     FROM equipment_finance_private_documents document
     LEFT JOIN users uploader ON uploader.id = document.uploaded_by
     LEFT JOIN users reviewer ON reviewer.id = document.reviewed_by
     LEFT JOIN users approver ON approver.id = document.approved_by
     WHERE document.agreement_id = ?
       ${includeArchived ? "" : "AND document.archived_at IS NULL"}
     ORDER BY document.uploaded_at DESC, document.id DESC`,
    [agreementId]
  );
  return rows.map(publicDocument);
}

function requiredDocumentStatus(policy, documents) {
  const approved = new Set(
    documents
      .filter((document) => document.review_status === "verified" && document.approval_status === "approved" && !document.archived_at)
      .map((document) => document.document_category)
  );
  const required = policy.required_document_categories.map((category) => ({
    category,
    complete: approved.has(category),
  }));
  return {
    required,
    complete: required.every((item) => item.complete),
    missing: required.filter((item) => !item.complete).map((item) => item.category),
  };
}

async function listCases() {
  await assertSchemaReady();
  const [rows] = await pool.query(caseSql(false));
  const policy = await getPolicy();
  const cases = [];
  for (const row of rows) {
    const documents = await loadDocuments(pool, row.agreement_id);
    const status = requiredDocumentStatus(policy, documents);
    const [authorizationRows] = await pool.query(
      `SELECT * FROM equipment_finance_delivery_authorizations
       WHERE agreement_id = ? ORDER BY requested_at DESC, id DESC LIMIT 1`,
      [row.agreement_id]
    );
    cases.push({
      ...row,
      total_amount: Number(row.total_amount || 0),
      amount_paid: Number(row.amount_paid || 0),
      outstanding_balance: Number(row.outstanding_balance || 0),
      active_hire_count: Number(row.active_hire_count || 0),
      delivery_count: Number(row.delivery_count || 0),
      document_count: documents.length,
      required_documents_complete: status.complete,
      missing_document_categories: status.missing,
      latest_authorization: authorizationRows[0] || null,
    });
  }
  return { cases, policy };
}

async function getCaseFile(agreementId) {
  await assertSchemaReady();
  const financeCase = await loadCase(pool, agreementId);
  const policy = await getPolicy();
  const documents = await loadDocuments(pool, financeCase.agreement_id, { includeArchived: true });
  const [authorizations] = await pool.query(
    `SELECT authorization.*,
            requester.full_name AS requested_by_name,
            authorizer.full_name AS authorized_by_name,
            consumer.full_name AS consumed_by_name
     FROM equipment_finance_delivery_authorizations authorization
     LEFT JOIN users requester ON requester.id = authorization.requested_by
     LEFT JOIN users authorizer ON authorizer.id = authorization.authorized_by
     LEFT JOIN users consumer ON consumer.id = authorization.consumed_by
     WHERE authorization.agreement_id = ?
     ORDER BY authorization.requested_at DESC, authorization.id DESC`,
    [financeCase.agreement_id]
  );
  const [confirmations] = await pool.query(
    `SELECT confirmation.*, user.full_name AS confirmed_by_name
     FROM equipment_finance_delivery_confirmations confirmation
     LEFT JOIN users user ON user.id = confirmation.confirmed_by
     WHERE confirmation.agreement_id = ?
     ORDER BY confirmation.confirmed_at DESC, confirmation.id DESC`,
    [financeCase.agreement_id]
  );
  const [activity] = await pool.query(
    `SELECT activity.*, user.full_name AS actor_name
     FROM equipment_finance_case_activity activity
     LEFT JOIN users user ON user.id = activity.actor_id
     WHERE activity.agreement_id = ?
     ORDER BY activity.created_at DESC, activity.id DESC
     LIMIT 500`,
    [financeCase.agreement_id]
  );
  return {
    case: {
      ...financeCase,
      total_amount: Number(financeCase.total_amount || 0),
      amount_paid: Number(financeCase.amount_paid || 0),
      outstanding_balance: Number(financeCase.outstanding_balance || 0),
      active_hire_count: Number(financeCase.active_hire_count || 0),
      delivery_count: Number(financeCase.delivery_count || 0),
    },
    policy,
    documents,
    document_readiness: requiredDocumentStatus(policy, documents),
    delivery_authorizations: authorizations,
    delivery_confirmations: confirmations,
    activity,
  };
}

async function recordActivity({
  connection = pool,
  req,
  actionType,
  actor,
  description,
  applicationId = null,
  agreementId = null,
  documentId = null,
  authorizationId = null,
  deliveryId = null,
  metadata = null,
}) {
  const activityNumber = referenceNumber("EFA");
  const role = cleanText(
    req?.user?.workspace_role || req?.user?.access_role || req?.user?.role || "system",
    100
  );
  const safeMetadata = metadata ? JSON.stringify(metadata).slice(0, 12000) : null;
  const [result] = await connection.query(
    `INSERT INTO equipment_finance_case_activity (
       activity_number, application_id, agreement_id, document_id,
       authorization_id, delivery_id, action_type, actor_id, actor_role,
       description, metadata_json, request_id, ip_address, user_agent
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      activityNumber,
      applicationId,
      agreementId,
      documentId,
      authorizationId,
      deliveryId,
      cleanText(actionType, 100),
      actorId(actor),
      role || null,
      cleanText(description, 1500),
      safeMetadata,
      nullableText(req?.requestId, 120),
      nullableText(req?.ip, 80),
      nullableText(req?.headers?.["user-agent"], 500),
    ]
  );
  await writeAuditEvent({
    connection,
    req,
    action: `EQUIPMENT_FINANCE_PHASE5_${cleanText(actionType, 80).toUpperCase()}`,
    details: cleanText(description, 1500),
    workspaceCode: "equipment_hire",
    entityType: agreementId ? "equipment_finance_case" : "equipment_finance_control",
    entityId: agreementId || documentId || authorizationId || deliveryId || result.insertId,
    actionType: cleanText(actionType, 100),
    outcome: "success",
    severity: /reject|archive|download|authorize|confirm/.test(actionType) ? "notice" : "info",
    metadata: {
      application_id: applicationId,
      agreement_id: agreementId,
      document_id: documentId,
      authorization_id: authorizationId,
      delivery_id: deliveryId,
      ...(metadata || {}),
    },
  });
  return result.insertId;
}

async function uploadDocument({ agreementId, input, actor, req }) {
  const connection = await pool.getConnection();
  try {
    await assertSchemaReady(connection);
    const financeCase = await loadCase(connection, agreementId);
    const policy = await getPolicy(connection);
    const category = normalizeCategory(input.document_category);
    const documentType = cleanText(input.document_type, 120);
    const fileName = cleanText(input.file_name, 255);
    const mimeType = cleanText(input.mime_type, 120).toLowerCase();
    if (!documentType || !fileName || !policy.allowed_mime_types.includes(mimeType)) {
      throw new FinanceDocumentsDeliveryError(400, "Enter a document type, file name and an allowed PDF, JPEG or PNG file.");
    }
    const buffer = decodeBase64(input.content_base64);
    if (buffer.length > policy.maximum_file_size_bytes) {
      throw new FinanceDocumentsDeliveryError(413, `Private documents cannot exceed ${policy.maximum_file_size_bytes} bytes.`, "FINANCE_DOCUMENT_TOO_LARGE");
    }
    const encrypted = encryptBuffer(buffer);
    const documentNumber = referenceNumber("EFD");
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO equipment_finance_private_documents (
         document_number, application_id, agreement_id, customer_id,
         document_category, document_type, original_file_name, mime_type,
         file_size_bytes, content_checksum, encrypted_payload, encryption_iv,
         encryption_tag, encryption_version, uploaded_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        documentNumber,
        financeCase.application_id,
        financeCase.agreement_id,
        financeCase.customer_id,
        category,
        documentType,
        fileName,
        mimeType,
        buffer.length,
        encrypted.checksum,
        encrypted.encrypted,
        encrypted.iv,
        encrypted.tag,
        ENCRYPTION_VERSION,
        actorId(actor),
      ]
    );
    await recordActivity({
      connection,
      req,
      actionType: "document_uploaded",
      actor,
      description: `Uploaded private ${category.replaceAll("_", " ")} document ${documentNumber}.`,
      applicationId: financeCase.application_id,
      agreementId: financeCase.agreement_id,
      documentId: result.insertId,
      metadata: { document_number: documentNumber, category, mime_type: mimeType, file_size_bytes: buffer.length },
    });
    await connection.commit();
    const [rows] = await pool.query(
      `SELECT document.*, uploader.full_name AS uploaded_by_name
       FROM equipment_finance_private_documents document
       LEFT JOIN users uploader ON uploader.id = document.uploaded_by
       WHERE document.id = ? LIMIT 1`,
      [result.insertId]
    );
    return publicDocument(rows[0]);
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

async function getDocumentContent({ documentId, actor, req }) {
  await assertSchemaReady();
  const [rows] = await pool.query(
    "SELECT * FROM equipment_finance_private_documents WHERE id = ? AND archived_at IS NULL LIMIT 1",
    [positiveId(documentId, "Document ID")]
  );
  const row = rows[0];
  if (!row) throw new FinanceDocumentsDeliveryError(404, "Private Finance document was not found.");
  const buffer = decryptDocument(row);
  await recordActivity({
    req,
    actionType: "document_downloaded",
    actor,
    description: `Accessed private Finance document ${row.document_number}.`,
    applicationId: row.application_id,
    agreementId: row.agreement_id,
    documentId: row.id,
    metadata: { document_number: row.document_number, checksum: row.content_checksum },
  });
  return {
    buffer,
    fileName: row.original_file_name,
    mimeType: row.mime_type,
    checksum: row.content_checksum,
    documentNumber: row.document_number,
  };
}

async function reviewDocument({ documentId, decision, notes, actor, req }) {
  const normalized = cleanText(decision, 20).toLowerCase();
  const reason = cleanText(notes, 1500);
  if (!REVIEW_DECISIONS.has(normalized) || !reason) {
    throw new FinanceDocumentsDeliveryError(400, "Choose verify or reject and enter independent review notes.");
  }
  const connection = await pool.getConnection();
  try {
    await assertSchemaReady(connection);
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT * FROM equipment_finance_private_documents WHERE id = ? AND archived_at IS NULL LIMIT 1 FOR UPDATE",
      [positiveId(documentId, "Document ID")]
    );
    const document = rows[0];
    if (!document) throw new FinanceDocumentsDeliveryError(404, "Private Finance document was not found.");
    if (Number(document.uploaded_by || 0) === Number(actorId(actor) || 0)) {
      throw new FinanceDocumentsDeliveryError(409, "The staff member who uploaded a document cannot independently review it.", "FINANCE_DOCUMENT_INDEPENDENT_REVIEW_REQUIRED");
    }
    if (document.review_status !== "pending") {
      throw new FinanceDocumentsDeliveryError(409, "This document review was already decided.");
    }
    const status = normalized === "verify" ? "verified" : "rejected";
    await connection.query(
      `UPDATE equipment_finance_private_documents
       SET review_status = ?, reviewed_by = ?, reviewed_at = NOW(), review_notes = ?,
           approval_status = CASE WHEN ? = 'rejected' THEN 'rejected' ELSE approval_status END
       WHERE id = ?`,
      [status, actorId(actor), reason, status, document.id]
    );
    await recordActivity({
      connection,
      req,
      actionType: status === "verified" ? "document_verified" : "document_review_rejected",
      actor,
      description: `${status === "verified" ? "Verified" : "Rejected"} private document ${document.document_number} during independent review.`,
      applicationId: document.application_id,
      agreementId: document.agreement_id,
      documentId: document.id,
      metadata: { decision: status, notes: reason },
    });
    await connection.commit();
    return getCaseFile(document.agreement_id);
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

async function approveDocument({ documentId, decision, notes, actor, req }) {
  const normalized = cleanText(decision, 20).toLowerCase();
  const reason = cleanText(notes, 1500);
  if (!APPROVAL_DECISIONS.has(normalized) || !reason) {
    throw new FinanceDocumentsDeliveryError(400, "Choose approve or reject and enter approval notes.");
  }
  const connection = await pool.getConnection();
  try {
    await assertSchemaReady(connection);
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT * FROM equipment_finance_private_documents WHERE id = ? AND archived_at IS NULL LIMIT 1 FOR UPDATE",
      [positiveId(documentId, "Document ID")]
    );
    const document = rows[0];
    if (!document) throw new FinanceDocumentsDeliveryError(404, "Private Finance document was not found.");
    const actorValue = actorId(actor);
    if ([document.uploaded_by, document.reviewed_by].some((id) => Number(id || 0) === Number(actorValue || 0))) {
      throw new FinanceDocumentsDeliveryError(409, "The document approver must be different from both uploader and reviewer.", "FINANCE_DOCUMENT_INDEPENDENT_APPROVAL_REQUIRED");
    }
    if (document.review_status !== "verified") {
      throw new FinanceDocumentsDeliveryError(409, "Only an independently verified document can be approved.");
    }
    if (document.approval_status !== "pending") {
      throw new FinanceDocumentsDeliveryError(409, "This document approval was already decided.");
    }
    const status = normalized === "approve" ? "approved" : "rejected";
    await connection.query(
      `UPDATE equipment_finance_private_documents
       SET approval_status = ?, approved_by = ?, approved_at = NOW(), approval_notes = ?
       WHERE id = ?`,
      [status, actorValue, reason, document.id]
    );
    await recordActivity({
      connection,
      req,
      actionType: status === "approved" ? "document_approved" : "document_approval_rejected",
      actor,
      description: `${status === "approved" ? "Approved" : "Rejected"} private document ${document.document_number}.`,
      applicationId: document.application_id,
      agreementId: document.agreement_id,
      documentId: document.id,
      metadata: { decision: status, notes: reason },
    });
    await connection.commit();
    return getCaseFile(document.agreement_id);
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

async function archiveDocument({ documentId, reason, actor, req }) {
  const text = cleanText(reason, 1000);
  if (!text) throw new FinanceDocumentsDeliveryError(400, "An archive reason is required.");
  const connection = await pool.getConnection();
  try {
    await assertSchemaReady(connection);
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT * FROM equipment_finance_private_documents WHERE id = ? AND archived_at IS NULL LIMIT 1 FOR UPDATE",
      [positiveId(documentId, "Document ID")]
    );
    const document = rows[0];
    if (!document) throw new FinanceDocumentsDeliveryError(404, "Active private Finance document was not found.");
    await connection.query(
      `UPDATE equipment_finance_private_documents
       SET archived_at = NOW(), archived_by = ?, archive_reason = ? WHERE id = ?`,
      [actorId(actor), text, document.id]
    );
    await recordActivity({
      connection,
      req,
      actionType: "document_archived",
      actor,
      description: `Archived private document ${document.document_number}; encrypted evidence remains preserved.`,
      applicationId: document.application_id,
      agreementId: document.agreement_id,
      documentId: document.id,
      metadata: { reason: text },
    });
    await connection.commit();
    return getCaseFile(document.agreement_id);
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

function financialSnapshot(financeCase) {
  return {
    agreement_status: financeCase.agreement_status,
    equipment_commitment_status: financeCase.equipment_commitment_status,
    amount_paid: Number(financeCase.amount_paid || 0),
    outstanding_balance: Number(financeCase.outstanding_balance || 0),
    deposit_required: Number(financeCase.deposit_required || 0),
    deposit_received: Number(financeCase.deposit_received || 0),
    delivery_policy: financeCase.delivery_policy,
    delivery_threshold_percent: Number(financeCase.delivery_threshold_percent || 0),
    active_hire_count: Number(financeCase.active_hire_count || 0),
    delivery_count: Number(financeCase.delivery_count || 0),
    asset_sale_status: financeCase.asset_sale_status,
  };
}

function snapshotMatches(stored, current) {
  return JSON.stringify(stored) === JSON.stringify(financialSnapshot(current));
}

async function requestDeliveryAuthorization({ agreementId, reason, actor, req }) {
  const requestReason = cleanText(reason, 1500);
  if (!requestReason) throw new FinanceDocumentsDeliveryError(400, "Enter the reason for requesting delivery authorization.");
  const connection = await pool.getConnection();
  try {
    await assertSchemaReady(connection);
    await connection.beginTransaction();
    const financeCase = await loadCase(connection, agreementId, { lock: true });
    const policy = await getPolicy(connection);
    const documents = await loadDocuments(connection, financeCase.agreement_id);
    const readiness = requiredDocumentStatus(policy, documents);
    if (!readiness.complete) {
      throw new FinanceDocumentsDeliveryError(409, `Delivery cannot be requested until these approved documents exist: ${readiness.missing.join(", ")}.`, "FINANCE_DELIVERY_DOCUMENTS_INCOMPLETE");
    }
    if (Number(financeCase.active_hire_count || 0) > 0 || Number(financeCase.delivery_count || 0) > 0) {
      throw new FinanceDocumentsDeliveryError(409, "The equipment is active on Hire or delivery was already recorded.");
    }
    if (financeCase.equipment_commitment_status !== "reserved") {
      throw new FinanceDocumentsDeliveryError(409, "The exact financed equipment must be reserved before delivery authorization.");
    }
    const [active] = await connection.query(
      `SELECT id FROM equipment_finance_delivery_authorizations
       WHERE agreement_id = ? AND authorization_status IN ('pending','authorized')
       LIMIT 1 FOR UPDATE`,
      [financeCase.agreement_id]
    );
    if (active.length) throw new FinanceDocumentsDeliveryError(409, "An active delivery authorization already exists for this agreement.");
    const authorizationNumber = referenceNumber("FDA");
    const documentSnapshot = documents
      .filter((document) => document.review_status === "verified" && document.approval_status === "approved" && !document.archived_at)
      .map((document) => ({
        id: document.id,
        document_number: document.document_number,
        category: document.document_category,
        checksum: document.content_checksum,
        reviewed_by: document.reviewed_by,
        approved_by: document.approved_by,
      }));
    const [result] = await connection.query(
      `INSERT INTO equipment_finance_delivery_authorizations (
         authorization_number, agreement_id, application_id, asset_id, customer_id,
         policy_version, document_snapshot_json, financial_snapshot_json,
         request_reason, requested_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        authorizationNumber,
        financeCase.agreement_id,
        financeCase.application_id,
        financeCase.asset_id,
        financeCase.customer_id,
        policy.policy_version,
        JSON.stringify(documentSnapshot),
        JSON.stringify(financialSnapshot(financeCase)),
        requestReason,
        actorId(actor),
      ]
    );
    await recordActivity({
      connection,
      req,
      actionType: "delivery_authorization_requested",
      actor,
      description: `Requested delivery authorization ${authorizationNumber} for ${financeCase.agreement_number}.`,
      applicationId: financeCase.application_id,
      agreementId: financeCase.agreement_id,
      authorizationId: result.insertId,
      metadata: { authorization_number: authorizationNumber, policy_version: policy.policy_version, reason: requestReason },
    });
    await connection.commit();
    return getCaseFile(financeCase.agreement_id);
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

async function decideDeliveryAuthorization({ authorizationId, decision, reason, actor, req }) {
  const normalized = cleanText(decision, 20).toLowerCase();
  const decisionReason = cleanText(reason, 1500);
  if (!AUTHORIZATION_DECISIONS.has(normalized) || !decisionReason) {
    throw new FinanceDocumentsDeliveryError(400, "Choose authorize or reject and enter an independent decision reason.");
  }
  const connection = await pool.getConnection();
  try {
    await assertSchemaReady(connection);
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT * FROM equipment_finance_delivery_authorizations WHERE id = ? LIMIT 1 FOR UPDATE",
      [positiveId(authorizationId, "Authorization ID")]
    );
    const authorization = rows[0];
    if (!authorization) throw new FinanceDocumentsDeliveryError(404, "Delivery authorization request was not found.");
    if (authorization.authorization_status !== "pending") {
      throw new FinanceDocumentsDeliveryError(409, "This delivery authorization was already decided.");
    }
    if (Number(authorization.requested_by || 0) === Number(actorId(actor) || 0)) {
      throw new FinanceDocumentsDeliveryError(409, "The staff member who requested delivery cannot authorize it.", "FINANCE_DELIVERY_INDEPENDENT_AUTHORIZER_REQUIRED");
    }
    const financeCase = await loadCase(connection, authorization.agreement_id, { lock: true });
    if (normalized === "authorize") {
      const currentSnapshot = financialSnapshot(financeCase);
      if (!snapshotMatches(safeJson(authorization.financial_snapshot_json, {}), financeCase)) {
        throw new FinanceDocumentsDeliveryError(409, "The Finance account changed after the request. Prepare a fresh delivery authorization.", "FINANCE_DELIVERY_AUTHORIZATION_STALE");
      }
      const policy = await getPolicy(connection);
      const documents = await loadDocuments(connection, financeCase.agreement_id);
      const readiness = requiredDocumentStatus(policy, documents);
      if (!readiness.complete) {
        throw new FinanceDocumentsDeliveryError(409, "Required documents are no longer complete. Authorization was not granted.");
      }
      const snapshot = safeJson(authorization.document_snapshot_json, []);
      const currentApproved = new Map(
        documents
          .filter((document) => document.review_status === "verified" && document.approval_status === "approved" && !document.archived_at)
          .map((document) => [Number(document.id), document.content_checksum])
      );
      if (!snapshot.every((document) => currentApproved.get(Number(document.id)) === document.checksum)) {
        throw new FinanceDocumentsDeliveryError(409, "A reviewed document changed or was archived. Prepare a fresh authorization.", "FINANCE_DELIVERY_DOCUMENT_SNAPSHOT_STALE");
      }
      await connection.query(
        `UPDATE equipment_finance_delivery_authorizations
         SET authorization_status = 'authorized', authorized_by = ?, authorized_at = NOW(),
             authorization_reason = ?, expires_at = DATE_ADD(NOW(), INTERVAL ? HOUR)
         WHERE id = ?`,
        [actorId(actor), decisionReason, policy.delivery_authorization_valid_hours, authorization.id]
      );
    } else {
      await connection.query(
        `UPDATE equipment_finance_delivery_authorizations
         SET authorization_status = 'rejected', authorized_by = ?, authorized_at = NOW(),
             authorization_reason = ?, expires_at = NULL
         WHERE id = ?`,
        [actorId(actor), decisionReason, authorization.id]
      );
    }
    await recordActivity({
      connection,
      req,
      actionType: normalized === "authorize" ? "delivery_authorized" : "delivery_authorization_rejected",
      actor,
      description: `${normalized === "authorize" ? "Authorized" : "Rejected"} delivery request ${authorization.authorization_number}.`,
      applicationId: authorization.application_id,
      agreementId: authorization.agreement_id,
      authorizationId: authorization.id,
      metadata: { decision: normalized, reason: decisionReason },
    });
    await connection.commit();
    return getCaseFile(authorization.agreement_id);
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

async function validateDeliveryAuthorization({ connection, authorizationNumber, agreementId, confirmerId }) {
  await assertSchemaReady(connection);
  const number = cleanText(authorizationNumber, 120);
  if (!number) {
    throw new FinanceDocumentsDeliveryError(400, "A live Phase 5 delivery authorization number is required.", "FINANCE_DELIVERY_AUTHORIZATION_REQUIRED");
  }
  const [rows] = await connection.query(
    `SELECT * FROM equipment_finance_delivery_authorizations
     WHERE authorization_number = ? LIMIT 1 FOR UPDATE`,
    [number]
  );
  const authorization = rows[0];
  if (!authorization || Number(authorization.agreement_id) !== Number(agreementId)) {
    throw new FinanceDocumentsDeliveryError(404, "Delivery authorization was not found for this agreement.");
  }
  if (authorization.authorization_status !== "authorized") {
    throw new FinanceDocumentsDeliveryError(409, `Delivery authorization is ${authorization.authorization_status}, not authorized.`);
  }
  if (!authorization.expires_at || new Date(authorization.expires_at).getTime() <= Date.now()) {
    await connection.query(
      "UPDATE equipment_finance_delivery_authorizations SET authorization_status = 'expired' WHERE id = ?",
      [authorization.id]
    );
    throw new FinanceDocumentsDeliveryError(409, "Delivery authorization has expired. Prepare a fresh request.", "FINANCE_DELIVERY_AUTHORIZATION_EXPIRED");
  }
  if (Number(authorization.authorized_by || 0) === Number(confirmerId || 0)) {
    throw new FinanceDocumentsDeliveryError(409, "The delivery authorizer cannot also confirm the physical handover.", "FINANCE_DELIVERY_INDEPENDENT_CONFIRMATION_REQUIRED");
  }
  const financeCase = await loadCase(connection, agreementId, { lock: true });
  if (!snapshotMatches(safeJson(authorization.financial_snapshot_json, {}), financeCase)) {
    throw new FinanceDocumentsDeliveryError(409, "The Finance account changed after authorization. Delivery is blocked until reauthorized.", "FINANCE_DELIVERY_AUTHORIZATION_STALE");
  }
  return { authorization, financeCase };
}

async function completeDeliveryAuthorization({
  connection,
  authorization,
  financeCase,
  deliveryId,
  confirmationInput,
  actor,
  req,
}) {
  const confirmationNumber = referenceNumber("FDC");
  const snapshot = {
    authorization_number: authorization.authorization_number,
    agreement_number: financeCase.agreement_number,
    application_number: financeCase.application_number,
    customer_name: financeCase.customer_name,
    asset_code: financeCase.asset_code,
    asset_name: financeCase.asset_name,
    receiving_person: cleanText(confirmationInput.receiving_person, 180),
    receiving_phone: nullableText(confirmationInput.receiving_phone, 40),
    destination: nullableText(confirmationInput.destination, 255),
    condition_status: cleanText(confirmationInput.condition_status, 40),
    meter_reading: Number(confirmationInput.meter_reading || 0),
    fuel_level_percent: Number(confirmationInput.fuel_level_percent || 0),
    confirmed_at: new Date().toISOString(),
  };
  const [result] = await connection.query(
    `INSERT INTO equipment_finance_delivery_confirmations (
       confirmation_number, authorization_id, delivery_id, agreement_id,
       application_id, asset_id, customer_id, receiving_person, receiving_phone,
       destination, condition_status, meter_reading, fuel_level_percent,
       customer_signature_document_id, delivery_note_document_id,
       confirmation_snapshot_json, notes, confirmed_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      confirmationNumber,
      authorization.id,
      deliveryId,
      financeCase.agreement_id,
      financeCase.application_id,
      financeCase.asset_id,
      financeCase.customer_id,
      snapshot.receiving_person,
      snapshot.receiving_phone,
      snapshot.destination,
      snapshot.condition_status,
      snapshot.meter_reading,
      snapshot.fuel_level_percent,
      confirmationInput.customer_signature_document_id || null,
      confirmationInput.delivery_note_document_id || null,
      JSON.stringify(snapshot),
      nullableText(confirmationInput.notes, 3000),
      actorId(actor),
    ]
  );
  await connection.query(
    `UPDATE equipment_finance_delivery_authorizations
     SET authorization_status = 'consumed', consumed_by = ?, consumed_at = NOW(), delivery_id = ?
     WHERE id = ?`,
    [actorId(actor), deliveryId, authorization.id]
  );
  await recordActivity({
    connection,
    req,
    actionType: "delivery_confirmed",
    actor,
    description: `Confirmed physical delivery under ${authorization.authorization_number}; confirmation ${confirmationNumber}.`,
    applicationId: financeCase.application_id,
    agreementId: financeCase.agreement_id,
    authorizationId: authorization.id,
    deliveryId,
    metadata: { confirmation_id: result.insertId, confirmation_number: confirmationNumber },
  });
  return { confirmationId: result.insertId, confirmationNumber };
}

async function listActivity({ agreementId = null, limit = 200 } = {}) {
  await assertSchemaReady();
  const params = [];
  const where = [];
  if (agreementId) {
    where.push("activity.agreement_id = ?");
    params.push(positiveId(agreementId, "Agreement ID"));
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const [rows] = await pool.query(
    `SELECT activity.*, user.full_name AS actor_name
     FROM equipment_finance_case_activity activity
     LEFT JOIN users user ON user.id = activity.actor_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY activity.created_at DESC, activity.id DESC
     LIMIT ?`,
    [...params, safeLimit]
  );
  return rows;
}

module.exports = {
  DOCUMENT_CATEGORIES,
  ENCRYPTION_VERSION,
  FinanceDocumentsDeliveryError,
  REQUIRED_TABLES,
  approveDocument,
  archiveDocument,
  completeDeliveryAuthorization,
  decideDeliveryAuthorization,
  decryptDocument,
  encryptBuffer,
  getCaseFile,
  getDocumentContent,
  getPolicy,
  listActivity,
  listCases,
  recordActivity,
  requestDeliveryAuthorization,
  requiredDocumentStatus,
  reviewDocument,
  schemaStatus,
  updatePolicy,
  uploadDocument,
  validateDeliveryAuthorization,
};
