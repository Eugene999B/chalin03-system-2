require("./equipmentCreditOptionalApprovalBootstrap");
require("./operationalApprovalBootstrap");
require("./stockLedgerSummaryBootstrap");
require("./executivePackNotificationDeliveryBootstrap");

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const ExcelJS = require("./excelJsCompat");

const INVALID_WORKSHEET_CHARACTERS = /[*?:\\/\[\]]/g;
const MAX_WORKSHEET_NAME_LENGTH = 31;
const INSTALL_FLAG = Symbol.for("chalin03.exportWorkbookSafetyInstalled");
const MICKEY_VISIBILITY_FLAG = Symbol.for(
  "chalin03.masterMickeyMergeProfileVisibilityChecked"
);

function runMasterMickeyMergeProfileVisibility() {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    return { skipped: true, reason: "non-production" };
  }
  if (globalThis[MICKEY_VISIBILITY_FLAG]) {
    return { skipped: true, reason: "already-checked" };
  }

  const scriptPath = path.join(
    __dirname,
    "..",
    "scripts",
    "runMasterMickeyMergeProfileVisibilityRetry20260806.js"
  );
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: path.join(__dirname, ".."),
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) throw result.error;
  if (Number(result.status) !== 0) {
    throw new Error(
      `Master Mickey merge-profile visibility startup check failed with exit code ${result.status}.`
    );
  }

  Object.defineProperty(globalThis, MICKEY_VISIBILITY_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return { applied_or_verified: true };
}

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

runMasterMickeyMergeProfileVisibility();
installExportWorkbookSafety();

module.exports = {
  INVALID_WORKSHEET_CHARACTERS,
  MAX_WORKSHEET_NAME_LENGTH,
  createUniqueWorksheetName,
  installExportWorkbookSafety,
  runMasterMickeyMergeProfileVisibility,
  sanitizeWorksheetName,
};
