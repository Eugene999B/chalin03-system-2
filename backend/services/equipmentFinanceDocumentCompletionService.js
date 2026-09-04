const crypto = require("crypto");
const PDFDocument = require("pdfkit");

const { pool } = require("../config/db");
const { nextDocumentNumber } = require("./groupConfigurationService");
const {
  ProfessionalFinanceError,
  getIssuedDocument,
  loadAgreementSnapshot,
} = require("./equipmentFinanceProfessionalService");

const DOCUMENT_DEFINITIONS = Object.freeze({
  installment_agreement: {
    title: "Machine Sale & Installment Agreement",
    short_title: "Original Agreement",
    category: "agreement",
    formats: ["pdf", "word", "print"],
  },
  customer_agreement_copy: {
    title: "Machine Sale & Installment Agreement",
    short_title: "Customer Copy",
    category: "agreement",
    formats: ["pdf", "word", "print"],
  },
  company_agreement_copy: {
    title: "Machine Sale & Installment Agreement",
    short_title: "Company Copy",
    category: "agreement",
    formats: ["pdf", "word", "print"],
  },
  boss_approval_pack: {
    title: "Installment Approval & Risk Pack",
    short_title: "Boss Approval Pack",
    category: "approval",
    formats: ["pdf", "word", "print"],
  },
  payment_schedule: {
    title: "Official Installment Payment Schedule",
    short_title: "Payment Schedule",
    category: "schedule",
    formats: ["pdf", "word", "print"],
  },
  machine_annexure: {
    title: "Machine Identity & Photo Annexure",
    short_title: "Machine Annexure",
    category: "machine",
    formats: ["pdf", "word", "print"],
  },
  guarantor_undertaking: {
    title: "Guarantor Undertaking",
    short_title: "Guarantor Form",
    category: "guarantor",
    formats: ["pdf", "word", "print"],
  },
  payment_receipt: {
    title: "Official Installment Payment Receipt",
    short_title: "Payment Receipt",
    category: "receipt",
    formats: ["pdf", "thermal", "print"],
  },
  customer_statement: {
    title: "Customer Installment Statement",
    short_title: "Customer Statement",
    category: "statement",
    formats: ["pdf", "word", "print"],
  },
  delivery_handover_note: {
    title: "Excavator Delivery & Handover Note",
    short_title: "Delivery Note",
    category: "delivery",
    formats: ["pdf", "word", "print"],
  },
  arrears_notice: {
    title: "Installment Arrears Notice",
    short_title: "Arrears Notice",
    category: "arrears",
    formats: ["pdf", "word", "print"],
  },
  amendment_agreement: {
    title: "Installment Agreement Amendment",
    short_title: "Amendment Agreement",
    category: "amendment",
    formats: ["pdf", "word", "print"],
  },
  settlement_confirmation: {
    title: "Full Settlement Confirmation",
    short_title: "Settlement Confirmation",
    category: "completion",
    formats: ["pdf", "word", "print"],
  },
  ownership_transfer: {
    title: "Equipment Ownership Transfer Certificate",
    short_title: "Ownership Transfer",
    category: "completion",
    formats: ["pdf", "word", "print"],
  },
});

const LEGAL_TYPES = new Set([
  "installment_agreement",
  "customer_agreement_copy",
  "company_agreement_copy",
  "guarantor_undertaking",
  "amendment_agreement",
  "ownership_transfer",
]);

function cleanText(value, maximum = 1000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function money(value) {
  return `GHc ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateLabel(value) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toLocaleDateString("en-GH", {
    year: "numeric",
    month: "long",
    day: "2-digit",
    timeZone: "Africa/Accra",
  });
}

function dateTimeLabel(value) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("en-GH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Accra",
  });
}

function label(value) {
  return cleanText(value, 100)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function dataImageBuffer(value) {
  const match = String(value || "").match(
    /^data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/i
  );
  if (!match) return null;
  const buffer = Buffer.from(match[1], "base64");
  return buffer.length ? buffer : null;
}

function publicDefinitions() {
  return Object.entries(DOCUMENT_DEFINITIONS).map(([code, definition]) => ({
    code,
    ...definition,
  }));
}

async function optionalRows(sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return [];
    throw error;
  }
}

function overdueSummary(snapshot) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = (snapshot.schedule || []).filter(
    (row) => String(row.due_date || "").slice(0, 10) < today && Number(row.balance || 0) > 0.01
  );
  return {
    rows,
    amount: Number(rows.reduce((sum, row) => sum + Number(row.balance || 0), 0).toFixed(2)),
    count: rows.length,
    oldest_due_date: rows[0]?.due_date || null,
  };
}

async function enrichSnapshot(snapshot, { paymentId = null, amendmentId = null } = {}) {
  const agreementId = positiveId(snapshot?.agreement?.id);
  const payment = paymentId
    ? (snapshot.payments || []).find((item) => Number(item.id) === Number(paymentId))
    : null;
  const allocations = payment
    ? await optionalRows(
        `SELECT allocation.id, allocation.schedule_id, allocation.allocated_amount,
                schedule.sequence_number, schedule.due_date
           FROM equipment_sale_payment_allocations allocation
           INNER JOIN equipment_installment_schedule schedule ON schedule.id = allocation.schedule_id
          WHERE allocation.payment_id = ?
          ORDER BY schedule.sequence_number`,
        [payment.id]
      )
    : [];
  const deliveries = agreementId
    ? await optionalRows(
        `SELECT * FROM equipment_deliveries
          WHERE agreement_id = ?
          ORDER BY delivered_at DESC, id DESC LIMIT 10`,
        [agreementId]
      )
    : [];
  const ownershipTransfers = agreementId
    ? await optionalRows(
        `SELECT * FROM equipment_ownership_transfers
          WHERE agreement_id = ?
          ORDER BY transferred_at DESC, id DESC LIMIT 10`,
        [agreementId]
      )
    : [];
  const amendments = agreementId
    ? await optionalRows(
        `SELECT amendment.*, requester.full_name AS requested_by_name,
                approver.full_name AS approved_by_name
           FROM equipment_finance_case_amendments amendment
           LEFT JOIN users requester ON requester.id = amendment.requested_by
           LEFT JOIN users approver ON approver.id = amendment.approved_by
          WHERE amendment.agreement_id = ?
          ORDER BY amendment.requested_at DESC, amendment.id DESC`,
        [agreementId]
      )
    : [];
  const selectedAmendment = amendmentId
    ? amendments.find((item) => Number(item.id) === Number(amendmentId))
    : amendments.find((item) => ["approved", "applied"].includes(item.amendment_status)) || null;

  return {
    ...snapshot,
    document_context: {
      payment: payment || null,
      payment_allocations: allocations.map((row) => ({
        ...row,
        allocated_amount: Number(row.allocated_amount || 0),
      })),
      delivery: deliveries[0] || null,
      ownership_transfer: ownershipTransfers[0] || null,
      amendment: selectedAmendment
        ? {
            ...selectedAmendment,
            before_snapshot: parseJson(selectedAmendment.before_snapshot_json, {}),
            proposed_changes: parseJson(selectedAmendment.proposed_changes_json, {}),
            applied_result: parseJson(selectedAmendment.applied_result_json, {}),
          }
        : null,
      overdue: overdueSummary(snapshot),
    },
  };
}

function assertIssueAllowed(type, snapshot) {
  if (!snapshot.reconciliation?.consistent) {
    throw new ProfessionalFinanceError(
      409,
      "The Finance account does not reconcile with its receipts, schedule and ledger. Correct the account before issuing an official document.",
      "EQUIPMENT_FINANCE_RECONCILIATION_REQUIRED"
    );
  }
  if (LEGAL_TYPES.has(type) && snapshot.policy?.legal_review_status !== "approved") {
    throw new ProfessionalFinanceError(
      409,
      "Legally approved Finance terms are required before this document can be issued.",
      "EQUIPMENT_FINANCE_TERMS_APPROVAL_REQUIRED"
    );
  }
  if (type === "payment_receipt" && !snapshot.document_context?.payment) {
    throw new ProfessionalFinanceError(400, "Choose the exact committed payment for this receipt.");
  }
  if (type === "guarantor_undertaking" && !snapshot.agreement?.guarantor_name) {
    throw new ProfessionalFinanceError(409, "A guarantor must be recorded before issuing the undertaking.");
  }
  if (type === "arrears_notice" && Number(snapshot.document_context?.overdue?.amount || 0) <= 0) {
    throw new ProfessionalFinanceError(409, "This account has no overdue installment balance.");
  }
  if (type === "amendment_agreement" && !snapshot.document_context?.amendment) {
    throw new ProfessionalFinanceError(409, "No approved or applied amendment is available for issue.");
  }
  if (
    ["settlement_confirmation", "ownership_transfer"].includes(type) &&
    Number(snapshot.agreement?.outstanding_balance || 0) > 0.01
  ) {
    throw new ProfessionalFinanceError(409, "Full settlement is required before this completion document can be issued.");
  }
  if (type === "ownership_transfer" && !snapshot.document_context?.ownership_transfer) {
    throw new ProfessionalFinanceError(409, "A controlled ownership transfer must be recorded first.");
  }
}

async function nextCompletionNumber(type, userId) {
  const map = {
    installment_agreement: ["EQUIPMENT_FINANCE_AGREEMENT_DOCUMENT", "EFA"],
    customer_agreement_copy: ["EQUIPMENT_FINANCE_CUSTOMER_AGREEMENT_COPY", "EFAC"],
    company_agreement_copy: ["EQUIPMENT_FINANCE_COMPANY_AGREEMENT_COPY", "EFCO"],
    boss_approval_pack: ["EQUIPMENT_FINANCE_BOSS_APPROVAL_PACK", "EFBP"],
    payment_schedule: ["EQUIPMENT_FINANCE_SCHEDULE_DOCUMENT", "EFS"],
    machine_annexure: ["EQUIPMENT_FINANCE_MACHINE_ANNEXURE", "EFM"],
    guarantor_undertaking: ["EQUIPMENT_FINANCE_GUARANTOR_DOCUMENT", "EFG"],
    payment_receipt: ["EQUIPMENT_FINANCE_PAYMENT_RECEIPT_DOCUMENT", "EFR"],
    customer_statement: ["EQUIPMENT_FINANCE_CUSTOMER_STATEMENT", "EFST"],
    delivery_handover_note: ["EQUIPMENT_FINANCE_DELIVERY_NOTE", "EFDN"],
    arrears_notice: ["EQUIPMENT_FINANCE_ARREARS_NOTICE", "EFAN"],
    amendment_agreement: ["EQUIPMENT_FINANCE_AMENDMENT_DOCUMENT", "EFAM"],
    settlement_confirmation: ["EQUIPMENT_FINANCE_SETTLEMENT_DOCUMENT", "EFSC"],
    ownership_transfer: ["EQUIPMENT_FINANCE_OWNERSHIP_DOCUMENT", "EFO"],
  };
  const [sequence, prefix] = map[type] || ["EQUIPMENT_FINANCE_DOCUMENT", "EFD"];
  try {
    return await nextDocumentNumber(sequence, { userId: positiveId(userId) });
  } catch {
    return `${prefix}-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${crypto
      .randomInt(0, 10000)
      .toString()
      .padStart(4, "0")}`;
  }
}

async function issueCompletionDocument({
  agreementId,
  documentType,
  format = "pdf",
  paymentId = null,
  amendmentId = null,
  userId = null,
}) {
  const type = cleanText(documentType, 80).toLowerCase().replace(/[\s-]+/g, "_");
  const definition = DOCUMENT_DEFINITIONS[type];
  if (!definition) throw new ProfessionalFinanceError(400, "Choose a supported Finance document type.");
  const storedFormat = format === "word" ? "word" : "pdf";
  const baseSnapshot = await loadAgreementSnapshot(agreementId);
  const snapshot = await enrichSnapshot(baseSnapshot, { paymentId, amendmentId });
  assertIssueAllowed(type, snapshot);
  snapshot.document_context.document_type = type;
  snapshot.document_context.document_title = definition.title;
  snapshot.document_context.copy_label = definition.short_title;

  const number = await nextCompletionNumber(type, userId);
  const snapshotText = safeJson(snapshot);
  const checksum = crypto.createHash("sha256").update(snapshotText).digest("hex");
  const [result] = await pool.query(
    `INSERT INTO equipment_finance_issued_documents (
       document_number, agreement_id, document_type, document_format,
       template_version, snapshot_json, snapshot_checksum, issued_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      number,
      positiveId(agreementId),
      type,
      storedFormat,
      snapshot.template_version,
      snapshotText,
      checksum,
      positiveId(userId),
    ]
  );
  return {
    id: result.insertId,
    document_number: number,
    document_type: type,
    document_format: storedFormat,
    snapshot_checksum: checksum,
    snapshot,
  };
}

function agreementName(snapshot) {
  return (
    snapshot.agreement?.kyc_customer_name ||
    snapshot.agreement?.customer_name_snapshot ||
    snapshot.agreement?.customer_name ||
    "Customer"
  );
}

function mainPhoto(snapshot) {
  const source =
    snapshot.media?.find((item) => item.evidence_type === "main")?.file_url ||
    snapshot.media?.find((item) => item.is_primary)?.file_url ||
    snapshot.agreement?.main_image_url;
  return dataImageBuffer(source);
}

function addBrandHeader(doc, snapshot, document, { compact = false } = {}) {
  const gold = "#d3a72c";
  const green = "#174f35";
  const top = doc.y;
  doc.save().circle(62, top + 20, 18).fill(gold).restore();
  doc.fillColor("#16251d").font("Helvetica-Bold").fontSize(compact ? 9 : 13).text("C03", 46, top + 13, {
    width: 32,
    align: "center",
  });
  doc.fillColor(green).font("Helvetica-Bold").fontSize(compact ? 11 : 16).text(
    snapshot.company?.name || "CHALIN 03 COMPANY LIMITED",
    88,
    top + 4,
    { width: compact ? 120 : 300 }
  );
  doc.fillColor("#57655d").font("Helvetica").fontSize(compact ? 6.5 : 8).text(
    [snapshot.company?.phone, snapshot.company?.email, snapshot.company?.postal_address || snapshot.company?.address]
      .filter(Boolean)
      .join("  |  "),
    88,
    top + 24,
    { width: compact ? 120 : 420 }
  );
  doc.moveTo(45, top + 47).lineTo(doc.page.width - 45, top + 47).lineWidth(3).strokeColor(gold).stroke();
  doc.y = top + 58;
  doc.fillColor("#17251e").font("Helvetica-Bold").fontSize(compact ? 11 : 17).text(
    DOCUMENT_DEFINITIONS[document.document_type]?.title || "Finance Document",
    { align: "center" }
  );
  doc.fillColor("#5d6862").font("Helvetica").fontSize(compact ? 6.5 : 8).text(
    `${DOCUMENT_DEFINITIONS[document.document_type]?.short_title || label(document.document_type)}  |  ${document.document_number}  |  Agreement ${snapshot.agreement?.agreement_number}`,
    { align: "center" }
  );
  doc.moveDown(compact ? 0.5 : 1);
}

function sectionTitle(doc, title) {
  doc.moveDown(0.5).fillColor("#174f35").font("Helvetica-Bold").fontSize(11).text(title);
  doc.moveTo(45, doc.y + 2).lineTo(doc.page.width - 45, doc.y + 2).lineWidth(0.7).strokeColor("#d3a72c").stroke();
  doc.moveDown(0.55);
}

function fieldGrid(doc, rows) {
  const left = 45;
  const width = doc.page.width - 90;
  const column = width / 2;
  rows.forEach((row, rowIndex) => {
    const y = doc.y;
    row.forEach((item, columnIndex) => {
      if (!item) return;
      const x = left + columnIndex * column;
      doc.fillColor("#718078").font("Helvetica").fontSize(7).text(item[0], x, y, { width: column - 12 });
      doc.fillColor("#17251e").font("Helvetica-Bold").fontSize(8.5).text(String(item[1] ?? "Not recorded"), x, y + 10, {
        width: column - 12,
      });
    });
    doc.y = y + 31;
    if (rowIndex < rows.length - 1) {
      doc.moveTo(left, doc.y - 5).lineTo(left + width, doc.y - 5).lineWidth(0.25).strokeColor("#dfe7e2").stroke();
    }
  });
}

function ensurePage(doc, height = 100, snapshot = null, document = null) {
  if (doc.y + height <= doc.page.height - 55) return;
  doc.addPage();
  if (snapshot && document) addBrandHeader(doc, snapshot, document);
}

function scheduleTable(doc, snapshot, document, rows = snapshot.schedule || []) {
  const columns = [45, 78, 152, 252, 352, 452];
  const widths = [30, 70, 95, 95, 95, 95];
  const headings = ["No.", "Due date", "Scheduled", "Paid", "Balance", "Status"];
  ensurePage(doc, 60, snapshot, document);
  headings.forEach((heading, index) => {
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7).text(heading, columns[index], doc.y + 6, {
      width: widths[index],
    });
  });
  doc.rect(45, doc.y, doc.page.width - 90, 22).fill("#174f35");
  doc.y += 27;
  rows.forEach((row) => {
    ensurePage(doc, 26, snapshot, document);
    const rowY = doc.y;
    const values = [
      row.sequence_number,
      dateLabel(row.due_date),
      money(row.scheduled_amount),
      money(row.amount_paid),
      money(row.balance),
      label(row.schedule_status),
    ];
    values.forEach((value, index) => {
      doc.fillColor("#24352c").font("Helvetica").fontSize(7).text(String(value), columns[index], rowY, {
        width: widths[index],
      });
    });
    doc.y = rowY + 20;
    doc.moveTo(45, doc.y - 3).lineTo(doc.page.width - 45, doc.y - 3).lineWidth(0.25).strokeColor("#d9e1dc").stroke();
  });
}

function addSignatures(doc, snapshot, document, roles = [
  ["seller", "Seller's Representative"],
  ["buyer", "Buyer"],
  ["buyer_witness", "Witness"],
  ["guarantor", "Guarantor"],
]) {
  sectionTitle(doc, "Signatures");
  roles.forEach(([role, title], index) => {
    ensurePage(doc, 95, snapshot, document);
    const signature = snapshot.signatures?.find((item) => item.signer_role === role);
    const fallback = role === "seller" ? snapshot.company?.authorised_seller_signature_data_url : null;
    const image = dataImageBuffer(signature?.signature_data_url || fallback);
    const x = index % 2 === 0 ? 45 : 305;
    const y = index % 2 === 0 ? doc.y : doc.y - 82;
    doc.fillColor("#174f35").font("Helvetica-Bold").fontSize(8).text(title, x, y, { width: 245 });
    if (image) doc.image(image, x, y + 15, { fit: [170, 45] });
    doc.fillColor("#27372e").font("Helvetica").fontSize(7.5).text(
      `Name: ${signature?.signer_name || (role === "seller" ? snapshot.company?.authorised_seller_name || "" : "")}`,
      x,
      y + 62,
      { width: 245 }
    );
    doc.moveTo(x, y + 78).lineTo(x + 220, y + 78).lineWidth(0.5).strokeColor("#53625a").stroke();
    if (index % 2 === 1 || index === roles.length - 1) doc.y = y + 90;
  });
}

function renderAgreementBody(doc, snapshot, document) {
  const agreement = snapshot.agreement;
  const image = mainPhoto(snapshot);
  if (image) {
    doc.rect(45, doc.y, doc.page.width - 90, 180).strokeColor("#dbe3de").stroke();
    doc.image(image, 52, doc.y + 7, { fit: [doc.page.width - 104, 166], align: "center", valign: "center" });
    doc.y += 192;
  }
  sectionTitle(doc, "Buyer and machine details");
  fieldGrid(doc, [
    [["Buyer", agreementName(snapshot)], ["Phone", agreement.kyc_customer_phone || agreement.customer_phone_snapshot]],
    [["Address", agreement.residential_address || agreement.customer_address_snapshot], ["Ghana Card / ID", `${agreement.id_type || ""} ${agreement.id_number || ""}`]],
    [["Machine", `${agreement.asset_code} - ${agreement.asset_name}`], ["Make / model", `${agreement.make || ""} ${agreement.model || ""}`]],
    [["Serial number", agreement.serial_number], ["Chassis number", agreement.chassis_number]],
  ]);
  sectionTitle(doc, "Commercial terms");
  fieldGrid(doc, [
    [["Purchase price", money(agreement.total_amount)], ["Opening deposit", money(agreement.deposit_required || agreement.deposit_received)]],
    [["Amount paid", money(agreement.amount_paid)], ["Outstanding balance", money(agreement.outstanding_balance)]],
    [["Payment pattern", label(agreement.payment_frequency)], ["Number of installments", agreement.installment_count]],
    [["First due date", dateLabel(agreement.first_due_date)], ["Final due date", dateLabel(agreement.final_due_date)]],
  ]);
  doc.addPage();
  addBrandHeader(doc, snapshot, document);
  sectionTitle(doc, "Official installment payment schedule");
  scheduleTable(doc, snapshot, document);
  doc.addPage();
  addBrandHeader(doc, snapshot, document);
  sectionTitle(doc, `Terms and conditions - version ${snapshot.template_version}`);
  doc.fillColor("#28372f").font("Helvetica").fontSize(8.5).text(snapshot.policy?.agreement_terms || "No terms recorded.", {
    align: "justify",
    lineGap: 2,
  });
  addSignatures(doc, snapshot, document);
}

function renderStatementBody(doc, snapshot, document) {
  const agreement = snapshot.agreement;
  sectionTitle(doc, "Customer account summary");
  fieldGrid(doc, [
    [["Customer", agreementName(snapshot)], ["Agreement", agreement.agreement_number]],
    [["Machine", `${agreement.asset_code} - ${agreement.asset_name}`], ["Statement date", dateLabel(snapshot.generated_at)]],
    [["Purchase price", money(agreement.total_amount)], ["Total paid", money(agreement.amount_paid)]],
    [["Outstanding balance", money(agreement.outstanding_balance)], ["Overdue balance", money(snapshot.document_context?.overdue?.amount)]],
  ]);
  sectionTitle(doc, "Payment history");
  const columns = [45, 145, 250, 350, 455];
  ["Receipt", "Date", "Method", "Amount", "Received by"].forEach((heading, index) => {
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7).text(heading, columns[index], doc.y + 6, { width: 95 });
  });
  doc.rect(45, doc.y, doc.page.width - 90, 22).fill("#174f35");
  doc.y += 27;
  (snapshot.payments || []).forEach((payment) => {
    ensurePage(doc, 25, snapshot, document);
    const y = doc.y;
    [payment.receipt_number || payment.payment_number, dateLabel(payment.payment_date), label(payment.payment_method), money(payment.amount), payment.received_by_name || "Finance staff"].forEach((value, index) => {
      doc.fillColor("#27372e").font("Helvetica").fontSize(7).text(String(value || ""), columns[index], y, { width: 95 });
    });
    doc.y = y + 20;
  });
  sectionTitle(doc, "Remaining schedule");
  scheduleTable(doc, snapshot, document, (snapshot.schedule || []).filter((row) => Number(row.balance || 0) > 0.01));
}

function renderReceiptBody(doc, snapshot, document, { thermal = false } = {}) {
  const payment = snapshot.document_context?.payment;
  const agreement = snapshot.agreement;
  if (thermal) {
    doc.fillColor("#17251e").font("Helvetica-Bold").fontSize(10).text(document.document_number, { align: "center" });
    doc.moveDown(0.5).font("Helvetica").fontSize(7.5);
    [
      ["Customer", agreementName(snapshot)],
      ["Agreement", agreement.agreement_number],
      ["Machine", `${agreement.asset_code} ${agreement.asset_name}`],
      ["Payment date", dateTimeLabel(payment.payment_date)],
      ["Method", label(payment.payment_method)],
      ["Reference", payment.reference_number || "-"],
      ["Amount received", money(payment.amount)],
      ["Official balance", money(agreement.outstanding_balance)],
    ].forEach(([name, value]) => {
      doc.font("Helvetica-Bold").text(`${name}:`, { continued: true });
      doc.font("Helvetica").text(` ${value}`);
    });
    doc.moveDown(0.5).text("Allocation", { align: "center" });
    (snapshot.document_context?.payment_allocations || []).forEach((row) => {
      doc.text(`Installment ${row.sequence_number}  ${money(row.allocated_amount)}`);
    });
    doc.moveDown().font("Helvetica-Bold").text("Thank you for your payment.", { align: "center" });
    return;
  }
  sectionTitle(doc, "Payment confirmation");
  fieldGrid(doc, [
    [["Customer", agreementName(snapshot)], ["Agreement", agreement.agreement_number]],
    [["Receipt number", payment.receipt_number || payment.payment_number], ["Payment date", dateTimeLabel(payment.payment_date)]],
    [["Payment method", label(payment.payment_method)], ["Reference", payment.reference_number || "Not recorded"]],
    [["Amount received", money(payment.amount)], ["Official balance after payment", money(agreement.outstanding_balance)]],
    [["Received by", payment.received_by_name || "Finance staff"], ["Machine", `${agreement.asset_code} - ${agreement.asset_name}`]],
  ]);
  sectionTitle(doc, "Oldest-due-first allocation");
  (snapshot.document_context?.payment_allocations || []).forEach((row) => {
    doc.fillColor("#27372e").font("Helvetica").fontSize(8.5).text(
      `Installment ${row.sequence_number} due ${dateLabel(row.due_date)}: ${money(row.allocated_amount)}`
    );
  });
  doc.moveDown(1.5).fillColor("#174f35").font("Helvetica-Bold").fontSize(11).text("Payment received with thanks.", {
    align: "center",
  });
}

function renderSpecialBody(doc, snapshot, document) {
  const type = document.document_type;
  const agreement = snapshot.agreement;
  if (type === "payment_schedule") {
    sectionTitle(doc, "Agreement and payment summary");
    fieldGrid(doc, [
      [["Customer", agreementName(snapshot)], ["Agreement", agreement.agreement_number]],
      [["Machine", `${agreement.asset_code} - ${agreement.asset_name}`], ["Outstanding", money(agreement.outstanding_balance)]],
    ]);
    sectionTitle(doc, "Official installment schedule");
    scheduleTable(doc, snapshot, document);
    return;
  }
  if (type === "customer_statement") {
    renderStatementBody(doc, snapshot, document);
    return;
  }
  if (type === "payment_receipt") {
    renderReceiptBody(doc, snapshot, document);
    return;
  }
  if (type === "machine_annexure") {
    sectionTitle(doc, "Machine identity");
    fieldGrid(doc, [
      [["Equipment", `${agreement.asset_code} - ${agreement.asset_name}`], ["Make / model", `${agreement.make || ""} ${agreement.model || ""}`]],
      [["Serial", agreement.serial_number], ["Chassis", agreement.chassis_number]],
      [["Engine", agreement.engine_number], ["Registration", agreement.registration_number]],
    ]);
    sectionTitle(doc, "Protected machine photographs");
    (snapshot.media || []).slice(0, 10).forEach((item, index) => {
      const image = dataImageBuffer(item.file_url);
      if (!image) return;
      ensurePage(doc, 175, snapshot, document);
      doc.rect(45, doc.y, doc.page.width - 90, 150).strokeColor("#d8e1dc").stroke();
      doc.image(image, 52, doc.y + 7, { fit: [doc.page.width - 104, 128], align: "center", valign: "center" });
      doc.fillColor("#5c6861").font("Helvetica").fontSize(7).text(`${index + 1}. ${label(item.evidence_type)}`, 45, doc.y + 132, {
        width: doc.page.width - 90,
        align: "center",
      });
      doc.y += 162;
    });
    return;
  }
  if (type === "guarantor_undertaking") {
    sectionTitle(doc, "Guarantor and buyer details");
    fieldGrid(doc, [
      [["Guarantor", agreement.guarantor_name], ["Phone", agreement.guarantor_phone]],
      [["Guarantor ID", agreement.guarantor_id_number], ["Relationship", agreement.guarantor_relationship]],
      [["Buyer", agreementName(snapshot)], ["Agreement", agreement.agreement_number]],
      [["Guaranteed balance", money(agreement.outstanding_balance)], ["Machine", `${agreement.asset_code} - ${agreement.asset_name}`]],
    ]);
    doc.moveDown().fillColor("#27372e").font("Helvetica").fontSize(9).text(
      `I, ${agreement.guarantor_name}, confirm that I have reviewed this installment obligation and undertake to support the buyer's performance under the approved agreement. I understand that this undertaking forms part of the controlled Finance case file and does not replace the main agreement terms.`,
      { align: "justify", lineGap: 3 }
    );
    addSignatures(doc, snapshot, document, [["guarantor", "Guarantor"], ["buyer", "Buyer"], ["seller", "Seller's Representative"]]);
    return;
  }
  if (type === "arrears_notice") {
    const overdue = snapshot.document_context?.overdue || {};
    sectionTitle(doc, "Notice of overdue installment payments");
    fieldGrid(doc, [
      [["Customer", agreementName(snapshot)], ["Agreement", agreement.agreement_number]],
      [["Overdue amount", money(overdue.amount)], ["Overdue installments", overdue.count]],
      [["Oldest unpaid due date", dateLabel(overdue.oldest_due_date)], ["Current outstanding", money(agreement.outstanding_balance)]],
    ]);
    doc.moveDown().fillColor("#27372e").font("Helvetica").fontSize(9).text(
      `This is formal notice that the installment account above is overdue. Please contact Chalin 03 Company Limited immediately and settle the overdue amount or agree a controlled resolution within ${snapshot.policy?.notice_cure_days || 14} day(s). This notice does not waive any right preserved by the signed agreement.`,
      { align: "justify", lineGap: 3 }
    );
    sectionTitle(doc, "Overdue schedule lines");
    scheduleTable(doc, snapshot, document, overdue.rows || []);
    return;
  }
  if (type === "amendment_agreement") {
    const amendment = snapshot.document_context?.amendment;
    sectionTitle(doc, "Approved amendment");
    fieldGrid(doc, [
      [["Amendment number", amendment.amendment_number], ["Status", label(amendment.amendment_status)]],
      [["Type", label(amendment.amendment_type)], ["Effective date", dateLabel(amendment.effective_date)]],
      [["Requested by", amendment.requested_by_name || amendment.requested_by], ["Approved by", amendment.approved_by_name || amendment.approved_by]],
    ]);
    doc.moveDown().font("Helvetica-Bold").fontSize(9).text("Reason");
    doc.font("Helvetica").fontSize(8.5).text(amendment.reason || "Not recorded", { lineGap: 2 });
    doc.moveDown().font("Helvetica-Bold").fontSize(9).text("Approved changes");
    doc.font("Courier").fontSize(7.5).text(JSON.stringify(amendment.proposed_changes || {}, null, 2));
    addSignatures(doc, snapshot, document, [["seller", "Seller's Representative"], ["buyer", "Buyer"], ["buyer_witness", "Witness"]]);
    return;
  }
  if (type === "delivery_handover_note") {
    const delivery = snapshot.document_context?.delivery || {};
    sectionTitle(doc, "Machine handover details");
    fieldGrid(doc, [
      [["Customer", agreementName(snapshot)], ["Agreement", agreement.agreement_number]],
      [["Machine", `${agreement.asset_code} - ${agreement.asset_name}`], ["Serial", agreement.serial_number]],
      [["Receiving person", delivery.receiving_person], ["Destination", delivery.destination]],
      [["Condition", label(delivery.condition_status)], ["Meter reading", delivery.meter_reading]],
      [["Fuel level", delivery.fuel_level_percent === undefined ? "" : `${delivery.fuel_level_percent}%`], ["Handover date", dateTimeLabel(delivery.delivered_at)]],
    ]);
    doc.moveDown().font("Helvetica-Bold").fontSize(9).text("Attachments, tools and notes");
    doc.font("Helvetica").fontSize(8.5).text(delivery.attachments_tools || delivery.notes || "To be completed at physical handover.", {
      lineGap: 2,
    });
    addSignatures(doc, snapshot, document, [["seller", "Company Representative"], ["buyer", "Receiving Customer"], ["buyer_witness", "Witness"]]);
    return;
  }
  if (type === "settlement_confirmation") {
    sectionTitle(doc, "Full settlement confirmation");
    fieldGrid(doc, [
      [["Customer", agreementName(snapshot)], ["Agreement", agreement.agreement_number]],
      [["Machine", `${agreement.asset_code} - ${agreement.asset_name}`], ["Purchase price", money(agreement.total_amount)]],
      [["Total paid", money(agreement.amount_paid)], ["Outstanding balance", money(agreement.outstanding_balance)]],
      [["Final payment date", dateLabel(snapshot.payments?.at(-1)?.payment_date)], ["Confirmation date", dateLabel(snapshot.generated_at)]],
    ]);
    doc.moveDown().fillColor("#174f35").font("Helvetica-Bold").fontSize(12).text(
      "The installment obligation has been fully settled according to the reconciled Finance ledger.",
      { align: "center", lineGap: 3 }
    );
    addSignatures(doc, snapshot, document, [["seller", "Company Representative"], ["buyer", "Customer"]]);
    return;
  }
  if (type === "ownership_transfer") {
    const transfer = snapshot.document_context?.ownership_transfer || {};
    sectionTitle(doc, "Ownership transfer certificate");
    fieldGrid(doc, [
      [["New owner", agreementName(snapshot)], ["Agreement", agreement.agreement_number]],
      [["Machine", `${agreement.asset_code} - ${agreement.asset_name}`], ["Serial", agreement.serial_number]],
      [["Chassis", agreement.chassis_number], ["Registration", agreement.registration_number]],
      [["Transfer number", transfer.transfer_number || transfer.ownership_number], ["Transfer date", dateTimeLabel(transfer.transferred_at)]],
    ]);
    doc.moveDown().fillColor("#27372e").font("Helvetica").fontSize(9).text(
      `Chalin 03 Company Limited confirms that the reconciled installment balance is fully settled and the controlled ownership-transfer record authorises transfer of the machine identified above to ${agreementName(snapshot)}.`,
      { align: "justify", lineGap: 3 }
    );
    addSignatures(doc, snapshot, document, [["seller", "Authorised Company Representative"], ["buyer", "New Owner"], ["buyer_witness", "Witness"]]);
    return;
  }
  if (type === "boss_approval_pack") {
    sectionTitle(doc, "Executive approval summary");
    fieldGrid(doc, [
      [["Customer", agreementName(snapshot)], ["Agreement", agreement.agreement_number]],
      [["Machine", `${agreement.asset_code} - ${agreement.asset_name}`], ["Serial", agreement.serial_number]],
      [["Purchase price", money(agreement.total_amount)], ["Deposit", money(agreement.deposit_required)]],
      [["Financed amount", money(agreement.financed_amount)], ["Outstanding", money(agreement.outstanding_balance)]],
      [["KYC status", label(agreement.kyc_status)], ["Risk band", label(agreement.risk_band)]],
      [["Affordability", label(agreement.affordability_status)], ["Reconciliation", snapshot.reconciliation?.consistent ? "Verified" : "Mismatch"]],
    ]);
    const image = mainPhoto(snapshot);
    if (image) {
      sectionTitle(doc, "Exact approved machine");
      doc.image(image, 70, doc.y, { fit: [455, 240], align: "center", valign: "center" });
      doc.y += 250;
    }
    sectionTitle(doc, "Schedule summary");
    scheduleTable(doc, snapshot, document, (snapshot.schedule || []).slice(0, 12));
    return;
  }
  renderAgreementBody(doc, snapshot, document);
}

function addFooters(doc, document) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc.fillColor("#657169").font("Helvetica").fontSize(6.5).text(
      `CHALIN 03 COMPANY LIMITED  |  ${document.document_number}  |  Snapshot ${String(document.snapshot_checksum || "").slice(0, 16)}  |  Page ${index + 1} of ${range.count}`,
      45,
      doc.page.height - 35,
      { width: doc.page.width - 90, align: "center" }
    );
  }
}

async function renderCompletionPdf(document, { layout = "a4" } = {}) {
  const snapshot = document.snapshot;
  const thermal = layout === "thermal" && document.document_type === "payment_receipt";
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: thermal ? [226.77, 620] : "A4",
      margins: thermal ? { top: 16, bottom: 18, left: 14, right: 14 } : { top: 38, bottom: 50, left: 45, right: 45 },
      bufferPages: true,
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      addBrandHeader(doc, snapshot, document, { compact: thermal });
      if (thermal) renderReceiptBody(doc, snapshot, document, { thermal: true });
      else renderSpecialBody(doc, snapshot, document);
      addFooters(doc, document);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderCompletionWord(document) {
  const snapshot = document.snapshot;
  const agreement = snapshot.agreement;
  const definition = DOCUMENT_DEFINITIONS[document.document_type];
  const scheduleRows = (snapshot.schedule || [])
    .map((row) => `<tr><td>${row.sequence_number}</td><td>${htmlEscape(dateLabel(row.due_date))}</td><td>${htmlEscape(money(row.scheduled_amount))}</td><td>${htmlEscape(money(row.amount_paid))}</td><td>${htmlEscape(money(row.balance))}</td><td>${htmlEscape(label(row.schedule_status))}</td></tr>`)
    .join("");
  const paymentRows = (snapshot.payments || [])
    .map((row) => `<tr><td>${htmlEscape(row.receipt_number || row.payment_number)}</td><td>${htmlEscape(dateLabel(row.payment_date))}</td><td>${htmlEscape(label(row.payment_method))}</td><td>${htmlEscape(money(row.amount))}</td></tr>`)
    .join("");
  const context = snapshot.document_context || {};
  return Buffer.from(`<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(document.document_number)}</title><style>
    @page{size:A4;margin:15mm}body{font-family:Arial,sans-serif;color:#17251e;font-size:10pt;line-height:1.5}.brand{border-bottom:4px solid #d3a72c;padding-bottom:10px}.brand h1{color:#174f35;margin:0}.title{text-align:center;margin:22px 0}.copy{color:#8b6a12;font-weight:bold}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px}.box{background:#f2f7f4;padding:9px;border-radius:6px}h2,h3{color:#174f35}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #bdc9c1;padding:6px}th{background:#174f35;color:#fff}.footer{border-top:1px solid #bbb;margin-top:25px;padding-top:8px;font-size:8pt;color:#66736b}</style></head><body>
    <div class="brand"><h1>${htmlEscape(snapshot.company?.name || "CHALIN 03 COMPANY LIMITED")}</h1><div>${htmlEscape([snapshot.company?.phone,snapshot.company?.email,snapshot.company?.postal_address || snapshot.company?.address].filter(Boolean).join(" | "))}</div></div>
    <div class="title"><h2>${htmlEscape(definition?.title || label(document.document_type))}</h2><div class="copy">${htmlEscape(definition?.short_title || "Official Copy")}</div><div>${htmlEscape(document.document_number)} | Agreement ${htmlEscape(agreement.agreement_number)}</div></div>
    <div class="grid"><div class="box"><strong>Customer</strong><br>${htmlEscape(agreementName(snapshot))}</div><div class="box"><strong>Machine</strong><br>${htmlEscape(`${agreement.asset_code} - ${agreement.asset_name}`)}</div><div class="box"><strong>Purchase price</strong><br>${htmlEscape(money(agreement.total_amount))}</div><div class="box"><strong>Outstanding</strong><br>${htmlEscape(money(agreement.outstanding_balance))}</div></div>
    ${document.document_type === "payment_receipt" ? `<h3>Payment receipt</h3><p>Receipt: ${htmlEscape(context.payment?.receipt_number || context.payment?.payment_number)}<br>Date: ${htmlEscape(dateTimeLabel(context.payment?.payment_date))}<br>Amount: ${htmlEscape(money(context.payment?.amount))}<br>Method: ${htmlEscape(label(context.payment?.payment_method))}</p>` : ""}
    ${document.document_type === "arrears_notice" ? `<h3>Arrears notice</h3><p>Overdue amount: <strong>${htmlEscape(money(context.overdue?.amount))}</strong>. Contact Chalin 03 Company Limited immediately to regularise this account.</p>` : ""}
    ${document.document_type === "amendment_agreement" ? `<h3>Approved amendment</h3><p>${htmlEscape(context.amendment?.amendment_number)} - ${htmlEscape(context.amendment?.reason)}</p><pre>${htmlEscape(JSON.stringify(context.amendment?.proposed_changes || {}, null, 2))}</pre>` : ""}
    <h3>Installment schedule</h3><table><thead><tr><th>No.</th><th>Due date</th><th>Scheduled</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>${scheduleRows}</tbody></table>
    <h3>Payment history</h3><table><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th>Amount</th></tr></thead><tbody>${paymentRows}</tbody></table>
    ${LEGAL_TYPES.has(document.document_type) ? `<h3>Terms and signatures</h3><p>${htmlEscape(snapshot.policy?.agreement_terms || "")}</p>` : ""}
    <div class="footer">Immutable snapshot ${htmlEscape(document.snapshot_checksum)} | Issued ${htmlEscape(dateTimeLabel(document.issued_at || snapshot.generated_at))}</div>
  </body></html>`, "utf8");
}

async function getCompletionDocument(documentId) {
  const document = await getIssuedDocument(documentId);
  if (!DOCUMENT_DEFINITIONS[document.document_type]) {
    throw new ProfessionalFinanceError(400, "This legacy document is not part of the completion document pack.");
  }
  return document;
}

module.exports = {
  DOCUMENT_DEFINITIONS,
  getCompletionDocument,
  issueCompletionDocument,
  publicDefinitions,
  renderCompletionPdf,
  renderCompletionWord,
};
