const fs = require("node:fs");
const path = require("node:path");
const PDFDocument = require("pdfkit");

const { createPayslipVerificationQr } = require("./payrollPayslipService");

const NAVY = "#07182c";
const GOLD = "#d6ad24";
const TEXT = "#1f2937";
const MUTED = "#64748b";
const LINE = "#d9e0e8";
const LIGHT = "#f7f9fc";
const GREEN = "#137a3d";

function cleanText(value, maxLength = 3000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function money(value, currency = "GHS") {
  const number = Number(value);
  const amount = Number.isFinite(number) ? number : 0;
  return `${currency} ${amount.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cleanText(value, 50) || fallback;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function workspaceLabel(value) {
  const normalized = cleanText(value, 80).replace(/[_-]+/g, " ");
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Group Operations";
}

function findLogoPath() {
  const candidates = [
    path.resolve(__dirname, "..", "assets", "chalin03-logo.png"),
    path.resolve(__dirname, "..", "..", "frontend", "public", "chalin03-logo.png"),
    path.resolve(process.cwd(), "..", "frontend", "public", "chalin03-logo.png"),
    path.resolve(process.cwd(), "frontend", "public", "chalin03-logo.png"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

const LOGO_PATH = findLogoPath();

function drawLogo(doc, x, y, size) {
  if (LOGO_PATH) {
    try {
      doc.image(LOGO_PATH, x, y, { fit: [size, size], align: "center", valign: "center" });
      return;
    } catch {
      // Keep the branded text fallback if the image cannot be decoded.
    }
  }
  doc.save();
  doc.roundedRect(x, y, size, size, 8).fill(NAVY);
  doc.lineWidth(1.3).strokeColor(GOLD).roundedRect(x + 4, y + 4, size - 8, size - 8, 6).stroke();
  doc.font("Helvetica-Bold").fontSize(size * 0.23).fillColor(GOLD).text("C03", x, y + size * 0.36, {
    width: size,
    align: "center",
    lineBreak: false,
  });
  doc.restore();
}

function sectionTitle(doc, title) {
  const y = doc.y;
  doc.roundedRect(42, y, doc.page.width - 84, 22, 4).fill("#edf2f7");
  doc.font("Helvetica-Bold").fontSize(9).fillColor(NAVY).text(cleanText(title, 100).toUpperCase(), 52, y + 6, {
    width: doc.page.width - 104,
    lineBreak: false,
  });
  doc.y = y + 30;
}

function ensureSpace(doc, height) {
  if (doc.y + height > 760) {
    doc.addPage();
    drawContinuationHeader(doc);
  }
}

function drawContinuationHeader(doc) {
  doc.rect(0, 0, doc.page.width, 12).fill(NAVY);
  doc.rect(0, 12, doc.page.width, 3).fill(GOLD);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(NAVY).text("CHALIN 03 PROFESSIONAL PAYSLIP — CONTINUED", 42, 28, {
    width: doc.page.width - 84,
    align: "right",
  });
  doc.y = 48;
}

function keyValue(doc, label, value, x, y, width) {
  doc.font("Helvetica-Bold").fontSize(7.8).fillColor(MUTED).text(cleanText(label, 60).toUpperCase(), x, y, {
    width,
    lineBreak: false,
  });
  doc.font("Helvetica").fontSize(9.3).fillColor(TEXT).text(cleanText(value, 250) || "-", x, y + 12, {
    width,
    lineBreak: false,
    ellipsis: true,
  });
}

function drawSummaryCard(doc, snapshot) {
  const x = 42;
  const y = doc.y;
  const width = doc.page.width - 84;
  const col = (width - 24) / 3;
  doc.roundedRect(x, y, width, 92, 7).fillAndStroke(LIGHT, LINE);
  keyValue(doc, "Employee", snapshot.worker?.full_name, x + 12, y + 12, col);
  keyValue(doc, "Employee number", snapshot.worker?.employee_number, x + 12, y + 48, col);
  keyValue(doc, "Department", snapshot.worker?.department, x + 12 + col, y + 12, col);
  keyValue(doc, "Role", snapshot.worker?.role, x + 12 + col, y + 48, col);
  keyValue(doc, "Payroll period", snapshot.period?.period_code, x + 12 + col * 2, y + 12, col - 12);
  keyValue(doc, "Payable days", `${snapshot.period?.payable_days ?? 0} of ${snapshot.period?.employment_days ?? 0}`, x + 12 + col * 2, y + 48, col - 12);
  doc.y = y + 106;
}

function drawMoneySummary(doc, snapshot) {
  const currency = snapshot.company?.currency_code || "GHS";
  const x = 42;
  const y = doc.y;
  const width = doc.page.width - 84;
  const col = width / 4;
  const cards = [
    ["Gross pay", snapshot.totals?.gross_earnings],
    ["Deductions", snapshot.totals?.total_deductions],
    ["Employer contrib.", snapshot.totals?.employer_contributions],
    ["NET PAY", snapshot.totals?.net_salary],
  ];
  cards.forEach(([label, value], index) => {
    const cardX = x + index * col;
    doc.rect(cardX, y, col, 58).fillAndStroke(index === 3 ? NAVY : "#ffffff", LINE);
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(index === 3 ? GOLD : MUTED).text(label.toUpperCase(), cardX + 8, y + 10, {
      width: col - 16,
      align: "center",
      lineBreak: false,
    });
    doc.font("Helvetica-Bold").fontSize(index === 3 ? 11 : 9.5).fillColor(index === 3 ? "#ffffff" : NAVY).text(money(value, currency), cardX + 6, y + 30, {
      width: col - 12,
      align: "center",
      lineBreak: false,
    });
  });
  doc.y = y + 72;
}

function lineCategory(line) {
  if (line.line_type === "earning" || line.line_type === "arrears") return "earning";
  if (line.line_type === "employer_contribution") return "employer";
  return "deduction";
}

function drawLineTable(doc, snapshot) {
  sectionTitle(doc, "Earnings, deductions and employer contributions");
  const lines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
  const currency = snapshot.company?.currency_code || "GHS";
  const groups = [
    ["Earnings", lines.filter((line) => lineCategory(line) === "earning")],
    ["Deductions", lines.filter((line) => lineCategory(line) === "deduction")],
    ["Employer contributions", lines.filter((line) => lineCategory(line) === "employer")],
  ];

  for (const [title, group] of groups) {
    if (!group.length) continue;
    ensureSpace(doc, 54);
    doc.font("Helvetica-Bold").fontSize(8.4).fillColor(NAVY).text(title, 48, doc.y, { width: 150 });
    doc.moveDown(0.45);
    for (const line of group) {
      ensureSpace(doc, 24);
      const y = doc.y;
      doc.font("Helvetica").fontSize(8.6).fillColor(TEXT).text(cleanText(line.line_name || line.line_code, 160), 52, y, {
        width: 310,
        ellipsis: true,
        lineBreak: false,
      });
      const context = line.quantity !== null && line.quantity !== undefined
        ? `Qty ${line.quantity}${line.rate !== null && line.rate !== undefined ? ` · Rate ${line.rate}` : ""}`
        : line.rate !== null && line.rate !== undefined ? `Rate ${line.rate}` : "";
      if (context) {
        doc.font("Helvetica").fontSize(7.2).fillColor(MUTED).text(context, 310, y, { width: 110, align: "right", lineBreak: false });
      }
      doc.font("Helvetica-Bold").fontSize(8.6).fillColor(NAVY).text(money(line.amount, currency), 430, y, {
        width: 120,
        align: "right",
        lineBreak: false,
      });
      doc.moveTo(52, y + 15).lineTo(550, y + 15).lineWidth(0.4).strokeColor("#edf0f4").stroke();
      doc.y = y + 20;
    }
    doc.moveDown(0.35);
  }
}

function drawYtd(doc, snapshot) {
  ensureSpace(doc, 88);
  sectionTitle(doc, `Year-to-date totals${snapshot.ytd?.year ? ` — ${snapshot.ytd.year}` : ""}`);
  const currency = snapshot.company?.currency_code || "GHS";
  const y = doc.y;
  const values = [
    ["Gross", snapshot.ytd?.gross_earnings],
    ["Deductions", snapshot.ytd?.total_deductions],
    ["Employer contrib.", snapshot.ytd?.employer_contributions],
    ["Net", snapshot.ytd?.net_salary],
  ];
  const width = (doc.page.width - 84) / values.length;
  values.forEach(([label, value], index) => {
    const x = 42 + index * width;
    doc.font("Helvetica-Bold").fontSize(7.3).fillColor(MUTED).text(label.toUpperCase(), x + 6, y, { width: width - 12, align: "center", lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(NAVY).text(money(value, currency), x + 6, y + 15, { width: width - 12, align: "center", lineBreak: false });
  });
  doc.y = y + 42;
}

function drawPayments(doc, snapshot) {
  ensureSpace(doc, 80);
  sectionTitle(doc, "Payment evidence");
  const payments = Array.isArray(snapshot.payments) ? snapshot.payments : [];
  const currency = snapshot.company?.currency_code || "GHS";
  if (!payments.length) {
    doc.font("Helvetica").fontSize(8.7).fillColor(MUTED).text("No active salary payment evidence is attached to this snapshot.", 52, doc.y, { width: 498 });
    doc.moveDown();
    return;
  }
  for (const payment of payments) {
    ensureSpace(doc, 48);
    const y = doc.y;
    doc.roundedRect(48, y, 502, 40, 4).fillAndStroke("#ffffff", LINE);
    doc.font("Helvetica-Bold").fontSize(8.3).fillColor(NAVY).text(cleanText(payment.payment_number || payment.payment_reference, 120), 58, y + 8, { width: 155, lineBreak: false, ellipsis: true });
    doc.font("Helvetica").fontSize(7.7).fillColor(MUTED).text(`${formatDate(payment.payment_date)} · ${cleanText(payment.payment_method, 40).toUpperCase()}`, 58, y + 22, { width: 190, lineBreak: false });
    doc.font("Helvetica").fontSize(7.7).fillColor(TEXT).text(cleanText(payment.payment_reference, 150), 250, y + 8, { width: 150, align: "center", lineBreak: false, ellipsis: true });
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(cleanText(payment.destination_masked, 120) || "Destination masked", 250, y + 22, { width: 150, align: "center", lineBreak: false, ellipsis: true });
    doc.font("Helvetica-Bold").fontSize(8.8).fillColor(GREEN).text(money(payment.amount, currency), 410, y + 15, { width: 130, align: "right", lineBreak: false });
    doc.y = y + 48;
  }
}

async function drawVerification(doc, payslip, snapshot) {
  ensureSpace(doc, 145);
  sectionTitle(doc, "Authenticity and verification");
  const y = doc.y;
  let qr = null;
  try {
    qr = await createPayslipVerificationQr(payslip.verification_reference);
  } catch {
    qr = null;
  }
  if (qr) {
    doc.image(qr, 48, y, { fit: [94, 94] });
  } else {
    doc.roundedRect(48, y, 94, 94, 5).fillAndStroke(LIGHT, LINE);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text("QR unavailable", 55, y + 39, { width: 80, align: "center" });
  }
  doc.font("Helvetica-Bold").fontSize(9.2).fillColor(NAVY).text("Scan to verify this payslip", 160, y + 4, { width: 390 });
  doc.font("Helvetica").fontSize(8.2).fillColor(TEXT).text(
    "The QR opens the Chalin 03 Verification Centre. A valid result confirms that this exact immutable payslip snapshot matches the Chalin 03 payroll system.",
    160,
    y + 23,
    { width: 385, lineGap: 2 }
  );
  doc.font("Helvetica-Bold").fontSize(7.4).fillColor(MUTED).text("PAYSLIP CHECKSUM", 160, y + 61, { width: 385 });
  doc.font("Courier").fontSize(6.5).fillColor(TEXT).text(cleanText(payslip.checksum_sha256, 64), 160, y + 74, { width: 385, lineBreak: false });
  doc.font("Helvetica").fontSize(7.6).fillColor(MUTED).text(`Issued ${formatDate(snapshot.payslip?.issued_at)} · Version ${snapshot.payslip?.issue_version || payslip.issue_version || 1}`, 160, y + 90, { width: 385, lineBreak: false });
  doc.y = y + 112;
}

function drawHeader(doc, payslip, snapshot) {
  doc.rect(0, 0, doc.page.width, 18).fill(NAVY);
  doc.rect(0, 18, doc.page.width, 4).fill(GOLD);
  drawLogo(doc, 42, 36, 58);
  doc.font("Helvetica-Bold").fontSize(16.5).fillColor(NAVY).text("CHALIN 03 COMPANY LIMITED", 116, 40, {
    width: 300,
    lineBreak: false,
  });
  doc.font("Helvetica").fontSize(8.2).fillColor(MUTED).text(`${workspaceLabel(snapshot.company?.workspace_code)} · Payroll`, 116, 64, { width: 300, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(GOLD).text("PROFESSIONAL PAYSLIP", 116, 80, { width: 300, lineBreak: false });
  doc.roundedRect(430, 38, 122, 54, 5).fill(NAVY);
  doc.font("Helvetica-Bold").fontSize(7.2).fillColor(GOLD).text("PAYSLIP NUMBER", 438, 48, { width: 106, align: "center", lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(8.2).fillColor("#ffffff").text(cleanText(payslip.payslip_number, 120), 438, 64, { width: 106, align: "center", lineBreak: false, ellipsis: true });
  doc.font("Helvetica").fontSize(6.8).fillColor("#dfe7ef").text(`Version ${payslip.issue_version || 1}`, 438, 79, { width: 106, align: "center", lineBreak: false });
  doc.moveTo(42, 106).lineTo(552, 106).lineWidth(1).strokeColor(GOLD).stroke();
  doc.y = 122;
}

async function buildPayslipPdf(payslip) {
  const snapshot = payslip?.snapshot || {};
  const doc = new PDFDocument({ size: "A4", margin: 42, info: {
    Title: `Chalin 03 Payslip ${payslip?.payslip_number || ""}`,
    Author: "Chalin 03 Company Limited",
    Subject: "Professional payroll payslip",
  } });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  drawHeader(doc, payslip, snapshot);
  drawSummaryCard(doc, snapshot);
  drawMoneySummary(doc, snapshot);
  drawLineTable(doc, snapshot);
  drawYtd(doc, snapshot);
  drawPayments(doc, snapshot);
  await drawVerification(doc, payslip, snapshot);

  ensureSpace(doc, 58);
  const y = doc.y + 4;
  doc.moveTo(42, y).lineTo(552, y).lineWidth(0.6).strokeColor(LINE).stroke();
  doc.font("Helvetica").fontSize(7.4).fillColor(MUTED).text(
    "This document is generated from an immutable Chalin 03 payroll snapshot. Bank or mobile-money destinations are intentionally masked. Verify the QR before relying on a printed or downloaded copy.",
    42,
    y + 10,
    { width: 510, align: "center", lineGap: 1.5 }
  );

  doc.end();
  return await new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

module.exports = {
  buildPayslipPdf,
};
