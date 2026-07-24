-- CHALIN 03 RELEASE 3.1 DATABASE SAFETY AND READINESS VERIFICATION
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
  CASE WHEN COUNT(*) = 3 THEN 'PASS' ELSE 'FAIL' END AS status,
  3 - COUNT(*) AS problem_count,
  GROUP_CONCAT(workspace_code ORDER BY workspace_code SEPARATOR ', ') AS configured_workspaces
FROM worker_identity_sequences
WHERE workspace_code IN ('spare_parts', 'mining', 'equipment_hire');

SELECT
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS problem_count,
  GROUP_CONCAT(
    CONCAT(required.table_name, '.', required.column_name)
    ORDER BY required.table_name, required.column_name
    SEPARATOR ', '
  ) AS missing_worker_identity_columns
FROM (
  SELECT 'settings' AS table_name, 'worker_id_card_validity_months' AS column_name
  UNION ALL SELECT 'settings', 'worker_employee_number_prefix'
  UNION ALL SELECT 'worker_identity_sequences', 'workspace_code'
  UNION ALL SELECT 'worker_identity_sequences', 'last_number'
  UNION ALL SELECT 'worker_profiles', 'employee_number'
  UNION ALL SELECT 'worker_profiles', 'workspace_code'
) required
LEFT JOIN information_schema.COLUMNS current_column
  ON current_column.TABLE_SCHEMA = DATABASE()
 AND current_column.TABLE_NAME = required.table_name
 AND current_column.COLUMN_NAME = required.column_name
WHERE current_column.COLUMN_NAME IS NULL;

SELECT
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
  CASE WHEN COUNT(*) = 1 THEN 0 ELSE 1 END AS problem_count,
  MAX(migration_name) AS migration_name
FROM schema_migrations
WHERE migration_name = '20260723_release31_database_safety_guards';
