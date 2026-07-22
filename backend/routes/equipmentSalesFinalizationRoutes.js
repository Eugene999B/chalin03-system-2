const express = require("express");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  runEquipmentSalesReminderSync,
} = require("../services/equipmentSalesReminderService");
const { writeAuditEvent } = require("../services/auditTrailService");

const router = express.Router();
const COMPANY_NAME = "CHALIN 03 COMPANY LIMITED";
const COMPANY_ADDRESS = "Dunkwa Police Barrier";
const COMPANY_PHONE = "0249469080 / 0249995510";
const LOGO_PATH = path.resolve(__dirname, "../../frontend/public/chalin03-logo.png");
const DOCUMENT_TYPES = new Set([
  "agreement",
  "statement",
  "delivery",
  "ownership",
  "overdue",
]);

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function safeText(value, fallback = "-") {
  const text = cleanText(value, 5000);
  return text || fallback;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateOnly(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safeText(value);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function dateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safeText(value);
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizedDateInput(value, fallback) {
  const text = cleanText(value, 20);
  if (!text) return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function filenamePart(value, fallback = "document") {
  const cleaned = cleanText(value, 120)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || fallback;
}

function locationCondition(alias, scope) {
  const locationId = Number(scope?.locationId || 0);
  if (!Number.isInteger(locationId) || locationId <= 0) {
    return { sql: "1 = 1", params: [] };
  }
  return { sql: `${alias}.hire_location_id = ?`, params: [locationId] };
}

function dataUrlBuffer(value) {
  const match = String(value || "").match(
    /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/i
  );
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[1], "base64");
    return buffer.length ? buffer : null;
  } catch {
    return null;
  }
}

function ensurePageSpace(doc, required = 80) {
  if (doc.y + required <= doc.page.height - 55) return;
  doc.addPage();
  doc.y = 52;
}

function drawLogo(doc) {
  if (!fs.existsSync(LOGO_PATH)) return;
  try {
    doc.image(LOGO_PATH, 46, 34, { fit: [52, 52], align: "center" });
  } catch {
    // A missing or unreadable optional logo must not prevent document delivery.
  }
}

function documentHeader(doc, title, reference, locationName) {
  drawLogo(doc);
  doc
    .font("Helvetica-Bold")
    .fontSize(16)
    .text(COMPANY_NAME, 110, 36, { width: 430, align: "right" });
  doc
    .font("Helvetica")
    .fontSize(9)
    .text(COMPANY_ADDRESS, 110, 58, { width: 430, align: "right" })
    .text(`Tel: ${COMPANY_PHONE}`, 110, 71, { width: 430, align: "right" })
    .text(`Equipment Sales & Hire • ${safeText(locationName)}`, 110, 84, {
      width: 430,
      align: "right",
    });

  doc.moveTo(45, 105).lineTo(550, 105).lineWidth(1.2).stroke();
  doc
    .font("Helvetica-Bold")
    .fontSize(19)
    .text(title.toUpperCase(), 45, 119, { width: 505, align: "center" });
  doc
    .font("Helvetica")
    .fontSize(9)
    .text(`Reference: ${safeText(reference)}`, 45, 147, {
      width: 505,
      align: "center",
    });
  doc.y = 178;
}

function sectionTitle(doc, title) {
  ensurePageSpace(doc, 45);
  const y = doc.y;
  doc.roundedRect(45, y, 505, 24, 4).fill("#e9eef8");
  doc
    .fillColor("#16233f")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(title.toUpperCase(), 55, y + 7, { width: 485 });
  doc.fillColor("#111111");
  doc.y = y + 34;
}

function detailRows(doc, rows, options = {}) {
  const labelWidth = options.labelWidth || 165;
  const valueWidth = 505 - labelWidth;

  for (const [label, value] of rows) {
    ensurePageSpace(doc, 28);
    const startY = doc.y;
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(`${label}:`, 50, startY, { width: labelWidth - 10 });
    doc
      .font("Helvetica")
      .fontSize(9)
      .text(safeText(value), 50 + labelWidth, startY, { width: valueWidth - 5 });
    const rowHeight = Math.max(
      doc.heightOfString(`${label}:`, { width: labelWidth - 10 }),
      doc.heightOfString(safeText(value), { width: valueWidth - 5 })
    );
    doc.y = startY + Math.max(rowHeight, 12) + 7;
    doc.moveTo(50, doc.y - 2).lineTo(545, doc.y - 2).lineWidth(0.25).stroke("#d9dde7");
  }
}

function equipmentPicture(doc, imageValue) {
  const buffer = dataUrlBuffer(imageValue);
  if (!buffer) return;
  ensurePageSpace(doc, 175);
  try {
    const y = doc.y;
    doc.roundedRect(175, y, 250, 150, 8).stroke("#c9cfda");
    doc.image(buffer, 180, y + 5, { fit: [240, 140], align: "center", valign: "center" });
    doc.y = y + 165;
  } catch {
    // The document remains useful when a stored image cannot be decoded by PDFKit.
  }
}

function table(doc, columns, rows) {
  const left = 45;
  const width = 505;
  const headerHeight = 23;
  const rowPadding = 5;
  const totalUnits = columns.reduce((sum, column) => sum + column.units, 0);
  const widths = columns.map((column) => (column.units / totalUnits) * width);

  function drawHeader() {
    ensurePageSpace(doc, 60);
    const y = doc.y;
    doc.rect(left, y, width, headerHeight).fill("#16233f");
    let x = left;
    columns.forEach((column, index) => {
      doc
        .fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(column.label, x + 4, y + 7, {
          width: widths[index] - 8,
          align: column.align || "left",
        });
      x += widths[index];
    });
    doc.fillColor("#111111");
    doc.y = y + headerHeight;
  }

  drawHeader();

  for (const row of rows) {
    const values = columns.map((column) => safeText(row[column.key], ""));
    const heights = values.map((value, index) =>
      doc.heightOfString(value, { width: widths[index] - 8 })
    );
    const rowHeight = Math.max(20, ...heights) + rowPadding * 2;

    if (doc.y + rowHeight > doc.page.height - 55) {
      doc.addPage();
      doc.y = 52;
      drawHeader();
    }

    const y = doc.y;
    doc.rect(left, y, width, rowHeight).stroke("#d8dde7");
    let x = left;
    columns.forEach((column, index) => {
      if (index > 0) {
        doc.moveTo(x, y).lineTo(x, y + rowHeight).stroke("#d8dde7");
      }
      doc
        .font("Helvetica")
        .fontSize(8)
        .text(values[index], x + 4, y + rowPadding, {
          width: widths[index] - 8,
          align: column.align || "left",
        });
      x += widths[index];
    });
    doc.y = y + rowHeight;
  }
  doc.y += 12;
}

function signatureArea(doc, labels = ["Customer", "Authorized Officer"]) {
  ensurePageSpace(doc, 100);
  const y = doc.y + 25;
  const gap = 35;
  const boxWidth = (505 - gap) / 2;
  labels.forEach((label, index) => {
    const x = 45 + index * (boxWidth + gap);
    doc.moveTo(x, y + 34).lineTo(x + boxWidth, y + 34).stroke("#111111");
    doc
      .font("Helvetica")
      .fontSize(8)
      .text(`${label} signature / name / date`, x, y + 40, {
        width: boxWidth,
        align: "center",
      });
  });
  doc.y = y + 70;
}

function footer(doc) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#667085")
      .text(
        `Generated securely by Chalin 03 • ${new Date().toLocaleString("en-GB")} • Page ${
          index + 1
        } of ${range.count}`,
        45,
        doc.page.height - 35,
        { width: 505, align: "center" }
      );
  }
  doc.fillColor("#111111");
}

function createPdfResponse(res, filename) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${filenamePart(filename)}.pdf"`
  );
  res.setHeader("Cache-Control", "private, no-store");

  const doc = new PDFDocument({
    size: "A4",
    margin: 45,
    bufferPages: true,
    info: {
      Title: filename,
      Author: COMPANY_NAME,
      Subject: "Equipment Sales & Hire document",
    },
  });
  doc.pipe(res);
  return doc;
}

async function loadAgreementBundle(connection, agreementId, scope) {
  const condition = locationCondition("esa", scope);
  const [rows] = await connection.query(
    `SELECT
       esa.*,
       hc.customer_name,
       hc.phone AS customer_phone,
       hc.email AS customer_email,
       hc.address AS customer_address,
       fa.asset_code,
       fa.asset_name,
       fa.asset_type,
       fa.make,
       fa.model,
       fa.model_year,
       fa.serial_number,
       fa.chassis_number,
       fa.engine_number,
       fa.registration_number,
       fa.condition_status AS current_condition_status,
       fa.current_meter,
       fa.acquisition_cost,
       fa.main_image_url,
       bl.name AS hire_location_name,
       q.quotation_number,
       q.quotation_date,
       q.validity_date,
       q.terms AS quotation_terms,
       creator.full_name AS created_by_name,
       approver.full_name AS approved_by_name
     FROM equipment_sale_agreements esa
     INNER JOIN hire_customers hc ON hc.id = esa.customer_id
     INNER JOIN fleet_assets fa ON fa.id = esa.asset_id
     INNER JOIN business_locations bl ON bl.id = esa.hire_location_id
     LEFT JOIN equipment_sales_quotations q ON q.id = esa.quotation_id
     LEFT JOIN users creator ON creator.id = esa.created_by
     LEFT JOIN users approver ON approver.id = esa.approved_by
     WHERE esa.id = ? AND ${condition.sql}
     LIMIT 1`,
    [agreementId, ...condition.params]
  );

  const agreement = rows[0];
  if (!agreement) return null;

  const [[schedule], [payments], [deliveries], [transfers]] = await Promise.all([
    connection.query(
      `SELECT * FROM equipment_installment_schedule
       WHERE agreement_id = ? ORDER BY sequence_number`,
      [agreementId]
    ),
    connection.query(
      `SELECT esp.*, u.full_name AS received_by_name
       FROM equipment_sale_payments esp
       LEFT JOIN users u ON u.id = esp.received_by
       WHERE esp.agreement_id = ?
       ORDER BY esp.payment_date, esp.id`,
      [agreementId]
    ),
    connection.query(
      `SELECT * FROM equipment_deliveries
       WHERE agreement_id = ? ORDER BY id DESC`,
      [agreementId]
    ),
    connection.query(
      `SELECT * FROM equipment_ownership_transfers
       WHERE agreement_id = ? ORDER BY id DESC`,
      [agreementId]
    ),
  ]);

  return {
    agreement,
    schedule,
    payments,
    delivery: deliveries[0] || null,
    ownership: transfers[0] || null,
  };
}

async function loadQuotationBundle(connection, quotationId, scope) {
  const condition = locationCondition("q", scope);
  const [rows] = await connection.query(
    `SELECT
       q.*,
       hc.customer_name,
       hc.phone AS customer_phone,
       hc.email AS customer_email,
       hc.address AS customer_address,
       qi.asset_id,
       qi.asset_code_snapshot,
       qi.asset_name_snapshot,
       qi.asset_type_snapshot,
       qi.make_snapshot,
       qi.model_snapshot,
       qi.model_year_snapshot,
       qi.serial_number_snapshot,
       qi.main_image_url_snapshot,
       qi.description AS item_description,
       qi.unit_price,
       qi.discount_amount AS item_discount_amount,
       qi.tax_amount AS item_tax_amount,
       qi.line_total,
       bl.name AS hire_location_name,
       creator.full_name AS created_by_name,
       approver.full_name AS approved_by_name
     FROM equipment_sales_quotations q
     INNER JOIN hire_customers hc ON hc.id = q.customer_id
     INNER JOIN equipment_sales_quotation_items qi ON qi.quotation_id = q.id
     INNER JOIN business_locations bl ON bl.id = q.hire_location_id
     LEFT JOIN users creator ON creator.id = q.created_by
     LEFT JOIN users approver ON approver.id = q.approved_by
     WHERE q.id = ? AND ${condition.sql}
     LIMIT 1`,
    [quotationId, ...condition.params]
  );
  return rows[0] || null;
}

async function loadPaymentBundle(connection, paymentId, scope) {
  const condition = locationCondition("esp", scope);
  const [rows] = await connection.query(
    `SELECT
       esp.*,
       esa.agreement_number,
       esa.total_amount,
       esa.amount_paid AS agreement_amount_paid,
       esa.outstanding_balance,
       esa.asset_code_snapshot,
       esa.asset_name_snapshot,
       esa.customer_name_snapshot,
       esa.customer_phone_snapshot,
       bl.name AS hire_location_name,
       u.full_name AS received_by_name
     FROM equipment_sale_payments esp
     INNER JOIN equipment_sale_agreements esa ON esa.id = esp.agreement_id
     INNER JOIN business_locations bl ON bl.id = esp.hire_location_id
     LEFT JOIN users u ON u.id = esp.received_by
     WHERE esp.id = ? AND ${condition.sql}
     LIMIT 1`,
    [paymentId, ...condition.params]
  );
  return rows[0] || null;
}

async function auditDownload(req, action, entityType, entityId, details) {
  try {
    await writeAuditEvent({
      req,
      userId: req.user?.id || null,
      branchId: req.user?.branch_id || req.user?.default_branch_id || 1,
      workspaceCode: "equipment_hire",
      hireLocationId: req.hireLocationScope?.locationId || null,
      action,
      actionType: action,
      entityType,
      entityId,
      outcome: "success",
      severity: "info",
      details,
    });
  } catch (error) {
    console.warn("Equipment Sales document audit skipped:", error.message);
  }
}

function renderQuotation(doc, quotation) {
  documentHeader(
    doc,
    "Equipment Sales Quotation",
    quotation.quotation_number,
    quotation.hire_location_name
  );
  sectionTitle(doc, "Customer");
  detailRows(doc, [
    ["Customer", quotation.customer_name],
    ["Phone", quotation.customer_phone],
    ["Email", quotation.customer_email],
    ["Address", quotation.customer_address],
    ["Quotation date", dateOnly(quotation.quotation_date)],
    ["Valid until", dateOnly(quotation.validity_date)],
    ["Status", quotation.status],
  ]);
  sectionTitle(doc, "Specific Equipment");
  equipmentPicture(doc, quotation.main_image_url_snapshot);
  detailRows(doc, [
    ["Equipment", `${quotation.asset_code_snapshot} - ${quotation.asset_name_snapshot}`],
    ["Type", quotation.asset_type_snapshot],
    ["Make / model", `${safeText(quotation.make_snapshot, "")} ${safeText(quotation.model_snapshot, "")}`],
    ["Model year", quotation.model_year_snapshot],
    ["Serial number", quotation.serial_number_snapshot],
    ["Description", quotation.item_description],
  ]);
  sectionTitle(doc, "Commercial Offer");
  detailRows(doc, [
    ["Equipment price", money(quotation.subtotal)],
    ["Discount", money(quotation.discount_amount)],
    ["Tax", money(quotation.tax_amount)],
    ["Total quotation", money(quotation.total_amount)],
    ["Required deposit", money(quotation.deposit_required)],
    ["Proposed frequency", quotation.proposed_frequency],
    ["Proposed payments", quotation.proposed_installment_count],
    ["First due date", dateOnly(quotation.proposed_first_due_date)],
    ["Delivery policy", quotation.delivery_policy],
    ["Prepared by", quotation.created_by_name],
    ["Approved by", quotation.approved_by_name],
  ]);
  sectionTitle(doc, "Terms");
  doc.font("Helvetica").fontSize(9).text(safeText(quotation.terms, "Standard company sales terms apply."), {
    width: 505,
    align: "justify",
  });
  doc.moveDown(1.5);
  signatureArea(doc, ["Customer acceptance", "Authorized officer"]);
}

function renderAgreement(doc, bundle) {
  const a = bundle.agreement;
  documentHeader(
    doc,
    a.sale_type === "installment"
      ? "Equipment Installment Agreement"
      : "Equipment Cash Sale Agreement",
    a.agreement_number,
    a.hire_location_name
  );
  sectionTitle(doc, "Customer and Equipment");
  equipmentPicture(doc, a.main_image_url_snapshot || a.main_image_url);
  detailRows(doc, [
    ["Customer", a.customer_name_snapshot || a.customer_name],
    ["Phone", a.customer_phone_snapshot || a.customer_phone],
    ["Location", a.customer_location_snapshot || a.customer_address],
    ["Customer ID", [a.customer_id_type, a.customer_id_number].filter(Boolean).join(" - ")],
    ["Equipment", `${a.asset_code_snapshot} - ${a.asset_name_snapshot}`],
    ["Type", a.asset_type_snapshot],
    ["Make / model", `${safeText(a.make_snapshot, "")} ${safeText(a.model_snapshot, "")}`],
    ["Model year", a.model_year_snapshot],
    ["Serial number", a.serial_number_snapshot],
  ]);
  sectionTitle(doc, "Financial Agreement");
  detailRows(doc, [
    ["Sale type", a.sale_type],
    ["Sale price", money(a.sale_price)],
    ["Discount", money(a.discount_amount)],
    ["Tax", money(a.tax_amount)],
    ["Total amount", money(a.total_amount)],
    ["Deposit required", money(a.deposit_required)],
    ["Deposit received", money(a.deposit_received)],
    ["Financed amount", money(a.financed_amount)],
    ["Amount paid", money(a.amount_paid)],
    ["Outstanding balance", money(a.outstanding_balance)],
    ["Payment frequency", a.payment_frequency],
    ["Installment count", a.installment_count],
    ["First due date", dateOnly(a.first_due_date)],
    ["Final due date", dateOnly(a.final_due_date)],
    ["Grace days", a.grace_days],
    ["Delivery policy", a.delivery_policy],
    ["Agreement status", a.agreement_status],
    ["Approved by", a.approved_by_name],
  ]);

  if (a.sale_type === "installment" && bundle.schedule.length) {
    sectionTitle(doc, "Payment Schedule");
    table(
      doc,
      [
        { key: "sequence", label: "#", units: 0.5, align: "center" },
        { key: "due", label: "Due Date", units: 1.5 },
        { key: "scheduled", label: "Scheduled", units: 1.5, align: "right" },
        { key: "paid", label: "Paid", units: 1.4, align: "right" },
        { key: "status", label: "Status", units: 1.1 },
      ],
      bundle.schedule.map((row) => ({
        sequence: row.sequence_number,
        due: dateOnly(row.due_date),
        scheduled: money(row.scheduled_amount),
        paid: money(row.amount_paid),
        status: row.schedule_status,
      }))
    );
  }

  sectionTitle(doc, "Guarantor and Terms");
  detailRows(doc, [
    ["Guarantor", a.guarantor_name],
    ["Guarantor phone", a.guarantor_phone],
    ["Guarantor location", a.guarantor_location],
    ["Guarantor ID", [a.guarantor_id_type, a.guarantor_id_number].filter(Boolean).join(" - ")],
    ["Terms accepted", Number(a.terms_accepted || 0) ? "Yes" : "No"],
    ["Notes", a.agreement_notes],
  ]);
  signatureArea(doc, ["Customer", "Guarantor / witness"]);
  signatureArea(doc, ["Sales officer", "Manager / authorized officer"]);
}

function renderStatement(doc, bundle) {
  const a = bundle.agreement;
  documentHeader(doc, "Equipment Sale Customer Statement", a.agreement_number, a.hire_location_name);
  sectionTitle(doc, "Account Summary");
  detailRows(doc, [
    ["Customer", a.customer_name_snapshot || a.customer_name],
    ["Phone", a.customer_phone_snapshot || a.customer_phone],
    ["Equipment", `${a.asset_code_snapshot} - ${a.asset_name_snapshot}`],
    ["Total agreement", money(a.total_amount)],
    ["Amount paid", money(a.amount_paid)],
    ["Outstanding balance", money(a.outstanding_balance)],
    ["Overdue amount", money(a.overdue_amount)],
    ["Next due date", dateOnly(a.next_due_date)],
    ["Status", a.agreement_status],
  ]);

  sectionTitle(doc, "Payments Received");
  table(
    doc,
    [
      { key: "date", label: "Date", units: 1.3 },
      { key: "receipt", label: "Receipt", units: 1.8 },
      { key: "method", label: "Method", units: 1.1 },
      { key: "category", label: "Category", units: 1.2 },
      { key: "amount", label: "Amount", units: 1.3, align: "right" },
    ],
    bundle.payments.map((row) => ({
      date: dateTime(row.payment_date),
      receipt: row.receipt_number,
      method: row.payment_method,
      category: row.payment_category,
      amount: money(row.amount),
    }))
  );

  if (bundle.schedule.length) {
    sectionTitle(doc, "Installment Schedule");
    table(
      doc,
      [
        { key: "due", label: "Due Date", units: 1.5 },
        { key: "scheduled", label: "Scheduled", units: 1.5, align: "right" },
        { key: "paid", label: "Paid", units: 1.4, align: "right" },
        { key: "charges", label: "Charges", units: 1.2, align: "right" },
        { key: "status", label: "Status", units: 1.1 },
      ],
      bundle.schedule.map((row) => ({
        due: dateOnly(row.due_date),
        scheduled: money(row.scheduled_amount),
        paid: money(row.amount_paid),
        charges: money(Number(row.late_charge_amount || 0) - Number(row.waived_charge_amount || 0)),
        status: row.schedule_status,
      }))
    );
  }
}

function renderDelivery(doc, bundle) {
  const a = bundle.agreement;
  const delivery = bundle.delivery;
  documentHeader(doc, "Equipment Delivery Note", delivery?.delivery_number || a.agreement_number, a.hire_location_name);
  sectionTitle(doc, "Delivery Information");
  equipmentPicture(doc, a.main_image_url_snapshot || a.main_image_url);
  detailRows(doc, [
    ["Agreement", a.agreement_number],
    ["Customer", a.customer_name_snapshot || a.customer_name],
    ["Customer phone", a.customer_phone_snapshot || a.customer_phone],
    ["Equipment", `${a.asset_code_snapshot} - ${a.asset_name_snapshot}`],
    ["Serial number", a.serial_number_snapshot],
    ["Delivery date", dateTime(delivery?.delivery_datetime || a.delivered_at)],
    ["Destination", delivery?.destination],
    ["Meter reading", delivery?.meter_reading],
    ["Fuel level", delivery?.fuel_level_percent === null || delivery?.fuel_level_percent === undefined ? "-" : `${delivery.fuel_level_percent}%`],
    ["Condition", delivery?.condition_status],
    ["Attachments / tools", delivery?.attachments_tools],
    ["Receiving person", delivery?.receiving_person],
    ["Receiving phone", delivery?.receiving_phone],
    ["Notes", delivery?.notes],
  ]);
  signatureArea(doc, ["Receiving customer", "Delivery officer"]);
}

function renderOwnership(doc, bundle) {
  const a = bundle.agreement;
  const ownership = bundle.ownership;
  documentHeader(doc, "Equipment Ownership Transfer Certificate", ownership?.transfer_number || a.agreement_number, a.hire_location_name);
  sectionTitle(doc, "Transfer Certification");
  equipmentPicture(doc, a.main_image_url_snapshot || a.main_image_url);
  detailRows(doc, [
    ["Customer / new owner", a.customer_name_snapshot || a.customer_name],
    ["Phone", a.customer_phone_snapshot || a.customer_phone],
    ["Address", a.customer_location_snapshot || a.customer_address],
    ["Equipment", `${a.asset_code_snapshot} - ${a.asset_name_snapshot}`],
    ["Make / model", `${safeText(a.make_snapshot, "")} ${safeText(a.model_snapshot, "")}`],
    ["Model year", a.model_year_snapshot],
    ["Serial number", a.serial_number_snapshot],
    ["Chassis number", a.chassis_number],
    ["Engine number", a.engine_number],
    ["Registration", a.registration_number],
    ["Agreement", a.agreement_number],
    ["Total paid", money(a.amount_paid)],
    ["Outstanding balance", money(a.outstanding_balance)],
    ["Transfer date", dateOnly(ownership?.transfer_date)],
    ["Registration transfer reference", ownership?.registration_transfer_reference],
    ["Status", ownership?.status || a.ownership_status],
    ["Notes", ownership?.notes],
  ]);
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(
      "Chalin 03 Company Limited certifies that the recorded financial obligation has been settled and ownership of the equipment identified above has been transferred to the customer, subject to applicable registration and statutory requirements.",
      { width: 505, align: "justify" }
    );
  doc.moveDown(1.5);
  signatureArea(doc, ["New owner", "Authorized company officer"]);
}

function renderOverdue(doc, bundle) {
  const a = bundle.agreement;
  documentHeader(doc, "Overdue Equipment Installment Notice", a.agreement_number, a.hire_location_name);
  sectionTitle(doc, "Notice to Customer");
  detailRows(doc, [
    ["Customer", a.customer_name_snapshot || a.customer_name],
    ["Phone", a.customer_phone_snapshot || a.customer_phone],
    ["Address", a.customer_location_snapshot || a.customer_address],
    ["Equipment", `${a.asset_code_snapshot} - ${a.asset_name_snapshot}`],
    ["Agreement", a.agreement_number],
    ["Outstanding balance", money(a.outstanding_balance)],
    ["Overdue amount", money(a.overdue_amount)],
    ["Next due date", dateOnly(a.next_due_date)],
    ["Grace days", a.grace_days],
  ]);
  doc
    .font("Helvetica")
    .fontSize(10)
    .text(
      `Our records show that the above equipment sale account has an overdue amount of ${money(
        a.overdue_amount
      )}. Please contact the Equipment Sales & Hire office immediately to regularize the account. This notice does not waive any agreement term, late charge, delivery restriction or ownership-retention right.`,
      { width: 505, align: "justify" }
    );
  doc.moveDown(1.5);
  if (bundle.schedule.length) {
    sectionTitle(doc, "Current Schedule Status");
    table(
      doc,
      [
        { key: "due", label: "Due", units: 1.4 },
        { key: "amount", label: "Amount", units: 1.4, align: "right" },
        { key: "paid", label: "Paid", units: 1.4, align: "right" },
        { key: "status", label: "Status", units: 1.2 },
      ],
      bundle.schedule
        .filter((row) => !["paid", "cancelled", "waived"].includes(row.schedule_status))
        .map((row) => ({
          due: dateOnly(row.due_date),
          amount: money(row.scheduled_amount),
          paid: money(row.amount_paid),
          status: row.schedule_status,
        }))
    );
  }
  signatureArea(doc, ["Prepared by", "Manager / authorized officer"]);
}

function renderPaymentReceipt(doc, payment) {
  documentHeader(doc, "Equipment Sale Payment Receipt", payment.receipt_number, payment.hire_location_name);
  sectionTitle(doc, "Receipt Details");
  detailRows(doc, [
    ["Customer", payment.customer_name_snapshot],
    ["Customer phone", payment.customer_phone_snapshot],
    ["Agreement", payment.agreement_number],
    ["Equipment", `${payment.asset_code_snapshot} - ${payment.asset_name_snapshot}`],
    ["Payment date", dateTime(payment.payment_date)],
    ["Payment category", payment.payment_category],
    ["Payment method", payment.payment_method],
    ["Reference", payment.reference_number],
    ["Amount received", money(payment.amount)],
    ["Total agreement", money(payment.total_amount)],
    ["Total paid", money(payment.agreement_amount_paid)],
    ["Remaining balance", money(payment.outstanding_balance)],
    ["Received by", payment.received_by_name],
    ["Notes", payment.notes],
  ]);
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("Thank you for your payment.", { width: 505, align: "center" });
  signatureArea(doc, ["Customer", "Receiving officer"]);
}

router.get(
  "/quotations/:id/quotation.pdf",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    const quotationId = positiveId(req.params.id);
    if (!quotationId) {
      return res.status(400).json({ status: "error", message: "Invalid quotation ID." });
    }

    try {
      const quotation = await loadQuotationBundle(pool, quotationId, req.hireLocationScope);
      if (!quotation) {
        return res.status(404).json({ status: "error", message: "Quotation was not found." });
      }

      const doc = createPdfResponse(res, quotation.quotation_number || `quotation-${quotationId}`);
      renderQuotation(doc, quotation);
      footer(doc);
      doc.end();
      await auditDownload(req, "EQUIPMENT_SALES_QUOTATION_PDF", "equipment_sales_quotation", quotationId, `Generated quotation PDF ${quotation.quotation_number}.`);
      return undefined;
    } catch (error) {
      console.error("Equipment quotation PDF error:", error);
      if (!res.headersSent) {
        return res.status(500).json({ status: "error", message: "Could not generate the equipment quotation PDF." });
      }
      return undefined;
    }
  }
);

router.get(
  "/agreements/:id/documents/:type.pdf",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    const agreementId = positiveId(req.params.id);
    const type = cleanText(req.params.type, 30).toLowerCase();
    if (!agreementId || !DOCUMENT_TYPES.has(type)) {
      return res.status(400).json({ status: "error", message: "Invalid agreement document request." });
    }

    try {
      const bundle = await loadAgreementBundle(pool, agreementId, req.hireLocationScope);
      if (!bundle) {
        return res.status(404).json({ status: "error", message: "Agreement was not found." });
      }
      if (type === "delivery" && !bundle.delivery) {
        return res.status(409).json({ status: "error", message: "Delivery has not been recorded for this agreement." });
      }
      if (type === "ownership" && !bundle.ownership) {
        return res.status(409).json({ status: "error", message: "Ownership transfer has not been completed for this agreement." });
      }

      const reference =
        type === "delivery"
          ? bundle.delivery.delivery_number
          : type === "ownership"
            ? bundle.ownership.transfer_number
            : bundle.agreement.agreement_number;
      const doc = createPdfResponse(res, `${reference}-${type}`);

      if (type === "agreement") renderAgreement(doc, bundle);
      else if (type === "statement") renderStatement(doc, bundle);
      else if (type === "delivery") renderDelivery(doc, bundle);
      else if (type === "ownership") renderOwnership(doc, bundle);
      else renderOverdue(doc, bundle);

      footer(doc);
      doc.end();
      await auditDownload(req, `EQUIPMENT_SALES_${type.toUpperCase()}_PDF`, "equipment_sale_agreement", agreementId, `Generated ${type} PDF for ${bundle.agreement.agreement_number}.`);
      return undefined;
    } catch (error) {
      console.error("Equipment agreement PDF error:", error);
      if (!res.headersSent) {
        return res.status(500).json({ status: "error", message: "Could not generate the requested Equipment Sales document." });
      }
      return undefined;
    }
  }
);

router.get(
  "/payments/:id/receipt.pdf",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    const paymentId = positiveId(req.params.id);
    if (!paymentId) {
      return res.status(400).json({ status: "error", message: "Invalid payment ID." });
    }

    try {
      const payment = await loadPaymentBundle(pool, paymentId, req.hireLocationScope);
      if (!payment) {
        return res.status(404).json({ status: "error", message: "Payment receipt was not found." });
      }
      const doc = createPdfResponse(res, payment.receipt_number || `equipment-payment-${paymentId}`);
      renderPaymentReceipt(doc, payment);
      footer(doc);
      doc.end();
      await auditDownload(req, "EQUIPMENT_SALE_PAYMENT_RECEIPT_PDF", "equipment_sale_payment", paymentId, `Generated payment receipt PDF ${payment.receipt_number}.`);
      return undefined;
    } catch (error) {
      console.error("Equipment payment receipt PDF error:", error);
      if (!res.headersSent) {
        return res.status(500).json({ status: "error", message: "Could not generate the equipment payment receipt." });
      }
      return undefined;
    }
  }
);

router.get(
  "/reports/management",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const now = new Date();
      const defaultFrom = `${now.getUTCFullYear()}-01-01`;
      const defaultTo = now.toISOString().slice(0, 10);
      const dateFrom = normalizedDateInput(req.query.date_from, defaultFrom);
      const dateTo = normalizedDateInput(req.query.date_to, defaultTo);
      const location = locationCondition("esa", req.hireLocationScope);
      const rangeSql = "DATE(esa.created_at) BETWEEN ? AND ?";
      const baseParams = [...location.params, dateFrom, dateTo];

      const [[summaryRows], [agingRows], [monthlyRows], [statusRows], [assetRows], [expectedRows], [staffRows]] = await Promise.all([
        pool.query(
          `SELECT
             COUNT(*) AS agreements,
             SUM(esa.sale_type = 'cash') AS cash_sales,
             SUM(esa.sale_type = 'installment') AS installment_sales,
             SUM(esa.agreement_status IN ('active','due_soon','payment_due','overdue')) AS active_agreements,
             SUM(esa.agreement_status = 'overdue') AS overdue_agreements,
             COALESCE(SUM(esa.total_amount), 0) AS total_sales_value,
             COALESCE(SUM(esa.amount_paid), 0) AS collected_amount,
             COALESCE(SUM(esa.outstanding_balance), 0) AS outstanding_amount,
             COALESCE(SUM(esa.overdue_amount), 0) AS overdue_amount,
             COALESCE(SUM(esa.deposit_received), 0) AS deposits_received,
             COALESCE(SUM(esa.total_amount - fa.acquisition_cost), 0) AS estimated_gross_profit
           FROM equipment_sale_agreements esa
           INNER JOIN fleet_assets fa ON fa.id = esa.asset_id
           WHERE ${location.sql} AND ${rangeSql}`,
          baseParams
        ),
        pool.query(
          `SELECT
             CASE
               WHEN DATEDIFF(CURDATE(), esa.next_due_date) <= 0 THEN 'current'
               WHEN DATEDIFF(CURDATE(), esa.next_due_date) BETWEEN 1 AND 30 THEN '1_30_days'
               WHEN DATEDIFF(CURDATE(), esa.next_due_date) BETWEEN 31 AND 60 THEN '31_60_days'
               WHEN DATEDIFF(CURDATE(), esa.next_due_date) BETWEEN 61 AND 90 THEN '61_90_days'
               ELSE 'over_90_days'
             END AS aging_bucket,
             COUNT(*) AS agreements,
             COALESCE(SUM(esa.outstanding_balance), 0) AS outstanding_amount
           FROM equipment_sale_agreements esa
           WHERE ${location.sql}
             AND esa.outstanding_balance > 0.01
             AND esa.agreement_status NOT IN ('cancelled','defaulted')
           GROUP BY aging_bucket
           ORDER BY FIELD(aging_bucket, 'current','1_30_days','31_60_days','61_90_days','over_90_days')`,
          location.params
        ),
        pool.query(
          `SELECT
             DATE_FORMAT(esp.payment_date, '%Y-%m') AS month_key,
             DATE_FORMAT(esp.payment_date, '%b %Y') AS month_label,
             COUNT(*) AS payments,
             COALESCE(SUM(CASE WHEN esp.is_voided = FALSE THEN esp.amount ELSE 0 END), 0) AS collected_amount
           FROM equipment_sale_payments esp
           WHERE ${locationCondition("esp", req.hireLocationScope).sql}
             AND DATE(esp.payment_date) BETWEEN ? AND ?
           GROUP BY month_key, month_label
           ORDER BY month_key`,
          [...locationCondition("esp", req.hireLocationScope).params, dateFrom, dateTo]
        ),
        pool.query(
          `SELECT esa.agreement_status AS status, COUNT(*) AS agreements,
                  COALESCE(SUM(esa.total_amount), 0) AS total_value,
                  COALESCE(SUM(esa.outstanding_balance), 0) AS outstanding_amount
           FROM equipment_sale_agreements esa
           WHERE ${location.sql} AND ${rangeSql}
           GROUP BY esa.agreement_status
           ORDER BY agreements DESC`,
          baseParams
        ),
        pool.query(
          `SELECT fa.operational_purpose, fa.sale_status, fa.current_status,
                  COUNT(*) AS assets,
                  COALESCE(SUM(fa.target_selling_price), 0) AS target_sale_value,
                  COALESCE(SUM(fa.acquisition_cost), 0) AS acquisition_value
           FROM fleet_assets fa
           WHERE fa.is_active = TRUE
             AND ${locationCondition("fa", req.hireLocationScope).sql}
           GROUP BY fa.operational_purpose, fa.sale_status, fa.current_status
           ORDER BY assets DESC`,
          locationCondition("fa", req.hireLocationScope).params
        ),
        pool.query(
          `SELECT eis.due_date,
                  COUNT(DISTINCT eis.agreement_id) AS agreements,
                  COALESCE(SUM(GREATEST(eis.scheduled_amount + eis.late_charge_amount - eis.waived_charge_amount - eis.amount_paid, 0)), 0) AS expected_amount
           FROM equipment_installment_schedule eis
           INNER JOIN equipment_sale_agreements esa ON esa.id = eis.agreement_id
           WHERE ${location.sql}
             AND eis.schedule_status NOT IN ('paid','cancelled','waived')
             AND eis.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
           GROUP BY eis.due_date
           ORDER BY eis.due_date`,
          location.params
        ),
        pool.query(
          `SELECT COALESCE(u.full_name, u.username, 'System') AS staff_name,
                  COUNT(*) AS agreements,
                  COALESCE(SUM(esa.total_amount), 0) AS sales_value,
                  COALESCE(SUM(esa.amount_paid), 0) AS collected_amount,
                  COALESCE(SUM(esa.outstanding_balance), 0) AS outstanding_amount
           FROM equipment_sale_agreements esa
           LEFT JOIN users u ON u.id = esa.created_by
           WHERE ${location.sql} AND ${rangeSql}
           GROUP BY esa.created_by, staff_name
           ORDER BY sales_value DESC
           LIMIT 50`,
          baseParams
        ),
      ]);

      return res.json({
        status: "success",
        filters: {
          date_from: dateFrom,
          date_to: dateTo,
          hire_location_id: req.hireLocationScope?.locationId || null,
        },
        summary: summaryRows[0] || {},
        aging: agingRows,
        monthly_collections: monthlyRows,
        agreement_statuses: statusRows,
        asset_portfolio: assetRows,
        expected_collections: expectedRows,
        staff_performance: staffRows,
      });
    } catch (error) {
      console.error("Equipment Sales management report error:", error);
      return res.status(500).json({ status: "error", message: "Could not load Equipment Sales management reports." });
    }
  }
);

router.get(
  "/reports/export.csv",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const location = locationCondition("esa", req.hireLocationScope);
      const [rows] = await pool.query(
        `SELECT
           esa.agreement_number,
           esa.sale_type,
           esa.agreement_status,
           esa.customer_name_snapshot AS customer_name,
           esa.customer_phone_snapshot AS customer_phone,
           esa.asset_code_snapshot AS asset_code,
           esa.asset_name_snapshot AS asset_name,
           esa.total_amount,
           esa.deposit_received,
           esa.amount_paid,
           esa.outstanding_balance,
           esa.overdue_amount,
           esa.next_due_date,
           esa.delivery_status,
           esa.ownership_status,
           bl.name AS hire_location,
           u.full_name AS created_by,
           esa.created_at
         FROM equipment_sale_agreements esa
         INNER JOIN business_locations bl ON bl.id = esa.hire_location_id
         LEFT JOIN users u ON u.id = esa.created_by
         WHERE ${location.sql}
         ORDER BY esa.created_at DESC`,
        location.params
      );

      const columns = [
        "agreement_number",
        "sale_type",
        "agreement_status",
        "customer_name",
        "customer_phone",
        "asset_code",
        "asset_name",
        "total_amount",
        "deposit_received",
        "amount_paid",
        "outstanding_balance",
        "overdue_amount",
        "next_due_date",
        "delivery_status",
        "ownership_status",
        "hire_location",
        "created_by",
        "created_at",
      ];
      const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
      const csv = [
        columns.join(","),
        ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
      ].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="equipment-sales-report-${new Date().toISOString().slice(0, 10)}.csv"`
      );
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(`\ufeff${csv}`);
    } catch (error) {
      console.error("Equipment Sales CSV export error:", error);
      return res.status(500).json({ status: "error", message: "Could not export Equipment Sales records." });
    }
  }
);

router.get(
  "/retirement-status",
  requirePermission("fleet.assets.view"),
  async (_req, res) => {
    try {
      const [[agreementRows], [paymentRows], [saleRows], [triggerRows], [migrationRows]] = await Promise.all([
        pool.query("SELECT COUNT(*) AS total FROM installment_agreements"),
        pool.query("SELECT COUNT(*) AS total FROM installment_payments"),
        pool.query("SELECT COUNT(*) AS total FROM sales WHERE LOWER(COALESCE(payment_type, '')) = 'installment'"),
        pool.query(
          `SELECT COUNT(*) AS total
           FROM information_schema.TRIGGERS
           WHERE TRIGGER_SCHEMA = DATABASE()
             AND TRIGGER_NAME IN (
               'trg_spare_parts_installment_retired_sales_insert',
               'trg_spare_parts_installment_retired_agreement_insert'
             )`
        ),
        pool.query(
          `SELECT COUNT(*) AS total
           FROM schema_migrations
           WHERE migration_name = '20260722_retire_spare_parts_installments'`
        ),
      ]);

      return res.json({
        status: "success",
        retired: Number(triggerRows[0]?.total || 0) === 2 && Number(migrationRows[0]?.total || 0) === 1,
        historical_records: {
          agreements: Number(agreementRows[0]?.total || 0),
          payments: Number(paymentRows[0]?.total || 0),
          installment_sales: Number(saleRows[0]?.total || 0),
        },
        message:
          "New Spare Parts installment entry is retired. Historical tables are preserved for audit and recovery.",
      });
    } catch (error) {
      console.error("Spare Parts installment retirement status error:", error);
      return res.status(500).json({ status: "error", message: "Could not verify Spare Parts installment retirement." });
    }
  }
);

router.post(
  "/reminders/run",
  requirePermission("fleet.assets.manage"),
  async (_req, res) => {
    try {
      const result = await runEquipmentSalesReminderSync();
      return res.json({
        status: "success",
        message: result.disabled
          ? "SMS is disabled; no reminders were sent."
          : "Equipment Sales reminder check completed.",
        result,
      });
    } catch (error) {
      console.error("Manual Equipment Sales reminder run error:", error);
      return res.status(500).json({ status: "error", message: "Could not run Equipment Sales reminders." });
    }
  }
);

module.exports = router;
