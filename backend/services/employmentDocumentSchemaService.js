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
    "letter_number",
    "letter_type",
    "title",
    "letter_date",
    "status",
    "payload_json",
    "signatory_name",
    "signatory_title",
    "approval_signature_data_url",
    "approval_signatory_name",
    "approval_signatory_title",
    "signature_captured_at",
    "worker_acknowledgement_status",
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

async function verifyEmploymentDocumentSchema(connection = pool) {
  const tableNames = Object.keys(REQUIRED_TABLE_COLUMNS);
  const placeholders = tableNames.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    tableNames
  );

  const found = new Map(tableNames.map((tableName) => [tableName, new Set()]));
  for (const row of rows) {
    if (!found.has(row.TABLE_NAME)) found.set(row.TABLE_NAME, new Set());
    found.get(row.TABLE_NAME).add(row.COLUMN_NAME);
  }

  const missing = [];
  for (const [tableName, requiredColumns] of Object.entries(
    REQUIRED_TABLE_COLUMNS
  )) {
    const actual = found.get(tableName) || new Set();
    if (actual.size === 0) {
      missing.push(`${tableName}.*`);
      continue;
    }
    for (const columnName of requiredColumns) {
      if (!actual.has(columnName)) missing.push(`${tableName}.${columnName}`);
    }
  }

  if (missing.length > 0) {
    const error = new Error(
      `Employment document schema is not ready. Missing requirements: ${missing.join(
        ", "
      )}. Apply the approved migration before starting production.`
    );
    error.code = "EMPLOYMENT_DOCUMENT_SCHEMA_NOT_READY";
    error.missingColumns = missing;
    throw error;
  }

  return { ready: true, missing_columns: [] };
}

async function ensureEmploymentDocumentSchema() {
  if (!schemaPromise) {
    schemaPromise = verifyEmploymentDocumentSchema().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = {
  MIGRATION_NAME,
  REQUIRED_TABLE_COLUMNS,
  ensureEmploymentDocumentSchema,
  verifyEmploymentDocumentSchema,
};
