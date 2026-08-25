
-- CHALIN 03 EQUIPMENT INSTALLMENT FINANCE
-- PHASE 4 OPENING DEPOSIT AND EXACT-MACHINE RESERVATION INTEGRITY
-- ADDITIVE MIGRATION ONLY.
-- FORWARD-ONLY TRIGGER REPLACEMENT.
-- BACKUP REQUIRED BEFORE PRODUCTION EXECUTION.
-- Existing agreements, schedules, receipts, locks, Hire work, delivery and ownership
-- evidence are preserved. This migration creates no Hire, delivery or SMS records.

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

    SELECT COUNT(*),
           MAX(agreement.activation_source),
           MAX(agreement.credit_application_id),
           MAX(agreement.hire_location_id),
           MAX(agreement.customer_id),
           MAX(agreement.agreement_status),
           MAX(agreement.equipment_commitment_status),
           MAX(agreement.deposit_required),
           MAX(agreement.deposit_received),
           MAX(application.application_status)
      INTO v_agreement_exists,
           v_activation_source,
           v_credit_application_id,
           v_hire_location_id,
           v_customer_id,
           v_agreement_status,
           v_commitment_status,
           v_deposit_required,
           v_deposit_received,
           v_application_status
      FROM equipment_sale_agreements agreement
      LEFT JOIN equipment_credit_applications application
        ON application.id = agreement.credit_application_id
     WHERE agreement.id = NEW.agreement_id;

    IF v_agreement_exists <> 1 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Finance payment agreement was not found.';
    END IF;

    IF v_activation_source = 'approved_credit_application' THEN
        IF NEW.payment_stage = 'legacy' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Use a controlled Finance payment stage for approved-credit agreements.';
        END IF;

        IF NEW.credit_application_id IS NULL
           OR NEW.credit_application_id <> v_credit_application_id THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Finance payment does not match the approved credit application.';
        END IF;

        IF NOT (NEW.hire_location_id <=> v_hire_location_id)
           OR NEW.customer_id <> v_customer_id THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Finance payment origin or customer does not match the agreement.';
        END IF;

        IF v_application_status <> 'approved' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The linked Finance application is not explicitly approved.';
        END IF;

        IF NEW.payment_stage = 'opening_deposit' THEN
            IF NEW.payment_category <> 'deposit' THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'The opening Finance stage accepts deposit payments only.';
            END IF;

            IF NULLIF(TRIM(NEW.idempotency_key), '') IS NULL THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Controlled opening deposits require an idempotency key.';
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

            IF v_deposit_received + NEW.amount > v_deposit_required THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Opening deposit exceeds the remaining required deposit.';
            END IF;

            SET NEW.reservation_effect = CASE
                WHEN v_deposit_received + NEW.amount >= v_deposit_required
                    THEN 'reserved'
                ELSE 'none'
            END;
        ELSEIF NEW.reservation_effect <> 'none' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Only the controlled opening deposit may affect reservation.';
        END IF;
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
           MAX(application.application_status)
      INTO v_agreement_exists,
           v_activation_source,
           v_credit_application_id,
           v_agreement_asset_id,
           v_agreement_location_id,
           v_agreement_status,
           v_commitment_status,
           v_deposit_required,
           v_deposit_received,
           v_application_status
      FROM equipment_sale_agreements agreement
      LEFT JOIN equipment_credit_applications application
        ON application.id = agreement.credit_application_id
     WHERE agreement.id = NEW.agreement_id;

    IF v_agreement_exists <> 1 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Finance reservation agreement was not found.';
    END IF;

    IF v_activation_source = 'approved_credit_application' THEN
        IF v_credit_application_id IS NULL OR v_application_status <> 'approved' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The reservation is not linked to an explicitly approved Finance application.';
        END IF;

        IF NEW.asset_id <> v_agreement_asset_id
           OR NOT (NEW.hire_location_id <=> v_agreement_location_id) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Reservation asset or origin does not match the Finance agreement.';
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

        IF v_deposit_received < v_deposit_required THEN
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
    DECLARE v_active_hire_count INT DEFAULT 0;
    DECLARE v_application_status VARCHAR(60) DEFAULT NULL;

    IF NEW.activation_source = 'approved_credit_application' THEN
        SELECT COALESCE(SUM(payment.amount), 0)
          INTO v_opening_deposit_total
          FROM equipment_sale_payments payment
         WHERE payment.agreement_id = NEW.id
           AND payment.payment_stage = 'opening_deposit'
           AND payment.payment_category = 'deposit'
           AND payment.is_voided = FALSE;

        IF NEW.deposit_received <> v_opening_deposit_total THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Finance deposit balance must match controlled opening-deposit receipts.';
        END IF;

        IF NEW.deposit_received > NEW.deposit_required THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Finance deposit received cannot exceed the required deposit.';
        END IF;

        IF OLD.equipment_commitment_status <> 'reserved'
           AND NEW.equipment_commitment_status = 'reserved' THEN
            SELECT application.application_status
              INTO v_application_status
              FROM equipment_credit_applications application
             WHERE application.id = NEW.credit_application_id
             LIMIT 1;

            IF v_application_status IS NULL OR v_application_status <> 'approved' THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Equipment commitment requires an explicitly approved Finance application.';
            END IF;

            IF NEW.deposit_received < NEW.deposit_required THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Required deposit must be complete before equipment commitment.';
            END IF;

            SELECT COUNT(*)
              INTO v_active_lock_count
              FROM equipment_asset_sale_locks sale_lock
             WHERE sale_lock.agreement_id = NEW.id
               AND sale_lock.asset_id = NEW.asset_id
               AND (sale_lock.hire_location_id <=> NEW.hire_location_id)
               AND sale_lock.lock_status = 'installment_active'
               AND sale_lock.released_at IS NULL;

            IF v_active_lock_count <> 1 THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'A matching active Finance reservation is required.';
            END IF;

            SELECT COUNT(*)
              INTO v_active_hire_count
              FROM hire_contract_assets hire_asset
             WHERE hire_asset.asset_id = NEW.asset_id
               AND hire_asset.status IN ('assigned','dispatched','active');

            IF v_active_hire_count <> 0 THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Equipment active on Hire cannot become committed to Finance.';
            END IF;

            IF NEW.reservation_activated_at IS NULL
               OR NEW.reservation_activated_by IS NULL THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Finance reservation activation evidence is required.';
            END IF;
        END IF;

        IF OLD.agreement_status NOT IN ('active','due_soon','payment_due','overdue')
           AND NEW.agreement_status IN ('active','due_soon','payment_due','overdue')
           AND NEW.equipment_commitment_status <> 'reserved' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'A controlled Finance agreement cannot become active before equipment reservation.';
        END IF;
    END IF;
END $$

DELIMITER ;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260803_equipment_finance_phase4_deposit_reservation_integrity',
    'Make opening deposits company-wide, require explicit application approval and idempotency, and reserve only the exact available non-Hire machine after the full deposit.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
