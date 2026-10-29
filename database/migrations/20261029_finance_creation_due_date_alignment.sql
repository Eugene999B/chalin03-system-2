-- CHALIN03 FINANCE CREATION DUE DATE ALIGNMENT — 2026-10-29
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: verify the fresh Railway MySQL consistent snapshot, its SHA-256
-- and manifest, plus the independent recovery copy before applying.
-- Never delete, reset, rewrite, or renumber existing customer, machine, agreement,
-- payment or credit application records.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  migration_name VARCHAR(150) NOT NULL UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  description TEXT NULL,
  INDEX idx_schema_migration_name (migration_name)
);

-- Build one controlled, additive statement. This preserves idempotency
-- without helper procedures or any DROP operation across migration boundaries.
SET @chalin03_due_date_schema_sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'equipment_credit_applications'
        AND COLUMN_NAME = 'proposed_first_due_date'
    ),
    'SELECT 1',
    'ALTER TABLE equipment_credit_applications ADD COLUMN proposed_first_due_date DATE NULL AFTER proposed_non_working_day_rule'
  )
);

PREPARE chalin03_due_date_addition FROM @chalin03_due_date_schema_sql;
EXECUTE chalin03_due_date_addition;
DEALLOCATE PREPARE chalin03_due_date_addition;

-- No trigger replacement: new code explicitly records the first due date.
-- Existing quotations and applications are unchanged.

INSERT INTO schema_migrations (migration_name, description)
VALUES (
  '20261029_finance_creation_due_date_alignment',
  'Add the first due date required by the application creation guard; preserve existing records and amounts.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
