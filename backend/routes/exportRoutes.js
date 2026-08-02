const express = require("express");
const ExcelJS = require("../services/excelJsCompat");
const PDFDocument = require("pdfkit");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 1);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return 1;
  }

  return branchId;
}

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function formatDateTime(value) {
  if (!value) return "";

  return new Date(value).toLocaleString();
}

function formatDate(value) {
  if (!value) return "";

  return new Date(value).toLocaleDateString();
}

function buildDateFilter(alias, dateColumn, from, to, params) {
  let filter = "";

  if (from) {
    filter += ` AND DATE(${alias}.${dateColumn}) >= ?`;
    params.push(from);
  }

  if (to) {
    filter += ` AND DATE(${alias}.${dateColumn}) <= ?`;
    params.push(to);
  }

  return filter;
}


function toLedgerNumber(value) {
  const number = Number(value || 0);

  if (Number.isNaN(number)) {
    return 0;
  }

  return number;
}

function normaliseLedgerDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function isLedgerDateInRange(value, from, to) {
  const date = normaliseLedgerDate(value);

  if (!date) {
    return false;
  }

  if (from) {
    const fromDate = new Date(`${from}T00:00:00`);

    if (!Number.isNaN(fromDate.getTime()) && date < fromDate) {
      return false;
    }
  }

  if (to) {
    const toDate = new Date(`${to}T23:59:59.999`);

    if (!Number.isNaN(toDate.getTime()) && date > toDate) {
      return false;
    }
  }

  return true;
}

async function safeExportQuery(label, sql, params, warnings) {
  try {
    const [rows] = await pool.query(sql, params);

    return rows;
  } catch (error) {
    const message = `${label} skipped: ${error.message}`;
    console.warn(message);
    warnings.push(message);

    return [];
  }
}

function getProductNameKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function createLedgerEntry(entry) {
  return {
    product_id: entry.product_id,
    product_name: entry.product_name || "",
    product_size: entry.product_size || "",
    product_category: entry.product_category || "",
    product_barcode: entry.product_barcode || "",
    date: entry.date || null,
    movement_type: entry.movement_type || "Movement",
    reference: entry.reference || "",
    details: entry.details || "",
    change_quantity: toLedgerNumber(entry.change_quantity),
    quantity_before:
      entry.quantity_before === undefined ? null : entry.quantity_before,
    quantity_after: entry.quantity_after === undefined ? null : entry.quantity_after,
    recorded_by: entry.recorded_by || "",
    source: entry.source || "",
    sort_id: Number(entry.sort_id || 0),
  };
}

function isVoidedSale(sale) {
  return (
    Number(sale.is_voided || 0) === 1 ||
    sale.sale_status === "cancelled" ||
    sale.sale_status === "voided"
  );
}

function safeFilenamePart(value) {
  return String(value || "store")
    .replace(/[^a-z0-9]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function styleWorksheet(worksheet) {
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  worksheet.getRow(1).font = {
    bold: true,
    color: { argb: "FFFFFFFF" },
  };

  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF071529" },
  };

  worksheet.getRow(1).alignment = {
    vertical: "middle",
    horizontal: "center",
  };

  worksheet.columns.forEach((column) => {
    let maxLength = 12;

    column.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value ? String(cell.value) : "";
      maxLength = Math.max(maxLength, value.length + 2);
    });

    column.width = Math.min(maxLength, 45);
  });
}

function getExportFormat(value) {
  const format = String(value || "xlsx").trim().toLowerCase();

  if (["pdf"].includes(format)) return "pdf";
  if (["doc", "word", "msword"].includes(format)) return "doc";

  return "xlsx";
}

function getReportTitle(baseName) {
  const titles = {
    products: "Products and Inventory Register",
    "low-stock-restock": "Low Stock and Restock Plan",
    "stock-adjustments": "Stock Adjustments Report",
    "stock-transfers": "Stock Transfers Report",
    "stock-movement-ledger": "Stock Movement Ledger",
    "daily-closings": "Daily Closings Report",
    sales: "Sales Transactions Report",
    debts: "Customer Debts Report",
    "debt-payments": "Debt Payments Report",
    expenses: "Business Expenses Report",
    purchases: "Purchases and Supplier Accounts Report",
    returns: "Customer Returns Report",
  };

  if (titles[baseName]) return titles[baseName];

  return String(baseName || "Business Report")
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function parseReportDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = cleanText(value);
  if (!text) return null;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (isoMatch) {
    const date = new Date(
      Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]), 12)
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatReportDate(value) {
  const date = parseReportDate(value);
  if (!date) return "";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Accra",
  })
    .format(date)
    .toUpperCase();
}

function formatReportDateKey(value) {
  const date = parseReportDate(value);
  if (!date) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Africa/Accra",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isLikelyReportDateHeader(value) {
  return /(^|[\s_-])(date|created|updated|sale|sold|paid|payment|purchase|return|closing|adjustment|transfer|issued|received|recorded)([\s_-]|$)/i.test(
    String(value || "")
  );
}

function deriveWorkbookDateBounds(analysis) {
  let earliest = null;
  let latest = null;

  analysis.forEach((sheet) => {
    const dateIndexes = sheet.headers
      .map((header, index) => (isLikelyReportDateHeader(header) ? index : -1))
      .filter((index) => index >= 0);

    sheet.rows.forEach((row) => {
      dateIndexes.forEach((index) => {
        const date = parseReportDate(row[index]);
        if (!date) return;
        if (!earliest || date < earliest) earliest = date;
        if (!latest || date > latest) latest = date;
      });
    });
  });

  return { earliest, latest };
}

function getDateRangeMeta(from, to, analysis) {
  const bounds = deriveWorkbookDateBounds(analysis);
  const fromDate = parseReportDate(from) || bounds.earliest;
  const toDate = parseReportDate(to) || bounds.latest;
  const fromLabel = formatReportDate(fromDate);
  const toLabel = formatReportDate(toDate);
  const fromKey = formatReportDateKey(fromDate);
  const toKey = formatReportDateKey(toDate);

  if (fromLabel && toLabel) {
    return {
      fromLabel,
      toLabel,
      periodLabel: `${fromLabel} TO ${toLabel}`,
      periodBanner: `REPORTING PERIOD: FROM ${fromLabel} TO ${toLabel}`,
      filenamePart: `${fromKey}-to-${toKey}`,
    };
  }

  if (fromLabel) {
    return {
      fromLabel,
      toLabel: "LATEST AVAILABLE RECORD",
      periodLabel: `FROM ${fromLabel} TO LATEST AVAILABLE RECORD`,
      periodBanner: `REPORTING PERIOD: FROM ${fromLabel} TO LATEST AVAILABLE RECORD`,
      filenamePart: `from-${fromKey}`,
    };
  }

  if (toLabel) {
    return {
      fromLabel: "EARLIEST AVAILABLE RECORD",
      toLabel,
      periodLabel: `FROM EARLIEST AVAILABLE RECORD TO ${toLabel}`,
      periodBanner: `REPORTING PERIOD: FROM EARLIEST AVAILABLE RECORD TO ${toLabel}`,
      filenamePart: `to-${toKey}`,
    };
  }

  return {
    fromLabel: "NOT AVAILABLE",
    toLabel: "NOT AVAILABLE",
    periodLabel: "NO DATED RECORDS AVAILABLE",
    periodBanner: "REPORTING PERIOD: NO DATED RECORDS AVAILABLE",
    filenamePart: "no-dated-records",
  };
}

async function getBranchDetails(branchId) {
  const [branches] = await pool.query(
    `SELECT code, name, location
     FROM branches
     WHERE id = ?
     LIMIT 1`,
    [branchId]
  );

  if (branches.length === 0) {
    return {
      code: `BRANCH-${branchId}`,
      name: `Branch ${branchId}`,
      location: "",
    };
  }

  return {
    code: branches[0].code || `BRANCH-${branchId}`,
    name: branches[0].name || `Branch ${branchId}`,
    location: branches[0].location || "",
  };
}

function removeBlankStringCells(workbook) {
  workbook.eachSheet((worksheet) => {
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.value === "") {
          cell.value = null;
        }
      });
    });
  });
}

function getCellRawValue(cell) {
  const value = cell?.value;

  if (value === undefined || value === null) return "";
  if (value instanceof Date) return value;

  if (typeof value === "object") {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text || "").join("");
    }

    if (value.result !== undefined && value.result !== null) {
      return value.result;
    }

    if (value.text !== undefined && value.text !== null) {
      return value.text;
    }

    if (value.hyperlink && value.text) {
      return value.text;
    }

    return cleanText(value);
  }

  return value;
}

function formatExportValue(value) {
  if (value === undefined || value === null) return "";

  if (value instanceof Date) {
    return value.toLocaleString("en-GB");
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "0";

    return Number.isInteger(value)
      ? String(value)
      : value.toLocaleString("en-GH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  }

  return String(value);
}

function normaliseHeader(value, index) {
  const header = cleanText(value);

  return header || `Column ${index + 1}`;
}

function findWorksheetHeaderRow(worksheet) {
  const maxScan = Math.min(Math.max(worksheet.actualRowCount || 1, 1), 20);
  let bestRow = 1;
  let bestScore = -1;

  for (let rowNumber = 1; rowNumber <= maxScan; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    let nonEmpty = 0;
    let textValues = 0;

    row.eachCell({ includeEmpty: false }, (cell) => {
      const value = getCellRawValue(cell);

      if (value !== "") {
        nonEmpty += 1;

        if (typeof value === "string") textValues += 1;
      }
    });

    if (nonEmpty < 2) continue;

    const score = nonEmpty * 10 + textValues - rowNumber * 0.05;

    if (score > bestScore) {
      bestScore = score;
      bestRow = rowNumber;
    }
  }

  return bestRow;
}

function analyseWorksheet(worksheet) {
  const headerRowIndex = findWorksheetHeaderRow(worksheet);
  const columnCount = Math.max(
    worksheet.actualColumnCount || 0,
    worksheet.getRow(headerRowIndex).cellCount || 0,
    1
  );

  const headers = [];

  for (let column = 1; column <= columnCount; column += 1) {
    headers.push(
      normaliseHeader(
        formatExportValue(getCellRawValue(worksheet.getCell(headerRowIndex, column))),
        column - 1
      )
    );
  }

  const rows = [];

  for (
    let rowNumber = headerRowIndex + 1;
    rowNumber <= (worksheet.actualRowCount || headerRowIndex);
    rowNumber += 1
  ) {
    const values = [];
    let hasValue = false;

    for (let column = 1; column <= columnCount; column += 1) {
      const value = getCellRawValue(worksheet.getCell(rowNumber, column));
      values.push(value);

      if (value !== "" && value !== null && value !== undefined) {
        hasValue = true;
      }
    }

    if (hasValue) rows.push(values);
  }

  const numericTotals = [];

  headers.forEach((header, index) => {
    const normalised = header.toLowerCase();
    const shouldTotal = /amount|total|balance|cost|price|value|sales|paid|quantity|qty|discount|profit|margin|stock/.test(
      normalised
    );

    if (!shouldTotal) return;

    let total = 0;
    let numericCount = 0;

    rows.forEach((row) => {
      const value = Number(row[index]);

      if (Number.isFinite(value)) {
        total += value;
        numericCount += 1;
      }
    });

    if (numericCount > 0) {
      numericTotals.push({
        label: header,
        total,
        currency: /amount|total|balance|cost|price|value|sales|paid|discount|profit|margin/.test(
          normalised
        ),
      });
    }
  });

  return {
    name: worksheet.name,
    headerRowIndex,
    columnCount,
    headers,
    rows,
    recordCount: rows.length,
    numericTotals: numericTotals.slice(0, 8),
  };
}

function analyseWorkbook(workbook) {
  return workbook.worksheets
    .filter((worksheet) => worksheet.name !== "00 Executive Summary")
    .map((worksheet) => analyseWorksheet(worksheet));
}

function styleProfessionalHeader(row) {
  row.height = 28;
  row.font = {
    bold: true,
    color: { argb: "FFFFFFFF" },
    size: 10,
  };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF071529" },
  };
  row.alignment = {
    vertical: "middle",
    horizontal: "center",
    wrapText: true,
  };

  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = {
      top: { style: "thin", color: { argb: "FF1F3B5B" } },
      left: { style: "thin", color: { argb: "FF1F3B5B" } },
      bottom: { style: "thin", color: { argb: "FF1F3B5B" } },
      right: { style: "thin", color: { argb: "FF1F3B5B" } },
    };
  });
}

function isCurrencyHeader(header) {
  return /amount|total|balance|cost|price|value|sales|paid|discount|profit|margin|expense/i.test(
    String(header || "")
  );
}

function isQuantityHeader(header) {
  return /quantity|qty|count|stock|items?/i.test(String(header || ""));
}

function applyDataSheetPresentation(worksheet, meta, analysis, baseName) {
  const simpleHeader = analysis.headerRowIndex === 1 && analysis.columnCount >= 2;
  let headerRowIndex = analysis.headerRowIndex;

  if (simpleHeader && baseName !== "daily-closings") {
    worksheet.insertRows(1, [[], [], [], [], [], []]);
    headerRowIndex = 7;

    const lastColumn = Math.max(analysis.columnCount, 1);
    worksheet.mergeCells(1, 1, 1, lastColumn);
    worksheet.mergeCells(2, 1, 2, lastColumn);
    worksheet.mergeCells(3, 1, 3, lastColumn);
    worksheet.mergeCells(4, 1, 4, lastColumn);
    worksheet.mergeCells(5, 1, 5, lastColumn);

    worksheet.getCell(1, 1).value = "CHALIN 03 COMPANY LIMITED";
    worksheet.getCell(2, 1).value = meta.reportTitle;
    worksheet.getCell(3, 1).value = `${meta.branch.code} - ${meta.branch.name}${
      meta.branch.location ? ` | ${meta.branch.location}` : ""
    }`;
    worksheet.getCell(4, 1).value = meta.periodBanner;
    worksheet.getCell(5, 1).value = `Generated: ${meta.generatedLabel} | By: ${meta.generatedBy}`;

    worksheet.getCell(1, 1).font = {
      bold: true,
      size: 16,
      color: { argb: "FFFFFFFF" },
    };
    worksheet.getCell(1, 1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF071529" },
    };
    worksheet.getCell(1, 1).alignment = {
      horizontal: "center",
      vertical: "middle",
    };
    worksheet.getRow(1).height = 30;

    worksheet.getCell(2, 1).font = {
      bold: true,
      size: 14,
      color: { argb: "FF173B68" },
    };
    worksheet.getCell(2, 1).alignment = { horizontal: "center" };
    worksheet.getRow(2).height = 25;

    worksheet.getCell(3, 1).font = {
      bold: true,
      size: 10,
      color: { argb: "FF334155" },
    };
    worksheet.getCell(3, 1).alignment = { horizontal: "center" };

    worksheet.getCell(4, 1).font = {
      bold: true,
      size: 13,
      color: { argb: "FF071529" },
    };
    worksheet.getCell(4, 1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE6B91E" },
    };
    worksheet.getCell(4, 1).alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
    worksheet.getCell(4, 1).border = {
      top: { style: "medium", color: { argb: "FF071529" } },
      bottom: { style: "medium", color: { argb: "FF071529" } },
    };
    worksheet.getRow(4).height = 28;

    worksheet.getCell(5, 1).font = {
      size: 9,
      color: { argb: "FF475569" },
    };
    worksheet.getCell(5, 1).alignment = { horizontal: "center" };
    worksheet.getRow(6).height = 8;
  }

  const headerRow = worksheet.getRow(headerRowIndex);
  styleProfessionalHeader(headerRow);

  worksheet.views = [{ state: "frozen", ySplit: headerRowIndex }];
  worksheet.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: headerRowIndex, column: Math.max(analysis.columnCount, 1) },
  };

  const startDataRow = headerRowIndex + 1;

  const endDataRow = headerRowIndex + analysis.rows.length;

  for (
    let rowNumber = startDataRow;
    rowNumber <= endDataRow;
    rowNumber += 1
  ) {
    const row = worksheet.getRow(rowNumber);
    row.alignment = { vertical: "top", wrapText: true };

    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const header = analysis.headers[columnNumber - 1] || "";

      cell.border = {
        top: { style: "hair", color: { argb: "FFD8E1EA" } },
        left: { style: "hair", color: { argb: "FFD8E1EA" } },
        bottom: { style: "hair", color: { argb: "FFD8E1EA" } },
        right: { style: "hair", color: { argb: "FFD8E1EA" } },
      };

      if ((rowNumber - startDataRow) % 2 === 1) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF4F7FB" },
        };
      }

      if (isCurrencyHeader(header) && typeof cell.value === "number") {
        cell.numFmt = '"GHS" #,##0.00;[Red]-"GHS" #,##0.00';
        cell.alignment = { vertical: "top", horizontal: "right" };
      } else if (isQuantityHeader(header) && typeof cell.value === "number") {
        cell.numFmt = "#,##0.00";
        cell.alignment = { vertical: "top", horizontal: "right" };
      }

      if (/status/i.test(header)) {
        const status = cleanText(getCellRawValue(cell)).toLowerCase();

        if (/paid|active|completed|received|balanced|approved|ok/.test(status)) {
          cell.font = { color: { argb: "FF166534" }, bold: true };
        } else if (/pending|partial|low|open|requested|dispatched/.test(status)) {
          cell.font = { color: { argb: "FF9A6700" }, bold: true };
        } else if (/void|cancel|out of stock|overdue|rejected|inactive/.test(status)) {
          cell.font = { color: { argb: "FFB91C1C" }, bold: true };
        }
      }
    });
  }

  worksheet.columns.forEach((column, index) => {
    let maxLength = Math.max(analysis.headers[index]?.length || 0, 10);

    analysis.rows.forEach((row) => {
      const length = formatExportValue(row[index]).length;
      maxLength = Math.max(maxLength, Math.min(length + 2, 42));
    });

    const minimumWidth = isCurrencyHeader(analysis.headers[index])
      ? 18
      : isQuantityHeader(analysis.headers[index])
      ? 14
      : 11;

    column.width = Math.min(Math.max(maxLength, minimumWidth), 42);
  });

  worksheet.pageSetup = {
    orientation: analysis.columnCount > 7 ? "landscape" : "portrait",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: {
      left: 0.25,
      right: 0.25,
      top: 0.5,
      bottom: 0.5,
      header: 0.2,
      footer: 0.2,
    },
    printTitlesRow: simpleHeader && baseName !== "daily-closings" ? "1:7" : `${headerRowIndex}:${headerRowIndex}`,
  };

  worksheet.headerFooter.oddHeader = `&C&B${meta.periodBanner}`;
  worksheet.headerFooter.oddFooter =
    `&LChalin 03 - ${meta.branch.code}&C${meta.reportTitle}&RPage &P of &N`;
}

function addExecutiveSummarySheet(workbook, meta, analysis) {
  const existing = workbook.getWorksheet("00 Executive Summary");

  if (existing) workbook.removeWorksheet(existing.id);

  const summary = workbook.addWorksheet("00 Executive Summary", {
    properties: { tabColor: { argb: "FFE6B91E" } },
  });

  summary.columns = [
    { key: "label", width: 34 },
    { key: "value", width: 28 },
    { key: "notes", width: 52 },
  ];

  summary.mergeCells("A1:C1");
  summary.getCell("A1").value = "CHALIN 03 COMPANY LIMITED";
  summary.getCell("A1").font = {
    bold: true,
    size: 18,
    color: { argb: "FFFFFFFF" },
  };
  summary.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF071529" },
  };
  summary.getCell("A1").alignment = { horizontal: "center" };
  summary.getRow(1).height = 34;

  summary.mergeCells("A2:C2");
  summary.getCell("A2").value = meta.reportTitle;
  summary.getCell("A2").font = {
    bold: true,
    size: 15,
    color: { argb: "FF173B68" },
  };
  summary.getCell("A2").alignment = { horizontal: "center" };

  summary.mergeCells("A3:C3");
  summary.getCell("A3").value = meta.periodBanner;
  summary.getCell("A3").font = {
    bold: true,
    size: 13,
    color: { argb: "FF071529" },
  };
  summary.getCell("A3").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE6B91E" },
  };
  summary.getCell("A3").alignment = {
    horizontal: "center",
    vertical: "middle",
    wrapText: true,
  };
  summary.getRow(3).height = 28;

  const information = [
    ["Selected Store", `${meta.branch.code} - ${meta.branch.name}`, meta.branch.location],
    ["Report Period", meta.periodLabel, "Date filters apply according to the selected report."],
    ["Generated", meta.generatedLabel, `Downloaded by ${meta.generatedBy}`],
    ["Report Sections", analysis.length, "Each worksheet is formatted for screen review and printing."],
    [
      "Total Detail Rows",
      analysis.reduce((sum, sheet) => sum + sheet.recordCount, 0),
      "Combined rows across all detail worksheets.",
    ],
  ];

  let rowNumber = 5;
  information.forEach(([label, value, notes]) => {
    summary.getCell(rowNumber, 1).value = label;
    summary.getCell(rowNumber, 2).value = value;
    summary.getCell(rowNumber, 3).value = notes || "";
    summary.getCell(rowNumber, 1).font = { bold: true, color: { argb: "FF173B68" } };
    rowNumber += 1;
  });

  rowNumber += 1;
  summary.getCell(rowNumber, 1).value = "WORKSHEET REGISTER";
  summary.mergeCells(rowNumber, 1, rowNumber, 3);
  summary.getCell(rowNumber, 1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  summary.getCell(rowNumber, 1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF173B68" },
  };
  rowNumber += 1;

  const registerHeader = summary.getRow(rowNumber);
  summary.getCell(rowNumber, 1).value = "Worksheet";
  summary.getCell(rowNumber, 2).value = "Detail Rows";
  summary.getCell(rowNumber, 3).value = "Key Totals Detected";
  styleProfessionalHeader(registerHeader);
  rowNumber += 1;

  analysis.forEach((sheet, index) => {
    const totalsText = sheet.numericTotals
      .slice(0, 4)
      .map((metric) => {
        const value = metric.currency
          ? `GHS ${metric.total.toLocaleString("en-GH", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`
          : metric.total.toLocaleString("en-GH", { maximumFractionDigits: 2 });

        return `${metric.label}: ${value}`;
      })
      .join(" | ");

    summary.getCell(rowNumber, 1).value = sheet.name;
    summary.getCell(rowNumber, 2).value = sheet.recordCount;
    summary.getCell(rowNumber, 3).value = totalsText || "See detail worksheet";

    if (index % 2 === 1) {
      summary.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF4F7FB" },
        };
      });
    }

    rowNumber += 1;
  });

  summary.eachRow((row, index) => {
    if (index > 2) {
      row.alignment = { vertical: "top", wrapText: true };
    }
  });

  summary.views = [{ state: "frozen", ySplit: 3 }];
  summary.pageSetup = {
    orientation: "landscape",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: {
      left: 0.35,
      right: 0.35,
      top: 0.5,
      bottom: 0.5,
      header: 0.2,
      footer: 0.2,
    },
  };
  summary.headerFooter.oddFooter =
    `&LChalin 03 - ${meta.branch.code}&C${meta.reportTitle}&RPage &P of &N`;
}

function prepareProfessionalWorkbook(workbook, meta, analysis, baseName) {
  addExecutiveSummarySheet(workbook, meta, analysis);

  workbook.worksheets.forEach((worksheet) => {
    if (worksheet.name === "00 Executive Summary") return;

    const sheetAnalysis =
      analysis.find((item) => item.name === worksheet.name) || analyseWorksheet(worksheet);

    applyDataSheetPresentation(worksheet, meta, sheetAnalysis, baseName);
  });

  workbook.creator = "Chalin 03 Group Operations Platform";
  workbook.lastModifiedBy = meta.generatedBy;
  workbook.company = "Chalin 03 Company Limited";
  workbook.subject = meta.reportTitle;
  workbook.title = `${meta.reportTitle} - ${meta.branch.code}`;
  workbook.description = `${meta.reportTitle} for ${meta.branch.code} - ${meta.branch.name}`;
  workbook.keywords = "Chalin 03, export, business report";
  workbook.modified = new Date();
}

function pdfSafeText(value) {
  return String(value ?? "")
    .replace(/₵/g, "GHS ")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildColumnBands(columnCount, maxColumns = 7) {
  if (columnCount <= maxColumns) {
    return [Array.from({ length: columnCount }, (_, index) => index)];
  }

  const fixed = [0, 1].filter((index) => index < columnCount);
  const remaining = [];

  for (let index = fixed.length; index < columnCount; index += 1) {
    remaining.push(index);
  }

  const chunkSize = Math.max(maxColumns - fixed.length, 1);
  const bands = [];

  for (let start = 0; start < remaining.length; start += chunkSize) {
    bands.push([...fixed, ...remaining.slice(start, start + chunkSize)]);
  }

  return bands;
}

function drawPdfDocumentHeader(doc, meta, sectionTitle, subtitle = "") {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.save();
  doc.rect(left, 34, width, 50).fill("#071529");
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(14);
  doc.text("CHALIN 03 COMPANY LIMITED", left + 12, 45, {
    width: width - 24,
    align: "center",
  });
  doc.fontSize(9).font("Helvetica");
  doc.text(
    `${pdfSafeText(meta.branch.code)} - ${pdfSafeText(meta.branch.name)}${
      meta.branch.location ? ` | ${pdfSafeText(meta.branch.location)}` : ""
    }`,
    left + 12,
    65,
    { width: width - 24, align: "center" }
  );
  doc.restore();

  doc.y = 96;
  doc.fillColor("#173b68").font("Helvetica-Bold").fontSize(15);
  doc.text(pdfSafeText(sectionTitle), { align: "center" });
  doc.moveDown(0.35);

  const periodY = doc.y;
  doc.save();
  doc.roundedRect(left, periodY, width, 30, 4).fill("#e6b91e");
  doc.fillColor("#071529").font("Helvetica-Bold").fontSize(10);
  doc.text(pdfSafeText(meta.periodBanner), left + 8, periodY + 9, {
    width: width - 16,
    align: "center",
    lineBreak: false,
  });
  doc.restore();
  doc.y = periodY + 36;

  if (subtitle) {
    doc.fillColor("#475569").font("Helvetica").fontSize(8);
    doc.text(pdfSafeText(subtitle), { align: "center" });
    doc.moveDown(0.25);
  }

  doc.moveDown(0.35);
}

function drawPdfTable(doc, sheet, columnIndexes) {
  const left = doc.page.margins.left;
  const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const columnWidth = availableWidth / Math.max(columnIndexes.length, 1);
  const headerHeight = 30;

  function drawHeader() {
    const startY = doc.y;

    columnIndexes.forEach((columnIndex, position) => {
      const x = left + position * columnWidth;
      doc.rect(x, startY, columnWidth, headerHeight).fillAndStroke("#173b68", "#d8e1ea");
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(6.7);
      doc.text(pdfSafeText(sheet.headers[columnIndex]), x + 3, startY + 5, {
        width: columnWidth - 6,
        height: headerHeight - 8,
        align: "center",
        ellipsis: true,
      });
    });

    doc.y = startY + headerHeight;
  }

  drawHeader();

  if (sheet.rows.length === 0) {
    doc.fillColor("#475569").font("Helvetica-Oblique").fontSize(9);
    doc.text("No records found for this report selection.", left, doc.y + 12, {
      width: availableWidth,
      align: "center",
    });
    doc.y += 40;
    return;
  }

  sheet.rows.forEach((row, rowIndex) => {
    const textValues = columnIndexes.map((columnIndex) =>
      pdfSafeText(formatExportValue(row[columnIndex]))
    );

    const lineCounts = textValues.map((value) =>
      Math.min(Math.max(Math.ceil(value.length / Math.max(columnWidth / 4.5, 8)), 1), 3)
    );
    const rowHeight = Math.min(Math.max(...lineCounts) * 8 + 8, 34);

    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 28) {
      doc.addPage({
        size: "A4",
        layout: columnIndexes.length > 5 ? "landscape" : "portrait",
        margins: { top: 34, bottom: 36, left: 28, right: 28 },
      });
      drawHeader();
    }

    const startY = doc.y;
    const fill = rowIndex % 2 === 0 ? "#ffffff" : "#f4f7fb";

    textValues.forEach((value, position) => {
      const x = left + position * columnWidth;
      doc.rect(x, startY, columnWidth, rowHeight).fillAndStroke(fill, "#d8e1ea");
      doc.fillColor("#172033").font("Helvetica").fontSize(6.5);
      doc.text(value, x + 3, startY + 4, {
        width: columnWidth - 6,
        height: rowHeight - 6,
        ellipsis: true,
      });
    });

    doc.y = startY + rowHeight;
  });
}

function sendProfessionalPdf(res, analysis, meta, filename) {
  const doc = new PDFDocument({
    size: "A4",
    layout: "portrait",
    margins: { top: 34, bottom: 36, left: 28, right: 28 },
    bufferPages: true,
    info: {
      Title: meta.reportTitle,
      Author: "Chalin 03 Company Limited",
      Subject: `${meta.reportTitle} - ${meta.branch.code}`,
    },
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  drawPdfDocumentHeader(doc, meta, meta.reportTitle, "Controlled auditor export");

  doc.fillColor("#172033").font("Helvetica").fontSize(10);
  doc.text(
    "This controlled export summarises the selected store records and presents each report section on readable print pages."
  );
  doc.moveDown(0.8);

  const coverRows = [
    ["Selected store", `${meta.branch.code} - ${meta.branch.name}`],
    ["Location", meta.branch.location || "Not recorded"],
    ["Report period", meta.periodLabel],
    ["Generated", meta.generatedLabel],
    ["Downloaded by", meta.generatedBy],
    ["Report sections", analysis.length],
    ["Total detail rows", analysis.reduce((sum, item) => sum + item.recordCount, 0)],
  ];

  coverRows.forEach(([label, value], index) => {
    const y = doc.y;
    const fill = index % 2 === 0 ? "#f4f7fb" : "#ffffff";
    doc.rect(doc.page.margins.left, y, 260, 24).fillAndStroke(fill, "#d8e1ea");
    doc.rect(doc.page.margins.left + 260, y, 247, 24).fillAndStroke(fill, "#d8e1ea");
    doc.fillColor("#173b68").font("Helvetica-Bold").fontSize(8);
    doc.text(pdfSafeText(label), doc.page.margins.left + 6, y + 7, { width: 248 });
    doc.fillColor("#172033").font("Helvetica");
    doc.text(pdfSafeText(formatExportValue(value)), doc.page.margins.left + 266, y + 7, {
      width: 235,
    });
    doc.y = y + 24;
  });

  analysis.forEach((sheet) => {
    const bands = buildColumnBands(sheet.columnCount, 7);

    bands.forEach((columnIndexes, bandIndex) => {
      doc.addPage({
        size: "A4",
        layout: columnIndexes.length > 5 ? "landscape" : "portrait",
        margins: { top: 34, bottom: 36, left: 28, right: 28 },
      });

      const bandLabel =
        bands.length > 1 ? ` - Column Group ${bandIndex + 1} of ${bands.length}` : "";
      drawPdfDocumentHeader(
        doc,
        meta,
        `${sheet.name}${bandLabel}`,
        `${sheet.recordCount} detail row(s)`
      );
      drawPdfTable(doc, sheet, columnIndexes);
    });
  });

  const pageRange = doc.bufferedPageRange();

  for (let pageIndex = 0; pageIndex < pageRange.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    const footerY = doc.page.height - 22;
    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor("#64748b").font("Helvetica").fontSize(7);
    doc.text(
      `Chalin 03 | ${pdfSafeText(meta.branch.code)} | ${pdfSafeText(
        meta.reportTitle
      )} | Page ${pageIndex + 1} of ${pageRange.count}`,
      doc.page.margins.left,
      footerY,
      {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
        lineBreak: false,
      }
    );
    doc.page.margins.bottom = originalBottomMargin;
  }

  doc.end();
}

function buildWordTable(sheet, columnIndexes) {
  const header = columnIndexes
    .map((columnIndex) => `<th>${escapeHtml(sheet.headers[columnIndex])}</th>`)
    .join("");

  const rows = sheet.rows.length
    ? sheet.rows
        .map(
          (row) =>
            `<tr>${columnIndexes
              .map(
                (columnIndex) =>
                  `<td>${escapeHtml(formatExportValue(row[columnIndex]))}</td>`
              )
              .join("")}</tr>`
        )
        .join("")
    : `<tr><td colspan="${columnIndexes.length}" class="empty">No records found for this report selection.</td></tr>`;

  return `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
}

function sendProfessionalWord(res, analysis, meta, filename) {
  const sections = [];

  analysis.forEach((sheet) => {
    const bands = buildColumnBands(sheet.columnCount, 8);

    bands.forEach((columnIndexes, bandIndex) => {
      const bandLabel =
        bands.length > 1 ? ` - Column Group ${bandIndex + 1} of ${bands.length}` : "";

      sections.push(`
        <section class="report-section page-break">
          <div class="brand">CHALIN 03 COMPANY LIMITED</div>
          <h2>${escapeHtml(sheet.name + bandLabel)}</h2>
          <div class="period-banner">${escapeHtml(meta.periodBanner)}</div>
          <p class="section-meta">${escapeHtml(
            `${meta.branch.code} - ${meta.branch.name} | ${sheet.recordCount} detail row(s)`
          )}</p>
          ${buildWordTable(sheet, columnIndexes)}
        </section>
      `);
    });
  });

  const registerRows = analysis
    .map(
      (sheet) => `<tr><td>${escapeHtml(sheet.name)}</td><td>${sheet.recordCount}</td><td>${escapeHtml(
        sheet.numericTotals
          .slice(0, 3)
          .map((metric) => `${metric.label}: ${formatExportValue(metric.total)}`)
          .join(" | ") || "See detail section"
      )}</td></tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(meta.reportTitle)}</title>
<style>
  @page { size: A4 landscape; margin: 0.45in; }
  body { font-family: Calibri, Arial, sans-serif; color: #172033; font-size: 9pt; }
  .cover { text-align: center; padding-top: 35px; }
  .brand { background: #071529; color: #fff; padding: 14px; font-size: 17pt; font-weight: 700; text-align: center; }
  h1 { color: #173b68; font-size: 21pt; margin: 24px 0 8px; }
  h2 { color: #173b68; font-size: 15pt; text-align: center; margin: 12px 0 4px; }
  .subtitle, .section-meta { color: #475569; text-align: center; }
  .period-banner { margin: 12px auto; padding: 10px 12px; background: #e6b91e; color: #071529; border: 2px solid #071529; font-size: 12pt; font-weight: 700; text-align: center; }
  .meta { width: 78%; margin: 25px auto; border-collapse: collapse; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 12px; }
  th { background: #173b68; color: #fff; font-weight: 700; padding: 5px; border: 1px solid #9fb0c3; font-size: 8pt; }
  td { border: 1px solid #ccd7e3; padding: 4px; vertical-align: top; overflow-wrap: anywhere; }
  tbody tr:nth-child(even) td { background: #f4f7fb; }
  .meta td:first-child { font-weight: 700; color: #173b68; width: 35%; }
  .page-break { page-break-before: always; }
  .empty { text-align: center; color: #64748b; font-style: italic; padding: 18px; }
  .footer-note { margin-top: 18px; color: #64748b; font-size: 8pt; text-align: center; }
</style>
</head>
<body>
  <section class="cover">
    <div class="brand">CHALIN 03 COMPANY LIMITED</div>
    <h1>${escapeHtml(meta.reportTitle)}</h1>
    <div class="period-banner">${escapeHtml(meta.periodBanner)}</div>
    <p class="subtitle">Professional Microsoft Word Export</p>
    <table class="meta">
      <tr><td>Selected Store</td><td>${escapeHtml(`${meta.branch.code} - ${meta.branch.name}`)}</td></tr>
      <tr><td>Location</td><td>${escapeHtml(meta.branch.location || "Not recorded")}</td></tr>
      <tr><td>Report Period</td><td>${escapeHtml(meta.periodLabel)}</td></tr>
      <tr><td>Generated</td><td>${escapeHtml(meta.generatedLabel)}</td></tr>
      <tr><td>Downloaded By</td><td>${escapeHtml(meta.generatedBy)}</td></tr>
      <tr><td>Total Detail Rows</td><td>${analysis.reduce(
        (sum, item) => sum + item.recordCount,
        0
      )}</td></tr>
    </table>
    <h2>Report Section Register</h2>
    <table>
      <thead><tr><th>Section</th><th>Rows</th><th>Key Totals</th></tr></thead>
      <tbody>${registerRows}</tbody>
    </table>
  </section>
  ${sections.join("\n")}
  <p class="footer-note">Generated by the Chalin 03 Group Operations Platform. Review figures against source records before external submission.</p>
</body>
</html>`;

  res.setHeader("Content-Type", "application/msword; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(Buffer.from(html, "utf8"));
}

async function sendWorkbook(res, workbook, filename) {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  await workbook.xlsx.write(res);
  res.end();
}

async function sendStoreWorkbook(req, res, workbook, baseName) {
  const branchId = getBranchId(req);
  const branch = await getBranchDetails(branchId);
  const format = getExportFormat(req.query.format);
  const reportTitle = getReportTitle(baseName);
  removeBlankStringCells(workbook);
  const analysis = analyseWorkbook(workbook);
  const generatedBy =
    req.user?.full_name || req.user?.name || req.user?.username || "Authorized user";
  const period = getDateRangeMeta(
    cleanText(req.query.from),
    cleanText(req.query.to),
    analysis
  );
  const meta = {
    branch,
    reportTitle,
    ...period,
    generatedLabel: new Date().toLocaleString("en-GB", {
      timeZone: "Africa/Accra",
    }),
    generatedBy,
  };
  const safeBranch = safeFilenamePart(branch.code || branch.name);
  const safeBase = safeFilenamePart(baseName);
  const periodFilename = meta.filenamePart ? `-${meta.filenamePart}` : "";

  if (format === "pdf") {
    return sendProfessionalPdf(
      res,
      analysis,
      meta,
      `chalin03-${safeBranch}-${safeBase}${periodFilename}.pdf`
    );
  }

  if (format === "doc") {
    return sendProfessionalWord(
      res,
      analysis,
      meta,
      `chalin03-${safeBranch}-${safeBase}${periodFilename}.doc`
    );
  }

  prepareProfessionalWorkbook(workbook, meta, analysis, baseName);

  return sendWorkbook(
    res,
    workbook,
    `chalin03-${safeBranch}-${safeBase}${periodFilename}.xlsx`
  );
}


// GET /api/exports/products
router.get(
  "/products",
  requireAuth,
  requireRole("admin", "manager", "auditor"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);

      const [products] = await pool.query(
        `SELECT
          id,
          branch_id,
          name,
          size,
          category,
          cost_price,
          selling_price,
          quantity,
          low_stock_threshold,
          barcode,
          is_active,
          created_at
         FROM products
         WHERE branch_id = ?
         ORDER BY name ASC`,
        [branchId]
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Products");

      worksheet.columns = [
        { header: "ID", key: "id" },
        { header: "Store ID", key: "branch_id" },
        { header: "Product Name", key: "name" },
        { header: "Size", key: "size" },
        { header: "Category", key: "category" },
        { header: "Cost Price", key: "cost_price" },
        { header: "Selling Price", key: "selling_price" },
        { header: "Quantity", key: "quantity" },
        { header: "Low Stock Level", key: "low_stock_threshold" },
        { header: "Barcode", key: "barcode" },
        { header: "Status", key: "status" },
        { header: "Created At", key: "created_at" },
      ];

      products.forEach((product) => {
        worksheet.addRow({
          id: product.id,
          branch_id: product.branch_id,
          name: product.name,
          size: product.size || "",
          category: product.category || "",
          cost_price: Number(product.cost_price || 0),
          selling_price: Number(product.selling_price || 0),
          quantity: Number(product.quantity || 0),
          low_stock_threshold: Number(product.low_stock_threshold || 0),
          barcode: product.barcode || "",
          status: product.is_active ? "Active" : "Inactive",
          created_at: formatDateTime(product.created_at),
        });
      });

      styleWorksheet(worksheet);

      return sendStoreWorkbook(req, res, workbook, "products");
    } catch (error) {
      console.error("Export products error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while exporting products.",
      });
    }
  }
);

// GET /api/exports/low-stock
router.get(
  "/low-stock",
  requireAuth,
  requireRole("admin", "manager", "auditor"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);

      const [products] = await pool.query(
        `SELECT
          id,
          branch_id,
          name,
          size,
          category,
          cost_price,
          selling_price,
          quantity,
          low_stock_threshold,
          barcode,
          CASE
            WHEN quantity = 0 THEN 'out_of_stock'
            WHEN quantity <= low_stock_threshold THEN 'low_stock'
            ELSE 'ok'
          END AS stock_status,
          GREATEST((low_stock_threshold * 2) - quantity, 0) AS suggested_restock_quantity,
          GREATEST((low_stock_threshold * 2) - quantity, 0) * cost_price AS estimated_restock_cost
         FROM products
         WHERE branch_id = ?
         AND is_active = TRUE
         AND quantity <= low_stock_threshold
         ORDER BY quantity ASC, name ASC`,
        [branchId]
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Low Stock / Restock List");

      worksheet.columns = [
        { header: "Product Name", key: "name" },
        { header: "Size", key: "size" },
        { header: "Category", key: "category" },
        { header: "Current Quantity", key: "quantity" },
        { header: "Low Stock Level", key: "low_stock_threshold" },
        { header: "Stock Status", key: "stock_status" },
        { header: "Suggested Buy Quantity", key: "suggested_restock_quantity" },
        { header: "Cost Price", key: "cost_price" },
        { header: "Selling Price", key: "selling_price" },
        { header: "Estimated Restock Cost", key: "estimated_restock_cost" },
        { header: "Barcode", key: "barcode" },
      ];

      products.forEach((product) => {
        worksheet.addRow({
          name: product.name || "",
          size: product.size || "",
          category: product.category || "",
          quantity: Number(product.quantity || 0),
          low_stock_threshold: Number(product.low_stock_threshold || 0),
          stock_status:
            product.stock_status === "out_of_stock"
              ? "Out of Stock"
              : product.stock_status === "low_stock"
              ? "Low Stock"
              : "OK",
          suggested_restock_quantity: Number(
            product.suggested_restock_quantity || 0
          ),
          cost_price: Number(product.cost_price || 0),
          selling_price: Number(product.selling_price || 0),
          estimated_restock_cost: Number(product.estimated_restock_cost || 0),
          barcode: product.barcode || "",
        });
      });

      const summaryWorksheet = workbook.addWorksheet("Restock Summary");

      const outOfStockItems = products.filter(
        (product) => Number(product.quantity || 0) === 0
      );

      const lowStockItems = products.filter(
        (product) => Number(product.quantity || 0) > 0
      );

      const totalSuggestedQuantity = products.reduce(
        (sum, product) =>
          sum + Number(product.suggested_restock_quantity || 0),
        0
      );

      const totalEstimatedRestockCost = products.reduce(
        (sum, product) => sum + Number(product.estimated_restock_cost || 0),
        0
      );

      summaryWorksheet.columns = [
        { header: "Metric", key: "metric" },
        { header: "Value", key: "value" },
      ];

      summaryWorksheet.addRow({
        metric: "Total low stock items",
        value: products.length,
      });

      summaryWorksheet.addRow({
        metric: "Out of stock items",
        value: outOfStockItems.length,
      });

      summaryWorksheet.addRow({
        metric: "Low stock items",
        value: lowStockItems.length,
      });

      summaryWorksheet.addRow({
        metric: "Total suggested buy quantity",
        value: totalSuggestedQuantity,
      });

      summaryWorksheet.addRow({
        metric: "Estimated restock cost",
        value: Number(totalEstimatedRestockCost.toFixed(2)),
      });

      styleWorksheet(worksheet);
      styleWorksheet(summaryWorksheet);

      return sendStoreWorkbook(req, res, workbook, "low-stock-restock");
    } catch (error) {
      console.error("Export low stock error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while exporting low stock products.",
      });
    }
  }
);

// GET /api/exports/stock-adjustments
router.get(
  "/stock-adjustments",
  requireAuth,
  requireRole("admin", "manager", "auditor"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const from = cleanText(req.query.from);
      const to = cleanText(req.query.to);

      const params = [branchId];
      const dateFilter = buildDateFilter("sa", "adjusted_at", from, to, params);

      const [adjustments] = await pool.query(
        `SELECT
          sa.id,
          sa.branch_id,
          sa.adjustment_type,
          sa.quantity,
          sa.old_quantity,
          sa.new_quantity,
          sa.reason,
          sa.adjusted_at,
          p.name AS product_name,
          p.category AS product_category,
          p.size AS product_size,
          u.full_name AS adjusted_by_name
         FROM stock_adjustments sa
         INNER JOIN products p
          ON sa.product_id = p.id
          AND p.branch_id = sa.branch_id
         LEFT JOIN users u ON sa.adjusted_by = u.id
         WHERE sa.branch_id = ?
         ${dateFilter}
         ORDER BY sa.adjusted_at DESC, sa.id DESC`,
        params
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Stock Adjustments");

      worksheet.columns = [
        { header: "Date", key: "adjusted_at" },
        { header: "Product", key: "product_name" },
        { header: "Size", key: "product_size" },
        { header: "Category", key: "product_category" },
        { header: "Adjustment Type", key: "adjustment_type" },
        { header: "Adjustment Quantity", key: "quantity" },
        { header: "Old Quantity", key: "old_quantity" },
        { header: "New Quantity", key: "new_quantity" },
        { header: "Reason", key: "reason" },
        { header: "Adjusted By", key: "adjusted_by_name" },
      ];

      adjustments.forEach((adjustment) => {
        worksheet.addRow({
          adjusted_at: formatDateTime(adjustment.adjusted_at),
          product_name: adjustment.product_name || "",
          product_size: adjustment.product_size || "",
          product_category: adjustment.product_category || "",
          adjustment_type: adjustment.adjustment_type || "",
          quantity: Number(adjustment.quantity || 0),
          old_quantity: Number(adjustment.old_quantity || 0),
          new_quantity: Number(adjustment.new_quantity || 0),
          reason: adjustment.reason || "",
          adjusted_by_name: adjustment.adjusted_by_name || "",
        });
      });

      const summaryWorksheet = workbook.addWorksheet("Adjustment Summary");

      const increases = adjustments.filter(
        (item) => item.adjustment_type === "increase"
      );

      const decreases = adjustments.filter(
        (item) => item.adjustment_type === "decrease"
      );

      const setAdjustments = adjustments.filter(
        (item) => item.adjustment_type === "set"
      );

      const totalIncreaseQuantity = increases.reduce(
        (sum, item) => sum + Number(item.quantity || 0),
        0
      );

      const totalDecreaseQuantity = decreases.reduce(
        (sum, item) => sum + Number(item.quantity || 0),
        0
      );

      summaryWorksheet.columns = [
        { header: "Metric", key: "metric" },
        { header: "Value", key: "value" },
      ];

      summaryWorksheet.addRow({
        metric: "Adjustments exported",
        value: adjustments.length,
      });

      summaryWorksheet.addRow({
        metric: "Increase adjustments",
        value: increases.length,
      });

      summaryWorksheet.addRow({
        metric: "Total quantity increased",
        value: totalIncreaseQuantity,
      });

      summaryWorksheet.addRow({
        metric: "Decrease adjustments",
        value: decreases.length,
      });

      summaryWorksheet.addRow({
        metric: "Total quantity decreased",
        value: totalDecreaseQuantity,
      });

      summaryWorksheet.addRow({
        metric: "Set stock adjustments",
        value: setAdjustments.length,
      });

      styleWorksheet(worksheet);
      styleWorksheet(summaryWorksheet);

      return sendStoreWorkbook(req, res, workbook, "stock-adjustments");
    } catch (error) {
      console.error("Export stock adjustments error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while exporting stock adjustments.",
      });
    }
  }
);

// GET /api/exports/debt-payments
router.get(
  "/debt-payments",
  requireAuth,
  requireRole("admin", "manager", "auditor"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const from = cleanText(req.query.from);
      const to = cleanText(req.query.to);

      const params = [branchId];
      const dateFilter = buildDateFilter("dp", "paid_at", from, to, params);

      const [payments] = await pool.query(
        `SELECT
          dp.id,
          dp.branch_id,
          dp.debt_id,
          dp.amount,
          dp.payment_method,
          dp.paid_at,
          dp.notes,
          d.customer_name,
          d.customer_phone,
          d.amount_owed,
          d.amount_paid,
          d.balance,
          d.status,
          s.receipt_number,
          u.full_name AS received_by_name
         FROM debt_payments dp
         INNER JOIN debts d
          ON dp.debt_id = d.id
          AND d.branch_id = dp.branch_id
         LEFT JOIN sales s
          ON d.sale_id = s.id
          AND s.branch_id = d.branch_id
         LEFT JOIN users u ON dp.received_by = u.id
         WHERE dp.branch_id = ?
         ${dateFilter}
         ORDER BY dp.paid_at DESC, dp.id DESC`,
        params
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Debt Payments");

      worksheet.columns = [
        { header: "Payment Date", key: "paid_at" },
        { header: "Payment ID", key: "id" },
        { header: "Debt ID", key: "debt_id" },
        { header: "Receipt Number", key: "receipt_number" },
        { header: "Customer", key: "customer_name" },
        { header: "Phone", key: "customer_phone" },
        { header: "Amount Paid", key: "amount" },
        { header: "Payment Method", key: "payment_method" },
        { header: "Received By", key: "received_by_name" },
        { header: "Total Debt", key: "amount_owed" },
        { header: "Debt Total Paid", key: "amount_paid" },
        { header: "Remaining Balance", key: "balance" },
        { header: "Debt Status", key: "status" },
        { header: "Notes", key: "notes" },
      ];

      payments.forEach((payment) => {
        worksheet.addRow({
          paid_at: formatDateTime(payment.paid_at),
          id: payment.id,
          debt_id: payment.debt_id,
          receipt_number: payment.receipt_number || "",
          customer_name: payment.customer_name || "",
          customer_phone: payment.customer_phone || "",
          amount: Number(payment.amount || 0),
          payment_method: payment.payment_method || "",
          received_by_name: payment.received_by_name || "",
          amount_owed: Number(payment.amount_owed || 0),
          amount_paid: Number(payment.amount_paid || 0),
          balance: Number(payment.balance || 0),
          status: payment.status || "",
          notes: payment.notes || "",
        });
      });

      const summaryWorksheet = workbook.addWorksheet("Debt Payment Summary");

      const totalPayments = payments.reduce(
        (sum, payment) => sum + Number(payment.amount || 0),
        0
      );

      const cashTotal = payments
        .filter((payment) => payment.payment_method === "cash")
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

      const momoTotal = payments
        .filter((payment) => payment.payment_method === "momo")
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

      const bankTotal = payments
        .filter((payment) => payment.payment_method === "bank")
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

      summaryWorksheet.columns = [
        { header: "Metric", key: "metric" },
        { header: "Value", key: "value" },
      ];

      summaryWorksheet.addRow({
        metric: "Payments exported",
        value: payments.length,
      });

      summaryWorksheet.addRow({
        metric: "Total amount received",
        value: totalPayments,
      });

      summaryWorksheet.addRow({
        metric: "Cash total",
        value: cashTotal,
      });

      summaryWorksheet.addRow({
        metric: "MoMo total",
        value: momoTotal,
      });

      summaryWorksheet.addRow({
        metric: "Bank total",
        value: bankTotal,
      });

      styleWorksheet(worksheet);
      styleWorksheet(summaryWorksheet);

      return sendStoreWorkbook(req, res, workbook, "debt-payments");
    } catch (error) {
      console.error("Export debt payments error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while exporting debt payments.",
      });
    }
  }
);

// GET /api/exports/daily-closings
router.get(
  "/daily-closings",
  requireAuth,
  requireRole("admin", "manager", "auditor"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const from = cleanText(req.query.from);
      const to = cleanText(req.query.to);

      const params = [branchId];
      const dateFilter = buildDateFilter("dc", "closing_date", from, to, params);

      const [closings] = await pool.query(
        `SELECT
          dc.*,
          u.full_name AS closed_by_name,
          b.code AS branch_code,
          b.name AS branch_name,
          b.location AS branch_location
         FROM daily_closings dc
         LEFT JOIN users u ON dc.closed_by = u.id
         LEFT JOIN branches b ON dc.branch_id = b.id
         WHERE dc.branch_id = ?
         ${dateFilter}
         ORDER BY dc.closing_date ASC`,
        params
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 Group Operations Platform";
      workbook.company = "Chalin 03 Company Limited";
      workbook.created = new Date();

      const money = (value) => {
        const number = Number(value || 0);
        return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
      };
      const varianceStatus = (value) => {
        const difference = money(value);
        if (Math.abs(difference) < 0.01) return "Balanced";
        return difference > 0 ? "Over" : "Short";
      };
      const creditCreated = (closing) =>
        Math.max(
          0,
          money(closing.credit_sales_total) -
            money(closing.credit_sales_received)
        );
      const moneyFormat = '"GHS" #,##0.00;[Red]-"GHS" #,##0.00';

      const styleTitle = (sheet, range, value) => {
        sheet.mergeCells(range);
        const cell = sheet.getCell(range.split(":")[0]);
        cell.value = value;
        cell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF0B1F35" },
        };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        sheet.getRow(cell.row).height = 30;
      };

      const styleSection = (row, fill = "173F5F") => {
        row.font = { bold: true, color: { argb: "FFFFFFFF" } };
        row.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: `FF${fill}` },
        };
        row.alignment = {
          horizontal: "center",
          vertical: "middle",
          wrapText: true,
        };
        row.height = 24;
      };

      const styleHeader = (row) => {
        row.font = { bold: true, color: { argb: "FFFFFFFF" } };
        row.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF235789" },
        };
        row.alignment = {
          horizontal: "center",
          vertical: "middle",
          wrapText: true,
        };
        row.height = 30;
        row.eachCell((cell) => {
          cell.border = {
            top: { style: "thin", color: { argb: "FFB9C8D8" } },
            left: { style: "thin", color: { argb: "FFB9C8D8" } },
            bottom: { style: "thin", color: { argb: "FFB9C8D8" } },
            right: { style: "thin", color: { argb: "FFB9C8D8" } },
          };
        });
      };

      const styleBody = (sheet, startRow, endRow, startColumn, endColumn) => {
        if (endRow < startRow) return;
        for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
          const row = sheet.getRow(rowNumber);
          for (
            let columnNumber = startColumn;
            columnNumber <= endColumn;
            columnNumber += 1
          ) {
            const cell = row.getCell(columnNumber);
            cell.border = {
              top: { style: "thin", color: { argb: "FFD7E0E8" } },
              left: { style: "thin", color: { argb: "FFD7E0E8" } },
              bottom: { style: "thin", color: { argb: "FFD7E0E8" } },
              right: { style: "thin", color: { argb: "FFD7E0E8" } },
            };
            cell.alignment = { vertical: "top", wrapText: true };
            if (rowNumber % 2 === 0) {
              cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFF8FAFC" },
              };
            }
          }
        }
      };

      const setPrintSetup = (sheet, orientation = "landscape") => {
        sheet.pageSetup = {
          orientation,
          paperSize: 9,
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          margins: {
            left: 0.25,
            right: 0.25,
            top: 0.5,
            bottom: 0.5,
            header: 0.2,
            footer: 0.2,
          },
        };
        sheet.headerFooter.oddFooter =
          `Chalin 03 Daily Closings | &D &T | Page &P of &N`;
      };

      const firstClosing = closings[0] || {};
      const branchCode =
        firstClosing.branch_code || (await getBranchLabel(branchId));
      const branchName = firstClosing.branch_name || branchCode;
      const branchLocation = firstClosing.branch_location || "";
      const firstDate = closings.length
        ? formatDate(closings[0].closing_date)
        : from || "-";
      const lastDate = closings.length
        ? formatDate(closings[closings.length - 1].closing_date)
        : to || "-";
      const periodLabel =
        firstDate === lastDate ? firstDate : `${firstDate} to ${lastDate}`;

      const totals = closings.reduce(
        (result, closing) => {
          result.sales_count += Number(closing.sales_count || 0);
          result.sales_total += money(closing.sales_total);
          result.sales_received += money(closing.sales_received);
          result.credit_created += creditCreated(closing);
          result.debt_payments_total += money(closing.debt_payments_total);
          result.expenses_total += money(closing.expenses_total);
          result.expected_total += money(closing.expected_total);
          result.total_counted += money(closing.total_counted);
          result.difference_total += money(closing.difference_total);
          const status = varianceStatus(closing.difference_total);
          if (status === "Balanced") result.balanced += 1;
          if (status === "Over") result.over += 1;
          if (status === "Short") result.short += 1;
          return result;
        },
        {
          sales_count: 0,
          sales_total: 0,
          sales_received: 0,
          credit_created: 0,
          debt_payments_total: 0,
          expenses_total: 0,
          expected_total: 0,
          total_counted: 0,
          difference_total: 0,
          balanced: 0,
          over: 0,
          short: 0,
        }
      );

      const summarySheet = workbook.addWorksheet("Period Summary");
      summarySheet.views = [{ state: "frozen", ySplit: 5 }];
      summarySheet.columns = [
        { width: 28 },
        { width: 20 },
        { width: 4 },
        { width: 28 },
        { width: 20 },
        { width: 4 },
      ];
      setPrintSetup(summarySheet, "portrait");
      styleTitle(
        summarySheet,
        "A1:F1",
        "CHALIN 03 COMPANY LIMITED - DAILY CLOSING PERIOD REPORT"
      );
      summarySheet.mergeCells("A2:F2");
      summarySheet.getCell("A2").value = `${branchCode} - ${branchName}`;
      summarySheet.getCell("A2").font = {
        bold: true,
        size: 13,
        color: { argb: "FF0B1F35" },
      };
      summarySheet.getCell("A2").alignment = { horizontal: "center" };
      summarySheet.mergeCells("A3:F3");
      summarySheet.getCell("A3").value = branchLocation;
      summarySheet.getCell("A3").alignment = { horizontal: "center" };
      summarySheet.mergeCells("A4:F4");
      summarySheet.getCell("A4").value = `Period: ${periodLabel}`;
      summarySheet.getCell("A4").font = {
        bold: true,
        color: { argb: "FF235789" },
      };
      summarySheet.getCell("A4").alignment = { horizontal: "center" };

      summarySheet.getRow(6).values = [
        "Operational Summary",
        "Value",
        null,
        "Financial Summary",
        "Value",
      ];
      styleSection(summarySheet.getRow(6));

      const summaryPairs = [
        [
          ["Closing records", closings.length, false],
          ["Gross sales", totals.sales_total, true],
        ],
        [
          ["Sales transactions", totals.sales_count, false],
          ["Received during sales", totals.sales_received, true],
        ],
        [
          ["Balanced days", totals.balanced, false],
          ["Credit created", totals.credit_created, true],
        ],
        [
          ["Over days", totals.over, false],
          ["Debt collections", totals.debt_payments_total, true],
        ],
        [
          ["Short days", totals.short, false],
          ["Expenses", totals.expenses_total, true],
        ],
        [
          ["Period result", varianceStatus(totals.difference_total), false],
          ["Expected settlement", totals.expected_total, true],
        ],
        [
          ["Exported at", formatDateTime(new Date()), false],
          ["Counted total", totals.total_counted, true],
        ],
        [
          ["Store code", branchCode, false],
          ["Net variance", totals.difference_total, true],
        ],
      ];

      summaryPairs.forEach((pair, index) => {
        const rowNumber = 7 + index;
        const row = summarySheet.getRow(rowNumber);
        row.getCell(1).value = pair[0][0];
        row.getCell(2).value = pair[0][1];
        row.getCell(4).value = pair[1][0];
        row.getCell(5).value = pair[1][1];
        row.getCell(1).font = { bold: true };
        row.getCell(4).font = { bold: true };
        if (pair[0][2]) row.getCell(2).numFmt = moneyFormat;
        if (pair[1][2]) row.getCell(5).numFmt = moneyFormat;
      });
      styleBody(summarySheet, 7, 14, 1, 5);

      summarySheet.mergeCells("A17:F17");
      summarySheet.getCell("A17").value = "HOW TO READ THIS EXPORT";
      styleSection(summarySheet.getRow(17), "9B6A16");
      const guidance = [
        "Closing Register gives one clear management row for each closed day.",
        "Sales Mix separates cash, mobile money, bank, mixed and credit activity.",
        "Channel Reconciliation shows expected, counted and variance by payment channel.",
        "Control Notes contains remarks and closing ownership without making the main report too wide.",
        "For transaction-by-transaction sales grouped like the previous system, open a date on Daily Closing and use Excel, PDF or Word.",
      ];
      guidance.forEach((line, index) => {
        const rowNumber = 18 + index;
        summarySheet.mergeCells(rowNumber, 1, rowNumber, 6);
        summarySheet.getCell(rowNumber, 1).value = `• ${line}`;
        summarySheet.getCell(rowNumber, 1).alignment = {
          wrapText: true,
          vertical: "top",
        };
        summarySheet.getRow(rowNumber).height = 26;
      });

      const registerSheet = workbook.addWorksheet("Closing Register");
      registerSheet.views = [{ state: "frozen", ySplit: 5 }];
      registerSheet.columns = [
        { width: 13 },
        { width: 13 },
        { width: 11 },
        { width: 16 },
        { width: 18 },
        { width: 16 },
        { width: 16 },
        { width: 14 },
        { width: 18 },
        { width: 15 },
        { width: 14 },
        { width: 22 },
        { width: 20 },
      ];
      setPrintSetup(registerSheet, "landscape");
      styleTitle(registerSheet, "A1:M1", "DAILY CLOSING REGISTER");
      registerSheet.mergeCells("A2:M2");
      registerSheet.getCell("A2").value = `${branchCode} - ${branchName} | ${periodLabel}`;
      registerSheet.getCell("A2").alignment = { horizontal: "center" };
      registerSheet.getCell("A2").font = { bold: true };
      registerSheet.getRow(4).values = [
        "Closing Date",
        "Status",
        "Sales Count",
        "Gross Sales",
        "Received at Sale",
        "Credit Created",
        "Debt Collected",
        "Expenses",
        "Expected Settlement",
        "Counted",
        "Variance",
        "Closed By",
        "Closed At",
      ];
      styleHeader(registerSheet.getRow(4));

      closings.forEach((closing, index) => {
        const row = registerSheet.getRow(5 + index);
        row.values = [
          formatDate(closing.closing_date),
          varianceStatus(closing.difference_total),
          Number(closing.sales_count || 0),
          money(closing.sales_total),
          money(closing.sales_received),
          creditCreated(closing),
          money(closing.debt_payments_total),
          money(closing.expenses_total),
          money(closing.expected_total),
          money(closing.total_counted),
          money(closing.difference_total),
          closing.closed_by_name || "",
          formatDateTime(closing.closed_at),
        ];
        [4, 5, 6, 7, 8, 9, 10, 11].forEach((column) => {
          row.getCell(column).numFmt = moneyFormat;
        });
        const statusCell = row.getCell(2);
        const status = varianceStatus(closing.difference_total);
        statusCell.font = {
          bold: true,
          color: {
            argb:
              status === "Balanced"
                ? "FF166534"
                : status === "Over"
                ? "FF9A3412"
                : "FFB91C1C",
          },
        };
      });
      styleBody(registerSheet, 5, 4 + closings.length, 1, 13);
      registerSheet.autoFilter = `A4:M${Math.max(4, 4 + closings.length)}`;

      const registerTotalRow = registerSheet.getRow(5 + closings.length);
      registerTotalRow.values = [
        "PERIOD TOTAL",
        varianceStatus(totals.difference_total),
        totals.sales_count,
        totals.sales_total,
        totals.sales_received,
        totals.credit_created,
        totals.debt_payments_total,
        totals.expenses_total,
        totals.expected_total,
        totals.total_counted,
        totals.difference_total,
        "",
        "",
      ];
      registerTotalRow.font = { bold: true };
      registerTotalRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFF3CD" },
      };
      [4, 5, 6, 7, 8, 9, 10, 11].forEach((column) => {
        registerTotalRow.getCell(column).numFmt = moneyFormat;
      });

      const salesMixSheet = workbook.addWorksheet("Sales Mix");
      salesMixSheet.views = [{ state: "frozen", ySplit: 5 }];
      salesMixSheet.columns = [
        { width: 13 },
        { width: 15 },
        { width: 15 },
        { width: 15 },
        { width: 15 },
        { width: 16 },
        { width: 17 },
        { width: 18 },
        { width: 16 },
        { width: 18 },
      ];
      setPrintSetup(salesMixSheet, "landscape");
      styleTitle(salesMixSheet, "A1:J1", "SALES PAYMENT MIX");
      salesMixSheet.mergeCells("A2:J2");
      salesMixSheet.getCell("A2").value = `${branchCode} - ${branchName} | ${periodLabel}`;
      salesMixSheet.getCell("A2").alignment = { horizontal: "center" };
      salesMixSheet.getCell("A2").font = { bold: true };
      salesMixSheet.getRow(4).values = [
        "Closing Date",
        "Cash Received",
        "MoMo Received",
        "Bank Received",
        "Mixed Received",
        "Credit Sales",
        "Credit Received",
        "Credit Outstanding",
        "Net Sales",
        "Received at Sale",
      ];
      styleHeader(salesMixSheet.getRow(4));

      closings.forEach((closing, index) => {
        const row = salesMixSheet.getRow(5 + index);
        row.values = [
          formatDate(closing.closing_date),
          money(closing.cash_sales),
          money(closing.momo_sales),
          money(closing.bank_sales),
          money(closing.mixed_sales),
          money(closing.credit_sales_total),
          money(closing.credit_sales_received),
          creditCreated(closing),
          money(closing.sales_total),
          money(closing.sales_received),
        ];
        for (let column = 2; column <= 10; column += 1) {
          row.getCell(column).numFmt = moneyFormat;
        }
      });
      styleBody(salesMixSheet, 5, 4 + closings.length, 1, 10);
      salesMixSheet.autoFilter = `A4:J${Math.max(4, 4 + closings.length)}`;

      const channelSheet = workbook.addWorksheet("Channel Reconciliation");
      channelSheet.views = [{ state: "frozen", ySplit: 5 }];
      channelSheet.columns = [
        { width: 13 },
        { width: 20 },
        { width: 18 },
        { width: 18 },
        { width: 16 },
        { width: 13 },
      ];
      setPrintSetup(channelSheet, "portrait");
      styleTitle(
        channelSheet,
        "A1:F1",
        "PAYMENT CHANNEL RECONCILIATION"
      );
      channelSheet.mergeCells("A2:F2");
      channelSheet.getCell("A2").value = `${branchCode} - ${branchName} | ${periodLabel}`;
      channelSheet.getCell("A2").alignment = { horizontal: "center" };
      channelSheet.getCell("A2").font = { bold: true };
      channelSheet.getRow(4).values = [
        "Closing Date",
        "Payment Channel",
        "System Expected",
        "Counted / Confirmed",
        "Difference",
        "Status",
      ];
      styleHeader(channelSheet.getRow(4));

      let channelRowNumber = 5;
      const channels = [
        ["Cash", "expected_cash", "cash_counted"],
        ["Mobile Money", "expected_momo", "momo_counted"],
        ["Bank", "expected_bank", "bank_counted"],
        ["Unallocated / Mixed", "expected_other", "other_counted"],
      ];
      closings.forEach((closing) => {
        channels.forEach(([label, expectedKey, countedKey]) => {
          const expected = money(closing[expectedKey]);
          const counted = money(closing[countedKey]);
          const difference = money(counted - expected);
          const row = channelSheet.getRow(channelRowNumber);
          row.values = [
            formatDate(closing.closing_date),
            label,
            expected,
            counted,
            difference,
            varianceStatus(difference),
          ];
          [3, 4, 5].forEach((column) => {
            row.getCell(column).numFmt = moneyFormat;
          });
          row.getCell(6).font = {
            bold: true,
            color: {
              argb:
                Math.abs(difference) < 0.01
                  ? "FF166534"
                  : difference > 0
                  ? "FF9A3412"
                  : "FFB91C1C",
            },
          };
          channelRowNumber += 1;
        });
      });
      styleBody(channelSheet, 5, channelRowNumber - 1, 1, 6);
      channelSheet.autoFilter = `A4:F${Math.max(4, channelRowNumber - 1)}`;

      const notesSheet = workbook.addWorksheet("Control Notes");
      notesSheet.views = [{ state: "frozen", ySplit: 5 }];
      notesSheet.columns = [
        { width: 13 },
        { width: 15 },
        { width: 18 },
        { width: 18 },
        { width: 18 },
        { width: 55 },
        { width: 22 },
        { width: 21 },
      ];
      setPrintSetup(notesSheet, "landscape");
      styleTitle(notesSheet, "A1:H1", "CLOSING CONTROL NOTES");
      notesSheet.mergeCells("A2:H2");
      notesSheet.getCell("A2").value = `${branchCode} - ${branchName} | ${periodLabel}`;
      notesSheet.getCell("A2").alignment = { horizontal: "center" };
      notesSheet.getCell("A2").font = { bold: true };
      notesSheet.getRow(4).values = [
        "Closing Date",
        "Status",
        "Debt Payments",
        "Expenses",
        "Total Variance",
        "Closing Notes",
        "Closed By",
        "Closed At",
      ];
      styleHeader(notesSheet.getRow(4));

      closings.forEach((closing, index) => {
        const row = notesSheet.getRow(5 + index);
        row.values = [
          formatDate(closing.closing_date),
          varianceStatus(closing.difference_total),
          money(closing.debt_payments_total),
          money(closing.expenses_total),
          money(closing.difference_total),
          closing.notes || "",
          closing.closed_by_name || "",
          formatDateTime(closing.closed_at),
        ];
        [3, 4, 5].forEach((column) => {
          row.getCell(column).numFmt = moneyFormat;
        });
        row.getCell(6).alignment = { wrapText: true, vertical: "top" };
        row.height = Math.max(22, Math.min(60, 18 + String(closing.notes || "").length / 3));
      });
      styleBody(notesSheet, 5, 4 + closings.length, 1, 8);
      notesSheet.autoFilter = `A4:H${Math.max(4, 4 + closings.length)}`;

      return sendStoreWorkbook(req, res, workbook, "daily-closings");
    } catch (error) {
      console.error("Export daily closings error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while exporting daily closings.",
      });
    }
  }
);

// GET /api/exports/customer-statement?phone=0240000000&name=Customer
router.get(
  "/customer-statement",
  requireAuth,
  requireRole("admin", "manager", "auditor"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const phone = cleanText(req.query.phone);
      const name = cleanText(req.query.name);

      if (!phone && !name) {
        return res.status(400).json({
          status: "error",
          message: "Customer phone or name is required.",
        });
      }

      const conditions = [];
      const params = [branchId];

      if (phone) {
        conditions.push("s.customer_phone = ?");
        params.push(phone);
      }

      if (name) {
        conditions.push("s.customer_name = ?");
        params.push(name);
      }

      const whereCustomer = conditions.join(" OR ");

      const [sales] = await pool.query(
        `SELECT
          s.id,
          s.branch_id,
          s.receipt_number,
          s.customer_name,
          s.customer_phone,
          s.subtotal,
          s.discount_amount,
          s.tax_amount,
          s.total,
          s.payment_type,
          s.amount_paid,
          COALESCE((SELECT SUM(spa.amount) FROM sale_payment_allocations spa WHERE spa.sale_id = s.id AND spa.payment_channel = 'cash'), 0) AS cash_received,
          COALESCE((SELECT SUM(spa.amount) FROM sale_payment_allocations spa WHERE spa.sale_id = s.id AND spa.payment_channel = 'momo'), 0) AS momo_received,
          COALESCE((SELECT SUM(spa.amount) FROM sale_payment_allocations spa WHERE spa.sale_id = s.id AND spa.payment_channel = 'bank'), 0) AS bank_received,
          COALESCE((SELECT SUM(spa.amount) FROM sale_payment_allocations spa WHERE spa.sale_id = s.id AND spa.payment_channel = 'other'), 0) AS other_received,
          s.balance,
          s.sale_status,
          s.is_voided,
          s.created_at,
          u.full_name AS staff_name
         FROM sales s
         LEFT JOIN users u ON s.staff_id = u.id
         WHERE s.branch_id = ?
         AND (${whereCustomer})
         ORDER BY s.created_at DESC`,
        params
      );

      const saleIds = sales.map((sale) => sale.id);

      let debts = [];
      let debtPayments = [];

      if (saleIds.length > 0) {
        const salePlaceholders = saleIds.map(() => "?").join(",");

        const [debtRows] = await pool.query(
          `SELECT
            d.id,
            d.sale_id,
            d.customer_name,
            d.customer_phone,
            d.amount_owed,
            d.amount_paid,
            d.balance,
            d.status,
            d.due_date,
            d.created_at,
            s.receipt_number
           FROM debts d
           INNER JOIN sales s
            ON d.sale_id = s.id
            AND s.branch_id = d.branch_id
           WHERE d.branch_id = ?
           AND d.sale_id IN (${salePlaceholders})
           ORDER BY d.created_at DESC`,
          [branchId, ...saleIds]
        );

        debts = debtRows;

        const debtIds = debts.map((debt) => debt.id);

        if (debtIds.length > 0) {
          const debtPlaceholders = debtIds.map(() => "?").join(",");

          const [paymentRows] = await pool.query(
            `SELECT
              dp.id,
              dp.debt_id,
              dp.amount,
              dp.payment_method,
              dp.paid_at,
              dp.notes,
              d.customer_name,
              d.customer_phone,
              s.receipt_number,
              u.full_name AS received_by_name
             FROM debt_payments dp
             INNER JOIN debts d
              ON dp.debt_id = d.id
              AND d.branch_id = dp.branch_id
             INNER JOIN sales s
              ON d.sale_id = s.id
              AND s.branch_id = d.branch_id
             LEFT JOIN users u ON dp.received_by = u.id
             WHERE dp.branch_id = ?
             AND dp.debt_id IN (${debtPlaceholders})
             ORDER BY dp.paid_at DESC, dp.id DESC`,
            [branchId, ...debtIds]
          );

          debtPayments = paymentRows;
        }
      }

      const validSales = sales.filter(
        (sale) =>
          Number(sale.is_voided || 0) === 0 && sale.sale_status !== "cancelled"
      );

      const totalSales = validSales.reduce(
        (sum, sale) => sum + Number(sale.total || 0),
        0
      );

      const totalPaidOnSales = validSales.reduce(
        (sum, sale) => sum + Number(sale.amount_paid || 0),
        0
      );

      const totalDebtPayments = debtPayments.reduce(
        (sum, payment) => sum + Number(payment.amount || 0),
        0
      );

      const totalOutstanding = debts.reduce(
        (sum, debt) => sum + Number(debt.balance || 0),
        0
      );

      const customerName =
        sales[0]?.customer_name || debts[0]?.customer_name || name;
      const customerPhone =
        sales[0]?.customer_phone || debts[0]?.customer_phone || phone;

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const summaryWorksheet = workbook.addWorksheet("Customer Summary");

      summaryWorksheet.columns = [
        { header: "Metric", key: "metric" },
        { header: "Value", key: "value" },
      ];

      summaryWorksheet.addRow({
        metric: "Customer Name",
        value: customerName || "",
      });

      summaryWorksheet.addRow({
        metric: "Customer Phone",
        value: customerPhone || "",
      });

      summaryWorksheet.addRow({
        metric: "Sales Records",
        value: sales.length,
      });

      summaryWorksheet.addRow({
        metric: "Valid Sales Records",
        value: validSales.length,
      });

      summaryWorksheet.addRow({
        metric: "Debt Records",
        value: debts.length,
      });

      summaryWorksheet.addRow({
        metric: "Debt Payment Records",
        value: debtPayments.length,
      });

      summaryWorksheet.addRow({
        metric: "Total Sales",
        value: Number(totalSales.toFixed(2)),
      });

      summaryWorksheet.addRow({
        metric: "Total Paid on Sales",
        value: Number(totalPaidOnSales.toFixed(2)),
      });

      summaryWorksheet.addRow({
        metric: "Total Debt Payments",
        value: Number(totalDebtPayments.toFixed(2)),
      });

      summaryWorksheet.addRow({
        metric: "Total Received",
        value: Number((totalPaidOnSales + totalDebtPayments).toFixed(2)),
      });

      summaryWorksheet.addRow({
        metric: "Outstanding Balance",
        value: Number(totalOutstanding.toFixed(2)),
      });

      const salesWorksheet = workbook.addWorksheet("Sales History");

      salesWorksheet.columns = [
        { header: "Date", key: "created_at" },
        { header: "Receipt Number", key: "receipt_number" },
        { header: "Customer", key: "customer_name" },
        { header: "Phone", key: "customer_phone" },
        { header: "Subtotal", key: "subtotal" },
        { header: "Discount", key: "discount_amount" },
        { header: "VAT", key: "tax_amount" },
        { header: "Total", key: "total" },
        { header: "Payment Type", key: "payment_type" },
        { header: "Amount Paid", key: "amount_paid" },
        { header: "Cash Received", key: "cash_received" },
        { header: "MoMo Received", key: "momo_received" },
        { header: "Bank Received", key: "bank_received" },
        { header: "Other / Unallocated", key: "other_received" },
        { header: "Balance", key: "balance" },
        { header: "Sale Status", key: "sale_status" },
        { header: "Voided?", key: "voided_text" },
        { header: "Staff", key: "staff_name" },
      ];

      sales.forEach((sale) => {
        const voided =
          Number(sale.is_voided || 0) === 1 || sale.sale_status === "cancelled";

        salesWorksheet.addRow({
          created_at: formatDateTime(sale.created_at),
          receipt_number: sale.receipt_number || "",
          customer_name: sale.customer_name || "",
          customer_phone: sale.customer_phone || "",
          subtotal: voided ? 0 : Number(sale.subtotal || 0),
          discount_amount: voided ? 0 : Number(sale.discount_amount || 0),
          tax_amount: voided ? 0 : Number(sale.tax_amount || 0),
          total: voided ? 0 : Number(sale.total || 0),
          payment_type: sale.payment_type || "",
          amount_paid: voided ? 0 : Number(sale.amount_paid || 0),
          cash_received: voided ? 0 : Number(sale.cash_received || 0),
          momo_received: voided ? 0 : Number(sale.momo_received || 0),
          bank_received: voided ? 0 : Number(sale.bank_received || 0),
          other_received: voided ? 0 : Number(sale.other_received || 0),
          balance: voided ? 0 : Number(sale.balance || 0),
          sale_status: sale.sale_status || "",
          voided_text: voided ? "Yes" : "No",
          staff_name: sale.staff_name || "",
        });
      });

      const debtsWorksheet = workbook.addWorksheet("Debt Records");

      debtsWorksheet.columns = [
        { header: "Date", key: "created_at" },
        { header: "Receipt Number", key: "receipt_number" },
        { header: "Customer", key: "customer_name" },
        { header: "Phone", key: "customer_phone" },
        { header: "Amount Owed", key: "amount_owed" },
        { header: "Amount Paid", key: "amount_paid" },
        { header: "Balance", key: "balance" },
        { header: "Status", key: "status" },
        { header: "Due Date", key: "due_date" },
      ];

      debts.forEach((debt) => {
        debtsWorksheet.addRow({
          created_at: formatDateTime(debt.created_at),
          receipt_number: debt.receipt_number || "",
          customer_name: debt.customer_name || "",
          customer_phone: debt.customer_phone || "",
          amount_owed: Number(debt.amount_owed || 0),
          amount_paid: Number(debt.amount_paid || 0),
          balance: Number(debt.balance || 0),
          status: debt.status || "",
          due_date: formatDate(debt.due_date),
        });
      });

      const paymentsWorksheet = workbook.addWorksheet("Debt Payments");

      paymentsWorksheet.columns = [
        { header: "Payment Date", key: "paid_at" },
        { header: "Receipt Number", key: "receipt_number" },
        { header: "Customer", key: "customer_name" },
        { header: "Phone", key: "customer_phone" },
        { header: "Amount", key: "amount" },
        { header: "Payment Method", key: "payment_method" },
        { header: "Received By", key: "received_by_name" },
        { header: "Notes", key: "notes" },
      ];

      debtPayments.forEach((payment) => {
        paymentsWorksheet.addRow({
          paid_at: formatDateTime(payment.paid_at),
          receipt_number: payment.receipt_number || "",
          customer_name: payment.customer_name || "",
          customer_phone: payment.customer_phone || "",
          amount: Number(payment.amount || 0),
          payment_method: payment.payment_method || "",
          received_by_name: payment.received_by_name || "",
          notes: payment.notes || "",
        });
      });

      styleWorksheet(summaryWorksheet);
      styleWorksheet(salesWorksheet);
      styleWorksheet(debtsWorksheet);
      styleWorksheet(paymentsWorksheet);

      const safeName = safeFilenamePart(customerName || "customer");

      return sendStoreWorkbook(req, res, workbook, `customer-statement-${safeName}`);
    } catch (error) {
      console.error("Export customer statement error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while exporting customer statement.",
      });
    }
  }
);

// GET /api/exports/sales
router.get(
  "/sales",
  requireAuth,
  requireRole("admin", "manager", "auditor"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const from = cleanText(req.query.from);
      const to = cleanText(req.query.to);

      const params = [branchId];
      const dateFilter = buildDateFilter("s", "created_at", from, to, params);

      const [sales] = await pool.query(
        `SELECT
          s.id,
          s.branch_id,
          s.receipt_number,
          s.subtotal,
          s.discount_amount,
          s.tax_amount,
          s.total,
          s.payment_type,
          s.amount_paid,
          COALESCE((SELECT SUM(spa.amount) FROM sale_payment_allocations spa WHERE spa.sale_id = s.id AND spa.payment_channel = 'cash'), 0) AS cash_received,
          COALESCE((SELECT SUM(spa.amount) FROM sale_payment_allocations spa WHERE spa.sale_id = s.id AND spa.payment_channel = 'momo'), 0) AS momo_received,
          COALESCE((SELECT SUM(spa.amount) FROM sale_payment_allocations spa WHERE spa.sale_id = s.id AND spa.payment_channel = 'bank'), 0) AS bank_received,
          COALESCE((SELECT SUM(spa.amount) FROM sale_payment_allocations spa WHERE spa.sale_id = s.id AND spa.payment_channel = 'other'), 0) AS other_received,
          s.balance,
          s.sale_status,
          s.is_voided,
          s.void_reason,
          s.voided_at,
          s.created_at,
          s.customer_name,
          s.customer_phone,
          u.full_name AS staff_name,
          vu.full_name AS voided_by_name
         FROM sales s
         LEFT JOIN users u ON s.staff_id = u.id
         LEFT JOIN users vu ON s.voided_by = vu.id
         WHERE s.branch_id = ?
         ${dateFilter}
         ORDER BY s.created_at DESC`,
        params
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Sales");

      worksheet.columns = [
        { header: "Receipt Number", key: "receipt_number" },
        { header: "Customer", key: "customer_name" },
        { header: "Phone", key: "customer_phone" },
        { header: "Staff", key: "staff_name" },
        { header: "Subtotal / Before Discount", key: "subtotal" },
        { header: "Discount", key: "discount_amount" },
        { header: "VAT", key: "tax_amount" },
        { header: "Amount Due", key: "total" },
        { header: "Payment Type", key: "payment_type" },
        { header: "Amount Paid", key: "amount_paid" },
        { header: "Cash Received", key: "cash_received" },
        { header: "MoMo Received", key: "momo_received" },
        { header: "Bank Received", key: "bank_received" },
        { header: "Other / Unallocated", key: "other_received" },
        { header: "Balance", key: "balance" },
        { header: "Sale Status", key: "sale_status" },
        { header: "Voided?", key: "voided_text" },
        { header: "Valid Sales Total", key: "valid_total" },
        { header: "Valid Discount", key: "valid_discount" },
        { header: "Valid Amount Paid", key: "valid_amount_paid" },
        { header: "Valid Balance", key: "valid_balance" },
        { header: "Void Reason", key: "void_reason" },
        { header: "Voided By", key: "voided_by_name" },
        { header: "Voided At", key: "voided_at" },
        { header: "Date", key: "created_at" },
      ];

      sales.forEach((sale) => {
        const voided = isVoidedSale(sale);

        worksheet.addRow({
          receipt_number: sale.receipt_number,
          customer_name: sale.customer_name || "Walk-in Customer",
          customer_phone: sale.customer_phone || "",
          staff_name: sale.staff_name || "",
          subtotal: Number(sale.subtotal || 0),
          discount_amount: Number(sale.discount_amount || 0),
          tax_amount: Number(sale.tax_amount || 0),
          total: Number(sale.total || 0),
          payment_type: sale.payment_type,
          amount_paid: Number(sale.amount_paid || 0),
          cash_received: Number(sale.cash_received || 0),
          momo_received: Number(sale.momo_received || 0),
          bank_received: Number(sale.bank_received || 0),
          other_received: Number(sale.other_received || 0),
          balance: Number(sale.balance || 0),
          sale_status: sale.sale_status,
          voided_text: voided ? "Yes" : "No",
          valid_total: voided ? 0 : Number(sale.total || 0),
          valid_discount: voided ? 0 : Number(sale.discount_amount || 0),
          valid_amount_paid: voided ? 0 : Number(sale.amount_paid || 0),
          valid_balance: voided ? 0 : Number(sale.balance || 0),
          void_reason: sale.void_reason || "",
          voided_by_name: sale.voided_by_name || "",
          voided_at: formatDateTime(sale.voided_at),
          created_at: formatDateTime(sale.created_at),
        });
      });

      const summaryWorksheet = workbook.addWorksheet("Sales Summary");

      const validSales = sales.filter((sale) => !isVoidedSale(sale));
      const voidedSales = sales.filter((sale) => isVoidedSale(sale));

      const validBeforeDiscount = validSales.reduce(
        (sum, sale) => sum + Number(sale.subtotal || 0),
        0
      );

      const validDiscount = validSales.reduce(
        (sum, sale) => sum + Number(sale.discount_amount || 0),
        0
      );

      const validTax = validSales.reduce(
        (sum, sale) => sum + Number(sale.tax_amount || 0),
        0
      );

      const validTotal = validSales.reduce(
        (sum, sale) => sum + Number(sale.total || 0),
        0
      );

      const validAmountPaid = validSales.reduce(
        (sum, sale) => sum + Number(sale.amount_paid || 0),
        0
      );

      const validBalance = validSales.reduce(
        (sum, sale) => sum + Number(sale.balance || 0),
        0
      );

      summaryWorksheet.columns = [
        { header: "Metric", key: "metric" },
        { header: "Value", key: "value" },
      ];

      summaryWorksheet.addRow({
        metric: "Total sales exported",
        value: sales.length,
      });

      summaryWorksheet.addRow({
        metric: "Valid completed sales",
        value: validSales.length,
      });

      summaryWorksheet.addRow({
        metric: "Voided / Cancelled sales",
        value: voidedSales.length,
      });

      summaryWorksheet.addRow({
        metric: "Valid before discount",
        value: validBeforeDiscount,
      });

      summaryWorksheet.addRow({
        metric: "Valid discount",
        value: validDiscount,
      });

      summaryWorksheet.addRow({
        metric: "Valid VAT",
        value: validTax,
      });

      summaryWorksheet.addRow({
        metric: "Valid sales total",
        value: validTotal,
      });

      summaryWorksheet.addRow({
        metric: "Valid amount paid",
        value: validAmountPaid,
      });

      summaryWorksheet.addRow({
        metric: "Valid balance",
        value: validBalance,
      });

      styleWorksheet(worksheet);
      styleWorksheet(summaryWorksheet);

      return sendStoreWorkbook(req, res, workbook, "sales");
    } catch (error) {
      console.error("Export sales error:", error);

      return res.status(500).json({
        status: "error",
        message: error.message || "Something went wrong while exporting sales.",
      });
    }
  }
);

// GET /api/exports/debts
router.get(
  "/debts",
  requireAuth,
  requireRole("admin", "manager", "auditor"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);

      const [debts] = await pool.query(
        `SELECT
          d.id,
          d.branch_id,
          d.amount_owed,
          d.amount_paid,
          d.balance,
          d.status,
          d.due_date,
          d.created_at,
          d.customer_name,
          d.customer_phone,
          s.receipt_number,
          s.sale_status,
          s.is_voided
         FROM debts d
         INNER JOIN sales s
          ON d.sale_id = s.id
          AND s.branch_id = d.branch_id
         WHERE d.branch_id = ?
         AND COALESCE(s.is_voided, 0) = 0
         AND s.sale_status != 'cancelled'
         ORDER BY d.created_at DESC`,
        [branchId]
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Debts");

      worksheet.columns = [
        { header: "Receipt Number", key: "receipt_number" },
        { header: "Customer", key: "customer_name" },
        { header: "Phone", key: "customer_phone" },
        { header: "Amount Owed", key: "amount_owed" },
        { header: "Amount Paid", key: "amount_paid" },
        { header: "Balance", key: "balance" },
        { header: "Status", key: "status" },
        { header: "Due Date", key: "due_date" },
        { header: "Created At", key: "created_at" },
      ];

      debts.forEach((debt) => {
        worksheet.addRow({
          receipt_number: debt.receipt_number || "",
          customer_name: debt.customer_name || "",
          customer_phone: debt.customer_phone || "",
          amount_owed: Number(debt.amount_owed || 0),
          amount_paid: Number(debt.amount_paid || 0),
          balance: Number(debt.balance || 0),
          status: debt.status,
          due_date: formatDate(debt.due_date),
          created_at: formatDateTime(debt.created_at),
        });
      });

      styleWorksheet(worksheet);

      return sendStoreWorkbook(req, res, workbook, "debts");
    } catch (error) {
      console.error("Export debts error:", error);

      return res.status(500).json({
        status: "error",
        message: error.message || "Something went wrong while exporting debts.",
      });
    }
  }
);

// GET /api/exports/expenses
router.get(
  "/expenses",
  requireAuth,
  requireRole("admin", "manager", "auditor"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const from = cleanText(req.query.from);
      const to = cleanText(req.query.to);

      const params = [branchId];
      const dateFilter = buildDateFilter("e", "expense_date", from, to, params);

      const [expenses] = await pool.query(
        `SELECT
          e.id,
          e.branch_id,
          e.category,
          e.description,
          e.amount,
          e.payment_method,
          e.expense_date,
          e.created_at,
          u.full_name AS recorded_by_name
         FROM expenses e
         LEFT JOIN users u ON e.recorded_by = u.id
         WHERE e.branch_id = ?
         ${dateFilter}
         ORDER BY e.expense_date DESC, e.created_at DESC`,
        params
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Expenses");

      worksheet.columns = [
        { header: "Date", key: "expense_date" },
        { header: "Category", key: "category" },
        { header: "Description", key: "description" },
        { header: "Amount", key: "amount" },
        { header: "Payment Method", key: "payment_method" },
        { header: "Recorded By", key: "recorded_by_name" },
        { header: "Created At", key: "created_at" },
      ];

      expenses.forEach((expense) => {
        worksheet.addRow({
          expense_date: formatDate(expense.expense_date),
          category: expense.category,
          description: expense.description || "",
          amount: Number(expense.amount || 0),
          payment_method: expense.payment_method || "cash",
          recorded_by_name: expense.recorded_by_name || "",
          created_at: formatDateTime(expense.created_at),
        });
      });

      styleWorksheet(worksheet);

      return sendStoreWorkbook(req, res, workbook, "expenses");
    } catch (error) {
      console.error("Export expenses error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while exporting expenses.",
      });
    }
  }
);

// GET /api/exports/purchases
router.get(
  "/purchases",
  requireAuth,
  requireRole("admin", "manager", "auditor"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const from = cleanText(req.query.from);
      const to = cleanText(req.query.to);

      const params = [branchId];
      const dateFilter = buildDateFilter("p", "purchase_date", from, to, params);

      const [purchases] = await pool.query(
        `SELECT
          p.id,
          p.branch_id,
          p.supplier_id,
          p.invoice_number,
          p.purchase_date,
          p.total_cost,
          p.total_amount,
          p.amount_paid,
          p.balance,
          p.payment_status,
          p.notes,
          p.created_at,
          s.name AS supplier_name,
          u.full_name AS created_by_name
         FROM purchases p
         LEFT JOIN suppliers s
          ON p.supplier_id = s.id
          AND s.branch_id = p.branch_id
         LEFT JOIN users u ON p.created_by = u.id
         WHERE p.branch_id = ?
         ${dateFilter}
         ORDER BY p.purchase_date DESC, p.created_at DESC`,
        params
      );

      const purchaseIds = purchases.map((purchase) => purchase.id);

      let purchaseItems = [];
      let purchasePayments = [];

      if (purchaseIds.length > 0) {
        const placeholders = purchaseIds.map(() => "?").join(",");

        const [items] = await pool.query(
          `SELECT
            pi.id,
            pi.purchase_id,
            pi.product_id,
            pi.product_name,
            pi.quantity,
            pi.cost_price,
            pi.line_total,
            p.invoice_number,
            p.purchase_date,
            s.name AS supplier_name
           FROM purchase_items pi
           INNER JOIN purchases p ON pi.purchase_id = p.id
           LEFT JOIN suppliers s
            ON p.supplier_id = s.id
            AND s.branch_id = p.branch_id
           WHERE p.branch_id = ?
           AND pi.purchase_id IN (${placeholders})
           ORDER BY p.purchase_date DESC, pi.id ASC`,
          [branchId, ...purchaseIds]
        );

        purchaseItems = items;

        const [payments] = await pool.query(
          `SELECT
            pp.id,
            pp.branch_id,
            pp.purchase_id,
            pp.amount,
            pp.payment_method,
            pp.notes,
            pp.paid_at,
            p.invoice_number,
            p.purchase_date,
            s.name AS supplier_name,
            u.full_name AS paid_by_name
           FROM purchase_payments pp
           INNER JOIN purchases p
            ON pp.purchase_id = p.id
            AND p.branch_id = pp.branch_id
           LEFT JOIN suppliers s
            ON p.supplier_id = s.id
            AND s.branch_id = p.branch_id
           LEFT JOIN users u ON pp.paid_by = u.id
           WHERE pp.branch_id = ?
           AND pp.purchase_id IN (${placeholders})
           ORDER BY p.purchase_date DESC, pp.paid_at ASC, pp.id ASC`,
          [branchId, ...purchaseIds]
        );

        purchasePayments = payments;
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet("Purchases");

      worksheet.columns = [
        { header: "Date", key: "purchase_date" },
        { header: "Supplier", key: "supplier_name" },
        { header: "Invoice Number", key: "invoice_number" },
        { header: "Total Cost", key: "total_cost" },
        { header: "Total Amount", key: "total_amount" },
        { header: "Amount Paid", key: "amount_paid" },
        { header: "Balance", key: "balance" },
        { header: "Payment Status", key: "payment_status" },
        { header: "Notes", key: "notes" },
        { header: "Recorded By", key: "created_by_name" },
        { header: "Created At", key: "created_at" },
      ];

      purchases.forEach((purchase) => {
        worksheet.addRow({
          purchase_date: formatDate(purchase.purchase_date),
          supplier_name: purchase.supplier_name || "",
          invoice_number: purchase.invoice_number || "",
          total_cost: Number(purchase.total_cost || 0),
          total_amount: Number(purchase.total_amount || 0),
          amount_paid: Number(purchase.amount_paid || 0),
          balance: Number(purchase.balance || 0),
          payment_status: purchase.payment_status || "",
          notes: purchase.notes || "",
          created_by_name: purchase.created_by_name || "",
          created_at: formatDateTime(purchase.created_at),
        });
      });

      const itemsWorksheet = workbook.addWorksheet("Purchase Items");

      itemsWorksheet.columns = [
        { header: "Purchase Date", key: "purchase_date" },
        { header: "Supplier", key: "supplier_name" },
        { header: "Invoice Number", key: "invoice_number" },
        { header: "Product", key: "product_name" },
        { header: "Quantity", key: "quantity" },
        { header: "Cost Price", key: "cost_price" },
        { header: "Line Total", key: "line_total" },
      ];

      purchaseItems.forEach((item) => {
        itemsWorksheet.addRow({
          purchase_date: formatDate(item.purchase_date),
          supplier_name: item.supplier_name || "",
          invoice_number: item.invoice_number || "",
          product_name: item.product_name || "",
          quantity: Number(item.quantity || 0),
          cost_price: Number(item.cost_price || 0),
          line_total: Number(item.line_total || 0),
        });
      });

      const paymentsWorksheet = workbook.addWorksheet("Purchase Payments");

      paymentsWorksheet.columns = [
        { header: "Purchase Date", key: "purchase_date" },
        { header: "Supplier", key: "supplier_name" },
        { header: "Invoice Number", key: "invoice_number" },
        { header: "Payment Date", key: "paid_at" },
        { header: "Amount", key: "amount" },
        { header: "Payment Method", key: "payment_method" },
        { header: "Paid By", key: "paid_by_name" },
        { header: "Notes", key: "notes" },
      ];

      purchasePayments.forEach((payment) => {
        paymentsWorksheet.addRow({
          purchase_date: formatDate(payment.purchase_date),
          supplier_name: payment.supplier_name || "",
          invoice_number: payment.invoice_number || "",
          paid_at: formatDateTime(payment.paid_at),
          amount: Number(payment.amount || 0),
          payment_method: payment.payment_method || "",
          paid_by_name: payment.paid_by_name || "",
          notes: payment.notes || "",
        });
      });

      const summaryWorksheet = workbook.addWorksheet("Purchase Summary");

      const totalAmount = purchases.reduce(
        (sum, purchase) => sum + Number(purchase.total_amount || 0),
        0
      );

      const totalPaid = purchases.reduce(
        (sum, purchase) => sum + Number(purchase.amount_paid || 0),
        0
      );

      const totalBalance = purchases.reduce(
        (sum, purchase) => sum + Number(purchase.balance || 0),
        0
      );

      const totalPaymentHistory = purchasePayments.reduce(
        (sum, payment) => sum + Number(payment.amount || 0),
        0
      );

      summaryWorksheet.columns = [
        { header: "Metric", key: "metric" },
        { header: "Value", key: "value" },
      ];

      summaryWorksheet.addRow({
        metric: "Purchases exported",
        value: purchases.length,
      });

      summaryWorksheet.addRow({
        metric: "Total amount",
        value: totalAmount,
      });

      summaryWorksheet.addRow({
        metric: "Total paid",
        value: totalPaid,
      });

      summaryWorksheet.addRow({
        metric: "Total balance",
        value: totalBalance,
      });

      summaryWorksheet.addRow({
        metric: "Payment history total",
        value: totalPaymentHistory,
      });

      styleWorksheet(worksheet);
      styleWorksheet(itemsWorksheet);
      styleWorksheet(paymentsWorksheet);
      styleWorksheet(summaryWorksheet);

      return sendStoreWorkbook(req, res, workbook, "purchases");
    } catch (error) {
      console.error("Export purchases error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while exporting purchases.",
      });
    }
  }
);

// GET /api/exports/returns
router.get(
  "/returns",
  requireAuth,
  requireRole("admin", "manager", "auditor"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const from = cleanText(req.query.from);
      const to = cleanText(req.query.to);

      const params = [branchId];
      const dateFilter = buildDateFilter("r", "returned_at", from, to, params);

      const [returns] = await pool.query(
        `SELECT
          r.id,
          r.branch_id,
          r.quantity,
          r.reason,
          r.return_type,
          r.refund_amount,
          r.refund_method,
          r.refund_reference,
          r.returned_at,
          r.approved_at,
          s.receipt_number,
          COALESCE(s.customer_name, c.name) AS customer_name,
          COALESCE(s.customer_phone, c.phone) AS customer_phone,
          p.name AS product_name,
          returned_user.full_name AS returned_by_name,
          approved_user.full_name AS approved_by_name
         FROM returns r
         LEFT JOIN sales s
          ON r.sale_id = s.id
          AND s.branch_id = r.branch_id
         LEFT JOIN customers c
          ON s.customer_id = c.id
          AND c.branch_id = r.branch_id
         LEFT JOIN products p
          ON r.product_id = p.id
          AND p.branch_id = r.branch_id
         LEFT JOIN users returned_user
          ON r.returned_by = returned_user.id
         LEFT JOIN users approved_user
          ON r.approved_by = approved_user.id
         WHERE r.branch_id = ?
         ${dateFilter}
         ORDER BY r.returned_at DESC, r.id DESC`,
        params
      );

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const summaryWorksheet = workbook.addWorksheet("Returns Summary");
      summaryWorksheet.columns = [
        { header: "Metric", key: "metric" },
        { header: "Value", key: "value" },
      ];

      const totalQuantity = returns.reduce(
        (sum, returnItem) => sum + Number(returnItem.quantity || 0),
        0
      );
      const totalRefunded = returns.reduce(
        (sum, returnItem) => sum + Number(returnItem.refund_amount || 0),
        0
      );
      const refundCount = returns.filter(
        (returnItem) => String(returnItem.return_type || "") === "refund"
      ).length;

      [
        ["Return records", returns.length],
        ["Quantity returned", totalQuantity],
        ["Financial refund records", refundCount],
        ["Total refunded", totalRefunded],
        [
          "Cash refunds",
          returns
            .filter((returnItem) => returnItem.refund_method === "cash")
            .reduce(
              (sum, returnItem) => sum + Number(returnItem.refund_amount || 0),
              0
            ),
        ],
        [
          "Mobile Money refunds",
          returns
            .filter((returnItem) => returnItem.refund_method === "momo")
            .reduce(
              (sum, returnItem) => sum + Number(returnItem.refund_amount || 0),
              0
            ),
        ],
        [
          "Bank refunds",
          returns
            .filter((returnItem) => returnItem.refund_method === "bank")
            .reduce(
              (sum, returnItem) => sum + Number(returnItem.refund_amount || 0),
              0
            ),
        ],
        [
          "Other refunds",
          returns
            .filter((returnItem) => returnItem.refund_method === "other")
            .reduce(
              (sum, returnItem) => sum + Number(returnItem.refund_amount || 0),
              0
            ),
        ],
      ].forEach(([metric, value]) => {
        summaryWorksheet.addRow({ metric, value });
      });
      summaryWorksheet.getColumn("B").numFmt = "#,##0.00";
      styleWorksheet(summaryWorksheet);

      const worksheet = workbook.addWorksheet("Returns Detail");

      worksheet.columns = [
        { header: "Date", key: "returned_at" },
        { header: "Receipt Number", key: "receipt_number" },
        { header: "Customer", key: "customer_name" },
        { header: "Phone", key: "customer_phone" },
        { header: "Product", key: "product_name" },
        { header: "Quantity", key: "quantity" },
        { header: "Outcome", key: "return_type" },
        { header: "Refund Amount", key: "refund_amount" },
        { header: "Refund Channel", key: "refund_method" },
        { header: "Refund Reference", key: "refund_reference" },
        { header: "Recorded By", key: "returned_by_name" },
        { header: "Approved By", key: "approved_by_name" },
        { header: "Approved At", key: "approved_at" },
        { header: "Reason", key: "reason" },
      ];

      returns.forEach((returnItem) => {
        worksheet.addRow({
          returned_at: formatDateTime(returnItem.returned_at),
          receipt_number: returnItem.receipt_number || "",
          customer_name: returnItem.customer_name || "",
          customer_phone: returnItem.customer_phone || "",
          product_name: returnItem.product_name || "",
          quantity: Number(returnItem.quantity || 0),
          return_type: String(returnItem.return_type || "stock_only")
            .replaceAll("_", " "),
          refund_amount: Number(returnItem.refund_amount || 0),
          refund_method: String(returnItem.refund_method || "none").toUpperCase(),
          refund_reference: returnItem.refund_reference || "",
          returned_by_name: returnItem.returned_by_name || "System",
          approved_by_name: returnItem.approved_by_name || "",
          approved_at: formatDateTime(returnItem.approved_at),
          reason: returnItem.reason || "",
        });
      });

      worksheet.getColumn("H").numFmt = "#,##0.00";
      styleWorksheet(worksheet);

      return sendStoreWorkbook(req, res, workbook, "returns");
    } catch (error) {
      console.error("Export returns error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while exporting returns.",
      });
    }
  }
);


// GET /api/exports/stock-transfers
router.get(
  "/stock-transfers",
  requireAuth,
  requireRole("admin", "manager", "auditor"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const from = cleanText(req.query.from);
      const to = cleanText(req.query.to);

      const transferParams = [branchId, branchId];
      const transferDateFilter = buildDateFilter(
        "st",
        "created_at",
        from,
        to,
        transferParams
      );

      const [transfers] = await pool.query(
        `SELECT
          st.id,
          st.transfer_number,
          st.from_branch_id,
          st.to_branch_id,
          st.status,
          st.request_note,
          st.approval_note AS approve_note,
          st.dispatch_note,
          st.receive_note,
          st.cancel_note,
          st.reject_note,
          st.requested_at,
          st.approved_at,
          st.dispatched_at,
          st.received_at,
          st.cancelled_at,
          st.rejected_at,
          st.created_at,

          fb.code AS from_branch_code,
          fb.name AS from_branch_name,
          fb.location AS from_branch_location,

          tb.code AS to_branch_code,
          tb.name AS to_branch_name,
          tb.location AS to_branch_location,

          rb.full_name AS requested_by_name,
          ab.full_name AS approved_by_name,
          db.full_name AS dispatched_by_name,
          rcb.full_name AS received_by_name,
          cb.full_name AS cancelled_by_name,
          rjb.full_name AS rejected_by_name,

          COUNT(sti.id) AS item_count,
          COALESCE(SUM(sti.requested_quantity), 0) AS total_requested_quantity,
          COALESCE(SUM(sti.dispatched_quantity), 0) AS total_dispatched_quantity,
          COALESCE(SUM(sti.received_quantity), 0) AS total_received_quantity

         FROM stock_transfers st
         LEFT JOIN branches fb ON fb.id = st.from_branch_id
         LEFT JOIN branches tb ON tb.id = st.to_branch_id
         LEFT JOIN users rb ON rb.id = st.requested_by
         LEFT JOIN users ab ON ab.id = st.approved_by
         LEFT JOIN users db ON db.id = st.dispatched_by
         LEFT JOIN users rcb ON rcb.id = st.received_by
         LEFT JOIN users cb ON cb.id = st.cancelled_by
         LEFT JOIN users rjb ON rjb.id = st.rejected_by
         LEFT JOIN stock_transfer_items sti ON sti.transfer_id = st.id

         WHERE (st.from_branch_id = ? OR st.to_branch_id = ?)
         ${transferDateFilter}

         GROUP BY
          st.id,
          st.transfer_number,
          st.from_branch_id,
          st.to_branch_id,
          st.status,
          st.request_note,
          st.approval_note,
          st.dispatch_note,
          st.receive_note,
          st.cancel_note,
          st.reject_note,
          st.requested_at,
          st.approved_at,
          st.dispatched_at,
          st.received_at,
          st.cancelled_at,
          st.rejected_at,
          st.created_at,
          fb.code,
          fb.name,
          fb.location,
          tb.code,
          tb.name,
          tb.location,
          rb.full_name,
          ab.full_name,
          db.full_name,
          rcb.full_name,
          cb.full_name,
          rjb.full_name

         ORDER BY st.created_at DESC, st.id DESC`,
        transferParams
      );

      const transferIds = transfers.map((transfer) => transfer.id);

      let transferItems = [];

      if (transferIds.length > 0) {
        const placeholders = transferIds.map(() => "?").join(",");

        const [items] = await pool.query(
          `SELECT
            sti.id,
            sti.transfer_id,
            sti.source_product_id,
            sti.destination_product_id,
            sti.product_name,
            sti.barcode,
            sti.category,
            sti.size,
            sti.requested_quantity,
            sti.dispatched_quantity,
            sti.received_quantity,
            sti.source_quantity_before,
            sti.source_quantity_after,
            sti.destination_quantity_before,
            sti.destination_quantity_after,
            sti.item_note,

            st.transfer_number,
            st.status,
            st.created_at,

            fb.code AS from_branch_code,
            fb.name AS from_branch_name,

            tb.code AS to_branch_code,
            tb.name AS to_branch_name

           FROM stock_transfer_items sti
           INNER JOIN stock_transfers st ON st.id = sti.transfer_id
           LEFT JOIN branches fb ON fb.id = st.from_branch_id
           LEFT JOIN branches tb ON tb.id = st.to_branch_id

           WHERE sti.transfer_id IN (${placeholders})
           AND (st.from_branch_id = ? OR st.to_branch_id = ?)

           ORDER BY st.created_at DESC, sti.id ASC`,
          [...transferIds, branchId, branchId]
        );

        transferItems = items;
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const transfersWorksheet = workbook.addWorksheet("Stock Transfers");

      transfersWorksheet.columns = [
        { header: "Transfer Number", key: "transfer_number" },
        { header: "Direction", key: "direction" },
        { header: "From Store", key: "from_store" },
        { header: "To Store", key: "to_store" },
        { header: "Status", key: "status" },
        { header: "Item Count", key: "item_count" },
        { header: "Requested Quantity", key: "total_requested_quantity" },
        { header: "Dispatched Quantity", key: "total_dispatched_quantity" },
        { header: "Received Quantity", key: "total_received_quantity" },
        { header: "Requested By", key: "requested_by_name" },
        { header: "Approved By", key: "approved_by_name" },
        { header: "Dispatched By", key: "dispatched_by_name" },
        { header: "Received By", key: "received_by_name" },
        { header: "Cancelled By", key: "cancelled_by_name" },
        { header: "Rejected By", key: "rejected_by_name" },
        { header: "Request Note", key: "request_note" },
        { header: "Approve Note", key: "approve_note" },
        { header: "Dispatch Note", key: "dispatch_note" },
        { header: "Receive Note", key: "receive_note" },
        { header: "Cancel Note", key: "cancel_note" },
        { header: "Reject Note", key: "reject_note" },
        { header: "Requested At", key: "requested_at" },
        { header: "Approved At", key: "approved_at" },
        { header: "Dispatched At", key: "dispatched_at" },
        { header: "Received At", key: "received_at" },
        { header: "Cancelled At", key: "cancelled_at" },
        { header: "Rejected At", key: "rejected_at" },
        { header: "Created At", key: "created_at" },
      ];

      transfers.forEach((transfer) => {
        let direction = "Related";

        if (Number(transfer.from_branch_id) === Number(branchId)) {
          direction = "Transfer Out";
        }

        if (Number(transfer.to_branch_id) === Number(branchId)) {
          direction = "Transfer In";
        }

        transfersWorksheet.addRow({
          transfer_number: transfer.transfer_number || "",
          direction,
          from_store: `${transfer.from_branch_code || ""} - ${
            transfer.from_branch_name || ""
          }`,
          to_store: `${transfer.to_branch_code || ""} - ${
            transfer.to_branch_name || ""
          }`,
          status: transfer.status || "",
          item_count: Number(transfer.item_count || 0),
          total_requested_quantity: Number(
            transfer.total_requested_quantity || 0
          ),
          total_dispatched_quantity: Number(
            transfer.total_dispatched_quantity || 0
          ),
          total_received_quantity: Number(
            transfer.total_received_quantity || 0
          ),
          requested_by_name: transfer.requested_by_name || "",
          approved_by_name: transfer.approved_by_name || "",
          dispatched_by_name: transfer.dispatched_by_name || "",
          received_by_name: transfer.received_by_name || "",
          cancelled_by_name: transfer.cancelled_by_name || "",
          rejected_by_name: transfer.rejected_by_name || "",
          request_note: transfer.request_note || "",
          approve_note: transfer.approve_note || "",
          dispatch_note: transfer.dispatch_note || "",
          receive_note: transfer.receive_note || "",
          cancel_note: transfer.cancel_note || "",
          reject_note: transfer.reject_note || "",
          requested_at: formatDateTime(transfer.requested_at),
          approved_at: formatDateTime(transfer.approved_at),
          dispatched_at: formatDateTime(transfer.dispatched_at),
          received_at: formatDateTime(transfer.received_at),
          cancelled_at: formatDateTime(transfer.cancelled_at),
          rejected_at: formatDateTime(transfer.rejected_at),
          created_at: formatDateTime(transfer.created_at),
        });
      });

      const itemsWorksheet = workbook.addWorksheet("Transfer Items");

      itemsWorksheet.columns = [
        { header: "Transfer Number", key: "transfer_number" },
        { header: "Status", key: "status" },
        { header: "From Store", key: "from_store" },
        { header: "To Store", key: "to_store" },
        { header: "Product", key: "product_name" },
        { header: "Category", key: "category" },
        { header: "Size", key: "size" },
        { header: "Barcode", key: "barcode" },
        { header: "Requested Quantity", key: "requested_quantity" },
        { header: "Dispatched Quantity", key: "dispatched_quantity" },
        { header: "Received Quantity", key: "received_quantity" },
        { header: "Source Qty Before", key: "source_quantity_before" },
        { header: "Source Qty After", key: "source_quantity_after" },
        {
          header: "Destination Qty Before",
          key: "destination_quantity_before",
        },
        { header: "Destination Qty After", key: "destination_quantity_after" },
        { header: "Item Note", key: "item_note" },
        { header: "Created At", key: "created_at" },
      ];

      transferItems.forEach((item) => {
        itemsWorksheet.addRow({
          transfer_number: item.transfer_number || "",
          status: item.status || "",
          from_store: `${item.from_branch_code || ""} - ${
            item.from_branch_name || ""
          }`,
          to_store: `${item.to_branch_code || ""} - ${
            item.to_branch_name || ""
          }`,
          product_name: item.product_name || "",
          category: item.category || "",
          size: item.size || "",
          barcode: item.barcode || "",
          requested_quantity: Number(item.requested_quantity || 0),
          dispatched_quantity: Number(item.dispatched_quantity || 0),
          received_quantity: Number(item.received_quantity || 0),
          source_quantity_before:
            item.source_quantity_before === null ||
            item.source_quantity_before === undefined
              ? ""
              : Number(item.source_quantity_before || 0),
          source_quantity_after:
            item.source_quantity_after === null ||
            item.source_quantity_after === undefined
              ? ""
              : Number(item.source_quantity_after || 0),
          destination_quantity_before:
            item.destination_quantity_before === null ||
            item.destination_quantity_before === undefined
              ? ""
              : Number(item.destination_quantity_before || 0),
          destination_quantity_after:
            item.destination_quantity_after === null ||
            item.destination_quantity_after === undefined
              ? ""
              : Number(item.destination_quantity_after || 0),
          item_note: item.item_note || "",
          created_at: formatDateTime(item.created_at),
        });
      });

      const summaryWorksheet = workbook.addWorksheet("Transfer Summary");

      const transfersOut = transfers.filter(
        (transfer) => Number(transfer.from_branch_id) === Number(branchId)
      );

      const transfersIn = transfers.filter(
        (transfer) => Number(transfer.to_branch_id) === Number(branchId)
      );

      const requestedTransfers = transfers.filter(
        (transfer) => transfer.status === "requested"
      );

      const approvedTransfers = transfers.filter(
        (transfer) => transfer.status === "approved"
      );

      const dispatchedTransfers = transfers.filter(
        (transfer) => transfer.status === "dispatched"
      );

      const receivedTransfers = transfers.filter(
        (transfer) => transfer.status === "received"
      );

      const cancelledTransfers = transfers.filter(
        (transfer) => transfer.status === "cancelled"
      );

      const rejectedTransfers = transfers.filter(
        (transfer) => transfer.status === "rejected"
      );

      const totalQtyOut = transfersOut.reduce(
        (sum, transfer) =>
          sum + Number(transfer.total_dispatched_quantity || 0),
        0
      );

      const totalQtyIn = transfersIn.reduce(
        (sum, transfer) => sum + Number(transfer.total_received_quantity || 0),
        0
      );

      summaryWorksheet.columns = [
        { header: "Metric", key: "metric" },
        { header: "Value", key: "value" },
      ];

      summaryWorksheet.addRow({
        metric: "Transfers exported",
        value: transfers.length,
      });

      summaryWorksheet.addRow({
        metric: "Transfer out records",
        value: transfersOut.length,
      });

      summaryWorksheet.addRow({
        metric: "Transfer in records",
        value: transfersIn.length,
      });

      summaryWorksheet.addRow({
        metric: "Requested transfers",
        value: requestedTransfers.length,
      });

      summaryWorksheet.addRow({
        metric: "Approved transfers",
        value: approvedTransfers.length,
      });

      summaryWorksheet.addRow({
        metric: "Dispatched transfers",
        value: dispatchedTransfers.length,
      });

      summaryWorksheet.addRow({
        metric: "Received transfers",
        value: receivedTransfers.length,
      });

      summaryWorksheet.addRow({
        metric: "Cancelled transfers",
        value: cancelledTransfers.length,
      });

      summaryWorksheet.addRow({
        metric: "Rejected transfers",
        value: rejectedTransfers.length,
      });

      summaryWorksheet.addRow({
        metric: "Total quantity transferred out",
        value: totalQtyOut,
      });

      summaryWorksheet.addRow({
        metric: "Total quantity received in",
        value: totalQtyIn,
      });

      styleWorksheet(transfersWorksheet);
      styleWorksheet(itemsWorksheet);
      styleWorksheet(summaryWorksheet);

      return sendStoreWorkbook(req, res, workbook, "stock-transfers");
    } catch (error) {
      console.error("Export stock transfers error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while exporting stock transfers.",
      });
    }
  }
);


// GET /api/exports/stock-ledger
router.get(
  "/stock-ledger",
  requireAuth,
  requireRole("admin", "manager", "auditor"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const from = cleanText(req.query.from);
      const to = cleanText(req.query.to);
      const warnings = [];

      const [products] = await pool.query(
        `SELECT
          id,
          branch_id,
          name,
          size,
          category,
          barcode,
          quantity,
          low_stock_threshold,
          is_active,
          created_at
         FROM products
         WHERE branch_id = ?
         AND is_active = TRUE
         ORDER BY name ASC`,
        [branchId]
      );

      const productMap = new Map();
      const productNameMap = new Map();
      const ledgerMap = new Map();

      products.forEach((product) => {
        const cleanProduct = {
          id: product.id,
          branch_id: product.branch_id,
          name: product.name || "",
          size: product.size || "",
          category: product.category || "",
          barcode: product.barcode || "",
          quantity: toLedgerNumber(product.quantity),
          low_stock_threshold: toLedgerNumber(product.low_stock_threshold),
          created_at: product.created_at,
        };

        productMap.set(Number(product.id), cleanProduct);
        ledgerMap.set(Number(product.id), []);

        const nameKey = getProductNameKey(product.name);

        if (nameKey && !productNameMap.has(nameKey)) {
          productNameMap.set(nameKey, Number(product.id));
        }
      });

      function findProductByName(productName) {
        const productId = productNameMap.get(getProductNameKey(productName));

        if (!productId) {
          return null;
        }

        return productMap.get(productId) || null;
      }

      function addLedgerEntry(productId, entry) {
        const numericProductId = Number(productId);
        const product = productMap.get(numericProductId);

        if (!product || !ledgerMap.has(numericProductId)) {
          return;
        }

        ledgerMap.get(numericProductId).push(
          createLedgerEntry({
            ...entry,
            product_id: numericProductId,
            product_name: product.name,
            product_size: product.size,
            product_category: product.category,
            product_barcode: product.barcode,
          })
        );
      }

      const adjustments = await safeExportQuery(
        "Stock adjustments",
        `SELECT
          sa.id,
          sa.product_id,
          sa.adjustment_type,
          sa.quantity,
          sa.old_quantity,
          sa.new_quantity,
          sa.reason,
          sa.adjusted_at,
          u.full_name AS adjusted_by_name
         FROM stock_adjustments sa
         LEFT JOIN users u ON sa.adjusted_by = u.id
         WHERE sa.branch_id = ?
         ORDER BY sa.adjusted_at ASC, sa.id ASC`,
        [branchId],
        warnings
      );

      adjustments.forEach((adjustment) => {
        const productId = Number(adjustment.product_id);
        const oldQuantity = toLedgerNumber(adjustment.old_quantity);
        const newQuantity = toLedgerNumber(adjustment.new_quantity);
        const changeQuantity = newQuantity - oldQuantity;

        addLedgerEntry(productId, {
          date: adjustment.adjusted_at,
          movement_type: `Stock Adjustment - ${adjustment.adjustment_type || ""}`,
          reference: `ADJ-${adjustment.id}`,
          details: adjustment.reason || "",
          change_quantity: changeQuantity,
          quantity_before: oldQuantity,
          quantity_after: newQuantity,
          recorded_by: adjustment.adjusted_by_name || "",
          source: "stock_adjustments",
          sort_id: adjustment.id,
        });
      });

      const sales = await safeExportQuery(
        "Sales movement",
        `SELECT
          si.id,
          si.sale_id,
          si.product_name,
          si.quantity,
          si.unit_price,
          si.line_total,
          s.receipt_number,
          s.customer_name,
          s.customer_phone,
          s.created_at,
          u.full_name AS staff_name
         FROM sale_items si
         INNER JOIN sales s ON si.sale_id = s.id
         LEFT JOIN users u ON s.staff_id = u.id
         WHERE s.branch_id = ?
         AND COALESCE(s.is_voided, 0) = 0
         AND COALESCE(s.sale_status, 'completed') != 'cancelled'
         ORDER BY s.created_at ASC, si.id ASC`,
        [branchId],
        warnings
      );

      sales.forEach((saleItem) => {
        const product = findProductByName(saleItem.product_name);

        if (!product) {
          return;
        }

        const quantity = toLedgerNumber(saleItem.quantity);

        addLedgerEntry(product.id, {
          date: saleItem.created_at,
          movement_type: "Sale",
          reference: saleItem.receipt_number || `SALE-${saleItem.sale_id}`,
          details: `Sold to ${
            saleItem.customer_name || saleItem.customer_phone || "Walk-in Customer"
          }`,
          change_quantity: -quantity,
          recorded_by: saleItem.staff_name || "",
          source: "sale_items",
          sort_id: saleItem.id,
        });
      });

      const purchases = await safeExportQuery(
        "Purchase movement",
        `SELECT
          pi.id,
          pi.purchase_id,
          pi.product_name,
          pi.quantity,
          pi.cost_price,
          pi.line_total,
          p.invoice_number,
          p.purchase_date,
          p.created_at,
          s.name AS supplier_name,
          u.full_name AS created_by_name
         FROM purchase_items pi
         INNER JOIN purchases p ON pi.purchase_id = p.id
         LEFT JOIN suppliers s
          ON p.supplier_id = s.id
          AND s.branch_id = p.branch_id
         LEFT JOIN users u ON p.created_by = u.id
         WHERE p.branch_id = ?
         ORDER BY p.purchase_date ASC, pi.id ASC`,
        [branchId],
        warnings
      );

      purchases.forEach((purchaseItem) => {
        const product = findProductByName(purchaseItem.product_name);

        if (!product) {
          return;
        }

        const quantity = toLedgerNumber(purchaseItem.quantity);

        addLedgerEntry(product.id, {
          date: purchaseItem.purchase_date || purchaseItem.created_at,
          movement_type: "Purchase",
          reference:
            purchaseItem.invoice_number || `PUR-${purchaseItem.purchase_id}`,
          details: `Purchased from ${purchaseItem.supplier_name || "Supplier"}`,
          change_quantity: quantity,
          recorded_by: purchaseItem.created_by_name || "",
          source: "purchase_items",
          sort_id: purchaseItem.id,
        });
      });

      const returns = await safeExportQuery(
        "Returns movement",
        `SELECT
          r.id,
          r.product_id,
          r.quantity,
          r.reason,
          r.returned_at,
          s.receipt_number,
          s.customer_name,
          s.customer_phone
         FROM returns r
         LEFT JOIN sales s
          ON r.sale_id = s.id
          AND s.branch_id = r.branch_id
         WHERE r.branch_id = ?
         ORDER BY r.returned_at ASC, r.id ASC`,
        [branchId],
        warnings
      );

      returns.forEach((returnItem) => {
        const productId = Number(returnItem.product_id);
        const quantity = toLedgerNumber(returnItem.quantity);

        addLedgerEntry(productId, {
          date: returnItem.returned_at,
          movement_type: "Return",
          reference: returnItem.receipt_number || `RET-${returnItem.id}`,
          details:
            returnItem.reason ||
            `Returned by ${
              returnItem.customer_name || returnItem.customer_phone || "Customer"
            }`,
          change_quantity: quantity,
          recorded_by: "",
          source: "returns",
          sort_id: returnItem.id,
        });
      });

      const transferOut = await safeExportQuery(
        "Transfer out movement",
        `SELECT
          sti.id,
          sti.transfer_id,
          sti.source_product_id,
          sti.dispatched_quantity,
          sti.received_quantity,
          st.transfer_number,
          st.status,
          st.dispatched_at,
          st.received_at,
          st.created_at,
          tb.code AS to_branch_code,
          tb.name AS to_branch_name,
          u.full_name AS dispatched_by_name
         FROM stock_transfer_items sti
         INNER JOIN stock_transfers st ON sti.transfer_id = st.id
         LEFT JOIN branches tb ON tb.id = st.to_branch_id
         LEFT JOIN users u ON st.dispatched_by = u.id
         WHERE st.from_branch_id = ?
         AND st.status IN ('dispatched', 'received')
         ORDER BY COALESCE(st.dispatched_at, st.created_at) ASC, sti.id ASC`,
        [branchId],
        warnings
      );

      transferOut.forEach((transferItem) => {
        const productId = Number(transferItem.source_product_id);
        const quantity =
          toLedgerNumber(transferItem.dispatched_quantity) ||
          toLedgerNumber(transferItem.received_quantity);

        addLedgerEntry(productId, {
          date: transferItem.dispatched_at || transferItem.created_at,
          movement_type: "Transfer Out",
          reference:
            transferItem.transfer_number || `TRF-${transferItem.transfer_id}`,
          details: `Transferred to ${
            transferItem.to_branch_code ||
            transferItem.to_branch_name ||
            "another store"
          }`,
          change_quantity: -quantity,
          recorded_by: transferItem.dispatched_by_name || "",
          source: "stock_transfer_items",
          sort_id: transferItem.id,
        });
      });

      const transferIn = await safeExportQuery(
        "Transfer in movement",
        `SELECT
          sti.id,
          sti.transfer_id,
          sti.destination_product_id,
          sti.dispatched_quantity,
          sti.received_quantity,
          st.transfer_number,
          st.status,
          st.dispatched_at,
          st.received_at,
          st.created_at,
          fb.code AS from_branch_code,
          fb.name AS from_branch_name,
          u.full_name AS received_by_name
         FROM stock_transfer_items sti
         INNER JOIN stock_transfers st ON sti.transfer_id = st.id
         LEFT JOIN branches fb ON fb.id = st.from_branch_id
         LEFT JOIN users u ON st.received_by = u.id
         WHERE st.to_branch_id = ?
         AND st.status = 'received'
         ORDER BY COALESCE(st.received_at, st.created_at) ASC, sti.id ASC`,
        [branchId],
        warnings
      );

      transferIn.forEach((transferItem) => {
        const productId = Number(transferItem.destination_product_id);
        const quantity =
          toLedgerNumber(transferItem.received_quantity) ||
          toLedgerNumber(transferItem.dispatched_quantity);

        addLedgerEntry(productId, {
          date: transferItem.received_at || transferItem.created_at,
          movement_type: "Transfer In",
          reference:
            transferItem.transfer_number || `TRF-${transferItem.transfer_id}`,
          details: `Received from ${
            transferItem.from_branch_code ||
            transferItem.from_branch_name ||
            "another store"
          }`,
          change_quantity: quantity,
          recorded_by: transferItem.received_by_name || "",
          source: "stock_transfer_items",
          sort_id: transferItem.id,
        });
      });

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 System";
      workbook.created = new Date();

      const ledgerWorksheet = workbook.addWorksheet("Stock Movement Ledger");

      ledgerWorksheet.columns = [
        { header: "Date", key: "date" },
        { header: "Product", key: "product_name" },
        { header: "Size", key: "product_size" },
        { header: "Category", key: "product_category" },
        { header: "Barcode", key: "product_barcode" },
        { header: "Movement Type", key: "movement_type" },
        { header: "Reference", key: "reference" },
        { header: "Details", key: "details" },
        { header: "Change Qty", key: "change_quantity" },
        { header: "Qty Before", key: "quantity_before" },
        { header: "Qty After", key: "quantity_after" },
        { header: "Recorded By", key: "recorded_by" },
        { header: "Source", key: "source" },
      ];

      const productSummaryWorksheet = workbook.addWorksheet("Product Summary");

      productSummaryWorksheet.columns = [
        { header: "Product", key: "product_name" },
        { header: "Size", key: "product_size" },
        { header: "Category", key: "product_category" },
        { header: "Barcode", key: "product_barcode" },
        { header: "Opening Qty", key: "opening_quantity" },
        { header: "Purchases", key: "purchase_quantity" },
        { header: "Sales", key: "sales_quantity" },
        { header: "Returns", key: "returns_quantity" },
        { header: "Transfer In", key: "transfer_in_quantity" },
        { header: "Transfer Out", key: "transfer_out_quantity" },
        { header: "Adjustment Increase", key: "adjustment_increase_quantity" },
        { header: "Adjustment Decrease", key: "adjustment_decrease_quantity" },
        { header: "Current Qty", key: "current_quantity" },
        { header: "Movement Records", key: "movement_records" },
      ];

      const summaryWorksheet = workbook.addWorksheet("Ledger Summary");

      summaryWorksheet.columns = [
        { header: "Metric", key: "metric" },
        { header: "Value", key: "value" },
      ];

      const allExportedEntries = [];
      const productSummaries = [];

      products.forEach((product) => {
        const productId = Number(product.id);
        const productEntries = ledgerMap.get(productId) || [];

        productEntries.sort((a, b) => {
          const dateA = a.date ? new Date(a.date).getTime() : 0;
          const dateB = b.date ? new Date(b.date).getTime() : 0;

          if (dateA !== dateB) {
            return dateA - dateB;
          }

          return a.sort_id - b.sort_id;
        });

        const currentQuantity = toLedgerNumber(product.quantity);
        const totalChange = productEntries.reduce(
          (sum, entry) => sum + toLedgerNumber(entry.change_quantity),
          0
        );
        const openingQuantity = currentQuantity - totalChange;
        let runningQuantity = openingQuantity;

        const productEntriesWithRunningStock = productEntries.map((entry) => {
          const quantityBefore =
            entry.quantity_before === null
              ? runningQuantity
              : toLedgerNumber(entry.quantity_before);

          const quantityAfter =
            entry.quantity_after === null
              ? quantityBefore + toLedgerNumber(entry.change_quantity)
              : toLedgerNumber(entry.quantity_after);

          runningQuantity = quantityAfter;

          return {
            ...entry,
            quantity_before: quantityBefore,
            quantity_after: quantityAfter,
          };
        });

        const exportedProductEntries = productEntriesWithRunningStock.filter(
          (entry) => isLedgerDateInRange(entry.date, from, to)
        );

        exportedProductEntries.forEach((entry) => {
          allExportedEntries.push(entry);

          ledgerWorksheet.addRow({
            date: formatDateTime(entry.date),
            product_name: entry.product_name,
            product_size: entry.product_size,
            product_category: entry.product_category,
            product_barcode: entry.product_barcode,
            movement_type: entry.movement_type,
            reference: entry.reference,
            details: entry.details,
            change_quantity: toLedgerNumber(entry.change_quantity),
            quantity_before: toLedgerNumber(entry.quantity_before),
            quantity_after: toLedgerNumber(entry.quantity_after),
            recorded_by: entry.recorded_by,
            source: entry.source,
          });
        });

        const summaryEntries = exportedProductEntries;

        const purchaseQuantity = summaryEntries
          .filter((entry) => entry.movement_type === "Purchase")
          .reduce((sum, entry) => sum + toLedgerNumber(entry.change_quantity), 0);

        const salesQuantity = Math.abs(
          summaryEntries
            .filter((entry) => entry.movement_type === "Sale")
            .reduce((sum, entry) => sum + toLedgerNumber(entry.change_quantity), 0)
        );

        const returnsQuantity = summaryEntries
          .filter((entry) => entry.movement_type === "Return")
          .reduce((sum, entry) => sum + toLedgerNumber(entry.change_quantity), 0);

        const transferInQuantity = summaryEntries
          .filter((entry) => entry.movement_type === "Transfer In")
          .reduce((sum, entry) => sum + toLedgerNumber(entry.change_quantity), 0);

        const transferOutQuantity = Math.abs(
          summaryEntries
            .filter((entry) => entry.movement_type === "Transfer Out")
            .reduce((sum, entry) => sum + toLedgerNumber(entry.change_quantity), 0)
        );

        const adjustmentIncreaseQuantity = summaryEntries
          .filter(
            (entry) =>
              String(entry.movement_type).startsWith("Stock Adjustment") &&
              toLedgerNumber(entry.change_quantity) > 0
          )
          .reduce((sum, entry) => sum + toLedgerNumber(entry.change_quantity), 0);

        const adjustmentDecreaseQuantity = Math.abs(
          summaryEntries
            .filter(
              (entry) =>
                String(entry.movement_type).startsWith("Stock Adjustment") &&
                toLedgerNumber(entry.change_quantity) < 0
            )
            .reduce((sum, entry) => sum + toLedgerNumber(entry.change_quantity), 0)
        );

        const productSummary = {
          product_name: product.name || "",
          product_size: product.size || "",
          product_category: product.category || "",
          product_barcode: product.barcode || "",
          opening_quantity: openingQuantity,
          purchase_quantity: purchaseQuantity,
          sales_quantity: salesQuantity,
          returns_quantity: returnsQuantity,
          transfer_in_quantity: transferInQuantity,
          transfer_out_quantity: transferOutQuantity,
          adjustment_increase_quantity: adjustmentIncreaseQuantity,
          adjustment_decrease_quantity: adjustmentDecreaseQuantity,
          current_quantity: currentQuantity,
          movement_records: summaryEntries.length,
        };

        productSummaries.push(productSummary);

        productSummaryWorksheet.addRow(productSummary);
      });

      const totalPurchases = productSummaries.reduce(
        (sum, product) => sum + toLedgerNumber(product.purchase_quantity),
        0
      );

      const totalSales = productSummaries.reduce(
        (sum, product) => sum + toLedgerNumber(product.sales_quantity),
        0
      );

      const totalReturns = productSummaries.reduce(
        (sum, product) => sum + toLedgerNumber(product.returns_quantity),
        0
      );

      const totalTransferIn = productSummaries.reduce(
        (sum, product) => sum + toLedgerNumber(product.transfer_in_quantity),
        0
      );

      const totalTransferOut = productSummaries.reduce(
        (sum, product) => sum + toLedgerNumber(product.transfer_out_quantity),
        0
      );

      const totalAdjustmentIncrease = productSummaries.reduce(
        (sum, product) =>
          sum + toLedgerNumber(product.adjustment_increase_quantity),
        0
      );

      const totalAdjustmentDecrease = productSummaries.reduce(
        (sum, product) =>
          sum + toLedgerNumber(product.adjustment_decrease_quantity),
        0
      );

      summaryWorksheet.addRow({
        metric: "Store ID",
        value: branchId,
      });

      summaryWorksheet.addRow({
        metric: "From Date",
        value: from || "All time",
      });

      summaryWorksheet.addRow({
        metric: "To Date",
        value: to || "All time",
      });

      summaryWorksheet.addRow({
        metric: "Products exported",
        value: products.length,
      });

      summaryWorksheet.addRow({
        metric: "Ledger movement records exported",
        value: allExportedEntries.length,
      });

      summaryWorksheet.addRow({
        metric: "Total purchases quantity",
        value: totalPurchases,
      });

      summaryWorksheet.addRow({
        metric: "Total sales quantity",
        value: totalSales,
      });

      summaryWorksheet.addRow({
        metric: "Total returns quantity",
        value: totalReturns,
      });

      summaryWorksheet.addRow({
        metric: "Total transfer in quantity",
        value: totalTransferIn,
      });

      summaryWorksheet.addRow({
        metric: "Total transfer out quantity",
        value: totalTransferOut,
      });

      summaryWorksheet.addRow({
        metric: "Total adjustment increase quantity",
        value: totalAdjustmentIncrease,
      });

      summaryWorksheet.addRow({
        metric: "Total adjustment decrease quantity",
        value: totalAdjustmentDecrease,
      });

      if (warnings.length > 0) {
        const warningWorksheet = workbook.addWorksheet("Warnings");

        warningWorksheet.columns = [
          { header: "Warning", key: "warning" },
        ];

        warnings.forEach((warning) => {
          warningWorksheet.addRow({ warning });
        });

        styleWorksheet(warningWorksheet);
      }

      styleWorksheet(ledgerWorksheet);
      styleWorksheet(productSummaryWorksheet);
      styleWorksheet(summaryWorksheet);

      return sendStoreWorkbook(req, res, workbook, "stock-movement-ledger");
    } catch (error) {
      console.error("Export stock movement ledger error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while exporting stock movement ledger.",
      });
    }
  }
);

module.exports = router;
