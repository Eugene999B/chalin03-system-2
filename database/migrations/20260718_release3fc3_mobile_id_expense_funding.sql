-- CHALIN 03 RELEASE 3F-C3
-- Mobile usability, professional worker ID card and explicit expense-funding evidence.
-- Existing expense rows keep their historical closing treatment so previously approved
-- Daily Closings do not silently change. New application code requires an explicit choice.
-- Production rule: apply this additive migration only. Never run database/schema.sql.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

SET @release3fc3_already_applied = (
    SELECT COUNT(*)
    FROM schema_migrations
    WHERE migration_name = 'release3fc3_mobile_id_expense_funding'
);

DROP PROCEDURE IF EXISTS chalin03_release3fc3_add_column;
DROP PROCEDURE IF EXISTS chalin03_release3fc3_add_index;

DELIMITER $$

CREATE PROCEDURE chalin03_release3fc3_add_column(
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
        SET @release3fc3_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD COLUMN ', p_column_definition
        );
        PREPARE release3fc3_statement FROM @release3fc3_sql;
        EXECUTE release3fc3_statement;
        DEALLOCATE PREPARE release3fc3_statement;
    END IF;
END$$

CREATE PROCEDURE chalin03_release3fc3_add_index(
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
        SET @release3fc3_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD ', p_index_definition
        );
        PREPARE release3fc3_statement FROM @release3fc3_sql;
        EXECUTE release3fc3_statement;
        DEALLOCATE PREPARE release3fc3_statement;
    END IF;
END$$

DELIMITER ;

CALL chalin03_release3fc3_add_column(
    'expenses',
    'funding_source',
    '`funding_source` ENUM(''today_sales_receipts'',''petty_cash'',''prior_business_funds'',''owner_manager_funds'',''bank_account'',''momo_wallet'',''unpaid_credit'',''other'') NOT NULL DEFAULT ''today_sales_receipts'' AFTER `payment_method`' 
);

CALL chalin03_release3fc3_add_column(
    'expenses',
    'affects_daily_closing',
    '`affects_daily_closing` TINYINT(1) NOT NULL DEFAULT 1 AFTER `funding_source`'
);

CALL chalin03_release3fc3_add_column(
    'expenses',
    'closing_treatment_note',
    '`closing_treatment_note` VARCHAR(500) NULL AFTER `affects_daily_closing`'
);

CALL chalin03_release3fc3_add_index(
    'expenses',
    'idx_expense_closing_treatment',
    'INDEX `idx_expense_closing_treatment` (`branch_id`, `expense_date`, `affects_daily_closing`, `payment_method`)'
);

CALL chalin03_release3fc3_add_index(
    'expenses',
    'idx_expense_funding_source',
    'INDEX `idx_expense_funding_source` (`funding_source`, `expense_date`)'
);

INSERT INTO schema_migrations (migration_name, description)
SELECT
    'release3fc3_mobile_id_expense_funding',
    'Adds explicit expense funding source and Daily Closing treatment evidence while preserving historical expense deductions; also accompanies mobile and worker ID-card UX improvements.'
WHERE @release3fc3_already_applied = 0;

DROP PROCEDURE IF EXISTS chalin03_release3fc3_add_index;
DROP PROCEDURE IF EXISTS chalin03_release3fc3_add_column;
