-- CHALIN 03 EQUIPMENT INSTALLMENT FINANCE
-- OPENING DEPOSIT FOUNDATION STARTUP REPAIR
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: verified Professional Backup and separate verified SQL backup before production deployment.
-- Existing agreements, payments, deposits, balances, reservations, Hire records,
-- delivery records and ownership evidence are preserved.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

DELIMITER $$

DROP PROCEDURE IF EXISTS equipment_finance_opening_deposit_add_column_if_missing $$
DROP PROCEDURE IF EXISTS equipment_finance_opening_deposit_add_index_if_missing $$

CREATE PROCEDURE equipment_finance_opening_deposit_add_column_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_column_name VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = p_table_name
           AND COLUMN_NAME = p_column_name
    ) THEN
        SET @opening_deposit_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE opening_deposit_stmt FROM @opening_deposit_sql;
        EXECUTE opening_deposit_stmt;
        DEALLOCATE PREPARE opening_deposit_stmt;
    END IF;
END $$

CREATE PROCEDURE equipment_finance_opening_deposit_add_index_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_index_name VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = p_table_name
           AND INDEX_NAME = p_index_name
    ) THEN
        SET @opening_deposit_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD ', p_definition
        );
        PREPARE opening_deposit_stmt FROM @opening_deposit_sql;
        EXECUTE opening_deposit_stmt;
        DEALLOCATE PREPARE opening_deposit_stmt;
    END IF;
END $$

DELIMITER ;

CALL equipment_finance_opening_deposit_add_column_if_missing(
    'equipment_sale_agreements',
    'deposit_completed_at',
    'DATETIME NULL AFTER deposit_received'
);
CALL equipment_finance_opening_deposit_add_column_if_missing(
    'equipment_sale_agreements',
    'deposit_completed_by',
    'INT NULL AFTER deposit_completed_at'
);
CALL equipment_finance_opening_deposit_add_column_if_missing(
    'equipment_sale_agreements',
    'reservation_activated_at',
    'DATETIME NULL AFTER equipment_commitment_status'
);
CALL equipment_finance_opening_deposit_add_column_if_missing(
    'equipment_sale_agreements',
    'reservation_activated_by',
    'INT NULL AFTER reservation_activated_at'
);

CALL equipment_finance_opening_deposit_add_column_if_missing(
    'equipment_sale_payments',
    'idempotency_key',
    'VARCHAR(191) NULL AFTER receipt_number'
);
CALL equipment_finance_opening_deposit_add_column_if_missing(
    'equipment_sale_payments',
    'credit_application_id',
    'BIGINT NULL AFTER agreement_id'
);
CALL equipment_finance_opening_deposit_add_column_if_missing(
    'equipment_sale_payments',
    'payment_stage',
    "ENUM('legacy','opening_deposit','installment_collection','settlement','adjustment','refund') NOT NULL DEFAULT 'legacy' AFTER payment_category"
);
CALL equipment_finance_opening_deposit_add_column_if_missing(
    'equipment_sale_payments',
    'reservation_effect',
    "ENUM('none','reserved') NOT NULL DEFAULT 'none' AFTER payment_stage"
);

CALL equipment_finance_opening_deposit_add_index_if_missing(
    'equipment_sale_agreements',
    'idx_equipment_finance_deposit_reservation',
    'INDEX `idx_equipment_finance_deposit_reservation` (`activation_source`, `equipment_commitment_status`, `deposit_completed_at`, `hire_location_id`)'
);
CALL equipment_finance_opening_deposit_add_index_if_missing(
    'equipment_sale_payments',
    'uq_equipment_finance_payment_idempotency',
    'UNIQUE INDEX `uq_equipment_finance_payment_idempotency` (`idempotency_key`)'
);
CALL equipment_finance_opening_deposit_add_index_if_missing(
    'equipment_sale_payments',
    'idx_equipment_finance_payment_stage',
    'INDEX `idx_equipment_finance_payment_stage` (`agreement_id`, `payment_stage`, `is_voided`, `payment_date`)'
);
CALL equipment_finance_opening_deposit_add_index_if_missing(
    'equipment_sale_payments',
    'idx_equipment_finance_payment_application',
    'INDEX `idx_equipment_finance_payment_application` (`credit_application_id`, `payment_stage`, `payment_date`)'
);

DROP PROCEDURE IF EXISTS equipment_finance_opening_deposit_add_column_if_missing;
DROP PROCEDURE IF EXISTS equipment_finance_opening_deposit_add_index_if_missing;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260805_equipment_finance_opening_deposit_foundation_repair',
    'Idempotently restore the evidence fields and indexes required by the Equipment Finance Opening Deposits page before the final Phase Four integrity gate runs.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
