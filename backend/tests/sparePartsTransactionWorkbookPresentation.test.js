"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("../services/excelJsCompat");
const { sendAuditExport } = require("../services/sparePartsAuditExportService");

function mockResponse() {
  return {
    code: 0, body: null, headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.code = code; return this; },
    send(value) { this.body = value; return this; }
  };
}

const report = {
  format: "xlsx",
  title: "Spare Parts | Transaction, Returns & Financial Reconciliation",
  description: "Recorded sales, refunds and reconciliations",
  branch: "SP01 - Main Store",
  period: "2026-11-01 to 2026-11-11",
  fromDate: "2026-11-01",
  toDate: "2026-11-11",
  generatedBy: "Test Auditor",
  filename: "presentation-check",
  columns: [
    { key: "receipt", label: "Receipt" },
    { key: "item", label: "Item" },
    { key: "net", label: "Sales Before Tax" },
    { key: "margin", label: "Profit Margin %" },
    { key: "review_status", label: "Reconciliation" }
  ],
  rows: [
    { receipt: "SP-101", item: "Oil Filter", net: 275.5, margin: 21.4, review_status: "Reconciled" },
    { receipt: "SP-102", item: "Hydraulic Hose", net: 135.75, margin: 17.2, review_status: "Needs review" }
  ],
  metrics: [
    ["Active completed sale receipts", 2],
    ["Full receipt totals INCLUDING tax (GHS)", 450.25],
    ["Total MONEY REFUNDED (GHS)", 30],
    ["Number of return events (returned-at date)", 1],
    ["Reconstructed customer receipts IN minus refunds OUT (GHS)", 320.25],
    ["Total currently-active operating expenses (GHS)", 19.5],
    ["Indicative margin bridge AFTER returns and expenses (GHS)", 81.1],
    ["Issues needing investigation", 1]
  ],
  sections: [
    { name: "Receipt Reconciliation", columns: [
      { key: "receipt", label: "Receipt" }, { key: "total_difference", label: "Difference vs Receipt" }
    ], rows: [{ receipt: "SP-101", total_difference: 0 }] },
    { name: "Returns Detail", columns: [
      { key: "item", label: "Item" }, { key: "refund_amount", label: "Money Refunded (GHS)" }
    ], rows: [{ item: "Oil Filter", refund_amount: 30 }] },
    { name: "Review Exceptions", columns: [
      { key: "issue", label: "Reason" }, { key: "amount", label: "Amount" }
    ], rows: [{ issue: "Investigate source receipt", amount: 12.4 }] }
  ]
};

test("Executive Summary shows original financial evidence in visual KPI tiles", async () => {
  const res = mockResponse();
  await sendAuditExport(res, report);
  assert.equal(res.code, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body);
  const cover = wb.getWorksheet("Executive Summary");
  assert.ok(cover);
  assert.match(cover.getCell("A1").value, /EXECUTIVE REPORT/);
  assert.equal(cover.getCell("A6").value, "COMPLETED RECEIPTS");
  assert.equal(cover.getCell("A7").value, 2);
  assert.equal(cover.getCell("C7").value, 450.25);
  assert.equal(cover.getCell("E7").value, 30);
  assert.equal(cover.getCell("G11").value, 1);
  assert.match(cover.getCell("C7").numFmt, /0\.00/);
  assert.ok(cover.getColumn(1).values.includes("From Date"));
  assert.ok(cover.getColumn(1).values.includes("To Date"));
  assert.ok(cover.getColumn(1).values.some(value => value === "04  /  WORKSHEET DIRECTORY"));
  assert.ok(cover.getCell("A1").fill.fgColor.argb);
});

test("Detailed worksheets retain source values, date filters, freezes and exception visibility", async () => {
  const res = mockResponse();
  await sendAuditExport(res, report);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body);
  const sales = wb.getWorksheet("Transaction Lines");
  assert.equal(sales.getCell("A2").value, "From Date");
  assert.equal(sales.getCell("B2").value, "2026-11-01");
  assert.equal(sales.getCell("C2").value, "To Date");
  assert.equal(sales.getCell("D2").value, "2026-11-11");
  assert.equal(sales.getCell("A5").value, "Receipt");
  assert.equal(sales.getCell("C6").value, 275.5);
  assert.equal(sales.getCell("D6").value, 21.4);
  assert.equal(sales.getCell("C7").value, 135.75);
  assert.equal(sales.getCell("E7").value, "Needs review");
  assert.match(sales.getCell("C6").numFmt, /0\.00/);
  assert.match(sales.getCell("D6").numFmt, /%/);
  assert.ok(sales.getCell("E7").fill.fgColor.argb);
  assert.ok(sales.autoFilter);
  assert.ok(sales.views.some(view => view.state === "frozen"));
  assert.equal(wb.getWorksheet("Returns Detail").getCell("B6").value, 30);
  assert.equal(wb.getWorksheet("Review Exceptions").getCell("A6").value, "Investigate source receipt");
});

test("Executive presentation tolerates non-transaction exports without inventing financial totals", async () => {
  const res = mockResponse();
  await sendAuditExport(res, {
    ...report,
    title: "Blind Stock Count",
    metrics: [],
    sections: [],
    rows: [{ receipt: "ABC", item: "Oil Filter", net: 1 }]
  });
  assert.equal(res.code, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body);
  const cover = wb.getWorksheet("Executive Summary");
  assert.equal(cover.getCell("A6").value, "DETAIL RECORDS");
  assert.equal(cover.getCell("A7").value, 1);
  assert.equal(cover.getCell("C7").value, 0);
  assert.equal(wb.getWorksheet("Transaction Lines").getCell("C6").value, 1);
});
