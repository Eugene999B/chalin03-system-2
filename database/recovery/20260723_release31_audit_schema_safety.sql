-- CHALIN 03 RELEASE 3.1 AUDIT-SCHEMA SAFETY
-- ADDITIVE, CONTROLLED MIGRATION ONLY.
-- Historical controlled source restored for staging backup schema recovery.
-- Existing audit, unlock and reapproval rows are preserved.

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

CREATE TABLE IF NOT EXISTS audit_unlock_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    audit_signoff_id INT NULL,
    period_label VARCHAR(255) NOT NULL,
    period_start DATE NULL,
    period_end DATE NULL,
    request_area ENUM(
        'sale','expense','debt_payment','stock','stock_adjustment','stock_transfer',
        'stock_ledger','purchase','return','sms','backup_restore','maintenance',
        'audit_signoff','audit_reapproval','report','export','other'
    ) NOT NULL DEFAULT 'other',
    requested_action VARCHAR(150) NOT NULL DEFAULT 'Correction needed',
    reason TEXT NOT NULL,
    status ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
    requested_by INT NULL,
    reviewed_by INT NULL,
    reviewed_at TIMESTAMP NULL,
    review_notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_unlock_request_branch (branch_id),
    INDEX idx_unlock_request_signoff (audit_signoff_id),
    INDEX idx_unlock_request_status (status),
    INDEX idx_unlock_request_area (request_area),
    INDEX idx_unlock_request_requested_by (requested_by),
    INDEX idx_unlock_request_reviewed_by (reviewed_by),
    INDEX idx_unlock_request_created_at (created_at)
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

DROP PROCEDURE IF EXISTS chalin03_release31_audit_add_column;
DROP PROCEDURE IF EXISTS chalin03_release31_audit_add_index;
DROP PROCEDURE IF EXISTS chalin03_release31_audit_request_area_enum;

DELIMITER $$

CREATE PROCEDURE chalin03_release31_audit_add_column(
    IN p_table_name VARCHAR(64),
    IN p_column_name VARCHAR(64),
    IN p_column_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND COLUMN_NAME = p_column_name
    ) THEN
        SET @release31_audit_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD COLUMN ', p_column_definition
        );
        PREPARE release31_audit_statement FROM @release31_audit_sql;
        EXECUTE release31_audit_statement;
        DEALLOCATE PREPARE release31_audit_statement;
    END IF;
END$$

CREATE PROCEDURE chalin03_release31_audit_add_index(
    IN p_table_name VARCHAR(64),
    IN p_index_name VARCHAR(64),
    IN p_index_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND INDEX_NAME = p_index_name
    ) THEN
        SET @release31_audit_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD ', p_index_definition
        );
        PREPARE release31_audit_statement FROM @release31_audit_sql;
        EXECUTE release31_audit_statement;
        DEALLOCATE PREPARE release31_audit_statement;
    END IF;
END$$

CREATE PROCEDURE chalin03_release31_audit_request_area_enum()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'audit_unlock_requests'
          AND COLUMN_NAME = 'request_area'
    ) THEN
        ALTER TABLE audit_unlock_requests
          ADD COLUMN request_area ENUM(
            'sale','expense','debt_payment','stock','stock_adjustment',
            'stock_transfer','stock_ledger','purchase','return','sms',
            'backup_restore','maintenance','audit_signoff','audit_reapproval',
            'report','export','other'
          ) NOT NULL DEFAULT 'other' AFTER period_end;
    ELSEIF NOT (
        SELECT
          COLUMN_TYPE LIKE '%''stock_adjustment''%'
          AND COLUMN_TYPE LIKE '%''stock_transfer''%'
          AND COLUMN_TYPE LIKE '%''stock_ledger''%'
          AND COLUMN_TYPE LIKE '%''sms''%'
          AND COLUMN_TYPE LIKE '%''backup_restore''%'
          AND COLUMN_TYPE LIKE '%''maintenance''%'
          AND COLUMN_TYPE LIKE '%''audit_signoff''%'
          AND COLUMN_TYPE LIKE '%''audit_reapproval''%'
          AND COLUMN_TYPE LIKE '%''report''%'
          AND COLUMN_TYPE LIKE '%''export''%'
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'audit_unlock_requests'
          AND COLUMN_NAME = 'request_area'
        LIMIT 1
    ) THEN
        ALTER TABLE audit_unlock_requests
          MODIFY COLUMN request_area ENUM(
            'sale','expense','debt_payment','stock','stock_adjustment',
            'stock_transfer','stock_ledger','purchase','return','sms',
            'backup_restore','maintenance','audit_signoff','audit_reapproval',
            'report','export','other'
          ) NOT NULL DEFAULT 'other';
    END IF;
END$$

DELIMITER ;

CALL chalin03_release31_audit_add_column('audit_signoffs','branch_id','`branch_id` INT NOT NULL DEFAULT 1 AFTER `id`');
CALL chalin03_release31_audit_add_column('audit_signoffs','purchases_checked','`purchases_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `reports_checked`');
CALL chalin03_release31_audit_add_column('audit_signoffs','returns_checked','`returns_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `purchases_checked`');
CALL chalin03_release31_audit_add_column('audit_signoffs','transfers_checked','`transfers_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `returns_checked`');
CALL chalin03_release31_audit_add_column('audit_signoffs','sms_checked','`sms_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `transfers_checked`');
CALL chalin03_release31_audit_add_column('audit_signoffs','stock_ledger_checked','`stock_ledger_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `sms_checked`');
CALL chalin03_release31_audit_add_column('audit_signoffs','backup_checked','`backup_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `stock_ledger_checked`');
CALL chalin03_release31_audit_add_column('audit_signoffs','maintenance_checked','`maintenance_checked` BOOLEAN NOT NULL DEFAULT FALSE AFTER `backup_checked`');
CALL chalin03_release31_audit_add_column('audit_unlock_requests','branch_id','`branch_id` INT NOT NULL DEFAULT 1 AFTER `id`');
CALL chalin03_release31_audit_request_area_enum();
CALL chalin03_release31_audit_add_column('audit_reapproval_log','branch_id','`branch_id` INT NOT NULL DEFAULT 1 AFTER `id`');

CALL chalin03_release31_audit_add_index('audit_signoffs','idx_audit_signoff_branch','INDEX `idx_audit_signoff_branch` (`branch_id`)');
CALL chalin03_release31_audit_add_index('audit_signoffs','idx_audit_signoff_period_type','INDEX `idx_audit_signoff_period_type` (`period_type`)');
CALL chalin03_release31_audit_add_index('audit_signoffs','idx_audit_signoff_period_dates','INDEX `idx_audit_signoff_period_dates` (`period_start`, `period_end`)');
CALL chalin03_release31_audit_add_index('audit_signoffs','idx_audit_signoff_status','INDEX `idx_audit_signoff_status` (`period_status`)');
CALL chalin03_release31_audit_add_index('audit_signoffs','idx_audit_signoff_created_by','INDEX `idx_audit_signoff_created_by` (`created_by`)');
CALL chalin03_release31_audit_add_index('audit_signoffs','idx_audit_signoff_approved_by','INDEX `idx_audit_signoff_approved_by` (`approved_by`)');
CALL chalin03_release31_audit_add_index('audit_signoffs','idx_audit_signoff_created_at','INDEX `idx_audit_signoff_created_at` (`created_at`)');
CALL chalin03_release31_audit_add_index('audit_unlock_requests','idx_unlock_request_branch','INDEX `idx_unlock_request_branch` (`branch_id`)');
CALL chalin03_release31_audit_add_index('audit_unlock_requests','idx_unlock_request_signoff','INDEX `idx_unlock_request_signoff` (`audit_signoff_id`)');
CALL chalin03_release31_audit_add_index('audit_unlock_requests','idx_unlock_request_status','INDEX `idx_unlock_request_status` (`status`)');
CALL chalin03_release31_audit_add_index('audit_unlock_requests','idx_unlock_request_area','INDEX `idx_unlock_request_area` (`request_area`)');
CALL chalin03_release31_audit_add_index('audit_unlock_requests','idx_unlock_request_requested_by','INDEX `idx_unlock_request_requested_by` (`requested_by`)');
CALL chalin03_release31_audit_add_index('audit_unlock_requests','idx_unlock_request_reviewed_by','INDEX `idx_unlock_request_reviewed_by` (`reviewed_by`)');
CALL chalin03_release31_audit_add_index('audit_unlock_requests','idx_unlock_request_created_at','INDEX `idx_unlock_request_created_at` (`created_at`)');
CALL chalin03_release31_audit_add_index('audit_reapproval_log','idx_reapproval_branch','INDEX `idx_reapproval_branch` (`branch_id`)');
CALL chalin03_release31_audit_add_index('audit_reapproval_log','idx_reapproval_signoff','INDEX `idx_reapproval_signoff` (`audit_signoff_id`)');
CALL chalin03_release31_audit_add_index('audit_reapproval_log','idx_reapproval_unlock_request','INDEX `idx_reapproval_unlock_request` (`unlock_request_id`)');
CALL chalin03_release31_audit_add_index('audit_reapproval_log','idx_reapproval_period_dates','INDEX `idx_reapproval_period_dates` (`period_start`, `period_end`)');
CALL chalin03_release31_audit_add_index('audit_reapproval_log','idx_reapproval_user','INDEX `idx_reapproval_user` (`reapproved_by`)');
CALL chalin03_release31_audit_add_index('audit_reapproval_log','idx_reapproval_date','INDEX `idx_reapproval_date` (`reapproved_at`)');

DROP PROCEDURE IF EXISTS chalin03_release31_audit_request_area_enum;
DROP PROCEDURE IF EXISTS chalin03_release31_audit_add_index;
DROP PROCEDURE IF EXISTS chalin03_release31_audit_add_column;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260723_release31_audit_schema_safety',
    'Moves audit sign-off, unlock-request and reapproval schema repair into the controlled Release 3.1 migration process and establishes the approved audit schema contract.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
