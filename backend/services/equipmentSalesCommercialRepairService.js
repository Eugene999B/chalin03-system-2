const { pool } = require("../config/db");

const COMMERCIAL_REPAIR_MIGRATION_NAME =
  "20260723_equipment_sales_commercial_column_repair_v1";

const TABLES = Object.freeze({
  equipment_sales_enquiries: {
    columns: [
      "id",
      "enquiry_number",
      "hire_location_id",
      "customer_id",
      "enquiry_date",
      "status",
    ],
  },
  equipment_sales_quotations: {
    columns: [
      "id",
      "quotation_number",
      "hire_location_id",
      "enquiry_id",
      "customer_id",
      "status",
      "total_amount",
    ],
  },
  equipment_sales_quotation_items: {
    columns: [
      "id",
      "quotation_id",
      "hire_location_id",
      "asset_id",
      "line_total",
    ],
  },
  equipment_sale_agreements: {
    columns: [
      "id",
      "agreement_number",
      "hire_location_id",
      "quotation_item_id",
      "customer_id",
      "asset_id",
      "agreement_status",
      "approval_status",
      "total_amount",
      "outstanding_balance",
      "overdue_amount",
      "delivery_status",
      "ownership_status",
    ],
  },
  equipment_asset_sale_locks: {
    columns: ["asset_id", "agreement_id", "hire_location_id", "lock_status"],
  },
  equipment_installment_schedule: {
    columns: [
      "id",
      "agreement_id",
      "sequence_number",
      "due_date",
      "scheduled_amount",
      "schedule_status",
    ],
  },
  equipment_sale_payments: {
    columns: [
      "id",
      "payment_number",
      "receipt_number",
      "hire_location_id",
      "agreement_id",
      "amount",
      "is_voided",
    ],
  },
  equipment_sale_payment_allocations: {
    columns: ["id", "payment_id", "schedule_id", "allocated_amount"],
  },
  equipment_deliveries: {
    columns: ["id", "delivery_number", "agreement_id", "asset_id", "status"],
  },
  equipment_ownership_transfers: {
    columns: ["id", "transfer_number", "agreement_id", "asset_id", "status"],
  },
  equipment_sales_reminder_log: {
    columns: ["id", "agreement_id", "reminder_key", "delivery_status"],
  },
  equipment_legacy_installment_migrations: {
    columns: [
      "id",
      "legacy_agreement_id",
      "equipment_agreement_id",
      "source_snapshot_json",
      "reconciliation_status",
    ],
  },
});

const OPTIONAL_SUPPORT_TABLES = Object.freeze(["sms_log", "hire_contract_assets"]);

function readinessError(status) {
  const error = new Error(
    "Equipment Sales commercial records are not ready. Apply the approved controlled migrations before using Equipment Sales."
  );
  error.code = "EQUIPMENT_SALES_COMMERCIAL_SCHEMA_INCOMPLETE";
  error.statusCode = 503;
  error.missingTables = status.missing_tables;
  error.missingColumns = status.missing_columns;
  return error;
}

async function loadContractState(connection, tableNames) {
  const placeholders = tableNames.map(() => "?").join(", ");
  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_TYPE = 'BASE TABLE'
       AND TABLE_NAME IN (${placeholders})`,
    tableNames
  );
  const [columnRows] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    tableNames
  );

  const existingTables = new Set(tableRows.map((row) => row.TABLE_NAME));
  const columnsByTable = new Map(tableNames.map((name) => [name, new Set()]));
  for (const row of columnRows) {
    columnsByTable.get(row.TABLE_NAME)?.add(row.COLUMN_NAME);
  }
  return { existingTables, columnsByTable };
}

async function verifyCommercialSalesSchema(connection = pool) {
  const requiredTableNames = Object.keys(TABLES);
  const allTableNames = [...requiredTableNames, ...OPTIONAL_SUPPORT_TABLES];
  const { existingTables, columnsByTable } = await loadContractState(
    connection,
    allTableNames
  );

  const missingTables = requiredTableNames.filter(
    (tableName) => !existingTables.has(tableName)
  );
  const missingColumns = [];

  for (const [tableName, definition] of Object.entries(TABLES)) {
    if (!existingTables.has(tableName)) continue;
    const existingColumns = columnsByTable.get(tableName) || new Set();
    for (const columnName of definition.columns) {
      if (!existingColumns.has(columnName)) {
        missingColumns.push(`${tableName}.${columnName}`);
      }
    }
  }

  return {
    ready: missingTables.length === 0 && missingColumns.length === 0,
    missing_tables: missingTables,
    missing_columns: missingColumns,
    optional_support_missing: OPTIONAL_SUPPORT_TABLES.filter(
      (tableName) => !existingTables.has(tableName)
    ),
  };
}

async function ensureCommercialSalesSchema(connection = pool) {
  const status = await verifyCommercialSalesSchema(connection);
  if (!status.ready) throw readinessError(status);
  return {
    ...status,
    migration_name: COMMERCIAL_REPAIR_MIGRATION_NAME,
    applied: false,
    verification_only: true,
  };
}

function safeRepairError(error) {
  return {
    code: error?.code || "EQUIPMENT_SALES_COMMERCIAL_SCHEMA_INCOMPLETE",
    message:
      error?.message ||
      "Equipment Sales commercial records are not ready for normal use.",
    table_name: error?.tableName || null,
    missing_tables: error?.missingTables || [],
    missing_columns: error?.missingColumns || [],
  };
}

module.exports = {
  COMMERCIAL_REPAIR_MIGRATION_NAME,
  TABLES,
  ensureCommercialSalesSchema,
  safeRepairError,
  verifyCommercialSalesSchema,
};
