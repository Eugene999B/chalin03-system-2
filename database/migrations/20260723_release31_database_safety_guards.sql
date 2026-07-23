-- CHALIN 03 RELEASE 3.1 DATABASE SAFETY GUARDS
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: create and validate a fresh Version 3.1 full-system backup before production execution.
-- Replaces trigger definitions only; no business rows are deleted or rewritten.
-- Normal application sessions use FOREIGN_KEY_CHECKS=1 and remain fully protected.
-- The protected full-system restore is the only workflow that temporarily uses FOREIGN_KEY_CHECKS=0.

DELIMITER $$

DROP TRIGGER IF EXISTS trg_user_password_change_revoke_biometrics $$
CREATE TRIGGER trg_user_password_change_revoke_biometrics
AFTER UPDATE ON users
FOR EACH ROW
BEGIN
    IF NOT (NEW.password_hash <=> OLD.password_hash) THEN
        UPDATE user_passkeys
        SET revoked_at = COALESCE(revoked_at, NOW()),
            revoked_reason = COALESCE(revoked_reason, 'password_changed')
        WHERE user_id = NEW.id
          AND revoked_at IS NULL;
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_hire_contract_asset_sale_guard_before_insert $$
CREATE TRIGGER trg_hire_contract_asset_sale_guard_before_insert
BEFORE INSERT ON hire_contract_assets
FOR EACH ROW
BEGIN
    DECLARE blocked_count INT DEFAULT 0;

    IF @@SESSION.FOREIGN_KEY_CHECKS = 1 THEN
        SELECT COUNT(*)
        INTO blocked_count
        FROM fleet_assets fa
        LEFT JOIN equipment_asset_sale_locks easl
          ON easl.asset_id = fa.id
         AND easl.released_at IS NULL
        WHERE fa.id = NEW.asset_id
          AND (
            fa.operational_purpose = 'sale_only'
            OR fa.sale_status IN ('reserved','installment_active','sold')
            OR easl.asset_id IS NOT NULL
          );

        IF blocked_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'This equipment is reserved, under installment sale, sold, or marked sale-only and cannot be assigned for hire.';
        END IF;
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_hire_contract_asset_sale_guard_before_update $$
CREATE TRIGGER trg_hire_contract_asset_sale_guard_before_update
BEFORE UPDATE ON hire_contract_assets
FOR EACH ROW
BEGIN
    DECLARE blocked_count INT DEFAULT 0;

    IF @@SESSION.FOREIGN_KEY_CHECKS = 1
       AND (
         NEW.asset_id <> OLD.asset_id
         OR NEW.status IN ('assigned','dispatched','active')
       ) THEN
        SELECT COUNT(*)
        INTO blocked_count
        FROM fleet_assets fa
        LEFT JOIN equipment_asset_sale_locks easl
          ON easl.asset_id = fa.id
         AND easl.released_at IS NULL
        WHERE fa.id = NEW.asset_id
          AND (
            fa.operational_purpose = 'sale_only'
            OR fa.sale_status IN ('reserved','installment_active','sold')
            OR easl.asset_id IS NOT NULL
          );

        IF blocked_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'This equipment is reserved, under installment sale, sold, or marked sale-only and cannot be activated for hire.';
        END IF;
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_equipment_sale_agreement_hire_guard_before_insert $$
CREATE TRIGGER trg_equipment_sale_agreement_hire_guard_before_insert
BEFORE INSERT ON equipment_sale_agreements
FOR EACH ROW
BEGIN
    DECLARE active_hire_count INT DEFAULT 0;
    DECLARE sale_allowed_count INT DEFAULT 0;

    IF @@SESSION.FOREIGN_KEY_CHECKS = 1
       AND NEW.agreement_status IN ('approved','active','due_soon','payment_due','overdue','completed') THEN
        SELECT COUNT(*)
        INTO active_hire_count
        FROM hire_contract_assets hca
        WHERE hca.asset_id = NEW.asset_id
          AND hca.status IN ('assigned','dispatched','active');

        SELECT COUNT(*)
        INTO sale_allowed_count
        FROM fleet_assets fa
        WHERE fa.id = NEW.asset_id
          AND fa.is_active = TRUE
          AND fa.operational_purpose IN ('sale_only','sale_or_hire')
          AND fa.sale_status NOT IN ('sold','cancelled')
          AND (fa.hire_location_id IS NULL OR fa.hire_location_id = NEW.hire_location_id);

        IF active_hire_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Equipment currently assigned or dispatched for hire cannot enter an approved sale agreement.';
        END IF;

        IF sale_allowed_count = 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The selected equipment is not available for sale at this Equipment Hire location.';
        END IF;
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_equipment_sale_agreement_hire_guard_before_update $$
CREATE TRIGGER trg_equipment_sale_agreement_hire_guard_before_update
BEFORE UPDATE ON equipment_sale_agreements
FOR EACH ROW
BEGIN
    DECLARE active_hire_count INT DEFAULT 0;
    DECLARE sale_allowed_count INT DEFAULT 0;

    IF @@SESSION.FOREIGN_KEY_CHECKS = 1
       AND NEW.agreement_status IN ('approved','active','due_soon','payment_due','overdue','completed')
       AND (
         NOT (OLD.agreement_status <=> NEW.agreement_status)
         OR NOT (OLD.asset_id <=> NEW.asset_id)
         OR NOT (OLD.hire_location_id <=> NEW.hire_location_id)
       ) THEN
        SELECT COUNT(*)
        INTO active_hire_count
        FROM hire_contract_assets hca
        WHERE hca.asset_id = NEW.asset_id
          AND hca.status IN ('assigned','dispatched','active');

        SELECT COUNT(*)
        INTO sale_allowed_count
        FROM fleet_assets fa
        WHERE fa.id = NEW.asset_id
          AND fa.is_active = TRUE
          AND fa.operational_purpose IN ('sale_only','sale_or_hire')
          AND fa.sale_status NOT IN ('sold','cancelled')
          AND (fa.hire_location_id IS NULL OR fa.hire_location_id = NEW.hire_location_id);

        IF active_hire_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Equipment currently assigned or dispatched for hire cannot enter an approved sale agreement.';
        END IF;

        IF sale_allowed_count = 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The selected equipment is not available for sale at this Equipment Hire location.';
        END IF;
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_spare_parts_installment_retired_sales_insert $$
CREATE TRIGGER trg_spare_parts_installment_retired_sales_insert
BEFORE INSERT ON sales
FOR EACH ROW
BEGIN
    IF @@SESSION.FOREIGN_KEY_CHECKS = 1
       AND LOWER(COALESCE(NEW.payment_type, '')) = 'installment' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Spare Parts installment sales have moved to Equipment Sales & Hire.';
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_spare_parts_installment_retired_agreement_insert $$
CREATE TRIGGER trg_spare_parts_installment_retired_agreement_insert
BEFORE INSERT ON installment_agreements
FOR EACH ROW
BEGIN
    IF @@SESSION.FOREIGN_KEY_CHECKS = 1 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'New Spare Parts installment agreements are retired. Use Equipment Sales & Hire.';
    END IF;
END $$

DELIMITER ;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260723_release31_database_safety_guards',
    'Installs verified password-change biometric revocation, Equipment Hire/Sales double-booking guards and Spare Parts installment retirement guards through the controlled migration process.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
