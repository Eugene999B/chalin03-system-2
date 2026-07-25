const excelModule = require("exceljs");

const ExcelJS = excelModule?.default || excelModule;

if (!ExcelJS || typeof ExcelJS.Workbook !== "function") {
  const exportedKeys = Object.keys(excelModule || {}).join(", ");
  throw new Error(`ExcelJS compatibility adapter could not resolve Workbook. Exports: ${exportedKeys || "none"}`);
}

module.exports = ExcelJS;
