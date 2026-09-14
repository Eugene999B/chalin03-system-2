-- CHALIN 03 PRODUCTION MIGRATION
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and SQL backup verified.
-- Do not run database/schema.sql against production.
--
-- Phase 3 aligns the database agreement gate with the approved company-wide
-- Installment Finance workflow. KYC and affordability remain advisory; only
-- the explicit application approval decision is authoritative.

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

        IF NEW.hire_location_id IS NOT NULL THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'New Finance agreements are company-wide and cannot be tied to a Hire location.';
        END IF;

        SELECT COUNT(*)
          INTO v_matches
        FROM equipment_credit_applications application
        WHERE application.id = NEW.credit_application_id
          AND application.application_status = 'approved'
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
                SET MESSAGE_TEXT = 'The equipment is not currently available for Finance agreement creation.';
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

        IF NEW.hire_location_id IS NOT NULL
           AND NOT (
               OLD.hire_location_id IS NOT NULL
               AND NEW.hire_location_id = OLD.hire_location_id
           ) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'New Finance agreements are company-wide and cannot be tied to a Hire location.';
        END IF;

        SELECT COUNT(*)
          INTO v_matches
        FROM equipment_credit_applications application
        WHERE application.id = NEW.credit_application_id
          AND application.application_status = 'approved'
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

INSERT INTO schema_migrations (
    migration_name,
    description
)
VALUES (
    '20260803_equipment_finance_phase3_agreement_creation',
    'Aligns agreement creation with company-wide approved Finance applications while keeping optional KYC and affordability fields advisory.'
)
ON DUPLICATE KEY UPDATE
    description = VALUES(description);

