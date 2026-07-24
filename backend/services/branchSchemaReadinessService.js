const { pool } = require("../config/db");

const REQUIRED_BRANCH_COLUMNS = Object.freeze([
  "id",
  "code",
  "branch_code",
  "name",
  "location",
  "phone",
  "is_active",
  "created_at",
  "updated_at",
]);

class BranchSchemaReadinessError extends Error {
  constructor({ tableMissing = false, missingColumns = [] } = {}) {
    super("The branch/store schema is not ready for application traffic.");
    this.name = "BranchSchemaReadinessError";
    this.code = "BRANCH_SCHEMA_NOT_READY";
    this.statusCode = 503;
    this.tableMissing = Boolean(tableMissing);
    this.missingColumns = [...missingColumns];
  }
}

async function inspectBranchSchema(connection = pool) {
  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'branches'
     LIMIT 1`
  );

  if (tableRows.length === 0) {
    return {
      ready: false,
      table_missing: true,
      missing_columns: [...REQUIRED_BRANCH_COLUMNS],
    };
  }

  const [columnRows] = await connection.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'branches'`
  );
  const present = new Set(columnRows.map((row) => row.COLUMN_NAME));
  const missingColumns = REQUIRED_BRANCH_COLUMNS.filter(
    (columnName) => !present.has(columnName)
  );

  return {
    ready: missingColumns.length === 0,
    table_missing: false,
    missing_columns: missingColumns,
  };
}

async function assertBranchSchemaReady(connection = pool) {
  const status = await inspectBranchSchema(connection);

  if (!status.ready) {
    throw new BranchSchemaReadinessError({
      tableMissing: status.table_missing,
      missingColumns: status.missing_columns,
    });
  }

  return status;
}

module.exports = {
  REQUIRED_BRANCH_COLUMNS,
  BranchSchemaReadinessError,
  inspectBranchSchema,
  assertBranchSchemaReady,
};
