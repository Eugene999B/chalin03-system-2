const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

const {
  latestCustomerPhoto,
} = require("./equipmentFinanceCustomerPhotoRendererService");

const COLORS = Object.freeze({
  green: "#0d4f36",
  greenDark: "#082f22",
  greenSoft: "#eaf3ed",
  gold: "#d3a72c",
  goldDark: "#8c6814",
  goldSoft: "#fbf5df",
  ink: "#17251e",
  muted: "#647169",
  line: "#d7e0da",
  paper: "#ffffff",
  ash: "#f4f7f5",
  danger: "#8f2f2f",
});

const TEMPLATES = Object.freeze({
  installment_agreement: {
    family: "legal",
    title: "INSTALLMENT SALE AGREEMENT",
    subtitle: "Master Contract",
    badge: "ORIGINAL",
    watermark: "INSTALLMENT AGREEMENT",
  },
  customer_agreement_copy: {
    family: "legal",
    title: "INSTALLMENT SALE AGREEMENT",
    subtitle: "Customer Retention Copy",
    badge: "CUSTOMER COPY",
    watermark: "CUSTOMER COPY",
  },
  company_agreement_copy: {
    family: "legal",
    title: "INSTALLMENT SALE AGREEMENT",
    subtitle: "Controlled Company File",
    badge: "COMPANY COPY",
    watermark: "COMPANY COPY",
  },
  boss_approval_pack: {
    family: "executive",
    title: "EXECUTIVE FINANCE APPROVAL PACK",
    subtitle: "Management Decision Dossier",
    badge: "INTERNAL APPROVAL",
    watermark: "APPROVAL PACK",
  },
  payment_schedule: {
    family: "schedule",
    title: "OFFICIAL INSTALLMENT SCHEDULE",
    subtitle: "Exact Dated Payment Plan",
    badge: "FINANCE SCHEDULE",
    watermark: "PAYMENT SCHEDULE",
  },
  payment_receipt: {
    family: "receipt",
    title: "OFFICIAL PAYMENT RECEIPT",
    subtitle: "Committed Finance Payment",
    badge: "PAID / RECEIVED",
    watermark: "OFFICIAL RECEIPT",
  },
  customer_statement: {
    family: "statement",
    title: "CUSTOMER INSTALLMENT STATEMENT",
    subtitle: "Reconciled Account Position",
    badge: "ACCOUNT STATEMENT",
    watermark: "CUSTOMER STATEMENT",
  },
  machine_annexure: {
    family: "evidence",
    title: "MACHINE IDENTITY ANNEXURE",
    subtitle: "Protected Equipment Evidence",
    badge: "EVIDENCE ANNEXURE",
    watermark: "MACHINE ANNEXURE",
  },
  guarantor_undertaking: {
    family: "legal-support",
    title: "GUARANTOR UNDERTAKING",
    subtitle: "Supporting Legal Obligation",
    badge: "LEGAL UNDERTAKING",
    watermark: "GUARANTOR UNDERTAKING",
  },
  delivery_handover_note: {
    family: "operations",
    title: "DELIVERY & HANDOVER NOTE",
    subtitle: "Controlled Physical Release Record",
    badge: "HANDOVER RECORD",
    watermark: "DELIVERY HANDOVER",
  },
  arrears_notice: {
    family: "notice",
    title: "FORMAL ARREARS NOTICE",
    subtitle: "Notice of Overdue Installments",
    badge: "ACTION REQUIRED",
    watermark: "ARREARS NOTICE",
  },
  amendment_agreement: {
    family: "amendment",
    title: "AGREEMENT AMENDMENT",
    subtitle: "Approved Change Control Record",
    badge: "AMENDMENT",
    watermark: "AMENDMENT",
  },
  settlement_confirmation: {
    family: "certificate",
    title: "FULL SETTLEMENT CERTIFICATE",
    subtitle: "Official Account Completion",
    badge: "FULLY SETTLED",
    watermark: "SETTLED",
  },
  ownership_transfer: {
    family: "certificate",
    title: "OWNERSHIP TRANSFER CERTIFICATE",
    subtitle: "Controlled Transfer of Equipment Title",
    badge: "OWNERSHIP TRANSFER",
    watermark: "OWNERSHIP TRANSFER",
  },
});

const PHOTO_DOCUMENT_TYPES = new Set([
  "installment_agreement",
  "customer_agreement_copy",
  "company_agreement_copy",
  "boss_approval_pack",
  "guarantor_undertaking",
  "customer_statement",
  "delivery_handover_note",
  "arrears_notice",
  "amendment_agreement",
  "settlement_confirmation",
  "ownership_transfer",
]);

function clean(value, fallback = "Not recorded") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function label(value, fallback = "Not recorded") {
  return clean(value, fallback)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateLabel(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("en-GH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "Africa/Accra",
  });
}

function dateTimeLabel(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-GH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Accra",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function dataImage(value) {
  const match = String(value || "").match(
    /^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i
  );
  if (!match) return null;
  const buffer = Buffer.from(match[1], "base64");
  return buffer.length ? buffer : null;
}

function templateFor(document) {
  return (
    TEMPLATES[document.document_type] || {
      family: "legal",
      title: label(document.document_type),
      subtitle: "Official Chalin 03 Finance Document",
      badge: "OFFICIAL",
      watermark: label(document.document_type),
    }
  );
}

function agreementOf(document) {
  return document.snapshot?.agreement || {};
}

function customerName(document) {
  const agreement = agreementOf(document);
  return clean(
    agreement.kyc_customer_name ||
      agreement.customer_name_snapshot ||
      agreement.customer_name,
    "Customer"
  );
}

function machineName(document) {
  const agreement = agreementOf(document);
  return `${clean(agreement.asset_code, "")} — ${clean(agreement.asset_name, "")}`;
}

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function pageBottom(doc) {
  return doc.page.height - doc.page.margins.bottom - 28;
}

function needsPage(doc, height) {
  return doc.y + height > pageBottom(doc);
}

function officialLogoBuffer(snapshot) {
  return dataImage(
    snapshot?.company?.official_logo_data_url ||
      snapshot?.company?.logo_data_url ||
      snapshot?.company?.logo_url
  );
}

function drawOfficialLogo(doc, snapshot, x, y, size = 48) {
  const logo = officialLogoBuffer(snapshot);
  if (logo) {
    doc.save().roundedRect(x, y, size, size, 8).clip();
    doc.image(logo, x, y, { fit: [size, size], align: "center", valign: "center" });
    doc.restore();
    return;
  }

  doc.save();
  doc.circle(x + size / 2, y + size / 2, size / 2).fill(COLORS.gold);
  doc.circle(x + size / 2, y + size / 2, size / 2 - 4).lineWidth(2).stroke(COLORS.greenDark);
  doc.fillColor(COLORS.greenDark).font("Helvetica-Bold").fontSize(size * 0.28).text(
    "C03",
    x,
    y + size * 0.29,
    { width: size, align: "center", lineBreak: false }
  );
  doc.restore();
}

function drawWatermark(doc, document) {
  const template = templateFor(document);
  const centreX = doc.page.width / 2;
  const centreY = doc.page.height / 2;
  doc.save();
  doc.fillColor(COLORS.greenDark).fillOpacity(0.045);
  doc.font("Helvetica-Bold").fontSize(template.family === "certificate" ? 46 : 38);
  doc.rotate(-34, { origin: [centreX, centreY] });
  doc.text(template.watermark, centreX - 300, centreY - 25, {
    width: 600,
    align: "center",
    lineBreak: false,
  });
  doc.restore();
}

function drawCertificateFrame(doc) {
  const inset = 18;
  doc.save();
  doc.rect(inset, inset, doc.page.width - inset * 2, doc.page.height - inset * 2)
    .lineWidth(2.2)
    .strokeColor(COLORS.greenDark)
    .stroke();
  doc.rect(inset + 6, inset + 6, doc.page.width - (inset + 6) * 2, doc.page.height - (inset + 6) * 2)
    .lineWidth(0.8)
    .strokeColor(COLORS.gold)
    .stroke();
  doc.restore();
}

function drawHeader(doc, document, compact = false) {
  const snapshot = document.snapshot || {};
  const template = templateFor(document);
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const y = doc.page.margins.top;

  drawWatermark(doc, document);
  if (template.family === "certificate") drawCertificateFrame(doc);

  if (compact) {
    drawOfficialLogo(doc, snapshot, left + width / 2 - 18, y, 36);
    doc.fillColor(COLORS.greenDark).font("Helvetica-Bold").fontSize(9).text(
      clean(snapshot.company?.name, "CHALIN 03 COMPANY LIMITED"),
      left,
      y + 42,
      { width, align: "center" }
    );
    doc.y = y + 58;
    return;
  }

  if (template.family === "executive") {
    doc.save().roundedRect(left, y, width, 78, 9).fill(COLORS.greenDark).restore();
    drawOfficialLogo(doc, snapshot, left + 14, y + 15, 48);
    doc.fillColor(COLORS.paper).font("Helvetica-Bold").fontSize(15).text(
      clean(snapshot.company?.name, "CHALIN 03 COMPANY LIMITED"),
      left + 76,
      y + 14,
      { width: width - 230 }
    );
    doc.fillColor("#dfeae3").font("Helvetica").fontSize(7.4).text(
      template.subtitle,
      left + 76,
      y + 40,
      { width: width - 230 }
    );
    doc.save().roundedRect(left + width - 142, y + 21, 125, 34, 17).fill(COLORS.gold).restore();
    doc.fillColor(COLORS.greenDark).font("Helvetica-Bold").fontSize(8).text(
      template.badge,
      left + width - 136,
      y + 33,
      { width: 113, align: "center", lineBreak: false }
    );
    doc.y = y + 96;
  } else if (template.family === "receipt") {
    drawOfficialLogo(doc, snapshot, left, y, 52);
    doc.fillColor(COLORS.greenDark).font("Helvetica-Bold").fontSize(13).text(
      clean(snapshot.company?.name, "CHALIN 03 COMPANY LIMITED"),
      left + 64,
      y + 4,
      { width: width - 64 }
    );
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7).text(
      [snapshot.company?.phone, snapshot.company?.email, snapshot.company?.postal_address]
        .filter(Boolean)
        .join("  •  "),
      left + 64,
      y + 27,
      { width: width - 64 }
    );
    doc.save().roundedRect(left, y + 65, width, 58, 8).fill(COLORS.goldSoft).restore();
    doc.fillColor(COLORS.greenDark).font("Helvetica-Bold").fontSize(19).text(
      template.title,
      left,
      y + 77,
      { width, align: "center" }
    );
    doc.fillColor(COLORS.goldDark).font("Helvetica-Bold").fontSize(8).text(
      template.badge,
      left,
      y + 105,
      { width, align: "center" }
    );
    doc.y = y + 139;
  } else if (template.family === "certificate") {
    drawOfficialLogo(doc, snapshot, doc.page.width / 2 - 30, y + 8, 60);
    doc.fillColor(COLORS.greenDark).font("Helvetica-Bold").fontSize(12).text(
      clean(snapshot.company?.name, "CHALIN 03 COMPANY LIMITED"),
      left,
      y + 78,
      { width, align: "center" }
    );
    doc.fillColor(COLORS.goldDark).font("Helvetica-Bold").fontSize(8).text(
      "OFFICIAL FINANCE CERTIFICATE",
      left,
      y + 98,
      { width, align: "center", characterSpacing: 1.2 }
    );
    doc.y = y + 122;
  } else {
    doc.save().rect(0, 0, doc.page.width, 14).fill(COLORS.greenDark).restore();
    drawOfficialLogo(doc, snapshot, left, y, 50);
    doc.fillColor(COLORS.greenDark).font("Helvetica-Bold").fontSize(14).text(
      clean(snapshot.company?.name, "CHALIN 03 COMPANY LIMITED"),
      left + 64,
      y + 2,
      { width: width - 64 }
    );
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7).text(
      [snapshot.company?.phone, snapshot.company?.email, snapshot.company?.postal_address]
        .filter(Boolean)
        .join("  •  "),
      left + 64,
      y + 27,
      { width: width - 64 }
    );
    doc.moveTo(left, y + 59).lineTo(left + width, y + 59).lineWidth(3).strokeColor(COLORS.gold).stroke();
    doc.y = y + 75;
  }

  if (template.family !== "receipt" && template.family !== "certificate" && template.family !== "executive") {
    doc.fillColor(COLORS.greenDark).font("Helvetica-Bold").fontSize(17).text(template.title, {
      align: template.family === "legal" ? "left" : "center",
    });
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8).text(template.subtitle, {
      align: template.family === "legal" ? "left" : "center",
    });
    doc.moveDown(0.45);
    drawBadge(doc, template.badge, template.family === "notice" ? COLORS.danger : COLORS.greenDark);
  }

  drawDocumentIdentity(doc, document);
}

function drawBadge(doc, badge, fill = COLORS.greenDark) {
  const left = doc.page.margins.left;
  const width = Math.min(180, Math.max(90, doc.widthOfString(badge) + 28));
  const x = left;
  const y = doc.y;
  doc.save().roundedRect(x, y, width, 22, 11).fill(fill).restore();
  doc.fillColor(COLORS.paper).font("Helvetica-Bold").fontSize(7).text(badge, x + 8, y + 7, {
    width: width - 16,
    align: "center",
    lineBreak: false,
  });
  doc.y = y + 31;
}

function drawDocumentIdentity(doc, document) {
  const agreement = agreementOf(document);
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const y = doc.y;
  doc.save().roundedRect(left, y, width, 42, 7).fill(COLORS.ash).restore();
  const cells = [
    ["DOCUMENT NO.", document.document_number],
    ["AGREEMENT", agreement.agreement_number],
    ["ISSUED", dateTimeLabel(document.issued_at || document.snapshot?.generated_at)],
  ];
  const cellWidth = width / cells.length;
  cells.forEach(([title, value], index) => {
    const x = left + index * cellWidth;
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(5.8).text(title, x + 8, y + 8, {
      width: cellWidth - 16,
    });
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(7.5).text(clean(value), x + 8, y + 20, {
      width: cellWidth - 16,
      ellipsis: true,
    });
    if (index) doc.moveTo(x, y + 7).lineTo(x, y + 35).lineWidth(0.5).strokeColor(COLORS.line).stroke();
  });
  doc.y = y + 55;
}

function addPage(doc, document, compact = false) {
  doc.addPage();
  drawHeader(doc, document, compact);
}

function ensureSpace(doc, document, height) {
  if (needsPage(doc, height)) addPage(doc, document, false);
}

function sectionTitle(doc, document, title, options = {}) {
  ensureSpace(doc, document, 38);
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const y = doc.y;
  doc.save().roundedRect(left, y, width, 27, 5).fill(options.fill || COLORS.greenSoft).restore();
  doc.fillColor(options.color || COLORS.greenDark).font("Helvetica-Bold").fontSize(9).text(
    options.number ? `${options.number}. ${title}` : title,
    left + 10,
    y + 8,
    { width: width - 20 }
  );
  doc.y = y + 36;
}

function factGrid(doc, document, items, columns = 2) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const gap = 8;
  const cellWidth = (width - gap * (columns - 1)) / columns;
  for (let index = 0; index < items.length; index += columns) {
    ensureSpace(doc, document, 57);
    const y = doc.y;
    for (let column = 0; column < columns; column += 1) {
      const item = items[index + column];
      if (!item) continue;
      const x = left + column * (cellWidth + gap);
      doc.save().roundedRect(x, y, cellWidth, 47, 6).fillAndStroke(COLORS.ash, COLORS.line).restore();
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(5.8).text(item[0], x + 9, y + 8, {
        width: cellWidth - 18,
      });
      doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(8.5).text(clean(item[1]), x + 9, y + 21, {
        width: cellWidth - 18,
        ellipsis: true,
      });
    }
    doc.y = y + 56;
  }
}

function paragraph(doc, document, value, options = {}) {
  ensureSpace(doc, document, 50);
  doc.fillColor(options.color || COLORS.ink)
    .font(options.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(options.size || 8.5)
    .text(clean(value, ""), {
      align: options.align || "justify",
      lineGap: options.lineGap ?? 2.5,
    });
  doc.moveDown(options.after ?? 0.7);
}

function table(doc, document, columns, rows, options = {}) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const total = columns.reduce((sum, column) => sum + column.units, 0);
  const positions = [];
  let x = left;
  for (const column of columns) {
    const columnWidth = (width * column.units) / total;
    positions.push({ ...column, x, width: columnWidth });
    x += columnWidth;
  }

  function header() {
    ensureSpace(doc, document, 34);
    const y = doc.y;
    doc.save().roundedRect(left, y, width, 23, 4).fill(options.headerFill || COLORS.greenDark).restore();
    positions.forEach((column) => {
      doc.fillColor(COLORS.paper).font("Helvetica-Bold").fontSize(6.4).text(
        column.title,
        column.x + 4,
        y + 8,
        { width: column.width - 8, align: column.align || "left" }
      );
    });
    doc.y = y + 28;
  }

  header();
  if (!rows.length) {
    doc.fillColor(COLORS.muted).font("Helvetica-Oblique").fontSize(7.5).text(
      options.emptyText || "No records are available for this section.",
      left,
      doc.y + 6,
      { width, align: "center" }
    );
    doc.y += 30;
    return;
  }

  rows.forEach((row, rowIndex) => {
    if (needsPage(doc, 27)) {
      addPage(doc, document);
      header();
    }
    const y = doc.y;
    if (rowIndex % 2 === 1) doc.save().rect(left, y - 2, width, 21).fill(COLORS.ash).restore();
    positions.forEach((column, index) => {
      doc.fillColor(COLORS.ink).font("Helvetica").fontSize(6.6).text(
        clean(row[index], ""),
        column.x + 4,
        y + 3,
        { width: column.width - 8, align: column.align || "left", ellipsis: true }
      );
    });
    doc.y = y + 20;
    doc.moveTo(left, doc.y - 1).lineTo(left + width, doc.y - 1).lineWidth(0.25).strokeColor(COLORS.line).stroke();
  });
}

function scheduleTable(doc, document, rows = document.snapshot?.schedule || []) {
  table(
    doc,
    document,
    [
      { title: "NO.", units: 0.5, align: "center" },
      { title: "DUE DATE", units: 1.25 },
      { title: "SCHEDULED", units: 1.35, align: "right" },
      { title: "PAID", units: 1.25, align: "right" },
      { title: "BALANCE", units: 1.35, align: "right" },
      { title: "STATUS", units: 1.05, align: "center" },
    ],
    rows.map((row) => [
      row.sequence_number,
      dateLabel(row.due_date),
      money(row.scheduled_amount),
      money(row.amount_paid),
      money(row.balance),
      label(row.schedule_status),
    ])
  );
}

function paymentTable(doc, document, rows = document.snapshot?.payments || []) {
  table(
    doc,
    document,
    [
      { title: "RECEIPT", units: 1.4 },
      { title: "DATE", units: 1.2 },
      { title: "METHOD", units: 1 },
      { title: "AMOUNT", units: 1.3, align: "right" },
      { title: "RECEIVED BY", units: 1.5 },
    ],
    rows.map((row) => [
      row.receipt_number || row.payment_number,
      dateLabel(row.payment_date),
      label(row.payment_method),
      money(row.amount),
      row.received_by_name || "Finance staff",
    ]),
    { emptyText: "No payments have been committed to this agreement yet." }
  );
}

function signaturePanel(doc, document, roles) {
  sectionTitle(doc, document, "Execution & Signatures");
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const gap = 16;
  const cellWidth = (width - gap) / 2;
  roles.forEach(([role, title], index) => {
    if (index % 2 === 0) ensureSpace(doc, document, 105);
    const rowY = index % 2 === 0 ? doc.y : doc.y - 96;
    const x = left + (index % 2) * (cellWidth + gap);
    const record = document.snapshot?.signatures?.find((item) => item.signer_role === role);
    const fallback = role === "seller" ? document.snapshot?.company?.authorised_seller_signature_data_url : null;
    const image = dataImage(record?.signature_data_url || fallback);
    doc.save().roundedRect(x, rowY, cellWidth, 88, 7).strokeColor(COLORS.line).stroke().restore();
    doc.fillColor(COLORS.greenDark).font("Helvetica-Bold").fontSize(8).text(title, x + 10, rowY + 9, {
      width: cellWidth - 20,
    });
    if (image) doc.image(image, x + 10, rowY + 25, { fit: [130, 30] });
    doc.fillColor(COLORS.ink).font("Helvetica").fontSize(7).text(
      `Name: ${clean(record?.signer_name || (role === "seller" ? document.snapshot?.company?.authorised_seller_name : ""), "")}`,
      x + 10,
      rowY + 57,
      { width: cellWidth - 20 }
    );
    doc.moveTo(x + 10, rowY + 78).lineTo(x + cellWidth - 10, rowY + 78).lineWidth(0.5).strokeColor(COLORS.muted).stroke();
    if (index % 2 === 1 || index === roles.length - 1) doc.y = rowY + 98;
  });
}

function agreementSummaryItems(document) {
  const agreement = agreementOf(document);
  return [
    ["CUSTOMER / BUYER", customerName(document)],
    ["AGREEMENT NUMBER", agreement.agreement_number],
    ["MACHINE", machineName(document)],
    ["SERIAL / CHASSIS", agreement.serial_number || agreement.chassis_number],
    ["PURCHASE PRICE", money(agreement.total_amount)],
    ["OPENING DEPOSIT", money(agreement.deposit_required || agreement.deposit_received)],
    ["AMOUNT PAID", money(agreement.amount_paid)],
    ["OFFICIAL BALANCE", money(agreement.outstanding_balance)],
  ];
}

function renderLegalAgreement(doc, document) {
  const agreement = agreementOf(document);
  const image = dataImage(
    document.snapshot?.media?.find((item) => item.evidence_type === "main")?.file_url ||
      document.snapshot?.media?.find((item) => item.is_primary)?.file_url ||
      agreement.main_image_url
  );

  if (image) {
    ensureSpace(doc, document, 185);
    const left = doc.page.margins.left;
    const width = contentWidth(doc);
    const y = doc.y;
    doc.save().roundedRect(left, y, width, 168, 8).fillAndStroke(COLORS.ash, COLORS.line).restore();
    doc.image(image, left + 7, y + 7, { fit: [width - 14, 154], align: "center", valign: "center" });
    doc.y = y + 180;
  }

  sectionTitle(doc, document, "Parties & Equipment", { number: "1" });
  factGrid(doc, document, [
    ["BUYER", customerName(document)],
    ["PHONE", agreement.kyc_customer_phone || agreement.customer_phone_snapshot],
    ["ADDRESS", agreement.residential_address || agreement.customer_address_snapshot],
    ["OFFICIAL ID", `${clean(agreement.id_type, "ID")} ${clean(agreement.id_number, "")}`],
    ["MACHINE", machineName(document)],
    ["MAKE / MODEL", `${clean(agreement.make, "")} ${clean(agreement.model, "")}`],
    ["SERIAL NUMBER", agreement.serial_number],
    ["CHASSIS NUMBER", agreement.chassis_number],
  ]);

  sectionTitle(doc, document, "Commercial Terms", { number: "2" });
  factGrid(doc, document, agreementSummaryItems(document));
  factGrid(doc, document, [
    ["PAYMENT FREQUENCY", label(agreement.payment_frequency)],
    ["NUMBER OF PAYMENTS", agreement.installment_count],
    ["FIRST DUE DATE", dateLabel(agreement.first_due_date)],
    ["FINAL DUE DATE", dateLabel(agreement.final_due_date)],
  ]);

  addPage(doc, document);
  sectionTitle(doc, document, "Exact Installment Schedule", { number: "3" });
  scheduleTable(doc, document);

  addPage(doc, document);
  sectionTitle(doc, document, `Terms & Conditions — ${clean(document.snapshot?.template_version, "Current Version")}`, {
    number: "4",
  });
  const terms = clean(document.snapshot?.policy?.agreement_terms, "No approved terms were included in this snapshot.");
  terms
    .split(/\n{2,}|(?=\b\d+\.\s)/)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .forEach((clause, index) => {
      ensureSpace(doc, document, 44);
      doc.fillColor(COLORS.goldDark).font("Helvetica-Bold").fontSize(8).text(`${index + 1}.`, {
        continued: true,
      });
      doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8.2).text(` ${clause.replace(/^\d+\.\s*/, "")}`, {
        align: "justify",
        lineGap: 2.2,
      });
      doc.moveDown(0.45);
    });

  signaturePanel(doc, document, [
    ["seller", "Authorised Seller Representative"],
    ["buyer", "Buyer / Customer"],
    ["buyer_witness", "Buyer Witness"],
    ["guarantor", "Guarantor"],
  ]);
}

function renderExecutivePack(doc, document) {
  const agreement = agreementOf(document);
  sectionTitle(doc, document, "Executive Decision Summary", { fill: COLORS.goldSoft });
  factGrid(doc, document, [
    ["RECOMMENDATION", agreement.assessment_recommendation || "Approved"],
    ["APPLICATION STATUS", label(agreement.application_status)],
    ["KYC STATUS", label(agreement.kyc_status)],
    ["AFFORDABILITY", label(agreement.affordability_status)],
    ["RISK BAND", label(agreement.risk_band)],
    ["RISK SCORE", agreement.risk_score],
    ["RECONCILIATION", document.snapshot?.reconciliation?.consistent ? "VERIFIED" : "MISMATCH"],
    ["OFFICIAL BALANCE", money(agreement.outstanding_balance)],
  ]);

  sectionTitle(doc, document, "Customer, Machine & Offer");
  factGrid(doc, document, agreementSummaryItems(document));

  const image = dataImage(
    document.snapshot?.media?.find((item) => item.evidence_type === "main")?.file_url ||
      document.snapshot?.media?.find((item) => item.is_primary)?.file_url ||
      agreement.main_image_url
  );
  if (image) {
    sectionTitle(doc, document, "Exact Approved Machine");
    ensureSpace(doc, document, 210);
    const left = doc.page.margins.left;
    const y = doc.y;
    doc.save().roundedRect(left, y, contentWidth(doc), 190, 8).fillAndStroke(COLORS.ash, COLORS.line).restore();
    doc.image(image, left + 8, y + 8, { fit: [contentWidth(doc) - 16, 174], align: "center", valign: "center" });
    doc.y = y + 202;
  }

  sectionTitle(doc, document, "Approved Schedule Overview");
  scheduleTable(doc, document, (document.snapshot?.schedule || []).slice(0, 12));
}

function renderReceipt(doc, document, thermal = false) {
  const agreement = agreementOf(document);
  const payment = document.snapshot?.document_context?.payment || {};
  if (thermal) {
    doc.fillColor(COLORS.greenDark).font("Helvetica-Bold").fontSize(11).text("OFFICIAL PAYMENT RECEIPT", {
      align: "center",
    });
    doc.fillColor(COLORS.goldDark).font("Helvetica-Bold").fontSize(7).text(document.document_number, {
      align: "center",
    });
    doc.moveDown();
    doc.save().roundedRect(doc.page.margins.left, doc.y, contentWidth(doc), 56, 6).fill(COLORS.goldSoft).restore();
    const boxY = doc.y;
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(6).text("AMOUNT RECEIVED", {
      align: "center",
    });
    doc.fillColor(COLORS.greenDark).font("Helvetica-Bold").fontSize(16).text(money(payment.amount), {
      align: "center",
    });
    doc.y = boxY + 68;
    [
      ["Customer", customerName(document)],
      ["Agreement", agreement.agreement_number],
      ["Machine", machineName(document)],
      ["Date", dateTimeLabel(payment.payment_date)],
      ["Method", label(payment.payment_method)],
      ["Reference", payment.reference_number || "—"],
      ["Received by", payment.received_by_name || "Finance staff"],
      ["Official balance", money(agreement.outstanding_balance)],
    ].forEach(([name, value]) => {
      doc.fillColor(COLORS.greenDark).font("Helvetica-Bold").fontSize(6.8).text(`${name}: `, { continued: true });
      doc.fillColor(COLORS.ink).font("Helvetica").text(clean(value, ""));
    });
    doc.moveDown(0.7).fillColor(COLORS.greenDark).font("Helvetica-Bold").fontSize(7.5).text(
      "PAYMENT RECEIVED WITH THANKS",
      { align: "center" }
    );
    return;
  }

  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const y = doc.y;
  doc.save().roundedRect(left, y, width, 92, 9).fill(COLORS.greenDark).restore();
  doc.fillColor("#cfe0d5").font("Helvetica").fontSize(7).text("AMOUNT RECEIVED", left + 18, y + 17, {
    width: width - 36,
    align: "center",
  });
  doc.fillColor(COLORS.paper).font("Helvetica-Bold").fontSize(27).text(money(payment.amount), left + 18, y + 36, {
    width: width - 36,
    align: "center",
  });
  doc.y = y + 108;

  sectionTitle(doc, document, "Payment Confirmation");
  factGrid(doc, document, [
    ["CUSTOMER", customerName(document)],
    ["RECEIPT NUMBER", payment.receipt_number || payment.payment_number],
    ["PAYMENT DATE", dateTimeLabel(payment.payment_date)],
    ["PAYMENT METHOD", label(payment.payment_method)],
    ["REFERENCE", payment.reference_number],
    ["RECEIVED BY", payment.received_by_name || "Finance staff"],
    ["MACHINE", machineName(document)],
    ["OFFICIAL BALANCE", money(agreement.outstanding_balance)],
  ]);

  sectionTitle(doc, document, "Oldest-Due-First Allocation");
  table(
    doc,
    document,
    [
      { title: "INSTALLMENT", units: 1 },
      { title: "DUE DATE", units: 1.4 },
      { title: "ALLOCATED", units: 1.4, align: "right" },
    ],
    (document.snapshot?.document_context?.payment_allocations || []).map((row) => [
      row.sequence_number,
      dateLabel(row.due_date),
      money(row.allocated_amount),
    ]),
    { emptyText: "This payment has no schedule allocation details." }
  );

  doc.moveDown(1).fillColor(COLORS.greenDark).font("Helvetica-Bold").fontSize(11).text(
    "PAYMENT RECEIVED WITH THANKS",
    { align: "center" }
  );
}

function renderSchedule(doc, document) {
  sectionTitle(doc, document, "Agreement Overview", { fill: COLORS.goldSoft });
  factGrid(doc, document, agreementSummaryItems(document));
  sectionTitle(doc, document, "Exact Dated Installment Plan");
  scheduleTable(doc, document);
  paragraph(
    doc,
    document,
    "This schedule forms part of the approved installment agreement. Payments must be recorded through the official Chalin 03 Finance payment workflow and supported by a numbered receipt.",
    { size: 7.6, color: COLORS.muted }
  );
}

function renderStatement(doc, document) {
  const agreement = agreementOf(document);
  const overdue = document.snapshot?.document_context?.overdue || {};
  sectionTitle(doc, document, "Statement Position", { fill: COLORS.goldSoft });
  factGrid(doc, document, [
    ["STATEMENT DATE", dateLabel(document.snapshot?.generated_at)],
    ["CUSTOMER", customerName(document)],
    ["PURCHASE PRICE", money(agreement.total_amount)],
    ["TOTAL PAID", money(agreement.amount_paid)],
    ["OFFICIAL BALANCE", money(agreement.outstanding_balance)],
    ["OVERDUE AMOUNT", money(overdue.amount)],
  ], 3);
  sectionTitle(doc, document, "Payment History");
  paymentTable(doc, document);
  sectionTitle(doc, document, "Remaining Installments");
  scheduleTable(
    doc,
    document,
    (document.snapshot?.schedule || []).filter((row) => Number(row.balance || 0) > 0.01)
  );
}

function renderMachineAnnexure(doc, document) {
  const agreement = agreementOf(document);
  sectionTitle(doc, document, "Machine Identity Record", { fill: COLORS.goldSoft });
  factGrid(doc, document, [
    ["EQUIPMENT", machineName(document)],
    ["MAKE / MODEL", `${clean(agreement.make, "")} ${clean(agreement.model, "")}`],
    ["SERIAL NUMBER", agreement.serial_number],
    ["CHASSIS NUMBER", agreement.chassis_number],
    ["ENGINE NUMBER", agreement.engine_number],
    ["REGISTRATION", agreement.registration_number],
    ["COLOUR", agreement.colour],
    ["CONDITION", label(agreement.condition_status)],
  ]);
  sectionTitle(doc, document, "Protected Machine Photographs");
  const media = document.snapshot?.media || [];
  let rendered = 0;
  media.slice(0, 10).forEach((item, index) => {
    const image = dataImage(item.file_url);
    if (!image) return;
    ensureSpace(doc, document, 195);
    const left = doc.page.margins.left;
    const y = doc.y;
    doc.save().roundedRect(left, y, contentWidth(doc), 170, 8).fillAndStroke(COLORS.ash, COLORS.line).restore();
    doc.image(image, left + 8, y + 8, { fit: [contentWidth(doc) - 16, 145], align: "center", valign: "center" });
    doc.fillColor(COLORS.greenDark).font("Helvetica-Bold").fontSize(7).text(
      `${index + 1}. ${label(item.evidence_type)}${item.caption ? ` — ${item.caption}` : ""}`,
      left + 10,
      y + 156,
      { width: contentWidth(doc) - 20, align: "center" }
    );
    doc.y = y + 183;
    rendered += 1;
  });
  if (!rendered) paragraph(doc, document, "No protected machine photograph was available in this immutable snapshot.", { align: "center", color: COLORS.muted });
}

function renderGuarantor(doc, document) {
  const agreement = agreementOf(document);
  sectionTitle(doc, document, "Guarantor Identity", { fill: COLORS.goldSoft });
  factGrid(doc, document, [
    ["GUARANTOR", agreement.guarantor_name],
    ["PHONE", agreement.guarantor_phone],
    ["OFFICIAL ID", agreement.guarantor_id_number],
    ["RELATIONSHIP", agreement.guarantor_relationship],
    ["BUYER", customerName(document)],
    ["AGREEMENT", agreement.agreement_number],
    ["MACHINE", machineName(document)],
    ["GUARANTEED BALANCE", money(agreement.outstanding_balance)],
  ]);
  sectionTitle(doc, document, "Formal Undertaking");
  paragraph(
    doc,
    document,
    `I, ${clean(agreement.guarantor_name)}, confirm that I have reviewed the installment obligation of ${customerName(document)} under agreement ${clean(agreement.agreement_number)}. I undertake to support the buyer's performance and to cooperate with Chalin 03 Company Limited in resolving any default, subject to the approved agreement terms and applicable law.`,
    { size: 9, lineGap: 4 }
  );
  signaturePanel(doc, document, [
    ["guarantor", "Guarantor"],
    ["buyer", "Buyer / Customer"],
    ["seller", "Authorised Company Representative"],
  ]);
}

function renderDelivery(doc, document) {
  const agreement = agreementOf(document);
  const delivery = document.snapshot?.document_context?.delivery || {};
  sectionTitle(doc, document, "Controlled Handover Details", { fill: COLORS.goldSoft });
  factGrid(doc, document, [
    ["CUSTOMER", customerName(document)],
    ["AGREEMENT", agreement.agreement_number],
    ["MACHINE", machineName(document)],
    ["SERIAL NUMBER", agreement.serial_number],
    ["RECEIVING PERSON", delivery.receiving_person],
    ["DESTINATION", delivery.destination],
    ["CONDITION", label(delivery.condition_status)],
    ["METER READING", delivery.meter_reading],
    ["FUEL LEVEL", delivery.fuel_level_percent === undefined ? "Not recorded" : `${delivery.fuel_level_percent}%`],
    ["HANDOVER DATE", dateTimeLabel(delivery.delivered_at)],
  ]);
  sectionTitle(doc, document, "Tools, Attachments & Condition Notes");
  paragraph(doc, document, delivery.attachments_tools || delivery.notes || "To be completed and confirmed at physical handover.", {
    size: 9,
  });
  signaturePanel(doc, document, [
    ["seller", "Company Handover Officer"],
    ["buyer", "Receiving Customer"],
    ["buyer_witness", "Witness"],
  ]);
}

function renderArrears(doc, document) {
  const agreement = agreementOf(document);
  const overdue = document.snapshot?.document_context?.overdue || {};
  sectionTitle(doc, document, "Notice Summary", { fill: "#f9e8e8", color: COLORS.danger });
  factGrid(doc, document, [
    ["CUSTOMER", customerName(document)],
    ["AGREEMENT", agreement.agreement_number],
    ["OVERDUE AMOUNT", money(overdue.amount)],
    ["OVERDUE INSTALLMENTS", overdue.count],
    ["OLDEST UNPAID DATE", dateLabel(overdue.oldest_due_date)],
    ["CURE PERIOD", `${document.snapshot?.policy?.notice_cure_days || 14} day(s)`],
  ]);
  paragraph(
    doc,
    document,
    `This is formal notice that the installment account is overdue. Please contact Chalin 03 Company Limited immediately and settle the overdue amount or agree a controlled resolution within ${document.snapshot?.policy?.notice_cure_days || 14} day(s). This notice does not waive any right preserved by the signed agreement.`,
    { size: 9, lineGap: 4 }
  );
  sectionTitle(doc, document, "Overdue Schedule Lines", { color: COLORS.danger });
  scheduleTable(doc, document, overdue.rows || []);
}

function renderAmendment(doc, document) {
  const amendment = document.snapshot?.document_context?.amendment || {};
  sectionTitle(doc, document, "Approved Change Record", { fill: COLORS.goldSoft });
  factGrid(doc, document, [
    ["AMENDMENT NUMBER", amendment.amendment_number],
    ["STATUS", label(amendment.amendment_status)],
    ["AMENDMENT TYPE", label(amendment.amendment_type)],
    ["EFFECTIVE DATE", dateLabel(amendment.effective_date)],
    ["REQUESTED BY", amendment.requested_by_name || amendment.requested_by],
    ["APPROVED BY", amendment.approved_by_name || amendment.approved_by],
  ]);
  sectionTitle(doc, document, "Reason for Change");
  paragraph(doc, document, amendment.reason, { size: 9 });
  sectionTitle(doc, document, "Approved Changes");
  const changes = amendment.proposed_changes || {};
  const entries = Object.entries(changes);
  table(
    doc,
    document,
    [
      { title: "FIELD / TERM", units: 1.2 },
      { title: "APPROVED VALUE", units: 2.2 },
    ],
    entries.map(([key, value]) => [label(key), typeof value === "object" ? JSON.stringify(value) : String(value)]),
    { emptyText: "No structured change values were recorded." }
  );
  signaturePanel(doc, document, [
    ["seller", "Authorised Seller Representative"],
    ["buyer", "Buyer / Customer"],
    ["buyer_witness", "Witness"],
  ]);
}

function renderCertificate(doc, document) {
  const agreement = agreementOf(document);
  const context = document.snapshot?.document_context || {};
  const isTransfer = document.document_type === "ownership_transfer";
  const left = doc.page.margins.left;
  const width = contentWidth(doc);

  doc.fillColor(COLORS.greenDark).font("Times-Bold").fontSize(25).text(templateFor(document).title, {
    align: "center",
  });
  doc.fillColor(COLORS.goldDark).font("Helvetica-Bold").fontSize(9).text(templateFor(document).subtitle, {
    align: "center",
    characterSpacing: 0.8,
  });
  doc.moveDown(1.2);
  doc.fillColor(COLORS.ink).font("Times-Roman").fontSize(12).text(
    isTransfer ? "This certifies the controlled transfer of the equipment identified below to" : "This certifies that the installment account of",
    { align: "center" }
  );
  doc.moveDown(0.45);
  doc.fillColor(COLORS.greenDark).font("Times-Bold").fontSize(22).text(customerName(document), {
    align: "center",
  });
  doc.moveDown(0.6);
  doc.save().roundedRect(left + 35, doc.y, width - 70, 90, 10).fill(COLORS.goldSoft).restore();
  const boxY = doc.y;
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7).text("EQUIPMENT", left + 50, boxY + 16, {
    width: width - 100,
    align: "center",
  });
  doc.fillColor(COLORS.greenDark).font("Helvetica-Bold").fontSize(13).text(machineName(document), left + 50, boxY + 30, {
    width: width - 100,
    align: "center",
  });
  doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8).text(
    `Agreement ${clean(agreement.agreement_number)}  •  Serial ${clean(agreement.serial_number || agreement.chassis_number)}`,
    left + 50,
    boxY + 58,
    { width: width - 100, align: "center" }
  );
  doc.y = boxY + 113;

  if (isTransfer) {
    const transfer = context.ownership_transfer || {};
    paragraph(
      doc,
      document,
      `Chalin 03 Company Limited confirms that the reconciled installment balance is fully settled and the controlled ownership-transfer record authorises transfer of the machine to ${customerName(document)}. Transfer number: ${clean(transfer.transfer_number || transfer.ownership_number)}. Transfer date: ${dateTimeLabel(transfer.transferred_at)}.`,
      { size: 10.5, align: "center", lineGap: 4 }
    );
  } else {
    paragraph(
      doc,
      document,
      `The installment obligation has been fully settled according to the reconciled Chalin 03 Finance ledger. Final payment date: ${dateLabel(document.snapshot?.payments?.at(-1)?.payment_date)}. Confirmation date: ${dateLabel(document.snapshot?.generated_at)}.`,
      { size: 10.5, align: "center", lineGap: 4 }
    );
  }

  doc.moveDown(1.2);
  signaturePanel(doc, document, isTransfer
    ? [
        ["seller", "Authorised Company Representative"],
        ["buyer", "New Owner"],
        ["buyer_witness", "Witness"],
      ]
    : [
        ["seller", "Authorised Company Representative"],
        ["buyer", "Customer"],
      ]);
}

function renderDocumentBody(doc, document, compact = false) {
  if (compact) return renderReceipt(doc, document, true);
  switch (document.document_type) {
    case "installment_agreement":
    case "customer_agreement_copy":
    case "company_agreement_copy":
      return renderLegalAgreement(doc, document);
    case "boss_approval_pack":
      return renderExecutivePack(doc, document);
    case "payment_receipt":
      return renderReceipt(doc, document, false);
    case "payment_schedule":
      return renderSchedule(doc, document);
    case "customer_statement":
      return renderStatement(doc, document);
    case "machine_annexure":
      return renderMachineAnnexure(doc, document);
    case "guarantor_undertaking":
      return renderGuarantor(doc, document);
    case "delivery_handover_note":
      return renderDelivery(doc, document);
    case "arrears_notice":
      return renderArrears(doc, document);
    case "amendment_agreement":
      return renderAmendment(doc, document);
    case "settlement_confirmation":
    case "ownership_transfer":
      return renderCertificate(doc, document);
    default:
      return renderLegalAgreement(doc, document);
  }
}

function verificationPayload(document) {
  return [
    "CHALIN03",
    `DOC:${document.document_number}`,
    `TYPE:${document.document_type}`,
    `AGR:${agreementOf(document).agreement_number || "NA"}`,
    `ISSUED:${document.issued_at || document.snapshot?.generated_at || "NA"}`,
    `SHA256:${document.snapshot_checksum || "NA"}`,
  ].join("|");
}

async function verificationQr(document) {
  return QRCode.toBuffer(verificationPayload(document), {
    type: "png",
    width: 220,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: COLORS.greenDark, light: "#ffffff" },
  });
}

function drawFooter(doc, document, qrBuffer, compact = false) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const left = doc.page.margins.left;
    const width = contentWidth(doc);
    const y = doc.page.height - doc.page.margins.bottom + (compact ? 1 : 3);
    const qrSize = compact ? 20 : 30;
    if (qrBuffer) doc.image(qrBuffer, left, y - 4, { fit: [qrSize, qrSize] });
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(compact ? 4.2 : 5.7).text(
      `CHALIN 03 COMPANY LIMITED | ${document.document_number} | Snapshot ${String(document.snapshot_checksum || "").slice(0, 18)} | Page ${index + 1} of ${range.count}`,
      left + qrSize + 7,
      y,
      { width: width - qrSize - 7, align: "center", lineBreak: false }
    );
    if (!compact) {
      doc.fillColor(COLORS.goldDark).font("Helvetica-Bold").fontSize(4.8).text(
        "SYSTEM-GENERATED • TAMPER-EVIDENT • SCAN QR TO VERIFY DOCUMENT IDENTITY",
        left + qrSize + 7,
        y + 10,
        { width: width - qrSize - 7, align: "center", lineBreak: false }
      );
    }
  }
}

function appendCustomerIdentityPage(doc, document, photo) {
  if (!photo || !PHOTO_DOCUMENT_TYPES.has(document.document_type)) return;
  addPage(doc, document);
  const agreement = agreementOf(document);
  sectionTitle(doc, document, "Protected Customer Identity Evidence", { fill: COLORS.goldSoft });
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const y = doc.y;
  const photoWidth = Math.min(205, width * 0.38);
  const photoHeight = 250;
  doc.save().roundedRect(left, y, photoWidth, photoHeight, 9).fillAndStroke(COLORS.ash, COLORS.line).restore();
  doc.image(photo.buffer, left + 8, y + 8, {
    fit: [photoWidth - 16, photoHeight - 16],
    align: "center",
    valign: "center",
  });
  const factsX = left + photoWidth + 22;
  const factsWidth = width - photoWidth - 22;
  const items = [
    ["CUSTOMER / BUYER", customerName(document)],
    ["PHONE", agreement.kyc_customer_phone || agreement.customer_phone_snapshot],
    ["OFFICIAL ID", `${clean(agreement.id_type, "ID")} — ${clean(agreement.id_number)}`],
    ["ADDRESS", agreement.residential_address || agreement.customer_address_snapshot],
    ["INSTALLMENT ACCOUNT", agreement.agreement_number],
    ["OFFICIAL BALANCE", money(agreement.outstanding_balance)],
  ];
  items.forEach(([title, value], index) => {
    const itemY = y + index * 40;
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(6).text(title, factsX, itemY + 2, {
      width: factsWidth,
    });
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(8).text(clean(value), factsX, itemY + 14, {
      width: factsWidth,
    });
  });
  doc.y = y + photoHeight + 22;
  paragraph(
    doc,
    document,
    `This full-frame customer photograph is stored in the encrypted Equipment Installment Finance document vault. Evidence reference ${clean(photo.documentNumber)}; checksum ${clean(photo.checksum, "").slice(0, 32)}. It supports customer identification and does not replace official KYC identification evidence.`,
    { size: 8, color: COLORS.muted }
  );
}

async function renderCompletionPdf(document, { layout = "a4" } = {}) {
  const compact = layout === "thermal" && document.document_type === "payment_receipt";
  const [qrBuffer, photo] = await Promise.all([
    verificationQr(document),
    compact ? Promise.resolve(null) : latestCustomerPhoto(document),
  ]);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: compact ? [226.77, 680] : "A4",
      margins: compact
        ? { top: 13, bottom: 27, left: 12, right: 12 }
        : { top: 36, bottom: 52, left: 43, right: 43 },
      bufferPages: true,
      info: {
        Title: templateFor(document).title,
        Author: clean(document.snapshot?.company?.name, "Chalin 03 Company Limited"),
        Subject: `${document.document_number} — ${templateFor(document).subtitle}`,
        Keywords: "Chalin 03, Equipment Installment Finance, Official Document, Tamper Evident",
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      drawHeader(doc, document, compact);
      renderDocumentBody(doc, document, compact);
      if (!compact) appendCustomerIdentityPage(doc, document, photo);
      drawFooter(doc, document, qrBuffer, compact);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function htmlTable(headers, rows) {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function wordBody(document) {
  const agreement = agreementOf(document);
  const context = document.snapshot?.document_context || {};
  const summary = `
    <section class="summary-grid">
      ${agreementSummaryItems(document)
        .map(([title, value]) => `<div class="fact"><small>${escapeHtml(title)}</small><strong>${escapeHtml(value)}</strong></div>`)
        .join("")}
    </section>`;
  const schedule = htmlTable(
    ["No.", "Due date", "Scheduled", "Paid", "Balance", "Status"],
    (document.snapshot?.schedule || []).map((row) => [
      row.sequence_number,
      dateLabel(row.due_date),
      money(row.scheduled_amount),
      money(row.amount_paid),
      money(row.balance),
      label(row.schedule_status),
    ])
  );
  const payments = htmlTable(
    ["Receipt", "Date", "Method", "Amount"],
    (document.snapshot?.payments || []).map((row) => [
      row.receipt_number || row.payment_number,
      dateLabel(row.payment_date),
      label(row.payment_method),
      money(row.amount),
    ])
  );

  switch (document.document_type) {
    case "payment_receipt": {
      const payment = context.payment || {};
      return `<section class="amount"><small>AMOUNT RECEIVED</small><strong>${escapeHtml(money(payment.amount))}</strong></section>
        <h2>Payment confirmation</h2>${summary}<h2>Allocation</h2>${htmlTable(
          ["Installment", "Due date", "Allocated"],
          (context.payment_allocations || []).map((row) => [row.sequence_number, dateLabel(row.due_date), money(row.allocated_amount)])
        )}`;
    }
    case "payment_schedule":
      return `${summary}<h2>Exact dated installment plan</h2>${schedule}`;
    case "customer_statement":
      return `${summary}<h2>Payment history</h2>${payments}<h2>Remaining schedule</h2>${schedule}`;
    case "machine_annexure":
      return `${summary}<h2>Machine identity</h2><p>${escapeHtml(machineName(document))}</p><p>Serial: ${escapeHtml(agreement.serial_number)} | Chassis: ${escapeHtml(agreement.chassis_number)} | Engine: ${escapeHtml(agreement.engine_number)}</p>`;
    case "guarantor_undertaking":
      return `${summary}<h2>Formal undertaking</h2><p>I, ${escapeHtml(agreement.guarantor_name)}, undertake to support the buyer's performance under the approved agreement.</p>`;
    case "arrears_notice":
      return `${summary}<h2>Action required</h2><p>Overdue amount: <strong>${escapeHtml(money(context.overdue?.amount))}</strong>. Cure period: ${escapeHtml(document.snapshot?.policy?.notice_cure_days || 14)} day(s).</p>${schedule}`;
    case "amendment_agreement":
      return `${summary}<h2>Approved amendment</h2><p>${escapeHtml(context.amendment?.amendment_number)} — ${escapeHtml(context.amendment?.reason)}</p><pre>${escapeHtml(JSON.stringify(context.amendment?.proposed_changes || {}, null, 2))}</pre>`;
    case "settlement_confirmation":
      return `<section class="certificate"><h2>FULLY SETTLED</h2><p>This certifies that ${escapeHtml(customerName(document))} has fully settled the installment obligation for ${escapeHtml(machineName(document))}.</p></section>`;
    case "ownership_transfer":
      return `<section class="certificate"><h2>OWNERSHIP TRANSFER</h2><p>Ownership of ${escapeHtml(machineName(document))} is authorised for transfer to ${escapeHtml(customerName(document))}.</p></section>`;
    default:
      return `${summary}<h2>Official installment schedule</h2>${schedule}<h2>Terms and conditions</h2><p>${escapeHtml(document.snapshot?.policy?.agreement_terms || "")}</p>`;
  }
}

async function renderCompletionWord(document) {
  const template = templateFor(document);
  const qr = await QRCode.toDataURL(verificationPayload(document), {
    width: 180,
    margin: 1,
    errorCorrectionLevel: "M",
  });
  const photo = await latestCustomerPhoto(document);
  const photoSection = photo && PHOTO_DOCUMENT_TYPES.has(document.document_type)
    ? `<section class="identity page-break"><h2>Protected Customer Identity Evidence</h2><div class="identity-grid"><img src="${photo.dataUrl}" alt="Customer photo"><div><p><b>Customer</b><br>${escapeHtml(customerName(document))}</p><p><b>Agreement</b><br>${escapeHtml(agreementOf(document).agreement_number)}</p><p><b>Evidence</b><br>${escapeHtml(photo.documentNumber)}</p></div></div></section>`
    : "";
  const company = document.snapshot?.company || {};
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(document.document_number)}</title><style>
    @page{size:A4;margin:16mm}body{font-family:Arial,sans-serif;color:${COLORS.ink};font-size:10pt;line-height:1.5;position:relative}body:before{content:"${escapeHtml(template.watermark)}";position:fixed;top:43%;left:7%;font-size:42pt;font-weight:bold;color:rgba(13,79,54,.055);transform:rotate(-34deg);z-index:-1;white-space:nowrap}.topbar{height:10px;background:${COLORS.greenDark};margin:-16mm -16mm 12mm}.header{display:flex;align-items:center;border-bottom:4px solid ${COLORS.gold};padding-bottom:12px}.logo{width:58px;height:58px;border-radius:50%;background:${COLORS.gold};color:${COLORS.greenDark};display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:18px;border:3px solid ${COLORS.greenDark};margin-right:14px}.company h1{margin:0;color:${COLORS.greenDark};font-size:20px}.company p{margin:4px 0 0;color:${COLORS.muted};font-size:8pt}.title{text-align:center;margin:24px 0}.title h2{font-size:22px;color:${COLORS.greenDark};margin:0}.badge{display:inline-block;background:${COLORS.greenDark};color:white;padding:5px 16px;border-radius:14px;font-size:8pt;font-weight:bold;margin-top:8px}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;background:${COLORS.ash};padding:10px;border-radius:7px}.meta small,.fact small{display:block;color:${COLORS.muted};font-size:7pt}.meta strong,.fact strong{display:block;color:${COLORS.ink};font-size:9pt}.summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0}.fact{border:1px solid ${COLORS.line};background:${COLORS.ash};padding:10px;border-radius:6px}h2{color:${COLORS.greenDark};border-left:5px solid ${COLORS.gold};padding-left:10px;margin-top:22px}table{width:100%;border-collapse:collapse;margin:12px 0;font-size:8pt}th{background:${COLORS.greenDark};color:white;padding:7px;text-align:left}td{border-bottom:1px solid ${COLORS.line};padding:7px}tr:nth-child(even){background:${COLORS.ash}}.amount{background:${COLORS.greenDark};color:white;padding:24px;text-align:center;border-radius:10px;margin:18px 0}.amount small{display:block;color:#dbe8df}.amount strong{font-size:25pt}.certificate{text-align:center;border:3px double ${COLORS.gold};padding:34px;margin-top:30px;background:${COLORS.goldSoft}}.certificate h2{border:0;font-size:28px}.verify{display:flex;gap:12px;align-items:center;border-top:2px solid ${COLORS.gold};margin-top:26px;padding-top:10px;font-size:7pt;color:${COLORS.muted}}.verify img{width:55px;height:55px}.identity-grid{display:grid;grid-template-columns:220px 1fr;gap:20px}.identity-grid img{max-width:220px;max-height:280px;border:1px solid ${COLORS.line};padding:5px}.page-break{page-break-before:always}</style></head><body>
    <div class="topbar"></div><header class="header"><div class="logo">C03</div><div class="company"><h1>${escapeHtml(company.name || "CHALIN 03 COMPANY LIMITED")}</h1><p>${escapeHtml([company.phone,company.email,company.postal_address || company.address].filter(Boolean).join(" • "))}</p></div></header>
    <section class="title"><h2>${escapeHtml(template.title)}</h2><p>${escapeHtml(template.subtitle)}</p><span class="badge">${escapeHtml(template.badge)}</span></section>
    <section class="meta"><div><small>DOCUMENT NO.</small><strong>${escapeHtml(document.document_number)}</strong></div><div><small>AGREEMENT</small><strong>${escapeHtml(agreementOf(document).agreement_number)}</strong></div><div><small>ISSUED</small><strong>${escapeHtml(dateTimeLabel(document.issued_at || document.snapshot?.generated_at))}</strong></div></section>
    ${wordBody(document)}${photoSection}<footer class="verify"><img src="${qr}" alt="Verification QR"><div><b>SYSTEM-GENERATED • TAMPER-EVIDENT</b><br>Snapshot ${escapeHtml(document.snapshot_checksum)}<br>Verify using the document number, agreement number and checksum.</div></footer>
  </body></html>`;
  return Buffer.from(html, "utf8");
}

module.exports = {
  TEMPLATES,
  renderCompletionPdf,
  renderCompletionWord,
  templateFor,
  verificationPayload,
};
