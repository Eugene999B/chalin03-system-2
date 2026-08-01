-- CHALIN 03 EQUIPMENT INSTALLMENT FINANCE
-- PHASE 1: DATABASE SCHEMA FOUNDATION
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Create and verify a fresh Chalin 03 Professional Backup before production execution.
-- This migration changes schema shape only. It does not delete, rewrite or normalise business records.
-- Never run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

DELIMITER $$

DROP PROCEDURE IF EXISTS finance_phase1_make_location_nullable $$
CREATE PROCEDURE finance_phase1_make_location_nullable(IN p_table_name VARCHAR(64))
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
    ) AND EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND COLUMN_NAME = 'hire_location_id'
          AND IS_NULLABLE = 'NO'
    ) THEN
        SET @finance_phase1_nullable_sql = CONCAT(
            'ALTER ',
            'TABLE `', REPLACE(p_table_name, '`', '``'),
            '` MODIFY COLUMN `hire_location_id` INT NULL'
        );
        PREPARE finance_phase1_nullable_stmt FROM @finance_phase1_nullable_sql;
        EXECUTE finance_phase1_nullable_stmt;
        DEALLOCATE PREPARE finance_phase1_nullable_stmt;
    END IF;
END $$

DROP PROCEDURE IF EXISTS finance_phase1_add_column_if_missing $$
CREATE PROCEDURE finance_phase1_add_column_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_column_name VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND COLUMN_NAME = p_column_name
    ) THEN
        SET @finance_phase1_column_sql = CONCAT(
            'ALTER ',
            'TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE finance_phase1_column_stmt FROM @finance_phase1_column_sql;
        EXECUTE finance_phase1_column_stmt;
        DEALLOCATE PREPARE finance_phase1_column_stmt;
    END IF;
END $$

DELIMITER ;

-- Finance records must be capable of existing without an Equipment Hire location.
-- Existing values are preserved; data normalisation belongs to a later reviewed phase.
CALL finance_phase1_make_location_nullable('equipment_credit_applications');
CALL finance_phase1_make_location_nullable('equipment_sales_quotations');
CALL finance_phase1_make_location_nullable('equipment_sales_quotation_items');
CALL finance_phase1_make_location_nullable('equipment_sale_agreements');
CALL finance_phase1_make_location_nullable('equipment_asset_sale_locks');
CALL finance_phase1_make_location_nullable('equipment_sale_payments');
CALL finance_phase1_make_location_nullable('equipment_deliveries');
CALL finance_phase1_make_location_nullable('equipment_ownership_transfers');
CALL finance_phase1_make_location_nullable('equipment_sales_reminder_log');

-- Authoritative schedule-definition fields. Existing rows remain unchanged.
CALL finance_phase1_add_column_if_missing(
    'equipment_sales_quotations',
    'proposed_interval_days',
    'SMALLINT UNSIGNED NULL AFTER proposed_frequency'
);
CALL finance_phase1_add_column_if_missing(
    'equipment_sales_quotations',
    'proposed_non_working_day_rule',
    "ENUM('exact','next_weekday','previous_weekday') NOT NULL DEFAULT 'exact' AFTER proposed_interval_days"
);
CALL finance_phase1_add_column_if_missing(
    'equipment_credit_applications',
    'proposed_interval_days',
    'SMALLINT UNSIGNED NULL AFTER proposed_frequency'
);
CALL finance_phase1_add_column_if_missing(
    'equipment_credit_applications',
    'proposed_non_working_day_rule',
    "ENUM('exact','next_weekday','previous_weekday') NOT NULL DEFAULT 'exact' AFTER proposed_interval_days"
);
CALL finance_phase1_add_column_if_missing(
    'equipment_credit_applications',
    'proposed_periodic_amount',
    'DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER proposed_installment_amount'
);
CALL finance_phase1_add_column_if_missing(
    'equipment_sale_agreements',
    'payment_interval_days',
    'SMALLINT UNSIGNED NULL AFTER payment_frequency'
);
CALL finance_phase1_add_column_if_missing(
    'equipment_sale_agreements',
    'non_working_day_rule',
    "ENUM('exact','next_weekday','previous_weekday') NOT NULL DEFAULT 'exact' AFTER payment_interval_days"
);

DROP PROCEDURE IF EXISTS finance_phase1_add_column_if_missing;
DROP PROCEDURE IF EXISTS finance_phase1_make_location_nullable;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260801_equipment_finance_phase1_schema_foundation',
    'Additive Equipment Finance schema foundation: nullable legacy Hire location references and exact schedule-definition fields.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
