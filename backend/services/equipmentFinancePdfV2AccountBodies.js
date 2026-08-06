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
  drawSecuritySeal,
  drawSignatureBlocks,
  writeFlowText,
} = require("./equipmentFinancePdfV2FlowWidgetService");

function drawPartyCard(doc, document, x, y, width, heading, name, detail, opposite = false) {
  const template = templateFor(document);
  doc.roundedRect(x, y, width, 78, 9).fillAndStroke(COLORS.paper, COLORS.line);
  doc.roundedRect(x, y, width, 22, 9).fill(opposite ? COLORS.goldDark : template.accent);
  doc.rect(x, y + 11, width, 11).fill(opposite ? COLORS.goldDark : template.accent);
  doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(6).text(
    heading.toUpperCase(), x + 10, y + 8,
    { width: width - 20, align: "center", lineBreak: false }
  );
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9).text(
    clean(name), x + 12, y + 32,
    { width: width - 24, align: "center", lineBreak: false, ellipsis: true }
  );
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(6.5).text(
    clean(detail), x + 12, y + 52,
    { width: width - 24, align: "center", lineGap: 1.2 }
  );
}

function drawStatusRibbon(doc, document, items) {
  const template = templateFor(document);
  const width = pageWidth(doc);
  const x = doc.page.margins.left;
  const cellWidth = width / items.length;
  ensureSpace(doc, document, 52);
  const y = doc.y;
  doc.roundedRect(x, y, width, 43, 8).fillAndStroke(COLORS.paper, COLORS.line);
  items.forEach(([name, value], index) => {
    const cellX = x + cellWidth * index;
    if (index) {
      doc.moveTo(cellX, y + 8).lineTo(cellX, y + 35)
        .lineWidth(0.4).strokeColor(COLORS.line).stroke();
    }
    doc.circle(cellX + 17, y + 21, 8).fill(index % 2 ? COLORS.gold : template.accent);
    doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(5.4).text(
      String(name).toUpperCase(), cellX + 31, y + 10,
      { width: cellWidth - 38, lineBreak: false, ellipsis: true }
    );
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(6.8).text(
      clean(value), cellX + 31, y + 24,
      { width: cellWidth - 38, lineBreak: false, ellipsis: true }
    );
  });
  doc.y = y + 53;
}

function renderLegalAgreement(doc, document) {
  const agreement = agreementOf(document);
  const template = templateFor(document);
  const machineImage = primaryMachineImage(document);
  const left = doc.page.margins.left;
  const width = pageWidth(doc);
  const gap = 12;
  const imageWidth = width * 0.39;
  const detailWidth = width - imageWidth - gap;

  ensureSpace(doc, document, 202);
  const heroY = doc.y;
  doc.roundedRect(left, heroY, imageWidth, 186, 12)
    .fillAndStroke(COLORS.forestDeep, COLORS.gold);
  if (machineImage) {
    try {
      doc.roundedRect(left + 8, heroY + 8, imageWidth - 16, 112, 8).fill(COLORS.paper);
      doc.image(machineImage, left + 10, heroY + 10, {
        fit: [imageWidth - 20, 108], align: "center", valign: "center",
      });
    } catch {
      // Machine identity text remains available.
    }
  }
  doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(6).text(
    "EQUIPMENT UNDER AGREEMENT",
    left + 10, heroY + 129,
    { width: imageWidth - 20, align: "center", lineBreak: false }
  );
  doc.fillColor(COLORS.paper).font("Helvetica-Bold").fontSize(10).text(
    clean(agreement.asset_name, "Equipment"),
    left + 10, heroY + 144,
    { width: imageWidth - 20, align: "center", lineBreak: false, ellipsis: true }
  );
  doc.fillColor("#C7D9D0").font("Helvetica").fontSize(6.2).text(
    `${clean(agreement.asset_code, "")} • ${clean(agreement.make, "")} ${clean(agreement.model, "")}\nSerial: ${clean(agreement.serial_number || agreement.chassis_number)}`,
    left + 10, heroY + 161,
    { width: imageWidth - 20, align: "center", lineGap: 1.5 }
  );

  const detailX = left + imageWidth + gap;
  doc.roundedRect(detailX, heroY, detailWidth, 186, 12)
    .fillAndStroke(COLORS.paper, COLORS.line);
  doc.rect(detailX, heroY, detailWidth, 5).fill(template.accent);
  doc.fillColor(template.accent).font("Times-Bold").fontSize(13).text(
    "AGREEMENT AT A GLANCE",
    detailX + 14, heroY + 14,
    { width: detailWidth - 28, lineBreak: false }
  );
  const facts = [
    ["Buyer", customerName(document)],
    ["Purchase price", money(agreement.total_amount)],
    ["Opening deposit", money(agreement.deposit_required || agreement.deposit_received)],
    ["Financed amount", money(agreement.financed_amount)],
    ["Payment plan", `${agreement.installment_count || 0} ${label(agreement.payment_frequency)}`],
    [
      "Periodic payment",
      money(
        agreement.periodic_amount ||
          agreement.installment_amount ||
          document.snapshot?.schedule?.[0]?.scheduled_amount
      ),
    ],
  ];
  facts.forEach(([name, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const cellWidth = (detailWidth - 38) / 2;
    const x = detailX + 14 + column * (cellWidth + 10);
    const y = heroY + 48 + row * 42;
    doc.circle(x + 6, y + 7, 4).fill(column ? COLORS.gold : template.accent);
    doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(5.2).text(
      name.toUpperCase(), x + 16, y,
      { width: cellWidth - 16, lineBreak: false, ellipsis: true }
    );
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(7.3).text(
      clean(value), x + 16, y + 13,
      { width: cellWidth - 16, lineGap: 1, ellipsis: true }
    );
  });
  doc.y = heroY + 198;

  sectionTitle(doc, document, "The contracting parties");
  ensureSpace(doc, document, 88);
  const partyY = doc.y;
  const partyWidth = (width - 18) / 2;
  drawPartyCard(
    doc, document, left, partyY, partyWidth,
    "Seller / Financier",
    clean(document.snapshot?.company?.name, "CHALIN 03 COMPANY LIMITED"),
    "Provides the equipment and approved installment financing."
  );
  drawPartyCard(
    doc, document, left + partyWidth + 18, partyY, partyWidth,
    "Buyer / Customer",
    customerName(document),
    "Accepts the equipment and agrees to the approved payment obligations.",
    true
  );
  doc.fillColor(COLORS.goldDark).font("Times-Bold").fontSize(9).text(
    "AND", left + partyWidth - 4, partyY + 34,
    { width: 26, align: "center", lineBreak: false }
  );
  doc.y = partyY + 90;

  drawStatusRibbon(doc, document, [
    ["KYC", label(agreement.kyc_status, "Complete")],
    ["Affordability", label(agreement.affordability_status, "Reviewed")],
    ["First due", dateLabel(agreement.first_due_date)],
    ["Final due", dateLabel(agreement.final_due_date)],
  ]);

  sectionTitle(doc, document, "Commercial terms");
  drawSummaryCards(doc, document, agreementSummaryCards(document));

  addPage(doc, document);
  sectionTitle(doc, document, "Official installment schedule");
  drawScheduleTable(doc, document, document.snapshot?.schedule || []);

  addPage(doc, document);
  sectionTitle(
    doc,
    document,
    `Approved terms and conditions • Version ${clean(document.snapshot?.template_version, "1")}`
  );
  writeFlowText(
    doc,
    document,
    document.snapshot?.policy?.agreement_terms ||
      "No approved agreement terms were captured in this immutable snapshot.",
    { size: 8.2, lineGap: 2 }
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
  const image = primaryMachineImage(document);
  sectionTitle(doc, document, "Executive decision dashboard");
  drawSummaryCards(doc, document, [
    ["KYC status", label(agreement.kyc_status)],
    ["Risk band", label(agreement.risk_band)],
    ["Affordability", label(agreement.affordability_status)],
    [
      "Reconciliation",
      document.snapshot?.reconciliation?.consistent ? "VERIFIED" : "REQUIRES REVIEW",
      document.snapshot?.reconciliation?.consistent ? COLORS.forest : COLORS.red,
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

  if (image) {
    sectionTitle(doc, document, "Exact approved equipment");
    ensureSpace(doc, document, 190);
    const y = doc.y;
    const width = pageWidth(doc);
    doc.roundedRect(doc.page.margins.left, y, width, 174, 10)
      .fillAndStroke(COLORS.forestDeep, COLORS.gold);
    try {
      doc.image(image, doc.page.margins.left + 8, y + 8, {
        fit: [width - 16, 132], align: "center", valign: "center",
      });
    } catch {
      // Summary remains authoritative.
    }
    doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(6.5).text(
      `${machineName(document)} • ${clean(agreement.serial_number || agreement.chassis_number)}`,
      doc.page.margins.left + 10, y + 149,
      { width: width - 20, align: "center", lineBreak: false }
    );
    doc.y = y + 184;
  }

  sectionTitle(doc, document, "Management schedule view");
  drawScheduleTable(doc, document, (document.snapshot?.schedule || []).slice(0, 12));
}

function renderReceipt(doc, document) {
  const agreement = agreementOf(document);
  const payment = document.snapshot?.document_context?.payment || {};
  const template = templateFor(document);
  const width = pageWidth(doc);
  const left = doc.page.margins.left;
  const gap = 12;
  const heroWidth = width * 0.46;
  const detailsWidth = width - heroWidth - gap;
  ensureSpace(doc, document, 196);
  const y = doc.y;

  doc.roundedRect(left, y, heroWidth, 180, 13).fill(COLORS.forestDeep);
  doc.rect(left, y, heroWidth, 5).fill(COLORS.gold);
  doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(7.2).text(
    "AMOUNT PAID", left + 14, y + 20,
    { width: heroWidth - 28, align: "center", lineBreak: false }
  );
  doc.fillColor(COLORS.paper).font("Times-Bold").fontSize(27).text(
    money(payment.amount), left + 10, y + 47,
    { width: heroWidth - 20, align: "center", lineBreak: false }
  );
  doc.roundedRect(left + 28, y + 92, heroWidth - 56, 26, 13).fill(COLORS.gold);
  doc.fillColor(COLORS.forestDeep).font("Helvetica-Bold").fontSize(7).text(
    "PAYMENT RECEIVED", left + 28, y + 101,
    { width: heroWidth - 56, align: "center", lineBreak: false }
  );
  doc.fillColor("#C7D9D0").font("Helvetica").fontSize(6.6).text(
    "Securely committed to the reconciled installment ledger.",
    left + 22, y + 132,
    { width: heroWidth - 44, align: "center", lineGap: 2 }
  );
  drawSecuritySeal(doc, document, left + heroWidth / 2 - 26, y + 145, 52);

  const detailsX = left + heroWidth + gap;
  doc.roundedRect(detailsX, y, detailsWidth, 180, 13)
    .fillAndStroke(COLORS.paper, COLORS.line);
  doc.rect(detailsX, y, detailsWidth, 5).fill(template.accent);
  doc.fillColor(template.accent).font("Times-Bold").fontSize(11.5).text(
    "PAYMENT DETAILS", detailsX + 14, y + 17,
    { width: detailsWidth - 28, lineBreak: false }
  );
  [
    ["Receipt", payment.receipt_number || payment.payment_number],
    ["Date / time", dateTimeLabel(payment.payment_date)],
    ["Method", label(payment.payment_method)],
    ["Reference", payment.reference_number || "No external reference"],
    ["Received by", payment.received_by_name || "Finance staff"],
  ].forEach(([name, value], index) => {
    const rowY = y + 45 + index * 25;
    doc.circle(detailsX + 17, rowY + 5, 5).fill(index % 2 ? COLORS.gold : template.accent);
    doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(5.4).text(
      name.toUpperCase(), detailsX + 30, rowY,
      { width: detailsWidth - 42, lineBreak: false }
    );
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(6.9).text(
      clean(value), detailsX + 30, rowY + 11,
      { width: detailsWidth - 42, lineBreak: false, ellipsis: true }
    );
  });
  doc.y = y + 192;

  sectionTitle(doc, document, "Customer and equipment");
  drawFactGrid(doc, document, [
    ["Customer", customerName(document)],
    ["Equipment", machineName(document)],
    ["Agreement", agreement.agreement_number],
    ["Official balance after payment", money(agreement.outstanding_balance)],
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
  drawStatusRibbon(doc, document, [
    ["Customer", customerName(document)],
    ["First due", dateLabel(agreement.first_due_date)],
    ["Final due", dateLabel(agreement.final_due_date)],
    ["Frequency", label(agreement.payment_frequency)],
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
    ["Overdue amount", money(overdue.amount), Number(overdue.amount || 0) > 0 ? COLORS.red : COLORS.forest],
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
