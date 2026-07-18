-- CHALIN 03 RELEASE 3F-D2
-- Premium worker identity cards, automatic employee numbering and settings-driven validity.
-- ADDITIVE / IDEMPOTENT ONLY. Existing worker records are preserved.

SET @validity_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'settings'
    AND COLUMN_NAME = 'worker_id_card_validity_months'
);
SET @validity_sql = IF(
  @validity_column_exists = 0,
  'ALTER TABLE settings ADD COLUMN worker_id_card_validity_months INT NOT NULL DEFAULT 24',
  'SELECT 1'
);
PREPARE validity_statement FROM @validity_sql;
EXECUTE validity_statement;
DEALLOCATE PREPARE validity_statement;

SET @prefix_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'settings'
    AND COLUMN_NAME = 'worker_employee_number_prefix'
);
SET @prefix_sql = IF(
  @prefix_column_exists = 0,
  'ALTER TABLE settings ADD COLUMN worker_employee_number_prefix VARCHAR(20) NOT NULL DEFAULT ''CH03''',
  'SELECT 1'
);
PREPARE prefix_statement FROM @prefix_sql;
EXECUTE prefix_statement;
DEALLOCATE PREPARE prefix_statement;

CREATE TABLE IF NOT EXISTS worker_identity_sequences (
  workspace_code VARCHAR(50) NOT NULL PRIMARY KEY,
  last_number INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

UPDATE settings
SET worker_id_card_validity_months = COALESCE(worker_id_card_validity_months, 24),
    worker_employee_number_prefix = COALESCE(NULLIF(worker_employee_number_prefix, ''), 'CH03');

INSERT IGNORE INTO schema_migrations (migration_name, description)
VALUES (
  '20260718_release3fd2_worker_identity_cards',
  'Automatic employee numbers, settings-driven card validity and premium worker ID cards.'
);
