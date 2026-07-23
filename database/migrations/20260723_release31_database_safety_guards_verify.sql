-- CHALIN 03 RELEASE 3.1 DATABASE SAFETY GUARDS VERIFICATION
-- READ-ONLY VERIFICATION ONLY.

SELECT
  CASE WHEN COUNT(*) = 7 THEN 'PASS' ELSE 'FAIL' END AS status,
  7 - COUNT(*) AS problem_count,
  GROUP_CONCAT(TRIGGER_NAME ORDER BY TRIGGER_NAME SEPARATOR ', ') AS installed_triggers
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

SELECT
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
  CASE WHEN COUNT(*) = 1 THEN 0 ELSE 1 END AS problem_count,
  MAX(migration_name) AS migration_name
FROM schema_migrations
WHERE migration_name = '20260723_release31_database_safety_guards';
