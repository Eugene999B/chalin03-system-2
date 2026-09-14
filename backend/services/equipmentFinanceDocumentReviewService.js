const { pool } = require("../config/db");
const {
  FinancePrivateDocumentError,
  assertSchemaReady,
  getApplicationCaseFile,
  getCaseFile,
  recordActivity,
} = require("./equipmentFinancePrivateDocumentsService");

const REVIEW_DECISIONS = new Set(["verify", "reject"]);
const APPROVAL_DECISIONS = new Set(["approve", "reject"]);

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
  return Number.isInteger(number) && number > 0 ? number : null;
}

function safeJson(value, fallback = []) {
  try {
    return (typeof value === "string" ? JSON.parse(value) : value) ?? fallback;
  } catch {
    return fallback;
  }
}

async function assertReviewSchema(connection = pool) {
  await assertSchemaReady(connection);
  const [columns] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'equipment_finance_private_documents'
        AND COLUMN_NAME IN (
          'review_status','reviewed_by','reviewed_at','review_notes',
          'approval_status','approved_by','approved_at','approval_notes',
          'replacement_of_document_id'
        )`
  );
  const [[history]] = await connection.query(
    `SELECT COUNT(*) AS present
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'equipment_finance_document_review_history'`
  );
  if (columns.length !== 9 || Number(history?.present || 0) !== 1) {
    throw new FinancePrivateDocumentError(
      503,
      "Independent Finance document review is awaiting the approved additive Phase 5B migration.",
      "EQUIPMENT_FINANCE_PHASE5B_MIGRATION_REQUIRED"
    );
  }
}

async function getReviewPolicy(connection = pool) {
  await assertReviewSchema(connection);
  const [rows] = await connection.query(
    `SELECT policy_version, required_document_categories_json,
            independent_document_review_required,
            separate_document_approval_required
       FROM equipment_finance_document_delivery_policy
      WHERE id = 1 LIMIT 1`
  );
  if (!rows[0]) {
    throw new FinancePrivateDocumentError(
      503,
      "The independent document review policy is missing.",
      "FINANCE_DOCUMENT_REVIEW_POLICY_MISSING"
    );
  }
  return {
    policy_version: rows[0].policy_version,
    required_document_categories: safeJson(
      rows[0].required_document_categories_json,
      []
    ),
    independent_document_review_required:
      Number(rows[0].independent_document_review_required || 0) === 1,
    separate_document_approval_required:
      Number(rows[0].separate_document_approval_required || 0) === 1,
  };
}

function publicReviewDocument(row) {
  return {
    id: Number(row.id),
    document_number: row.document_number,
    agreement_id: row.agreement_id ? Number(row.agreement_id) : null,
    application_id: row.application_id,
    customer_id: row.customer_id,
    asset_id: row.asset_id,
    document_stage: row.document_stage,
    version_number: Number(row.version_number || 1),
    legacy_case_document_id: row.legacy_case_document_id,
    replacement_of_document_id: row.replacement_of_document_id,
    document_category: row.document_category,
    document_type: row.document_type,
    original_file_name: row.original_file_name,
    mime_type: row.mime_type,
    file_size_bytes: Number(row.file_size_bytes || 0),
    content_checksum: row.content_checksum,
    document_status: row.document_status,
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

async function listReviewDocuments(connection, agreementId, { lock = false } = {}) {
  const [rows] = await connection.query(
    `SELECT document.*,
            uploader.full_name AS uploaded_by_name,
            reviewer.full_name AS reviewed_by_name,
            approver.full_name AS approved_by_name
       FROM equipment_finance_private_documents document
       LEFT JOIN users uploader ON uploader.id = document.uploaded_by
       LEFT JOIN users reviewer ON reviewer.id = document.reviewed_by
       LEFT JOIN users approver ON approver.id = document.approved_by
      WHERE document.application_id = (
              SELECT agreement.credit_application_id
              FROM equipment_sale_agreements agreement
              WHERE agreement.id = ?
              LIMIT 1
            )
      ORDER BY document.uploaded_at DESC, document.id DESC
      ${lock ? "FOR UPDATE" : ""}`,
    [positiveId(agreementId, "Agreement ID")]
  );
  return rows.map(publicReviewDocument);
}

async function listApplicationReviewDocuments(
  connection,
  applicationId,
  { lock = false } = {}
) {
  const [rows] = await connection.query(
    `SELECT document.*,
            uploader.full_name AS uploaded_by_name,
            reviewer.full_name AS reviewed_by_name,
            approver.full_name AS approved_by_name
       FROM equipment_finance_private_documents document
       LEFT JOIN users uploader ON uploader.id = document.uploaded_by
       LEFT JOIN users reviewer ON reviewer.id = document.reviewed_by
       LEFT JOIN users approver ON approver.id = document.approved_by
      WHERE document.application_id = ?
      ORDER BY document.uploaded_at DESC, document.id DESC
      ${lock ? "FOR UPDATE" : ""}`,
    [positiveId(applicationId, "Application ID")]
  );
  return rows.map(publicReviewDocument);
}

function requiredDocumentStatus(policy, documents) {
  const approved = new Set(
    documents
      .filter(
        (document) =>
          document.document_status === "active" &&
          document.review_status === "verified" &&
          document.approval_status === "approved"
      )
      .map((document) => document.document_category)
  );
  const required = policy.required_document_categories.map((category) => ({
    category,
    complete: approved.has(category),
  }));
  return {
    required,
    complete: required.every((item) => item.complete),
    missing: required
      .filter((item) => !item.complete)
      .map((item) => item.category),
  };
}

async function getReviewCaseFile(agreementId) {
  await assertReviewSchema();
  const financeCase = await getCaseFile(agreementId);
  const [policy, documents] = await Promise.all([
    getReviewPolicy(pool),
    listReviewDocuments(pool, agreementId),
  ]);
  return {
    ...financeCase,
    review_policy: policy,
    review_documents: documents,
    document_readiness: requiredDocumentStatus(policy, documents),
  };
}

async function getApplicationReviewCaseFile(applicationId) {
  await assertReviewSchema();
  const financeCase = await getApplicationCaseFile(applicationId);
  const [policy, documents] = await Promise.all([
    getReviewPolicy(pool),
    listApplicationReviewDocuments(pool, applicationId),
  ]);
  return {
    ...financeCase,
    review_policy: policy,
    review_documents: documents,
    document_readiness: requiredDocumentStatus(policy, documents),
  };
}

async function refreshDocumentCase(document) {
  return document.agreement_id
    ? getReviewCaseFile(document.agreement_id)
    : getApplicationReviewCaseFile(document.application_id);
}

async function writeDecisionHistory({
  connection,
  document,
  stage,
  value,
  notes,
  actor,
  policyVersion,
}) {
  await connection.query(
    `INSERT INTO equipment_finance_document_review_history (
       document_id, agreement_id, application_id, decision_stage,
       decision_value, decision_notes, decided_by, document_checksum,
       policy_version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      document.id,
      document.agreement_id,
      document.application_id,
      stage,
      value,
      notes,
      actorId(actor),
      document.content_checksum,
      policyVersion,
    ]
  );
}

async function reviewDocument({ documentId, decision, notes, actor, req }) {
  const normalized = cleanText(decision, 20).toLowerCase();
  const reason = cleanText(notes);
  if (!REVIEW_DECISIONS.has(normalized) || !reason) {
    throw new FinancePrivateDocumentError(
      400,
      "Choose verify or reject and enter independent review notes.",
      "FINANCE_DOCUMENT_REVIEW_INPUT_INVALID"
    );
  }
  const connection = await pool.getConnection();
  try {
    await assertReviewSchema(connection);
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT * FROM equipment_finance_private_documents
        WHERE id = ? AND document_status = 'active'
        LIMIT 1 FOR UPDATE`,
      [positiveId(documentId, "Document ID")]
    );
    const document = rows[0];
    if (!document) {
      throw new FinancePrivateDocumentError(
        404,
        "Active private Finance document was not found.",
        "FINANCE_DOCUMENT_NOT_FOUND"
      );
    }
    const reviewer = actorId(actor);
    if (!reviewer || Number(document.uploaded_by || 0) === reviewer) {
      throw new FinancePrivateDocumentError(
        409,
        "The staff member who uploaded a document cannot independently review it.",
        "FINANCE_DOCUMENT_INDEPENDENT_REVIEW_REQUIRED"
      );
    }
    if (document.review_status !== "pending") {
      throw new FinancePrivateDocumentError(
        409,
        "This document review was already decided.",
        "FINANCE_DOCUMENT_REVIEW_ALREADY_DECIDED"
      );
    }
    const policy = await getReviewPolicy(connection);
    const status = normalized === "verify" ? "verified" : "rejected";
    await connection.query(
      `UPDATE equipment_finance_private_documents
          SET review_status = ?, reviewed_by = ?, reviewed_at = NOW(),
              review_notes = ?,
              approval_status = CASE WHEN ? = 'rejected' THEN 'rejected' ELSE approval_status END
        WHERE id = ?`,
      [status, reviewer, reason, status, document.id]
    );
    await writeDecisionHistory({
      connection,
      document,
      stage: "review",
      value: status,
      notes: reason,
      actor: reviewer,
      policyVersion: policy.policy_version,
    });
    await recordActivity({
      connection,
      req,
      actionType:
        status === "verified"
          ? "document_verified"
          : "document_review_rejected",
      actor: reviewer,
      description: `${status === "verified" ? "Verified" : "Rejected"} private document ${document.document_number} during independent review.`,
      applicationId: document.application_id,
      agreementId: document.agreement_id,
      documentId: document.id,
      metadata: { decision: status, notes: reason },
    });
    await connection.commit();
    return refreshDocumentCase(document);
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

async function approveDocument({ documentId, decision, notes, actor, req }) {
  const normalized = cleanText(decision, 20).toLowerCase();
  const reason = cleanText(notes);
  if (!APPROVAL_DECISIONS.has(normalized) || !reason) {
    throw new FinancePrivateDocumentError(
      400,
      "Choose approve or reject and enter independent approval notes.",
      "FINANCE_DOCUMENT_APPROVAL_INPUT_INVALID"
    );
  }
  const connection = await pool.getConnection();
  try {
    await assertReviewSchema(connection);
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT * FROM equipment_finance_private_documents
        WHERE id = ? AND document_status = 'active'
        LIMIT 1 FOR UPDATE`,
      [positiveId(documentId, "Document ID")]
    );
    const document = rows[0];
    if (!document) {
      throw new FinancePrivateDocumentError(
        404,
        "Active private Finance document was not found.",
        "FINANCE_DOCUMENT_NOT_FOUND"
      );
    }
    const approver = actorId(actor);
    if (
      !approver ||
      [document.uploaded_by, document.reviewed_by].some(
        (id) => Number(id || 0) === approver
      )
    ) {
      throw new FinancePrivateDocumentError(
        409,
        "The document approver must be different from both uploader and reviewer.",
        "FINANCE_DOCUMENT_INDEPENDENT_APPROVAL_REQUIRED"
      );
    }
    if (document.review_status !== "verified") {
      throw new FinancePrivateDocumentError(
        409,
        "Only an independently verified document can be approved.",
        "FINANCE_DOCUMENT_REVIEW_REQUIRED"
      );
    }
    if (document.approval_status !== "pending") {
      throw new FinancePrivateDocumentError(
        409,
        "This document approval was already decided.",
        "FINANCE_DOCUMENT_APPROVAL_ALREADY_DECIDED"
      );
    }
    const policy = await getReviewPolicy(connection);
    const status = normalized === "approve" ? "approved" : "rejected";
    await connection.query(
      `UPDATE equipment_finance_private_documents
          SET approval_status = ?, approved_by = ?, approved_at = NOW(),
              approval_notes = ?
        WHERE id = ?`,
      [status, approver, reason, document.id]
    );
    await writeDecisionHistory({
      connection,
      document,
      stage: "approval",
      value: status,
      notes: reason,
      actor: approver,
      policyVersion: policy.policy_version,
    });
    await recordActivity({
      connection,
      req,
      actionType:
        status === "approved"
          ? "document_approved"
          : "document_approval_rejected",
      actor: approver,
      description: `${status === "approved" ? "Approved" : "Rejected"} private document ${document.document_number}.`,
      applicationId: document.application_id,
      agreementId: document.agreement_id,
      documentId: document.id,
      metadata: { decision: status, notes: reason },
    });
    await connection.commit();
    return refreshDocumentCase(document);
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

async function archiveDocument({ documentId, reason, actor, req }) {
  const text = cleanText(reason, 1000);
  if (!text) {
    throw new FinancePrivateDocumentError(
      400,
      "An archive or replacement reason is required.",
      "FINANCE_DOCUMENT_ARCHIVE_REASON_REQUIRED"
    );
  }
  const connection = await pool.getConnection();
  try {
    await assertReviewSchema(connection);
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT * FROM equipment_finance_private_documents
        WHERE id = ? AND document_status = 'active'
        LIMIT 1 FOR UPDATE`,
      [positiveId(documentId, "Document ID")]
    );
    const document = rows[0];
    if (!document) {
      throw new FinancePrivateDocumentError(
        404,
        "Active private Finance document was not found.",
        "FINANCE_DOCUMENT_NOT_FOUND"
      );
    }
    const manager = actorId(actor);
    const policy = await getReviewPolicy(connection);
    await connection.query(
      `UPDATE equipment_finance_private_documents
          SET document_status = 'archived', archived_at = NOW(),
              archived_by = ?, archive_reason = ?
        WHERE id = ?`,
      [manager, text, document.id]
    );
    await writeDecisionHistory({
      connection,
      document,
      stage: "archive",
      value: "archived",
      notes: text,
      actor: manager,
      policyVersion: policy.policy_version,
    });
    await recordActivity({
      connection,
      req,
      actionType: "document_archived",
      actor: manager,
      description: `Archived private document ${document.document_number}; encrypted evidence and decisions remain preserved.`,
      applicationId: document.application_id,
      agreementId: document.agreement_id,
      documentId: document.id,
      metadata: { reason: text },
    });
    await connection.commit();
    return refreshDocumentCase(document);
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
  APPROVAL_DECISIONS,
  REVIEW_DECISIONS,
  approveDocument,
  archiveDocument,
  assertReviewSchema,
  getReviewCaseFile,
  getApplicationReviewCaseFile,
  getReviewPolicy,
  listReviewDocuments,
  listApplicationReviewDocuments,
  requiredDocumentStatus,
  reviewDocument,
};

