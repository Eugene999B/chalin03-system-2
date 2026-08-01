-- CHALIN 03 EQUIPMENT INSTALLMENT FINANCE
-- COMPANY-WIDE DATABASE GUARD CORRECTION
-- Replaces only Finance triggers that still compared legacy Hire locations.
-- Existing Hire triggers, records and location rules are not changed.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL
);

DELIMITER $$

DROP TRIGGER IF EXISTS trg_equipment_finance_payment_gate_before_insert $$
CREATE TRIGGER trg_equipment_finance_payment_gate_before_insert
BEFORE INSERT ON equipment_sale_payments
FOR EACH ROW
BEGIN
    DECLARE v_exists INT DEFAULT 0;
    DECLARE v_source VARCHAR(60) DEFAULT NULL;
    DECLARE v_application_id BIGINT DEFAULT NULL;
    DECLARE v_customer_id INT DEFAULT NULL;
    DECLARE v_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_commitment VARCHAR(60) DEFAULT NULL;
    DECLARE v_deposit_required DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_deposit_received DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_outstanding DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_application_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_kyc_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_affordability VARCHAR(60) DEFAULT NULL;

    SELECT COUNT(*), MAX(agreement.activation_source),
           MAX(agreement.credit_application_id), MAX(agreement.customer_id),
           MAX(agreement.agreement_status), MAX(agreement.equipment_commitment_status),
           MAX(agreement.deposit_required), MAX(agreement.deposit_received),
           MAX(agreement.outstanding_balance), MAX(application.application_status),
           MAX(application.kyc_status), MAX(application.affordability_status)
      INTO v_exists, v_source, v_application_id, v_customer_id, v_status,
           v_commitment, v_deposit_required, v_deposit_received, v_outstanding,
           v_application_status, v_kyc_status, v_affordability
    FROM equipment_sale_agreements agreement
    LEFT JOIN equipment_credit_applications application
      ON application.id = agreement.credit_application_id
    WHERE agreement.id = NEW.agreement_id;

    IF v_exists <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Finance payment agreement was not found.';
    END IF;

    IF v_source = 'approved_credit_application' THEN
        SET NEW.hire_location_id = NULL;

        IF NEW.credit_application_id IS NULL OR NEW.credit_application_id <> v_application_id THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Finance payment does not match the approved credit application.';
        END IF;
        IF NEW.customer_id <> v_customer_id THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Finance payment customer does not match the agreement.';
        END IF;
        IF v_application_status <> 'approved' OR v_kyc_status <> 'verified'
           OR v_affordability NOT IN ('eligible','manual_review') THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The linked application no longer satisfies the approved Finance gate.';
        END IF;
        IF NEW.idempotency_key IS NULL OR CHAR_LENGTH(TRIM(NEW.idempotency_key)) < 20 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A secure Finance payment request key is required.';
        END IF;

        IF NEW.payment_stage = 'opening_deposit' THEN
            IF NEW.payment_category <> 'deposit' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The opening Finance stage accepts deposit payments only.';
            END IF;
            IF v_status NOT IN ('approved','active') OR v_commitment <> 'not_reserved' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Opening deposits are closed for this Finance agreement.';
            END IF;
            IF NEW.amount <= 0 OR v_deposit_received + NEW.amount > v_deposit_required + 0.01 THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Opening deposit amount is invalid.';
            END IF;
            SET NEW.reservation_effect = CASE
                WHEN v_deposit_received + NEW.amount + 0.01 >= v_deposit_required THEN 'reserved'
                ELSE 'none'
            END;
        ELSEIF NEW.payment_stage IN ('installment_collection','settlement') THEN
            IF v_commitment <> 'reserved' OR v_deposit_received + 0.01 < v_deposit_required THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Complete the Finance machine reservation before collections.';
            END IF;
            IF v_status NOT IN ('active','due_soon','payment_due','overdue') THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Collections are closed for this Finance agreement status.';
            END IF;
            IF NEW.amount <= 0 OR NEW.amount > v_outstanding + 0.01 THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Finance collection amount is invalid for the outstanding balance.';
            END IF;
            IF NEW.payment_stage = 'settlement' THEN
                IF NEW.payment_category <> 'settlement' OR NEW.amount + 0.01 < v_outstanding THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A settlement must clear the remaining Finance balance.';
                END IF;
            ELSEIF NEW.payment_category <> 'installment' OR NEW.amount + 0.01 >= v_outstanding THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Use the settlement stage when the payment clears the balance.';
            END IF;
            SET NEW.reservation_effect = 'none';
        ELSE
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Use the controlled Finance deposit or collection endpoint.';
        END IF;
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_equipment_finance_reservation_gate_before_insert $$
CREATE TRIGGER trg_equipment_finance_reservation_gate_before_insert
BEFORE INSERT ON equipment_asset_sale_locks
FOR EACH ROW
BEGIN
    DECLARE v_exists INT DEFAULT 0;
    DECLARE v_source VARCHAR(60) DEFAULT NULL;
    DECLARE v_application_id BIGINT DEFAULT NULL;
    DECLARE v_asset_id INT DEFAULT NULL;
    DECLARE v_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_commitment VARCHAR(60) DEFAULT NULL;
    DECLARE v_required DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_received DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_application_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_kyc_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_affordability VARCHAR(60) DEFAULT NULL;
    DECLARE v_asset_available INT DEFAULT 0;
    DECLARE v_active_hire_count INT DEFAULT 0;

    SELECT COUNT(*), MAX(agreement.activation_source),
           MAX(agreement.credit_application_id), MAX(agreement.asset_id),
           MAX(agreement.agreement_status), MAX(agreement.equipment_commitment_status),
           MAX(agreement.deposit_required), MAX(agreement.deposit_received),
           MAX(application.application_status), MAX(application.kyc_status),
           MAX(application.affordability_status)
      INTO v_exists, v_source, v_application_id, v_asset_id, v_status,
           v_commitment, v_required, v_received, v_application_status,
           v_kyc_status, v_affordability
    FROM equipment_sale_agreements agreement
    LEFT JOIN equipment_credit_applications application
      ON application.id = agreement.credit_application_id
    WHERE agreement.id = NEW.agreement_id;

    IF v_exists <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Finance reservation agreement was not found.';
    END IF;

    IF v_source = 'approved_credit_application' THEN
        SET NEW.hire_location_id = NULL;
        IF v_application_id IS NULL OR v_application_status <> 'approved'
           OR v_kyc_status <> 'verified' OR v_affordability NOT IN ('eligible','manual_review') THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The reservation is not linked to an approved Finance application.';
        END IF;
        IF NEW.asset_id <> v_asset_id OR NEW.lock_status <> 'installment_active' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Reservation machine or status does not match the Finance agreement.';
        END IF;
        IF v_status NOT IN ('approved','active') OR v_commitment <> 'not_reserved' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Finance agreement cannot create another machine reservation.';
        END IF;
        IF v_received + 0.01 < v_required THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The required opening deposit must be complete before reservation.';
        END IF;
        SELECT COUNT(*) INTO v_asset_available
        FROM fleet_assets asset
        WHERE asset.id = NEW.asset_id AND asset.is_active = TRUE
          AND asset.operational_purpose IN ('sale_only','sale_or_hire')
          AND asset.sale_status = 'available';
        IF v_asset_available <> 1 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The equipment is not available for Finance reservation.';
        END IF;
        SELECT COUNT(*) INTO v_active_hire_count
        FROM hire_contract_assets
        WHERE asset_id = NEW.asset_id AND status IN ('assigned','dispatched','active');
        IF v_active_hire_count <> 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Equipment active on Hire cannot be reserved for Finance.';
        END IF;
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_equipment_finance_commitment_gate_before_update $$
CREATE TRIGGER trg_equipment_finance_commitment_gate_before_update
BEFORE UPDATE ON equipment_sale_agreements
FOR EACH ROW
BEGIN
    DECLARE v_deposit_total DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_active_lock_count INT DEFAULT 0;

    IF NEW.activation_source = 'approved_credit_application' THEN
        SET NEW.hire_location_id = NULL;
        SELECT COALESCE(SUM(payment.amount), 0) INTO v_deposit_total
        FROM equipment_sale_payments payment
        WHERE payment.agreement_id = NEW.id
          AND payment.payment_stage = 'opening_deposit'
          AND payment.payment_category = 'deposit'
          AND payment.is_voided = FALSE;
        IF ABS(NEW.deposit_received - v_deposit_total) > 0.01 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Finance deposit balance must match controlled opening-deposit receipts.';
        END IF;
        IF NEW.deposit_received > NEW.deposit_required + 0.01 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Finance deposit received cannot exceed the required deposit.';
        END IF;
        IF OLD.equipment_commitment_status <> 'reserved'
           AND NEW.equipment_commitment_status = 'reserved' THEN
            IF NEW.deposit_received + 0.01 < NEW.deposit_required THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Required deposit must be complete before equipment commitment.';
            END IF;
            SELECT COUNT(*) INTO v_active_lock_count
            FROM equipment_asset_sale_locks sale_lock
            WHERE sale_lock.agreement_id = NEW.id
              AND sale_lock.asset_id = NEW.asset_id
              AND sale_lock.lock_status = 'installment_active'
              AND sale_lock.released_at IS NULL;
            IF v_active_lock_count <> 1 THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A matching active Finance reservation is required.';
            END IF;
            IF NEW.reservation_activated_at IS NULL OR NEW.reservation_activated_by IS NULL THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Finance reservation activation evidence is required.';
            END IF;
        END IF;
        IF NEW.agreement_status IN ('active','due_soon','payment_due','overdue')
           AND NEW.equipment_commitment_status <> 'reserved' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A Finance agreement cannot become active before equipment reservation.';
        END IF;
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_equipment_finance_delivery_gate_before_insert $$
CREATE TRIGGER trg_equipment_finance_delivery_gate_before_insert
BEFORE INSERT ON equipment_deliveries
FOR EACH ROW
BEGIN
    DECLARE v_exists INT DEFAULT 0;
    DECLARE v_source VARCHAR(60) DEFAULT NULL;
    DECLARE v_application_id BIGINT DEFAULT NULL;
    DECLARE v_customer_id INT DEFAULT NULL;
    DECLARE v_asset_id INT DEFAULT NULL;
    DECLARE v_application_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_kyc_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_affordability VARCHAR(60) DEFAULT NULL;
    DECLARE v_commitment VARCHAR(60) DEFAULT NULL;
    DECLARE v_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_policy VARCHAR(60) DEFAULT NULL;
    DECLARE v_threshold DECIMAL(7,4) DEFAULT 0.00;
    DECLARE v_total DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_paid DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_required DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_received DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_outstanding DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_active_hire_count INT DEFAULT 0;

    SELECT COUNT(*), MAX(agreement.activation_source),
           MAX(agreement.credit_application_id), MAX(agreement.customer_id),
           MAX(agreement.asset_id), MAX(application.application_status),
           MAX(application.kyc_status), MAX(application.affordability_status),
           MAX(agreement.equipment_commitment_status), MAX(agreement.agreement_status),
           MAX(agreement.delivery_policy), MAX(agreement.delivery_threshold_percent),
           MAX(agreement.total_amount), MAX(agreement.amount_paid),
           MAX(agreement.deposit_required), MAX(agreement.deposit_received),
           MAX(agreement.outstanding_balance)
      INTO v_exists, v_source, v_application_id, v_customer_id, v_asset_id,
           v_application_status, v_kyc_status, v_affordability, v_commitment,
           v_status, v_policy, v_threshold, v_total, v_paid, v_required,
           v_received, v_outstanding
    FROM equipment_sale_agreements agreement
    LEFT JOIN equipment_credit_applications application
      ON application.id = agreement.credit_application_id
    WHERE agreement.id = NEW.agreement_id;

    IF v_exists <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Finance delivery agreement was not found.';
    END IF;
    IF v_source = 'approved_credit_application' THEN
        SET NEW.hire_location_id = NULL;
        IF NEW.handover_stage <> 'finance_controlled' OR NEW.credit_application_id <> v_application_id
           OR NEW.customer_id <> v_customer_id OR NEW.asset_id <> v_asset_id THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Finance delivery does not match the approved agreement.';
        END IF;
        IF NEW.idempotency_key IS NULL OR CHAR_LENGTH(TRIM(NEW.idempotency_key)) < 20 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A secure Finance delivery request key is required.';
        END IF;
        IF v_application_status <> 'approved' OR v_kyc_status <> 'verified'
           OR v_affordability NOT IN ('eligible','manual_review') THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The linked application no longer satisfies the Finance delivery gate.';
        END IF;
        IF v_commitment <> 'reserved' OR v_status NOT IN ('active','due_soon','payment_due','overdue','completed') THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The Finance agreement is not ready for equipment handover.';
        END IF;
        SELECT COUNT(*) INTO v_active_hire_count FROM hire_contract_assets
        WHERE asset_id = v_asset_id AND status IN ('assigned','dispatched','active');
        IF v_active_hire_count > 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Equipment active on Hire cannot be handed over through Finance.';
        END IF;
        IF v_policy = 'after_deposit' AND v_received + 0.01 < v_required THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The required deposit threshold for delivery has not been reached.';
        END IF;
        IF v_policy = 'after_percentage'
           AND (v_total <= 0 OR (v_paid / v_total) * 100 + 0.0001 < v_threshold) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The required payment percentage for delivery has not been reached.';
        END IF;
        IF v_policy = 'after_full_payment' AND v_outstanding > 0.01 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Full payment is required before equipment handover.';
        END IF;
        IF NEW.status <> 'delivered' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Controlled Finance handover must be recorded as delivered.';
        END IF;
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_equipment_finance_ownership_gate_before_insert $$
CREATE TRIGGER trg_equipment_finance_ownership_gate_before_insert
BEFORE INSERT ON equipment_ownership_transfers
FOR EACH ROW
BEGIN
    DECLARE v_exists INT DEFAULT 0;
    DECLARE v_source VARCHAR(60) DEFAULT NULL;
    DECLARE v_application_id BIGINT DEFAULT NULL;
    DECLARE v_customer_id INT DEFAULT NULL;
    DECLARE v_asset_id INT DEFAULT NULL;
    DECLARE v_outstanding DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_delivery_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_commitment VARCHAR(60) DEFAULT NULL;
    DECLARE v_delivery_count INT DEFAULT 0;
    DECLARE v_active_hire_count INT DEFAULT 0;

    SELECT COUNT(*), MAX(activation_source), MAX(credit_application_id),
           MAX(customer_id), MAX(asset_id), MAX(outstanding_balance),
           MAX(delivery_status), MAX(equipment_commitment_status)
      INTO v_exists, v_source, v_application_id, v_customer_id, v_asset_id,
           v_outstanding, v_delivery_status, v_commitment
    FROM equipment_sale_agreements WHERE id = NEW.agreement_id;

    IF v_exists <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Finance ownership agreement was not found.';
    END IF;
    IF v_source = 'approved_credit_application' THEN
        SET NEW.hire_location_id = NULL;
        IF NEW.transfer_stage <> 'finance_controlled' OR NEW.credit_application_id <> v_application_id
           OR NEW.customer_id <> v_customer_id OR NEW.asset_id <> v_asset_id THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Finance ownership transfer does not match the approved agreement.';
        END IF;
        IF NEW.idempotency_key IS NULL OR CHAR_LENGTH(TRIM(NEW.idempotency_key)) < 20 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A secure Finance ownership request key is required.';
        END IF;
        IF v_outstanding > 0.01 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ownership cannot transfer while a Finance balance remains.';
        END IF;
        IF v_delivery_status <> 'delivered' OR v_commitment <> 'reserved' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Controlled Finance delivery and reservation are required before ownership transfer.';
        END IF;
        SELECT COUNT(*) INTO v_delivery_count FROM equipment_deliveries
        WHERE agreement_id = NEW.agreement_id AND handover_stage = 'finance_controlled' AND status = 'delivered';
        IF v_delivery_count <> 1 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Controlled Finance handover evidence is missing.';
        END IF;
        SELECT COUNT(*) INTO v_active_hire_count FROM hire_contract_assets
        WHERE asset_id = v_asset_id AND status IN ('assigned','dispatched','active');
        IF v_active_hire_count > 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Equipment active on Hire cannot transfer ownership through Finance.';
        END IF;
        IF NEW.status <> 'issued' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Controlled Finance ownership evidence must be issued.';
        END IF;
    END IF;
END $$

DELIMITER ;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260801_equipment_finance_company_wide_trigger_correction',
    'Replace Finance payment, reservation, commitment, delivery and ownership database guards so they enforce agreement identity without a Hire-location dependency.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
