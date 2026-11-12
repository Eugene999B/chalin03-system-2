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
  drawSecuritySeal,
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
    ensureSpace(doc, document, 240);
    const y = doc.y;
    const width = pageWidth(doc);
    doc.roundedRect(doc.page.margins.left, y, width, 220, 12)
      .fillAndStroke(COLORS.forestDeep, COLORS.gold);
    doc.roundedRect(doc.page.margins.left + 8, y + 8, width - 16, 177, 8)
      .fill(COLORS.paper);
    try {
      doc.image(item.buffer, doc.page.margins.left + 10, y + 10, {
        fit: [width - 20, 173],
        align: "center",
        valign: "center",
      });
    } catch {
      // Evidence caption remains available.
    }
    doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(6.6).text(
      `${String(index + 1).padStart(2, "0")}  •  ${label(item.evidence_type, "Equipment evidence")}`,
      doc.page.margins.left + 12,
      y + 193,
      { width: width - 24, align: "center", lineBreak: false }
    );
    doc.y = y + 230;
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
    `I, ${clean(agreement.guarantor_name)}, confirm that I understand the buyer's installment obligation to Chalin 03 Company Limited. I undertake to support the buyer's proper performance of the approved agreement and to cooperate with the Company where the account becomes overdue or otherwise requires controlled resolution.\n\nThis undertaking forms part of the protected Finance case file and does not replace the main installment agreement.`,
    { size: 8.7, lineGap: 2.4 }
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
  drawSummaryCards(doc, document, [
    ["Condition", label(delivery.condition_status)],
    ["Meter reading", clean(delivery.meter_reading)],
    [
      "Fuel level",
      delivery.fuel_level_percent === undefined ? "Not recorded" : `${delivery.fuel_level_percent}%`,
    ],
  ]);
  drawFactGrid(doc, document, [[
    "Tools / attachments / notes",
    delivery.attachments_tools || delivery.notes,
  ]], { columns: 1 });
  writeFlowText(
    doc,
    document,
    "By signing below, the receiving person confirms physical receipt of the identified equipment in the recorded condition. This handover record does not itself transfer ownership and remains subject to the installment agreement and controlled ownership-transfer process.",
    { size: 8.7 }
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
    `This is formal notice that the installment account is overdue. Contact Chalin 03 Company Limited immediately and settle the overdue amount or agree an authorised resolution within ${document.snapshot?.policy?.notice_cure_days || 14} day(s).\n\nThis notice does not waive any right preserved by the signed agreement.`,
    { size: 8.8, color: COLORS.red, bold: true }
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
  writeFlowText(doc, document, amendment.reason, { size: 8.7 });
  sectionTitle(doc, document, "Approved changes");
  writeFlowText(doc, document, JSON.stringify(amendment.proposed_changes || {}, null, 2), {
    font: "Courier",
    size: 7,
    align: "left",
    lineGap: 1.3,
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
  const isSettlement = document.document_type === "settlement_confirmation";
  const width = pageWidth(doc);
  const x = doc.page.margins.left;
  ensureSpace(doc, document, 500);
  let y = doc.y + 8;

  doc.fillColor(COLORS.goldDark).font("Helvetica-Bold").fontSize(7).text(
    "CHALIN 03 COMPANY LIMITED HEREBY CERTIFIES",
    x,
    y,
    { width, align: "center", characterSpacing: 1.1, lineBreak: false }
  );
  y += 31;
  doc.fillColor(template.accent).font("Times-Bold").fontSize(isSettlement ? 29 : 25).text(
    isSettlement ? "Full Settlement" : "Ownership Transfer",
    x,
    y,
    { width, align: "center", lineBreak: false }
  );
  y += 44;
  doc.fillColor(COLORS.goldDark).font("Helvetica-Bold").fontSize(8).text(
    "C E R T I F I C A T E",
    x,
    y,
    { width, align: "center", lineBreak: false }
  );
  y += 34;
  doc.moveTo(x + 90, y).lineTo(x + width - 90, y)
    .lineWidth(1).strokeColor(COLORS.gold).stroke();
  y += 25;
  doc.fillColor(COLORS.ink).font("Helvetica").fontSize(9.3).text(
    isSettlement
      ? "The reconciled equipment installment obligation identified below has been paid in full, and the official account balance is zero."
      : "The controlled ownership-transfer record authorises transfer of the identified equipment to the person named below.",
    x + 48,
    y,
    { width: width - 96, align: "center", lineGap: 3 }
  );
  y += 76;

  const panelWidth = (width - 18) / 2;
  doc.roundedRect(x, y, panelWidth, 90, 11).fillAndStroke(COLORS.paper, COLORS.gold);
  doc.roundedRect(x + panelWidth + 18, y, panelWidth, 90, 11)
    .fillAndStroke(COLORS.paper, COLORS.gold);
  doc.roundedRect(x + 28, y - 10, panelWidth - 56, 21, 10).fill(template.accent);
  doc.roundedRect(x + panelWidth + 46, y - 10, panelWidth - 56, 21, 10).fill(template.accent);
  doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(6.1).text(
    isSettlement ? "CUSTOMER" : "NEW OWNER",
    x + 28,
    y - 3,
    { width: panelWidth - 56, align: "center", lineBreak: false }
  );
  doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(6.1).text(
    "EQUIPMENT",
    x + panelWidth + 46,
    y - 3,
    { width: panelWidth - 56, align: "center", lineBreak: false }
  );
  doc.fillColor(template.accent).font("Times-Bold").fontSize(11).text(
    customerName(document),
    x + 14,
    y + 28,
    { width: panelWidth - 28, align: "center", lineBreak: false, ellipsis: true }
  );
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(6.5).text(
    `Agreement ${clean(agreement.agreement_number)}`,
    x + 14,
    y + 54,
    { width: panelWidth - 28, align: "center", lineBreak: false }
  );
  doc.fillColor(template.accent).font("Times-Bold").fontSize(11).text(
    clean(agreement.asset_name, "Equipment"),
    x + panelWidth + 32,
    y + 28,
    { width: panelWidth - 28, align: "center", lineBreak: false, ellipsis: true }
  );
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(6.5).text(
    `${clean(agreement.asset_code, "")} • ${clean(agreement.serial_number || agreement.chassis_number)}`,
    x + panelWidth + 32,
    y + 54,
    { width: panelWidth - 28, align: "center", lineBreak: false, ellipsis: true }
  );
  y += 116;

  doc.roundedRect(x, y, width, 94, 11).fillAndStroke(template.accentSoft, COLORS.gold);
  drawFactGridAt(doc, document, x + 22, y + 16, width - 44, [
    [isSettlement ? "Settlement date" : "Transfer number", isSettlement
      ? dateLabel(document.snapshot?.payments?.at(-1)?.payment_date)
      : transfer.transfer_number || transfer.ownership_number],
    [isSettlement ? "Account status" : "Transfer date", isSettlement
      ? "FULLY SETTLED"
      : dateTimeLabel(transfer.transferred_at)],
    [isSettlement ? "Outstanding balance" : "Previous owner", isSettlement
      ? money(agreement.outstanding_balance)
      : clean(document.snapshot?.company?.name, "Chalin 03 Company Limited")],
    ["Document number", document.document_number],
  ]);
  y += 116;

  drawSecuritySeal(doc, document, x + 28, y, 92);
  doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8.3).text(
    isSettlement
      ? "This certificate confirms that there are no outstanding installment obligations on the reconciled account represented by this immutable document snapshot."
      : "This certificate records the controlled transfer of equipment title following the required settlement and ownership-release process.",
    x + 138,
    y + 10,
    { width: width - 276, align: "center", lineGap: 3 }
  );
  doc.fillColor(COLORS.goldDark).font("Times-Italic").fontSize(12).text(
    isSettlement ? "Thank you for your trust." : "Transferred under controlled authority.",
    x + 138,
    y + 62,
    { width: width - 276, align: "center", lineBreak: false }
  );
  drawSecuritySeal(doc, document, x + width - 120, y, 92);
  doc.y = y + 112;

  drawSignatureBlocks(doc, document, [
    ["seller", "Authorised company representative"],
    ["buyer", isSettlement ? "Customer" : "New owner"],
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
