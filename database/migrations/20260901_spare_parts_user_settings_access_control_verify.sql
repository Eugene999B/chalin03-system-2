-- CHALIN 03 SPARE PARTS USER SETTINGS ACCESS CONTROL — POST-MIGRATION VERIFICATION
-- Read-only checks. This file does not change business data.

SELECT
  'user_settings_system_admin_only_column' AS check_name,
  COUNT(*) AS present_columns,
  1 AS expected_columns,
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'PROBLEM' END AS result
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'settings'
  AND COLUMN_NAME = 'user_settings_system_admin_only'
  AND DATA_TYPE = 'tinyint'
  AND IS_NULLABLE = 'NO'
  AND COLUMN_DEFAULT = '0';

SELECT
  'user_settings_system_admin_only_default_rows' AS check_name,
  COUNT(*) AS problem_count,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'PROBLEM' END AS result
FROM settings
WHERE user_settings_system_admin_only IS NULL;

SELECT
  'spare_parts_user_settings_access_control_migration_marker' AS check_name,
  COUNT(*) AS present_markers,
  1 AS expected_markers,
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'PROBLEM' END AS result
FROM schema_migrations
WHERE migration_name = '20260901_spare_parts_user_settings_access_control';
