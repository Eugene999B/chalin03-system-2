-- Read-only verification for 20260725_post_phase1_audit_signoff_readiness.sql

SELECT migration_name, description, applied_at
FROM schema_migrations
WHERE migration_name = '20260725_post_phase1_audit_signoff_readiness';

WITH required_columns AS (
    SELECT 'audit_signoffs' AS table_name, 'branch_id' AS column_name
    UNION ALL SELECT 'audit_signoffs', 'purchases_checked'
    UNION ALL SELECT 'audit_signoffs', 'returns_checked'
    UNION ALL SELECT 'audit_signoffs', 'transfers_checked'
    UNION ALL SELECT 'audit_signoffs', 'sms_checked'
    UNION ALL SELECT 'audit_signoffs', 'stock_ledger_checked'
    UNION ALL SELECT 'audit_signoffs', 'backup_checked'
    UNION ALL SELECT 'audit_signoffs', 'maintenance_checked'
    UNION ALL SELECT 'audit_reapproval_log', 'branch_id'
)
SELECT COUNT(*) AS missing_audit_readiness_columns
FROM required_columns required
LEFT JOIN information_schema.COLUMNS columns
  ON columns.TABLE_SCHEMA = DATABASE()
 AND columns.TABLE_NAME = required.table_name
 AND columns.COLUMN_NAME = required.column_name
WHERE columns.COLUMN_NAME IS NULL;

WITH required_indexes AS (
    SELECT 'audit_signoffs' AS table_name, 'idx_audit_signoff_branch' AS index_name
    UNION ALL SELECT 'audit_reapproval_log', 'idx_reapproval_branch'
)
SELECT COUNT(*) AS missing_audit_readiness_indexes
FROM required_indexes required
LEFT JOIN information_schema.STATISTICS indexes
  ON indexes.TABLE_SCHEMA = DATABASE()
 AND indexes.TABLE_NAME = required.table_name
 AND indexes.INDEX_NAME = required.index_name
WHERE indexes.INDEX_NAME IS NULL;

SELECT
    TABLE_NAME,
    COLUMN_NAME,
    COLUMN_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    (TABLE_NAME = 'audit_signoffs' AND COLUMN_NAME IN (
      'branch_id', 'purchases_checked', 'returns_checked',
      'transfers_checked', 'sms_checked', 'stock_ledger_checked',
      'backup_checked', 'maintenance_checked'
    ))
    OR (TABLE_NAME = 'audit_reapproval_log' AND COLUMN_NAME = 'branch_id')
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;
