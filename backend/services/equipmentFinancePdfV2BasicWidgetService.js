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

function compactCode(value) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase().slice(0, 2) || "•";
}

function sectionTitle(doc, document, title, { tone } = {}) {
  ensureSpace(doc, document, 38);
  const template = templateFor(document);
  const accent = tone === "danger" ? COLORS.red : template.accent;
  const left = doc.page.margins.left;
  const width = pageWidth(doc);
  const y = doc.y;
  const titleText = String(title || "").toUpperCase();
  const tabWidth = Math.min(width * 0.62, Math.max(148, titleText.length * 6.1 + 34));

  doc.roundedRect(left, y, tabWidth, 25, 6).fill(accent);
  doc.circle(left + 14, y + 12.5, 5).fill(COLORS.goldBright);
  doc.fillColor(COLORS.paper).font("Helvetica-Bold").fontSize(7.8).text(
    titleText,
    left + 27,
    y + 8,
    { width: tabWidth - 36, lineBreak: false, ellipsis: true }
  );
  doc.moveTo(left + tabWidth + 8, y + 12.5)
    .lineTo(left + width, y + 12.5)
    .lineWidth(1.15)
    .strokeColor(COLORS.gold)
    .stroke();
  doc.y = y + 34;
}

function drawFactGrid(doc, document, entries, { columns = 2, soft } = {}) {
  const present = entries.filter(
    (entry) => entry && entry[1] !== undefined && entry[1] !== null && clean(entry[1], "")
  );
  if (!present.length) return;
  const template = templateFor(document);
  const gap = 9;
  const width = pageWidth(doc);
  const cellWidth = (width - gap * (columns - 1)) / columns;

  for (let index = 0; index < present.length; index += columns) {
    const row = present.slice(index, index + columns);
    const heights = row.map(([, value]) =>
      doc.font("Helvetica-Bold").fontSize(8.2).heightOfString(clean(value), {
        width: cellWidth - 53,
        lineGap: 1.1,
      })
    );
    const rowHeight = Math.max(54, 30 + Math.max(...heights));
    ensureSpace(doc, document, rowHeight + 8);
    const y = doc.y;

    row.forEach(([name, value], columnIndex) => {
      const x = doc.page.margins.left + columnIndex * (cellWidth + gap);
      doc.roundedRect(x, y, cellWidth, rowHeight, 8)
        .fillAndStroke(soft || COLORS.paper, COLORS.line);
      doc.rect(x, y, cellWidth, 3).fill(template.accent);
      doc.circle(x + 21, y + rowHeight / 2, 13).fill(template.accentSoft);
      doc.circle(x + 21, y + rowHeight / 2, 13)
        .lineWidth(0.7)
        .strokeColor(COLORS.gold)
        .stroke();
      doc.fillColor(template.accent).font("Helvetica-Bold").fontSize(6.7).text(
        compactCode(name),
        x + 8,
        y + rowHeight / 2 - 3,
        { width: 26, align: "center", lineBreak: false }
      );
      doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(5.9).text(
        String(name).toUpperCase(),
        x + 42,
        y + 10,
        { width: cellWidth - 50, lineBreak: false, ellipsis: true }
      );
      doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(8.2).text(
        clean(value),
        x + 42,
        y + 25,
        { width: cellWidth - 50, lineGap: 1.1 }
      );
    });
    doc.y = y + rowHeight + 8;
  }
}

function drawSummaryCards(doc, document, cards, { columns = 3 } = {}) {
  const template = templateFor(document);
  const gap = 8;
  const width = pageWidth(doc);
  const cellWidth = (width - gap * (columns - 1)) / columns;

  for (let index = 0; index < cards.length; index += columns) {
    const row = cards.slice(index, index + columns);
    ensureSpace(doc, document, 73);
    const y = doc.y;
    row.forEach((card, columnIndex) => {
      const x = doc.page.margins.left + columnIndex * (cellWidth + gap);
      const valueColor = card[2] || template.accent;
      doc.roundedRect(x, y, cellWidth, 64, 9).fillAndStroke(COLORS.paper, COLORS.line);
      doc.roundedRect(x, y, cellWidth, 19, 9).fill(template.accent);
      doc.rect(x, y + 10, cellWidth, 9).fill(template.accent);
      doc.fillColor(COLORS.goldBright).font("Helvetica-Bold").fontSize(5.8).text(
        String(card[0]).toUpperCase(),
        x + 9,
        y + 7,
        { width: cellWidth - 18, align: "center", lineBreak: false, ellipsis: true }
      );
      doc.fillColor(valueColor).font("Helvetica-Bold").fontSize(10.4).text(
        clean(card[1]),
        x + 8,
        y + 33,
        { width: cellWidth - 16, align: "center", lineGap: 1 }
      );
      doc.moveTo(x + 16, y + 56).lineTo(x + cellWidth - 16, y + 56)
        .lineWidth(0.7).strokeColor(COLORS.gold).stroke();
    });
    doc.y = y + 72;
  }
}

function drawTable(doc, document, columns, rows, { rowHeight = 24, fontSize = 6.7 } = {}) {
  const left = doc.page.margins.left;
  const width = pageWidth(doc);
  const template = templateFor(document);
  const totalUnits = columns.reduce((sum, column) => sum + column.units, 0);
  const positions = [];
  let cursor = left;
  columns.forEach((column) => {
    const columnWidth = (width * column.units) / totalUnits;
    positions.push({ ...column, x: cursor, width: columnWidth });
    cursor += columnWidth;
  });

  function header() {
    ensureSpace(doc, document, 34);
    const y = doc.y;
    doc.roundedRect(left, y, width, 25, 5).fill(template.accent);
    positions.forEach((column, index) => {
      doc.fillColor(index === 0 ? COLORS.goldBright : COLORS.paper)
        .font("Helvetica-Bold")
        .fontSize(6.2)
        .text(column.title, column.x + 5, y + 9, {
          width: column.width - 10,
          lineBreak: false,
          ellipsis: true,
        });
    });
    doc.y = y + 29;
  }

  header();
  if (!rows.length) {
    ensureSpace(doc, document, 42);
    const y = doc.y;
    doc.roundedRect(left, y, width, 34, 6).fillAndStroke(COLORS.ash, COLORS.line);
    doc.fillColor(COLORS.muted).font("Helvetica-Oblique").fontSize(7.2).text(
      "No records are available for this section.",
      left + 10,
      y + 12,
      { width: width - 20, align: "center", lineBreak: false }
    );
    doc.y = y + 42;
    return;
  }

  rows.forEach((row, rowIndex) => {
    if (doc.y + rowHeight > bodyBottom(doc)) {
      addPage(doc, document);
      header();
    }
    const y = doc.y;
    doc.rect(left, y, width, rowHeight).fill(rowIndex % 2 ? COLORS.ash : COLORS.paper);
    positions.forEach((column, index) => {
      if (index > 0) {
        doc.moveTo(column.x, y + 4).lineTo(column.x, y + rowHeight - 4)
          .lineWidth(0.25).strokeColor(COLORS.line).stroke();
      }
      doc.fillColor(index === 0 ? template.accent : COLORS.ink)
        .font(index === 0 ? "Helvetica-Bold" : "Helvetica")
        .fontSize(fontSize)
        .text(clean(row[index], ""), column.x + 5, y + 8, {
          width: column.width - 10,
          lineBreak: false,
          ellipsis: true,
        });
    });
    doc.moveTo(left, y + rowHeight).lineTo(left + width, y + rowHeight)
      .lineWidth(0.25).strokeColor(COLORS.line).stroke();
    doc.y = y + rowHeight;
  });
  doc.y += 8;
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
  const gap = 10;
  const cellWidth = (width - gap) / 2;
  entries.forEach(([name, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const cellX = x + column * (cellWidth + gap);
    const cellY = y + row * 42;
    doc.circle(cellX + 7, cellY + 7, 4).fill(COLORS.gold);
    doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(5.8).text(
      String(name).toUpperCase(),
      cellX + 17,
      cellY + 1,
      { width: cellWidth - 17, lineBreak: false, ellipsis: true }
    );
    doc.fillColor(template.accent).font("Helvetica-Bold").fontSize(8).text(
      clean(value),
      cellX + 17,
      cellY + 15,
      { width: cellWidth - 17, lineBreak: false, ellipsis: true }
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
