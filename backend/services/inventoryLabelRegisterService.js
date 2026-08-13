const PDFDocument = require("pdfkit");
const ExcelJS = require("./excelJsCompat");

function clean(value) {
  return String(value ?? "").trim();
}

function collectPdf(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function registerRows(units) {
  return units.map((unit) => ({
    unit_id: clean(unit.unit_code),
    product: clean(unit.product_name),
    product_code: clean(unit.inventory_product_code),
    batch: clean(unit.batch_code),
    store: [clean(unit.branch_code), clean(unit.branch_name)].filter(Boolean).join(" — "),
    status: clean(unit.status),
    print_count: Number(unit.unit_print_count || 0),
    legacy_print_evidence: Number(unit.legacy_batch_print_count || 0),
    last_printed_at: unit.last_printed_at || "",
    created_at: unit.created_at || "",
  }));
}

async function buildInventoryIdWorkbook(units) {
  const rows = registerRows(units);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CHALIN 03";
  workbook.subject = "Inventory exact-ID register";
  workbook.title = "CHALIN 03 Inventory ID Register";

  const sheet = workbook.addWorksheet("Inventory ID Register", {
    views: [{ state: "frozen", ySplit: 4 }],
  });

  sheet.mergeCells("A1:J1");
  sheet.getCell("A1").value = "CHALIN 03 — Inventory Exact-ID Register";
  sheet.getCell("A2").value = "Selected IDs";
  sheet.getCell("B2").value = rows.length;
  sheet.getCell("A3").value = "Security";
  sheet.getCell("B3").value = "Human-readable register only. Signed QR payloads are excluded.";

  sheet.getRow(4).values = [
    "Exact Unit ID",
    "Product",
    "Product Code",
    "Batch",
    "Store",
    "Status",
    "Per-ID Print Count",
    "Legacy Batch Print Evidence",
    "Last Per-ID Print",
    "Created At",
  ];

  rows.forEach((row) => {
    sheet.addRow([
      row.unit_id,
      row.product,
      row.product_code,
      row.batch,
      row.store,
      row.status,
      row.print_count,
      row.legacy_print_evidence,
      row.last_printed_at,
      row.created_at,
    ]);
  });

  sheet.autoFilter = `A4:J${Math.max(4, sheet.rowCount)}`;
  const widths = [24, 28, 16, 24, 26, 18, 18, 24, 22, 22];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.getRow(4).font = { bold: true };
  sheet.getRow(4).alignment = { vertical: "middle", wrapText: true };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber >= 5) row.alignment = { vertical: "top", wrapText: true };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

async function buildInventoryIdRegisterPdf(units) {
  const rows = registerRows(units);
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 42, right: 42, bottom: 42, left: 42 },
    info: {
      Title: "CHALIN 03 Inventory Exact-ID Register",
      Subject: "Human-readable selected inventory ID register",
      Creator: "CHALIN 03 Inventory Control & Traceability",
    },
  });
  const output = collectPdf(doc);

  doc.font("Helvetica-Bold").fontSize(17).text("CHALIN 03 — Inventory Exact-ID Register");
  doc.moveDown(0.35);
  doc.font("Helvetica").fontSize(9).text(
    `${rows.length} selected ID${rows.length === 1 ? "" : "s"}. Human-readable register only; signed QR payloads are not included.`
  );
  doc.moveDown(0.8);

  rows.forEach((row, index) => {
    if (doc.y > 720) doc.addPage();
    doc.font("Helvetica-Bold").fontSize(10).text(`${index + 1}. ${row.unit_id}`);
    doc.font("Helvetica").fontSize(8.5).text(
      `${row.product}${row.product_code ? ` · ${row.product_code}` : ""} · ${row.status}`
    );
    doc.fontSize(7.5).text(`Batch: ${row.batch || "—"}   Store: ${row.store || "—"}`);
    doc.fontSize(7.5).text(
      `Print evidence: ${row.print_count} per-ID${row.legacy_print_evidence ? ` · ${row.legacy_print_evidence} legacy batch` : ""}`
    );
    doc.moveDown(0.55);
  });

  doc.end();
  return output;
}

module.exports = {
  buildInventoryIdRegisterPdf,
  buildInventoryIdWorkbook,
  registerRows,
};
