SELECT
  'stage6d_user_security_columns' AS check_name,
  COUNT(*) AS present_columns,
  5 AS expected_columns,
  CASE WHEN COUNT(*) = 5 THEN 'PASS' ELSE 'FAIL' END AS result
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'users'
  AND COLUMN_NAME IN (
    'failed_login_attempts',
    'locked_until',
    'last_login_at',
    'last_login_ip',
    'token_version'
  );

SELECT
  'stage6d_user_security_indexes' AS check_name,
  COUNT(DISTINCT INDEX_NAME) AS present_indexes,
  CASE WHEN COUNT(DISTINCT INDEX_NAME) >= 3 THEN 'PASS' ELSE 'FAIL' END AS result
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'users'
  AND INDEX_NAME IN (
    'idx_user_locked_until',
    'idx_user_last_login_at',
    'idx_user_token_version'
  );
