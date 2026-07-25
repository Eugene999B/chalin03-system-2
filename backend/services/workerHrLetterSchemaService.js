const { pool } = require("../config/db");

const MIGRATION_NAME = "20260719_worker_hr_letters";
const REQUIRED_COLUMNS = Object.freeze([
  "id",
  "worker_id",
  "workspace_code",
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
]);

let schemaPromise = null;

async function verifyWorkerHrLetterSchema(connection = pool) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'worker_hr_letters'`
  );
  const columns = new Map(
    rows.map((row) => [row.COLUMN_NAME, String(row.COLUMN_TYPE || "").toLowerCase()])
  );
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.has(column));

  if (missing.length > 0) {
    const error = new Error(
      `Worker HR schema is not ready. Missing columns: ${missing.join(", ")}. Apply the approved migration before starting production.`
    );
    error.code = "WORKER_HR_SCHEMA_NOT_READY";
    error.missingColumns = missing;
    throw error;
  }

  if (!String(columns.get("worker_id") || "").startsWith("bigint")) {
    const error = new Error(
      "Worker HR schema verification failed: worker_hr_letters.worker_id must be BIGINT."
    );
    error.code = "WORKER_HR_WORKER_ID_TYPE_INVALID";
    throw error;
  }

  return { ready: true, missing_columns: [] };
}

async function ensureWorkerHrLetterSchema() {
  if (!schemaPromise) {
    schemaPromise = verifyWorkerHrLetterSchema().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = {
  MIGRATION_NAME,
  REQUIRED_COLUMNS,
  ensureWorkerHrLetterSchema,
  verifyWorkerHrLetterSchema,
};
