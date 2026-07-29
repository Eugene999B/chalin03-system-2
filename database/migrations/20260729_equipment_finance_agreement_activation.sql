-- CHALIN 03 EQUIPMENT INSTALLMENT FINANCE
-- APPROVED CREDIT APPLICATION TO FINANCE AGREEMENT ACTIVATION
-- ADDITIVE / FORWARD-ONLY MIGRATION.
-- BACKUP REQUIRED BEFORE PRODUCTION EXECUTION.
-- Existing Finance agreements, schedules, payments, Hire contracts, Hire jobs,
-- dispatches, returns and fleet records are preserved.
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

DROP PROCEDURE IF EXISTS equipment_finance_activation_add_column_if_missing $$
CREATE PROCEDURE equipment_finance_activation_add_column_if_missing(
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
        SET @activation_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE activation_stmt FROM @activation_sql;
        EXECUTE activation_stmt;
        DEALLOCATE PREPARE activation_stmt;
    END IF;
END $$

DROP PROCEDURE IF EXISTS equipment_finance_activation_add_index_if_missing $$
CREATE PROCEDURE equipment_finance_activation_add_index_if_missing(
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
        SET @activation_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD ', p_definition
        );
        PREPARE activation_stmt FROM @activation_sql;
        EXECUTE activation_stmt;
        DEALLOCATE PREPARE activation_stmt;
    END IF;
END $$

DROP PROCEDURE IF EXISTS equipment_finance_activation_add_fk_if_missing $$
CREATE PROCEDURE equipment_finance_activation_add_fk_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_constraint_name VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND CONSTRAINT_NAME = p_constraint_name
          AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    ) THEN
        SET @activation_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE activation_stmt FROM @activation_sql;
        EXECUTE activation_stmt;
        DEALLOCATE PREPARE activation_stmt;
    END IF;
END $$

DELIMITER ;

CALL equipment_finance_activation_add_column_if_missing(
    'equipment_sale_agreements',
    'credit_application_id',
    'BIGINT NULL AFTER agreement_number'
);
CALL equipment_finance_activation_add_column_if_missing(
    'equipment_sale_agreements',
    'activation_source',
    "ENUM('legacy','approved_credit_application') NOT NULL DEFAULT 'legacy' AFTER credit_application_id"
);
CALL equipment_finance_activation_add_column_if_missing(
    'equipment_sale_agreements',
    'equipment_commitment_status',
    "ENUM('not_reserved','reserved','locked','released') NOT NULL DEFAULT 'not_reserved' AFTER activation_source"
);

CALL equipment_finance_activation_add_column_if_missing(
    'equipment_credit_applications',
    'agreement_id',
    'BIGINT NULL AFTER decision_version'
);
CALL equipment_finance_activation_add_column_if_missing(
    'equipment_credit_applications',
    'agreement_activated_by',
    'INT NULL AFTER agreement_id'
);
CALL equipment_finance_activation_add_column_if_missing(
    'equipment_credit_applications',
    'agreement_activated_at',
    'DATETIME NULL AFTER agreement_activated_by'
);
CALL equipment_finance_activation_add_column_if_missing(
    'equipment_credit_applications',
    'agreement_activation_notes',
    'VARCHAR(2000) NULL AFTER agreement_activated_at'
);

CALL equipment_finance_activation_add_index_if_missing(
    'equipment_sale_agreements',
    'uq_equipment_sale_agreement_credit_application',
    'UNIQUE INDEX `uq_equipment_sale_agreement_credit_application` (`credit_application_id`)'
);
CALL equipment_finance_activation_add_index_if_missing(
    'equipment_credit_applications',
    'uq_equipment_credit_application_agreement',
    'UNIQUE INDEX `uq_equipment_credit_application_agreement` (`agreement_id`)'
);
CALL equipment_finance_activation_add_index_if_missing(
    'equipment_credit_applications',
    'idx_equipment_credit_activation',
    'INDEX `idx_equipment_credit_activation` (`application_status`, `agreement_activated_at`, `hire_location_id`)'
);

CALL equipment_finance_activation_add_fk_if_missing(
    'equipment_sale_agreements',
    'fk_equipment_sale_agreement_credit_application',
    'FOREIGN KEY (`credit_application_id`) REFERENCES `equipment_credit_applications` (`id`) ON DELETE RESTRICT'
);
CALL equipment_finance_activation_add_fk_if_missing(
    'equipment_credit_applications',
    'fk_equipment_credit_application_agreement',
    'FOREIGN KEY (`agreement_id`) REFERENCES `equipment_sale_agreements` (`id`) ON DELETE SET NULL'
);
CALL equipment_finance_activation_add_fk_if_missing(
    'equipment_credit_applications',
    'fk_equipment_credit_application_activated_by',
    'FOREIGN KEY (`agreement_activated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL'
);

DELIMITER $$

DROP TRIGGER IF EXISTS trg_equipment_installment_credit_gate_before_insert $$
CREATE TRIGGER trg_equipment_installment_credit_gate_before_insert
BEFORE INSERT ON equipment_sale_agreements
FOR EACH ROW
BEGIN
    DECLARE v_matches INT DEFAULT 0;
    DECLARE v_asset_available INT DEFAULT 0;
    DECLARE v_active_sale_locks INT DEFAULT 0;
    DECLARE v_active_agreements INT DEFAULT 0;

    IF NEW.sale_type = 'installment' THEN
        IF NEW.credit_application_id IS NULL THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Installment agreements require an approved Finance credit application.';
        END IF;

        SELECT COUNT(*)
          INTO v_matches
        FROM equipment_credit_applications application
        WHERE application.id = NEW.credit_application_id
          AND application.application_status = 'approved'
          AND application.kyc_status = 'verified'
          AND application.affordability_status IN ('eligible','manual_review')
          AND application.hire_location_id = NEW.hire_location_id
          AND application.quotation_id = NEW.quotation_id
          AND application.customer_id = NEW.customer_id
          AND application.asset_id = NEW.asset_id
          AND application.agreement_id IS NULL;

        IF v_matches <> 1 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Approved Finance application does not match this installment agreement.';
        END IF;

        SELECT COUNT(*)
          INTO v_asset_available
        FROM fleet_assets asset
        WHERE asset.id = NEW.asset_id
          AND asset.is_active = TRUE
          AND asset.operational_purpose IN ('sale_only','sale_or_hire')
          AND asset.sale_status = 'available';

        IF v_asset_available <> 1 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The equipment is not currently available for Finance agreement activation.';
        END IF;

        SELECT COUNT(*)
          INTO v_active_sale_locks
        FROM equipment_asset_sale_locks sale_lock
        WHERE sale_lock.asset_id = NEW.asset_id
          AND sale_lock.released_at IS NULL;

        IF v_active_sale_locks <> 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The equipment already has an active sale or installment lock.';
        END IF;

        SELECT COUNT(*)
          INTO v_active_agreements
        FROM equipment_sale_agreements agreement
        WHERE agreement.asset_id = NEW.asset_id
          AND agreement.agreement_status NOT IN ('completed','cancelled','defaulted');

        IF v_active_agreements <> 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The equipment already belongs to another live Finance agreement.';
        END IF;

        SET NEW.activation_source = 'approved_credit_application';
        SET NEW.equipment_commitment_status = 'not_reserved';
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_equipment_installment_credit_gate_before_update $$
CREATE TRIGGER trg_equipment_installment_credit_gate_before_update
BEFORE UPDATE ON equipment_sale_agreements
FOR EACH ROW
BEGIN
    DECLARE v_matches INT DEFAULT 0;

    -- Existing pre-migration installment agreements remain operational. Their
    -- payments, balances and status may continue to update without retroactively
    -- inventing a credit application. Any new or newly linked installment flow
    -- must pass the approved Finance application gate.
    IF NEW.sale_type = 'installment'
       AND NOT (
           OLD.sale_type = 'installment'
           AND OLD.credit_application_id IS NULL
           AND NEW.credit_application_id IS NULL
           AND OLD.activation_source = 'legacy'
       ) THEN
        IF NEW.credit_application_id IS NULL THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Installment agreements require an approved Finance credit application.';
        END IF;

        SELECT COUNT(*)
          INTO v_matches
        FROM equipment_credit_applications application
        WHERE application.id = NEW.credit_application_id
          AND application.application_status = 'approved'
          AND application.kyc_status = 'verified'
          AND application.affordability_status IN ('eligible','manual_review')
          AND application.hire_location_id = NEW.hire_location_id
          AND application.quotation_id = NEW.quotation_id
          AND application.customer_id = NEW.customer_id
          AND application.asset_id = NEW.asset_id
          AND (application.agreement_id IS NULL OR application.agreement_id = NEW.id);

        IF v_matches <> 1 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Approved Finance application does not match this installment agreement.';
        END IF;

        SET NEW.activation_source = 'approved_credit_application';
    END IF;
END $$

DELIMITER ;

DROP PROCEDURE IF EXISTS equipment_finance_activation_add_column_if_missing;
DROP PROCEDURE IF EXISTS equipment_finance_activation_add_index_if_missing;
DROP PROCEDURE IF EXISTS equipment_finance_activation_add_fk_if_missing;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260729_equipment_finance_agreement_activation',
    'Link approved Finance credit applications to separate installment agreements and enforce the approval and equipment-availability gates without creating Hire jobs, payments, machine locks, delivery or SMS evidence.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);