-- CHALIN 03 SPARE PARTS SALES HOTFIX
-- ADDITIVE / IDEMPOTENT MIGRATION
--
-- IMPORTANT:
-- Run this against the database already selected by the connection.
-- Local database: select chalin03_db first.
-- Railway production: connect using MYSQLDATABASE so the live database is selected.
--
-- This script does not create, drop, rename, or switch databases.

SELECT DATABASE() AS hotfix_target_database;

DELIMITER $$

DROP PROCEDURE IF EXISTS chalin03_require_selected_database $$
CREATE PROCEDURE chalin03_require_selected_database()
BEGIN
  IF DATABASE() IS NULL OR DATABASE() = '' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'No database is selected. Select the Chalin 03 database before running this migration.';
  END IF;
END $$

CALL chalin03_require_selected_database() $$
DROP PROCEDURE IF EXISTS chalin03_require_selected_database $$

DROP PROCEDURE IF EXISTS chalin03_add_column_if_missing $$
CREATE PROCEDURE chalin03_add_column_if_missing(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  ) THEN
    SET @sql_text = CONCAT(
      'ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition
    );
    PREPARE stmt FROM @sql_text;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END $$

DROP PROCEDURE IF EXISTS chalin03_add_index_if_missing $$
CREATE PROCEDURE chalin03_add_index_if_missing(
  IN p_table VARCHAR(64),
  IN p_index VARCHAR(64),
  IN p_columns TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND INDEX_NAME = p_index
  ) THEN
    SET @sql_text = CONCAT(
      'ALTER TABLE `', p_table, '` ADD INDEX `', p_index, '` (', p_columns, ')'
    );
    PREPARE stmt FROM @sql_text;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END $$

DROP PROCEDURE IF EXISTS chalin03_add_editor_fk_if_missing $$
CREATE PROCEDURE chalin03_add_editor_fk_if_missing()
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sales'
      AND COLUMN_NAME = 'edited_by'
      AND REFERENCED_TABLE_NAME = 'users'
      AND REFERENCED_COLUMN_NAME = 'id'
  ) THEN
    ALTER TABLE sales
      ADD CONSTRAINT fk_sales_edited_by
      FOREIGN KEY (edited_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$

CALL chalin03_add_column_if_missing(
  'sales',
  'amount_tendered',
  'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER `payment_type`'
) $$

CALL chalin03_add_column_if_missing(
  'sales',
  'change_due',
  'DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER `amount_paid`'
) $$

CALL chalin03_add_column_if_missing(
  'sales',
  'edited_by',
  'INT NULL AFTER `voided_at`'
) $$

CALL chalin03_add_column_if_missing(
  'sales',
  'edited_at',
  'DATETIME NULL AFTER `edited_by`'
) $$

CALL chalin03_add_column_if_missing(
  'sales',
  'edit_reason',
  'TEXT NULL AFTER `edited_at`'
) $$

CALL chalin03_add_index_if_missing(
  'sales',
  'idx_sale_change_due',
  '`change_due`'
) $$

CALL chalin03_add_index_if_missing(
  'sales',
  'idx_sale_edited_by',
  '`edited_by`'
) $$

CALL chalin03_add_editor_fk_if_missing() $$

DROP PROCEDURE IF EXISTS chalin03_add_column_if_missing $$
DROP PROCEDURE IF EXISTS chalin03_add_index_if_missing $$
DROP PROCEDURE IF EXISTS chalin03_add_editor_fk_if_missing $$

DELIMITER ;

-- Recover historical immediate-payment overpayments where the old system
-- stored the entire tendered amount in amount_paid.
UPDATE sales
SET
  amount_tendered = amount_paid,
  change_due = GREATEST(amount_paid - total, 0)
WHERE amount_tendered = 0.00
  AND change_due = 0.00
  AND payment_type IN ('cash', 'momo', 'bank');

UPDATE sales
SET
  amount_paid = LEAST(amount_paid, total),
  balance = GREATEST(total - LEAST(amount_paid, total), 0)
WHERE payment_type IN ('cash', 'momo', 'bank')
  AND amount_tendered >= 0.00;

-- Preserve the paid-now value for legacy credit and mixed sales.
UPDATE sales
SET amount_tendered = amount_paid
WHERE amount_tendered = 0.00
  AND change_due = 0.00
  AND payment_type IN ('credit', 'mixed')
  AND amount_paid > 0.00;

SELECT
  'SPARE PARTS SALES HOTFIX MIGRATION FINISHED' AS result,
  DATABASE() AS migrated_database;
