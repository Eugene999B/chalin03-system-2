-- CHALIN 03 PRODUCTION MIGRATION
-- EQUIPMENT FINANCE PHASE 4 LEDGER-AWARE BALANCE GUARD
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and SQL backup verified.
-- Do not run database/schema.sql against production.
-- The guard recalculates controlled Finance balances from preserved payments,
-- schedule charges and append-only ledger entries whenever an agreement updates.
-- IMPORTANT: An installment Finance agreement remains `approved` until the exact
-- equipment reservation is committed. A completed opening deposit alone must
-- never transition the agreement to `active`.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

DELIMITER $$

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
            COALESCE(SUM(CASE
                WHEN payment.is_voided = FALSE AND payment.payment_category = 'deposit'
                    THEN payment.amount ELSE 0 END), 0)
        INTO v_paid, v_deposits
        FROM equipment_sale_payments payment
        WHERE payment.agreement_id = NEW.id;

        SELECT
            COALESCE(SUM(CASE WHEN schedule.schedule_status <> 'rescheduled'
                THEN schedule.late_charge_amount ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN schedule.schedule_status <> 'rescheduled'
                THEN schedule.waived_charge_amount ELSE 0 END), 0)
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
            -- Deposit completion is not equipment reservation. Keep the
            -- controlled Finance agreement approved until the exact machine
            -- reservation has been created and committed.
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

DELIMITER ;

INSERT INTO schema_migrations (
    migration_name,
    description
)
VALUES (
    'equipment_finance_phase4_balance_guard',
    'Ledger-aware Finance balance guard; controlled installment agreements remain approved until exact equipment reservation is committed.'
)
ON DUPLICATE KEY UPDATE
    description = VALUES(description);
