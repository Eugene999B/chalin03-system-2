require("./equipmentCreditOptionalApprovalBootstrap");
require("./operationalApprovalBootstrap");
require("./stockLedgerSummaryBootstrap");
require("./backupSafetyRecoveryBootstrap");

const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const ExcelJS = require("./excelJsCompat");

const INVALID_WORKSHEET_CHARACTERS = /[*?:\\/\[\]]/g;
const MAX_WORKSHEET_NAME_LENGTH = 31;
const INSTALL_FLAG = Symbol.for("chalin03.exportWorkbookSafetyInstalled");
const MICKEY_VISIBILITY_FLAG = Symbol.for(
  "chalin03.masterMickeyMergeProfileVisibilityChecked"
);
const CHALIN_ONE_FULL_TRIAL_SEED_FLAG = Symbol.for(
  "chalin03.chalinOneFullTrialSeedChecked"
);
const CHALIN_ONE_FULL_TRIAL_SEED_DIAGNOSTIC = Symbol.for(
  "chalin03.chalinOneFullTrialSeedDiagnostic"
);
const CHALIN_ONE_STAGING_ENVIRONMENT_ID =
  "db796450-1b80-42e8-9988-db3e90ca0713";
const TRIAL_SEED_OUTPUT_LIMIT = 2400;

function cleanTrialSeedOutput(value) {
  return String(value || "")
    .replace(/(?:mysql|mariadb):\/\/[^\s]+/gi, "[database-url-redacted]")
    .replace(/(?:password|secret|token)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
    .trim()
    .slice(-TRIAL_SEED_OUTPUT_LIMIT);
}

function setTrialSeedDiagnostic(value) {
  globalThis[CHALIN_ONE_FULL_TRIAL_SEED_DIAGNOSTIC] = Object.freeze({
    ...value,
    updated_at: new Date().toISOString(),
  });
}

function runChalinOneFullTrialSeedBootstrap() {
  const environmentId = String(process.env.RAILWAY_ENVIRONMENT_ID || "").trim();
  if (environmentId !== CHALIN_ONE_STAGING_ENVIRONMENT_ID) {
    return { skipped: true, reason: "not-dedicated-chalin-one-staging" };
  }
  if (globalThis[CHALIN_ONE_FULL_TRIAL_SEED_FLAG]) {
    return { skipped: true, reason: "already-checked" };
  }

  Object.defineProperty(globalThis, CHALIN_ONE_FULL_TRIAL_SEED_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  const scriptPath = path.join(
    __dirname,
    "..",
    "scripts",
    "runChalinOneFullTrialSeedIfStaging.js"
  );

  setTrialSeedDiagnostic({
    status: "running",
    environment_id: environmentId,
    started_at: new Date().toISOString(),
    exit_code: null,
    message: "CHALIN ONE full-trial seed and invariant verification are running.",
  });

  const child = spawn(process.execPath, [scriptPath], {
    cwd: path.join(__dirname, ".."),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout = `${stdout}${chunk}`.slice(-TRIAL_SEED_OUTPUT_LIMIT);
  });
  child.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-TRIAL_SEED_OUTPUT_LIMIT);
  });

  child.on("error", (error) => {
    const message = cleanTrialSeedOutput(error?.message || "Seed child process failed to start.");
    setTrialSeedDiagnostic({
      status: "failed",
      environment_id: environmentId,
      exit_code: null,
      code: error?.code || "CHALIN_ONE_FULL_TRIAL_SEED_SPAWN_FAILED",
      message,
    });
    console.error(`CHALIN ONE full-trial seed bootstrap error: ${message}`);
  });

  child.on("close", (code, signal) => {
    const exitCode = Number.isInteger(code) ? code : null;
    if (exitCode === 0) {
      const output = cleanTrialSeedOutput(stdout);
      setTrialSeedDiagnostic({
        status: "verified",
        environment_id: environmentId,
        exit_code: 0,
        signal: signal || null,
        message: "Synthetic CHALIN ONE full-trial data is seeded and invariant-verified.",
        output,
      });
      console.log("CHALIN ONE full-trial staging seed and verification completed.");
      return;
    }

    const output = cleanTrialSeedOutput(stderr || stdout);
    setTrialSeedDiagnostic({
      status: "failed",
      environment_id: environmentId,
      exit_code: exitCode,
      signal: signal || null,
      code: "CHALIN_ONE_FULL_TRIAL_SEED_CHILD_FAILED",
      message: output || `Seed child process exited with code ${exitCode}.`,
    });
    console.error(
      `CHALIN ONE full-trial staging seed failed without blocking API startup: ${
        output || `exit code ${exitCode}`
      }`
    );
  });

  return { started: true, environment_id: environmentId };
}

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

runChalinOneFullTrialSeedBootstrap();
runMasterMickeyMergeProfileVisibility();
installExportWorkbookSafety();

module.exports = {
  CHALIN_ONE_FULL_TRIAL_SEED_DIAGNOSTIC,
  CHALIN_ONE_STAGING_ENVIRONMENT_ID,
  INVALID_WORKSHEET_CHARACTERS,
  MAX_WORKSHEET_NAME_LENGTH,
  cleanTrialSeedOutput,
  createUniqueWorksheetName,
  installExportWorkbookSafety,
  runChalinOneFullTrialSeedBootstrap,
  runMasterMickeyMergeProfileVisibility,
  sanitizeWorksheetName,
};
