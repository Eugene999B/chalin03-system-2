const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { normalizeCategory } = require("../services/categoryIsolationService");
const {
  getDocumentSignatureSnapshot,
} = require("../services/documentSignatureService");
const { buildHrDocumentPdf } = require("../services/hrDocumentPdfService");

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function parseJson(value) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "{}") || {};
  } catch {
    return {};
  }
}

function activeWorkspace(req) {
  return normalizeCategory(req.user?.workspace_code) || "spare_parts";
}

function safeFilename(value) {
  return String(value || "worker-letter")
    .trim()
    .slice(0, 180)
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "worker-letter";
}

async function loadWorker(workerId, req) {
  const [rows] = await pool.query(
    `SELECT worker.id, worker.employee_number, worker.full_name, worker.preferred_name,
            worker.phone, worker.email, worker.job_title, worker.department,
            worker.workspace_code
     FROM worker_profiles worker
     WHERE worker.id = ? AND worker.workspace_code = ?
     LIMIT 1`,
    [workerId, activeWorkspace(req)]
  );
  return rows[0] || null;
}

async function loadLetter(letterId, workerId, req) {
  const [rows] = await pool.query(
    `SELECT *
     FROM worker_hr_letters
     WHERE id = ? AND worker_id = ? AND workspace_code = ?
     LIMIT 1`,
    [letterId, workerId, activeWorkspace(req)]
  );
  if (!rows[0]) return null;
  return { ...rows[0], payload: parseJson(rows[0].payload_json) };
}

router.post(
  "/workers-expanded/:id/hr-letters/:letterId/issue",
  requireAuth,
  requirePermission("workers.documents.manage", "workers.manage"),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);
    const letterId = positiveId(req.params.letterId);
    const worker = workerId ? await loadWorker(workerId, req) : null;
    const letter = worker && letterId ? await loadLetter(letterId, workerId, req) : null;

    if (!worker || !letter) {
      return res.status(404).json({
        status: "error",
        message: "Worker HR letter not found.",
      });
    }
    if (letter.status !== "draft") {
      return res.status(409).json({
        status: "error",
        message: "Only a draft letter can be issued.",
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
      `UPDATE worker_hr_letters
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
       WHERE id = ? AND worker_id = ? AND workspace_code = ?`,
      [
        signature.name,
        signature.title,
        signature.dataUrl,
        signature.name,
        signature.title,
        req.user.id,
        req.user.id,
        letterId,
        workerId,
        activeWorkspace(req),
      ]
    );

    await writeAuditEvent({
      req,
      action: "WORKER_HR_LETTER_ISSUED_WITH_SIGNATURE",
      details: `${letter.title} ${letter.letter_number} was approved and signed for ${worker.full_name}.`,
      entityType: "worker_hr_letter",
      entityId: letterId,
      severity: ["termination", "final_warning", "suspension"].includes(letter.letter_type)
        ? "warning"
        : "info",
      metadata: {
        worker_id: workerId,
        letter_number: letter.letter_number,
        letter_type: letter.letter_type,
        approval_signatory_name: signature.name,
      },
    });

    return res.json({
      status: "success",
      message:
        "Letter approved, signed and locked. The saved signature snapshot will not change if the boss updates the signature later.",
      letter: await loadLetter(letterId, workerId, req),
    });
  })
);

router.get(
  "/workers-expanded/:id/hr-letters/:letterId/pdf",
  requireAuth,
  requirePermission("workers.documents.view"),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);
    const letterId = positiveId(req.params.letterId);
    const worker = workerId ? await loadWorker(workerId, req) : null;
    const letter = worker && letterId ? await loadLetter(letterId, workerId, req) : null;

    if (!worker || !letter) {
      return res.status(404).json({
        status: "error",
        message: "Worker HR letter not found.",
      });
    }

    const person = {
      full_name: worker.full_name,
      preferred_name: worker.preferred_name,
      employee_number: worker.employee_number,
      phone: worker.phone,
      email: worker.email,
      job_title: worker.job_title,
      address: letter.payload?.recipient_address,
    };

    const signatureSnapshot = letter.approval_signature_data_url
      ? {
          dataUrl: letter.approval_signature_data_url,
          name: letter.approval_signatory_name || letter.signatory_name,
          title: letter.approval_signatory_title || letter.signatory_title,
        }
      : null;

    const buffer = await buildHrDocumentPdf({
      letter,
      person,
      workspaceCode: worker.workspace_code,
      signatureSnapshot,
    });

    await writeAuditEvent({
      req,
      action: "WORKER_HR_LETTER_PDF_V2_GENERATED",
      details: `Compact professional PDF generated for worker HR letter ${letter.letter_number || letter.id}.`,
      entityType: "worker_hr_letter",
      entityId: letterId,
      metadata: {
        worker_id: workerId,
        letter_number: letter.letter_number,
        status: letter.status,
      },
    });

    const filename = safeFilename(
      `${letter.letter_number || "DRAFT"}_${worker.employee_number}_${letter.letter_type}`
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
