SELECT
  'stage6b_activity_log_columns' AS check_name,
  COUNT(*) AS present_columns,
  12 AS expected_columns,
  CASE WHEN COUNT(*) = 12 THEN 'PASS' ELSE 'FAIL' END AS result
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'activity_log'
  AND COLUMN_NAME IN (
    'workspace_code',
    'business_unit_id',
    'mining_site_id',
    'hire_location_id',
    'entity_type',
    'entity_id',
    'action_type',
    'outcome',
    'severity',
    'request_id',
    'user_agent',
    'metadata_json'
  );

SELECT
  'stage6b_activity_log_indexes' AS check_name,
  COUNT(DISTINCT INDEX_NAME) AS present_indexes,
  CASE WHEN COUNT(DISTINCT INDEX_NAME) >= 8 THEN 'PASS' ELSE 'FAIL' END AS result
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'activity_log'
  AND INDEX_NAME IN (
    'idx_activity_workspace',
    'idx_activity_business_unit',
    'idx_activity_mining_site',
    'idx_activity_hire_location',
    'idx_activity_action_type',
    'idx_activity_entity',
    'idx_activity_outcome',
    'idx_activity_severity',
    'idx_activity_request'
  );
