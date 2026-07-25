-- CHALIN 03 POST-PHASE-1 AUDIT SIGN-OFF READINESS
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: download and validate a fresh signed full-system backup before production execution.
-- Adds the audit evidence columns that legacy route code previously attempted to create at request time.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

CREATE TABLE IF NOT EXISTS audit_signoffs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    period_type ENUM('all', 'today', 'week', 'month', 'year', 'custom') NOT NULL DEFAULT 'month',
    period_label VARCHAR(255) NOT NULL,
    period_start DATE NULL,
    period_end DATE NULL,
    audit_score INT NOT NULL DEFAULT 0,
    audit_status VARCHAR(50) NOT NULL DEFAULT 'Needs Review',
    prepared_by_name VARCHAR(150) NULL,
    reviewed_by_name VARCHAR(150) NULL,
    approved_by_name VARCHAR(150) NULL,
    review_date DATE NULL,
    period_status ENUM('draft', 'reviewed', 'approved', 'rejected') NOT NULL DEFAULT 'draft',
    sales_checked BOOLEAN NOT NULL DEFAULT FALSE,
    expenses_checked BOOLEAN NOT NULL DEFAULT FALSE,
    debts_checked BOOLEAN NOT NULL DEFAULT FALSE,
    stock_checked BOOLEAN NOT NULL DEFAULT FALSE,
    warnings_checked BOOLEAN NOT NULL DEFAULT FALSE,
    reports_checked BOOLEAN NOT NULL DEFAULT FALSE,
    purchases_checked BOOLEAN NOT NULL DEFAULT FALSE,
    returns_checked BOOLEAN NOT NULL DEFAULT FALSE,
    transfers_checked BOOLEAN NOT NULL DEFAULT FALSE,
    sms_checked BOOLEAN NOT NULL DEFAULT FALSE,
    stock_ledger_checked BOOLEAN NOT NULL DEFAULT FALSE,
    backup_checked BOOLEAN NOT NULL DEFAULT FALSE,
    maintenance_checked BOOLEAN NOT NULL DEFAULT FALSE,
    accountant_notes TEXT NULL,
    management_notes TEXT NULL,
    created_by INT NULL,
    approved_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_audit_signoff_branch (branch_id),
    INDEX idx_audit_signoff_period_type (period_type),
    INDEX idx_audit_signoff_period_dates (period_start, period_end),
    INDEX idx_audit_signoff_status (period_status),
    INDEX idx_audit_signoff_created_by (created_by),
    INDEX idx_audit_signoff_approved_by (approved_by),
    INDEX idx_audit_signoff_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS audit_reapproval_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    audit_signoff_id INT NULL,
    unlock_request_id INT NULL,
    period_label VARCHAR(255) NOT NULL,
    period_start DATE NULL,
    period_end DATE NULL,
    previous_status VARCHAR(50) NULL,
    new_status VARCHAR(50) NOT NULL DEFAULT 'approved',
    audit_score INT NOT NULL DEFAULT 0,
    audit_status VARCHAR(50) NULL,
    reapproved_by INT NULL,
    reapproved_by_name VARCHAR(150) NULL,
    reapproved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reapproval_notes TEXT NULL,
    accountant_notes TEXT NULL,
    management_notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_reapproval_branch (branch_id),
    INDEX idx_reapproval_signoff (audit_signoff_id),
    INDEX idx_reapproval_unlock_request (unlock_request_id),
    INDEX idx_reapproval_period_dates (period_start, period_end),
    INDEX idx_reapproval_user (reapproved_by),
    INDEX idx_reapproval_date (reapproved_at)
);

SET @post_phase1_audit_readiness_applied = (
    SELECT COUNT(*)
    FROM schema_migrations
    WHERE migration_name = '20260725_post_phase1_audit_signoff_readiness'
);

DROP PROCEDURE IF EXISTS chalin03_post_phase1_audit_add_column;
DROP PROCEDURE IF EXISTS chalin03_post_phase1_audit_add_index;

DELIMITER $$

CREATE PROCEDURE chalin03_post_phase1_audit_add_column(
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
        SET @post_phase1_audit_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD COLUMN ', p_column_definition
        );
        PREPARE post_phase1_audit_statement FROM @post_phase1_audit_sql;
        EXECUTE post_phase1_audit_statement;
        DEALLOCATE PREPARE post_phase1_audit_statement;
    END IF;
END$$

CREATE PROCEDURE chalin03_post_phase1_audit_add_index(
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
        SET @post_phase1_audit_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD ', p_index_definition
        );
        PREPARE post_phase1_audit_statement FROM @post_phase1_audit_sql;
        EXECUTE post_phase1_audit_statement;
        DEALLOCATE PREPARE post_phase1_audit_statement;
    END IF;
END$$

DELIMITER ;

CALL chalin03_post_phase1_audit_add_column(
    'audit_signoffs', 'branch_id',
    '`branch_id` INT NOT NULL DEFAULT 1 AFTER `id`'
);
CALL chalin03_post_phase1_audit_add_column(
    'audit_signoffs', 'purchases_checked',
    '`purchases_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `reports_checked`'
);
CALL chalin03_post_phase1_audit_add_column(
    'audit_signoffs', 'returns_checked',
    '`returns_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `purchases_checked`'
);
CALL chalin03_post_phase1_audit_add_column(
    'audit_signoffs', 'transfers_checked',
    '`transfers_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `returns_checked`'
);
CALL chalin03_post_phase1_audit_add_column(
    'audit_signoffs', 'sms_checked',
    '`sms_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `transfers_checked`'
);
CALL chalin03_post_phase1_audit_add_column(
    'audit_signoffs', 'stock_ledger_checked',
    '`stock_ledger_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `sms_checked`'
);
CALL chalin03_post_phase1_audit_add_column(
    'audit_signoffs', 'backup_checked',
    '`backup_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `stock_ledger_checked`'
);
CALL chalin03_post_phase1_audit_add_column(
    'audit_signoffs', 'maintenance_checked',
    '`maintenance_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `backup_checked`'
);
CALL chalin03_post_phase1_audit_add_column(
    'audit_reapproval_log', 'branch_id',
    '`branch_id` INT NOT NULL DEFAULT 1 AFTER `id`'
);

CALL chalin03_post_phase1_audit_add_index(
    'audit_signoffs', 'idx_audit_signoff_branch',
    'INDEX `idx_audit_signoff_branch` (`branch_id`)'
);
CALL chalin03_post_phase1_audit_add_index(
    'audit_reapproval_log', 'idx_reapproval_branch',
    'INDEX `idx_reapproval_branch` (`branch_id`)'
);

INSERT INTO schema_migrations (migration_name, description)
SELECT
    '20260725_post_phase1_audit_signoff_readiness',
    'Adds the seven extended Audit Sign-Off evidence checks and branch readiness indexes so production routes use read-only schema validation instead of request-time DDL.'
WHERE @post_phase1_audit_readiness_applied = 0;

DROP PROCEDURE IF EXISTS chalin03_post_phase1_audit_add_index;
DROP PROCEDURE IF EXISTS chalin03_post_phase1_audit_add_column;
