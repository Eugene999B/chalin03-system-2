-- CHALIN 03 EQUIPMENT INSTALLMENT FINANCE
-- PHASE 3: APPLICATION CREATION, REGISTER AND APPROVAL PIPELINE
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: verify the Railway database snapshot and the Chalin 03 application backup before deployment.
-- No Finance, Spare Parts, Mining or Equipment Hire business records are deleted.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name)
);

CREATE TABLE IF NOT EXISTS equipment_credit_application_decisions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    application_id BIGINT NOT NULL,
    decision_version INT UNSIGNED NOT NULL DEFAULT 1,
    action_type ENUM(
        'created','updated','assessed','submitted','review_started',
        'changes_requested','approved','declined','withdrawn','kyc_verified'
    ) NOT NULL,
    from_status VARCHAR(40) NULL,
    to_status VARCHAR(40) NULL,
    affordability_status VARCHAR(40) NULL,
    risk_band VARCHAR(40) NULL,
    risk_score DECIMAL(10,2) NULL,
    debt_service_ratio_percent DECIMAL(10,2) NULL,
    net_monthly_surplus DECIMAL(14,2) NULL,
    notes TEXT NULL,
    snapshot_json LONGTEXT NULL,
    decided_by INT NULL,
    decided_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_finance_decision_application_version (application_id, decision_version),
    INDEX idx_finance_decision_action (action_type, decided_at)
);

DELIMITER $$

DROP PROCEDURE IF EXISTS finance_phase3_add_column_if_missing $$
CREATE PROCEDURE finance_phase3_add_column_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_column_name VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table_name
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND COLUMN_NAME = p_column_name
    ) THEN
        SET @phase3_add_column_sql = CONCAT(
            'ALTER', ' TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE phase3_add_column_stmt FROM @phase3_add_column_sql;
        EXECUTE phase3_add_column_stmt;
        DEALLOCATE PREPARE phase3_add_column_stmt;
    END IF;
END $$

DROP PROCEDURE IF EXISTS finance_phase3_make_location_nullable $$
CREATE PROCEDURE finance_phase3_make_location_nullable(IN p_table_name VARCHAR(64))
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND COLUMN_NAME = 'hire_location_id'
          AND IS_NULLABLE = 'NO'
    ) THEN
        SET @phase3_nullable_sql = CONCAT(
            'ALTER', ' TABLE `', REPLACE(p_table_name, '`', '``'),
            '` MODIFY COLUMN `hire_location_id` INT NULL'
        );
        PREPARE phase3_nullable_stmt FROM @phase3_nullable_sql;
        EXECUTE phase3_nullable_stmt;
        DEALLOCATE PREPARE phase3_nullable_stmt;
    END IF;
END $$

DROP PROCEDURE IF EXISTS finance_phase3_add_index_if_missing $$
CREATE PROCEDURE finance_phase3_add_index_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_index_name VARCHAR(64),
    IN p_index_definition TEXT
)
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table_name
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND INDEX_NAME = p_index_name
    ) THEN
        SET @phase3_add_index_sql = CONCAT(
            'ALTER', ' TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD INDEX `', REPLACE(p_index_name, '`', '``'),
            '` ', p_index_definition
        );
        PREPARE phase3_add_index_stmt FROM @phase3_add_index_sql;
        EXECUTE phase3_add_index_stmt;
        DEALLOCATE PREPARE phase3_add_index_stmt;
    END IF;
END $$

DELIMITER ;

CALL finance_phase3_add_column_if_missing(
    'equipment_credit_applications', 'proposed_interval_days',
    'SMALLINT UNSIGNED NULL AFTER proposed_frequency'
);
CALL finance_phase3_add_column_if_missing(
    'equipment_credit_applications', 'proposed_non_working_day_rule',
    "ENUM('exact','next_weekday','previous_weekday') NOT NULL DEFAULT 'exact' AFTER proposed_interval_days"
);
CALL finance_phase3_add_column_if_missing(
    'equipment_credit_applications', 'proposed_periodic_amount',
    'DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER proposed_installment_amount'
);
CALL finance_phase3_add_column_if_missing(
    'equipment_credit_applications', 'submitted_by',
    'INT NULL AFTER customer_consent_at'
);
CALL finance_phase3_add_column_if_missing(
    'equipment_credit_applications', 'submitted_at',
    'DATETIME NULL AFTER submitted_by'
);
CALL finance_phase3_add_column_if_missing(
    'equipment_credit_applications', 'reviewed_by',
    'INT NULL AFTER submitted_at'
);
CALL finance_phase3_add_column_if_missing(
    'equipment_credit_applications', 'reviewed_at',
    'DATETIME NULL AFTER reviewed_by'
);
CALL finance_phase3_add_column_if_missing(
    'equipment_credit_applications', 'decision_reason',
    'TEXT NULL AFTER reviewed_at'
);
CALL finance_phase3_add_column_if_missing(
    'equipment_credit_applications', 'decision_version',
    'INT UNSIGNED NOT NULL DEFAULT 0 AFTER decision_reason'
);

CALL finance_phase3_add_column_if_missing(
    'equipment_sales_quotations', 'proposed_interval_days',
    'SMALLINT UNSIGNED NULL AFTER proposed_frequency'
);
CALL finance_phase3_add_column_if_missing(
    'equipment_sales_quotations', 'proposed_non_working_day_rule',
    "ENUM('exact','next_weekday','previous_weekday') NOT NULL DEFAULT 'exact' AFTER proposed_interval_days"
);
CALL finance_phase3_add_column_if_missing(
    'equipment_sales_quotation_items', 'main_image_url_snapshot',
    'MEDIUMTEXT NULL AFTER serial_number_snapshot'
);

CALL finance_phase3_make_location_nullable('equipment_credit_applications');
CALL finance_phase3_make_location_nullable('equipment_sales_quotations');
CALL finance_phase3_make_location_nullable('equipment_sales_quotation_items');

ALTER TABLE equipment_credit_applications
    MODIFY COLUMN application_status ENUM(
        'draft','submitted','under_review','changes_requested',
        'approved','declined','withdrawn'
    ) NOT NULL DEFAULT 'draft',
    MODIFY COLUMN kyc_status ENUM(
        'not_started','incomplete','complete','verified','rejected'
    ) NOT NULL DEFAULT 'not_started',
    MODIFY COLUMN affordability_status ENUM(
        'not_assessed','eligible','manual_review','ineligible'
    ) NOT NULL DEFAULT 'not_assessed',
    MODIFY COLUMN risk_band ENUM(
        'not_assessed','low','medium','high','critical'
    ) NOT NULL DEFAULT 'not_assessed',
    MODIFY COLUMN proposed_frequency ENUM(
        'weekly','fortnightly','monthly','custom'
    ) NOT NULL DEFAULT 'monthly',
    MODIFY COLUMN proposed_non_working_day_rule ENUM(
        'exact','next_weekday','previous_weekday'
    ) NOT NULL DEFAULT 'exact';

ALTER TABLE equipment_sales_quotations
    MODIFY COLUMN status ENUM(
        'draft','pending_approval','approved','accepted',
        'rejected','expired','converted','cancelled'
    ) NOT NULL DEFAULT 'draft',
    MODIFY COLUMN proposed_frequency ENUM(
        'weekly','fortnightly','monthly','custom'
    ) NOT NULL DEFAULT 'monthly',
    MODIFY COLUMN proposed_non_working_day_rule ENUM(
        'exact','next_weekday','previous_weekday'
    ) NOT NULL DEFAULT 'exact';

ALTER TABLE equipment_credit_application_decisions
    MODIFY COLUMN action_type ENUM(
        'created','updated','assessed','submitted','review_started',
        'changes_requested','approved','declined','withdrawn','kyc_verified'
    ) NOT NULL;

CALL finance_phase3_add_index_if_missing(
    'equipment_credit_applications',
    'idx_finance_app_status_updated',
    '(`application_status`, `updated_at`, `id`)'
);
CALL finance_phase3_add_index_if_missing(
    'equipment_credit_applications',
    'idx_finance_app_customer',
    '(`customer_id`, `id`)'
);
CALL finance_phase3_add_index_if_missing(
    'equipment_credit_applications',
    'idx_finance_app_quotation',
    '(`quotation_id`, `id`)'
);
CALL finance_phase3_add_index_if_missing(
    'equipment_credit_applications',
    'idx_finance_app_asset_status',
    '(`asset_id`, `application_status`, `id`)'
);
CALL finance_phase3_add_index_if_missing(
    'equipment_credit_application_kyc',
    'idx_finance_kyc_application',
    '(`application_id`)'
);
CALL finance_phase3_add_index_if_missing(
    'equipment_credit_application_decisions',
    'idx_finance_decision_application_version',
    '(`application_id`, `decision_version`)'
);

-- The uniquely named helper procedures intentionally remain available for safe
-- idempotent re-runs. The next run replaces them before use.

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260804_equipment_finance_phase3_application_pipeline',
    'Bounded Equipment Finance creation, register, detail, submission and approval pipeline; nullable company-wide location columns, required workflow values and supporting indexes.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
