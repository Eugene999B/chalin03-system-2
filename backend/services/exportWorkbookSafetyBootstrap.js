const ExcelJS = require("exceljs");

const INVALID_WORKSHEET_CHARACTERS = /[*?:\\/\[\]]/g;
const MAX_WORKSHEET_NAME_LENGTH = 31;
const INSTALL_FLAG = Symbol.for("chalin03.exportWorkbookSafetyInstalled");

function sanitizeWorksheetName(value, fallback = "Sheet") {
  let name = String(value || fallback)
    .replace(INVALID_WORKSHEET_CHARACTERS, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^'+|'+$/g, "");

  if (!name) {
    name = fallback;
  }

  return name.slice(0, MAX_WORKSHEET_NAME_LENGTH);
}

function createUniqueWorksheetName(workbook, value) {
  const baseName = sanitizeWorksheetName(value);
  let candidate = baseName;
  let counter = 2;

  while (workbook.getWorksheet(candidate)) {
    const suffix = ` (${counter})`;
    candidate = `${baseName.slice(0, MAX_WORKSHEET_NAME_LENGTH - suffix.length)}${suffix}`;
    counter += 1;
  }

  return candidate;
}

function installExportWorkbookSafety() {
  const prototype = ExcelJS.Workbook.prototype;

  if (prototype[INSTALL_FLAG]) {
    return false;
  }

  const originalAddWorksheet = prototype.addWorksheet;

  prototype.addWorksheet = function addSafeWorksheet(name, options) {
    return originalAddWorksheet.call(
      this,
      createUniqueWorksheetName(this, name),
      options
    );
  };

  Object.defineProperty(prototype, INSTALL_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  return true;
}

installExportWorkbookSafety();

module.exports = {
  INVALID_WORKSHEET_CHARACTERS,
  MAX_WORKSHEET_NAME_LENGTH,
  createUniqueWorksheetName,
  installExportWorkbookSafety,
  sanitizeWorksheetName,
};
