-- CHALIN 03 EQUIPMENT INSTALLMENT FINANCE
-- CONTROLLED COLLECTIONS, DELIVERY HANDOVER AND OWNERSHIP TRANSFER
-- ADDITIVE MIGRATION ONLY.
-- FORWARD-ONLY CHANGE.
-- BACKUP REQUIRED BEFORE PRODUCTION EXECUTION.
-- Existing Finance agreements, schedules, payments, Hire contracts, Hire jobs,
-- deliveries, ownership records and fleet records are preserved.
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

DROP PROCEDURE IF EXISTS equipment_finance_lifecycle_add_column_if_missing $$
DROP PROCEDURE IF EXISTS equipment_finance_lifecycle_add_index_if_missing $$
DROP PROCEDURE IF EXISTS equipment_finance_lifecycle_add_fk_if_missing $$

CREATE PROCEDURE equipment_finance_lifecycle_add_column_if_missing(
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
        SET @finance_lifecycle_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE finance_lifecycle_stmt FROM @finance_lifecycle_sql;
        EXECUTE finance_lifecycle_stmt;
        DEALLOCATE PREPARE finance_lifecycle_stmt;
    END IF;
END $$

CREATE PROCEDURE equipment_finance_lifecycle_add_index_if_missing(
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
        SET @finance_lifecycle_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD ', p_definition
        );
        PREPARE finance_lifecycle_stmt FROM @finance_lifecycle_sql;
        EXECUTE finance_lifecycle_stmt;
        DEALLOCATE PREPARE finance_lifecycle_stmt;
    END IF;
END $$

CREATE PROCEDURE equipment_finance_lifecycle_add_fk_if_missing(
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
        SET @finance_lifecycle_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE finance_lifecycle_stmt FROM @finance_lifecycle_sql;
        EXECUTE finance_lifecycle_stmt;
        DEALLOCATE PREPARE finance_lifecycle_stmt;
    END IF;
END $$

DELIMITER ;

CALL equipment_finance_lifecycle_add_column_if_missing(
    'equipment_sale_agreements',
    'controlled_delivery_completed_at',
    'DATETIME NULL AFTER delivered_at'
);
CALL equipment_finance_lifecycle_add_column_if_missing(
    'equipment_sale_agreements',
    'controlled_delivery_completed_by',
    'INT NULL AFTER controlled_delivery_completed_at'
);
CALL equipment_finance_lifecycle_add_column_if_missing(
    'equipment_sale_agreements',
    'controlled_ownership_completed_at',
    'DATETIME NULL AFTER ownership_status'
);
CALL equipment_finance_lifecycle_add_column_if_missing(
    'equipment_sale_agreements',
    'controlled_ownership_completed_by',
    'INT NULL AFTER controlled_ownership_completed_at'
);

CALL equipment_finance_lifecycle_add_column_if_missing(
    'equipment_deliveries',
    'idempotency_key',
    'VARCHAR(191) NULL AFTER delivery_number'
);
CALL equipment_finance_lifecycle_add_column_if_missing(
    'equipment_deliveries',
    'credit_application_id',
    'BIGINT NULL AFTER agreement_id'
);
CALL equipment_finance_lifecycle_add_column_if_missing(
    'equipment_deliveries',
    'handover_stage',
    "ENUM('legacy','finance_controlled') NOT NULL DEFAULT 'legacy' AFTER credit_application_id"
);

CALL equipment_finance_lifecycle_add_column_if_missing(
    'equipment_ownership_transfers',
    'idempotency_key',
    'VARCHAR(191) NULL AFTER transfer_number'
);
CALL equipment_finance_lifecycle_add_column_if_missing(
    'equipment_ownership_transfers',
    'credit_application_id',
    'BIGINT NULL AFTER agreement_id'
);
CALL equipment_finance_lifecycle_add_column_if_missing(
    'equipment_ownership_transfers',
    'transfer_stage',
    "ENUM('legacy','finance_controlled') NOT NULL DEFAULT 'legacy' AFTER credit_application_id"
);

CALL equipment_finance_lifecycle_add_index_if_missing(
    'equipment_sale_agreements',
    'idx_equipment_finance_final_lifecycle',
    'INDEX `idx_equipment_finance_final_lifecycle` (`activation_source`, `equipment_commitment_status`, `delivery_status`, `ownership_status`, `hire_location_id`)'
);
CALL equipment_finance_lifecycle_add_index_if_missing(
    'equipment_deliveries',
    'uq_equipment_finance_delivery_idempotency',
    'UNIQUE INDEX `uq_equipment_finance_delivery_idempotency` (`idempotency_key`)'
);
CALL equipment_finance_lifecycle_add_index_if_missing(
    'equipment_deliveries',
    'idx_equipment_finance_delivery_application',
    'INDEX `idx_equipment_finance_delivery_application` (`credit_application_id`, `handover_stage`, `delivery_datetime`)'
);
CALL equipment_finance_lifecycle_add_index_if_missing(
    'equipment_ownership_transfers',
    'uq_equipment_finance_ownership_idempotency',
    'UNIQUE INDEX `uq_equipment_finance_ownership_idempotency` (`idempotency_key`)'
);
CALL equipment_finance_lifecycle_add_index_if_missing(
    'equipment_ownership_transfers',
    'idx_equipment_finance_ownership_application',
    'INDEX `idx_equipment_finance_ownership_application` (`credit_application_id`, `transfer_stage`, `transfer_date`)'
);

CALL equipment_finance_lifecycle_add_fk_if_missing(
    'equipment_sale_agreements',
    'fk_equipment_finance_delivery_completed_by',
    'FOREIGN KEY (`controlled_delivery_completed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL'
);
CALL equipment_finance_lifecycle_add_fk_if_missing(
    'equipment_sale_agreements',
    'fk_equipment_finance_ownership_completed_by',
    'FOREIGN KEY (`controlled_ownership_completed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL'
);
CALL equipment_finance_lifecycle_add_fk_if_missing(
    'equipment_deliveries',
    'fk_equipment_finance_delivery_application',
    'FOREIGN KEY (`credit_application_id`) REFERENCES `equipment_credit_applications` (`id`) ON DELETE RESTRICT'
);
CALL equipment_finance_lifecycle_add_fk_if_missing(
    'equipment_ownership_transfers',
    'fk_equipment_finance_ownership_application',
    'FOREIGN KEY (`credit_application_id`) REFERENCES `equipment_credit_applications` (`id`) ON DELETE RESTRICT'
);

DELIMITER $$

DROP TRIGGER IF EXISTS trg_equipment_finance_payment_gate_before_insert $$
CREATE TRIGGER trg_equipment_finance_payment_gate_before_insert
BEFORE INSERT ON equipment_sale_payments
FOR EACH ROW
BEGIN
    DECLARE v_agreement_exists INT DEFAULT 0;
    DECLARE v_activation_source VARCHAR(60) DEFAULT NULL;
    DECLARE v_credit_application_id BIGINT DEFAULT NULL;
    DECLARE v_hire_location_id INT DEFAULT NULL;
    DECLARE v_customer_id INT DEFAULT NULL;
    DECLARE v_agreement_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_commitment_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_deposit_required DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_deposit_received DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_outstanding_balance DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_application_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_kyc_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_affordability_status VARCHAR(60) DEFAULT NULL;

    SELECT COUNT(*),
           MAX(agreement.activation_source),
           MAX(agreement.credit_application_id),
           MAX(agreement.hire_location_id),
           MAX(agreement.customer_id),
           MAX(agreement.agreement_status),
           MAX(agreement.equipment_commitment_status),
           MAX(agreement.deposit_required),
           MAX(agreement.deposit_received),
           MAX(agreement.outstanding_balance),
           MAX(application.application_status),
           MAX(application.kyc_status),
           MAX(application.affordability_status)
      INTO v_agreement_exists,
           v_activation_source,
           v_credit_application_id,
           v_hire_location_id,
           v_customer_id,
           v_agreement_status,
           v_commitment_status,
           v_deposit_required,
           v_deposit_received,
           v_outstanding_balance,
           v_application_status,
           v_kyc_status,
           v_affordability_status
    FROM equipment_sale_agreements agreement
    LEFT JOIN equipment_credit_applications application
      ON application.id = agreement.credit_application_id
    WHERE agreement.id = NEW.agreement_id;

    IF v_agreement_exists <> 1 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Finance payment agreement was not found.';
    END IF;

    IF v_activation_source = 'approved_credit_application' THEN
        IF NEW.credit_application_id IS NULL
           OR NEW.credit_application_id <> v_credit_application_id THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Finance payment does not match the approved credit application.';
        END IF;

        IF NEW.hire_location_id <> v_hire_location_id
           OR NEW.customer_id <> v_customer_id THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Finance payment location or customer does not match the agreement.';
        END IF;

        IF v_application_status <> 'approved'
           OR v_kyc_status <> 'verified'
           OR v_affordability_status NOT IN ('eligible','manual_review') THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The linked credit application no longer satisfies the approved Finance gate.';
        END IF;

        IF NEW.idempotency_key IS NULL OR CHAR_LENGTH(TRIM(NEW.idempotency_key)) < 20 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'A secure Finance payment request key is required.';
        END IF;

        IF NEW.payment_stage = 'opening_deposit' THEN
            IF NEW.payment_category <> 'deposit' THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'The opening Finance stage accepts deposit payments only.';
            END IF;

            IF v_agreement_status NOT IN ('approved','active') THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Opening deposits cannot be added to this Finance agreement status.';
            END IF;

            IF v_commitment_status <> 'not_reserved' THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'The machine is already reserved; opening deposits are closed.';
            END IF;

            IF NEW.amount <= 0 THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Opening deposit amount must be greater than zero.';
            END IF;

            IF v_deposit_received + NEW.amount > v_deposit_required + 0.01 THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Opening deposit exceeds the remaining required deposit.';
            END IF;

            SET NEW.reservation_effect = CASE
                WHEN v_deposit_received + NEW.amount + 0.01 >= v_deposit_required
                    THEN 'reserved'
                ELSE 'none'
            END;
        ELSEIF NEW.payment_stage IN ('installment_collection','settlement') THEN
            IF v_commitment_status <> 'reserved' THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Complete the Finance machine reservation before recording collections.';
            END IF;

            IF v_deposit_received + 0.01 < v_deposit_required THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'The required opening deposit is not complete.';
            END IF;

            IF v_agreement_status NOT IN ('active','due_soon','payment_due','overdue') THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Collections are closed for this Finance agreement status.';
            END IF;

            IF NEW.amount <= 0 OR NEW.amount > v_outstanding_balance + 0.01 THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Finance collection amount is invalid for the outstanding balance.';
            END IF;

            IF NEW.payment_stage = 'settlement' THEN
                IF NEW.payment_category <> 'settlement'
                   OR NEW.amount + 0.01 < v_outstanding_balance THEN
                    SIGNAL SQLSTATE '45000'
                        SET MESSAGE_TEXT = 'A settlement must clear the remaining Finance balance.';
                END IF;
            ELSE
                IF NEW.payment_category <> 'installment'
                   OR NEW.amount + 0.01 >= v_outstanding_balance THEN
                    SIGNAL SQLSTATE '45000'
                        SET MESSAGE_TEXT = 'Use the settlement stage when the payment clears the balance.';
                END IF;
            END IF;

            SET NEW.reservation_effect = 'none';
        ELSE
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Use the controlled Finance deposit or collection endpoint for this agreement.';
        END IF;
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_equipment_finance_delivery_gate_before_insert $$
CREATE TRIGGER trg_equipment_finance_delivery_gate_before_insert
BEFORE INSERT ON equipment_deliveries
FOR EACH ROW
BEGIN
    DECLARE v_agreement_exists INT DEFAULT 0;
    DECLARE v_activation_source VARCHAR(60) DEFAULT NULL;
    DECLARE v_credit_application_id BIGINT DEFAULT NULL;
    DECLARE v_location_id INT DEFAULT NULL;
    DECLARE v_customer_id INT DEFAULT NULL;
    DECLARE v_asset_id INT DEFAULT NULL;
    DECLARE v_application_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_kyc_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_affordability_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_commitment_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_agreement_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_delivery_policy VARCHAR(60) DEFAULT NULL;
    DECLARE v_delivery_threshold DECIMAL(7,4) DEFAULT 0.00;
    DECLARE v_total_amount DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_amount_paid DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_deposit_required DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_deposit_received DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_outstanding_balance DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_active_hire_count INT DEFAULT 0;

    SELECT COUNT(*),
           MAX(agreement.activation_source),
           MAX(agreement.credit_application_id),
           MAX(agreement.hire_location_id),
           MAX(agreement.customer_id),
           MAX(agreement.asset_id),
           MAX(application.application_status),
           MAX(application.kyc_status),
           MAX(application.affordability_status),
           MAX(agreement.equipment_commitment_status),
           MAX(agreement.agreement_status),
           MAX(agreement.delivery_policy),
           MAX(agreement.delivery_threshold_percent),
           MAX(agreement.total_amount),
           MAX(agreement.amount_paid),
           MAX(agreement.deposit_required),
           MAX(agreement.deposit_received),
           MAX(agreement.outstanding_balance)
      INTO v_agreement_exists,
           v_activation_source,
           v_credit_application_id,
           v_location_id,
           v_customer_id,
           v_asset_id,
           v_application_status,
           v_kyc_status,
           v_affordability_status,
           v_commitment_status,
           v_agreement_status,
           v_delivery_policy,
           v_delivery_threshold,
           v_total_amount,
           v_amount_paid,
           v_deposit_required,
           v_deposit_received,
           v_outstanding_balance
    FROM equipment_sale_agreements agreement
    LEFT JOIN equipment_credit_applications application
      ON application.id = agreement.credit_application_id
    WHERE agreement.id = NEW.agreement_id;

    IF v_agreement_exists <> 1 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Finance delivery agreement was not found.';
    END IF;

    IF v_activation_source = 'approved_credit_application' THEN
        IF NEW.handover_stage <> 'finance_controlled' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Use the controlled Finance delivery-handover endpoint.';
        END IF;

        IF NEW.credit_application_id IS NULL
           OR NEW.credit_application_id <> v_credit_application_id THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Finance delivery does not match the approved credit application.';
        END IF;

        IF NEW.hire_location_id <> v_location_id
           OR NEW.customer_id <> v_customer_id
           OR NEW.asset_id <> v_asset_id THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Finance delivery location, customer or machine does not match the agreement.';
        END IF;

        IF NEW.idempotency_key IS NULL OR CHAR_LENGTH(TRIM(NEW.idempotency_key)) < 20 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'A secure Finance delivery request key is required.';
        END IF;

        IF v_application_status <> 'approved'
           OR v_kyc_status <> 'verified'
           OR v_affordability_status NOT IN ('eligible','manual_review') THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The linked application no longer satisfies the Finance delivery gate.';
        END IF;

        IF v_commitment_status <> 'reserved'
           OR v_agreement_status NOT IN ('active','due_soon','payment_due','overdue','completed') THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The Finance agreement is not ready for equipment handover.';
        END IF;

        SELECT COUNT(*)
          INTO v_active_hire_count
        FROM hire_contract_assets
        WHERE asset_id = v_asset_id
          AND status IN ('assigned','dispatched','active');

        IF v_active_hire_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Equipment active on Hire cannot be handed over through Finance.';
        END IF;

        IF v_delivery_policy = 'after_deposit'
           AND v_deposit_received + 0.01 < v_deposit_required THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The required deposit threshold for delivery has not been reached.';
        END IF;

        IF v_delivery_policy = 'after_percentage'
           AND (v_total_amount <= 0
                OR (v_amount_paid / v_total_amount) * 100 + 0.0001 < v_delivery_threshold) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The required payment percentage for delivery has not been reached.';
        END IF;

        IF v_delivery_policy = 'after_full_payment'
           AND v_outstanding_balance > 0.01 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Full payment is required before equipment handover.';
        END IF;

        IF NEW.status <> 'delivered' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Controlled Finance handover must be recorded as delivered.';
        END IF;
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_equipment_finance_ownership_gate_before_insert $$
CREATE TRIGGER trg_equipment_finance_ownership_gate_before_insert
BEFORE INSERT ON equipment_ownership_transfers
FOR EACH ROW
BEGIN
    DECLARE v_agreement_exists INT DEFAULT 0;
    DECLARE v_activation_source VARCHAR(60) DEFAULT NULL;
    DECLARE v_credit_application_id BIGINT DEFAULT NULL;
    DECLARE v_location_id INT DEFAULT NULL;
    DECLARE v_customer_id INT DEFAULT NULL;
    DECLARE v_asset_id INT DEFAULT NULL;
    DECLARE v_outstanding_balance DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_delivery_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_commitment_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_controlled_delivery_count INT DEFAULT 0;
    DECLARE v_active_hire_count INT DEFAULT 0;

    SELECT COUNT(*),
           MAX(agreement.activation_source),
           MAX(agreement.credit_application_id),
           MAX(agreement.hire_location_id),
           MAX(agreement.customer_id),
           MAX(agreement.asset_id),
           MAX(agreement.outstanding_balance),
           MAX(agreement.delivery_status),
           MAX(agreement.equipment_commitment_status)
      INTO v_agreement_exists,
           v_activation_source,
           v_credit_application_id,
           v_location_id,
           v_customer_id,
           v_asset_id,
           v_outstanding_balance,
           v_delivery_status,
           v_commitment_status
    FROM equipment_sale_agreements agreement
    WHERE agreement.id = NEW.agreement_id;

    IF v_agreement_exists <> 1 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Finance ownership agreement was not found.';
    END IF;

    IF v_activation_source = 'approved_credit_application' THEN
        IF NEW.transfer_stage <> 'finance_controlled' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Use the controlled Finance ownership-transfer endpoint.';
        END IF;

        IF NEW.credit_application_id IS NULL
           OR NEW.credit_application_id <> v_credit_application_id THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Finance ownership transfer does not match the approved application.';
        END IF;

        IF NEW.hire_location_id <> v_location_id
           OR NEW.customer_id <> v_customer_id
           OR NEW.asset_id <> v_asset_id THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Finance ownership location, customer or machine does not match the agreement.';
        END IF;

        IF NEW.idempotency_key IS NULL OR CHAR_LENGTH(TRIM(NEW.idempotency_key)) < 20 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'A secure Finance ownership request key is required.';
        END IF;

        IF v_outstanding_balance > 0.01 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Ownership cannot transfer while a Finance balance remains.';
        END IF;

        IF v_delivery_status <> 'delivered'
           OR v_commitment_status <> 'reserved' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Controlled Finance delivery and reservation are required before ownership transfer.';
        END IF;

        SELECT COUNT(*)
          INTO v_controlled_delivery_count
        FROM equipment_deliveries
        WHERE agreement_id = NEW.agreement_id
          AND handover_stage = 'finance_controlled'
          AND status = 'delivered';

        IF v_controlled_delivery_count <> 1 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Controlled Finance handover evidence is missing.';
        END IF;

        SELECT COUNT(*)
          INTO v_active_hire_count
        FROM hire_contract_assets
        WHERE asset_id = v_asset_id
          AND status IN ('assigned','dispatched','active');

        IF v_active_hire_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Equipment active on Hire cannot transfer ownership through Finance.';
        END IF;

        IF NEW.status <> 'issued' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Controlled Finance ownership evidence must be issued.';
        END IF;
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_equipment_finance_lifecycle_agreement_before_update $$
CREATE TRIGGER trg_equipment_finance_lifecycle_agreement_before_update
BEFORE UPDATE ON equipment_sale_agreements
FOR EACH ROW
BEGIN
    DECLARE v_controlled_delivery_count INT DEFAULT 0;
    DECLARE v_controlled_ownership_count INT DEFAULT 0;

    IF NEW.activation_source = 'approved_credit_application' THEN
        IF NEW.delivery_status = 'delivered'
           AND OLD.delivery_status <> 'delivered' THEN
            IF NEW.controlled_delivery_completed_at IS NULL
               OR NEW.controlled_delivery_completed_by IS NULL THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Controlled Finance delivery officer evidence is required.';
            END IF;

            SELECT COUNT(*)
              INTO v_controlled_delivery_count
            FROM equipment_deliveries
            WHERE agreement_id = NEW.id
              AND handover_stage = 'finance_controlled'
              AND status = 'delivered';

            IF v_controlled_delivery_count <> 1 THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Controlled Finance delivery evidence is missing.';
            END IF;
        END IF;

        IF NEW.ownership_status = 'transferred'
           AND OLD.ownership_status <> 'transferred' THEN
            IF NEW.controlled_ownership_completed_at IS NULL
               OR NEW.controlled_ownership_completed_by IS NULL
               OR NEW.outstanding_balance > 0.01
               OR NEW.delivery_status <> 'delivered' THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Finance ownership requirements are incomplete.';
            END IF;

            SELECT COUNT(*)
              INTO v_controlled_ownership_count
            FROM equipment_ownership_transfers
            WHERE agreement_id = NEW.id
              AND transfer_stage = 'finance_controlled'
              AND status = 'issued';

            IF v_controlled_ownership_count <> 1 THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Controlled Finance ownership evidence is missing.';
            END IF;
        END IF;
    END IF;
END $$

DELIMITER ;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260729_equipment_finance_final_lifecycle',
    'Adds controlled installment collections, Finance delivery handover, ownership transfer and database gates while preserving Hire isolation.'
)
ON DUPLICATE KEY UPDATE
    description = VALUES(description);
