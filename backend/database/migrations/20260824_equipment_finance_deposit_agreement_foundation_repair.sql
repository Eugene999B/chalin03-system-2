-- CHALIN 03 EQUIPMENT INSTALLMENT FINANCE
-- DEPOSIT AGREEMENT FOUNDATION REPAIR
-- Additive and idempotent: only restores fields required by the Finance
-- Deposit Reservation readiness contract. No existing business rows are rewritten.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

DELIMITER $$

DROP PROCEDURE IF EXISTS equipment_finance_deposit_agreement_add_column_if_missing $$

CREATE PROCEDURE equipment_finance_deposit_agreement_add_column_if_missing(
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
        SET @deposit_agreement_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE deposit_agreement_stmt FROM @deposit_agreement_sql;
        EXECUTE deposit_agreement_stmt;
        DEALLOCATE PREPARE deposit_agreement_stmt;
    END IF;
END $$

DELIMITER ;

CALL equipment_finance_deposit_agreement_add_column_if_missing(
    'equipment_sale_agreements',
    'credit_application_id',
    'BIGINT NULL AFTER agreement_number'
);
CALL equipment_finance_deposit_agreement_add_column_if_missing(
    'equipment_sale_agreements',
    'activation_source',
    "ENUM('legacy','approved_credit_application') NOT NULL DEFAULT 'legacy' AFTER credit_application_id"
);
CALL equipment_finance_deposit_agreement_add_column_if_missing(
    'equipment_sale_agreements',
    'equipment_commitment_status',
    "ENUM('not_reserved','reserved','locked','released') NOT NULL DEFAULT 'not_reserved' AFTER activation_source"
);

DROP PROCEDURE IF EXISTS equipment_finance_deposit_agreement_add_column_if_missing;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260824_equipment_finance_deposit_agreement_foundation_repair',
    'Restores the three agreement foundation fields required by the Equipment Finance Opening Deposit readiness contract.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
