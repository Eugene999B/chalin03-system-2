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
  templateFor,
} = require("./equipmentFinanceDocumentDesignV2Service");
const {
  ensureSpace,
  imageBuffer,
  pageWidth,
} = require("./equipmentFinancePdfV2PageService");
const {
  drawFactGrid,
  drawFactGridAt,
  drawScheduleTable,
  drawSummaryCards,
  sectionTitle,
} = require("./equipmentFinancePdfV2BasicWidgetService");
const {
  drawSignatureBlocks,
  writeFlowText,
} = require("./equipmentFinancePdfV2FlowWidgetService");

function renderMachineAnnexure(doc, document) {
  const agreement = agreementOf(document);
  sectionTitle(doc, document, "Protected machine identity");
  drawFactGrid(doc, document, [
    ["Equipment", machineName(document)],
    ["Make / model", `${clean(agreement.make, "")} ${clean(agreement.model, "")}`],
    ["Serial number", agreement.serial_number],
    ["Chassis number", agreement.chassis_number],
    ["Engine number", agreement.engine_number],
    ["Registration number", agreement.registration_number],
  ]);
  sectionTitle(doc, document, "Photographic evidence");
  const media = (document.snapshot?.media || [])
    .map((item) => ({ ...item, buffer: imageBuffer(item.file_url) }))
    .filter((item) => item.buffer);
  if (!media.length) {
    drawFactGrid(doc, document, [[
      "Evidence status",
      "No embedded machine photograph was available in this immutable snapshot.",
    ]], { columns: 1 });
    return;
  }
  media.slice(0, 10).forEach((item, index) => {
    ensureSpace(doc, document, 235);
    const y = doc.y;
    const width = pageWidth(doc);
    doc.roundedRect(doc.page.margins.left, y, width, 214, 8).fillAndStroke(COLORS.paper, COLORS.line);
    try {
      doc.image(item.buffer, doc.page.margins.left + 8, y + 8, {
        fit: [width - 16, 178], align: "center", valign: "center",
      });
    } catch {
      // Continue with the evidence caption.
    }
    doc.fillColor(COLORS.goldDark).font("Helvetica-Bold").fontSize(7).text(
      `${index + 1}. ${label(item.evidence_type, "Equipment evidence")}`,
      doc.page.margins.left + 10,
      y + 192,
      { width: width - 20, align: "center", lineBreak: false }
    );
    doc.y = y + 224;
  });
}

function renderGuarantor(doc, document) {
  const agreement = agreementOf(document);
  sectionTitle(doc, document, "Guarantor identity and obligation");
  drawFactGrid(doc, document, [
    ["Guarantor", agreement.guarantor_name],
    ["Phone", agreement.guarantor_phone],
    ["Official identification", agreement.guarantor_id_number],
    ["Relationship to buyer", agreement.guarantor_relationship],
    ["Buyer", customerName(document)],
    ["Agreement", agreement.agreement_number],
    ["Guaranteed balance", money(agreement.outstanding_balance)],
    ["Equipment", machineName(document)],
  ]);
  sectionTitle(doc, document, "Formal undertaking");
  writeFlowText(
    doc,
    document,
    `I, ${clean(agreement.guarantor_name)}, confirm that I understand the buyer's installment obligation to Chalin 03 Company Limited. I undertake to support the buyer's proper performance of the approved agreement and to cooperate with the Company where the account becomes overdue or otherwise requires controlled resolution. This undertaking forms part of the protected Finance case file and does not replace the main installment agreement.`,
    { size: 9, lineGap: 2.6 }
  );
  drawSignatureBlocks(doc, document, [
    ["guarantor", "Guarantor"],
    ["buyer", "Buyer"],
    ["seller", "Authorised company representative"],
  ]);
}

function renderHandover(doc, document) {
  const agreement = agreementOf(document);
  const delivery = document.snapshot?.document_context?.delivery || {};
  sectionTitle(doc, document, "Delivery identity");
  drawFactGrid(doc, document, [
    ["Customer / receiving person", delivery.receiving_person || customerName(document)],
    ["Agreement", agreement.agreement_number],
    ["Equipment", machineName(document)],
    ["Serial / chassis", agreement.serial_number || agreement.chassis_number],
    ["Destination", delivery.destination],
    ["Handover date", dateTimeLabel(delivery.delivered_at)],
  ]);
  sectionTitle(doc, document, "Condition and release checklist");
  drawFactGrid(doc, document, [
    ["Condition status", label(delivery.condition_status)],
    ["Meter reading", delivery.meter_reading],
    ["Fuel level", delivery.fuel_level_percent === undefined ? "Not recorded" : `${delivery.fuel_level_percent}%`],
    ["Tools / attachments", delivery.attachments_tools || delivery.notes],
  ]);
  writeFlowText(
    doc,
    document,
    "By signing below, the receiving person confirms physical receipt of the identified equipment in the recorded condition. This handover record does not itself transfer ownership and remains subject to the installment agreement and controlled ownership-transfer process.",
    { size: 8.8 }
  );
  drawSignatureBlocks(doc, document, [
    ["seller", "Company representative"],
    ["buyer", "Receiving customer"],
    ["buyer_witness", "Witness"],
  ]);
}

function renderArrears(doc, document) {
  const overdue = document.snapshot?.document_context?.overdue || {};
  sectionTitle(doc, document, "Overdue account position", { tone: "danger" });
  drawSummaryCards(doc, document, [
    ["Overdue amount", money(overdue.amount), COLORS.red],
    ["Overdue installments", overdue.count || 0, COLORS.red],
    ["Oldest unpaid due date", dateLabel(overdue.oldest_due_date)],
    ["Official balance", money(agreementOf(document).outstanding_balance)],
    ["Cure period", `${document.snapshot?.policy?.notice_cure_days || 14} day(s)`],
    ["Notice date", dateLabel(document.snapshot?.generated_at)],
  ]);
  writeFlowText(
    doc,
    document,
    `This is formal notice that the installment account is overdue. Contact Chalin 03 Company Limited immediately and settle the overdue amount or agree an authorised resolution within ${document.snapshot?.policy?.notice_cure_days || 14} day(s). This notice does not waive any right preserved by the signed agreement.`,
    { size: 9, color: COLORS.red, bold: true }
  );
  sectionTitle(doc, document, "Overdue schedule lines", { tone: "danger" });
  drawScheduleTable(doc, document, overdue.rows || []);
}

function renderAmendment(doc, document) {
  const amendment = document.snapshot?.document_context?.amendment || {};
  sectionTitle(doc, document, "Approved amendment identity");
  drawFactGrid(doc, document, [
    ["Amendment number", amendment.amendment_number],
    ["Status", label(amendment.amendment_status)],
    ["Amendment type", label(amendment.amendment_type)],
    ["Effective date", dateLabel(amendment.effective_date)],
    ["Requested by", amendment.requested_by_name || amendment.requested_by],
    ["Approved by", amendment.approved_by_name || amendment.approved_by],
  ]);
  sectionTitle(doc, document, "Reason for amendment");
  writeFlowText(doc, document, amendment.reason, { size: 8.8 });
  sectionTitle(doc, document, "Approved changes");
  writeFlowText(doc, document, JSON.stringify(amendment.proposed_changes || {}, null, 2), {
    font: "Courier", size: 7.2, align: "left", lineGap: 1.4,
  });
  drawSignatureBlocks(doc, document, [
    ["seller", "Authorised company representative"],
    ["buyer", "Buyer"],
    ["buyer_witness", "Witness"],
  ]);
}

function renderCertificate(doc, document) {
  const template = templateFor(document);
  const agreement = agreementOf(document);
  const transfer = document.snapshot?.document_context?.ownership_transfer || {};
  ensureSpace(doc, document, 420);
  const width = pageWidth(doc);
  const x = doc.page.margins.left;
  let y = doc.y + 12;

  doc.fillColor(COLORS.goldDark).font("Helvetica-Bold").fontSize(8).text(
    "CHALIN 03 COMPANY LIMITED HEREBY CERTIFIES",
    x, y,
    { width, align: "center", lineBreak: false }
  );
  y += 34;
  doc.fillColor(template.accent).font("Times-Bold").fontSize(27).text(
    document.document_type === "settlement_confirmation" ? "Full Settlement" : "Ownership Transfer",
    x, y,
    { width, align: "center", lineBreak: false }
  );
  y += 48;
  doc.fillColor(COLORS.ink).font("Helvetica").fontSize(10).text(
    document.document_type === "settlement_confirmation"
      ? "that the reconciled installment obligation described below has been fully settled."
      : "that the controlled ownership-transfer record authorises transfer of the equipment described below.",
    x + 40, y,
    { width: width - 80, align: "center", lineGap: 3 }
  );
  y += 62;
  doc.roundedRect(x + 35, y, width - 70, 150, 10).fillAndStroke(template.accentSoft, COLORS.gold);
  drawFactGridAt(doc, document, x + 50, y + 15, width - 100, [
    [document.document_type === "ownership_transfer" ? "New owner" : "Customer", customerName(document)],
    ["Agreement", agreement.agreement_number],
    ["Equipment", machineName(document)],
    ["Serial / chassis", agreement.serial_number || agreement.chassis_number],
    [
      document.document_type === "ownership_transfer" ? "Transfer number" : "Final payment date",
      document.document_type === "ownership_transfer"
        ? transfer.transfer_number || transfer.ownership_number
        : dateLabel(document.snapshot?.payments?.at(-1)?.payment_date),
    ],
    [
      document.document_type === "ownership_transfer" ? "Transfer date" : "Official balance",
      document.document_type === "ownership_transfer"
        ? dateTimeLabel(transfer.transferred_at)
        : money(agreement.outstanding_balance),
    ],
  ]);
  doc.y = y + 173;
  drawSignatureBlocks(doc, document, [
    ["seller", "Authorised company representative"],
    ["buyer", document.document_type === "ownership_transfer" ? "New owner" : "Customer"],
  ]);
}

module.exports = {
  renderAmendment,
  renderArrears,
  renderCertificate,
  renderGuarantor,
  renderHandover,
  renderMachineAnnexure,
};
