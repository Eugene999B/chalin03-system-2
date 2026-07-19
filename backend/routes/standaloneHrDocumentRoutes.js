const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { normalizeCategory } = require("../services/categoryIsolationService");
const {
  getDocumentSignatureSnapshot,
  loadDocumentSignature,
} = require("../services/documentSignatureService");
const { buildHrDocumentPdf } = require("../services/hrDocumentPdfService");
const {
  LETTER_TYPES,
  DEFAULT_WORKPLACE_RULES,
  workspacePrefix,
} = require("../services/hrDocumentTemplates");

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function cleanText(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function nullableText(value, maxLength = 255) {
  const text = cleanText(value, maxLength);
  return text || null;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function dateOnly(value) {
  const text = cleanText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function moneyValue(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Number(number.toFixed(2)) : null;
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "{}") || fallback;
  } catch {
    return fallback;
  }
}

function activeWorkspace(req) {
  return normalizeCategory(req.user?.workspace_code) || "spare_parts";
}

function cleanRules(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, 500))
    .filter(Boolean)
    .slice(0, 30);
}

function cleanPayload(body = {}) {
  return {
    recipient_address: nullableText(body.recipient_address, 1000),
    role: nullableText(body.role, 180),
    department: nullableText(body.department, 180),
    work_location: nullableText(body.work_location, 255),
    employment_type: nullableText(body.employment_type, 80),
    start_date: dateOnly(body.start_date),
    salary_amount: moneyValue(body.salary_amount),
    pay_frequency: nullableText(body.pay_frequency, 80),
    probation_period: nullableText(body.probation_period, 180),
    reporting_to: nullableText(body.reporting_to, 180),
    working_schedule: nullableText(body.working_schedule, 500),
    leave_terms: nullableText(body.leave_terms, 1000),
    notice_terms: nullableText(body.notice_terms, 1000),
    benefits: nullableText(body.benefits, 1500),
    reason: nullableText(body.reason, 3000),
    incident_date: dateOnly(body.incident_date),
    prior_action: nullableText(body.prior_action, 2000),
    action_required: nullableText(body.action_required, 2000),
    response_instructions: nullableText(body.response_instructions, 1500),
    suspension_terms: nullableText(body.suspension_terms, 1500),
    final_dues: nullableText(body.final_dues, 1500),
    property_return: nullableText(body.property_return, 1500),
    handover_requirements: nullableText(body.handover_requirements, 1500),
    new_role: nullableText(body.new_role, 180),
    new_department: nullableText(body.new_department, 180),
    new_location: nullableText(body.new_location, 255),
    additional_terms: nullableText(body.additional_terms, 4000),
    worker_agreement:
      nullableText(body.worker_agreement, 2000) ||
      "I confirm that I have read or had this document explained to me, understand its contents and have received a copy. My signature confirms receipt and, where acceptance is required, my agreement to the stated terms.",
    management_note: nullableText(body.management_note, 2000),
    rules: cleanRules(body.rules),
  };
}

function validateInput(body) {
  const recipient = body?.recipient || {};
  const recipientFullName = cleanText(recipient.full_name, 180);
  const letterType = cleanText(body?.letter_type, 50).toLowerCase();
  const template = LETTER_TYPES[letterType];
  const letterDate = dateOnly(body?.letter_date);
  const signatoryName = cleanText(body?.signatory_name, 150);
  const signatoryTitle = cleanText(body?.signatory_title, 150);
  const payload = cleanPayload({
    ...(body?.payload || {}),
    recipient_address:
      body?.payload?.recipient_address || recipient.address || "",
  });

  if (!recipientFullName) {
    const error = new Error("Enter the name of the person receiving the document.");
    error.statusCode = 400;
    throw error;
  }
  if (!template) {
    const error = new Error("Choose a supported employment or HR document type.");
    error.statusCode = 400;
    throw error;
  }
  if (!letterDate || !signatoryName || !signatoryTitle) {
    const error = new Error(
      "Document date, authorised signatory name and signatory title are required."
    );
    error.statusCode = 400;
    throw error;
  }
  if (
    ["show_cause", "warning", "final_warning", "suspension", "termination"].includes(
      letterType
    ) &&
    !payload.reason
  ) {
    const error = new Error(
      "The reason and factual details are required for this document type."
    );
    error.statusCode = 400;
    throw error;
  }
  if (letterType === "employment" && (!payload.role || !payload.start_date)) {
    const error = new Error(
      "Employment documents require the proposed role and employment start date."
    );
    error.statusCode = 400;
    throw error;
  }

  return {
    recipient: {
      fullName: recipientFullName,
      preferredName: nullableText(recipient.preferred_name, 120),
      phone: nullableText(recipient.phone, 40),
      email: nullableText(recipient.email, 180),
      address: nullableText(recipient.address, 1000),
    },
    letterType,
    template,
    title: cleanText(body?.title, 180) || template.title,
    subject: nullableText(body?.subject, 255) || template.title,
    letterDate,
    effectiveDate: dateOnly(body?.effective_date),
    responseDueDate: dateOnly(body?.response_due_date),
    signatoryName,
    signatoryTitle,
    payload,
  };
}

function makeLetterNumber(workspaceCode, template, letterDate, id) {
  const year = String(letterDate || new Date().getFullYear()).slice(0, 4);
  return `C03-${workspacePrefix(workspaceCode)}-EXT-${template.prefix}-${year}-${String(id).padStart(6, "0")}`;
}

function safeFilename(value) {
  return cleanText(value, 180)
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "employment-document";
}

async function loadDocument(documentId, req) {
  const [rows] = await pool.query(
    `SELECT document_record.*,
            linked_worker.employee_number AS linked_worker_number,
            linked_worker.full_name AS linked_worker_name,
            creator.full_name AS created_by_name,
            issuer.full_name AS issued_by_name
     FROM standalone_hr_documents document_record
     LEFT JOIN worker_profiles linked_worker
       ON linked_worker.id = document_record.linked_worker_id
     LEFT JOIN users creator ON creator.id = document_record.created_by
     LEFT JOIN users issuer ON issuer.id = document_record.issued_by
     WHERE document_record.id = ?
       AND document_record.workspace_code = ?
     LIMIT 1`,
    [documentId, activeWorkspace(req)]
  );
  if (!rows[0]) return null;
  return {
    ...rows[0],
    payload: parseJson(rows[0].payload_json),
    payload_json: undefined,
  };
}

router.get(
  "/standalone-hr/options",
  requireAuth,
  requirePermission("workers.documents.view"),
  asyncHandler(async (req, res) => {
    const signature = await loadDocumentSignature();
    return res.json({
      status: "success",
      letter_types: Object.entries(LETTER_TYPES).map(([code, item]) => ({
        code,
        title: item.title,
      })),
      default_rules: DEFAULT_WORKPLACE_RULES,
      legal_review_note:
        "A human manager must verify every fact, contract term, disciplinary reason and legal requirement before issue.",
      signature: signature
        ? {
            configured: true,
            signatory_name: signature.signatory_name,
            signatory_title: signature.signatory_title,
            updated_at: signature.updated_at,
          }
        : { configured: false },
    });
  })
);

router.get(
  "/standalone-hr/documents",
  requireAuth,
  requirePermission("workers.documents.view"),
  asyncHandler(async (req, res) => {
    const search = cleanText(req.query?.search, 180);
    const values = [activeWorkspace(req)];
    let searchClause = "";
    if (search) {
      searchClause = `AND (
        document_record.recipient_full_name LIKE ? OR
        document_record.letter_number LIKE ? OR
        document_record.title LIKE ?
      )`;
      const term = `%${search}%`;
      values.push(term, term, term);
    }

    const [rows] = await pool.query(
      `SELECT document_record.*,
              linked_worker.employee_number AS linked_worker_number,
              linked_worker.full_name AS linked_worker_name,
              creator.full_name AS created_by_name,
              issuer.full_name AS issued_by_name
       FROM standalone_hr_documents document_record
       LEFT JOIN worker_profiles linked_worker
         ON linked_worker.id = document_record.linked_worker_id
       LEFT JOIN users creator ON creator.id = document_record.created_by
       LEFT JOIN users issuer ON issuer.id = document_record.issued_by
       WHERE document_record.workspace_code = ?
       ${searchClause}
       ORDER BY document_record.letter_date DESC, document_record.id DESC
       LIMIT 250`,
      values
    );

    return res.json({
      status: "success",
      documents: rows.map((row) => ({
        ...row,
        payload: parseJson(row.payload_json),
        payload_json: undefined,
      })),
    });
  })
);

router.post(
  "/standalone-hr/documents",
  requireAuth,
  requirePermission("workers.documents.manage"),
  asyncHandler(async (req, res) => {
    const input = validateInput(req.body || {});
    const workspaceCode = activeWorkspace(req);

    const [result] = await pool.query(
      `INSERT INTO standalone_hr_documents (
         workspace_code,
         recipient_full_name,
         recipient_preferred_name,
         recipient_phone,
         recipient_email,
         recipient_address,
         letter_type,
         title,
         subject,
         letter_date,
         effective_date,
         response_due_date,
         payload_json,
         signatory_name,
         signatory_title,
         worker_acknowledgement_status,
         created_by,
         updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        workspaceCode,
        input.recipient.fullName,
        input.recipient.preferredName,
        input.recipient.phone,
        input.recipient.email,
        input.recipient.address,
        input.letterType,
        input.title,
        input.subject,
        input.letterDate,
        input.effectiveDate,
        input.responseDueDate,
        JSON.stringify(input.payload),
        input.signatoryName,
        input.signatoryTitle,
        req.user.id,
        req.user.id,
      ]
    );

    const letterNumber = makeLetterNumber(
      workspaceCode,
      input.template,
      input.letterDate,
      result.insertId
    );
    await pool.query(
      "UPDATE standalone_hr_documents SET letter_number = ? WHERE id = ?",
      [letterNumber, result.insertId]
    );

    await writeAuditEvent({
      req,
      action: "STANDALONE_HR_DOCUMENT_CREATED",
      details: `${input.title} ${letterNumber} was saved as a draft for ${input.recipient.fullName} before worker registration.`,
      entityType: "standalone_hr_document",
      entityId: result.insertId,
      metadata: {
        recipient_name: input.recipient.fullName,
        letter_type: input.letterType,
        letter_number: letterNumber,
      },
    });

    return res.status(201).json({
      status: "success",
      message: `${input.title} saved as a standalone draft.`,
      document: await loadDocument(result.insertId, req),
    });
  })
);

router.put(
  "/standalone-hr/documents/:documentId",
  requireAuth,
  requirePermission("workers.documents.manage"),
  asyncHandler(async (req, res) => {
    const documentId = positiveId(req.params.documentId);
    const current = documentId ? await loadDocument(documentId, req) : null;
    if (!current) {
      return res.status(404).json({
        status: "error",
        message: "Standalone employment document not found.",
      });
    }
    if (current.status !== "draft") {
      return res.status(409).json({
        status: "error",
        message:
          "Only draft documents can be edited. Issued documents are permanent records.",
      });
    }

    const input = validateInput(req.body || {});
    await pool.query(
      `UPDATE standalone_hr_documents
       SET recipient_full_name = ?, recipient_preferred_name = ?, recipient_phone = ?,
           recipient_email = ?, recipient_address = ?, letter_type = ?, title = ?, subject = ?,
           letter_date = ?, effective_date = ?, response_due_date = ?, payload_json = ?,
           signatory_name = ?, signatory_title = ?, updated_by = ?
       WHERE id = ? AND workspace_code = ?`,
      [
        input.recipient.fullName,
        input.recipient.preferredName,
        input.recipient.phone,
        input.recipient.email,
        input.recipient.address,
        input.letterType,
        input.title,
        input.subject,
        input.letterDate,
        input.effectiveDate,
        input.responseDueDate,
        JSON.stringify(input.payload),
        input.signatoryName,
        input.signatoryTitle,
        req.user.id,
        documentId,
        activeWorkspace(req),
      ]
    );

    await writeAuditEvent({
      req,
      action: "STANDALONE_HR_DOCUMENT_UPDATED",
      details: `Standalone draft ${current.letter_number} was updated for ${input.recipient.fullName}.`,
      entityType: "standalone_hr_document",
      entityId: documentId,
      metadata: { letter_number: current.letter_number },
    });

    return res.json({
      status: "success",
      message: "Standalone draft updated.",
      document: await loadDocument(documentId, req),
    });
  })
);

router.post(
  "/standalone-hr/documents/:documentId/issue",
  requireAuth,
  requirePermission("workers.documents.manage", "workers.manage"),
  asyncHandler(async (req, res) => {
    const documentId = positiveId(req.params.documentId);
    const document = documentId ? await loadDocument(documentId, req) : null;
    if (!document) {
      return res.status(404).json({
        status: "error",
        message: "Standalone employment document not found.",
      });
    }
    if (document.status !== "draft") {
      return res.status(409).json({
        status: "error",
        message: "Only a draft document can be approved and issued.",
      });
    }

    const signature = await getDocumentSignatureSnapshot();
    if (!signature) {
      return res.status(409).json({
        status: "error",
        message:
          "Save the boss's authorised signature in Document Signature Settings before approving this document.",
      });
    }

    await pool.query(
      `UPDATE standalone_hr_documents
       SET status = 'issued',
           signatory_name = ?,
           signatory_title = ?,
           approval_signature_data_url = ?,
           approval_signatory_name = ?,
           approval_signatory_title = ?,
           signature_captured_at = NOW(),
           issued_by = ?,
           issued_at = NOW(),
           updated_by = ?
       WHERE id = ? AND workspace_code = ?`,
      [
        signature.name,
        signature.title,
        signature.dataUrl,
        signature.name,
        signature.title,
        req.user.id,
        req.user.id,
        documentId,
        activeWorkspace(req),
      ]
    );

    await writeAuditEvent({
      req,
      action: "STANDALONE_HR_DOCUMENT_ISSUED",
      details: `${document.title} ${document.letter_number} was approved and signed for ${document.recipient_full_name}.`,
      entityType: "standalone_hr_document",
      entityId: documentId,
      severity: ["termination", "final_warning", "suspension"].includes(
        document.letter_type
      )
        ? "warning"
        : "info",
      metadata: {
        letter_number: document.letter_number,
        recipient_name: document.recipient_full_name,
        approval_signatory_name: signature.name,
      },
    });

    return res.json({
      status: "success",
      message:
        "Document approved, signed and locked. It can be linked to the worker profile after onboarding.",
      document: await loadDocument(documentId, req),
    });
  })
);

router.post(
  "/standalone-hr/documents/:documentId/acknowledge",
  requireAuth,
  requirePermission("workers.documents.manage"),
  asyncHandler(async (req, res) => {
    const documentId = positiveId(req.params.documentId);
    const document = documentId ? await loadDocument(documentId, req) : null;
    if (!document) {
      return res.status(404).json({
        status: "error",
        message: "Standalone employment document not found.",
      });
    }
    if (!["issued", "acknowledged"].includes(document.status)) {
      return res.status(409).json({
        status: "error",
        message: "Approve and issue the document before recording acknowledgement.",
      });
    }

    const acknowledgementStatus = cleanText(
      req.body?.acknowledgement_status,
      30
    ).toLowerCase();
    const allowed = new Set(["accepted", "received", "declined", "not_required"]);
    const acknowledgedName = cleanText(req.body?.acknowledged_name, 150);

    if (
      !allowed.has(acknowledgementStatus) ||
      (!acknowledgedName && acknowledgementStatus !== "not_required")
    ) {
      return res.status(400).json({
        status: "error",
        message:
          "Choose a valid acknowledgement result and enter the recipient or witness name.",
      });
    }

    await pool.query(
      `UPDATE standalone_hr_documents
       SET status = 'acknowledged',
           worker_acknowledgement_status = ?,
           worker_acknowledged_name = ?,
           worker_acknowledged_at = NOW(),
           worker_acknowledgement_note = ?,
           updated_by = ?
       WHERE id = ? AND workspace_code = ?`,
      [
        acknowledgementStatus,
        acknowledgedName || null,
        nullableText(req.body?.note, 2000),
        req.user.id,
        documentId,
        activeWorkspace(req),
      ]
    );

    await writeAuditEvent({
      req,
      action: "STANDALONE_HR_DOCUMENT_ACKNOWLEDGED",
      details: `Acknowledgement for ${document.letter_number} was recorded as ${acknowledgementStatus}.`,
      entityType: "standalone_hr_document",
      entityId: documentId,
      metadata: {
        letter_number: document.letter_number,
        acknowledgement_status: acknowledgementStatus,
      },
    });

    return res.json({
      status: "success",
      message: "Recipient acknowledgement recorded.",
      document: await loadDocument(documentId, req),
    });
  })
);

router.post(
  "/standalone-hr/documents/:documentId/cancel",
  requireAuth,
  requirePermission("workers.documents.manage", "workers.manage"),
  asyncHandler(async (req, res) => {
    const documentId = positiveId(req.params.documentId);
    const document = documentId ? await loadDocument(documentId, req) : null;
    const reason = cleanText(req.body?.reason, 1000);
    if (!document) {
      return res.status(404).json({
        status: "error",
        message: "Standalone employment document not found.",
      });
    }
    if (!reason) {
      return res.status(400).json({
        status: "error",
        message: "An archive reason is required.",
      });
    }
    if (document.status === "cancelled") {
      return res.status(409).json({
        status: "error",
        message: "This document is already archived.",
      });
    }

    await pool.query(
      `UPDATE standalone_hr_documents
       SET status = 'cancelled', cancelled_by = ?, cancelled_at = NOW(),
           cancellation_reason = ?, updated_by = ?
       WHERE id = ? AND workspace_code = ?`,
      [req.user.id, reason, req.user.id, documentId, activeWorkspace(req)]
    );

    await writeAuditEvent({
      req,
      action: "STANDALONE_HR_DOCUMENT_CANCELLED",
      details: `Standalone HR document ${document.letter_number} was archived.`,
      entityType: "standalone_hr_document",
      entityId: documentId,
      severity: "warning",
      metadata: { letter_number: document.letter_number, reason },
    });

    return res.json({
      status: "success",
      message: "Document archived. Its audit history remains preserved.",
      document: await loadDocument(documentId, req),
    });
  })
);

router.post(
  "/standalone-hr/documents/:documentId/link-worker",
  requireAuth,
  requirePermission("workers.documents.manage", "workers.manage"),
  asyncHandler(async (req, res) => {
    const documentId = positiveId(req.params.documentId);
    const workerId = positiveId(req.body?.worker_id);
    const document = documentId ? await loadDocument(documentId, req) : null;

    if (!document || !workerId) {
      return res.status(400).json({
        status: "error",
        message: "Choose a valid standalone document and registered worker profile.",
      });
    }
    if (document.linked_worker_letter_id) {
      return res.status(409).json({
        status: "error",
        message: "This document is already linked to a worker profile.",
      });
    }

    const [workerRows] = await pool.query(
      `SELECT id, employee_number, full_name, workspace_code
       FROM worker_profiles
       WHERE id = ? AND workspace_code = ?
       LIMIT 1`,
      [workerId, activeWorkspace(req)]
    );
    const worker = workerRows[0];
    if (!worker) {
      return res.status(404).json({
        status: "error",
        message: "The selected worker profile was not found in this workspace.",
      });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [copyResult] = await connection.query(
        `INSERT INTO worker_hr_letters (
           worker_id, workspace_code, letter_number, letter_type, title, subject,
           letter_date, effective_date, response_due_date, status, payload_json,
           signatory_name, signatory_title, approval_signature_data_url,
           approval_signatory_name, approval_signatory_title, signature_captured_at,
           worker_acknowledgement_status, worker_acknowledged_name,
           worker_acknowledged_at, worker_acknowledgement_note, issued_by, issued_at,
           cancelled_by, cancelled_at, cancellation_reason, created_by, updated_by,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          worker.id,
          document.workspace_code,
          document.letter_number,
          document.letter_type,
          document.title,
          document.subject,
          document.letter_date,
          document.effective_date,
          document.response_due_date,
          document.status,
          JSON.stringify(document.payload || {}),
          document.signatory_name,
          document.signatory_title,
          document.approval_signature_data_url,
          document.approval_signatory_name,
          document.approval_signatory_title,
          document.signature_captured_at,
          document.worker_acknowledgement_status,
          document.worker_acknowledged_name,
          document.worker_acknowledged_at,
          document.worker_acknowledgement_note,
          document.issued_by,
          document.issued_at,
          document.cancelled_by,
          document.cancelled_at,
          document.cancellation_reason,
          document.created_by,
          req.user.id,
          document.created_at,
          document.updated_at,
        ]
      );

      await connection.query(
        `UPDATE standalone_hr_documents
         SET linked_worker_id = ?, linked_worker_letter_id = ?, updated_by = ?
         WHERE id = ? AND workspace_code = ?`,
        [
          worker.id,
          copyResult.insertId,
          req.user.id,
          documentId,
          activeWorkspace(req),
        ]
      );
      await connection.commit();

      await writeAuditEvent({
        req,
        action: "STANDALONE_HR_DOCUMENT_LINKED_TO_WORKER",
        details: `${document.letter_number} was linked to worker ${worker.employee_number} (${worker.full_name}).`,
        entityType: "standalone_hr_document",
        entityId: documentId,
        metadata: {
          worker_id: worker.id,
          worker_employee_number: worker.employee_number,
          worker_hr_letter_id: copyResult.insertId,
          letter_number: document.letter_number,
        },
      });
    } catch (error) {
      await connection.rollback();
      if (error.code === "ER_DUP_ENTRY") {
        error.statusCode = 409;
        error.message =
          "This document number already exists in a worker profile. Refresh and verify the existing link.";
      }
      throw error;
    } finally {
      connection.release();
    }

    return res.json({
      status: "success",
      message: `${document.letter_number} is now preserved in ${worker.full_name}'s worker profile.`,
      document: await loadDocument(documentId, req),
    });
  })
);

router.get(
  "/standalone-hr/documents/:documentId/pdf",
  requireAuth,
  requirePermission("workers.documents.view"),
  asyncHandler(async (req, res) => {
    const documentId = positiveId(req.params.documentId);
    const document = documentId ? await loadDocument(documentId, req) : null;
    if (!document) {
      return res.status(404).json({
        status: "error",
        message: "Standalone employment document not found.",
      });
    }

    const person = {
      full_name: document.recipient_full_name,
      preferred_name: document.recipient_preferred_name,
      phone: document.recipient_phone,
      email: document.recipient_email,
      job_title: document.payload?.role,
      address: document.recipient_address || document.payload?.recipient_address,
    };
    const signatureSnapshot = document.approval_signature_data_url
      ? {
          dataUrl: document.approval_signature_data_url,
          name: document.approval_signatory_name || document.signatory_name,
          title: document.approval_signatory_title || document.signatory_title,
        }
      : null;

    const buffer = await buildHrDocumentPdf({
      letter: document,
      person,
      workspaceCode: document.workspace_code,
      signatureSnapshot,
    });

    await writeAuditEvent({
      req,
      action: "STANDALONE_HR_DOCUMENT_PDF_GENERATED",
      details: `PDF generated for standalone HR document ${document.letter_number || document.id}.`,
      entityType: "standalone_hr_document",
      entityId: documentId,
      metadata: {
        letter_number: document.letter_number,
        recipient_name: document.recipient_full_name,
        status: document.status,
      },
    });

    const filename = safeFilename(
      `${document.letter_number || "DRAFT"}_${document.recipient_full_name}_${document.letter_type}`
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}.pdf"`);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, Content-Length");
    return res.end(buffer);
  })
);

module.exports = router;
