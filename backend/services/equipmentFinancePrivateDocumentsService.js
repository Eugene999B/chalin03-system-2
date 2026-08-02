const crypto = require("node:crypto");

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");

const REQUIRED_TABLES = Object.freeze([
  "equipment_finance_document_delivery_policy",
  "equipment_finance_private_documents",
  "equipment_finance_case_activity",
]);
const DOCUMENT_CATEGORIES = new Set([
  "kyc_identity",
  "kyc_address",
  "kyc_income",
  "guarantor_identity",
  "guarantor_undertaking",
  "agreement_attachment",
  "other",
]);
const ENCRYPTION_VERSION = "aes-256-gcm-v1";
const KEY_SALT = Buffer.from("chalin03-equipment-finance-private-documents-v1", "utf8");
const KEY_INFO = Buffer.from("aes-256-gcm-database-vault", "utf8");

class FinancePrivateDocumentError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_FINANCE_PHASE5A_ERROR") {
    super(message);
    this.name = "FinancePrivateDocumentError";
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
    id: Number(row.id),
    policy_version: row.policy_version,
    allowed_document_categories: safeJson(
      row.allowed_document_categories_json,
      []
    ),
    allowed_mime_types: safeJson(row.allowed_mime_types_json, []),
    maximum_file_size_bytes: Number(row.maximum_file_size_bytes || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeCategory(value) {
  const category = cleanText(value, 80)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!DOCUMENT_CATEGORIES.has(category)) {
    throw new FinancePrivateDocumentError(
      400,
      "Choose a supported Finance document category.",
      "FINANCE_DOCUMENT_CATEGORY_INVALID"
    );
  }
  return category;
}

function encryptionKey() {
  const source = cleanText(
    process.env.CHALIN03_FINANCE_DOCUMENT_KEY || process.env.JWT_SECRET,
    10000
  );
  if (source.length < 32) {
    throw new FinancePrivateDocumentError(
      503,
      "Private Finance documents are unavailable until the server encryption secret is configured.",
      "FINANCE_DOCUMENT_ENCRYPTION_KEY_REQUIRED"
    );
  }
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.from(source, "utf8"),
      KEY_SALT,
      KEY_INFO,
      32
    )
  );
}

function decodeBase64(value) {
  const text = String(value || "")
    .replace(/^data:[^;]+;base64,/, "")
    .replace(/\s+/g, "");
  if (
    !text ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(text) ||
    text.length % 4 !== 0
  ) {
    throw new FinancePrivateDocumentError(
      400,
      "The uploaded document content is not valid base64.",
      "FINANCE_DOCUMENT_CONTENT_INVALID"
    );
  }
  const buffer = Buffer.from(text, "base64");
  if (!buffer.length) {
    throw new FinancePrivateDocumentError(
      400,
      "The uploaded document is empty.",
      "FINANCE_DOCUMENT_EMPTY"
    );
  }
  return buffer;
}

function detectedMimeType(buffer) {
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return "image/png";
  }
  return null;
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
    throw new FinancePrivateDocumentError(
      503,
      "This document uses an unsupported encryption version.",
      "FINANCE_DOCUMENT_ENCRYPTION_VERSION_UNSUPPORTED"
    );
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      row.encryption_iv
    );
    decipher.setAuthTag(row.encryption_tag);
    const buffer = Buffer.concat([
      decipher.update(row.encrypted_payload),
      decipher.final(),
    ]);
    const checksum = crypto
      .createHash("sha256")
      .update(buffer)
      .digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(checksum), Buffer.from(row.content_checksum))) {
      throw new Error("checksum mismatch");
    }
    return buffer;
  } catch {
    throw new FinancePrivateDocumentError(
      409,
      "The private document failed its integrity check.",
      "FINANCE_DOCUMENT_INTEGRITY_FAILED"
    );
  }
}

function referenceNumber(prefix) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const random = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
  return `${prefix}-${timestamp}-${random}`;
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
  const found = new Set(rows.map((row) => row.TABLE_NAME));
  const missingTables = REQUIRED_TABLES.filter((table) => !found.has(table));
  return {
    ready: missingTables.length === 0,
    migration: "equipment_finance_phase5a_private_documents",
    missing_tables: missingTables,
    privacy_model: "aes_256_gcm_database_vault",
  };
}

async function assertSchemaReady(connection = pool) {
  const readiness = await schemaStatus(connection);
  if (!readiness.ready) {
    const error = new FinancePrivateDocumentError(
      503,
      "Private Finance documents are awaiting the approved additive Phase 5A migration.",
      "EQUIPMENT_FINANCE_PHASE5A_MIGRATION_REQUIRED"
    );
    error.readiness = readiness;
    throw error;
  }
}

async function getPolicy(connection = pool) {
  await assertSchemaReady(connection);
  const [rows] = await connection.query(
    "SELECT * FROM equipment_finance_document_delivery_policy WHERE id = 1 LIMIT 1"
  );
  if (!rows[0]) {
    throw new FinancePrivateDocumentError(
      503,
      "The private document policy is missing.",
      "FINANCE_DOCUMENT_POLICY_MISSING"
    );
  }
  return publicPolicy(rows[0]);
}

function caseSql(one = false) {
  return `SELECT
      agreement.id AS agreement_id,
      agreement.agreement_number,
      agreement.agreement_status,
      agreement.credit_application_id AS application_id,
      agreement.customer_id,
      agreement.asset_id,
      agreement.total_amount,
      agreement.amount_paid,
      agreement.outstanding_balance,
      application.application_number,
      customer.customer_name,
      customer.phone AS customer_phone,
      asset.asset_code,
      asset.asset_name,
      (SELECT COUNT(*)
         FROM equipment_finance_private_documents document
        WHERE document.agreement_id = agreement.id
          AND document.document_status = 'active') AS document_count
    FROM equipment_sale_agreements agreement
    INNER JOIN equipment_credit_applications application
      ON application.id = agreement.credit_application_id
    INNER JOIN hire_customers customer
      ON customer.id = agreement.customer_id
    INNER JOIN fleet_assets asset
      ON asset.id = agreement.asset_id
    WHERE agreement.sale_type = 'installment'
      AND agreement.activation_source = 'approved_credit_application'
      ${one ? "AND agreement.id = ?" : ""}
    ${one ? "LIMIT 1" : "ORDER BY agreement.created_at DESC, agreement.id DESC LIMIT 500"}`;
}

async function loadCase(connection, agreementId) {
  const [rows] = await connection.query(caseSql(true), [
    positiveId(agreementId, "Agreement ID"),
  ]);
  if (!rows[0]) {
    throw new FinancePrivateDocumentError(
      404,
      "Finance agreement was not found.",
      "FINANCE_CASE_NOT_FOUND"
    );
  }
  return {
    ...rows[0],
    total_amount: Number(rows[0].total_amount || 0),
    amount_paid: Number(rows[0].amount_paid || 0),
    outstanding_balance: Number(rows[0].outstanding_balance || 0),
    document_count: Number(rows[0].document_count || 0),
  };
}

function publicDocument(row) {
  return {
    id: Number(row.id),
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
    document_status: row.document_status,
    private_access_only: true,
    uploaded_by: row.uploaded_by,
    uploaded_by_name: row.uploaded_by_name || null,
    uploaded_at: row.uploaded_at,
    archived_at: row.archived_at,
  };
}

async function loadDocuments(connection, agreementId) {
  const [rows] = await connection.query(
    `SELECT document.*, uploader.full_name AS uploaded_by_name
       FROM equipment_finance_private_documents document
       LEFT JOIN users uploader ON uploader.id = document.uploaded_by
      WHERE document.agreement_id = ?
        AND document.document_status = 'active'
      ORDER BY document.uploaded_at DESC, document.id DESC`,
    [positiveId(agreementId, "Agreement ID")]
  );
  return rows.map(publicDocument);
}

async function listCases() {
  await assertSchemaReady();
  const [rows] = await pool.query(caseSql(false));
  return rows.map((row) => ({
    ...row,
    total_amount: Number(row.total_amount || 0),
    amount_paid: Number(row.amount_paid || 0),
    outstanding_balance: Number(row.outstanding_balance || 0),
    document_count: Number(row.document_count || 0),
  }));
}

async function getCaseFile(agreementId) {
  await assertSchemaReady();
  const financeCase = await loadCase(pool, agreementId);
  const [policy, documents, activity] = await Promise.all([
    getPolicy(pool),
    loadDocuments(pool, financeCase.agreement_id),
    listActivity({ agreementId: financeCase.agreement_id, limit: 200 }),
  ]);
  return { case: financeCase, policy, documents, activity };
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
  metadata = null,
}) {
  const activityNumber = referenceNumber("EFA");
  const role = cleanText(
    req?.user?.workspace_role ||
      req?.user?.access_role ||
      req?.user?.role ||
      "system",
    100
  );
  const safeMetadata = metadata
    ? JSON.stringify(metadata).slice(0, 12000)
    : null;
  const [result] = await connection.query(
    `INSERT INTO equipment_finance_case_activity (
       activity_number, application_id, agreement_id, document_id,
       action_type, actor_id, actor_role, description, metadata_json,
       request_id, ip_address, user_agent
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      activityNumber,
      applicationId,
      agreementId,
      documentId,
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
    action: `EQUIPMENT_FINANCE_PHASE5A_${cleanText(actionType, 80).toUpperCase()}`,
    details: cleanText(description, 1500),
    workspaceCode: "equipment_hire",
    entityType: agreementId
      ? "equipment_finance_case"
      : "equipment_finance_private_document",
    entityId: agreementId || documentId || result.insertId,
    actionType: cleanText(actionType, 100),
    outcome: "success",
    severity: actionType === "document_downloaded" ? "notice" : "info",
    metadata: {
      application_id: applicationId,
      agreement_id: agreementId,
      document_id: documentId,
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
    const declaredMime = cleanText(input.mime_type, 120).toLowerCase();
    if (
      !documentType ||
      !fileName ||
      !policy.allowed_document_categories.includes(category) ||
      !policy.allowed_mime_types.includes(declaredMime)
    ) {
      throw new FinancePrivateDocumentError(
        400,
        "Enter a supported document category, document type, file name and PDF, JPEG or PNG content.",
        "FINANCE_DOCUMENT_METADATA_INVALID"
      );
    }
    const buffer = decodeBase64(input.content_base64);
    if (buffer.length > policy.maximum_file_size_bytes) {
      throw new FinancePrivateDocumentError(
        413,
        `Private documents cannot exceed ${policy.maximum_file_size_bytes} bytes.`,
        "FINANCE_DOCUMENT_TOO_LARGE"
      );
    }
    const actualMime = detectedMimeType(buffer);
    if (!actualMime || actualMime !== declaredMime) {
      throw new FinancePrivateDocumentError(
        400,
        "The uploaded file signature does not match its declared PDF, JPEG or PNG type.",
        "FINANCE_DOCUMENT_SIGNATURE_MISMATCH"
      );
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
        declaredMime,
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
      metadata: {
        document_number: documentNumber,
        category,
        mime_type: declaredMime,
        file_size_bytes: buffer.length,
        checksum: encrypted.checksum,
      },
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
    try {
      await connection.rollback();
    } catch {
      // The original error remains authoritative.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function getDocumentContent({ documentId, actor, req }) {
  const connection = await pool.getConnection();
  try {
    await assertSchemaReady(connection);
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT *
         FROM equipment_finance_private_documents
        WHERE id = ? AND document_status = 'active'
        LIMIT 1`,
      [positiveId(documentId, "Document ID")]
    );
    const row = rows[0];
    if (!row) {
      throw new FinancePrivateDocumentError(
        404,
        "Private Finance document was not found.",
        "FINANCE_DOCUMENT_NOT_FOUND"
      );
    }
    const buffer = decryptDocument(row);
    await recordActivity({
      connection,
      req,
      actionType: "document_downloaded",
      actor,
      description: `Accessed private Finance document ${row.document_number}.`,
      applicationId: row.application_id,
      agreementId: row.agreement_id,
      documentId: row.id,
      metadata: {
        document_number: row.document_number,
        checksum: row.content_checksum,
      },
    });
    await connection.commit();
    return {
      buffer,
      fileName: row.original_file_name,
      mimeType: row.mime_type,
      checksum: row.content_checksum,
      documentNumber: row.document_number,
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // The original error remains authoritative.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function listActivity({ agreementId = null, limit = 200 } = {}) {
  await assertSchemaReady();
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const values = [];
  const where = [];
  if (agreementId !== null && agreementId !== undefined && agreementId !== "") {
    where.push("activity.agreement_id = ?");
    values.push(positiveId(agreementId, "Agreement ID"));
  }
  values.push(safeLimit);
  const [rows] = await pool.query(
    `SELECT activity.*, user.full_name AS actor_name
       FROM equipment_finance_case_activity activity
       LEFT JOIN users user ON user.id = activity.actor_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY activity.created_at DESC, activity.id DESC
      LIMIT ?`,
    values
  );
  return rows;
}

module.exports = {
  DOCUMENT_CATEGORIES,
  ENCRYPTION_VERSION,
  FinancePrivateDocumentError,
  REQUIRED_TABLES,
  assertSchemaReady,
  decryptDocument,
  detectedMimeType,
  encryptBuffer,
  getCaseFile,
  getDocumentContent,
  getPolicy,
  listActivity,
  listCases,
  loadDocuments,
  recordActivity,
  schemaStatus,
  uploadDocument,
};
