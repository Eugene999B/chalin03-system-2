const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireWorkspaceCategory } = require("./categoryIsolationService");
const equipmentFinanceProfessionalRoutes = require("../routes/equipmentFinanceProfessionalRoutes");

// Railway preloads this bootstrap in production before server.js constructs the app.
// Keep the existing startup behavior, and attach the Finance Professional API when
// the canonical Equipment Catalogue router is registered. This avoids replacing the
// large catalogue router just to expose the additive Finance policy endpoints.
const ROUTE_MOUNT_FLAG = Symbol.for("chalin03.equipmentFinanceProfessionalRoutesMounted");
const originalExpressUse = express.application.use;
if (!express.application[ROUTE_MOUNT_FLAG]) {
  express.application.use = function chalin03FinanceAwareUse(...args) {
    const result = originalExpressUse.apply(this, args);
    const mountPath = args[0];
    if (
      mountPath === "/api/equipment-catalogue" &&
      !this[ROUTE_MOUNT_FLAG]
    ) {
      const hireBoundary = requireWorkspaceCategory("equipment_hire");
      originalExpressUse.call(
        this,
        "/api/equipment-catalogue/sales",
        requireAuth,
        hireBoundary,
        equipmentFinanceProfessionalRoutes
      );
      Object.defineProperty(this, ROUTE_MOUNT_FLAG, {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false,
      });
      console.log("Equipment Finance Professional routes mounted at /api/equipment-catalogue/sales/professional.");
    }
    return result;
  };
  Object.defineProperty(express.application, ROUTE_MOUNT_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

require("./equipmentCreditOptionalApprovalBootstrap");
require("./operationalApprovalBootstrap");
require("./stockLedgerSummaryBootstrap");
require("./executivePackNotificationDeliveryBootstrap");
require("./equipmentFinanceBossAlertDeliveryBootstrap");
require("./equipmentFinanceLateFeeScheduler").startEquipmentFinanceLateFeeScheduler();

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

  if (!name) name = fallback;
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
  if (prototype[INSTALL_FLAG]) return false;

  const originalAddWorksheet = prototype.addWorksheet;
  prototype.addWorksheet = function addSafeWorksheet(name, options) {
    return originalAddWorksheet.call(this, createUniqueWorksheetName(this, name), options);
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
