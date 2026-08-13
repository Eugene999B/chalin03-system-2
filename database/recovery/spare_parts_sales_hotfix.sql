-- CHALIN 03 STAGING BACKUP RECOVERY
-- Schema-only form of the historical Spare Parts sales hotfix.
-- The original migration also rewrote historical sale amounts; recovery must
-- never replay those business-data updates because the signed backup restores
-- the authoritative production rows after schema preparation.

DELIMITER $$
DROP PROCEDURE IF EXISTS chalin03_recovery_add_column_if_missing $$
CREATE PROCEDURE chalin03_recovery_add_column_if_missing(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  ) THEN
    SET @recovery_sql = CONCAT(
      'ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition
    );
    PREPARE recovery_stmt FROM @recovery_sql;
    EXECUTE recovery_stmt;
    DEALLOCATE PREPARE recovery_stmt;
  END IF;
END $$

DROP PROCEDURE IF EXISTS chalin03_recovery_add_index_if_missing $$
CREATE PROCEDURE chalin03_recovery_add_index_if_missing(
  IN p_table VARCHAR(64),
  IN p_index VARCHAR(64),
  IN p_columns TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND INDEX_NAME = p_index
  ) THEN
    SET @recovery_sql = CONCAT(
      'ALTER TABLE `', p_table, '` ADD INDEX `', p_index, '` (', p_columns, ')'
    );
    PREPARE recovery_stmt FROM @recovery_sql;
    EXECUTE recovery_stmt;
    DEALLOCATE PREPARE recovery_stmt;
  END IF;
END $$

DROP PROCEDURE IF EXISTS chalin03_recovery_add_editor_fk_if_missing $$
CREATE PROCEDURE chalin03_recovery_add_editor_fk_if_missing()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.KEY_COLUMN_USAGE
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

CALL chalin03_recovery_add_column_if_missing('sales','amount_tendered','DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER `payment_type`') $$
CALL chalin03_recovery_add_column_if_missing('sales','change_due','DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER `amount_paid`') $$
CALL chalin03_recovery_add_column_if_missing('sales','edited_by','INT NULL AFTER `voided_at`') $$
CALL chalin03_recovery_add_column_if_missing('sales','edited_at','DATETIME NULL AFTER `edited_by`') $$
CALL chalin03_recovery_add_column_if_missing('sales','edit_reason','TEXT NULL AFTER `edited_at`') $$
CALL chalin03_recovery_add_index_if_missing('sales','idx_sale_change_due','`change_due`') $$
CALL chalin03_recovery_add_index_if_missing('sales','idx_sale_edited_by','`edited_by`') $$
CALL chalin03_recovery_add_editor_fk_if_missing() $$

DROP PROCEDURE IF EXISTS chalin03_recovery_add_column_if_missing $$
DROP PROCEDURE IF EXISTS chalin03_recovery_add_index_if_missing $$
DROP PROCEDURE IF EXISTS chalin03_recovery_add_editor_fk_if_missing $$
DELIMITER ;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
  'spare_parts_sales_hotfix',
  'Staging recovery schema-only replay of the historical Spare Parts sales hotfix; business-data rewrites intentionally excluded.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
