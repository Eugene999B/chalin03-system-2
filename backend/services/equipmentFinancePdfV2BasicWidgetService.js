const {
  COLORS,
  agreementOf,
  clean,
  dateLabel,
  label,
  money,
  templateFor,
} = require("./equipmentFinanceDocumentDesignV2Service");
const {
  addPage,
  bodyBottom,
  ensureSpace,
  pageWidth,
} = require("./equipmentFinancePdfV2PageService");

function sectionTitle(doc, document, title, { tone } = {}) {
  ensureSpace(doc, document, 34);
  const template = templateFor(document);
  const accent = tone === "danger" ? COLORS.red : template.accent;
  const y = doc.y;
  const width = pageWidth(doc);
  doc.roundedRect(doc.page.margins.left, y, width, 24, 5).fill(accent);
  doc.fillColor(COLORS.paper).font("Helvetica-Bold").fontSize(9).text(
    String(title || "").toUpperCase(),
    doc.page.margins.left + 10,
    y + 7,
    { width: width - 20, lineBreak: false }
  );
  doc.y = y + 32;
}

function drawFactGrid(doc, document, entries, { columns = 2, soft } = {}) {
  const present = entries.filter((entry) => entry && entry[1] !== undefined && entry[1] !== null);
  if (!present.length) return;
  const template = templateFor(document);
  const gap = 8;
  const width = pageWidth(doc);
  const cellWidth = (width - gap * (columns - 1)) / columns;

  for (let index = 0; index < present.length; index += columns) {
    const row = present.slice(index, index + columns);
    const heights = row.map(([, value]) =>
      doc.font("Helvetica-Bold").fontSize(8.5).heightOfString(clean(value), {
        width: cellWidth - 20,
        lineGap: 1.2,
      })
    );
    const rowHeight = Math.max(52, 30 + Math.max(...heights));
    ensureSpace(doc, document, rowHeight + 7);
    const y = doc.y;

    row.forEach(([name, value], columnIndex) => {
      const x = doc.page.margins.left + columnIndex * (cellWidth + gap);
      doc.roundedRect(x, y, cellWidth, rowHeight, 7)
        .fillAndStroke(soft || template.accentSoft, COLORS.line);
      doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(6.5).text(
        String(name).toUpperCase(), x + 10, y + 9,
        { width: cellWidth - 20, lineBreak: false }
      );
      doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(8.5).text(
        clean(value), x + 10, y + 23,
        { width: cellWidth - 20, lineGap: 1.2 }
      );
    });
    doc.y = y + rowHeight + 7;
  }
}

function drawSummaryCards(doc, document, cards, { columns = 3 } = {}) {
  const template = templateFor(document);
  const gap = 8;
  const width = pageWidth(doc);
  const cellWidth = (width - gap * (columns - 1)) / columns;

  for (let index = 0; index < cards.length; index += columns) {
    const row = cards.slice(index, index + columns);
    ensureSpace(doc, document, 68);
    const y = doc.y;
    row.forEach((card, columnIndex) => {
      const x = doc.page.margins.left + columnIndex * (cellWidth + gap);
      doc.roundedRect(x, y, cellWidth, 58, 7).fillAndStroke(COLORS.paper, COLORS.line);
      doc.rect(x, y, 5, 58).fill(template.accent);
      doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(6.2).text(
        String(card[0]).toUpperCase(), x + 13, y + 10,
        { width: cellWidth - 22, lineBreak: false }
      );
      doc.fillColor(card[2] || COLORS.ink).font("Helvetica-Bold").fontSize(10.2).text(
        clean(card[1]), x + 13, y + 27,
        { width: cellWidth - 22, lineGap: 1 }
      );
    });
    doc.y = y + 66;
  }
}

function drawTable(doc, document, columns, rows, { rowHeight = 23, fontSize = 6.7 } = {}) {
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
    ensureSpace(doc, document, 32);
    const y = doc.y;
    doc.rect(left, y, width, 24).fill(templateFor(document).accent);
    positions.forEach((column) => {
      doc.fillColor(COLORS.paper).font("Helvetica-Bold").fontSize(6.4).text(
        column.title, column.x + 4, y + 8,
        { width: column.width - 8, lineBreak: false }
      );
    });
    doc.y = y + 28;
  }

  header();
  if (!rows.length) {
    ensureSpace(doc, document, 38);
    const y = doc.y;
    doc.roundedRect(left, y, width, 32, 5).fillAndStroke(COLORS.ash, COLORS.line);
    doc.fillColor(COLORS.muted).font("Helvetica-Oblique").fontSize(7.2).text(
      "No records are available for this section.", left + 10, y + 11,
      { width: width - 20, align: "center", lineBreak: false }
    );
    doc.y = y + 39;
    return;
  }

  rows.forEach((row, rowIndex) => {
    if (doc.y + rowHeight > bodyBottom(doc)) {
      addPage(doc, document);
      header();
    }
    const y = doc.y;
    if (rowIndex % 2 === 1) doc.rect(left, y, width, rowHeight).fill(COLORS.ash);
    positions.forEach((column, index) => {
      doc.fillColor(COLORS.ink).font("Helvetica").fontSize(fontSize).text(
        clean(row[index], ""), column.x + 4, y + 7,
        { width: column.width - 8, lineBreak: false, ellipsis: true }
      );
    });
    doc.moveTo(left, y + rowHeight).lineTo(left + width, y + rowHeight)
      .lineWidth(0.25).strokeColor(COLORS.line).stroke();
    doc.y = y + rowHeight;
  });
  doc.y += 7;
}

function drawScheduleTable(doc, document, rows = document.snapshot?.schedule || []) {
  drawTable(doc, document, [
    { title: "NO.", units: 0.55 },
    { title: "DUE DATE", units: 1.35 },
    { title: "SCHEDULED", units: 1.45 },
    { title: "PAID", units: 1.35 },
    { title: "BALANCE", units: 1.45 },
    { title: "STATUS", units: 1.1 },
  ], rows.map((row) => [
    row.sequence_number,
    dateLabel(row.due_date),
    money(row.scheduled_amount),
    money(row.amount_paid),
    money(row.balance),
    label(row.schedule_status),
  ]));
}

function drawPaymentTable(doc, document, rows = document.snapshot?.payments || []) {
  drawTable(doc, document, [
    { title: "RECEIPT", units: 1.5 },
    { title: "DATE", units: 1.25 },
    { title: "METHOD", units: 1.1 },
    { title: "AMOUNT", units: 1.35 },
    { title: "RECEIVED BY", units: 1.8 },
  ], rows.map((row) => [
    row.receipt_number || row.payment_number,
    dateLabel(row.payment_date),
    label(row.payment_method),
    money(row.amount),
    row.received_by_name || "Finance staff",
  ]));
}

function agreementSummaryCards(document) {
  const agreement = agreementOf(document);
  return [
    ["Purchase price", money(agreement.total_amount)],
    ["Opening deposit", money(agreement.deposit_required || agreement.deposit_received)],
    ["Financed amount", money(agreement.financed_amount)],
    ["Total paid", money(agreement.amount_paid)],
    ["Official balance", money(agreement.outstanding_balance)],
    ["Payment plan", `${agreement.installment_count || 0} ${label(agreement.payment_frequency, "payments")}`],
  ];
}

function drawFactGridAt(doc, document, x, y, width, entries) {
  const template = templateFor(document);
  const gap = 8;
  const cellWidth = (width - gap) / 2;
  entries.forEach(([name, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const cellX = x + column * (cellWidth + gap);
    const cellY = y + row * 40;
    doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(6).text(
      String(name).toUpperCase(), cellX, cellY,
      { width: cellWidth, lineBreak: false }
    );
    doc.fillColor(template.accent).font("Helvetica-Bold").fontSize(8).text(
      clean(value), cellX, cellY + 13,
      { width: cellWidth, lineBreak: false, ellipsis: true }
    );
  });
}

module.exports = {
  agreementSummaryCards,
  drawFactGrid,
  drawFactGridAt,
  drawPaymentTable,
  drawScheduleTable,
  drawSummaryCards,
  drawTable,
  sectionTitle,
};
