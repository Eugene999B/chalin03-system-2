-- CHALIN 03 OPENING DEPOSIT RESERVATION GATE CORRECTION
-- Replaces the Finance reservation trigger and normalizes stale next-payment pointers.

DELIMITER $$
DROP TRIGGER IF EXISTS trg_equipment_finance_reservation_gate_before_insert $$
CREATE TRIGGER trg_equipment_finance_reservation_gate_before_insert
BEFORE INSERT ON equipment_asset_sale_locks
FOR EACH ROW
BEGIN
    DECLARE v_exists INT DEFAULT 0;
    DECLARE v_source VARCHAR(60) DEFAULT NULL;
    DECLARE v_credit BIGINT DEFAULT NULL;
    DECLARE v_asset INT DEFAULT NULL;
    DECLARE v_location INT DEFAULT NULL;
    DECLARE v_status VARCHAR(60) DEFAULT NULL;
    DECLARE v_commitment VARCHAR(60) DEFAULT NULL;
    DECLARE v_required DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_received DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_application VARCHAR(60) DEFAULT NULL;
    DECLARE v_available INT DEFAULT 0;
    DECLARE v_hire INT DEFAULT 0;

    SELECT COUNT(*), MAX(agreement.activation_source), MAX(agreement.credit_application_id),
           MAX(agreement.asset_id), MAX(agreement.hire_location_id), MAX(agreement.agreement_status),
           MAX(agreement.equipment_commitment_status), MAX(agreement.deposit_required),
           MAX(agreement.deposit_received), MAX(application.application_status)
      INTO v_exists, v_source, v_credit, v_asset, v_location, v_status, v_commitment,
           v_required, v_received, v_application
      FROM equipment_sale_agreements agreement
      LEFT JOIN equipment_credit_applications application ON application.id = agreement.credit_application_id
     WHERE agreement.id = NEW.agreement_id;

    IF v_exists <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Finance reservation agreement was not found.';
    END IF;

    IF v_source = 'approved_credit_application' THEN
        IF v_credit IS NULL OR v_application <> 'approved' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The reservation is not linked to an explicitly approved Finance application.';
        END IF;
        IF NEW.asset_id <> v_asset OR NOT (NEW.hire_location_id <=> v_location) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Reservation asset or origin does not match the Finance agreement.';
        END IF;
        IF NEW.lock_status <> 'installment_active' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved-credit Finance reservations must use installment_active status.';
        END IF;
        IF v_status NOT IN ('approved','active') OR v_commitment <> 'not_reserved' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This Finance agreement cannot create another machine reservation.';
        END IF;
        IF v_received + 0.01 < v_required THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The required opening deposit must be complete before reservation.';
        END IF;
        SELECT COUNT(*) INTO v_available
          FROM fleet_assets asset
         WHERE asset.id = NEW.asset_id AND asset.is_active = TRUE
           AND asset.operational_purpose IN ('sale_only','sale_or_hire')
           AND asset.sale_status = 'available';
        IF v_available <> 1 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The equipment is not available for Finance reservation.';
        END IF;
        SELECT COUNT(*) INTO v_hire
          FROM hire_contract_assets hire_asset
         WHERE hire_asset.asset_id = NEW.asset_id
           AND hire_asset.status IN ('assigned','dispatched','active');
        IF v_hire <> 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Equipment active on Hire cannot be reserved for Finance.';
        END IF;
    END IF;
END $$
DELIMITER ;

-- Never expose an overdue historical schedule row as the next payment.
-- Past rows remain intact for arrears reporting; only the agreement pointer is normalized.
UPDATE equipment_sale_agreements agreement
SET agreement.next_due_date = (
    SELECT MIN(schedule.due_date)
      FROM equipment_installment_schedule schedule
     WHERE schedule.agreement_id = agreement.id
       AND schedule.schedule_status NOT IN ('paid','cancelled','waived','rescheduled')
       AND schedule.due_date >= CURDATE()
)
WHERE agreement.sale_type = 'installment'
  AND agreement.activation_source = 'approved_credit_application'
  AND agreement.agreement_status NOT IN ('cancelled','completed');
