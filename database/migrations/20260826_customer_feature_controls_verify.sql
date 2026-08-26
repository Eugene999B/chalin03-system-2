SELECT COUNT(*) AS table_count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'customer_feature_controls';

SELECT COUNT(*) AS missing_columns
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'customer_feature_controls'
  AND COLUMN_NAME IN (
    'branch_id',
    'customer_identity_editing_enabled',
    'customer_merge_enabled',
    'created_at',
    'updated_at'
  );
