const PDFDocument = require("pdfkit");

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function money(value) {
  return `GHS ${numberValue(value).toFixed(2)}`;
}

function decimal(value, places = 2) {
  return numberValue(value).toFixed(places);
}

function cleanText(value, fallback = "-") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cleanText(value);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cleanText(value);
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });
}

function sanitizeFilename(value, fallback = "document") {
  const cleaned = String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || fallback;
}

function setPdfHeaders(res, filename) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${sanitizeFilename(filename)}.pdf"`
  );
  res.setHeader("Cache-Control", "private, no-store");
}

function createPdf(res, options = {}) {
  const {
    filename = "document",
    title = "Business Document",
    documentNumber = "",
    business = {},
    landscape = false,
  } = options;

  setPdfHeaders(res, filename);

  const doc = new PDFDocument({
    size: "A4",
    layout: landscape ? "landscape" : "portrait",
    margin: 38,
    bufferPages: true,
    info: {
      Title: title,
      Author: cleanText(business.business_name, "Chalin 03 Company Limited"),
      Subject: documentNumber || title,
    },
  });

  doc.pipe(res);

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;

  doc
    .font("Helvetica-Bold")
    .fontSize(17)
    .text(
      cleanText(business.business_name, "Chalin 03 Company Limited").toUpperCase(),
      { align: "center" }
    );

  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor("#475569")
    .text(cleanText(business.business_address, "Dunkwa Police Barrier"), {
      align: "center",
    });

  const phoneParts = [
    business.business_phone ? `Tel: ${business.business_phone}` : "",
    business.owner_phone ? `Management: ${business.owner_phone}` : "",
  ].filter(Boolean);

  if (phoneParts.length) {
    doc.text(phoneParts.join("  |  "), { align: "center" });
  }

  doc.moveDown(0.55);
  doc
    .strokeColor("#1e3a5f")
    .lineWidth(1.2)
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(pageWidth - doc.page.margins.right, doc.y)
    .stroke();

  doc.moveDown(0.65);
  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(15).text(title, {
    align: "center",
  });

  if (documentNumber) {
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#475569")
      .text(documentNumber, { align: "center" });
  }

  doc.moveDown(0.8);

  return { doc, contentWidth };
}

function ensureSpace(doc, height = 80) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + height > bottom) {
    doc.addPage();
    return true;
  }
  return false;
}

function sectionTitle(doc, title) {
  ensureSpace(doc, 42);
  doc.moveDown(0.35);
  const y = doc.y;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc
    .roundedRect(doc.page.margins.left, y, width, 23, 4)
    .fillAndStroke("#e8eef6", "#cbd5e1");
  doc
    .fillColor("#17395f")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(title, doc.page.margins.left + 8, y + 7, {
      width: width - 16,
    });
  doc.y = y + 30;
}

function keyValueGrid(doc, items, columns = 2) {
  const valid = items.filter((item) => item && item.label);
  if (!valid.length) return;

  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const gap = 12;
  const cellWidth = (width - gap * (columns - 1)) / columns;
  const rows = Math.ceil(valid.length / columns);

  for (let row = 0; row < rows; row += 1) {
    ensureSpace(doc, 42);
    const y = doc.y;
    let rowHeight = 35;

    for (let col = 0; col < columns; col += 1) {
      const item = valid[row * columns + col];
      if (!item) continue;

      const x = doc.page.margins.left + col * (cellWidth + gap);
      const value = cleanText(item.value);
      const valueHeight = doc
        .font("Helvetica")
        .fontSize(9)
        .heightOfString(value, { width: cellWidth - 14 });
      rowHeight = Math.max(rowHeight, valueHeight + 24);

      doc
        .roundedRect(x, y, cellWidth, rowHeight, 4)
        .fillAndStroke("#f8fafc", "#e2e8f0");
      doc
        .fillColor("#64748b")
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .text(String(item.label).toUpperCase(), x + 7, y + 6, {
          width: cellWidth - 14,
        });
      doc
        .fillColor("#0f172a")
        .font("Helvetica")
        .fontSize(9)
        .text(value, x + 7, y + 17, {
          width: cellWidth - 14,
        });
    }

    doc.y = y + rowHeight + 7;
  }
}

function paragraph(doc, label, value) {
  const text = cleanText(value);
  ensureSpace(doc, 50);
  doc
    .fillColor("#334155")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(String(label).toUpperCase());
  doc
    .fillColor("#0f172a")
    .font("Helvetica")
    .fontSize(9)
    .text(text, { lineGap: 2 });
  doc.moveDown(0.45);
}

function drawTable(doc, columns, rows, options = {}) {
  const {
    fontSize = 7.5,
    headerHeight = 24,
    rowPadding = 5,
    emptyMessage = "No records found.",
  } = options;

  const fullWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totalWeight = columns.reduce((sum, column) => sum + (column.weight || 1), 0);
  const widths = columns.map(
    (column) => (fullWidth * (column.weight || 1)) / totalWeight
  );

  function header() {
    ensureSpace(doc, headerHeight + 25);
    let x = doc.page.margins.left;
    const y = doc.y;

    columns.forEach((column, index) => {
      doc
        .rect(x, y, widths[index], headerHeight)
        .fillAndStroke("#1e3a5f", "#1e3a5f");
      doc
        .fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(fontSize)
        .text(column.label, x + rowPadding, y + 8, {
          width: widths[index] - rowPadding * 2,
          align: column.align || "left",
        });
      x += widths[index];
    });

    doc.y = y + headerHeight;
  }

  if (!rows.length) {
    doc
      .fillColor("#64748b")
      .font("Helvetica-Oblique")
      .fontSize(9)
      .text(emptyMessage);
    doc.moveDown(0.5);
    return;
  }

  header();

  rows.forEach((row, rowIndex) => {
    const values = columns.map((column) => {
      const raw =
        typeof column.value === "function"
          ? column.value(row)
          : row[column.key];
      return cleanText(raw, "");
    });

    const heights = values.map((value, index) =>
      doc
        .font("Helvetica")
        .fontSize(fontSize)
        .heightOfString(value, {
          width: widths[index] - rowPadding * 2,
          align: columns[index].align || "left",
        })
    );
    const rowHeight = Math.max(23, Math.max(...heights) + rowPadding * 2);

    if (
      doc.y + rowHeight >
      doc.page.height - doc.page.margins.bottom
    ) {
      doc.addPage();
      header();
    }

    let x = doc.page.margins.left;
    const y = doc.y;
    const background = rowIndex % 2 === 0 ? "#ffffff" : "#f8fafc";

    columns.forEach((column, index) => {
      doc
        .rect(x, y, widths[index], rowHeight)
        .fillAndStroke(background, "#dbe3ec");
      doc
        .fillColor("#0f172a")
        .font("Helvetica")
        .fontSize(fontSize)
        .text(values[index], x + rowPadding, y + rowPadding + 1, {
          width: widths[index] - rowPadding * 2,
          align: column.align || "left",
        });
      x += widths[index];
    });

    doc.y = y + rowHeight;
  });

  doc.moveDown(0.6);
}

function totalsBox(doc, rows) {
  const width = 245;
  const x = doc.page.width - doc.page.margins.right - width;
  ensureSpace(doc, rows.length * 24 + 30);
  let y = doc.y + 3;

  rows.forEach((row, index) => {
    const isGrand = Boolean(row.grand);
    const height = isGrand ? 28 : 23;

    doc
      .rect(x, y, width, height)
      .fillAndStroke(
        isGrand ? "#dbeafe" : index % 2 === 0 ? "#f8fafc" : "#ffffff",
        "#cbd5e1"
      );
    doc
      .fillColor(isGrand ? "#17395f" : "#334155")
      .font(isGrand ? "Helvetica-Bold" : "Helvetica")
      .fontSize(isGrand ? 10 : 9)
      .text(cleanText(row.label), x + 8, y + 7, {
        width: 110,
      });
    doc
      .fillColor("#0f172a")
      .font("Helvetica-Bold")
      .fontSize(isGrand ? 10 : 9)
      .text(cleanText(row.value), x + 120, y + 7, {
        width: width - 128,
        align: "right",
      });
    y += height;
  });

  doc.y = y + 8;
}

function signatureLines(doc, labels = ["Prepared By", "Approved By"]) {
  ensureSpace(doc, 85);
  doc.moveDown(1.5);
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const gap = 30;
  const lineWidth = (width - gap * (labels.length - 1)) / labels.length;
  const y = doc.y + 25;

  labels.forEach((label, index) => {
    const x = doc.page.margins.left + index * (lineWidth + gap);
    doc
      .strokeColor("#64748b")
      .lineWidth(0.8)
      .moveTo(x, y)
      .lineTo(x + lineWidth, y)
      .stroke();
    doc
      .fillColor("#475569")
      .font("Helvetica")
      .fontSize(8)
      .text(label, x, y + 6, { width: lineWidth, align: "center" });
  });

  doc.y = y + 28;
}

function addFooters(doc, footerText = "") {
  const range = doc.bufferedPageRange();

  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const bottom = doc.page.height - 25;

    doc
      .strokeColor("#cbd5e1")
      .lineWidth(0.5)
      .moveTo(doc.page.margins.left, bottom - 8)
      .lineTo(doc.page.width - doc.page.margins.right, bottom - 8)
      .stroke();

    doc
      .fillColor("#64748b")
      .font("Helvetica")
      .fontSize(7)
      .text(cleanText(footerText, "Generated by Chalin 03 Group Operations Platform"), doc.page.margins.left, bottom, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 80,
        lineBreak: false,
      });

    doc.text(`Page ${index + 1} of ${range.count}`, doc.page.width - doc.page.margins.right - 75, bottom, {
      width: 75,
      align: "right",
      lineBreak: false,
    });
  }
}

function finishPdf(doc, footerText) {
  addFooters(doc, footerText);
  doc.end();
}

module.exports = {
  createPdf,
  sectionTitle,
  keyValueGrid,
  paragraph,
  drawTable,
  totalsBox,
  signatureLines,
  finishPdf,
  money,
  decimal,
  cleanText,
  formatDate,
  formatDateTime,
  sanitizeFilename,
};
