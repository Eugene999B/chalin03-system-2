const { pool } = require("../config/db");

const MIGRATION_NAME = "20260719_standalone_employment_documents_signature";
const REQUIRED_TABLE_COLUMNS = Object.freeze({
  document_signature_settings: [
    "id",
    "signatory_name",
    "signatory_title",
    "signature_data_url",
    "updated_by",
    "created_at",
    "updated_at",
  ],
  standalone_hr_documents: [
    "id",
    "workspace_code",
    "linked_worker_id",
    "linked_worker_letter_id",
    "recipient_full_name",
    "recipient_preferred_name",
    "recipient_phone",
    "recipient_email",
    "recipient_address",
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
    "approval_signature_data_url",
    "approval_signatory_name",
    "approval_signatory_title",
    "signature_captured_at",
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
  ],
  worker_hr_letters: [
    "approval_signature_data_url",
    "approval_signatory_name",
    "approval_signatory_title",
    "signature_captured_at",
  ],
});

let schemaPromise = null;

function schemaError(missingTables, missingColumns) {
  const error = new Error(
    `Employment-document migration ${MIGRATION_NAME} is required before startup.`
  );
  error.code = "EMPLOYMENT_DOCUMENT_SCHEMA_NOT_READY";
  error.statusCode = 503;
  error.missingTables = missingTables;
  error.missingColumns = missingColumns;
  return error;
}

async function ensureEmploymentDocumentSchema(connection = pool) {
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

module.exports = {
  ensureEmploymentDocumentSchema,
  MIGRATION_NAME,
  REQUIRED_TABLE_COLUMNS,
};
