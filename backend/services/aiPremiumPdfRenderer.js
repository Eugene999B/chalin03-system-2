"use strict";

const crypto = require("node:crypto");
const PDFDocument = require("pdfkit");
const {
  clean,
  normalizedEvidence,
  sanitizeFilename,
} = require("./aiDocumentStudioService");

const CLASSIFICATION_RANK = Object.freeze({
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
  sensitive: 3,
});

function classificationRank(value) {
  return CLASSIFICATION_RANK[String(value || "").trim().toLowerCase()] ?? 1;
}

function operationalClassification(evidence = [], minimum = "internal") {
  let highest = CLASSIFICATION_RANK[minimum] == null ? "internal" : minimum;
  for (const item of normalizedEvidence(evidence)) {
    if (classificationRank(item.classification) > classificationRank(highest)) {
      highest = String(item.classification || "internal").toLowerCase();
    }
  }
  return highest;
}

function professionalTitle(value, answer = "") {
  const title = clean(value || "", 180);
  if (
    /\b(?:generate|create|make|prepare|give me|can you)\b/i.test(title) &&
    /\b(?:sales?|performance|revenue|profit)\b/i.test(title)
  ) {
    return "Sales Performance Report";
  }
  if (title && !/^new conversation$/i.test(title)) return title;
  const firstUseful = String(answer || "")
    .split(/\n+/)
    .map((line) => line.replace(/^#{1,4}\s*/, "").replace(/\*\*/g, "").trim())
    .find((line) => line.length >= 4 && line.length <= 120);
  return firstUseful || "CHALIN Intelligence Report";
}

function stripInlineMarkdown(value) {
  return String(value || "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function answerBlocks(answer) {
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    const text = stripInlineMarkdown(paragraph.join(" ").replace(/\s+/g, " "));
    if (text) blocks.push(Object.freeze({ type: "paragraph", text }));
    paragraph = [];
  };
  for (const raw of String(answer || "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.+)$/) || line.match(/^\*\*([^*]{3,120})\*\*:?$/);
    if (heading) {
      flush();
      blocks.push(Object.freeze({ type: "heading", text: stripInlineMarkdown(heading[1]) }));
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      flush();
      blocks.push(Object.freeze({ type: "bullet", text: stripInlineMarkdown(bullet[1]) }));
      continue;
    }
    const numbered = line.match(/^(\d{1,2})[.)]\s+(.+)$/);
    if (numbered) {
      flush();
      blocks.push(Object.freeze({ type: "numbered", number: numbered[1], text: stripInlineMarkdown(numbered[2]) }));
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return Object.freeze(blocks);
}

function evidenceAsOf(evidence = []) {
  const values = normalizedEvidence(evidence)
    .map((item) => item.as_of_at)
    .filter(Boolean)
    .sort();
  return values.length ? values[values.length - 1] : null;
}

function buildPayload(input = {}) {
  const answer = clean(input.answer, 120000);
  if (!answer) {
    const error = new Error("A non-empty CHALIN Intelligence answer is required for PDF generation.");
    error.code = "AI_DOCUMENT_ANSWER_REQUIRED";
    error.statusCode = 400;
    throw error;
  }
  const evidence = normalizedEvidence(input.evidence);
  return Object.freeze({
    title: professionalTitle(input.title, answer),
    answer,
    blocks: answerBlocks(answer),
    evidence,
    evidence_as_of: evidenceAsOf(evidence),
    classification: operationalClassification(evidence),
    generated_at: input.generated_at || new Date().toISOString(),
    actor_name: clean(input.actor_name || input.actor_username || "Authorized CHALIN user", 180),
    actor_role: clean(input.actor_role || "", 80),
    workspace_code: clean(input.workspace_code || "", 80),
  });
}

function visibleMetadata(payload) {
  return [
    ["Generated", payload.generated_at],
    ["Prepared for", payload.actor_name],
    ["Role", payload.actor_role],
    ["Workspace", payload.workspace_code],
    ["Classification", payload.classification.toUpperCase()],
    ["Evidence as of", payload.evidence_as_of],
  ].filter(([, value]) => value);
}

function ensureRoom(doc, needed = 70) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function renderBlock(doc, block) {
  if (block.type === "heading") {
    ensureRoom(doc, 46);
    doc.moveDown(0.45);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#17395f").text(block.text, { lineGap: 1.4 });
    doc.moveDown(0.12);
    return;
  }
  if (block.type === "bullet" || block.type === "numbered") {
    ensureRoom(doc, 38);
    const marker = block.type === "bullet" ? "•" : `${block.number}.`;
    doc.font("Helvetica-Bold").fontSize(9.4).fillColor("#17395f").text(`${marker} `, { continued: true });
    doc.font("Helvetica").fillColor("#172033").text(block.text, { lineGap: 2 });
    doc.moveDown(0.16);
    return;
  }
  ensureRoom(doc, 42);
  doc.font("Helvetica").fontSize(9.6).fillColor("#172033").text(block.text, { lineGap: 2.2 });
  doc.moveDown(0.38);
}

function renderEvidence(doc, evidence) {
  if (!evidence.length) return;
  ensureRoom(doc, 88);
  doc.moveDown(0.7);
  doc.strokeColor("#cbd5e1").lineWidth(0.6)
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .stroke();
  doc.moveDown(0.65);
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#17395f").text("GOVERNED EVIDENCE");
  doc.font("Helvetica").fontSize(8).fillColor("#64748b").text(
    "Authenticated read-only sources supporting this report. Technical conversation and request identifiers remain in the audit trail rather than the management document."
  );
  for (const item of evidence.slice(0, 24)) {
    ensureRoom(doc, 52);
    doc.moveDown(0.42);
    doc.font("Helvetica-Bold").fontSize(8.7).fillColor("#172033").text(`[${item.citation}] ${item.label}`);
    const details = [
      item.as_of_at ? `As of ${item.as_of_at}` : null,
      item.workspace_code ? `Workspace ${item.workspace_code}` : null,
      item.classification ? String(item.classification).toUpperCase() : null,
    ].filter(Boolean).join(" · ");
    if (details) doc.font("Helvetica").fontSize(7.8).fillColor("#64748b").text(details);
  }
}

function addFooters(doc, payload) {
  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page += 1) {
    doc.switchToPage(page);
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const footerY = doc.page.height - 32;
    doc.strokeColor("#d7dee8").lineWidth(0.45)
      .moveTo(doc.page.margins.left, footerY - 8)
      .lineTo(doc.page.width - doc.page.margins.right, footerY - 8)
      .stroke();
    doc.font("Helvetica").fontSize(7).fillColor("#667085").text(
      `Authenticated CHALIN Intelligence · ${payload.classification.toUpperCase()}`,
      doc.page.margins.left,
      footerY,
      { width: doc.page.width - 190, lineBreak: false }
    );
    doc.text(
      `Page ${page - range.start + 1} of ${range.count}`,
      doc.page.width - doc.page.margins.right - 80,
      footerY,
      { width: 80, align: "right", lineBreak: false }
    );
    doc.page.margins.bottom = oldBottom;
  }
}

function renderPremiumPdfBuffer(payload) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 44, left: 46, right: 46, bottom: 58 },
      bufferPages: true,
      compress: false,
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.font("Helvetica-Bold").fontSize(16.5).fillColor("#12263f").text("CHALIN 03 COMPANY LIMITED", { align: "center" });
    doc.font("Helvetica").fontSize(8.2).fillColor("#667085").text("CHALIN Intelligence · Governed management report", { align: "center" });
    doc.moveDown(0.65);
    doc.strokeColor("#17395f").lineWidth(1.1)
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .stroke();
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f172a").text(payload.title, { align: "center" });
    doc.moveDown(0.7);

    const labelWidth = 92;
    for (const [label, value] of visibleMetadata(payload)) {
      ensureRoom(doc, 18);
      const y = doc.y;
      doc.font("Helvetica-Bold").fontSize(7.8).fillColor("#667085").text(label, doc.page.margins.left, y, { width: labelWidth });
      doc.font("Helvetica").fillColor("#27364a").text(String(value), doc.page.margins.left + labelWidth, y, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right - labelWidth,
      });
    }

    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#17395f").text("INTELLIGENCE REPORT");
    doc.moveDown(0.3);
    for (const block of payload.blocks) renderBlock(doc, block);
    renderEvidence(doc, payload.evidence);
    addFooters(doc, payload);
    doc.end();
  });
}

async function renderPremiumAiPdf(input = {}) {
  const payload = buildPayload(input);
  const buffer = await renderPremiumPdfBuffer(payload);
  return Object.freeze({
    format: "pdf",
    extension: "pdf",
    content_type: "application/pdf",
    filename: `${sanitizeFilename(input.filename || payload.title)}.pdf`,
    buffer,
    byte_length: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    classification: payload.classification,
    evidence_count: payload.evidence.length,
  });
}

module.exports = {
  CLASSIFICATION_RANK,
  addFooters,
  answerBlocks,
  buildPayload,
  classificationRank,
  evidenceAsOf,
  operationalClassification,
  professionalTitle,
  renderPremiumAiPdf,
  renderPremiumPdfBuffer,
  stripInlineMarkdown,
  visibleMetadata,
};
