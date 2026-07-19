const { pool } = require("../config/db");

let schemaPromise = null;

const MIGRATION_NAME = "20260719_standalone_employment_documents_signature";
const MIGRATION_DESCRIPTION =
  "Adds standalone employment and HR documents, reusable authorised-signature settings and immutable signature snapshots for issued worker letters.";

const SAFE_TABLES = new Set(["worker_hr_letters"]);
const SAFE_COLUMNS = new Set([
  "approval_signature_data_url",
  "approval_signatory_name",
  "approval_signatory_title",
  "signature_captured_at",
]);

async function ensureColumn(tableName, columnName, definition) {
  if (!SAFE_TABLES.has(tableName) || !SAFE_COLUMNS.has(columnName)) {
    throw new Error("Unsafe employment-document schema identifier.");
  }

  const [rows] = await pool.query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );

  if (rows.length === 0) {
    await pool.query(
      `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`
    );
  }
}

async function ensureEmploymentDocumentSchema() {
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS document_signature_settings (
         id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
         signatory_name VARCHAR(150) NOT NULL,
         signatory_title VARCHAR(150) NOT NULL,
         signature_data_url MEDIUMTEXT NOT NULL,
         updated_by INT NULL,
         created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         CONSTRAINT fk_document_signature_updated_by
           FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
       )`
    );

    await pool.query(
      `CREATE TABLE IF NOT EXISTS standalone_hr_documents (
         id BIGINT AUTO_INCREMENT PRIMARY KEY,
         workspace_code VARCHAR(50) NOT NULL,
         linked_worker_id BIGINT NULL,
         linked_worker_letter_id BIGINT NULL,
         recipient_full_name VARCHAR(180) NOT NULL,
         recipient_preferred_name VARCHAR(120) NULL,
         recipient_phone VARCHAR(40) NULL,
         recipient_email VARCHAR(180) NULL,
         recipient_address TEXT NULL,
         letter_number VARCHAR(100) NULL,
         letter_type VARCHAR(50) NOT NULL,
         title VARCHAR(180) NOT NULL,
         subject VARCHAR(255) NULL,
         letter_date DATE NOT NULL,
         effective_date DATE NULL,
         response_due_date DATE NULL,
         status ENUM('draft', 'issued', 'acknowledged', 'cancelled') NOT NULL DEFAULT 'draft',
         payload_json JSON NOT NULL,
         signatory_name VARCHAR(150) NOT NULL,
         signatory_title VARCHAR(150) NOT NULL,
         approval_signature_data_url MEDIUMTEXT NULL,
         approval_signatory_name VARCHAR(150) NULL,
         approval_signatory_title VARCHAR(150) NULL,
         signature_captured_at DATETIME NULL,
         worker_acknowledgement_status ENUM('pending', 'accepted', 'received', 'declined', 'not_required') NOT NULL DEFAULT 'pending',
         worker_acknowledged_name VARCHAR(150) NULL,
         worker_acknowledged_at DATETIME NULL,
         worker_acknowledgement_note TEXT NULL,
         issued_by INT NULL,
         issued_at DATETIME NULL,
         cancelled_by INT NULL,
         cancelled_at DATETIME NULL,
         cancellation_reason VARCHAR(1000) NULL,
         created_by INT NULL,
         updated_by INT NULL,
         created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

         UNIQUE KEY uq_standalone_hr_document_number (letter_number),
         INDEX idx_standalone_hr_workspace (workspace_code, letter_date),
         INDEX idx_standalone_hr_recipient (recipient_full_name, letter_date),
         INDEX idx_standalone_hr_status (status, letter_date),
         INDEX idx_standalone_hr_linked_worker (linked_worker_id, letter_date),

         CONSTRAINT fk_standalone_hr_linked_worker
           FOREIGN KEY (linked_worker_id) REFERENCES worker_profiles(id) ON DELETE SET NULL,
         CONSTRAINT fk_standalone_hr_linked_letter
           FOREIGN KEY (linked_worker_letter_id) REFERENCES worker_hr_letters(id) ON DELETE SET NULL,
         CONSTRAINT fk_standalone_hr_issued_by
           FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE SET NULL,
         CONSTRAINT fk_standalone_hr_cancelled_by
           FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL,
         CONSTRAINT fk_standalone_hr_created_by
           FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
         CONSTRAINT fk_standalone_hr_updated_by
           FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
       )`
    );

    await ensureColumn(
      "worker_hr_letters",
      "approval_signature_data_url",
      "MEDIUMTEXT NULL AFTER signatory_title"
    );
    await ensureColumn(
      "worker_hr_letters",
      "approval_signatory_name",
      "VARCHAR(150) NULL AFTER approval_signature_data_url"
    );
    await ensureColumn(
      "worker_hr_letters",
      "approval_signatory_title",
      "VARCHAR(150) NULL AFTER approval_signatory_name"
    );
    await ensureColumn(
      "worker_hr_letters",
      "signature_captured_at",
      "DATETIME NULL AFTER approval_signatory_title"
    );

    try {
      await pool.query(
        `INSERT INTO schema_migrations (migration_name, description)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE description = VALUES(description)`,
        [MIGRATION_NAME, MIGRATION_DESCRIPTION]
      );
    } catch (error) {
      if (error.code !== "ER_NO_SUCH_TABLE") throw error;
    }

    console.log("Standalone employment documents and signature schema is ready.");
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

module.exports = {
  ensureEmploymentDocumentSchema,
  MIGRATION_NAME,
};
