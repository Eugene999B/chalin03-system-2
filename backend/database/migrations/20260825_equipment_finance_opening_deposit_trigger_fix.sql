-- CHALIN 03 OPENING DEPOSIT TRIGGER CORRECTION
-- Keeps approved-credit agreements approved until the exact machine reservation exists.
-- Removes any legacy BEFORE UPDATE agreement trigger carrying the obsolete
-- "cannot become active before equipment reservation" rule, regardless of trigger name.

DELIMITER $$

DROP PROCEDURE IF EXISTS chalin03_remove_legacy_finance_activation_guards $$
CREATE PROCEDURE chalin03_remove_legacy_finance_activation_guards()
BEGIN
    DECLARE done INT DEFAULT 0;
    DECLARE trigger_name VARCHAR(255);
    DECLARE cur CURSOR FOR
        SELECT TRIGGER_NAME
          FROM information_schema.TRIGGERS
         WHERE TRIGGER_SCHEMA = DATABASE()
           AND EVENT_OBJECT_TABLE = 'equipment_sale_agreements'
           AND EVENT_MANIPULATION = 'UPDATE'
           AND ACTION_TIMING = 'BEFORE'
           AND ACTION_STATEMENT LIKE '%A controlled Finance agreement cannot become active before equipment reservation.%';
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

    OPEN cur;
    trigger_loop: LOOP
        FETCH cur INTO trigger_name;
        IF done = 1 THEN LEAVE trigger_loop; END IF;
        SET @drop_trigger_sql = CONCAT(
            'DROP TRIGGER IF EXISTS `', REPLACE(trigger_name, '`', '``'), '`'
        );
        PREPARE drop_trigger_stmt FROM @drop_trigger_sql;
        EXECUTE drop_trigger_stmt;
        DEALLOCATE PREPARE drop_trigger_stmt;
    END LOOP;
    CLOSE cur;
END $$

CALL chalin03_remove_legacy_finance_activation_guards() $$
DROP PROCEDURE IF EXISTS chalin03_remove_legacy_finance_activation_guards $$

DROP TRIGGER IF EXISTS trg_equipment_finance_phase4_balance_guard_before_update $$
CREATE TRIGGER trg_equipment_finance_phase4_balance_guard_before_update
BEFORE UPDATE ON equipment_sale_agreements
FOR EACH ROW
BEGIN
    DECLARE v_paid DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_deposits DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_late_charges DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_waived_charges DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_ledger_debits DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_ledger_credits DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_balance DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_overdue DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_next_due DATE DEFAULT NULL;

    IF NEW.sale_type = 'installment'
       AND NEW.activation_source = 'approved_credit_application' THEN
        SELECT
            COALESCE(SUM(CASE WHEN payment.is_voided = FALSE THEN payment.amount ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN payment.is_voided = FALSE AND payment.payment_category = 'deposit' THEN payment.amount ELSE 0 END), 0)
          INTO v_paid, v_deposits
          FROM equipment_sale_payments payment
         WHERE payment.agreement_id = NEW.id;

        SELECT
            COALESCE(SUM(CASE WHEN schedule.schedule_status <> 'rescheduled' THEN schedule.late_charge_amount ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN schedule.schedule_status <> 'rescheduled' THEN schedule.waived_charge_amount ELSE 0 END), 0)
          INTO v_late_charges, v_waived_charges
          FROM equipment_installment_schedule schedule
         WHERE schedule.agreement_id = NEW.id;

        SELECT
            COALESCE(SUM(CASE WHEN ledger.direction = 'debit' THEN ledger.amount ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN ledger.direction = 'credit' THEN ledger.amount ELSE 0 END), 0)
          INTO v_ledger_debits, v_ledger_credits
          FROM equipment_finance_ledger_entries ledger
         WHERE ledger.agreement_id = NEW.id;

        SET v_balance = GREATEST(
            ROUND(
                NEW.total_amount + v_late_charges - v_waived_charges
                + v_ledger_debits - v_paid - v_ledger_credits,
                2
            ),
            0.00
        );

        SELECT COALESCE(SUM(GREATEST(
            schedule.scheduled_amount + schedule.late_charge_amount
            - schedule.waived_charge_amount - schedule.amount_paid,
            0
        )), 0)
          INTO v_overdue
          FROM equipment_installment_schedule schedule
         WHERE schedule.agreement_id = NEW.id
           AND schedule.due_date < CURDATE()
           AND schedule.schedule_status IN ('upcoming','due','partial','overdue');

        SELECT MIN(schedule.due_date)
          INTO v_next_due
          FROM equipment_installment_schedule schedule
         WHERE schedule.agreement_id = NEW.id
           AND schedule.schedule_status IN ('upcoming','due','partial','overdue');

        SET NEW.amount_paid = v_paid;
        SET NEW.deposit_received = v_deposits;
        SET NEW.late_charges_total = v_late_charges;
        SET NEW.waived_charges_total = v_waived_charges;
        SET NEW.outstanding_balance = v_balance;
        SET NEW.overdue_amount = LEAST(v_overdue, v_balance);

        IF NEW.agreement_status IN ('cancelled','defaulted') THEN
            SET NEW.next_due_date = NULL;
        ELSEIF NEW.equipment_commitment_status = 'not_reserved' THEN
            SET NEW.agreement_status = 'approved';
            SET NEW.next_due_date = v_next_due;
        ELSEIF v_balance <= 0.01 THEN
            SET NEW.agreement_status = 'completed';
            SET NEW.next_due_date = NULL;
            SET NEW.completed_at = COALESCE(NEW.completed_at, NOW());
        ELSEIF v_overdue > 0.01 THEN
            SET NEW.agreement_status = 'overdue';
            SET NEW.next_due_date = v_next_due;
        ELSEIF v_next_due IS NOT NULL THEN
            SET NEW.agreement_status = 'active';
            SET NEW.next_due_date = v_next_due;
        ELSE
            SET NEW.agreement_status = 'payment_due';
            SET NEW.next_due_date = NULL;
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
            SELECT application.application_status
              INTO v_application_status
              FROM equipment_credit_applications application
             WHERE application.id = NEW.credit_application_id
             LIMIT 1;

            IF v_application_status IS NULL OR v_application_status <> 'approved' THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Equipment commitment requires an explicitly approved Finance application.';
            END IF;

            IF NEW.deposit_received + 0.01 < NEW.deposit_required THEN
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
