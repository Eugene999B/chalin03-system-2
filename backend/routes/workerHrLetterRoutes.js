const express = require("express");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { normalizeCategory } = require("../services/categoryIsolationService");

const router = express.Router();

const LETTER_TYPES = Object.freeze({
  employment: {
    title: "Employment / Appointment Letter",
    prefix: "EMP",
    acknowledgement: "accepted",
  },
  probation_confirmation: {
    title: "Confirmation of Employment",
    prefix: "CNF",
    acknowledgement: "received",
  },
  probation_extension: {
    title: "Probation Extension Letter",
    prefix: "PBE",
    acknowledgement: "received",
  },
  show_cause: {
    title: "Notice to Explain / Show Cause",
    prefix: "NTE",
    acknowledgement: "received",
  },
  warning: {
    title: "Written Warning Letter",
    prefix: "WRN",
    acknowledgement: "received",
  },
  final_warning: {
    title: "Final Written Warning Letter",
    prefix: "FWR",
    acknowledgement: "received",
  },
  suspension: {
    title: "Suspension Letter",
    prefix: "SUS",
    acknowledgement: "received",
  },
  termination: {
    title: "Termination of Employment Letter",
    prefix: "TRM",
    acknowledgement: "received",
  },
  promotion_transfer: {
    title: "Promotion / Transfer Letter",
    prefix: "PTR",
    acknowledgement: "accepted",
  },
  resignation_acceptance: {
    title: "Resignation Acceptance and Clearance Letter",
    prefix: "RSG",
    acknowledgement: "received",
  },
});

const DEFAULT_WORKPLACE_RULES = Object.freeze([
  "Report to work punctually and follow the approved attendance, shift and leave procedures.",
  "Perform assigned duties carefully and obey lawful and reasonable instructions from authorised supervisors.",
  "Follow all health, safety, environmental and personal protective equipment requirements.",
  "Protect company money, stock, fuel, tools, machinery, vehicles, documents, passwords and other property.",
  "Record sales, stock, fuel, production, equipment hours, payments and other business information honestly and accurately.",
  "Do not steal, defraud, falsify records, divert company resources or make unauthorised transactions.",
  "Do not report to work under the influence of alcohol or illegal drugs and do not possess them at the workplace.",
  "Treat customers, colleagues, contractors and supervisors respectfully; harassment, discrimination, threats and violence are prohibited.",
  "Keep confidential company, customer, worker, pricing, financial and operational information secure.",
  "Use only your own authorised system account and never share passwords, access codes or identity cards.",
  "Report accidents, safety hazards, losses, damage, misconduct and suspected fraud promptly.",
  "Do not accept bribes, secret commissions or undisclosed personal benefits connected with company work.",
  "Avoid conflicts of interest and disclose any outside activity that may affect company duties.",
  "Obtain approval before being absent, leaving the assigned work location or using company property for private purposes.",
  "Return all company property, records, keys, identity cards and equipment when requested or when employment ends.",
  "Comply with the procedures of the assigned Spare Parts store, Mining site or Equipment Hire location.",
]);

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
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Number(number.toFixed(2)) : null;
}

function activeWorkspace(req) {
  return normalizeCategory(req.user?.workspace_code) || "spare_parts";
}

function workspaceLabel(code) {
  if (code === "mining") return "Mining Operations";
  if (code === "equipment_hire") return "Equipment Hire";
  return "Spare Parts";
}

function workspacePrefix(code) {
  if (code === "mining") return "MIN";
  if (code === "equipment_hire") return "HIRE";
  return "SP";
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "{}") || fallback;
  } catch {
    return fallback;
  }
}

function cleanRules(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, 500))
    .filter(Boolean)
    .slice(0, 30);
}

function cleanPayload(body, worker) {
  return {
    recipient_address: nullableText(body.recipient_address, 1000),
    role: nullableText(body.role || worker.job_title, 180),
    department: nullableText(body.department || worker.department, 180),
    work_location: nullableText(body.work_location, 255),
    employment_type: nullableText(body.employment_type || worker.employment_type, 80),
    start_date: dateOnly(body.start_date || worker.employment_start_date),
    salary_amount: moneyValue(body.salary_amount),
    pay_frequency: nullableText(body.pay_frequency, 80),
    probation_period: nullableText(body.probation_period, 180),
    reporting_to: nullableText(body.reporting_to || worker.supervisor_name, 180),
    working_schedule: nullableText(body.working_schedule, 500),
    leave_terms: nullableText(body.leave_terms, 500),
    notice_terms: nullableText(body.notice_terms, 500),
    benefits: nullableText(body.benefits, 1000),
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
    worker_agreement: nullableText(
      body.worker_agreement,
      2000
    ) ||
      "I confirm that I have read or had this letter explained to me, understand its contents, and have received a copy. My signature confirms receipt and, where the letter requires acceptance, my agreement to the stated terms.",
    management_note: nullableText(body.management_note, 2000),
    rules: cleanRules(body.rules),
  };
}

function safeFilename(value) {
  return cleanText(value, 180)
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "worker-letter";
}

function formatDate(value, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cleanText(value, 40) || fallback;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  return `GHS ${Number(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function findLogoPath() {
  const candidates = [
    path.resolve(__dirname, "..", "..", "frontend", "public", "chalin03-logo.png"),
    path.resolve(process.cwd(), "..", "frontend", "public", "chalin03-logo.png"),
    path.resolve(process.cwd(), "frontend", "public", "chalin03-logo.png"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

const LOGO_PATH = findLogoPath();

async function loadWorker(workerId, req) {
  const [rows] = await pool.query(
    `SELECT
       worker.id,
       worker.employee_number,
       worker.full_name,
       worker.preferred_name,
       worker.phone,
       worker.email,
       worker.job_title,
       worker.department,
       worker.employment_type,
       worker.employment_status,
       worker.employment_start_date,
       worker.workspace_code,
       worker.business_unit_id,
       supervisor.full_name AS supervisor_name
     FROM worker_profiles worker
     LEFT JOIN worker_profiles supervisor
       ON supervisor.id = worker.supervisor_worker_id
     WHERE worker.id = ?
       AND worker.workspace_code = ?
     LIMIT 1`,
    [workerId, activeWorkspace(req)]
  );
  return rows[0] || null;
}

async function loadLetter(letterId, workerId, req) {
  const [rows] = await pool.query(
    `SELECT
       letter_record.*,
       creator.full_name AS created_by_name,
       issuer.full_name AS issued_by_name,
       canceller.full_name AS cancelled_by_name
     FROM worker_hr_letters letter_record
     LEFT JOIN users creator ON creator.id = letter_record.created_by
     LEFT JOIN users issuer ON issuer.id = letter_record.issued_by
     LEFT JOIN users canceller ON canceller.id = letter_record.cancelled_by
     WHERE letter_record.id = ?
       AND letter_record.worker_id = ?
       AND letter_record.workspace_code = ?
     LIMIT 1`,
    [letterId, workerId, activeWorkspace(req)]
  );

  if (!rows[0]) return null;
  return { ...rows[0], payload: parseJson(rows[0].payload_json) };
}

function validateLetterInput(body, worker) {
  const letterType = cleanText(body.letter_type, 50).toLowerCase();
  const template = LETTER_TYPES[letterType];

  if (!template) {
    const error = new Error("Choose a supported HR letter type.");
    error.statusCode = 400;
    throw error;
  }

  const letterDate = dateOnly(body.letter_date);
  const signatoryName = cleanText(body.signatory_name, 150);
  const signatoryTitle = cleanText(body.signatory_title, 150);
  const payload = cleanPayload(body.payload || {}, worker);

  if (!letterDate || !signatoryName || !signatoryTitle) {
    const error = new Error(
      "Letter date, authorised signatory name and signatory title are required."
    );
    error.statusCode = 400;
    throw error;
  }

  if (["show_cause", "warning", "final_warning", "suspension", "termination"].includes(letterType) && !payload.reason) {
    const error = new Error("The reason and factual details are required for this letter type.");
    error.statusCode = 400;
    throw error;
  }

  if (letterType === "employment" && (!payload.role || !payload.start_date)) {
    const error = new Error("Employment letters require a role and employment start date.");
    error.statusCode = 400;
    throw error;
  }

  return {
    letterType,
    template,
    title: cleanText(body.title, 180) || template.title,
    subject: nullableText(body.subject, 255) || template.title,
    letterDate,
    effectiveDate: dateOnly(body.effective_date),
    responseDueDate: dateOnly(body.response_due_date),
    signatoryName,
    signatoryTitle,
    payload,
  };
}

function makeLetterNumber(workspaceCode, template, letterDate, id) {
  const year = String(letterDate || new Date().getFullYear()).slice(0, 4);
  return `C03-${workspacePrefix(workspaceCode)}-${template.prefix}-${year}-${String(id).padStart(6, "0")}`;
}

function writeParagraph(doc, text, options = {}) {
  if (!text) return;
  doc
    .font(options.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(options.size || 10.5)
    .fillColor(options.color || "#1f2937")
    .text(String(text), {
      align: options.align || "justify",
      lineGap: options.lineGap ?? 3,
      paragraphGap: options.paragraphGap ?? 8,
    });
}

function writeLabelValue(doc, label, value) {
  if (!value) return;
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#0f172a").text(`${label}: `, { continued: true });
  doc.font("Helvetica").fillColor("#334155").text(String(value));
}

function addPageNumber(doc) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc.font("Helvetica").fontSize(8).fillColor("#64748b").text(
      `Chalin 03 Company Limited · Confidential personnel document · Page ${index + 1} of ${range.count}`,
      50,
      doc.page.height - 35,
      { width: doc.page.width - 100, align: "center", lineBreak: false }
    );
  }
}

function drawLetterHeader(doc, letter, worker) {
  const top = 42;
  if (LOGO_PATH) {
    try {
      doc.image(LOGO_PATH, 50, top, { fit: [58, 58], align: "center", valign: "center" });
    } catch {
      // Text branding below remains available.
    }
  }

  doc.font("Helvetica-Bold").fontSize(18).fillColor("#07182c").text(
    "CHALIN 03 COMPANY LIMITED",
    120,
    top + 2,
    { width: doc.page.width - 170, align: "center" }
  );
  doc.font("Helvetica").fontSize(9.5).fillColor("#475569").text(
    `${workspaceLabel(worker.workspace_code)} · Personnel and Human Resources`,
    120,
    top + 29,
    { width: doc.page.width - 170, align: "center" }
  );
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#9a7b00").text(
    letter.letter_number || "DRAFT LETTER",
    120,
    top + 47,
    { width: doc.page.width - 170, align: "center" }
  );

  doc.moveTo(50, 112).lineTo(doc.page.width - 50, 112).lineWidth(1.2).strokeColor("#e7bf2e").stroke();
  doc.y = 126;
}

function writeEmploymentTerms(doc, payload) {
  const terms = [
    ["Position", payload.role],
    ["Department", payload.department],
    ["Work location", payload.work_location],
    ["Employment type", payload.employment_type],
    ["Start date", payload.start_date ? formatDate(payload.start_date) : null],
    ["Salary", formatMoney(payload.salary_amount)],
    ["Pay frequency", payload.pay_frequency],
    ["Probation", payload.probation_period],
    ["Reports to", payload.reporting_to],
    ["Working schedule", payload.working_schedule],
    ["Leave terms", payload.leave_terms],
    ["Notice terms", payload.notice_terms],
    ["Benefits", payload.benefits],
  ];

  doc.font("Helvetica-Bold").fontSize(11).fillColor("#07182c").text("Main employment terms", { paragraphGap: 6 });
  terms.forEach(([label, value]) => writeLabelValue(doc, label, value));
  doc.moveDown(0.6);
}

function writeRules(doc, rules) {
  if (!Array.isArray(rules) || rules.length === 0) return;
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#07182c").text("Rules and responsibilities", { paragraphGap: 5 });
  rules.forEach((rule, index) => {
    doc.font("Helvetica").fontSize(9.7).fillColor("#334155").text(`${index + 1}. ${rule}`, {
      indent: 8,
      lineGap: 2,
      paragraphGap: 4,
    });
  });
  doc.moveDown(0.5);
}

function writeLetterBody(doc, letter, worker) {
  const payload = letter.payload;
  const type = letter.letter_type;

  writeParagraph(doc, formatDate(letter.letter_date), { align: "right" });
  writeParagraph(doc, worker.full_name, { bold: true, align: "left", paragraphGap: 1 });
  writeParagraph(doc, worker.employee_number, { align: "left", paragraphGap: 1 });
  if (payload.recipient_address) writeParagraph(doc, payload.recipient_address, { align: "left" });

  writeParagraph(doc, `Dear ${worker.preferred_name || worker.full_name},`, { align: "left" });
  writeParagraph(doc, `RE: ${letter.subject || letter.title}`.toUpperCase(), { bold: true, align: "left" });

  if (type === "employment") {
    writeParagraph(doc, `We are pleased to appoint you as ${payload.role || worker.job_title || "an employee"} with Chalin 03 Company Limited, subject to the terms in this letter, company policies and applicable law.`);
    writeEmploymentTerms(doc, payload);
    writeRules(doc, payload.rules);
    writeParagraph(doc, payload.additional_terms);
  } else if (type === "probation_confirmation") {
    writeParagraph(doc, `Following review of your performance and conduct during probation, the Company confirms your employment with effect from ${formatDate(letter.effective_date || letter.letter_date)}.`);
    writeEmploymentTerms(doc, payload);
    writeParagraph(doc, payload.additional_terms);
  } else if (type === "probation_extension") {
    writeParagraph(doc, `Your probation period is extended with effect from ${formatDate(letter.effective_date || letter.letter_date)}. This extension allows additional time to assess the matters described below.`);
    writeParagraph(doc, payload.reason);
    writeLabelValue(doc, "Required improvement", payload.action_required);
    writeLabelValue(doc, "Review / response date", letter.response_due_date ? formatDate(letter.response_due_date) : null);
    writeParagraph(doc, payload.additional_terms);
  } else if (type === "show_cause") {
    writeParagraph(doc, "Management requires your written explanation concerning the matter described below before any final disciplinary decision is taken.");
    writeLabelValue(doc, "Incident date", payload.incident_date ? formatDate(payload.incident_date) : null);
    writeParagraph(doc, payload.reason);
    writeLabelValue(doc, "Previous discussion or evidence", payload.prior_action);
    writeLabelValue(doc, "Response required", payload.response_instructions || payload.action_required);
    writeLabelValue(doc, "Response deadline", letter.response_due_date ? formatDate(letter.response_due_date) : null);
    writeParagraph(doc, "No final conclusion should be inferred from this notice. Your response and available evidence will be reviewed before management decides the next step.");
  } else if (["warning", "final_warning"].includes(type)) {
    writeParagraph(doc, type === "final_warning" ? "This letter constitutes a final written warning." : "This letter constitutes a written warning.");
    writeLabelValue(doc, "Incident date", payload.incident_date ? formatDate(payload.incident_date) : null);
    writeParagraph(doc, payload.reason);
    writeLabelValue(doc, "Previous action", payload.prior_action);
    writeLabelValue(doc, "Required improvement", payload.action_required);
    writeLabelValue(doc, "Review date", letter.response_due_date ? formatDate(letter.response_due_date) : null);
    writeParagraph(doc, type === "final_warning" ? "Failure to achieve and maintain the required improvement may result in further disciplinary action, up to and including termination, after a fair review of the facts and procedure." : "Further similar misconduct or failure to improve may lead to additional disciplinary action after a fair review.");
  } else if (type === "suspension") {
    writeParagraph(doc, `You are suspended from duty with effect from ${formatDate(letter.effective_date || letter.letter_date)} on the terms set out below.`);
    writeParagraph(doc, payload.reason);
    writeLabelValue(doc, "Suspension terms", payload.suspension_terms);
    writeLabelValue(doc, "Required response / attendance", payload.response_instructions || payload.action_required);
    writeLabelValue(doc, "Review date", letter.response_due_date ? formatDate(letter.response_due_date) : null);
    writeParagraph(doc, "Unless expressly stated otherwise, this letter records an interim management action and is not itself a final finding of misconduct.");
  } else if (type === "termination") {
    writeParagraph(doc, `This letter gives formal notice that your employment with Chalin 03 Company Limited will end with effect from ${formatDate(letter.effective_date || letter.letter_date)}.`);
    writeParagraph(doc, payload.reason);
    writeLabelValue(doc, "Notice / pay in lieu", payload.notice_terms);
    writeLabelValue(doc, "Final remuneration and benefits", payload.final_dues);
    writeLabelValue(doc, "Handover", payload.handover_requirements);
    writeLabelValue(doc, "Return of company property", payload.property_return);
    writeParagraph(doc, payload.additional_terms);
    writeParagraph(doc, "This template is an administrative record. Management must confirm that the reason, notice, final payments and procedure comply with the worker's contract, approved company policy and applicable Ghanaian labour requirements before issue.", { size: 9, color: "#7c2d12" });
  } else if (type === "promotion_transfer") {
    writeParagraph(doc, `We are pleased to confirm the following change to your employment with effect from ${formatDate(letter.effective_date || letter.letter_date)}.`);
    writeLabelValue(doc, "New role", payload.new_role);
    writeLabelValue(doc, "New department", payload.new_department);
    writeLabelValue(doc, "New location", payload.new_location);
    writeLabelValue(doc, "Salary", formatMoney(payload.salary_amount));
    writeLabelValue(doc, "Reports to", payload.reporting_to);
    writeParagraph(doc, payload.additional_terms);
  } else if (type === "resignation_acceptance") {
    writeParagraph(doc, `The Company acknowledges and accepts your resignation. Your last working day will be ${formatDate(letter.effective_date || letter.letter_date)}.`);
    writeLabelValue(doc, "Handover requirements", payload.handover_requirements);
    writeLabelValue(doc, "Return of company property", payload.property_return);
    writeLabelValue(doc, "Final remuneration and benefits", payload.final_dues);
    writeParagraph(doc, payload.additional_terms);
  }

  if (payload.management_note) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#07182c").text("Management note");
    writeParagraph(doc, payload.management_note);
  }

  doc.moveDown(0.5);
  writeParagraph(doc, "Yours faithfully,", { align: "left" });
  doc.moveDown(1.6);
  doc.moveTo(50, doc.y).lineTo(235, doc.y).strokeColor("#64748b").stroke();
  doc.moveDown(0.25);
  writeParagraph(doc, letter.signatory_name, { bold: true, align: "left", paragraphGap: 1 });
  writeParagraph(doc, letter.signatory_title, { align: "left", paragraphGap: 1 });
  writeParagraph(doc, "For and on behalf of Chalin 03 Company Limited", { align: "left", size: 9 });
  writeParagraph(doc, "Authorised signature / company stamp", { align: "left", size: 8.5, color: "#64748b" });

  doc.moveDown(1);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#07182c").text("Worker acknowledgement and agreement");
  writeParagraph(doc, payload.worker_agreement, { size: 9.5 });
  doc.moveDown(1.4);
  const lineY = doc.y;
  doc.moveTo(50, lineY).lineTo(235, lineY).strokeColor("#64748b").stroke();
  doc.moveTo(330, lineY).lineTo(doc.page.width - 50, lineY).stroke();
  doc.font("Helvetica").fontSize(8.5).fillColor("#64748b").text("Worker signature / thumbprint", 50, lineY + 4, { width: 185 });
  doc.text("Date", 330, lineY + 4, { width: doc.page.width - 380 });
}

async function buildLetterPdf(letter, worker) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 42, right: 50, bottom: 55, left: 50 },
      bufferPages: true,
      info: {
        Title: `${letter.title} - ${worker.full_name}`,
        Author: "Chalin 03 Company Limited",
        Subject: "Confidential worker HR letter",
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    drawLetterHeader(doc, letter, worker);
    if (letter.status === "draft") {
      doc.save().fillColor("#dc2626").opacity(0.08).font("Helvetica-Bold").fontSize(70).rotate(-35, { origin: [300, 420] }).text("DRAFT", 100, 380, { width: 420, align: "center" }).restore();
      doc.opacity(1);
    }
    writeLetterBody(doc, letter, worker);
    addPageNumber(doc);
    doc.end();
  });
}

function applyPdfHeaders(res, filename, length) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${safeFilename(filename)}.pdf"`);
  res.setHeader("Content-Length", String(length));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, Content-Length");
}

router.get(
  "/workers-expanded/:id/hr-letter-options",
  requireAuth,
  requirePermission("workers.documents.view"),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);
    const worker = workerId ? await loadWorker(workerId, req) : null;
    if (!worker) {
      return res.status(404).json({ status: "error", message: "Worker profile not found." });
    }
    return res.json({
      status: "success",
      worker,
      letter_types: Object.entries(LETTER_TYPES).map(([code, item]) => ({ code, title: item.title })),
      default_rules: DEFAULT_WORKPLACE_RULES,
      legal_review_note: "Employment and disciplinary letters must be reviewed against the worker's contract, company policy and applicable law before issue.",
    });
  })
);

router.get(
  "/workers-expanded/:id/hr-letters",
  requireAuth,
  requirePermission("workers.documents.view"),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);
    const worker = workerId ? await loadWorker(workerId, req) : null;
    if (!worker) {
      return res.status(404).json({ status: "error", message: "Worker profile not found." });
    }

    const [rows] = await pool.query(
      `SELECT
         letter_record.id,
         letter_record.letter_number,
         letter_record.letter_type,
         letter_record.title,
         letter_record.subject,
         letter_record.letter_date,
         letter_record.effective_date,
         letter_record.response_due_date,
         letter_record.status,
         letter_record.payload_json,
         letter_record.signatory_name,
         letter_record.signatory_title,
         letter_record.worker_acknowledgement_status,
         letter_record.worker_acknowledged_name,
         letter_record.worker_acknowledged_at,
         letter_record.worker_acknowledgement_note,
         letter_record.issued_at,
         letter_record.cancelled_at,
         letter_record.cancellation_reason,
         letter_record.created_at,
         letter_record.updated_at,
         creator.full_name AS created_by_name,
         issuer.full_name AS issued_by_name
       FROM worker_hr_letters letter_record
       LEFT JOIN users creator ON creator.id = letter_record.created_by
       LEFT JOIN users issuer ON issuer.id = letter_record.issued_by
       WHERE letter_record.worker_id = ?
         AND letter_record.workspace_code = ?
       ORDER BY letter_record.letter_date DESC, letter_record.id DESC`,
      [workerId, activeWorkspace(req)]
    );

    return res.json({
      status: "success",
      worker,
      letters: rows.map((row) => ({
        ...row,
        payload: parseJson(row.payload_json),
        payload_json: undefined,
      })),
    });
  })
);

router.post(
  "/workers-expanded/:id/hr-letters",
  requireAuth,
  requirePermission("workers.documents.manage"),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);
    const worker = workerId ? await loadWorker(workerId, req) : null;
    if (!worker) {
      return res.status(404).json({ status: "error", message: "Worker profile not found." });
    }

    const input = validateLetterInput(req.body || {}, worker);
    const [result] = await pool.query(
      `INSERT INTO worker_hr_letters (
         worker_id,
         workspace_code,
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
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workerId,
        worker.workspace_code,
        input.letterType,
        input.title,
        input.subject,
        input.letterDate,
        input.effectiveDate,
        input.responseDueDate,
        JSON.stringify(input.payload),
        input.signatoryName,
        input.signatoryTitle,
        "pending",
        req.user.id,
        req.user.id,
      ]
    );

    const letterNumber = makeLetterNumber(worker.workspace_code, input.template, input.letterDate, result.insertId);
    await pool.query("UPDATE worker_hr_letters SET letter_number = ? WHERE id = ?", [letterNumber, result.insertId]);

    await writeAuditEvent({
      req,
      action: "WORKER_HR_LETTER_CREATED",
      details: `${input.title} ${letterNumber} was created as a draft for ${worker.full_name}.`,
      entityType: "worker_hr_letter",
      entityId: result.insertId,
      metadata: { worker_id: workerId, letter_type: input.letterType, letter_number: letterNumber },
    });

    return res.status(201).json({
      status: "success",
      message: `${input.title} saved as draft.`,
      letter: await loadLetter(result.insertId, workerId, req),
    });
  })
);

router.put(
  "/workers-expanded/:id/hr-letters/:letterId",
  requireAuth,
  requirePermission("workers.documents.manage"),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);
    const letterId = positiveId(req.params.letterId);
    const worker = workerId ? await loadWorker(workerId, req) : null;
    const current = worker && letterId ? await loadLetter(letterId, workerId, req) : null;
    if (!worker || !current) {
      return res.status(404).json({ status: "error", message: "Worker HR letter not found." });
    }
    if (current.status !== "draft") {
      return res.status(409).json({ status: "error", message: "Only draft letters can be edited. Create a new letter when an issued record needs correction." });
    }

    const input = validateLetterInput(req.body || {}, worker);
    await pool.query(
      `UPDATE worker_hr_letters
       SET letter_type = ?, title = ?, subject = ?, letter_date = ?, effective_date = ?, response_due_date = ?,
           payload_json = ?, signatory_name = ?, signatory_title = ?, updated_by = ?
       WHERE id = ? AND worker_id = ? AND workspace_code = ?`,
      [input.letterType, input.title, input.subject, input.letterDate, input.effectiveDate, input.responseDueDate,
        JSON.stringify(input.payload), input.signatoryName, input.signatoryTitle, req.user.id,
        letterId, workerId, activeWorkspace(req)]
    );

    await writeAuditEvent({
      req,
      action: "WORKER_HR_LETTER_UPDATED",
      details: `Draft worker HR letter ${current.letter_number} was updated.`,
      entityType: "worker_hr_letter",
      entityId: letterId,
      metadata: { worker_id: workerId, letter_number: current.letter_number },
    });

    return res.json({ status: "success", message: "Draft letter updated.", letter: await loadLetter(letterId, workerId, req) });
  })
);

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
      return res.status(404).json({ status: "error", message: "Worker HR letter not found." });
    }
    if (letter.status !== "draft") {
      return res.status(409).json({ status: "error", message: "Only a draft letter can be issued." });
    }

    await pool.query(
      `UPDATE worker_hr_letters
       SET status = 'issued', issued_by = ?, issued_at = NOW(), updated_by = ?
       WHERE id = ? AND worker_id = ? AND workspace_code = ?`,
      [req.user.id, req.user.id, letterId, workerId, activeWorkspace(req)]
    );

    await writeAuditEvent({
      req,
      action: "WORKER_HR_LETTER_ISSUED",
      details: `${letter.title} ${letter.letter_number} was formally issued to ${worker.full_name}.`,
      entityType: "worker_hr_letter",
      entityId: letterId,
      severity: ["termination", "final_warning", "suspension"].includes(letter.letter_type) ? "warning" : "info",
      metadata: { worker_id: workerId, letter_number: letter.letter_number, letter_type: letter.letter_type },
    });

    return res.json({ status: "success", message: "Letter issued and locked from editing.", letter: await loadLetter(letterId, workerId, req) });
  })
);

router.post(
  "/workers-expanded/:id/hr-letters/:letterId/acknowledge",
  requireAuth,
  requirePermission("workers.documents.manage"),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);
    const letterId = positiveId(req.params.letterId);
    const letter = workerId && letterId ? await loadLetter(letterId, workerId, req) : null;
    if (!letter) {
      return res.status(404).json({ status: "error", message: "Worker HR letter not found." });
    }
    if (!['issued', 'acknowledged'].includes(letter.status)) {
      return res.status(409).json({ status: "error", message: "Issue the letter before recording worker acknowledgement." });
    }

    const acknowledgementStatus = cleanText(req.body?.acknowledgement_status, 30).toLowerCase();
    const allowed = new Set(["accepted", "received", "declined", "not_required"]);
    const acknowledgedName = cleanText(req.body?.acknowledged_name, 150);
    if (!allowed.has(acknowledgementStatus) || (!acknowledgedName && acknowledgementStatus !== "not_required")) {
      return res.status(400).json({ status: "error", message: "Choose a valid acknowledgement result and enter the worker or witness name." });
    }

    await pool.query(
      `UPDATE worker_hr_letters
       SET status = 'acknowledged', worker_acknowledgement_status = ?, worker_acknowledged_name = ?,
           worker_acknowledged_at = NOW(), worker_acknowledgement_note = ?, updated_by = ?
       WHERE id = ? AND worker_id = ? AND workspace_code = ?`,
      [acknowledgementStatus, acknowledgedName || null, nullableText(req.body?.note, 2000), req.user.id,
        letterId, workerId, activeWorkspace(req)]
    );

    await writeAuditEvent({
      req,
      action: "WORKER_HR_LETTER_ACKNOWLEDGED",
      details: `Acknowledgement for ${letter.letter_number} was recorded as ${acknowledgementStatus}.`,
      entityType: "worker_hr_letter",
      entityId: letterId,
      metadata: { worker_id: workerId, letter_number: letter.letter_number, acknowledgement_status: acknowledgementStatus },
    });

    return res.json({ status: "success", message: "Worker acknowledgement recorded.", letter: await loadLetter(letterId, workerId, req) });
  })
);

router.post(
  "/workers-expanded/:id/hr-letters/:letterId/cancel",
  requireAuth,
  requirePermission("workers.documents.manage", "workers.manage"),
  asyncHandler(async (req, res) => {
    const workerId = positiveId(req.params.id);
    const letterId = positiveId(req.params.letterId);
    const letter = workerId && letterId ? await loadLetter(letterId, workerId, req) : null;
    const reason = cleanText(req.body?.reason, 1000);
    if (!letter) {
      return res.status(404).json({ status: "error", message: "Worker HR letter not found." });
    }
    if (!reason) {
      return res.status(400).json({ status: "error", message: "A cancellation reason is required." });
    }
    if (letter.status === "cancelled") {
      return res.status(409).json({ status: "error", message: "This letter is already cancelled." });
    }

    await pool.query(
      `UPDATE worker_hr_letters
       SET status = 'cancelled', cancelled_by = ?, cancelled_at = NOW(), cancellation_reason = ?, updated_by = ?
       WHERE id = ? AND worker_id = ? AND workspace_code = ?`,
      [req.user.id, reason, req.user.id, letterId, workerId, activeWorkspace(req)]
    );

    await writeAuditEvent({
      req,
      action: "WORKER_HR_LETTER_CANCELLED",
      details: `Worker HR letter ${letter.letter_number} was cancelled.`,
      entityType: "worker_hr_letter",
      entityId: letterId,
      severity: "warning",
      metadata: { worker_id: workerId, letter_number: letter.letter_number, reason },
    });

    return res.json({ status: "success", message: "Letter cancelled. The audit record remains preserved.", letter: await loadLetter(letterId, workerId, req) });
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
      return res.status(404).json({ status: "error", message: "Worker HR letter not found." });
    }

    const buffer = await buildLetterPdf(letter, worker);
    const filename = `${letter.letter_number || "DRAFT"}_${worker.employee_number}_${letter.letter_type}`;

    await writeAuditEvent({
      req,
      action: "WORKER_HR_LETTER_PDF_GENERATED",
      details: `PDF generated for worker HR letter ${letter.letter_number || letter.id}.`,
      entityType: "worker_hr_letter",
      entityId: letterId,
      metadata: { worker_id: workerId, letter_number: letter.letter_number, status: letter.status },
    });

    applyPdfHeaders(res, filename, buffer.length);
    return res.end(buffer);
  })
);

module.exports = router;
module.exports.LETTER_TYPES = LETTER_TYPES;
module.exports.DEFAULT_WORKPLACE_RULES = DEFAULT_WORKPLACE_RULES;
