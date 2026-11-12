-- CHALIN 03 PROFESSIONAL EQUIPMENT INSTALLMENT FINANCE
-- POLICY HARDENING — ADDITIVE ONLY
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: verified Professional Backup and separate verified SQL/database backup before production execution.
-- Captures commercial policy on each new agreement so later Finance Settings
-- changes cannot silently rewrite an existing customer's terms.

DELIMITER $$

DROP PROCEDURE IF EXISTS equipment_finance_policy_add_column_if_missing $$
DROP PROCEDURE IF EXISTS equipment_finance_policy_add_index_if_missing $$

CREATE PROCEDURE equipment_finance_policy_add_column_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_column_name VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND COLUMN_NAME = p_column_name
    ) THEN
        SET @finance_policy_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE finance_policy_stmt FROM @finance_policy_sql;
        EXECUTE finance_policy_stmt;
        DEALLOCATE PREPARE finance_policy_stmt;
    END IF;
END $$

CREATE PROCEDURE equipment_finance_policy_add_index_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_index_name VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND INDEX_NAME = p_index_name
    ) THEN
        SET @finance_policy_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD ', p_definition
        );
        PREPARE finance_policy_stmt FROM @finance_policy_sql;
        EXECUTE finance_policy_stmt;
        DEALLOCATE PREPARE finance_policy_stmt;
    END IF;
END $$

DELIMITER ;

CALL equipment_finance_policy_add_column_if_missing(
    'equipment_sale_agreements',
    'policy_version_snapshot',
    'VARCHAR(60) NULL AFTER terms_version'
);
CALL equipment_finance_policy_add_column_if_missing(
    'equipment_sale_agreements',
    'late_charge_type_snapshot',
    "ENUM('none','fixed','percentage') NULL AFTER policy_version_snapshot"
);
CALL equipment_finance_policy_add_column_if_missing(
    'equipment_sale_agreements',
    'late_charge_value_snapshot',
    'DECIMAL(14,2) NULL AFTER late_charge_type_snapshot'
);
CALL equipment_finance_policy_add_column_if_missing(
    'equipment_sale_agreements',
    'late_charge_cap_snapshot',
    'DECIMAL(14,2) NULL AFTER late_charge_value_snapshot'
);
CALL equipment_finance_policy_add_column_if_missing(
    'equipment_sale_agreements',
    'grace_days_snapshot',
    'INT NULL AFTER late_charge_cap_snapshot'
);
CALL equipment_finance_policy_add_column_if_missing(
    'equipment_sale_agreements',
    'agreement_terms_snapshot',
    'LONGTEXT NULL AFTER grace_days_snapshot'
);
CALL equipment_finance_policy_add_column_if_missing(
    'equipment_sale_agreements',
    'reconciliation_status',
    "ENUM('unknown','reconciled','review_required','blocked') NOT NULL DEFAULT 'unknown' AFTER agreement_terms_snapshot"
);
CALL equipment_finance_policy_add_column_if_missing(
    'equipment_sale_agreements',
    'reconciliation_checked_at',
    'DATETIME NULL AFTER reconciliation_status'
);

CALL equipment_finance_policy_add_index_if_missing(
    'equipment_sale_agreements',
    'idx_finance_agreement_reconciliation',
    'INDEX `idx_finance_agreement_reconciliation` (`reconciliation_status`, `reconciliation_checked_at`)'
);

CALL equipment_finance_policy_add_column_if_missing(
    'equipment_finance_settings',
    'boss_due_alert_enabled',
    'BOOLEAN NOT NULL DEFAULT FALSE'
);
CALL equipment_finance_policy_add_column_if_missing(
    'equipment_finance_settings',
    'boss_overdue_alert_enabled',
    'BOOLEAN NOT NULL DEFAULT TRUE'
);
CALL equipment_finance_policy_add_column_if_missing(
    'equipment_finance_settings',
    'customer_due_soon_sms_enabled',
    'BOOLEAN NOT NULL DEFAULT TRUE'
);
CALL equipment_finance_policy_add_column_if_missing(
    'equipment_finance_settings',
    'customer_due_today_sms_enabled',
    'BOOLEAN NOT NULL DEFAULT TRUE'
);
CALL equipment_finance_policy_add_column_if_missing(
    'equipment_finance_settings',
    'customer_overdue_sms_enabled',
    'BOOLEAN NOT NULL DEFAULT TRUE'
);
CALL equipment_finance_policy_add_column_if_missing(
    'equipment_finance_settings',
    'late_fee_applied_sms_enabled',
    'BOOLEAN NOT NULL DEFAULT TRUE'
);
CALL equipment_finance_policy_add_column_if_missing(
    'equipment_finance_settings',
    'payment_reversal_sms_enabled',
    'BOOLEAN NOT NULL DEFAULT TRUE'
);

UPDATE equipment_sale_agreements agreement
INNER JOIN equipment_finance_settings settings ON settings.id = 1
SET agreement.policy_version_snapshot = COALESCE(agreement.policy_version_snapshot, CONCAT('LEGACY-REVIEW-', settings.terms_version)),
    agreement.reconciliation_status = CASE
      WHEN agreement.reconciliation_status = 'unknown' THEN 'review_required'
      ELSE agreement.reconciliation_status
    END
WHERE agreement.policy_version_snapshot IS NULL;

DELIMITER $$

DROP TRIGGER IF EXISTS trg_equipment_finance_agreement_policy_snapshot_before_insert $$
CREATE TRIGGER trg_equipment_finance_agreement_policy_snapshot_before_insert
BEFORE INSERT ON equipment_sale_agreements
FOR EACH ROW
BEGIN
    DECLARE v_policy_version VARCHAR(60);
    DECLARE v_late_type VARCHAR(20);
    DECLARE v_late_value DECIMAL(14,2);
    DECLARE v_late_cap DECIMAL(14,2);
    DECLARE v_grace_days INT;
    DECLARE v_terms LONGTEXT;

    SELECT terms_version, late_charge_type, late_charge_value, late_charge_cap,
           default_grace_days, agreement_terms
      INTO v_policy_version, v_late_type, v_late_value, v_late_cap, v_grace_days, v_terms
      FROM equipment_finance_settings
     WHERE id = 1
     LIMIT 1;

    IF NEW.policy_version_snapshot IS NULL THEN SET NEW.policy_version_snapshot = v_policy_version; END IF;
    IF NEW.late_charge_type_snapshot IS NULL THEN SET NEW.late_charge_type_snapshot = v_late_type; END IF;
    IF NEW.late_charge_value_snapshot IS NULL THEN SET NEW.late_charge_value_snapshot = v_late_value; END IF;
    IF NEW.late_charge_cap_snapshot IS NULL THEN SET NEW.late_charge_cap_snapshot = v_late_cap; END IF;
    IF NEW.grace_days_snapshot IS NULL THEN SET NEW.grace_days_snapshot = v_grace_days; END IF;
    IF NEW.agreement_terms_snapshot IS NULL THEN SET NEW.agreement_terms_snapshot = v_terms; END IF;
    IF NEW.reconciliation_status IS NULL THEN SET NEW.reconciliation_status = 'unknown'; END IF;
END $$

DROP TRIGGER IF EXISTS trg_equipment_finance_agreement_policy_snapshot_before_update $$
CREATE TRIGGER trg_equipment_finance_agreement_policy_snapshot_before_update
BEFORE UPDATE ON equipment_sale_agreements
FOR EACH ROW
BEGIN
    IF OLD.policy_version_snapshot IS NOT NULL AND NEW.policy_version_snapshot <> OLD.policy_version_snapshot THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Finance agreement policy snapshot is immutable after agreement creation.';
    END IF;
    IF OLD.late_charge_type_snapshot IS NOT NULL AND NOT (NEW.late_charge_type_snapshot <=> OLD.late_charge_type_snapshot) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Finance agreement late-fee policy is immutable after agreement creation.';
    END IF;
    IF OLD.late_charge_value_snapshot IS NOT NULL AND NOT (NEW.late_charge_value_snapshot <=> OLD.late_charge_value_snapshot) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Finance agreement late-fee value is immutable after agreement creation.';
    END IF;
    IF OLD.late_charge_cap_snapshot IS NOT NULL AND NOT (NEW.late_charge_cap_snapshot <=> OLD.late_charge_cap_snapshot) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Finance agreement late-fee cap is immutable after agreement creation.';
    END IF;
    IF OLD.grace_days_snapshot IS NOT NULL AND NOT (NEW.grace_days_snapshot <=> OLD.grace_days_snapshot) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Finance agreement grace-period policy is immutable after agreement creation.';
    END IF;
END $$

DELIMITER ;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
  '20260825_equipment_finance_policy_hardening',
  'Agreement-specific Finance policy snapshots, notification event controls and reconciliation state.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
