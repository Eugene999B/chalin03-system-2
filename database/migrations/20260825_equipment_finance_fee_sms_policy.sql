-- CHALIN 03 Equipment Installment Finance fee/document/SMS policy hardening.
-- Additive only. No financial records are deleted or rewritten.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  migration_name VARCHAR(150) NOT NULL UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  description TEXT NULL,
  INDEX idx_schema_migration_name (migration_name)
);

DELIMITER $$
DROP TRIGGER IF EXISTS trg_equipment_finance_settings_late_fee_policy $$
CREATE TRIGGER trg_equipment_finance_settings_late_fee_policy
BEFORE INSERT ON equipment_finance_settings
FOR EACH ROW
BEGIN
  DECLARE base_terms LONGTEXT;
  DECLARE fee_clause LONGTEXT;
  DECLARE fee_sms_clause LONGTEXT;

  SET base_terms = SUBSTRING_INDEX(COALESCE(NEW.agreement_terms, ''), '\n[LATE PAYMENT FEE POLICY]\n', 1);
  SET fee_sms_clause = SUBSTRING_INDEX(COALESCE(NEW.reminder_template, ''), '\n[LATE PAYMENT FEE POLICY]\n', 1);

  IF NEW.late_charge_type = 'fixed' AND NEW.late_charge_value > 0 THEN
    SET fee_clause = IF(
      NEW.late_charge_cap > 0,
      CONCAT('Failure to pay an installment by its due date attracts a late payment fee of GHS ', FORMAT(NEW.late_charge_value, 2), ', subject to a maximum charge of GHS ', FORMAT(NEW.late_charge_cap, 2), '.'),
      CONCAT('Failure to pay an installment by its due date attracts a late payment fee of GHS ', FORMAT(NEW.late_charge_value, 2), '.')
    );
  ELSEIF NEW.late_charge_type = 'percentage' AND NEW.late_charge_value > 0 THEN
    SET fee_clause = IF(
      NEW.late_charge_cap > 0,
      CONCAT('Failure to pay an installment by its due date attracts a late payment fee of ', FORMAT(NEW.late_charge_value, 2), '% of the overdue installment balance, subject to a maximum charge of GHS ', FORMAT(NEW.late_charge_cap, 2), '.'),
      CONCAT('Failure to pay an installment by its due date attracts a late payment fee of ', FORMAT(NEW.late_charge_value, 2), '% of the overdue installment balance.')
    );
  ELSE
    SET fee_clause = 'No late payment fee is currently configured for this Installment Finance policy.';
  END IF;

  SET fee_sms_clause = IF(
    NEW.late_charge_type = 'fixed' AND NEW.late_charge_value > 0,
    IF(NEW.late_charge_cap > 0,
      CONCAT('A late payment fee of GHS ', FORMAT(NEW.late_charge_value, 2), ' will be added if this installment remains unpaid after its due date, subject to a maximum charge of GHS ', FORMAT(NEW.late_charge_cap, 2), '.'),
      CONCAT('A late payment fee of GHS ', FORMAT(NEW.late_charge_value, 2), ' will be added if this installment remains unpaid after its due date.')
    ),
    IF(NEW.late_charge_type = 'percentage' AND NEW.late_charge_value > 0,
      IF(NEW.late_charge_cap > 0,
        CONCAT('A late payment fee of ', FORMAT(NEW.late_charge_value, 2), '% of the overdue installment balance will be added if this installment remains unpaid after its due date, subject to a maximum charge of GHS ', FORMAT(NEW.late_charge_cap, 2), '.'),
        CONCAT('A late payment fee of ', FORMAT(NEW.late_charge_value, 2), '% of the overdue installment balance will be added if this installment remains unpaid after its due date.')
      ),
      'No late payment fee is currently configured.'
    )
  );

  SET NEW.agreement_terms = CONCAT(RTRIM(base_terms), '\n[LATE PAYMENT FEE POLICY]\n', fee_clause);
  SET NEW.reminder_template = CONCAT(RTRIM(fee_sms_clause), '\n[LATE PAYMENT FEE POLICY]\n', fee_sms_clause);
END $$

DROP TRIGGER IF EXISTS trg_equipment_finance_settings_late_fee_policy_update $$
CREATE TRIGGER trg_equipment_finance_settings_late_fee_policy_update
BEFORE UPDATE ON equipment_finance_settings
FOR EACH ROW
BEGIN
  DECLARE base_terms LONGTEXT;
  DECLARE fee_clause LONGTEXT;
  DECLARE base_template LONGTEXT;
  DECLARE fee_sms_clause LONGTEXT;

  SET base_terms = SUBSTRING_INDEX(COALESCE(NEW.agreement_terms, ''), '\n[LATE PAYMENT FEE POLICY]\n', 1);
  SET base_template = SUBSTRING_INDEX(COALESCE(NEW.reminder_template, ''), '\n[LATE PAYMENT FEE POLICY]\n', 1);

  IF NEW.late_charge_type = 'fixed' AND NEW.late_charge_value > 0 THEN
    SET fee_clause = IF(
      NEW.late_charge_cap > 0,
      CONCAT('Failure to pay an installment by its due date attracts a late payment fee of GHS ', FORMAT(NEW.late_charge_value, 2), ', subject to a maximum charge of GHS ', FORMAT(NEW.late_charge_cap, 2), '.'),
      CONCAT('Failure to pay an installment by its due date attracts a late payment fee of GHS ', FORMAT(NEW.late_charge_value, 2), '.')
    );
  ELSEIF NEW.late_charge_type = 'percentage' AND NEW.late_charge_value > 0 THEN
    SET fee_clause = IF(
      NEW.late_charge_cap > 0,
      CONCAT('Failure to pay an installment by its due date attracts a late payment fee of ', FORMAT(NEW.late_charge_value, 2), '% of the overdue installment balance, subject to a maximum charge of GHS ', FORMAT(NEW.late_charge_cap, 2), '.'),
      CONCAT('Failure to pay an installment by its due date attracts a late payment fee of ', FORMAT(NEW.late_charge_value, 2), '% of the overdue installment balance.')
    );
  ELSE
    SET fee_clause = 'No late payment fee is currently configured for this Installment Finance policy.';
  END IF;

  SET fee_sms_clause = IF(
    NEW.late_charge_type = 'fixed' AND NEW.late_charge_value > 0,
    IF(NEW.late_charge_cap > 0,
      CONCAT('A late payment fee of GHS ', FORMAT(NEW.late_charge_value, 2), ' will be added if this installment remains unpaid after its due date, subject to a maximum charge of GHS ', FORMAT(NEW.late_charge_cap, 2), '.'),
      CONCAT('A late payment fee of GHS ', FORMAT(NEW.late_charge_value, 2), ' will be added if this installment remains unpaid after its due date.')
    ),
    IF(NEW.late_charge_type = 'percentage' AND NEW.late_charge_value > 0,
      IF(NEW.late_charge_cap > 0,
        CONCAT('A late payment fee of ', FORMAT(NEW.late_charge_value, 2), '% of the overdue installment balance will be added if this installment remains unpaid after its due date, subject to a maximum charge of GHS ', FORMAT(NEW.late_charge_cap, 2), '.'),
        CONCAT('A late payment fee of ', FORMAT(NEW.late_charge_value, 2), '% of the overdue installment balance will be added if this installment remains unpaid after its due date.')
      ),
      'No late payment fee is currently configured.'
    )
  );

  SET NEW.agreement_terms = CONCAT(RTRIM(base_terms), '\n[LATE PAYMENT FEE POLICY]\n', fee_clause);
  SET NEW.reminder_template = CONCAT(RTRIM(base_template), '\n[LATE PAYMENT FEE POLICY]\n', fee_sms_clause);
END $$
DELIMITER ;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
  '20260825_equipment_finance_fee_sms_policy',
  'Keeps the configured late-payment fee visible in agreement terms and reminder SMS policy text.'
)
ON DUPLICATE KEY UPDATE migration_name = VALUES(migration_name);
