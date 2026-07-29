-- CHALIN 03 EQUIPMENT INSTALLMENT FINANCE
-- CONTROLLED OPENING DEPOSIT AND EQUIPMENT RESERVATION
-- ADDITIVE MIGRATION ONLY.
-- FORWARD-ONLY CHANGE.
-- BACKUP REQUIRED BEFORE PRODUCTION EXECUTION.
-- Existing Finance agreements, schedules, payments, Hire contracts, Hire jobs,
-- dispatches, deliveries, ownership records and fleet records are preserved.
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

DROP PROCEDURE IF EXISTS equipment_finance_deposit_add_column_if_missing $$
DROP PROCEDURE IF EXISTS equipment_finance_deposit_add_index_if_missing $$
DROP PROCEDURE IF EXISTS equipment_finance_deposit_add_fk_if_missing $$

CREATE PROCEDURE equipment_finance_deposit_add_column_if_missing(
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
        SET @deposit_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE deposit_stmt FROM @deposit_sql;
        EXECUTE deposit_stmt;
        DEALLOCATE PREPARE deposit_stmt;
    END IF;
END $$

CREATE PROCEDURE equipment_finance_deposit_add_index_if_missing(
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
        SET @deposit_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD ', p_definition
        );
        PREPARE deposit_stmt FROM @deposit_sql;
        EXECUTE deposit_stmt;
        DEALLOCATE PREPARE deposit_stmt;
    END IF;
END $$

CREATE PROCEDURE equipment_finance_deposit_add_fk_if_missing(
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
        SET @deposit_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE deposit_stmt FROM @deposit_sql;
        EXECUTE deposit_stmt;
        DEALLOCATE PREPARE deposit_stmt;
    END IF;
END $$

DELIMITER ;

CALL equipment_finance_deposit_add_column_if_missing(
    'equipment_sale_agreements',
    'deposit_completed_at',
    'DATETIME NULL AFTER deposit_received'
);
CALL equipment_finance_deposit_add_column_if_missing(
    'equipment_sale_agreements',
    'deposit_completed_by',
    'INT NULL AFTER deposit_completed_at'
);
CALL equipment_finance_deposit_add_column_if_missing(
    'equipment_sale_agreements',
    'reservation_activated_at',
    'DATETIME NULL AFTER equipment_commitment_status'
);
CALL equipment_finance_deposit_add_column_if_missing(
    'equipment_sale_agreements',
    'reservation_activated_by',
    'INT NULL AFTER reservation_activated_at'
);

CALL equipment_finance_deposit_add_column_if_missing(
    'equipment_sale_payments',
    'idempotency_key',
    'VARCHAR(191) NULL AFTER receipt_number'
);
CALL equipment_finance_deposit_add_column_if_missing(
    'equipment_sale_payments',
    'credit_application_id',
    'BIGINT NULL AFTER agreement_id'
);
CALL equipment_finance_deposit_add_column_if_missing(
    'equipment_sale_payments',
    'payment_stage',
    "ENUM('legacy','opening_deposit','installment_collection','settlement','adjustment','refund') NOT NULL DEFAULT 'legacy' AFTER payment_category"
);
CALL equipment_finance_deposit_add_column_if_missing(
    'equipment_sale_payments',
    'reservation_effect',
    "ENUM('none','reserved') NOT NULL DEFAULT 'none' AFTER payment_stage"
);

CALL equipment_finance_deposit_add_index_if_missing(
    'equipment_sale_agreements',
    'idx_equipment_finance_deposit_reservation',
    'INDEX `idx_equipment_finance_deposit_reservation` (`activation_source`, `equipment_commitment_status`, `deposit_completed_at`, `hire_location_id`)'
);
CALL equipment_finance_deposit_add_index_if_missing(
    'equipment_sale_payments',
    'uq_equipment_finance_payment_idempotency',
    'UNIQUE INDEX `uq_equipment_finance_payment_idempotency` (`idempotency_key`)'
);
CALL equipment_finance_deposit_add_index_if_missing(
    'equipment_sale_payments',
    'idx_equipment_finance_payment_stage',
    'INDEX `idx_equipment_finance_payment_stage` (`agreement_id`, `payment_stage`, `is_voided`, `payment_date`)'
);
CALL equipment_finance_deposit_add_index_if_missing(
    'equipment_sale_payments',
    'idx_equipment_finance_payment_application',
    'INDEX `idx_equipment_finance_payment_application` (`credit_application_id`, `payment_stage`, `payment_date`)'
);

CALL equipment_finance_deposit_add_fk_if_missing(
    'equipment_sale_agreements',
    'fk_equipment_finance_deposit_completed_by',
    'FOREIGN KEY (`deposit_completed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL'
);
CALL equipment_finance_deposit_add_fk_if_missing(
    'equipment_sale_agreements',
    'fk_equipment_finance_reservation_activated_by',
    'FOREIGN KEY (`reservation_activated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL'
);
CALL equipment_finance_deposit_add_fk_if_missing(
    'equipment_sale_payments',
    'fk_equipment_finance_payment_credit_application',
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
        IF NEW.payment_stage <> 'opening_deposit' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Use the controlled Finance collection stage for approved-credit agreements.';
        END IF;

        IF NEW.payment_category <> 'deposit' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The opening Finance stage accepts deposit payments only.';
        END IF;

        IF NEW.credit_application_id IS NULL
           OR NEW.credit_application_id <> v_credit_application_id THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Deposit payment does not match the approved credit application.';
        END IF;

        IF NEW.hire_location_id <> v_hire_location_id
           OR NEW.customer_id <> v_customer_id THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Deposit payment location or customer does not match the Finance agreement.';
        END IF;

        IF v_application_status <> 'approved'
           OR v_kyc_status <> 'verified'
           OR v_affordability_status NOT IN ('eligible','manual_review') THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The linked credit application no longer satisfies the approved Finance gate.';
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
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_equipment_finance_reservation_gate_before_insert $$
CREATE TRIGGER trg_equipment_finance_reservation_gate_before_insert
BEFORE INSERT ON equipment_asset_sale_locks
FOR EACH ROW
BEGIN
    DECLARE v_agreement_exists INT DEFAULT 0;
    DECLARE v_activation_source VARCHAR(60) DEFAULT NULL;
    DECLARE v_credit_application_id BIGINT DEFAULT NULL;
    DECLARE v_agreement_asset_id INT DEFAULT NULL;
    DECLARE v_agreement_location_id INT DEFAULT NULL;
    DECLARE v_agreement_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_commitment_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_deposit_required DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_deposit_received DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_application_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_kyc_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_affordability_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_asset_available INT DEFAULT 0;
    DECLARE v_active_hire_count INT DEFAULT 0;

    SELECT COUNT(*),
           MAX(agreement.activation_source),
           MAX(agreement.credit_application_id),
           MAX(agreement.asset_id),
           MAX(agreement.hire_location_id),
           MAX(agreement.agreement_status),
           MAX(agreement.equipment_commitment_status),
           MAX(agreement.deposit_required),
           MAX(agreement.deposit_received),
           MAX(application.application_status),
           MAX(application.kyc_status),
           MAX(application.affordability_status)
      INTO v_agreement_exists,
           v_activation_source,
           v_credit_application_id,
           v_agreement_asset_id,
           v_agreement_location_id,
           v_agreement_status,
           v_commitment_status,
           v_deposit_required,
           v_deposit_received,
           v_application_status,
           v_kyc_status,
           v_affordability_status
    FROM equipment_sale_agreements agreement
    LEFT JOIN equipment_credit_applications application
      ON application.id = agreement.credit_application_id
    WHERE agreement.id = NEW.agreement_id;

    IF v_agreement_exists <> 1 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Finance reservation agreement was not found.';
    END IF;

    IF v_activation_source = 'approved_credit_application' THEN
        IF v_credit_application_id IS NULL
           OR v_application_status <> 'approved'
           OR v_kyc_status <> 'verified'
           OR v_affordability_status NOT IN ('eligible','manual_review') THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The reservation is not linked to an approved Finance application.';
        END IF;

        IF NEW.asset_id <> v_agreement_asset_id
           OR NEW.hire_location_id <> v_agreement_location_id THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Reservation asset or location does not match the Finance agreement.';
        END IF;

        IF NEW.lock_status <> 'installment_active' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Approved-credit Finance reservations must use installment_active status.';
        END IF;

        IF v_agreement_status NOT IN ('approved','active')
           OR v_commitment_status <> 'not_reserved' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'This Finance agreement cannot create another machine reservation.';
        END IF;

        IF v_deposit_received + 0.01 < v_deposit_required THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The required opening deposit must be complete before reservation.';
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
                SET MESSAGE_TEXT = 'The equipment is not available for Finance reservation.';
        END IF;

        SELECT COUNT(*)
          INTO v_active_hire_count
        FROM hire_contract_assets hire_asset
        WHERE hire_asset.asset_id = NEW.asset_id
          AND hire_asset.status IN ('assigned','dispatched','active');

        IF v_active_hire_count <> 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Equipment active on Hire cannot be reserved for Finance.';
        END IF;
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_equipment_finance_commitment_gate_before_update $$
CREATE TRIGGER trg_equipment_finance_commitment_gate_before_update
BEFORE UPDATE ON equipment_sale_agreements
FOR EACH ROW
BEGIN
    DECLARE v_opening_deposit_total DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_active_lock_count INT DEFAULT 0;

    IF NEW.activation_source = 'approved_credit_application' THEN
        SELECT COALESCE(SUM(payment.amount), 0)
          INTO v_opening_deposit_total
        FROM equipment_sale_payments payment
        WHERE payment.agreement_id = NEW.id
          AND payment.payment_stage = 'opening_deposit'
          AND payment.payment_category = 'deposit'
          AND payment.is_voided = FALSE;

        IF ABS(NEW.deposit_received - v_opening_deposit_total) > 0.01 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Finance deposit balance must match controlled opening-deposit receipts.';
        END IF;

        IF NEW.deposit_received > NEW.deposit_required + 0.01 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Finance deposit received cannot exceed the required deposit.';
        END IF;

        IF OLD.equipment_commitment_status <> 'reserved'
           AND NEW.equipment_commitment_status = 'reserved' THEN
            IF NEW.deposit_received + 0.01 < NEW.deposit_required THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Required deposit must be complete before equipment commitment.';
            END IF;

            SELECT COUNT(*)
              INTO v_active_lock_count
            FROM equipment_asset_sale_locks sale_lock
            WHERE sale_lock.agreement_id = NEW.id
              AND sale_lock.asset_id = NEW.asset_id
              AND sale_lock.hire_location_id = NEW.hire_location_id
              AND sale_lock.lock_status = 'installment_active'
              AND sale_lock.released_at IS NULL;

            IF v_active_lock_count <> 1 THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'A matching active Finance reservation is required.';
            END IF;

            IF NEW.reservation_activated_at IS NULL
               OR NEW.reservation_activated_by IS NULL THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Finance reservation activation evidence is required.';
            END IF;
        END IF;

        IF NEW.agreement_status IN ('active','due_soon','payment_due','overdue')
           AND NEW.equipment_commitment_status <> 'reserved' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'A controlled Finance agreement cannot become active before equipment reservation.';
        END IF;
    END IF;
END $$

DELIMITER ;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260729_equipment_finance_deposit_reservation',
    'Control opening deposits and reserve equipment only after the required deposit is complete, without creating Hire work, delivery, ownership transfer or SMS evidence.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
