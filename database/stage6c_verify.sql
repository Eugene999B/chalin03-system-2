SELECT
  'stage6c_application_error_log' AS check_name,
  COUNT(*) AS table_present,
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS result
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'application_error_log';

SELECT
  'stage6c_error_log_indexes' AS check_name,
  COUNT(DISTINCT INDEX_NAME) AS present_indexes,
  CASE WHEN COUNT(DISTINCT INDEX_NAME) >= 4 THEN 'PASS' ELSE 'FAIL' END AS result
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'application_error_log'
  AND INDEX_NAME IN (
    'idx_application_error_request',
    'idx_application_error_user',
    'idx_application_error_status',
    'idx_application_error_created'
  );
