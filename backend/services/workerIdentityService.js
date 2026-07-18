const { pool } = require("../config/db");

const DEFAULT_VALIDITY_MONTHS = 24;
const DEFAULT_PREFIX = "CH03";
const WORKSPACE_SEGMENTS = Object.freeze({
  spare_parts: "SP",
  mining: "MN",
  equipment_hire: "EH",
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

async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function ensureWorkerIdentitySchema() {
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    if (!(await columnExists("settings", "worker_id_card_validity_months"))) {
      await pool.query(
        `ALTER TABLE settings
         ADD COLUMN worker_id_card_validity_months INT NOT NULL DEFAULT 24`
      );
    }

    if (!(await columnExists("settings", "worker_employee_number_prefix"))) {
      await pool.query(
        `ALTER TABLE settings
         ADD COLUMN worker_employee_number_prefix VARCHAR(20) NOT NULL DEFAULT 'CH03'`
      );
    }

    await pool.query(
      `CREATE TABLE IF NOT EXISTS worker_identity_sequences (
         workspace_code VARCHAR(50) NOT NULL PRIMARY KEY,
         last_number INT NOT NULL DEFAULT 0,
         updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
       )`
    );

    try {
      await pool.query(
        `INSERT IGNORE INTO schema_migrations (migration_name, description)
         VALUES (
           '20260718_release3fd2_worker_identity_cards',
           'Automatic employee numbers, settings-driven card validity and premium worker ID cards.'
         )`
      );
    } catch (error) {
      if (error.code !== "ER_NO_SUCH_TABLE") throw error;
    }
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

async function loadWorkerIdentitySettings(connection = pool) {
  await ensureWorkerIdentitySchema();
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

  const settings = rows[0] || {};
  return {
    settingsId: settings.id || null,
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

  await connection.query(
    `INSERT INTO worker_identity_sequences (workspace_code, last_number)
     VALUES (?, 0)
     ON DUPLICATE KEY UPDATE workspace_code = VALUES(workspace_code)`,
    [workspace]
  );

  const [sequenceRows] = await connection.query(
    `SELECT last_number
     FROM worker_identity_sequences
     WHERE workspace_code = ?
     LIMIT 1
     FOR UPDATE`,
    [workspace]
  );

  const nextNumber = Number(sequenceRows[0]?.last_number || 0) + 1;
  await connection.query(
    `UPDATE worker_identity_sequences
     SET last_number = ?
     WHERE workspace_code = ?`,
    [nextNumber, workspace]
  );

  const employeeNumber = formatEmployeeNumber(
    settings.employeePrefix,
    workspace,
    nextNumber
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
