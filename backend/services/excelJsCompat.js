const excelModule = require("exceljs");

const ExcelJS = excelModule?.default || excelModule;

if (!ExcelJS || typeof ExcelJS.Workbook !== "function") {
  const exportedKeys = Object.keys(excelModule || {}).join(", ");
  throw new Error(
    `ExcelJS compatibility adapter could not resolve Workbook. Exports: ${
      exportedKeys || "none"
    }`
  );
}

const PRODUCTS_SHEET_NAME = "Products";
const SUMMARY_SHEET_NAME = "00 Executive Summary";
const PRODUCTS_REPORT_TITLE = "Products and Inventory Register";
const SANITISED_FLAG = Symbol("chalin03ProductsWorkbookSanitised");

function getCellText(cell) {
  const value = cell?.value;

  if (value === undefined || value === null) return "";

  if (typeof value === "object") {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text || "").join("").trim();
    }

    if (value.result !== undefined && value.result !== null) {
      return String(value.result).trim();
    }

    if (value.text !== undefined && value.text !== null) {
      return String(value.text).trim();
    }
  }

  return String(value).trim();
}

function worksheetContainsText(worksheet, expectedText, maxRows = 12) {
  const rowLimit = Math.min(
    Math.max(worksheet?.actualRowCount || worksheet?.rowCount || 1, 1),
    maxRows
  );

  for (let rowNumber = 1; rowNumber <= rowLimit; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    let found = false;

    row.eachCell({ includeEmpty: false }, (cell) => {
      if (getCellText(cell) === expectedText) found = true;
    });

    if (found) return true;
  }

  return false;
}

function findHeaderCell(worksheet, expectedHeader, maxRows = 20) {
  const rowLimit = Math.min(
    Math.max(worksheet?.actualRowCount || worksheet?.rowCount || 1, 1),
    maxRows
  );

  for (let rowNumber = 1; rowNumber <= rowLimit; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    let matchedColumn = null;

    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      if (getCellText(cell).toLowerCase() === expectedHeader.toLowerCase()) {
        matchedColumn = columnNumber;
      }
    });

    if (matchedColumn) {
      return { rowNumber, columnNumber: matchedColumn };
    }
  }

  return null;
}

function clearRowsByFirstCell(worksheet, labels) {
  if (!worksheet) return;

  const normalisedLabels = new Set(labels.map((label) => label.toLowerCase()));
  const rowLimit = Math.max(worksheet.actualRowCount || worksheet.rowCount || 0, 0);

  for (let rowNumber = 1; rowNumber <= rowLimit; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const firstCellText = getCellText(row.getCell(1));
    const normalisedText = firstCellText.toLowerCase();
    const shouldClear =
      normalisedLabels.has(normalisedText) ||
      [...normalisedLabels].some(
        (label) => label.endsWith(":") && normalisedText.startsWith(label)
      );

    if (!shouldClear) continue;

    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.value = null;
    });
  }
}

function clearAndHideDataColumn(worksheet, headerCell) {
  if (!worksheet || !headerCell) return;

  const { rowNumber: headerRowNumber, columnNumber } = headerCell;
  const rowLimit = Math.max(
    worksheet.actualRowCount || worksheet.rowCount || headerRowNumber,
    headerRowNumber
  );

  for (let rowNumber = headerRowNumber; rowNumber <= rowLimit; rowNumber += 1) {
    worksheet.getCell(rowNumber, columnNumber).value = null;
  }

  const column = worksheet.getColumn(columnNumber);
  column.hidden = true;
  column.width = 0.1;
}

function sanitiseProductsWorkbook(workbook) {
  if (!workbook || workbook[SANITISED_FLAG]) return;

  const productsWorksheet = workbook.getWorksheet?.(PRODUCTS_SHEET_NAME);

  if (
    !productsWorksheet ||
    !worksheetContainsText(productsWorksheet, PRODUCTS_REPORT_TITLE)
  ) {
    return;
  }

  const createdAtHeader = findHeaderCell(productsWorksheet, "Created At");
  clearAndHideDataColumn(productsWorksheet, createdAtHeader);
  clearRowsByFirstCell(productsWorksheet, ["Generated:"]);

  const summaryWorksheet = workbook.getWorksheet?.(SUMMARY_SHEET_NAME);
  clearRowsByFirstCell(summaryWorksheet, ["Report Period", "Generated"]);

  workbook[SANITISED_FLAG] = true;
}

function patchWorkbookWriter(workbook) {
  const writer = workbook?.xlsx;

  if (!writer) return;

  ["write", "writeBuffer", "writeFile"].forEach((methodName) => {
    const originalMethod = writer[methodName];

    if (typeof originalMethod !== "function") return;

    writer[methodName] = function patchedExcelWrite(...args) {
      sanitiseProductsWorkbook(workbook);
      return originalMethod.apply(this, args);
    };
  });
}

const BaseWorkbook = ExcelJS.Workbook;

class Chalin03Workbook extends BaseWorkbook {
  constructor(...args) {
    super(...args);
    patchWorkbookWriter(this);
  }
}

ExcelJS.Workbook = Chalin03Workbook;

module.exports = ExcelJS;
