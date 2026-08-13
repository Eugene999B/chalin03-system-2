const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

const { buildSignedLabelPayload } = require("./inventoryTraceabilityService");

const MM = 72 / 25.4;
const FORMATS = Object.freeze(["a4", "thermal", "sticker", "compact"]);
const STYLES = Object.freeze(["compact", "standard", "detailed"]);

function mm(value) {
  return Number(value) * MM;
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeStudioFormat(value) {
  const format = clean(value || "a4").toLowerCase();
  if (!FORMATS.includes(format)) {
    const error = new Error("Choose A4, 58mm thermal, 50×30mm sticker, or 40×25mm compact labels.");
    error.statusCode = 400;
    error.code = "IDENTITY_STUDIO_INVALID_FORMAT";
    throw error;
  }
  return format;
}

function normalizeLabelStyle(value) {
  const style = clean(value || "standard").toLowerCase();
  if (!STYLES.includes(style)) {
    const error = new Error("Choose Compact, Standard, or Detailed label style.");
    error.statusCode = 400;
    error.code = "IDENTITY_STUDIO_INVALID_STYLE";
    throw error;
  }
  return style;
}

function labelGeometry(formatValue) {
  const format = normalizeStudioFormat(formatValue);
  if (format === "a4") {
    return {
      format,
      pageSize: "A4",
      pageMargins: { top: mm(8), right: mm(8), bottom: mm(8), left: mm(8) },
      columns: 3,
      rows: 8,
      gapX: mm(3),
      gapY: mm(3),
    };
  }
  if (format === "thermal") {
    return {
      format,
      pageSize: [mm(58), mm(40)],
      pageMargins: { top: mm(2), right: mm(2), bottom: mm(2), left: mm(2) },
      columns: 1,
      rows: 1,
      gapX: 0,
      gapY: 0,
    };
  }
  if (format === "sticker") {
    return {
      format,
      pageSize: [mm(50), mm(30)],
      pageMargins: { top: mm(1.5), right: mm(1.5), bottom: mm(1.5), left: mm(1.5) },
      columns: 1,
      rows: 1,
      gapX: 0,
      gapY: 0,
    };
  }
  return {
    format,
    pageSize: [mm(40), mm(25)],
    pageMargins: { top: mm(1.2), right: mm(1.2), bottom: mm(1.2), left: mm(1.2) },
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
    width: Math.max(100, Math.floor(size)),
  });
}

function fitText(doc, text, x, y, width, options = {}) {
  doc
    .font(options.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(options.fontSize || 7)
    .text(clean(text), x, y, {
      width,
      height: options.height,
      ellipsis: true,
      lineBreak: options.lineBreak !== false,
      align: options.align || "left",
    });
}

async function drawIdentityLabel(doc, {
  x,
  y,
  width,
  height,
  unit,
  style,
  format,
}) {
  const veryCompact = format === "compact";
  const compact = style === "compact" || veryCompact;
  const detailed = style === "detailed" && !veryCompact;
  const padding = mm(veryCompact ? 1 : 1.6);
  const qrSize = Math.min(
    height - padding * 2 - mm(veryCompact ? 3 : 4),
    width * (veryCompact ? 0.34 : compact ? 0.36 : 0.31)
  );
  const payload = buildSignedLabelPayload(unit.unit_code);
  const qr = await makeQr(payload, qrSize * 1.9);

  doc.lineWidth(0.55).rect(x, y, width, height).stroke();
  doc.image(qr, x + padding, y + padding, { width: qrSize, height: qrSize });

  const textX = x + padding + qrSize + mm(1.6);
  const textWidth = Math.max(mm(8), width - (textX - x) - padding);
  fitText(doc, "CHALIN 03", textX, y + padding, textWidth, {
    fontSize: veryCompact ? 5.4 : compact ? 6.5 : 7.8,
    bold: true,
  });
  fitText(doc, unit.unit_code, textX, y + padding + mm(4), textWidth, {
    fontSize: veryCompact ? 5.5 : compact ? 6.4 : 7.6,
    bold: true,
    height: mm(4.5),
  });

  if (!veryCompact) {
    fitText(doc, unit.product_name, textX, y + padding + mm(8.2), textWidth, {
      fontSize: compact ? 5.2 : 6.5,
      bold: !compact,
      height: mm(detailed ? 6 : 5),
    });
  }

  if (!compact) {
    fitText(
      doc,
      `Code ${unit.inventory_product_code || "—"}`,
      textX,
      y + padding + mm(13.8),
      textWidth,
      { fontSize: 5.4 }
    );
  }

  if (detailed) {
    fitText(
      doc,
      `Batch ${unit.batch_code}`,
      textX,
      y + padding + mm(17.5),
      textWidth,
      { fontSize: 5.1 }
    );
    fitText(
      doc,
      `${unit.branch_code || "STORE"} • ${unit.status}`,
      textX,
      y + padding + mm(21),
      textWidth,
      { fontSize: 4.9 }
    );
  }

  fitText(
    doc,
    veryCompact ? "Exact physical ID" : "Scan/enter this exact ID • copied label ≠ new unit",
    x + padding,
    y + height - mm(veryCompact ? 3.2 : 4.2),
    width - padding * 2,
    { fontSize: veryCompact ? 3.8 : 4.7, align: "center" }
  );
}

async function buildSelectedInventoryLabelPdf({ units, format, style, printCode }) {
  if (!Array.isArray(units) || units.length === 0) {
    const error = new Error("Select at least one inventory identity before printing.");
    error.statusCode = 400;
    error.code = "IDENTITY_STUDIO_EMPTY_SELECTION";
    throw error;
  }

  const geometry = labelGeometry(format);
  const labelStyle = normalizeLabelStyle(style);
  const doc = new PDFDocument({
    size: geometry.pageSize,
    margins: geometry.pageMargins,
    autoFirstPage: false,
    info: {
      Title: `CHALIN 03 Selected Inventory Labels - ${printCode}`,
      Subject: "Controlled selected physical inventory identity labels",
      Creator: "CHALIN 03 Inventory Identity & Label Studio",
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
    const cellWidth = (usableWidth - geometry.gapX * (geometry.columns - 1)) / geometry.columns;
    const cellHeight = (usableHeight - geometry.gapY * (geometry.rows - 1)) / geometry.rows;
    const slot = index % labelsPerPage;
    const column = slot % geometry.columns;
    const row = Math.floor(slot / geometry.columns);
    const x = geometry.pageMargins.left + column * (cellWidth + geometry.gapX);
    const y = geometry.pageMargins.top + row * (cellHeight + geometry.gapY);

    await drawIdentityLabel(doc, {
      x,
      y,
      width: cellWidth,
      height: cellHeight,
      unit: units[index],
      style: labelStyle,
      format: geometry.format,
    });
  }

  doc.end();
  return {
    buffer: await output,
    format: geometry.format,
    style: labelStyle,
    label_count: units.length,
    labels_per_page: labelsPerPage,
    page_count: Math.ceil(units.length / labelsPerPage),
    file_name: `chalin03-selected-ids-${printCode}-${geometry.format}-${labelStyle}.pdf`,
  };
}

module.exports = {
  FORMATS,
  STYLES,
  buildSelectedInventoryLabelPdf,
  labelGeometry,
  normalizeLabelStyle,
  normalizeStudioFormat,
};
