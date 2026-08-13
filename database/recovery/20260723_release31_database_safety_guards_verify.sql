-- CHALIN 03 STAGING RECOVERY VERIFIER
-- Read-only verification of the controlled Release 3.1 safety schema.

DROP PROCEDURE IF EXISTS chalin03_verify_recovery_safety_guards;
DELIMITER $$
CREATE PROCEDURE chalin03_verify_recovery_safety_guards()
BEGIN
  DECLARE missing_triggers INT DEFAULT 0;
  DECLARE missing_columns INT DEFAULT 0;

  SELECT 7 - COUNT(*) INTO missing_triggers
  FROM information_schema.TRIGGERS
  WHERE TRIGGER_SCHEMA = DATABASE()
    AND TRIGGER_NAME IN (
      'trg_user_password_change_revoke_biometrics',
      'trg_hire_contract_asset_sale_guard_before_insert',
      'trg_hire_contract_asset_sale_guard_before_update',
      'trg_equipment_sale_agreement_hire_guard_before_insert',
      'trg_equipment_sale_agreement_hire_guard_before_update',
      'trg_spare_parts_installment_retired_sales_insert',
      'trg_spare_parts_installment_retired_agreement_insert'
    );

  SELECT COUNT(*) INTO missing_columns
  FROM (
    SELECT 'settings' AS table_name, 'worker_id_card_validity_months' AS column_name
    UNION ALL SELECT 'settings', 'worker_employee_number_prefix'
    UNION ALL SELECT 'worker_identity_sequences', 'workspace_code'
    UNION ALL SELECT 'worker_identity_sequences', 'last_number'
    UNION ALL SELECT 'worker_profiles', 'employee_number'
    UNION ALL SELECT 'worker_profiles', 'workspace_code'
    UNION ALL SELECT 'user_passkeys', 'device_binding_hash'
    UNION ALL SELECT 'user_passkeys', 'binding_generation'
  ) required
  LEFT JOIN information_schema.COLUMNS current_column
    ON current_column.TABLE_SCHEMA = DATABASE()
   AND current_column.TABLE_NAME = required.table_name
   AND current_column.COLUMN_NAME = required.column_name
  WHERE current_column.COLUMN_NAME IS NULL;

  IF missing_triggers <> 0 OR missing_columns <> 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Release 3.1 database safety recovery verification failed.';
  END IF;
END$$
DELIMITER ;
CALL chalin03_verify_recovery_safety_guards();
DROP PROCEDURE IF EXISTS chalin03_verify_recovery_safety_guards;
