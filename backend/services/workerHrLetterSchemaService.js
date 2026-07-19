const { pool } = require("../config/db");

let schemaPromise = null;

const MIGRATION_NAME = "20260719_worker_hr_letters";
const MIGRATION_DESCRIPTION =
  "Adds worker-linked employment and HR correspondence records with PDF generation, finalization status and acknowledgement evidence.";

async function ensureWorkerHrLetterSchema() {
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS worker_hr_letters (
         id BIGINT AUTO_INCREMENT PRIMARY KEY,
         worker_id BIGINT NOT NULL,
         workspace_code VARCHAR(50) NOT NULL,
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

         UNIQUE KEY uq_worker_hr_letter_number (letter_number),
         INDEX idx_worker_hr_letters_worker (worker_id, letter_date),
         INDEX idx_worker_hr_letters_workspace (workspace_code, letter_date),
         INDEX idx_worker_hr_letters_type (letter_type, letter_date),
         INDEX idx_worker_hr_letters_status (status, letter_date),
         INDEX idx_worker_hr_letters_response_due (response_due_date, status),

         CONSTRAINT fk_worker_hr_letters_worker
           FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE RESTRICT,
         CONSTRAINT fk_worker_hr_letters_issued_by
           FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE SET NULL,
         CONSTRAINT fk_worker_hr_letters_cancelled_by
           FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL,
         CONSTRAINT fk_worker_hr_letters_created_by
           FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
         CONSTRAINT fk_worker_hr_letters_updated_by
           FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
       )`
    );

    const [columnRows] = await pool.query(
      `SELECT COLUMN_TYPE
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'worker_hr_letters'
         AND COLUMN_NAME = 'worker_id'
       LIMIT 1`
    );

    const workerIdType = String(columnRows[0]?.COLUMN_TYPE || "").toLowerCase();
    if (!workerIdType.startsWith("bigint")) {
      throw new Error(
        "Worker HR schema verification failed: worker_hr_letters.worker_id must be BIGINT."
      );
    }

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

    console.log("Worker HR letters database schema is ready.");
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

module.exports = {
  ensureWorkerHrLetterSchema,
  MIGRATION_NAME,
};
