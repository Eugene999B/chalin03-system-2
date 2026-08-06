const {
  COLORS,
  agreementOf,
  clean,
  customerName,
  dateLabel,
  dateTimeLabel,
  label,
  machineName,
  money,
} = require("./equipmentFinanceDocumentDesignV2Service");
const {
  addPage,
  ensureSpace,
  pageWidth,
  primaryMachineImage,
} = require("./equipmentFinancePdfV2PageService");
const {
  agreementSummaryCards,
  drawFactGrid,
  drawPaymentTable,
  drawScheduleTable,
  drawSummaryCards,
  drawTable,
  sectionTitle,
} = require("./equipmentFinancePdfV2BasicWidgetService");
const {
  drawSignatureBlocks,
  writeFlowText,
} = require("./equipmentFinancePdfV2FlowWidgetService");

function renderLegalAgreement(doc, document) {
  const agreement = agreementOf(document);
  const machineImage = primaryMachineImage(document);

  if (machineImage) {
    ensureSpace(doc, document, 180);
    const y = doc.y;
    const width = pageWidth(doc);
    doc.roundedRect(doc.page.margins.left, y, width, 165, 8).fillAndStroke(COLORS.paper, COLORS.line);
    try {
      doc.image(machineImage, doc.page.margins.left + 8, y + 8, {
        fit: [width - 16, 149], align: "center", valign: "center",
      });
    } catch {
      // Continue with the legal identity sections.
    }
    doc.y = y + 177;
  }

  sectionTitle(doc, document, "Parties and equipment identity");
  drawFactGrid(doc, document, [
    ["Buyer", customerName(document)],
    ["Buyer phone", agreement.kyc_customer_phone || agreement.customer_phone_snapshot],
    ["Residential / business address", agreement.residential_address || agreement.customer_address_snapshot],
    ["Official identification", `${clean(agreement.id_type, "ID")} — ${clean(agreement.id_number)}`],
    ["Equipment", machineName(document)],
    ["Make / model", `${clean(agreement.make, "")} ${clean(agreement.model, "")}`],
    ["Serial number", agreement.serial_number],
    ["Chassis number", agreement.chassis_number],
  ]);

  sectionTitle(doc, document, "Commercial terms");
  drawSummaryCards(doc, document, agreementSummaryCards(document));
  drawFactGrid(doc, document, [
    ["First due date", dateLabel(agreement.first_due_date)],
    ["Final due date", dateLabel(agreement.final_due_date)],
    ["Payment frequency", label(agreement.payment_frequency)],
    ["Number of payments", agreement.installment_count],
  ]);

  addPage(doc, document);
  sectionTitle(doc, document, "Official installment schedule");
  drawScheduleTable(doc, document, document.snapshot?.schedule || []);

  addPage(doc, document);
  sectionTitle(doc, document, `Terms and conditions — version ${clean(document.snapshot?.template_version, "1")}`);
  writeFlowText(
    doc,
    document,
    document.snapshot?.policy?.agreement_terms ||
      "No approved agreement terms were captured in this immutable snapshot.",
    { size: 8.4, lineGap: 2.1 }
  );
  drawSignatureBlocks(doc, document, [
    ["seller", "Authorised seller representative"],
    ["buyer", "Buyer"],
    ["buyer_witness", "Buyer witness"],
    ["guarantor", "Guarantor"],
  ]);
}

function renderExecutivePack(doc, document) {
  const agreement = agreementOf(document);
  sectionTitle(doc, document, "Executive decision dashboard");
  drawSummaryCards(doc, document, [
    ["KYC status", label(agreement.kyc_status)],
    ["Risk band", label(agreement.risk_band)],
    ["Affordability", label(agreement.affordability_status)],
    [
      "Reconciliation",
      document.snapshot?.reconciliation?.consistent ? "VERIFIED" : "REQUIRES REVIEW",
      document.snapshot?.reconciliation?.consistent ? COLORS.emerald : COLORS.red,
    ],
    ["Purchase price", money(agreement.total_amount)],
    ["Official balance", money(agreement.outstanding_balance)],
  ]);
  drawFactGrid(doc, document, [
    ["Applicant", customerName(document)],
    ["Equipment", machineName(document)],
    ["Agreement", agreement.agreement_number],
    ["Installment structure", `${agreement.installment_count || 0} ${label(agreement.payment_frequency)}`],
  ]);

  const image = primaryMachineImage(document);
  if (image) {
    sectionTitle(doc, document, "Exact approved equipment");
    ensureSpace(doc, document, 220);
    const y = doc.y;
    try {
      doc.image(image, doc.page.margins.left, y, {
        fit: [pageWidth(doc), 200], align: "center", valign: "center",
      });
    } catch {
      // Data summary remains authoritative.
    }
    doc.y = y + 210;
  }

  sectionTitle(doc, document, "Management schedule view");
  drawScheduleTable(doc, document, (document.snapshot?.schedule || []).slice(0, 12));
}

function renderReceipt(doc, document) {
  const agreement = agreementOf(document);
  const payment = document.snapshot?.document_context?.payment || {};
  const width = pageWidth(doc);
  ensureSpace(doc, document, 170);
  const y = doc.y;
  doc.roundedRect(doc.page.margins.left, y, width, 148, 12)
    .fillAndStroke(COLORS.emeraldSoft, COLORS.emerald);
  doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(7).text(
    "AMOUNT RECEIVED", doc.page.margins.left, y + 18,
    { width, align: "center", lineBreak: false }
  );
  doc.fillColor(COLORS.emeraldDark).font("Helvetica-Bold").fontSize(30).text(
    money(payment.amount), doc.page.margins.left, y + 38,
    { width, align: "center", lineBreak: false }
  );
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9).text(
    `Receipt ${clean(payment.receipt_number || payment.payment_number)}`,
    doc.page.margins.left, y + 83,
    { width, align: "center", lineBreak: false }
  );
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7.4).text(
    `${dateTimeLabel(payment.payment_date)}  •  ${label(payment.payment_method)}  •  ${clean(
      payment.reference_number,
      "No external reference"
    )}`,
    doc.page.margins.left, y + 103,
    { width, align: "center", lineBreak: false }
  );
  doc.fillColor(COLORS.emerald).font("Helvetica-Bold").fontSize(7.2).text(
    "PAYMENT RECEIVED AND COMMITTED TO THE RECONCILED FINANCE LEDGER",
    doc.page.margins.left, y + 126,
    { width, align: "center", lineBreak: false }
  );
  doc.y = y + 163;

  sectionTitle(doc, document, "Receipt details");
  drawFactGrid(doc, document, [
    ["Customer", customerName(document)],
    ["Agreement", agreement.agreement_number],
    ["Equipment", machineName(document)],
    ["Received by", payment.received_by_name || "Finance staff"],
    ["Official balance after payment", money(agreement.outstanding_balance)],
    ["Payment reference", payment.reference_number],
  ]);
  sectionTitle(doc, document, "Oldest-due-first allocation");
  drawTable(
    doc,
    document,
    [
      { title: "INSTALLMENT", units: 1 },
      { title: "DUE DATE", units: 1.4 },
      { title: "ALLOCATED", units: 1.4 },
    ],
    (document.snapshot?.document_context?.payment_allocations || []).map((row) => [
      row.sequence_number,
      dateLabel(row.due_date),
      money(row.allocated_amount),
    ])
  );
}

function renderSchedule(doc, document) {
  const agreement = agreementOf(document);
  sectionTitle(doc, document, "Account and plan summary");
  drawSummaryCards(doc, document, agreementSummaryCards(document));
  drawFactGrid(doc, document, [
    ["Customer", customerName(document)],
    ["Equipment", machineName(document)],
    ["First due date", dateLabel(agreement.first_due_date)],
    ["Final due date", dateLabel(agreement.final_due_date)],
  ]);
  sectionTitle(doc, document, "Exact dated installment plan");
  drawScheduleTable(doc, document, document.snapshot?.schedule || []);
}

function renderStatement(doc, document) {
  const agreement = agreementOf(document);
  const overdue = document.snapshot?.document_context?.overdue || {};
  sectionTitle(doc, document, "Statement position");
  drawSummaryCards(doc, document, [
    ["Purchase price", money(agreement.total_amount)],
    ["Total paid", money(agreement.amount_paid)],
    ["Official balance", money(agreement.outstanding_balance)],
    ["Overdue amount", money(overdue.amount), Number(overdue.amount || 0) > 0 ? COLORS.red : COLORS.emerald],
    ["Statement date", dateLabel(document.snapshot?.generated_at)],
    ["Reconciliation", document.snapshot?.reconciliation?.consistent ? "VERIFIED" : "MISMATCH"],
  ]);
  drawFactGrid(doc, document, [
    ["Customer", customerName(document)],
    ["Agreement", agreement.agreement_number],
    ["Equipment", machineName(document)],
    ["Payments recorded", document.snapshot?.payments?.length || 0],
  ]);
  sectionTitle(doc, document, "Payment history");
  drawPaymentTable(doc, document);
  sectionTitle(doc, document, "Remaining installment obligations");
  drawScheduleTable(
    doc,
    document,
    (document.snapshot?.schedule || []).filter((row) => Number(row.balance || 0) > 0.005)
  );
}

module.exports = {
  renderExecutivePack,
  renderLegalAgreement,
  renderReceipt,
  renderSchedule,
  renderStatement,
};
