const { pool } = require("../config/db");

const DEFAULT_VALIDITY_MONTHS = 24;
const DEFAULT_PREFIX = "CH03";
const MIGRATION_NAME = "20260718_release3fd2_worker_identity_cards";
const WORKSPACE_SEGMENTS = Object.freeze({
  spare_parts: "SP",
  mining: "MN",
  equipment_hire: "EH",
});
const REQUIRED_TABLE_COLUMNS = Object.freeze({
  settings: [
    "id",
    "branch_id",
    "business_name",
    "business_address",
    "business_phone",
    "owner_phone",
    "worker_id_card_validity_months",
    "worker_employee_number_prefix",
  ],
  worker_identity_sequences: ["workspace_code", "last_number", "updated_at"],
  worker_profiles: ["id", "workspace_code", "employee_number"],
});

let schemaPromise = null;

function cleanText(value, maxLength = 80) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeEmployeePrefix(value) {
  const normalized = cleanText(value, 20)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 12);
  return normalized || DEFAULT_PREFIX;
}

function normalizeValidityMonths(value) {
  const months = Number(value);
  return Number.isInteger(months) && months >= 1 && months <= 120
    ? months
    : DEFAULT_VALIDITY_MONTHS;
}

function workspaceSegment(workspaceCode) {
  return WORKSPACE_SEGMENTS[String(workspaceCode || "").trim().toLowerCase()] || "GRP";
}

function dateOnly(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function calculateCardDates(issueValue = new Date(), validityMonths = DEFAULT_VALIDITY_MONTHS) {
  const issueDate = dateOnly(issueValue);
  const issue = new Date(`${issueDate}T00:00:00.000Z`);
  issue.setUTCMonth(issue.getUTCMonth() + normalizeValidityMonths(validityMonths));
  return {
    issueDate,
    expiryDate: issue.toISOString().slice(0, 10),
  };
}

function schemaError(missingTables, missingColumns) {
  const error = new Error(
    `Worker identity migration ${MIGRATION_NAME} is required before startup.`
  );
  error.code = "WORKER_IDENTITY_SCHEMA_NOT_READY";
  error.statusCode = 503;
  error.missingTables = missingTables;
  error.missingColumns = missingColumns;
  return error;
}

async function ensureWorkerIdentitySchema(connection = pool) {
  if (connection === pool && schemaPromise) return schemaPromise;

  const verify = async () => {
    const tableNames = Object.keys(REQUIRED_TABLE_COLUMNS);
    const [tableRows] = await connection.query(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_TYPE = 'BASE TABLE'
         AND TABLE_NAME IN (${tableNames.map(() => "?").join(", ")})`,
      tableNames
    );
    const existingTables = new Set(tableRows.map((row) => row.TABLE_NAME));
    const missingTables = tableNames.filter(
      (tableName) => !existingTables.has(tableName)
    );

    const [columnRows] = await connection.query(
      `SELECT TABLE_NAME, COLUMN_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN (${tableNames.map(() => "?").join(", ")})`,
      tableNames
    );
    const columnsByTable = new Map(
      tableNames.map((tableName) => [tableName, new Set()])
    );
    for (const row of columnRows) {
      columnsByTable.get(row.TABLE_NAME)?.add(row.COLUMN_NAME);
    }

    const missingColumns = [];
    for (const [tableName, columns] of Object.entries(REQUIRED_TABLE_COLUMNS)) {
      if (!existingTables.has(tableName)) continue;
      for (const columnName of columns) {
        if (!columnsByTable.get(tableName)?.has(columnName)) {
          missingColumns.push(`${tableName}.${columnName}`);
        }
      }
    }

    if (missingTables.length || missingColumns.length) {
      throw schemaError(missingTables, missingColumns);
    }

    return {
      ready: true,
      migration_name: MIGRATION_NAME,
      missing_tables: [],
      missing_columns: [],
    };
  };

  if (connection !== pool) return verify();
  schemaPromise = verify().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

async function loadWorkerIdentitySettings(connection = pool) {
  await ensureWorkerIdentitySchema(connection);
  const [rows] = await connection.query(
    `SELECT
       id,
       business_name,
       business_address,
       business_phone,
       owner_phone,
       worker_id_card_validity_months,
       worker_employee_number_prefix
     FROM settings
     ORDER BY CASE WHEN branch_id = 1 THEN 0 ELSE 1 END, id ASC
     LIMIT 1`
  );

  if (!rows.length) {
    const error = new Error(
      "Worker identity settings are missing. Configure at least one store before issuing worker cards."
    );
    error.code = "WORKER_IDENTITY_SETTINGS_MISSING";
    error.statusCode = 503;
    throw error;
  }

  const settings = rows[0];
  return {
    settingsId: settings.id,
    businessName: cleanText(settings.business_name, 150) || "Chalin 03 Company Limited",
    businessAddress: cleanText(settings.business_address, 255) || "Dunkwa Police Barrier, Ghana",
    businessPhone:
      cleanText(settings.business_phone, 80) ||
      cleanText(settings.owner_phone, 80) ||
      "0249469080",
    validityMonths: normalizeValidityMonths(settings.worker_id_card_validity_months),
    employeePrefix: normalizeEmployeePrefix(settings.worker_employee_number_prefix),
  };
}

function formatEmployeeNumber(prefix, workspaceCode, sequenceNumber) {
  return `${normalizeEmployeePrefix(prefix)}-${workspaceSegment(workspaceCode)}-${String(
    Math.max(1, Number(sequenceNumber || 1))
  ).padStart(4, "0")}`;
}

async function allocateWorkerIdentity(connection, workspaceCode, issueValue = new Date()) {
  const settings = await loadWorkerIdentitySettings(connection);
  const workspace = cleanText(workspaceCode, 50).toLowerCase() || "spare_parts";

  const [sequenceRows] = await connection.query(
    `SELECT last_number
     FROM worker_identity_sequences
     WHERE workspace_code = ?
     LIMIT 1
     FOR UPDATE`,
    [workspace]
  );

  if (!sequenceRows.length) {
    const error = new Error(
      `Worker identity sequence ${workspace} is missing. Apply the approved sequence seed before creating staff records.`
    );
    error.code = "WORKER_IDENTITY_SEQUENCE_MISSING";
    error.statusCode = 503;
    throw error;
  }

  let nextNumber = Number(sequenceRows[0]?.last_number || 0) + 1;
  let employeeNumber = "";
  let identityAllocated = false;

  for (let attempt = 0; attempt < 100000; attempt += 1) {
    const candidate = formatEmployeeNumber(
      settings.employeePrefix,
      workspace,
      nextNumber
    );
    const [existingRows] = await connection.query(
      `SELECT id
       FROM worker_profiles
       WHERE employee_number = ?
       LIMIT 1`,
      [candidate]
    );

    if (!existingRows.length) {
      employeeNumber = candidate;
      identityAllocated = true;
      break;
    }

    nextNumber += 1;
  }

  if (!identityAllocated) {
    const error = new Error(
      "A unique employee number could not be allocated safely."
    );
    error.code = "WORKER_ID_SEQUENCE_EXHAUSTED";
    throw error;
  }

  await connection.query(
    `UPDATE worker_identity_sequences
     SET last_number = ?
     WHERE workspace_code = ?`,
    [nextNumber, workspace]
  );
  const dates = calculateCardDates(issueValue, settings.validityMonths);

  return {
    employeeNumber,
    cardSerial: employeeNumber,
    issueDate: dates.issueDate,
    expiryDate: dates.expiryDate,
    validityMonths: settings.validityMonths,
    employeePrefix: settings.employeePrefix,
  };
}

async function cardDatesForReissue(issueValue = new Date()) {
  const settings = await loadWorkerIdentitySettings();
  return {
    ...calculateCardDates(issueValue, settings.validityMonths),
    validityMonths: settings.validityMonths,
  };
}

module.exports = {
  DEFAULT_PREFIX,
  DEFAULT_VALIDITY_MONTHS,
  MIGRATION_NAME,
  REQUIRED_TABLE_COLUMNS,
  allocateWorkerIdentity,
  calculateCardDates,
  cardDatesForReissue,
  ensureWorkerIdentitySchema,
  formatEmployeeNumber,
  loadWorkerIdentitySettings,
  normalizeEmployeePrefix,
  normalizeValidityMonths,
  workspaceSegment,
};
