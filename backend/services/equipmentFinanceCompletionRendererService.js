const PDFDocument = require("pdfkit");

const {
  DOCUMENT_DEFINITIONS,
} = require("./equipmentFinanceDocumentCompletionService");

const LEGAL_TYPES = new Set([
  "installment_agreement",
  "customer_agreement_copy",
  "company_agreement_copy",
  "guarantor_undertaking",
  "amendment_agreement",
  "ownership_transfer",
]);

function text(value, fallback = "Not recorded") {
  const cleaned = String(value ?? "").trim();
  return cleaned || fallback;
}

function label(value) {
  return text(value)
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
    month: "long",
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

function customerName(snapshot) {
  return text(
    snapshot.agreement?.kyc_customer_name ||
      snapshot.agreement?.customer_name_snapshot ||
      snapshot.agreement?.customer_name,
    "Customer"
  );
}

function primaryImage(snapshot) {
  const source =
    snapshot.media?.find((item) => item.evidence_type === "main")?.file_url ||
    snapshot.media?.find((item) => item.is_primary)?.file_url ||
    snapshot.agreement?.main_image_url;
  return dataImage(source);
}

function definition(document) {
  return (
    DOCUMENT_DEFINITIONS[document.document_type] || {
      title: label(document.document_type),
      short_title: label(document.document_type),
      formats: ["pdf", "word", "print"],
    }
  );
}

function pageWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function needsPage(doc, height) {
  return doc.y + height > doc.page.height - doc.page.margins.bottom - 26;
}

function brandHeader(doc, snapshot, document, compact = false) {
  const left = doc.page.margins.left;
  const width = pageWidth(doc);
  const start = doc.y;
  const markSize = compact ? 28 : 42;
  const markX = left;
  const markY = start;

  doc.save();
  doc.roundedRect(markX, markY, markSize, markSize, compact ? 5 : 8).fill("#d3a72c");
  doc.fillColor("#163523").font("Helvetica-Bold").fontSize(compact ? 9 : 13).text(
    "C03",
    markX,
    markY + (compact ? 9 : 13),
    { width: markSize, align: "center" }
  );
  doc.restore();

  const companyX = markX + markSize + (compact ? 7 : 12);
  const companyWidth = Math.max(60, width - markSize - (compact ? 7 : 12));
  doc.fillColor("#174f35").font("Helvetica-Bold").fontSize(compact ? 9 : 15).text(
    text(snapshot.company?.name, "CHALIN 03 COMPANY LIMITED"),
    companyX,
    markY + 1,
    { width: companyWidth }
  );
  doc.fillColor("#5e6b64").font("Helvetica").fontSize(compact ? 5.7 : 7.5).text(
    [
      snapshot.company?.phone,
      snapshot.company?.email,
      snapshot.company?.postal_address || snapshot.company?.address,
    ]
      .filter(Boolean)
      .join("  |  "),
    companyX,
    markY + (compact ? 15 : 22),
    { width: companyWidth }
  );

  const lineY = markY + markSize + (compact ? 4 : 7);
  doc.moveTo(left, lineY).lineTo(left + width, lineY).lineWidth(compact ? 1.5 : 3).strokeColor("#d3a72c").stroke();
  doc.y = lineY + (compact ? 6 : 11);
  doc.fillColor("#17251e").font("Helvetica-Bold").fontSize(compact ? 9 : 16).text(
    definition(document).title,
    { align: "center" }
  );
  doc.fillColor("#647169").font("Helvetica").fontSize(compact ? 5.5 : 7.5).text(
    `${definition(document).short_title}  |  ${document.document_number}  |  Agreement ${text(
      snapshot.agreement?.agreement_number
    )}`,
    { align: "center" }
  );
  doc.moveDown(compact ? 0.45 : 0.9);
}

function addPage(doc, snapshot, document) {
  doc.addPage();
  brandHeader(doc, snapshot, document, false);
}

function ensureSpace(doc, snapshot, document, height) {
  if (needsPage(doc, height)) addPage(doc, snapshot, document);
}

function section(doc, snapshot, document, title) {
  ensureSpace(doc, snapshot, document, 36);
  doc.moveDown(0.3).fillColor("#174f35").font("Helvetica-Bold").fontSize(10.5).text(title);
  const y = doc.y + 2;
  doc.moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .lineWidth(0.8)
    .strokeColor("#d3a72c")
    .stroke();
  doc.y = y + 7;
}

function facts(doc, snapshot, document, rows) {
  const left = doc.page.margins.left;
  const width = pageWidth(doc);
  const columnWidth = width / 2;
  for (const row of rows) {
    ensureSpace(doc, snapshot, document, 35);
    const y = doc.y;
    row.forEach((item, index) => {
      if (!item) return;
      const x = left + index * columnWidth;
      doc.fillColor("#708078").font("Helvetica").fontSize(6.8).text(text(item[0], ""), x, y, {
        width: columnWidth - 12,
      });
      doc.fillColor("#18261f").font("Helvetica-Bold").fontSize(8.4).text(text(item[1]), x, y + 10, {
        width: columnWidth - 12,
      });
    });
    doc.y = y + 29;
    doc.moveTo(left, doc.y - 4)
      .lineTo(left + width, doc.y - 4)
      .lineWidth(0.25)
      .strokeColor("#dfe6e2")
      .stroke();
  }
}

function table(doc, snapshot, document, columns, rows) {
  const left = doc.page.margins.left;
  const width = pageWidth(doc);
  const totalUnits = columns.reduce((sum, column) => sum + column.units, 0);
  const positions = [];
  let cursor = left;
  columns.forEach((column) => {
    const columnWidth = (width * column.units) / totalUnits;
    positions.push({ ...column, x: cursor, width: columnWidth });
    cursor += columnWidth;
  });

  function header() {
    ensureSpace(doc, snapshot, document, 34);
    const y = doc.y;
    doc.save().rect(left, y, width, 22).fill("#174f35").restore();
    positions.forEach((column) => {
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(6.6).text(
        column.title,
        column.x + 4,
        y + 7,
        { width: column.width - 8 }
      );
    });
    doc.y = y + 27;
  }

  header();
  rows.forEach((row, rowIndex) => {
    if (needsPage(doc, 26)) {
      addPage(doc, snapshot, document);
      header();
    }
    const y = doc.y;
    if (rowIndex % 2 === 1) {
      doc.save().rect(left, y - 2, width, 20).fill("#f4f7f5").restore();
    }
    positions.forEach((column, index) => {
      doc.fillColor("#26362e").font("Helvetica").fontSize(6.7).text(
        text(row[index], ""),
        column.x + 4,
        y + 2,
        { width: column.width - 8 }
      );
    });
    doc.y = y + 19;
    doc.moveTo(left, doc.y - 2)
      .lineTo(left + width, doc.y - 2)
      .lineWidth(0.2)
      .strokeColor("#d8e1dc")
      .stroke();
  });
}

function scheduleTable(doc, snapshot, document, rows = snapshot.schedule || []) {
  table(
    doc,
    snapshot,
    document,
    [
      { title: "No.", units: 0.55 },
      { title: "Due date", units: 1.35 },
      { title: "Scheduled", units: 1.5 },
      { title: "Paid", units: 1.35 },
      { title: "Balance", units: 1.45 },
      { title: "Status", units: 1.15 },
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

function paymentTable(doc, snapshot, document, rows = snapshot.payments || []) {
  table(
    doc,
    snapshot,
    document,
    [
      { title: "Receipt", units: 1.4 },
      { title: "Date", units: 1.25 },
      { title: "Method", units: 1.1 },
      { title: "Amount", units: 1.4 },
      { title: "Received by", units: 1.8 },
    ],
    rows.map((row) => [
      row.receipt_number || row.payment_number,
      dateLabel(row.payment_date),
      label(row.payment_method),
      money(row.amount),
      row.received_by_name || "Finance staff",
    ])
  );
}

function signatures(doc, snapshot, document, roles) {
  section(doc, snapshot, document, "Signatures");
  const left = doc.page.margins.left;
  const width = pageWidth(doc);
  const columnWidth = width / 2;
  roles.forEach(([role, title], index) => {
    if (index % 2 === 0) ensureSpace(doc, snapshot, document, 88);
    const rowY = index % 2 === 0 ? doc.y : doc.y - 80;
    const x = left + (index % 2) * columnWidth;
    const record = snapshot.signatures?.find((item) => item.signer_role === role);
    const fallback = role === "seller" ? snapshot.company?.authorised_seller_signature_data_url : null;
    const image = dataImage(record?.signature_data_url || fallback);
    doc.fillColor("#174f35").font("Helvetica-Bold").fontSize(8).text(title, x, rowY, {
      width: columnWidth - 15,
    });
    if (image) doc.image(image, x, rowY + 13, { fit: [145, 40] });
    doc.fillColor("#26362e").font("Helvetica").fontSize(7).text(
      `Name: ${text(
        record?.signer_name ||
          (role === "seller" ? snapshot.company?.authorised_seller_name : ""),
        ""
      )}`,
      x,
      rowY + 56,
      { width: columnWidth - 15 }
    );
    doc.moveTo(x, rowY + 73)
      .lineTo(x + columnWidth - 25, rowY + 73)
      .lineWidth(0.45)
      .strokeColor("#637169")
      .stroke();
    if (index % 2 === 1 || index === roles.length - 1) doc.y = rowY + 82;
  });
}

function commonSummary(doc, snapshot, document) {
  const agreement = snapshot.agreement || {};
  facts(doc, snapshot, document, [
    [["Customer", customerName(snapshot)], ["Agreement", agreement.agreement_number]],
    [["Machine", `${text(agreement.asset_code, "")} - ${text(agreement.asset_name, "")}`], ["Serial / chassis", agreement.serial_number || agreement.chassis_number]],
    [["Purchase price", money(agreement.total_amount)], ["Opening deposit", money(agreement.deposit_required || agreement.deposit_received)]],
    [["Amount paid", money(agreement.amount_paid)], ["Official balance", money(agreement.outstanding_balance)]],
  ]);
}

function agreementBody(doc, snapshot, document) {
  const agreement = snapshot.agreement || {};
  const image = primaryImage(snapshot);
  if (image) {
    ensureSpace(doc, snapshot, document, 178);
    const left = doc.page.margins.left;
    const width = pageWidth(doc);
    const y = doc.y;
    doc.save().roundedRect(left, y, width, 165, 7).strokeColor("#d8e1dc").stroke().restore();
    doc.image(image, left + 7, y + 7, { fit: [width - 14, 151], align: "center", valign: "center" });
    doc.y = y + 175;
  }
  section(doc, snapshot, document, "Buyer and machine details");
  facts(doc, snapshot, document, [
    [["Buyer", customerName(snapshot)], ["Phone", agreement.kyc_customer_phone || agreement.customer_phone_snapshot]],
    [["Address", agreement.residential_address || agreement.customer_address_snapshot], ["Ghana Card / ID", `${text(agreement.id_type, "")} ${text(agreement.id_number, "")}`]],
    [["Machine", `${text(agreement.asset_code, "")} - ${text(agreement.asset_name, "")}`], ["Make / model", `${text(agreement.make, "")} ${text(agreement.model, "")}`]],
    [["Serial number", agreement.serial_number], ["Chassis number", agreement.chassis_number]],
  ]);
  section(doc, snapshot, document, "Commercial terms");
  commonSummary(doc, snapshot, document);
  facts(doc, snapshot, document, [
    [["Payment pattern", label(agreement.payment_frequency)], ["Installment count", agreement.installment_count]],
    [["First due date", dateLabel(agreement.first_due_date)], ["Final due date", dateLabel(agreement.final_due_date)]],
  ]);
  addPage(doc, snapshot, document);
  section(doc, snapshot, document, "Official installment payment schedule");
  scheduleTable(doc, snapshot, document);
  addPage(doc, snapshot, document);
  section(doc, snapshot, document, `Terms and conditions - version ${text(snapshot.template_version, "1")}`);
  doc.fillColor("#26362e").font("Helvetica").fontSize(8.4).text(
    text(snapshot.policy?.agreement_terms, "No approved terms were included in this snapshot."),
    { align: "justify", lineGap: 2 }
  );
  signatures(doc, snapshot, document, [
    ["seller", "Seller's Representative"],
    ["buyer", "Buyer"],
    ["buyer_witness", "Witness"],
    ["guarantor", "Guarantor"],
  ]);
}

function receiptBody(doc, snapshot, document, thermal) {
  const agreement = snapshot.agreement || {};
  const payment = snapshot.document_context?.payment || {};
  if (thermal) {
    doc.fillColor("#17251e").font("Helvetica-Bold").fontSize(9).text(document.document_number, {
      align: "center",
    });
    doc.moveDown(0.45);
    [
      ["Customer", customerName(snapshot)],
      ["Agreement", agreement.agreement_number],
      ["Machine", `${text(agreement.asset_code, "")} ${text(agreement.asset_name, "")}`],
      ["Payment date", dateTimeLabel(payment.payment_date)],
      ["Method", label(payment.payment_method)],
      ["Reference", payment.reference_number || "-"],
      ["Amount received", money(payment.amount)],
      ["Official balance", money(agreement.outstanding_balance)],
    ].forEach(([name, value]) => {
      doc.fillColor("#17251e").font("Helvetica-Bold").fontSize(6.9).text(`${name}: `, {
        continued: true,
      });
      doc.font("Helvetica").text(text(value, ""));
    });
    doc.moveDown(0.5).font("Helvetica-Bold").text("ALLOCATION", { align: "center" });
    (snapshot.document_context?.payment_allocations || []).forEach((row) => {
      doc.font("Helvetica").text(
        `Installment ${row.sequence_number}: ${money(row.allocated_amount)}`
      );
    });
    doc.moveDown().font("Helvetica-Bold").text("PAYMENT RECEIVED WITH THANKS", { align: "center" });
    return;
  }
  section(doc, snapshot, document, "Payment confirmation");
  facts(doc, snapshot, document, [
    [["Customer", customerName(snapshot)], ["Agreement", agreement.agreement_number]],
    [["Receipt", payment.receipt_number || payment.payment_number], ["Payment date", dateTimeLabel(payment.payment_date)]],
    [["Method", label(payment.payment_method)], ["Reference", payment.reference_number]],
    [["Amount received", money(payment.amount)], ["Official balance", money(agreement.outstanding_balance)]],
    [["Received by", payment.received_by_name || "Finance staff"], ["Machine", `${text(agreement.asset_code, "")} - ${text(agreement.asset_name, "")}`]],
  ]);
  section(doc, snapshot, document, "Oldest-due-first allocation");
  table(
    doc,
    snapshot,
    document,
    [
      { title: "Installment", units: 1 },
      { title: "Due date", units: 1.4 },
      { title: "Allocated", units: 1.4 },
    ],
    (snapshot.document_context?.payment_allocations || []).map((row) => [
      row.sequence_number,
      dateLabel(row.due_date),
      money(row.allocated_amount),
    ])
  );
  doc.moveDown(1.2).fillColor("#174f35").font("Helvetica-Bold").fontSize(11).text(
    "Payment received with thanks.",
    { align: "center" }
  );
}

function specialBody(doc, snapshot, document) {
  const type = document.document_type;
  const agreement = snapshot.agreement || {};
  const context = snapshot.document_context || {};

  if (["installment_agreement", "customer_agreement_copy", "company_agreement_copy"].includes(type)) {
    agreementBody(doc, snapshot, document);
    return;
  }
  if (type === "payment_receipt") {
    receiptBody(doc, snapshot, document, false);
    return;
  }
  if (type === "payment_schedule") {
    section(doc, snapshot, document, "Agreement summary");
    commonSummary(doc, snapshot, document);
    section(doc, snapshot, document, "Official installment schedule");
    scheduleTable(doc, snapshot, document);
    return;
  }
  if (type === "customer_statement") {
    section(doc, snapshot, document, "Customer account summary");
    commonSummary(doc, snapshot, document);
    facts(doc, snapshot, document, [
      [["Statement date", dateLabel(snapshot.generated_at)], ["Overdue amount", money(context.overdue?.amount)]],
    ]);
    section(doc, snapshot, document, "Payment history");
    paymentTable(doc, snapshot, document);
    section(doc, snapshot, document, "Remaining schedule");
    scheduleTable(
      doc,
      snapshot,
      document,
      (snapshot.schedule || []).filter((row) => Number(row.balance || 0) > 0.01)
    );
    return;
  }
  if (type === "boss_approval_pack") {
    section(doc, snapshot, document, "Executive approval summary");
    commonSummary(doc, snapshot, document);
    facts(doc, snapshot, document, [
      [["KYC status", label(agreement.kyc_status)], ["Risk band", label(agreement.risk_band)]],
      [["Affordability", label(agreement.affordability_status)], ["Reconciliation", snapshot.reconciliation?.consistent ? "Verified" : "Mismatch"]],
    ]);
    const image = primaryImage(snapshot);
    if (image) {
      section(doc, snapshot, document, "Exact approved machine");
      ensureSpace(doc, snapshot, document, 215);
      const left = doc.page.margins.left;
      doc.image(image, left, doc.y, { fit: [pageWidth(doc), 195], align: "center", valign: "center" });
      doc.y += 205;
    }
    section(doc, snapshot, document, "Schedule summary");
    scheduleTable(doc, snapshot, document, (snapshot.schedule || []).slice(0, 12));
    return;
  }
  if (type === "machine_annexure") {
    section(doc, snapshot, document, "Machine identity");
    facts(doc, snapshot, document, [
      [["Equipment", `${text(agreement.asset_code, "")} - ${text(agreement.asset_name, "")}`], ["Make / model", `${text(agreement.make, "")} ${text(agreement.model, "")}`]],
      [["Serial", agreement.serial_number], ["Chassis", agreement.chassis_number]],
      [["Engine", agreement.engine_number], ["Registration", agreement.registration_number]],
    ]);
    section(doc, snapshot, document, "Protected machine photographs");
    (snapshot.media || []).slice(0, 10).forEach((item, index) => {
      const image = dataImage(item.file_url);
      if (!image) return;
      ensureSpace(doc, snapshot, document, 170);
      const left = doc.page.margins.left;
      const y = doc.y;
      doc.image(image, left, y, { fit: [pageWidth(doc), 145], align: "center", valign: "center" });
      doc.y = y + 150;
      doc.fillColor("#657169").font("Helvetica").fontSize(7).text(
        `${index + 1}. ${label(item.evidence_type)}`,
        { align: "center" }
      );
      doc.moveDown(0.5);
    });
    return;
  }
  if (type === "guarantor_undertaking") {
    section(doc, snapshot, document, "Guarantor undertaking");
    facts(doc, snapshot, document, [
      [["Guarantor", agreement.guarantor_name], ["Phone", agreement.guarantor_phone]],
      [["Guarantor ID", agreement.guarantor_id_number], ["Relationship", agreement.guarantor_relationship]],
      [["Buyer", customerName(snapshot)], ["Agreement", agreement.agreement_number]],
      [["Guaranteed balance", money(agreement.outstanding_balance)], ["Machine", `${text(agreement.asset_code, "")} - ${text(agreement.asset_name, "")}`]],
    ]);
    doc.moveDown().fillColor("#26362e").font("Helvetica").fontSize(8.7).text(
      `I, ${text(agreement.guarantor_name)}, confirm that I have reviewed the installment obligation and undertake to support the buyer's performance under the approved agreement. This undertaking forms part of the protected Finance case file and does not replace the main agreement terms.`,
      { align: "justify", lineGap: 3 }
    );
    signatures(doc, snapshot, document, [
      ["guarantor", "Guarantor"],
      ["buyer", "Buyer"],
      ["seller", "Seller's Representative"],
    ]);
    return;
  }
  if (type === "arrears_notice") {
    section(doc, snapshot, document, "Notice of overdue installment payments");
    commonSummary(doc, snapshot, document);
    facts(doc, snapshot, document, [
      [["Overdue amount", money(context.overdue?.amount)], ["Overdue installments", context.overdue?.count]],
      [["Oldest unpaid date", dateLabel(context.overdue?.oldest_due_date)], ["Cure period", `${snapshot.policy?.notice_cure_days || 14} day(s)`]],
    ]);
    doc.moveDown().fillColor("#26362e").font("Helvetica").fontSize(8.7).text(
      `This is formal notice that the installment account is overdue. Please contact Chalin 03 Company Limited immediately and settle the overdue amount or agree a controlled resolution within ${snapshot.policy?.notice_cure_days || 14} day(s). This notice does not waive any right preserved by the signed agreement.`,
      { align: "justify", lineGap: 3 }
    );
    section(doc, snapshot, document, "Overdue schedule lines");
    scheduleTable(doc, snapshot, document, context.overdue?.rows || []);
    return;
  }
  if (type === "amendment_agreement") {
    const amendment = context.amendment || {};
    section(doc, snapshot, document, "Approved numbered amendment");
    facts(doc, snapshot, document, [
      [["Amendment number", amendment.amendment_number], ["Status", label(amendment.amendment_status)]],
      [["Type", label(amendment.amendment_type)], ["Effective date", dateLabel(amendment.effective_date)]],
      [["Requested by", amendment.requested_by_name || amendment.requested_by], ["Approved by", amendment.approved_by_name || amendment.approved_by]],
    ]);
    doc.moveDown().font("Helvetica-Bold").fontSize(8.5).text("Reason");
    doc.font("Helvetica").text(text(amendment.reason));
    doc.moveDown().font("Helvetica-Bold").text("Approved changes");
    doc.font("Courier").fontSize(7.2).text(JSON.stringify(amendment.proposed_changes || {}, null, 2));
    signatures(doc, snapshot, document, [
      ["seller", "Seller's Representative"],
      ["buyer", "Buyer"],
      ["buyer_witness", "Witness"],
    ]);
    return;
  }
  if (type === "delivery_handover_note") {
    const delivery = context.delivery || {};
    section(doc, snapshot, document, "Excavator delivery and handover");
    facts(doc, snapshot, document, [
      [["Customer", customerName(snapshot)], ["Agreement", agreement.agreement_number]],
      [["Machine", `${text(agreement.asset_code, "")} - ${text(agreement.asset_name, "")}`], ["Serial", agreement.serial_number]],
      [["Receiving person", delivery.receiving_person], ["Destination", delivery.destination]],
      [["Condition", label(delivery.condition_status)], ["Meter reading", delivery.meter_reading]],
      [["Fuel level", delivery.fuel_level_percent === undefined ? "Not recorded" : `${delivery.fuel_level_percent}%`], ["Handover date", dateTimeLabel(delivery.delivered_at)]],
    ]);
    doc.moveDown().font("Helvetica-Bold").fontSize(8.5).text("Attachments, tools and notes");
    doc.font("Helvetica").text(
      text(delivery.attachments_tools || delivery.notes, "To be completed at physical handover."),
      { lineGap: 2 }
    );
    signatures(doc, snapshot, document, [
      ["seller", "Company Representative"],
      ["buyer", "Receiving Customer"],
      ["buyer_witness", "Witness"],
    ]);
    return;
  }
  if (type === "settlement_confirmation") {
    section(doc, snapshot, document, "Full settlement confirmation");
    commonSummary(doc, snapshot, document);
    facts(doc, snapshot, document, [
      [["Final payment date", dateLabel(snapshot.payments?.at(-1)?.payment_date)], ["Confirmation date", dateLabel(snapshot.generated_at)]],
    ]);
    doc.moveDown(1.2).fillColor("#174f35").font("Helvetica-Bold").fontSize(11.5).text(
      "The installment obligation has been fully settled according to the reconciled Finance ledger.",
      { align: "center", lineGap: 3 }
    );
    signatures(doc, snapshot, document, [
      ["seller", "Company Representative"],
      ["buyer", "Customer"],
    ]);
    return;
  }
  if (type === "ownership_transfer") {
    const transfer = context.ownership_transfer || {};
    section(doc, snapshot, document, "Equipment ownership transfer certificate");
    facts(doc, snapshot, document, [
      [["New owner", customerName(snapshot)], ["Agreement", agreement.agreement_number]],
      [["Machine", `${text(agreement.asset_code, "")} - ${text(agreement.asset_name, "")}`], ["Serial", agreement.serial_number]],
      [["Chassis", agreement.chassis_number], ["Registration", agreement.registration_number]],
      [["Transfer number", transfer.transfer_number || transfer.ownership_number], ["Transfer date", dateTimeLabel(transfer.transferred_at)]],
    ]);
    doc.moveDown().fillColor("#26362e").font("Helvetica").fontSize(8.7).text(
      `Chalin 03 Company Limited confirms that the reconciled installment balance is fully settled and the controlled ownership-transfer record authorises transfer of the machine identified above to ${customerName(snapshot)}.`,
      { align: "justify", lineGap: 3 }
    );
    signatures(doc, snapshot, document, [
      ["seller", "Authorised Company Representative"],
      ["buyer", "New Owner"],
      ["buyer_witness", "Witness"],
    ]);
    return;
  }
  agreementBody(doc, snapshot, document);
}

function footer(doc, document, compact) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const left = doc.page.margins.left;
    const width = pageWidth(doc);
    doc.fillColor("#68746e").font("Helvetica").fontSize(compact ? 4.8 : 6.2).text(
      `CHALIN 03 COMPANY LIMITED | ${document.document_number} | Snapshot ${String(
        document.snapshot_checksum || ""
      ).slice(0, 16)} | Page ${index + 1} of ${range.count}`,
      left,
      doc.page.height - doc.page.margins.bottom + (compact ? 4 : 8),
      { width, align: "center", lineBreak: false }
    );
  }
}

async function renderCompletionPdf(document, { layout = "a4" } = {}) {
  const snapshot = document.snapshot;
  const compact = layout === "thermal" && document.document_type === "payment_receipt";
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: compact ? [226.77, 680] : "A4",
      margins: compact
        ? { top: 13, bottom: 22, left: 12, right: 12 }
        : { top: 36, bottom: 48, left: 43, right: 43 },
      bufferPages: true,
      info: {
        Title: definition(document).title,
        Author: text(snapshot.company?.name, "Chalin 03 Company Limited"),
        Subject: document.document_number,
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      brandHeader(doc, snapshot, document, compact);
      if (compact) receiptBody(doc, snapshot, document, true);
      else specialBody(doc, snapshot, document);
      footer(doc, document, compact);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function renderCompletionWord(document) {
  const snapshot = document.snapshot;
  const agreement = snapshot.agreement || {};
  const context = snapshot.document_context || {};
  const documentDefinition = definition(document);
  const scheduleRows = (snapshot.schedule || [])
    .map(
      (row) => `<tr><td>${escapeHtml(row.sequence_number)}</td><td>${escapeHtml(
        dateLabel(row.due_date)
      )}</td><td>${escapeHtml(money(row.scheduled_amount))}</td><td>${escapeHtml(
        money(row.amount_paid)
      )}</td><td>${escapeHtml(money(row.balance))}</td><td>${escapeHtml(
        label(row.schedule_status)
      )}</td></tr>`
    )
    .join("");
  const paymentRows = (snapshot.payments || [])
    .map(
      (row) => `<tr><td>${escapeHtml(row.receipt_number || row.payment_number)}</td><td>${escapeHtml(
        dateLabel(row.payment_date)
      )}</td><td>${escapeHtml(label(row.payment_method))}</td><td>${escapeHtml(
        money(row.amount)
      )}</td></tr>`
    )
    .join("");
  return Buffer.from(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
      document.document_number
    )}</title><style>@page{size:A4;margin:15mm}body{font-family:Arial,sans-serif;color:#17251e;font-size:10pt;line-height:1.5}.brand{border-bottom:4px solid #d3a72c;padding:10px 0}.brand h1{color:#174f35;margin:0}.title{text-align:center;margin:22px 0}.copy{color:#806218;font-weight:bold}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 18px}.box{background:#f1f6f3;padding:9px}h2,h3{color:#174f35}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #bdc9c1;padding:6px}th{background:#174f35;color:#fff}.footer{border-top:1px solid #bbb;margin-top:25px;padding-top:8px;font-size:8pt;color:#66736b}</style></head><body><div class="brand"><h1>${escapeHtml(
      snapshot.company?.name || "CHALIN 03 COMPANY LIMITED"
    )}</h1><div>${escapeHtml(
      [
        snapshot.company?.phone,
        snapshot.company?.email,
        snapshot.company?.postal_address || snapshot.company?.address,
      ]
        .filter(Boolean)
        .join(" | ")
    )}</div></div><div class="title"><h2>${escapeHtml(
      documentDefinition.title
    )}</h2><div class="copy">${escapeHtml(
      documentDefinition.short_title
    )}</div><div>${escapeHtml(document.document_number)} | Agreement ${escapeHtml(
      agreement.agreement_number
    )}</div></div><div class="grid"><div class="box"><strong>Customer</strong><br>${escapeHtml(
      customerName(snapshot)
    )}</div><div class="box"><strong>Machine</strong><br>${escapeHtml(
      `${text(agreement.asset_code, "")} - ${text(agreement.asset_name, "")}`
    )}</div><div class="box"><strong>Purchase price</strong><br>${escapeHtml(
      money(agreement.total_amount)
    )}</div><div class="box"><strong>Official balance</strong><br>${escapeHtml(
      money(agreement.outstanding_balance)
    )}</div></div>${
      document.document_type === "payment_receipt"
        ? `<h3>Exact payment receipt</h3><p>Receipt: ${escapeHtml(
            context.payment?.receipt_number || context.payment?.payment_number
          )}<br>Date: ${escapeHtml(dateTimeLabel(context.payment?.payment_date))}<br>Amount: ${escapeHtml(
            money(context.payment?.amount)
          )}<br>Method: ${escapeHtml(label(context.payment?.payment_method))}</p>`
        : ""
    }${
      document.document_type === "arrears_notice"
        ? `<h3>Arrears notice</h3><p>Overdue amount: <strong>${escapeHtml(
            money(context.overdue?.amount)
          )}</strong>. Contact Chalin 03 Company Limited immediately to regularise this account.</p>`
        : ""
    }${
      document.document_type === "amendment_agreement"
        ? `<h3>Approved amendment</h3><p>${escapeHtml(
            context.amendment?.amendment_number
          )} - ${escapeHtml(context.amendment?.reason)}</p><pre>${escapeHtml(
            JSON.stringify(context.amendment?.proposed_changes || {}, null, 2)
          )}</pre>`
        : ""
    }<h3>Installment schedule</h3><table><thead><tr><th>No.</th><th>Due date</th><th>Scheduled</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>${scheduleRows}</tbody></table><h3>Payment history</h3><table><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th>Amount</th></tr></thead><tbody>${paymentRows}</tbody></table>${
      LEGAL_TYPES.has(document.document_type)
        ? `<h3>Terms and signatures</h3><p>${escapeHtml(
            snapshot.policy?.agreement_terms || ""
          )}</p>`
        : ""
    }<div class="footer">Immutable snapshot ${escapeHtml(
      document.snapshot_checksum
    )} | Issued ${escapeHtml(
      dateTimeLabel(document.issued_at || snapshot.generated_at)
    )}</div></body></html>`,
    "utf8"
  );
}

module.exports = {
  renderCompletionPdf,
  renderCompletionWord,
};
