const { pool } = require("../config/db");

const AUDIT_SCHEMA_CONTRACT = Object.freeze({
  audit_signoffs: Object.freeze({
    columns: Object.freeze([
      "id",
      "branch_id",
      "period_type",
      "period_label",
      "period_start",
      "period_end",
      "audit_score",
      "audit_status",
      "prepared_by_name",
      "reviewed_by_name",
      "approved_by_name",
      "review_date",
      "period_status",
      "sales_checked",
      "expenses_checked",
      "debts_checked",
      "stock_checked",
      "warnings_checked",
      "reports_checked",
      "purchases_checked",
      "returns_checked",
      "transfers_checked",
      "sms_checked",
      "stock_ledger_checked",
      "backup_checked",
      "maintenance_checked",
      "accountant_notes",
      "management_notes",
      "created_by",
      "approved_by",
      "created_at",
      "updated_at",
    ]),
    indexes: Object.freeze([
      "PRIMARY",
      "idx_audit_signoff_branch",
      "idx_audit_signoff_period_type",
      "idx_audit_signoff_period_dates",
      "idx_audit_signoff_status",
      "idx_audit_signoff_created_by",
      "idx_audit_signoff_approved_by",
      "idx_audit_signoff_created_at",
    ]),
  }),
  audit_unlock_requests: Object.freeze({
    columns: Object.freeze([
      "id",
      "branch_id",
      "audit_signoff_id",
      "period_label",
      "period_start",
      "period_end",
      "request_area",
      "requested_action",
      "reason",
      "status",
      "requested_by",
      "reviewed_by",
      "reviewed_at",
      "review_notes",
      "created_at",
      "updated_at",
    ]),
    indexes: Object.freeze([
      "PRIMARY",
      "idx_unlock_request_branch",
      "idx_unlock_request_signoff",
      "idx_unlock_request_status",
      "idx_unlock_request_area",
      "idx_unlock_request_requested_by",
      "idx_unlock_request_reviewed_by",
      "idx_unlock_request_created_at",
    ]),
  }),
  audit_reapproval_log: Object.freeze({
    columns: Object.freeze([
      "id",
      "branch_id",
      "audit_signoff_id",
      "unlock_request_id",
      "period_label",
      "period_start",
      "period_end",
      "previous_status",
      "new_status",
      "audit_score",
      "audit_status",
      "reapproved_by",
      "reapproved_by_name",
      "reapproved_at",
      "reapproval_notes",
      "accountant_notes",
      "management_notes",
      "created_at",
    ]),
    indexes: Object.freeze([
      "PRIMARY",
      "idx_reapproval_branch",
      "idx_reapproval_signoff",
      "idx_reapproval_unlock_request",
      "idx_reapproval_period_dates",
      "idx_reapproval_user",
      "idx_reapproval_date",
    ]),
  }),
});

const REQUIRED_REQUEST_AREAS = Object.freeze([
  "sale",
  "expense",
  "debt_payment",
  "stock",
  "stock_adjustment",
  "stock_transfer",
  "stock_ledger",
  "purchase",
  "return",
  "sms",
  "backup_restore",
  "maintenance",
  "audit_signoff",
  "audit_reapproval",
  "report",
  "export",
  "other",
]);

let readyStatus = null;
let readinessPromise = null;

class AuditSchemaReadinessError extends Error {
  constructor({
    missingTables = [],
    missingColumns = [],
    missingIndexes = [],
    missingRequestAreas = [],
  } = {}) {
    super("The audit-control schema is not ready for application traffic.");
    this.name = "AuditSchemaReadinessError";
    this.code = "AUDIT_SCHEMA_NOT_READY";
    this.statusCode = 503;
    this.missingTables = [...missingTables];
    this.missingColumns = [...missingColumns];
    this.missingIndexes = [...missingIndexes];
    this.missingRequestAreas = [...missingRequestAreas];
  }
}

function enumValues(columnType) {
  return new Set(
    [...String(columnType || "").matchAll(/'((?:''|[^'])*)'/g)].map((match) =>
      match[1].replaceAll("''", "'")
    )
  );
}

async function inspectAuditSchema(connection = pool) {
  const tableNames = Object.keys(AUDIT_SCHEMA_CONTRACT);
  const placeholders = tableNames.map(() => "?").join(", ");

  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
       AND TABLE_NAME IN (${placeholders})`,
    tableNames
  );
  const presentTables = new Set(tableRows.map((row) => row.TABLE_NAME));
  const missingTables = tableNames.filter((tableName) => !presentTables.has(tableName));

  const [columnRows] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    tableNames
  );
  const columnsByTable = new Map();
  for (const row of columnRows) {
    if (!columnsByTable.has(row.TABLE_NAME)) columnsByTable.set(row.TABLE_NAME, new Map());
    columnsByTable.get(row.TABLE_NAME).set(row.COLUMN_NAME, row);
  }

  const missingColumns = [];
  for (const [tableName, contract] of Object.entries(AUDIT_SCHEMA_CONTRACT)) {
    const presentColumns = columnsByTable.get(tableName) || new Map();
    for (const columnName of contract.columns) {
      if (!presentColumns.has(columnName)) {
        missingColumns.push(`${tableName}.${columnName}`);
      }
    }
  }

  const [indexRows] = await connection.query(
    `SELECT TABLE_NAME, INDEX_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    tableNames
  );
  const indexesByTable = new Map();
  for (const row of indexRows) {
    if (!indexesByTable.has(row.TABLE_NAME)) indexesByTable.set(row.TABLE_NAME, new Set());
    indexesByTable.get(row.TABLE_NAME).add(row.INDEX_NAME);
  }

  const missingIndexes = [];
  for (const [tableName, contract] of Object.entries(AUDIT_SCHEMA_CONTRACT)) {
    const presentIndexes = indexesByTable.get(tableName) || new Set();
    for (const indexName of contract.indexes) {
      if (!presentIndexes.has(indexName)) {
        missingIndexes.push(`${tableName}.${indexName}`);
      }
    }
  }

  const requestAreaColumn = columnsByTable
    .get("audit_unlock_requests")
    ?.get("request_area");
  const presentRequestAreas = enumValues(requestAreaColumn?.COLUMN_TYPE);
  const missingRequestAreas = REQUIRED_REQUEST_AREAS.filter(
    (value) => !presentRequestAreas.has(value)
  );

  return {
    ready:
      missingTables.length === 0 &&
      missingColumns.length === 0 &&
      missingIndexes.length === 0 &&
      missingRequestAreas.length === 0,
    missing_tables: missingTables,
    missing_columns: missingColumns,
    missing_indexes: missingIndexes,
    missing_request_areas: missingRequestAreas,
  };
}

async function assertAuditSchemaReady(connection = pool) {
  if (readyStatus) return readyStatus;
  if (!readinessPromise) {
    readinessPromise = inspectAuditSchema(connection)
      .then((status) => {
        if (!status.ready) {
          throw new AuditSchemaReadinessError({
            missingTables: status.missing_tables,
            missingColumns: status.missing_columns,
            missingIndexes: status.missing_indexes,
            missingRequestAreas: status.missing_request_areas,
          });
        }
        readyStatus = status;
        return status;
      })
      .finally(() => {
        readinessPromise = null;
      });
  }
  return readinessPromise;
}

function clearAuditSchemaReadinessCache() {
  readyStatus = null;
  readinessPromise = null;
}

function sendAuditSchemaReadinessError(res, error) {
  if (error?.code !== "AUDIT_SCHEMA_NOT_READY") return false;
  res.status(503).json({
    status: "error",
    code: error.code,
    message:
      "Audit controls are temporarily unavailable because the approved audit schema is incomplete. Apply the registered Release 3.1 audit-schema migration before retrying.",
    missing_tables: error.missingTables || [],
    missing_columns: error.missingColumns || [],
    missing_indexes: error.missingIndexes || [],
    missing_request_areas: error.missingRequestAreas || [],
  });
  return true;
}

module.exports = {
  AUDIT_SCHEMA_CONTRACT,
  REQUIRED_REQUEST_AREAS,
  AuditSchemaReadinessError,
  inspectAuditSchema,
  assertAuditSchemaReady,
  clearAuditSchemaReadinessCache,
  sendAuditSchemaReadinessError,
};
