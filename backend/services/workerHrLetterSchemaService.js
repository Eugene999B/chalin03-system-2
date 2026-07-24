const { pool } = require("../config/db");

const MIGRATION_NAME = "20260719_worker_hr_letters";
const REQUIRED_COLUMNS = Object.freeze([
  "id",
  "worker_id",
  "workspace_code",
  "letter_number",
  "letter_type",
  "title",
  "subject",
  "letter_date",
  "effective_date",
  "response_due_date",
  "status",
  "payload_json",
  "signatory_name",
  "signatory_title",
  "worker_acknowledgement_status",
  "worker_acknowledged_name",
  "worker_acknowledged_at",
  "worker_acknowledgement_note",
  "issued_by",
  "issued_at",
  "cancelled_by",
  "cancelled_at",
  "cancellation_reason",
  "created_by",
  "updated_by",
  "created_at",
  "updated_at",
]);

let schemaPromise = null;

function schemaError(message, metadata = {}) {
  const error = new Error(message);
  error.code = "WORKER_HR_SCHEMA_NOT_READY";
  error.statusCode = 503;
  Object.assign(error, metadata);
  return error;
}

async function ensureWorkerHrLetterSchema(connection = pool) {
  if (connection === pool && schemaPromise) return schemaPromise;

  const verify = async () => {
    const [tableRows] = await connection.query(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_TYPE = 'BASE TABLE'
         AND TABLE_NAME IN ('users', 'worker_profiles', 'worker_hr_letters')`
    );
    const existingTables = new Set(tableRows.map((row) => row.TABLE_NAME));
    const missingTables = ["users", "worker_profiles", "worker_hr_letters"].filter(
      (tableName) => !existingTables.has(tableName)
    );

    const [columnRows] = existingTables.has("worker_hr_letters")
      ? await connection.query(
          `SELECT COLUMN_NAME, COLUMN_TYPE
           FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = 'worker_hr_letters'`
        )
      : [[]];
    const columnTypes = new Map(
      columnRows.map((row) => [row.COLUMN_NAME, String(row.COLUMN_TYPE || "")])
    );
    const missingColumns = REQUIRED_COLUMNS.filter(
      (columnName) => !columnTypes.has(columnName)
    );
    const invalidColumns = [];
    if (
      columnTypes.has("worker_id") &&
      !columnTypes.get("worker_id").toLowerCase().startsWith("bigint")
    ) {
      invalidColumns.push("worker_hr_letters.worker_id must be BIGINT");
    }

    if (missingTables.length || missingColumns.length || invalidColumns.length) {
      throw schemaError(
        `Worker HR migration ${MIGRATION_NAME} is required before startup.`,
        {
          missingTables,
          missingColumns: missingColumns.map(
            (columnName) => `worker_hr_letters.${columnName}`
          ),
          invalidColumns,
        }
      );
    }

    return {
      ready: true,
      migration_name: MIGRATION_NAME,
      missing_tables: [],
      missing_columns: [],
      invalid_columns: [],
    };
  };

  if (connection !== pool) return verify();
  schemaPromise = verify().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

module.exports = {
  ensureWorkerHrLetterSchema,
  MIGRATION_NAME,
  REQUIRED_COLUMNS,
};
