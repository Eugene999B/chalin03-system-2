const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const { signatureDataUrlToBuffer } = require("./documentSignatureService");
const { workspaceLabel } = require("./hrDocumentTemplates");

function cleanText(value, maxLength = 4000) {
  return String(value ?? "").trim().slice(0, maxLength);
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
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return `GHS ${amount.toLocaleString("en-GH", {
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
const PAGE_BOTTOM = 755;

function ensureSpace(doc, requiredHeight = 80) {
  if (doc.y + requiredHeight > PAGE_BOTTOM) {
    doc.addPage();
  }
}

function drawPageFrame(doc, context) {
  const width = doc.page.width;
  doc.save();
  doc.rect(0, 0, width, 18).fill("#07182c");
  doc.rect(0, 18, width, 4).fill("#d6ad24");
  doc.rect(42, 42, width - 84, doc.page.height - 92).lineWidth(0.6).strokeColor("#d8dee8").stroke();

  if (LOGO_PATH) {
    try {
      doc.image(LOGO_PATH, 52, 37, { fit: [54, 54], align: "center", valign: "center" });
    } catch {
      // The text letterhead remains available when the logo cannot be decoded.
    }
  }

  doc.font("Helvetica-Bold").fontSize(17).fillColor("#07182c").text(
    "CHALIN 03 COMPANY LIMITED",
    116,
    42,
    { width: width - 170, align: "center", lineBreak: false }
  );
  doc.font("Helvetica").fontSize(8.8).fillColor("#586579").text(
    `${workspaceLabel(context.workspaceCode)} · Employment and Human Resources`,
    116,
    66,
    { width: width - 170, align: "center", lineBreak: false }
  );
  doc.font("Helvetica-Bold").fontSize(8.4).fillColor("#a27e00").text(
    context.letterNumber || "DRAFT DOCUMENT",
    116,
    82,
    { width: width - 170, align: "center", lineBreak: false }
  );
  doc.moveTo(52, 102).lineTo(width - 52, 102).lineWidth(1).strokeColor("#d6ad24").stroke();
  doc.restore();
  doc.x = 58;
  doc.y = 118;
}

function writeParagraph(doc, text, options = {}) {
  const value = cleanText(text, 8000);
  if (!value) return;
  ensureSpace(doc, options.requiredHeight || 42);
  doc
    .font(options.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(options.size || 10.2)
    .fillColor(options.color || "#243244")
    .text(value, {
      width: doc.page.width - 116,
      align: options.align || "justify",
      lineGap: options.lineGap ?? 2.4,
      paragraphGap: options.paragraphGap ?? 7,
    });
}

function sectionTitle(doc, title) {
  ensureSpace(doc, 46);
  const y = doc.y;
  doc.roundedRect(58, y, doc.page.width - 116, 22, 4).fill("#eef2f7");
  doc.font("Helvetica-Bold").fontSize(9.6).fillColor("#07182c").text(
    title.toUpperCase(),
    68,
    y + 6,
    { width: doc.page.width - 136, lineBreak: false }
  );
  doc.y = y + 31;
  doc.x = 58;
}

function writeKeyValues(doc, entries) {
  const present = entries.filter(([, value]) => value !== null && value !== undefined && cleanText(value, 4000));
  if (present.length === 0) return;

  present.forEach(([label, value]) => {
    ensureSpace(doc, 28);
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(9.3).fillColor("#07182c").text(`${label}:`, 62, y, {
      width: 128,
      continued: false,
    });
    doc.font("Helvetica").fontSize(9.5).fillColor("#334155").text(String(value), 190, y, {
      width: doc.page.width - 248,
      lineGap: 2,
      paragraphGap: 4,
    });
    doc.y = Math.max(doc.y, y + 17);
  });
  doc.moveDown(0.35);
}

function writeRules(doc, rules) {
  if (!Array.isArray(rules) || rules.length === 0) return;
  sectionTitle(doc, "Rules and responsibilities");
  rules.filter(Boolean).forEach((rule, index) => {
    ensureSpace(doc, 34);
    const y = doc.y;
    doc.circle(69, y + 5, 2.4).fill("#d6ad24");
    doc.font("Helvetica").fontSize(9.2).fillColor("#334155").text(
      `${index + 1}. ${cleanText(rule, 600)}`,
      79,
      y,
      { width: doc.page.width - 137, lineGap: 1.8, paragraphGap: 4 }
    );
  });
  doc.moveDown(0.3);
}

function writeRecipient(doc, person, letter) {
  writeParagraph(doc, formatDate(letter.letter_date), { align: "right", size: 9.6, paragraphGap: 5 });

  ensureSpace(doc, 92);
  const startY = doc.y;
  doc.roundedRect(58, startY, doc.page.width - 116, 70, 5).fillAndStroke("#f8fafc", "#d8dee8");
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#07182c").text(person.full_name, 72, startY + 11, {
    width: doc.page.width - 144,
  });
  const identity = [person.employee_number, person.job_title].filter(Boolean).join(" · ");
  if (identity) {
    doc.font("Helvetica").fontSize(8.8).fillColor("#586579").text(identity, 72, startY + 29, {
      width: doc.page.width - 144,
    });
  }
  const contact = [person.phone, person.email].filter(Boolean).join(" · ");
  if (contact) {
    doc.font("Helvetica").fontSize(8.6).fillColor("#586579").text(contact, 72, startY + 45, {
      width: doc.page.width - 144,
    });
  }
  doc.y = startY + 82;

  if (person.address) writeParagraph(doc, person.address, { align: "left", size: 9.4, paragraphGap: 5 });
  writeParagraph(doc, `Dear ${person.preferred_name || person.full_name},`, { align: "left", paragraphGap: 5 });

  ensureSpace(doc, 54);
  doc.roundedRect(58, doc.y, doc.page.width - 116, 34, 4).fill("#07182c");
  doc.font("Helvetica-Bold").fontSize(10.1).fillColor("#ffffff").text(
    `RE: ${letter.subject || letter.title}`.toUpperCase(),
    70,
    doc.y + 11,
    { width: doc.page.width - 140, align: "center", lineBreak: false }
  );
  doc.y += 45;
  doc.x = 58;
}

function writeEmploymentTerms(doc, payload) {
  sectionTitle(doc, "Main employment terms");
  writeKeyValues(doc, [
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
    ["Benefits / allowances", payload.benefits],
  ]);
}

function writeLetterBody(doc, letter, person) {
  const payload = letter.payload || {};
  const type = letter.letter_type;

  writeRecipient(doc, person, letter);

  if (type === "employment") {
    writeParagraph(doc, `We are pleased to appoint you as ${payload.role || person.job_title || "an employee"} with Chalin 03 Company Limited, subject to the terms in this letter, approved company policies and applicable law.`);
    writeEmploymentTerms(doc, payload);
    writeRules(doc, payload.rules);
    writeParagraph(doc, payload.additional_terms);
  } else if (type === "probation_confirmation") {
    writeParagraph(doc, `Following management review of your performance and conduct during probation, the Company confirms your employment with effect from ${formatDate(letter.effective_date || letter.letter_date)}.`);
    writeEmploymentTerms(doc, payload);
    writeParagraph(doc, payload.additional_terms);
  } else if (type === "probation_extension") {
    writeParagraph(doc, `Your probation period is extended with effect from ${formatDate(letter.effective_date || letter.letter_date)} to allow additional time to assess the matters set out below.`);
    sectionTitle(doc, "Review details");
    writeParagraph(doc, payload.reason);
    writeKeyValues(doc, [
      ["Required improvement", payload.action_required],
      ["Review / response date", letter.response_due_date ? formatDate(letter.response_due_date) : null],
    ]);
    writeParagraph(doc, payload.additional_terms);
  } else if (type === "show_cause") {
    writeParagraph(doc, "Management requires your written explanation concerning the matter described below before any final disciplinary decision is taken.");
    sectionTitle(doc, "Matter requiring explanation");
    writeKeyValues(doc, [["Incident date", payload.incident_date ? formatDate(payload.incident_date) : null]]);
    writeParagraph(doc, payload.reason);
    writeKeyValues(doc, [
      ["Previous discussion or evidence", payload.prior_action],
      ["Response required", payload.response_instructions || payload.action_required],
      ["Response deadline", letter.response_due_date ? formatDate(letter.response_due_date) : null],
    ]);
    writeParagraph(doc, "No final conclusion should be inferred from this notice. Your response and available evidence will be reviewed before management decides the next step.", { size: 9.4, color: "#7c4a03" });
  } else if (["warning", "final_warning"].includes(type)) {
    writeParagraph(doc, type === "final_warning" ? "This letter constitutes a final written warning." : "This letter constitutes a written warning.", { bold: true, align: "left" });
    sectionTitle(doc, "Warning details");
    writeKeyValues(doc, [["Incident date", payload.incident_date ? formatDate(payload.incident_date) : null]]);
    writeParagraph(doc, payload.reason);
    writeKeyValues(doc, [
      ["Previous action", payload.prior_action],
      ["Required improvement", payload.action_required],
      ["Review date", letter.response_due_date ? formatDate(letter.response_due_date) : null],
    ]);
    writeParagraph(doc, type === "final_warning" ? "Failure to achieve and maintain the required improvement may result in further disciplinary action, up to and including termination, after a fair review of the facts and procedure." : "Further similar misconduct or failure to improve may lead to additional disciplinary action after a fair review.", { size: 9.4, color: "#7c2d12" });
  } else if (type === "suspension") {
    writeParagraph(doc, `You are suspended from duty with effect from ${formatDate(letter.effective_date || letter.letter_date)} on the terms set out below.`);
    sectionTitle(doc, "Suspension details");
    writeParagraph(doc, payload.reason);
    writeKeyValues(doc, [
      ["Suspension terms", payload.suspension_terms],
      ["Required response / attendance", payload.response_instructions || payload.action_required],
      ["Review date", letter.response_due_date ? formatDate(letter.response_due_date) : null],
    ]);
    writeParagraph(doc, "Unless expressly stated otherwise, this letter records an interim management action and is not itself a final finding of misconduct.", { size: 9.4, color: "#7c4a03" });
  } else if (type === "termination") {
    writeParagraph(doc, `This letter gives formal notice that your employment with Chalin 03 Company Limited will end with effect from ${formatDate(letter.effective_date || letter.letter_date)}.`);
    sectionTitle(doc, "Separation details");
    writeParagraph(doc, payload.reason);
    writeKeyValues(doc, [
      ["Notice / pay in lieu", payload.notice_terms],
      ["Final remuneration and benefits", payload.final_dues],
      ["Handover", payload.handover_requirements],
      ["Return of company property", payload.property_return],
    ]);
    writeParagraph(doc, payload.additional_terms);
    writeParagraph(doc, "Management must confirm that the reason, notice, final payments and procedure comply with the worker's contract, approved company policy and applicable Ghanaian labour requirements before issue.", { size: 8.8, color: "#7c2d12" });
  } else if (type === "promotion_transfer") {
    writeParagraph(doc, `We are pleased to confirm the following change to your employment with effect from ${formatDate(letter.effective_date || letter.letter_date)}.`);
    sectionTitle(doc, "New appointment details");
    writeKeyValues(doc, [
      ["New role", payload.new_role],
      ["New department", payload.new_department],
      ["New location", payload.new_location],
      ["Salary", formatMoney(payload.salary_amount)],
      ["Reports to", payload.reporting_to],
    ]);
    writeParagraph(doc, payload.additional_terms);
  } else if (type === "resignation_acceptance") {
    writeParagraph(doc, `The Company acknowledges and accepts your resignation. Your last working day will be ${formatDate(letter.effective_date || letter.letter_date)}.`);
    sectionTitle(doc, "Clearance and handover");
    writeKeyValues(doc, [
      ["Handover requirements", payload.handover_requirements],
      ["Return of company property", payload.property_return],
      ["Final remuneration and benefits", payload.final_dues],
    ]);
    writeParagraph(doc, payload.additional_terms);
  }

  if (payload.management_note) {
    sectionTitle(doc, "Management note");
    writeParagraph(doc, payload.management_note);
  }
}

function writeApprovalAndAcknowledgement(doc, letter, signatureSnapshot) {
  ensureSpace(doc, 185);
  sectionTitle(doc, "Authorised approval");
  writeParagraph(doc, "Yours faithfully,", { align: "left", paragraphGap: 3 });

  const signatureBuffer = signatureSnapshot?.dataUrl
    ? signatureDataUrlToBuffer(signatureSnapshot.dataUrl)
    : null;
  const signatureName = signatureSnapshot?.name || letter.approval_signatory_name || letter.signatory_name;
  const signatureTitle = signatureSnapshot?.title || letter.approval_signatory_title || letter.signatory_title;

  const signatureY = doc.y;
  if (signatureBuffer) {
    try {
      doc.image(signatureBuffer, 64, signatureY, { fit: [160, 58], align: "left", valign: "center" });
    } catch {
      // The approval identity and signature line remain visible.
    }
  }
  doc.moveTo(62, signatureY + 62).lineTo(242, signatureY + 62).lineWidth(0.8).strokeColor("#506174").stroke();
  doc.font("Helvetica-Bold").fontSize(9.8).fillColor("#07182c").text(signatureName || "Authorised signatory", 62, signatureY + 68, { width: 220 });
  doc.font("Helvetica").fontSize(8.9).fillColor("#586579").text(signatureTitle || "Management", 62, signatureY + 84, { width: 220 });
  doc.font("Helvetica").fontSize(8.2).fillColor("#6b7280").text("For and on behalf of Chalin 03 Company Limited", 62, signatureY + 100, { width: 250 });

  if (signatureBuffer) {
    doc.roundedRect(doc.page.width - 205, signatureY + 12, 143, 48, 4).fillAndStroke("#f7fafc", "#d8dee8");
    doc.font("Helvetica-Bold").fontSize(8.2).fillColor("#166534").text("ELECTRONICALLY APPROVED", doc.page.width - 196, signatureY + 24, { width: 125, align: "center" });
    doc.font("Helvetica").fontSize(7.7).fillColor("#586579").text(formatDate(letter.signature_captured_at || letter.issued_at || new Date()), doc.page.width - 196, signatureY + 39, { width: 125, align: "center" });
  }

  doc.y = signatureY + 122;
  doc.x = 58;

  ensureSpace(doc, 145);
  sectionTitle(doc, "Worker acknowledgement and agreement");
  writeParagraph(doc, letter.payload?.worker_agreement || "I confirm that I have read or had this document explained to me, understand its contents and have received a copy.", { size: 9.1 });
  ensureSpace(doc, 58);
  const lineY = doc.y + 16;
  doc.moveTo(62, lineY).lineTo(250, lineY).lineWidth(0.8).strokeColor("#506174").stroke();
  doc.moveTo(334, lineY).lineTo(doc.page.width - 62, lineY).stroke();
  doc.font("Helvetica").fontSize(8.1).fillColor("#6b7280").text("Worker signature / thumbprint", 62, lineY + 5, { width: 188, lineBreak: false });
  doc.text("Date", 334, lineY + 5, { width: doc.page.width - 396, lineBreak: false });
  doc.y = lineY + 24;
}

function addDraftWatermark(doc) {
  doc.save();
  doc.opacity(0.06).fillColor("#b91c1c").font("Helvetica-Bold").fontSize(68).rotate(-32, { origin: [300, 420] }).text("DRAFT", 95, 390, { width: 420, align: "center", lineBreak: false });
  doc.restore();
  doc.opacity(1);
}

function addFooters(doc) {
  const range = doc.bufferedPageRange();
  const lastPage = range.start + range.count - 1;
  const lastY = doc.y;

  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc.save();
    doc.moveTo(58, doc.page.height - 46).lineTo(doc.page.width - 58, doc.page.height - 46).lineWidth(0.5).strokeColor("#d8dee8").stroke();
    doc.font("Helvetica").fontSize(7.6).fillColor("#6b7280").text(
      `Chalin 03 Company Limited · Confidential personnel document · Page ${index + 1} of ${range.count}`,
      58,
      doc.page.height - 36,
      { width: doc.page.width - 116, align: "center", lineBreak: false, height: 10 }
    );
    doc.restore();
  }

  doc.switchToPage(lastPage);
  doc.y = lastY;
}

async function buildHrDocumentPdf({ letter, person, workspaceCode, signatureSnapshot = null }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 118, right: 58, bottom: 66, left: 58 },
      bufferPages: true,
      info: {
        Title: `${letter.title} - ${person.full_name}`,
        Author: "Chalin 03 Company Limited",
        Subject: "Confidential employment and human resources document",
      },
    });

    const chunks = [];
    const frameContext = {
      workspaceCode,
      letterNumber: letter.letter_number,
    };

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("pageAdded", () => drawPageFrame(doc, frameContext));

    drawPageFrame(doc, frameContext);
    if (letter.status === "draft") addDraftWatermark(doc);
    writeLetterBody(doc, letter, person);
    writeApprovalAndAcknowledgement(doc, letter, signatureSnapshot);
    addFooters(doc);
    doc.end();
  });
}

module.exports = {
  buildHrDocumentPdf,
  formatDate,
  formatMoney,
};
