-- Chalin 03 additive production migration
-- Standalone employment/HR documents and authorised document signature.
-- No existing worker or business record is deleted or rewritten.

CREATE TABLE IF NOT EXISTS document_signature_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  signatory_name VARCHAR(150) NOT NULL,
  signatory_title VARCHAR(150) NOT NULL,
  signature_data_url MEDIUMTEXT NOT NULL,
  updated_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_document_signature_updated_by
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS standalone_hr_documents (
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
);

SET @has_approval_signature_data_url := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'worker_hr_letters'
    AND COLUMN_NAME = 'approval_signature_data_url'
);
SET @sql := IF(
  @has_approval_signature_data_url = 0,
  'ALTER TABLE worker_hr_letters ADD COLUMN approval_signature_data_url MEDIUMTEXT NULL AFTER signatory_title',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_approval_signatory_name := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'worker_hr_letters'
    AND COLUMN_NAME = 'approval_signatory_name'
);
SET @sql := IF(
  @has_approval_signatory_name = 0,
  'ALTER TABLE worker_hr_letters ADD COLUMN approval_signatory_name VARCHAR(150) NULL AFTER approval_signature_data_url',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_approval_signatory_title := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'worker_hr_letters'
    AND COLUMN_NAME = 'approval_signatory_title'
);
SET @sql := IF(
  @has_approval_signatory_title = 0,
  'ALTER TABLE worker_hr_letters ADD COLUMN approval_signatory_title VARCHAR(150) NULL AFTER approval_signatory_name',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_signature_captured_at := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'worker_hr_letters'
    AND COLUMN_NAME = 'signature_captured_at'
);
SET @sql := IF(
  @has_signature_captured_at = 0,
  'ALTER TABLE worker_hr_letters ADD COLUMN signature_captured_at DATETIME NULL AFTER approval_signatory_title',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
  '20260719_standalone_employment_documents_signature',
  'Adds standalone employment and HR documents, reusable authorised-signature settings and immutable signature snapshots for issued worker letters.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
