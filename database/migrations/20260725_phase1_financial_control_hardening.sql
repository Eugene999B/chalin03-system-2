-- CHALIN 03 PHASE 1 FINANCIAL CONTROL HARDENING
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: create and validate a signed Version 2 full-system backup before production execution.
-- Purpose: preserve every expense row while allowing an authorised, independently approved void workflow
--          that creates a linked negative reversal for existing reports and Daily Closing calculations.
-- Never run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

SET @phase1_financial_already_applied = (
    SELECT COUNT(*)
    FROM schema_migrations
    WHERE migration_name = '20260725_phase1_financial_control_hardening'
);

DROP PROCEDURE IF EXISTS chalin03_phase1_add_column;
DROP PROCEDURE IF EXISTS chalin03_phase1_add_index;

DELIMITER $$

CREATE PROCEDURE chalin03_phase1_add_column(
    IN p_table_name VARCHAR(64),
    IN p_column_name VARCHAR(64),
    IN p_column_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND COLUMN_NAME = p_column_name
    ) THEN
        SET @phase1_financial_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD COLUMN ', p_column_definition
        );
        PREPARE phase1_financial_statement FROM @phase1_financial_sql;
        EXECUTE phase1_financial_statement;
        DEALLOCATE PREPARE phase1_financial_statement;
    END IF;
END$$

CREATE PROCEDURE chalin03_phase1_add_index(
    IN p_table_name VARCHAR(64),
    IN p_index_name VARCHAR(64),
    IN p_index_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND INDEX_NAME = p_index_name
    ) THEN
        SET @phase1_financial_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD ', p_index_definition
        );
        PREPARE phase1_financial_statement FROM @phase1_financial_sql;
        EXECUTE phase1_financial_statement;
        DEALLOCATE PREPARE phase1_financial_statement;
    END IF;
END$$

DELIMITER ;

CALL chalin03_phase1_add_column(
    'expenses',
    'is_voided',
    '`is_voided` TINYINT(1) NOT NULL DEFAULT 0 AFTER `recorded_by`'
);

CALL chalin03_phase1_add_column(
    'expenses',
    'void_reason',
    '`void_reason` VARCHAR(1000) NULL AFTER `is_voided`'
);

CALL chalin03_phase1_add_column(
    'expenses',
    'void_reference',
    '`void_reference` VARCHAR(100) NULL AFTER `void_reason`'
);

CALL chalin03_phase1_add_column(
    'expenses',
    'voided_by',
    '`voided_by` INT NULL AFTER `void_reference`'
);

CALL chalin03_phase1_add_column(
    'expenses',
    'voided_at',
    '`voided_at` DATETIME NULL AFTER `voided_by`'
);

CALL chalin03_phase1_add_column(
    'expenses',
    'void_approved_by',
    '`void_approved_by` INT NULL AFTER `voided_at`'
);

CALL chalin03_phase1_add_column(
    'expenses',
    'void_approved_at',
    '`void_approved_at` DATETIME NULL AFTER `void_approved_by`'
);

CALL chalin03_phase1_add_column(
    'expenses',
    'is_reversal',
    '`is_reversal` TINYINT(1) NOT NULL DEFAULT 0 AFTER `void_approved_at`'
);

CALL chalin03_phase1_add_column(
    'expenses',
    'reversal_of_expense_id',
    '`reversal_of_expense_id` INT NULL AFTER `is_reversal`'
);

CALL chalin03_phase1_add_column(
    'expenses',
    'reversal_reference',
    '`reversal_reference` VARCHAR(100) NULL AFTER `reversal_of_expense_id`'
);

CALL chalin03_phase1_add_index(
    'expenses',
    'idx_expense_void_status',
    'INDEX `idx_expense_void_status` (`branch_id`, `is_voided`, `is_reversal`, `expense_date`)'
);

CALL chalin03_phase1_add_index(
    'expenses',
    'uq_expense_void_reference',
    'UNIQUE INDEX `uq_expense_void_reference` (`void_reference`)'
);

CALL chalin03_phase1_add_index(
    'expenses',
    'idx_expense_void_approval',
    'INDEX `idx_expense_void_approval` (`void_approved_by`, `void_approved_at`)'
);

CALL chalin03_phase1_add_index(
    'expenses',
    'uq_expense_reversal_source',
    'UNIQUE INDEX `uq_expense_reversal_source` (`reversal_of_expense_id`)'
);

CALL chalin03_phase1_add_index(
    'expenses',
    'uq_expense_reversal_reference',
    'UNIQUE INDEX `uq_expense_reversal_reference` (`reversal_reference`)'
);

INSERT INTO schema_migrations (migration_name, description)
SELECT
    '20260725_phase1_financial_control_hardening',
    'Adds immutable expense void evidence, independent approval evidence and linked negative reversal rows so existing reports and Daily Closing net the voided expense to zero.'
WHERE @phase1_financial_already_applied = 0;

DROP PROCEDURE IF EXISTS chalin03_phase1_add_index;
DROP PROCEDURE IF EXISTS chalin03_phase1_add_column;
