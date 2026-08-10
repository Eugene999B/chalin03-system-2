const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

const {
  PRINT_FORMATS,
  buildSignedLabelPayload,
  normalizePrintFormat,
} = require("./inventoryTraceabilityService");

const MM = 72 / 25.4;

function mm(value) {
  return Number(value) * MM;
}

function clean(value) {
  return String(value ?? "").trim();
}

function labelGeometry(format) {
  const normalized = normalizePrintFormat(format);
  if (normalized === PRINT_FORMATS.A4) {
    return {
      format: normalized,
      pageSize: "A4",
      pageMargins: { top: mm(8), right: mm(8), bottom: mm(8), left: mm(8) },
      columns: 3,
      rows: 8,
      gapX: mm(3),
      gapY: mm(3),
    };
  }
  if (normalized === PRINT_FORMATS.THERMAL) {
    return {
      format: normalized,
      pageSize: [mm(58), mm(40)],
      pageMargins: { top: mm(2), right: mm(2), bottom: mm(2), left: mm(2) },
      columns: 1,
      rows: 1,
      gapX: 0,
      gapY: 0,
    };
  }
  if (normalized === PRINT_FORMATS.STICKER) {
    return {
      format: normalized,
      pageSize: [mm(50), mm(30)],
      pageMargins: { top: mm(1.5), right: mm(1.5), bottom: mm(1.5), left: mm(1.5) },
      columns: 1,
      rows: 1,
      gapX: 0,
      gapY: 0,
    };
  }

  return {
    format: PRINT_FORMATS.OTHER,
    pageSize: [mm(70), mm(45)],
    pageMargins: { top: mm(2), right: mm(2), bottom: mm(2), left: mm(2) },
    columns: 1,
    rows: 1,
    gapX: 0,
    gapY: 0,
  };
}

function collectPdf(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

async function makeQr(payload, size) {
  return QRCode.toBuffer(payload, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 0,
    width: Math.max(90, Math.floor(size)),
  });
}

function fitText(doc, text, x, y, width, options = {}) {
  const fontSize = options.fontSize || 7;
  doc
    .font(options.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(fontSize)
    .text(clean(text), x, y, {
      width,
      height: options.height,
      ellipsis: true,
      lineBreak: options.lineBreak !== false,
      align: options.align || "left",
    });
}

async function drawLabel(doc, {
  x,
  y,
  width,
  height,
  batch,
  unit,
  qrPayload,
  format,
}) {
  const compact = format === PRINT_FORMATS.STICKER;
  const qrSize = Math.min(height - mm(compact ? 4 : 7), width * (compact ? 0.38 : 0.32));
  const qr = await makeQr(qrPayload, qrSize * 1.8);
  const padding = mm(compact ? 1.5 : 2.2);

  doc
    .lineWidth(0.6)
    .rect(x, y, width, height)
    .stroke();

  doc.image(qr, x + padding, y + padding, {
    width: qrSize,
    height: qrSize,
  });

  const textX = x + padding + qrSize + mm(2);
  const textWidth = width - (textX - x) - padding;
  fitText(doc, "CHALIN 03", textX, y + padding, textWidth, {
    fontSize: compact ? 6.5 : 8.5,
    bold: true,
  });
  fitText(doc, batch.product_name, textX, y + padding + mm(4.5), textWidth, {
    fontSize: compact ? 5.6 : 7.3,
    bold: true,
    height: mm(7),
  });
  fitText(doc, unit.unit_code, textX, y + padding + mm(compact ? 11 : 13), textWidth, {
    fontSize: compact ? 6.1 : 8.2,
    bold: true,
  });

  if (!compact) {
    fitText(
      doc,
      `Batch ${batch.batch_code}`,
      textX,
      y + padding + mm(18),
      textWidth,
      { fontSize: 5.8 }
    );
    fitText(
      doc,
      `${batch.branch_code || "STORE"} • ${unit.status}`,
      textX,
      y + padding + mm(22),
      textWidth,
      { fontSize: 5.6 }
    );
  }

  fitText(
    doc,
    "Scan/enter this exact ID. A copied label is not a new unit.",
    x + padding,
    y + height - mm(compact ? 4 : 5),
    width - padding * 2,
    { fontSize: compact ? 4.2 : 5.2, align: "center" }
  );
}

async function buildInventoryLabelPdf({ batch, units, format, signingSecret }) {
  if (!batch?.batch_code || !batch?.product_name) {
    throw new Error("Label batch metadata is incomplete.");
  }
  if (!Array.isArray(units) || units.length === 0) {
    throw new Error("There are no printable inventory identities in this batch.");
  }

  const geometry = labelGeometry(format);
  const doc = new PDFDocument({
    size: geometry.pageSize,
    margins: geometry.pageMargins,
    autoFirstPage: false,
    info: {
      Title: `CHALIN 03 Inventory Labels - ${batch.batch_code}`,
      Subject: "Controlled serialized inventory identity labels",
      Creator: "CHALIN 03 Inventory Loss Prevention & Traceability",
    },
  });
  const output = collectPdf(doc);

  const labelsPerPage = geometry.columns * geometry.rows;
  for (let index = 0; index < units.length; index += 1) {
    if (index % labelsPerPage === 0) {
      doc.addPage({ size: geometry.pageSize, margins: geometry.pageMargins });
    }

    const page = doc.page;
    const usableWidth = page.width - geometry.pageMargins.left - geometry.pageMargins.right;
    const usableHeight = page.height - geometry.pageMargins.top - geometry.pageMargins.bottom;
    const cellWidth =
      (usableWidth - geometry.gapX * (geometry.columns - 1)) / geometry.columns;
    const cellHeight =
      (usableHeight - geometry.gapY * (geometry.rows - 1)) / geometry.rows;
    const slot = index % labelsPerPage;
    const column = slot % geometry.columns;
    const row = Math.floor(slot / geometry.columns);
    const x = geometry.pageMargins.left + column * (cellWidth + geometry.gapX);
    const y = geometry.pageMargins.top + row * (cellHeight + geometry.gapY);
    const qrPayload = buildSignedLabelPayload(units[index].unit_code, signingSecret);

    await drawLabel(doc, {
      x,
      y,
      width: cellWidth,
      height: cellHeight,
      batch,
      unit: units[index],
      qrPayload,
      format: geometry.format,
    });
  }

  doc.end();
  return {
    buffer: await output,
    format: geometry.format,
    label_count: units.length,
    file_name: `${batch.batch_code}-${geometry.format}-labels.pdf`,
  };
}

module.exports = {
  buildInventoryLabelPdf,
  labelGeometry,
  mm,
};
